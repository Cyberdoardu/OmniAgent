// sidepanel.js

// --- State ---
let conversationHistory = [];
let conversations = {};
let activeConversationId = null;
let autonomyMode = 'manual';
let pendingAction = null;
let pendingTabId = null;
let isAutonomous = false;
let activeTabId = null;
let secrets = {}; // key -> value
let settingsConfig = {
    apiKeys: {}, // provider -> key
    models: {}   // provider -> modelName
};

// --- DOM Elements ---
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const saveSettingsBtn = document.getElementById('save-settings');
const closeSettingsBtn = document.getElementById('close-settings');
const providerSelect = document.getElementById('provider-select');
const apiKeyInput = document.getElementById('apiKey'); // Matches HTML ID 'apiKey'
const apiKeySection = document.getElementById('api-key-section');
const ollamaSection = document.getElementById('ollama-section');
const ollamaEndpoint = document.getElementById('ollama-endpoint');
const ollamaModel = document.getElementById('ollama-model');

const approvalContainer = document.getElementById('approval-container');
const proposedActionText = document.getElementById('proposed-action-text');
const approveBtn = document.getElementById('approve-btn');
const rejectBtn = document.getElementById('reject-btn');
// const autoModeCheckbox = document.getElementById('auto-mode-cb'); // Removed from HTML, replaced by radio


// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load Settings


    // 2. Load Conversations
    const stored = await chrome.storage.local.get(['conversations', 'activeConversationId']);
    conversations = stored.conversations || {};
    activeConversationId = stored.activeConversationId || generateId();

    // Ensure active conversation exists
    if (!conversations[activeConversationId]) {
        conversations[activeConversationId] = { title: "New Conversation", messages: [] };
    }

    renderConversationList();
    loadConversation(activeConversationId);
});

// --- Event Listeners ---
// Sidebar
document.getElementById('history-toggle').addEventListener('click', () => {
    document.getElementById('history-sidebar').classList.remove('hidden');
});
document.getElementById('close-history').addEventListener('click', () => {
    document.getElementById('history-sidebar').classList.add('hidden');
});
document.getElementById('new-chat-btn').addEventListener('click', () => {
    startNewConversation();
    document.getElementById('history-sidebar').classList.add('hidden');
});

// Settings
// Tab Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

function renderSecrets() {
    const list = document.getElementById('secrets-list');
    list.innerHTML = '';
    Object.keys(secrets).forEach(key => {
        const div = document.createElement('div');
        div.className = 'secret-item';
        div.innerHTML = `
            <div>
                <span class="secret-key">${key}</span>
                <span style="color:#666; font-size:0.8em; margin-left:10px;">******</span>
            </div>
            <button class="action-btn delete secret-del" data-key="${key}">🗑️</button>
        `;
        list.appendChild(div);
    });
    document.querySelectorAll('.secret-del').forEach(btn => {
        btn.onclick = (e) => {
            const k = e.target.dataset.key;
            if (confirm(`Delete secret ${k}?`)) {
                delete secrets[k];
                chrome.storage.sync.set({ secrets });
                renderSecrets();
            }
        };
    });
}

document.getElementById('add-secret-btn').addEventListener('click', () => {
    const keyInput = document.getElementById('secret-key');
    const valInput = document.getElementById('secret-value');
    const key = keyInput.value.trim();
    const val = valInput.value.trim();
    if (key && val) {
        secrets[key] = val;
        chrome.storage.sync.set({ secrets });
        keyInput.value = '';
        valInput.value = '';
        renderSecrets();
    }
});

document.getElementById('settings-btn').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    // Load Settings
    chrome.storage.sync.get(['apiKeys', 'models', 'provider', 'ollamaEndpoint', 'autonomyMode', 'customInstructions', 'secrets', 'notifications'], (result) => {
        // Store globally
        settingsConfig.apiKeys = result.apiKeys || {};
        settingsConfig.models = result.models || {};

        const currentProvider = result.provider || 'gemini';
        document.getElementById('provider-select').value = currentProvider;

        updateInputsForProvider(currentProvider);

        if (result.ollamaEndpoint) document.getElementById('ollama-endpoint').value = result.ollamaEndpoint;

        if (result.autonomyMode) {
            const radio = document.querySelector(`input[name="autonomy"][value="${result.autonomyMode}"]`);
            if (radio) radio.checked = true;
        }

        if (result.customInstructions) document.getElementById('custom-instructions').value = result.customInstructions;

        secrets = result.secrets || {};
        renderSecrets();

        const notify = result.notifications || { sound: false, popup: false };
        document.getElementById('notify-sound').checked = notify.sound;
        document.getElementById('notify-popup').checked = notify.popup;
    });
});

