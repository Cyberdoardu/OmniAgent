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
    await loadSettings();

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
// const settingsModal = ... (Allocated at top)
document.getElementById('settings-btn').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    loadSettings(); // Refresh UI state
});
document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));

document.getElementById('save-settings').addEventListener('click', () => {
    const provider = document.getElementById('provider-select').value;
    const apiKey = document.getElementById('apiKey').value; // Corrected ID

    // Get Autonomy Mode
    const autonomy = document.querySelector('input[name="autonomy"]:checked').value;

    const settings = {
        provider: provider,
        apiKeys: { [provider]: apiKey },
        ollamaEndpoint: document.getElementById('ollama-endpoint').value,
        ollamaModel: document.getElementById('ollama-model').value,
        autonomyMode: autonomy
    };

    // Update local state immediately
    autonomyMode = autonomy;

    chrome.storage.sync.set(settings, () => {
        addMessageToUI('system', 'Settings saved.');
        settingsModal.classList.add('hidden');
    });
});

// Chat Input
// const userInput = ... (Allocated at top)
// const sendBtn = ...
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
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

function renderConversationList() {
    const list = document.getElementById('conversation-list');
    list.innerHTML = '';

    Object.keys(conversations).reverse().forEach(id => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        // Styling moved to CSS mostly, but setting active state here
        if (id === activeConversationId) item.classList.add('active');

        // Title Span
        const titleSpan = document.createElement('span');
        titleSpan.className = 'conv-title';
        titleSpan.innerText = conversations[id].title || "Untitled";

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
            const newTitle = prompt("Enter new title:", conversations[id].title);
            if (newTitle) {
                conversations[id].title = newTitle;
                saveConversations();
            }
        };

        // Delete Button
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.className = 'action-btn delete';
        deleteBtn.title = "Delete";
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm("Delete this conversation?")) {
                delete conversations[id];
                // If we deleted the active one, start a new one
                if (activeConversationId === id) {
                    startNewConversation();
                } else {
                    saveConversations();
                }
            }
        };

        actionsDiv.appendChild(renameBtn);
        actionsDiv.appendChild(deleteBtn);

        item.appendChild(titleSpan);
        item.appendChild(actionsDiv);

        // Select Conversation
        item.onclick = () => {
            loadConversation(id);
            document.getElementById('history-sidebar').classList.add('hidden');
            renderConversationList();
        };

        list.appendChild(item);
    });
}

