// background.js - OmniAgent Service Worker
try {
  importScripts('lib/mcp.js');
} catch (e) {
  console.error("Failed to import mcp.js", e);
}

// --- Configuration & State ---
let currentProvider = 'gemini'; // Default
let apiKeys = {
  gemini: '',
  openai: '',
  anthropic: ''
};
let models = {
  gemini: 'gemini-3-flash-preview',
  openai: 'gpt-4o',
  anthropic: 'claude-3-opus-20240229',
  ollama: 'llama3'
};
let ollamaEndpoint = 'http://localhost:11434/api/generate';

// MCP Manager
const mcpManager = new self.McpManager();

// Persistent Memory for specific tasks
let agentMemory = {};

// Enable opening side panel on icon click (Chrome 116+)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Could not set panel behavior:", error));
}

// Load settings on startup
chrome.storage.sync.get(['provider', 'apiKeys', 'models', 'ollamaEndpoint', 'mcpServers'], (result) => {
  if (result.provider) currentProvider = result.provider;
  if (result.apiKeys) apiKeys = result.apiKeys;
  if (result.models) models = result.models;
  if (result.ollamaEndpoint) ollamaEndpoint = result.ollamaEndpoint;

  if (result.mcpServers) {
    mcpManager.syncServers(result.mcpServers);
  }
});

// Listen for updates in settings
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.provider) currentProvider = changes.provider.newValue;
    if (changes.apiKeys) apiKeys = changes.apiKeys.newValue;
    if (changes.models) models = changes.models.newValue;
    if (changes.ollamaEndpoint) ollamaEndpoint = changes.ollamaEndpoint.newValue;
    if (changes.mcpServers) {
      mcpManager.syncServers(changes.mcpServers.newValue || []);
    }
  }
});

// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PROCESS_USER_COMMAND') {
    handleUserCommand(request.payload, sendResponse);
    return true; // Keep channel open for async response
  }
  if (request.type === 'CHECK_STATUS') {
    sendResponse({ status: 'ready', provider: currentProvider });
  }
  if (request.type === 'UPDATE_MEMORY') {
    // Allow content script/sidepanel to explicitely save data
    const { key, value } = request.payload;
    if (!agentMemory[key]) agentMemory[key] = [];
    agentMemory[key].push(value);
    sendResponse({ success: true });
  }
  // NEW: Handle MCP Tool Execution
  if (request.type === 'EXECUTE_MCP_TOOL') {
    const { source, tool, args } = request.payload;
    mcpManager.callTool(source, tool, args)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// --- Main Logic ---
async function handleUserCommand(payload, sendResponse) {
  const { userPrompt, visualContext, history } = payload;

  // Format history for context
  const historyContext = history.map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n');

  // Format Memory for context
  const memoryContext = JSON.stringify(agentMemory, null, 2);

  // Get MCP Tools
  const mcpTools = mcpManager.getAllTools();
  const mcpToolsContext = mcpTools.length > 0
    ? "AVAILABLE MCP TOOLS (Use action 'MCP_TOOL'):\n" + JSON.stringify(mcpTools.map(t => ({
      name: t.name,
      description: t.description,
      source: t.source,
      schema: t.inputSchema
    })), null, 2)
    : "No MCP tools connected.";

  // Construct the system prompt with visual context
  const systemPrompt = `
You are OmniAgent, a browser automation assistant.
You will receive a list of interactive elements visible on the screen, each with a numeric ID (e.g., [42]).
Your goal is to interpret the user's natural language command and decide the next action.

CONVERSATION HISTORY:
${historyContext}

AGENT MEMORY (What you have saved so far):
${memoryContext}

CURRENT COMMAND: "${userPrompt}"

VISIBLE ELEMENTS (Visual Grounding):
${visualContext}

${mcpToolsContext}

GUIDELINES:
1. **Goal Achievement**: Break down the user's goal into logical steps (Research, Action, Verification).
2. **Efficiency**: Before clicking into details, check if the necessary information is visible on the current page (e.g., list views). If so, use "SAVE_MEMORY".
3. **Batch Saving**: If multiple relevant items are visible (e.g. in a search list), save them ALL in a ONE single "SAVE_MEMORY" action as an array. Do NOT loop one by one.
4. **Internal Memory**: usage of "SAVE_MEMORY" is automatic and internal. Do NOT announce it as a step to the user, just do it.
5. **Workflow**: Scan/Research -> Save Relevant Data -> Analyze/Decide -> Execute Action.
6. **Patience & Verification**:
   - **WAIT**: If an action (like clicking 'Send' or submitting a form) takes time to process, use the "WAIT" action. Do NOT immediately try again.
   - **Check**: improved: After "TYPE", use "WAIT" or check the next scan to ensure text appeared. If it didn't, try a different selector or move on.
   - **Reading (MANDATORY)**: When you read ANY content from the page to answer the user, you **MUST** start your thought/action with "Reading: [quote]". The user WANTS to see what you read.
   - **Planning**: If the user asks for a complex task (more than 3 steps) or explicitly asks for a plan, use "CREATE_PLAN" first.
   - **Submitting**: The "TYPE" action attempts to press ENTER. However, on complex sites like AI Studio, this might FAIL. **ALWAYS CHECK** in the next step:
     - IF the text is STILL in the input field -> **CLICK the 'Send/Run' button**.
     - IF the input is cleared -> The message was sent.
   - **Prevent Loops (CRITICAL)**: 
     - If you execute an action (e.g., CLICK [ID:1]) and the 'VISIBLE ELEMENTS' in the next turn are EXACTLY THE SAME, **DO NOT CLICK IT AGAIN**. The action likely failed or is a non-interactive label.
     - Instead, try a DIFFERENT element to re-assess.
     - **NEVER** click the same element 3 times in a row.
   - **Retries**: If an action fails or yields no change 2 times, stop and ask the user for help or try a significantly different approach (e.g. searching instead of clicking menu).
   - **Visual Verification**: Do NOT assume a click worked. Look at the new Visual Context. If the expected new elements (e.g. sub-menu items) are NOT there, consider the click a failure.
7. **Risk Assessment**:
   - **HIGH**: Buying (Checkout), Deleting data, Posting content, Auth/Login, Configuring Settings.
   - **MEDIUM**: Navigating to new domains, Clicking ads/unknown links.
   - **LOW**: Searching, Scrolling, Reading, Extracting, Tab Management.
   - If the user asks for "Intermediate Mode", only HIGH risks block for approval.
8. **Handling Ambiguity**:
   - If user input is nonsense (e.g. "asdf", "test"), random characters, or unclear: **DO NOT SEARCH**.
   - Instead, set action to "DONE" and ask for clarification in the message (e.g. "I'm not sure what you mean by 'asad'. Could you clarify?").
9. **Chat Titles**: If this is the START of a conversation, generate a short \`new_title\` (3-5 words) summarizing the goal.
10. **Language**: Respond using the same language the user is speaking, even in internal reasoning. 

RESPONSE FORMAT:
Strictly output a JSON object with this schema (no markdown, no code blocks):
{
  "thought": "Internal reasoning (e.g. 'I see 5 prices in the list, will save them all in one go')",
  "message": "Public message to user (e.g. 'Searching for...', or null)",
  "action": "CLICK" | "TYPE" | "SCROLL" | "NAVIGATE" | "OPEN_TAB" | "EXTRACT" | "DONE" | "SAVE_MEMORY" | "WAIT" | "SCREENSHOT" | "CREATE_PLAN" | "MCP_TOOL",
  "target_id": 12, // (integer) or null
  "value": "For SAVE_MEMORY: '{\"key\":\"variable_name\", \"value\": [item1, item2, ...]}'. For MCP_TOOL: '{\"tool\":\"tool_name\", \"source\":\"server_name\", \"args\":{...}}'. For others: text/url",
  "risk_score": "LOW" | "MEDIUM" | "HIGH",
  "new_title": "Conversation Title (or null if not new)"
}
`;

  try {
    let responseJson;

    switch (currentProvider) {
      case 'gemini':
        responseJson = await callGemini(systemPrompt);
        break;
      case 'openai':
        responseJson = await callOpenAI(systemPrompt);
        break;
      case 'anthropic':
        responseJson = await callAnthropic(systemPrompt);
        break;
      case 'ollama':
        responseJson = await callOllama(systemPrompt);
        break;
      default:
        throw new Error(`Unknown provider: ${currentProvider}`);
    }

    // Try parsing the response
    let cleanJson = responseJson;
    if (typeof responseJson === 'string') {
      cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
    }

    const parsedAction = typeof cleanJson === 'object' ? cleanJson : JSON.parse(cleanJson);

    // Internal Memory Handling
    if (parsedAction.action === 'SAVE_MEMORY') {
      try {
        const data = JSON.parse(parsedAction.value);
        const key = data.key || 'general';
        const value = data.value || data;

        if (!agentMemory[key]) agentMemory[key] = [];

        if (Array.isArray(value)) {
          value.forEach(item => agentMemory[key].push(item));
          parsedAction.message = `Batch saved ${value.length} items to memory:\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
        } else {
          agentMemory[key].push(value);
          parsedAction.message = `Saved to memory:\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
        }

      } catch (e) {
        console.error("Memory parsing error", e);
      }
    }

    sendResponse({ success: true, action: parsedAction });

  } catch (error) {
    console.error('LLM Error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// --- Providers ---

async function callGemini(prompt) {
  if (!apiKeys.gemini) throw new Error("Gemini API Key is missing.");
  const model = models.gemini || 'gemini-3-flash-preview';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKeys.gemini}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Gemini Error: ${txt}`);
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callOpenAI(prompt) {
  if (!apiKeys.openai) throw new Error("OpenAI API Key is missing.");
  const model = models.openai || 'gpt-4o';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKeys.openai}`
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'system', content: prompt }], // OpenAI works best if everything is system prompt or user? 
      // For agents, User Prompt usually works, but System is better for guidelines.
      // Let's use single User message effectively containing the prompt.
      // actually, system role is best for instructions.
      // But prompt has specific Context. Let's send as user? 
      // Let's stick to System for consistency.
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`OpenAI Error: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callAnthropic(prompt) {
  if (!apiKeys.anthropic) throw new Error("Anthropic API Key is missing.");
  const model = models.anthropic || 'claude-3-opus-20240229';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKeys.anthropic,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }] // Claude prefers User role
    })
  });

  if (!response.ok) throw new Error(`Anthropic Error: ${await response.text()}`);
  const data = await response.json();
  return data.content[0].text;
}

async function callOllama(prompt) {
  const model = models.ollama || 'llama3'; // User generic model input overrides specific ollamaModel if we align them
  // Warning: We had 'ollamaModel' separate variable before. Now we use models.ollama.
  // We synced this in sidepanel.js.

  const response = await fetch(ollamaEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      prompt: prompt,
      stream: false,
      format: "json"
    })
  });

  if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);
  const data = await response.json();
  return data.response;
}