document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));

document.getElementById('save-settings').addEventListener('click', () => {
    const provider = document.getElementById('provider-select').value;
    const apiKey = document.getElementById('apiKey').value;
    const modelName = document.getElementById('model-name').value;
    const ollamaEnd = document.getElementById('ollama-endpoint').value;

    const autonomy = document.querySelector('input[name="autonomy"]:checked').value;
    const instructions = document.getElementById('custom-instructions').value;
    const notifications = {
        sound: document.getElementById('notify-sound').checked,
        popup: document.getElementById('notify-popup').checked
    };

    // ROBUST SAVE: Fetch latest first to avoid overwrites
    chrome.storage.sync.get(['apiKeys', 'models'], (current) => {
        const savedKeys = current.apiKeys || {};
        const savedModels = current.models || {};

        // Handle API Key: If masked, keep existing. If changed, update.
        let finalKey = apiKey;
        if (apiKey === '********') {
            finalKey = savedKeys[provider]; // Keep existing
        }

        // Update specific provider
        if (finalKey) savedKeys[provider] = finalKey;
        savedModels[provider] = modelName;

        // Update Global Config for immediate UI use
        settingsConfig.apiKeys = savedKeys;
        settingsConfig.models = savedModels;

        // Construct Settings Object
        const settings = {
            provider: provider,
            apiKeys: savedKeys,
            models: savedModels,
            ollamaEndpoint: ollamaEnd,
            autonomyMode: autonomy,
            customInstructions: instructions,
            notifications: notifications
        };

        autonomyMode = autonomy;
        chrome.storage.sync.set(settings, () => {
            addMessageToUI('system', 'Settings saved (Keys merged).');
            settingsModal.classList.add('hidden');
        });
    });
});

// Helper to update inputs based on provider selection
function updateInputsForProvider(provider) {
    if (!settingsConfig) return;

    const apiKeyInput = document.getElementById('apiKey');
    const modelInput = document.getElementById('model-name');

    // Update API Key Input (SECURE MASKING)
    if (settingsConfig.apiKeys && settingsConfig.apiKeys[provider]) {
        // Show mask if key exists. user must type new key to overwrite.
        apiKeyInput.value = '********';
        apiKeyInput.placeholder = 'Key saved';
    } else {
        apiKeyInput.value = '';
        apiKeyInput.placeholder = 'Enter API Key';
    }

    // Update Model Input
    if (settingsConfig.models && settingsConfig.models[provider]) {
        modelInput.value = settingsConfig.models[provider];
    } else {
        const defaults = {
            gemini: 'gemini-2.0-flash-exp',
            openai: 'gpt-4o',
            anthropic: 'claude-3-opus-20240229',
            ollama: 'llama3'
        };
        modelInput.value = defaults[provider] || '';
    }

    // Toggle Ollama Section
    if (provider === 'ollama') {
        document.getElementById('ollama-section').classList.remove('hidden');
        document.getElementById('api-key-section').classList.add('hidden');
    } else {
        document.getElementById('ollama-section').classList.add('hidden');
        document.getElementById('api-key-section').classList.remove('hidden');
    }
}

// Chat Input
// const userInput = ... (Allocated at top)
// const sendBtn = ...
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
// Provider Change Listener
document.getElementById('provider-select').addEventListener('change', (e) => {
    updateInputsForProvider(e.target.value);
});

// --- Helper Functions ---
function getActionDescription(action, contextString) {
    if (action.action === 'TYPE') {
        return `Typing "${action.value}"...`;
    }

    if (action.action === 'NAVIGATE') {
        return `Navigating to ${action.value}...`;
    }

    if (action.action === 'CLICK') {
        // Parse context to find element label
        // Format: [ID: 12] <tag> "Label"
        if (action.target_id && contextString) {
            const regex = new RegExp(`\\[ID: ${action.target_id}\\] <.*?> "(.*?)"`);
            const match = contextString.match(regex);
            if (match && match[1]) {
                return `Clicking "${match[1]}"...`;
            }
        }
        return `Clicking element [${action.target_id}]...`;
    }

    return `Executing ${action.action}...`;
}

function generateId() { return Math.random().toString(36).substr(2, 9); }
// ... (rest of helpers)

