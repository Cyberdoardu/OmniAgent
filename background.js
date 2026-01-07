// background.js - OmniAgent Service Worker

// --- Configuration & State ---
let currentProvider = 'gemini'; // Default
let apiKeys = {
  gemini: '',
  openai: '',
  anthropic: ''
};
let ollamaEndpoint = 'http://localhost:11434/api/generate';
let ollamaModel = 'llama3';

// Persistent Memory for specific tasks
let agentMemory = {};

// Enable opening side panel on icon click (Chrome 116+)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Could not set panel behavior:", error));
}

// Load settings on startup
chrome.storage.sync.get(['provider', 'apiKeys', 'ollamaEndpoint', 'ollamaModel'], (result) => {
  if (result.provider) currentProvider = result.provider;
  if (result.apiKeys) apiKeys = result.apiKeys;
  if (result.ollamaEndpoint) ollamaEndpoint = result.ollamaEndpoint;
  if (result.ollamaModel) ollamaModel = result.ollamaModel;
});

// Listen for updates in settings
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.provider) currentProvider = changes.provider.newValue;
    if (changes.apiKeys) apiKeys = changes.apiKeys.newValue;
    if (changes.ollamaEndpoint) ollamaEndpoint = changes.ollamaEndpoint.newValue;
    if (changes.ollamaModel) ollamaModel = changes.ollamaModel.newValue;
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
});

// --- Main Logic ---
async function handleUserCommand(payload, sendResponse) {
  const { userPrompt, visualContext, history } = payload;

  // Format history for context
  const historyContext = history.map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n');

  // Format Memory for context
  const memoryContext = JSON.stringify(agentMemory, null, 2);

  // Construct the system prompt with visual context
  // This is the "Visual Grounding" part fed into the LLM
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

GUIDELINES:
1. **Goal Achievement**: Break down the user's goal into logical steps (Research, Action, Verification).
2. **Efficiency**: Before clicking into details, check if the necessary information is visible on the current page (e.g., list views). If so, use "SAVE_MEMORY".
3. **Batch Saving**: If multiple relevant items are visible (e.g. in a search list), save them ALL in a ONE single "SAVE_MEMORY" action as an array. Do NOT loop one by one.
4. **Internal Memory**: usage of "SAVE_MEMORY" is automatic and internal. Do NOT announce it as a step to the user, just do it.
5. **Workflow**: Scan/Research -> Save Relevant Data -> Analyze/Decide -> Execute Action.
6. **Risk Assessment**:
   - **HIGH**: Buying (Checkout), Deleting data, Posting content, Auth/Login, Configuring Settings.
   - **MEDIUM**: Navigating to new domains, Clicking ads/unknown links.
   - **LOW**: Searching, Scrolling, Reading, Extracting, Tab Management.
   - If the user asks for "Intermediate Mode", only HIGH risks block for approval.
7. **Chat Titles**: If this is the START of a conversation, generate a short \`new_title\` (3-5 words) summarizing the goal.

RESPONSE FORMAT:
Strictly output a JSON object with this schema (no markdown, no code blocks):
{
  "thought": "Internal reasoning (e.g. 'I see 5 prices in the list, will save them all in one go')",
  "message": "Public message to user (e.g. 'Searching for...', or null)",
  "action": "CLICK" | "TYPE" | "SCROLL" | "NAVIGATE" | "OPEN_TAB" | "EXTRACT" | "DONE" | "SAVE_MEMORY",
  "target_id": 12, // (integer) or null
  "value": "For SAVE_MEMORY: '{\"key\":\"variable_name\", \"value\": [item1, item2, ...]}'. For others: text/url",
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

    // Try parsing the response if the LLM returned a string with code blocks
    let cleanJson = responseJson;
    if (typeof responseJson === 'string') {
      cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
    }

    const parsedAction = typeof cleanJson === 'object' ? cleanJson : JSON.parse(cleanJson);

    // Internal Memory Handling
    if (parsedAction.action === 'SAVE_MEMORY') {
      try {
        const data = JSON.parse(parsedAction.value);
        // Support simple key-value or complex object
        const key = data.key || 'general';
        const value = data.value || data;

        if (!agentMemory[key]) agentMemory[key] = [];

        // Handle Batch Saving (Array)
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

  // Using the requested preview model
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKeys.gemini}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" } // Force JSON mode
    })
  });

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch (e) {
      errorBody = "Could not read error body";
    }
    throw new Error(`Gemini API Error (${response.status}): ${errorBody}`);
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// Stub for OpenAI
async function callOpenAI(prompt) {
  if (!apiKeys.openai) throw new Error("OpenAI API Key is missing.");
  // Implementation would go here (v1/chat/completions)
  return JSON.stringify({ thought: "OpenAI not implemented yet", action: "DONE" }); // Placeholder
}

// Stub for Anthropic
async function callAnthropic(prompt) {
  if (!apiKeys.anthropic) throw new Error("Anthropic API Key is missing.");
  // Implementation would go here (v1/messages)
  return JSON.stringify({ thought: "Claude not implemented yet", action: "DONE" }); // Placeholder
}

// Local Ollama
async function callOllama(prompt) {
  const response = await fetch(ollamaEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: prompt,
      stream: false,
      format: "json" // Ensure Ollama outputs JSON
    })
  });

  if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);
  const data = await response.json();
  return data.response;
}