// Approval Flow Updates
approveBtn.addEventListener('click', async () => {
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
            setTimeout(() => {
                processAgentStep();
            }, 3000);
        } catch (e) {
            if (e.message.includes("back/forward cache") || e.message.includes("closed")) {
                console.log("Action triggered navigation (cache/closed). Resume loop.");
                // Proceed as success
                const wasAction = pendingAction;
                pendingAction = null;
                pendingTabId = null;
                setTimeout(() => { processAgentStep(); }, 3000);
                return;
            }
            console.error(e);
            addMessage('bot', `Error executing action: ${e.message}.`);
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
    sendBtn.onclick = () => { stopRequested = true; };
    stopRequested = false;

    addMessage('user', text);

    // Start loop
    await processAgentStep(text);

    // Reset UI
    sendBtn.textContent = '➤';
    sendBtn.onclick = sendMessage;
}

async function processAgentStep(initialInstruction = null) {
    if (stopRequested) {
        addMessage('bot', "🛑 Stopped by user.");
        return;
    }

    addSystemMessage("Scanning page...");

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { addMessage('bot', "No active tab."); return; }

        // 1. Get Visual Context (Robust Retry)
        let scanResponse = null;

        // Check for restricted protocols where we CANNOT inject scripts
        const currentUrl = tab.url || "";
        const isRestricted = !currentUrl ||
            currentUrl.startsWith('chrome://') ||
            currentUrl.startsWith('chrome-extension://') ||
            currentUrl.startsWith('edge://') ||
            currentUrl.startsWith('about:');

        if (isRestricted) {
            console.log("On restricted page (or undefined URL), skipping scan.");
            scanResponse = {
                context: "SYSTEM: Current page is a browser system page (New Tab/Settings). visual elements are unavailable. If you obtain a search query, uses 'NAVIGATE' or 'OPEN_TAB' to go to a search engine like google.com."
            };
        } else {
            // Normal Page Loop
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    scanResponse = await chrome.tabs.sendMessage(tab.id, { type: "GET_VISUAL_CONTEXT" });
                    if (scanResponse) break;
                } catch (e) {
                    if (attempt === 0) {
                        console.log("Injecting script...");
                        try {
                            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
                            await new Promise(r => setTimeout(r, 800));
                        } catch (injectError) {
                            console.warn("Injection failed (likely restricted domain):", injectError);
                            break; // Stop retrying if injection fails (e.g. Chrome Web Store)
                        }
                    } else {
                        console.error("Scan failed after retry", e);
                    }
                }
            }
        }

        if (!scanResponse || !scanResponse.context) {
            // Only retry if it wasn't a restricted page that we purposely set a context for
            // If restricted and we set context, we pass through.
            if (!isRestricted) {
                // If navigating, we might fail. Just wait and retry loop?
                console.log("Context empty, maybe navigating...");
                if (!stopRequested) setTimeout(processAgentStep, 2000);
                return;
            } else if (!scanResponse) {
                // Fallback if somehow restricted logic failed
                scanResponse = { context: "SYSTEM: Page inaccessible." };
            }
        }

        // 2. Send to LLM
        addSystemMessage("Thinking...");
        const currentPrompt = initialInstruction || "Continue achieving the goal.";
        const response = await chrome.runtime.sendMessage({
            type: 'PROCESS_USER_COMMAND',
            payload: { userPrompt: currentPrompt, visualContext: scanResponse.context, history: conversationHistory }
        });

        if (response.success) {
            const action = response.action;

            // Update Title if it's the first turn
            if (action.new_title && conversations[activeConversationId].title === "New Conversation") {
                conversations[activeConversationId].title = action.new_title;
                saveConversations();
            }

            // Log Thought
            if (action.thought) addMessage('bot', `Thought: ${action.thought}`);
            if (action.message) addMessage('bot', action.message);


            // --- Risk Assessment Logic ---
            let shouldBlock = false;

            // Default to LOW if not provided, but unexpected ACTIONS are high
            const risk = action.risk_score || 'HIGH';

            if (autonomyMode === 'manual') shouldBlock = true;
            else if (autonomyMode === 'semi') {
                if (risk === 'HIGH') shouldBlock = true;
            }
            // 'auto' blocks nothing (except maybe sanity checks)

            // Overrides
            if (action.action === 'SAVE_MEMORY') shouldBlock = false;
            if (action.action === 'DONE') shouldBlock = false; // Just stop

            if (!shouldBlock) {
                // Sém-Auto or Auto execution
                if (action.action === 'DONE') {
                    addMessage('bot', "Task completed.");
                    return; // End Loop
                } else if (action.action === 'OPEN_TAB') {
                    addMessage('bot', `Opening new tab: ${action.value}`);
                    await chrome.tabs.create({ url: action.value, active: false });
                    setTimeout(processAgentStep, 3000);
                } else if (action.action === 'NAVIGATE') {
                    addMessage('bot', `Navigating to ${action.value}...`);
                    await chrome.tabs.update(tab.id, { url: action.value });
                    setTimeout(processAgentStep, 3000);
                } else if (action.action === 'SAVE_MEMORY') {
                    // internal
                    setTimeout(processAgentStep, 100);
                } else {
                    const desc = getActionDescription(action, scanResponse.context);
                    addMessage('bot', desc);

                    await executeActionOnTab(tab.id, action);
                    setTimeout(processAgentStep, 3000);
                }
            } else {
                // Request Approval
                pendingAction = action;
                pendingTabId = tab.id;
                showApprovalUI(action, risk); // Pass risk to UI
            }
        } else {
            addMessage('bot', `Error: ${response.error}`);
        }

    } catch (e) {
        console.error("Agent Step Error", e);
        addMessage('bot', `System Error: ${e.message}`);
    }
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

    // Parse Markdown for bot/user messages
    // System messages usually plain, but MD is safe
    bubble.innerHTML = parseMarkdown(text);

    div.appendChild(bubble);
    const container = document.getElementById('chat-container');
    if (container) {
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
}

function updateSettingsUI(provider) {
    if (provider === 'ollama') {
        apiKeySection.classList.add('hidden');
        ollamaSection.classList.remove('hidden');
    } else {
        apiKeySection.classList.remove('hidden');
        ollamaSection.classList.add('hidden');
    }
}

function loadSettings() {
    chrome.storage.sync.get(['provider', 'apiKeys', 'ollamaEndpoint', 'ollamaModel', 'autonomyMode'], (result) => {
        if (result.provider) {
            providerSelect.value = result.provider;
            updateSettingsUI(result.provider);
        }

        if (result.apiKeys && result.provider && result.provider !== 'ollama') {
            apiKeyInput.value = result.apiKeys[result.provider] || '';
        }

        if (result.ollamaEndpoint) ollamaEndpoint.value = result.ollamaEndpoint;
        if (result.ollamaModel) ollamaModel.value = result.ollamaModel;

        if (result.autonomyMode) {
            autonomyMode = result.autonomyMode;
            // Update UI Radios
            const radio = document.querySelector(`input[name="autonomy"][value="${autonomyMode}"]`);
            if (radio) radio.checked = true;
        }
    });
}