function loadConversation(id) {
    activeConversationId = id;
    chrome.storage.local.set({ activeConversationId });

    resetTokenCount(); // Reset counter

    const data = conversations[id];
    conversationHistory = data ? data.messages : [];

    // Clear Chat UI
    const chatContainer = document.getElementById('chat-container');
    chatContainer.innerHTML = ''; // Start fresh

    // Replay Messages
    conversationHistory.forEach(msg => {
        addMessageToUI(msg.role, msg.content);
    });
}

function startNewConversation() {
    const id = generateId();
    conversations[id] = { title: "New Conversation", messages: [] };
    saveConversations();
    loadConversation(id);
    renderConversationList();
}

function saveConversations() {
    if (conversations[activeConversationId]) {
        conversations[activeConversationId].messages = conversationHistory;
    }
    chrome.storage.local.set({ conversations });
    renderConversationList();
}

function renderConversationList(editingId = null) {
    const list = document.getElementById('conversation-list');
    list.innerHTML = '';

    Object.keys(conversations).reverse().forEach(id => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        // Styling moved to CSS mostly, but setting active state here
        if (id === activeConversationId) item.classList.add('active');

        // Title Span or Input
        if (id === editingId) {
            item.classList.add('editing');
            const input = document.createElement('input');
            input.type = 'text';
            input.value = conversations[id].title || "Untitled";
            input.className = 'conv-edit-input';

            // Save logic
            const saveTitle = (newTitle) => {
                conversations[id].title = newTitle.trim() || "Untitled";
                saveConversations();
                // Rerender called by saveConversations
            };

            input.onkeydown = (ev) => {
                if (ev.key === 'Enter') saveTitle(input.value);
                ev.stopPropagation();
            };
            input.onclick = (e) => e.stopPropagation();

            item.appendChild(input);

            // Auto focus
            setTimeout(() => input.focus(), 0);

            // Confirm Button
            const confirmBtn = document.createElement('button');
            confirmBtn.innerHTML = '✅';
            confirmBtn.className = 'action-btn confirm';
            confirmBtn.onclick = (e) => {
                e.stopPropagation();
                saveTitle(input.value);
            };
            item.appendChild(confirmBtn);

        } else {
            const titleSpan = document.createElement('span');
            titleSpan.className = 'conv-title';
            titleSpan.innerText = conversations[id].title || "Untitled";
            item.appendChild(titleSpan);


            // Buttons Container
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'conv-actions';

            // Rename Button
            const renameBtn = document.createElement('button');
            renameBtn.innerHTML = '✏️';
            renameBtn.className = 'action-btn';
            renameBtn.title = "Rename";
            renameBtn.onclick = (e) => {
                e.stopPropagation();
                renderConversationList(id); // Set editing mode
            };
            actionsDiv.appendChild(renameBtn);

            // Delete Button
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.className = 'action-btn delete';
            deleteBtn.title = "Delete";
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm("Delete this conversation?")) {
                    delete conversations[id];
                    if (activeConversationId === id) {
                        startNewConversation();
                    } else {
                        saveConversations();
                    }
                }
            };
            actionsDiv.appendChild(deleteBtn);
            item.appendChild(actionsDiv);

            item.onclick = () => {
                loadConversation(id);
                renderConversationList(); // Update active class
            };
        }


        list.appendChild(item);

        list.appendChild(item);
    });
}

// Approval Flow Updates
// Approval Flow Updates
approveBtn.addEventListener('click', async () => {
    if (window._onApprovalDecision) {
        approvalContainer.classList.add('hidden');
        addMessage('bot', "Action Approved.");
        window._onApprovalDecision('APPROVE');
        return;
    }

    if (pendingAction && pendingTabId) {
        approvalContainer.classList.add('hidden');
        addMessage('bot', "Action Approved. Executing...");

        try {
            if (pendingAction.action === 'OPEN_TAB') {
                addMessage('bot', `Opening new tab: ${pendingAction.value}`);
                await chrome.tabs.create({ url: pendingAction.value, active: false });
            } else if (pendingAction.action === 'SAVE_MEMORY') {
                addMessage('bot', `Strategy: Saved data to memory.`);
                // Background already saved it, so we just acknowledge
            } else {
                await executeActionOnTab(pendingTabId, pendingAction);
            }

            const wasAction = pendingAction;
            pendingAction = null;
            pendingTabId = null;

            // RESUME LOOP after manual approval
            // For legacy recursive calls (if any), this might still be needed, 
            // but in new loop, this block is likely bypassed if we use _onApprovalDecision.
            // Keeping for backward compatibility if we revert.
            setTimeout(() => {
                // processAgentStep(); // We don't call this in loop mode
            }, 3000);
        } catch (e) {
            // ...
        }
    }
});

async function executeActionOnTab(tabId, action) {
    try {
        await chrome.tabs.sendMessage(tabId, {
            type: "EXECUTE_ACTION",
            action: action
        });
        addSystemMessage("Action executed.");
    } catch (e) {
        throw new Error("Failed to send action to tab. Make sure the tab is still open."); // Re-throw to be caught by caller
    }
}

rejectBtn.addEventListener('click', () => {
    if (window._onApprovalDecision) {
        approvalContainer.classList.add('hidden');
        addMessage('bot', "Action Rejected by user.");
        window._onApprovalDecision('REJECT');
        return;
    }

    approvalContainer.classList.add('hidden');
    addMessage('bot', "Action Rejected by user.");
    pendingAction = null;
    pendingTabId = null;
});

// --- Core Logic ---

// --- Core Logic ---
let stopRequested = false;

async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    // UI Updates
    userInput.value = '';
    sendBtn.textContent = '⏹'; // Stop Icon
    sendBtn.onclick = () => {
        stopRequested = true;
        addMessage('bot', "🛑 Stopping...");
    };
    stopRequested = false;

    addMessage('user', text);

    // Start loop
    await runAgentLoop(text);

    // Reset UI
    sendBtn.textContent = '➤';
    sendBtn.onclick = sendMessage;
}

async function runAgentLoop(initialInstruction) {
    let currentInstruction = initialInstruction;
    let activeTabIdForLoop = null;
    let hasPerformedInteraction = false; // Track if we did actual browser work

    try {
        while (!stopRequested) {
            // Get Active Tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) { addMessage('bot', "No active tab."); break; }
            activeTabIdForLoop = tab.id;

            addSystemMessage("Scanning page...");

            // 1. Get Visual Context
            let scanResponse = null;
            const currentUrl = tab.url || "";
            const isRestricted = !currentUrl ||
                currentUrl.startsWith('chrome://') ||
                currentUrl.startsWith('chrome-extension://') ||
                currentUrl.startsWith('edge://') ||
                currentUrl.startsWith('about:');

            if (isRestricted) {
                // Restricted Page Handling
                scanResponse = {
                    context: "SYSTEM: Browser system page. Use 'NAVIGATE' to go to a valid URL."
                };
            } else {
                // Normal Page
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        scanResponse = await chrome.tabs.sendMessage(tab.id, { type: "GET_VISUAL_CONTEXT" });
                        if (scanResponse) break;
                    } catch (e) {
                        if (attempt === 0) {
                            // Inject content script if missing
                            try {
                                await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
                                await new Promise(r => setTimeout(r, 800));
                            } catch (injectError) {
                                break;
                            }
                        }
                    }
                }
            }

            // Fallback if scan failed
            if (!scanResponse || !scanResponse.context) {
                if (isRestricted) {
                    // Pass through restricted context
                } else {
                    // Retry loop? Or just fail?
                    // Let's wait a bit and retry the loop
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
            }

            // 2. Send to LLM
            addSystemMessage("Thinking...");
            let promptToUse = currentInstruction || "Continue achieving the goal.";
            currentInstruction = null; // Clear initial instruction after first use

            // INJECT SECRETS CONTEXT
            // Tell the LLM what secrets are available (Keys only, no values)
            let secretsContext = "";
            if (secrets && Object.keys(secrets).length > 0) {
                secretsContext = "\n\nAVAILABLE SECRETS (Use these placeholders, I will substitute real values during execution):\n" +
                    Object.keys(secrets).map(k => `- {{${k}}}`).join('\n');
            }

            // Combine contexts
            const fullVisualContext = (scanResponse.context || "") + secretsContext;

            const response = await chrome.runtime.sendMessage({
                type: 'PROCESS_USER_COMMAND',
                // Send raw history so LLM sees placeholders
                payload: {
                    userPrompt: promptToUse,
                    visualContext: fullVisualContext,
                    history: conversationHistory
                }
            });

            if (!response.success) {
                addMessage('bot', `Error: ${response.error}`);
                break;
            }

            const action = response.action;

            // Update Title
            // Check if conversations[activeConversationId] exists before title access
            if (conversations[activeConversationId] && action.new_title && conversations[activeConversationId].title === "New Conversation") {
                conversations[activeConversationId].title = action.new_title;
                saveConversations();
            }

            // Log Thought
            if (action.thought) addMessage('bot', `Thought: ${action.thought}`);

            if (action.message) {
                let displayMsg = action.message;
                if (secrets) {
                    Object.keys(secrets).forEach(key => {
                        // Reveal secret in chat interface (User request)
                        displayMsg = displayMsg.replace(new RegExp(`{{${key}}}`, 'g'), secrets[key]);
                    });
                }
                addMessage('bot', displayMsg);
            }

            // Risk Assessment & Approval
            let shouldBlock = false;
            const risk = action.risk_score || 'HIGH';
            if (autonomyMode === 'manual') shouldBlock = true;
            else if (autonomyMode === 'semi' && risk === 'HIGH') shouldBlock = true;

            // Overrides
            if (action.action === 'SAVE_MEMORY' || action.action === 'DONE' || action.action === 'WAIT') shouldBlock = false;

            if (shouldBlock) {
                pendingAction = action;
                pendingTabId = tab.id;
                showApprovalUI(action, risk);

                // Wait for user approval
                // We need to pause the loop here until approved or rejected
                // This 'while' loop blocks the async function, so we can await a promise that resolves on button click
                const userDecision = await waitForUserDecision();
                if (userDecision === 'REJECT') {
                    pendingAction = null;
                    pendingTabId = null;
                    // For simplicity in this loop, we just continue scanning and maybe LLM asks again or we give feedback.
                    // Ideally we push a "User rejected action" message to history.
                    addMessage('user', "I rejected that action.");
                    continue;
                }
                // If APPROVED, proceed to execute
                pendingAction = null;
                pendingTabId = null;
            }


            // Execution
            if (action.action === 'DONE') {
                if (hasPerformedInteraction) {
                    addMessage('bot', "Task completed.");
                }
                break; // Exit Loop
            } else if (action.action === 'OPEN_TAB') {
                hasPerformedInteraction = true;
                addMessage('bot', `Opening new tab: ${action.value}`);
                await chrome.tabs.create({ url: action.value, active: false });
                await new Promise(r => setTimeout(r, 3000));
            } else if (action.action === 'NAVIGATE') {
                hasPerformedInteraction = true;
                addMessage('bot', `Navigating to ${action.value}...`);
                await chrome.tabs.update(tab.id, { url: action.value });
                await new Promise(r => setTimeout(r, 3000));
            } else if (action.action === 'SAVE_MEMORY') {
                await new Promise(r => setTimeout(r, 100));
            } else if (action.action === 'WAIT') {
                addMessage('bot', `Waiting request: ${action.value || '5 seconds'}...`);
                const waitTime = parseInt(action.value) || 5000;
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                hasPerformedInteraction = true;
                const desc = getActionDescription(action, scanResponse.context);
                addMessage('bot', desc);

                // SECRET SUBSTITUTION
                if (action.value && typeof action.value === 'string' && action.value.includes('{{')) {
                    Object.keys(secrets).forEach(key => {
                        if (action.value.includes(`{{${key}}`)) {
                            action.value = action.value.replace(new RegExp(`{{${key}}}`, 'g'), secrets[key]);
                            // Don't log the substituted value!
                        }
                    });
                }

                await executeActionOnTab(tab.id, action);
                await new Promise(r => setTimeout(r, 3000));
            }

        }
    } catch (e) {
        console.error("Agent Loop Error", e);
        addMessage('bot', `System Error: ${e.message}`);
    } finally {
        // CLEANUP
        if (activeTabIdForLoop) {
            cleanupOverlays(activeTabIdForLoop);
        }
    }
}

function waitForUserDecision() {
    return new Promise(resolve => {
        // We override the button listeners temporarily or check a flag
        // A cleaner way relies on the existing event listeners triggering a resolve
        // Let's assign a one-time handler
        const onApprove = () => {
            cleanupListeners();
            resolve('APPROVE');
        };
        const onReject = () => {
            cleanupListeners();
            resolve('REJECT');
        };

        // Attach to existing elements (careful not to duplicate listeners permanently)
        // Actually, the existing listeners set global state. We can poll or modify the listeners.
        // Let's modify the listeners in 'init' to allow resolving this promise if it exists.

        // BETTER: The existing listeners execute logic immediately. 
        // We can just change the existing listeners to call a global callback if set.
        window._onApprovalDecision = (decision) => {
            resolve(decision);
            window._onApprovalDecision = null;
        };
    });
}
// Note: We need to update the existing Approve/Reject listeners to check window._onApprovalDecision!
// We will do that in a separate edit or assume the user clicks the buttons which we modified in the Plan? 
// The plan didn't explicitly say "rewrite approval logic", but "fix stop button". 
// To keep it simple, I will modify the standard Approval Listeners below this block to call _onApprovalDecision.

async function cleanupOverlays(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { type: "CLEAR_OVERLAYS" });
    } catch (e) { /* ignore */ }
}

async function executeActionOnTab(tabId, action) {
    const sendMessage = async (attempt = 1) => {
        try {
            await chrome.tabs.sendMessage(tabId, {
                type: "EXECUTE_ACTION",
                action: action
            });
            addSystemMessage("Action executed.");
        } catch (e) {
            if (attempt === 1) {
                console.log("Connection lost. Reinjecting content script...");
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['content.js']
                    });
                    await new Promise(r => setTimeout(r, 500)); // Wait for hydration
                    return sendMessage(2); // Retry once
                } catch (injectErr) {
                    console.error("Re-injection failed:", injectErr);
                }
            }

            // Allow specific navigation errors to pass as success (bfcache)
            if (e.message.includes("closed") || e.message.includes("back/forward")) {
                console.log("Navigation caused disconnect. Treating as success.");
                return;
            }

            throw new Error("Could not execute action on page. Tab might be closed or busy.");
        }
    };

    await sendMessage();
}

function showApprovalUI(action, risk = 'LOW') {
    let desc = `${action.action}`;
    if (action.target_id) desc += ` element [${action.target_id}]`;
    if (action.value) desc += ` input "${action.value}"`;
    if (risk === 'HIGH') desc = `⚠️ [HIGH RISK] ${desc}`;

    proposedActionText.textContent = desc;
    approvalContainer.classList.remove('hidden');

    // Optional: Style container based on risk
    if (risk === 'HIGH') approvalContainer.style.border = "2px solid red";
    else approvalContainer.style.border = "1px solid #444";
}

// --- UI Helpers & Persistence ---

// --- UI Helpers & Persistence ---

function addMessage(role, text) {
    // 1. Sync to Memory
    if (!conversations[activeConversationId]) {
        conversations[activeConversationId] = { title: "New Conversation", messages: [] };
    }

    // Check if duplicate (simple check)
    const lastMsg = conversationHistory[conversationHistory.length - 1];
    if (lastMsg && lastMsg.role === role && lastMsg.content === text) return;

    conversationHistory.push({ role, content: text });
    saveConversations();

    // 2. Sync to UI
    addMessageToUI(role, text);
}

function addSystemMessage(text) {
    // System messages are ephemeral usually, or we can save them as 'bot' logs?
    // For now, let's treat them as ephemeral logs in the UI, not saved in history to save space,
    // OR save them if they are useful. Let's not save them to avoid clutter.
    addMessageToUI('system', text);
}

function addMessageToUI(role, text) {
    const div = document.createElement('div');
    div.classList.add('message', role);
    const bubble = document.createElement('div');
    bubble.classList.add('bubble');

    // Collapsible Logic for Long Content
    let contentHtml = parseMarkdown(text);
    if (text.length > 500 && role !== 'system') {
        contentHtml = `
            <details class="collapsible-msg">
                <summary>Show Content (${text.length} chars)</summary>
                <div class="collapsible-content">${contentHtml}</div>
            </details>
        `;
    }

    bubble.innerHTML = contentHtml;

    // Token Usage (Approx 4 chars per token)
    if (role === 'bot' || role === 'user') {
        const tokens = Math.ceil(text.length / 4);

        // Update Total
        if (!window.totalTokenCount) window.totalTokenCount = 0;
        window.totalTokenCount += tokens;
        document.getElementById('token-footer').innerText = `Total Tokens: ${window.totalTokenCount}`;

        const meta = document.createElement('div');
        meta.style.fontSize = "0.7em";
        meta.style.color = "#aaa";
        meta.style.marginTop = "4px";
        meta.style.textAlign = "right";
        meta.innerText = `${tokens} tokens`;
        bubble.appendChild(meta);
    }

    div.appendChild(bubble);
    const container = document.getElementById('chat-container');
    if (container) {
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
}

// Reset tokens when loading conversation
function resetTokenCount() {
    window.totalTokenCount = 0;
    document.getElementById('token-footer').innerText = `Total Tokens: 0`;
}



