// content.js - DOM Scanner & Visual Grounding

if (!window.OMNI_AGENT_INITIALIZED) {
    window.OMNI_AGENT_INITIALIZED = true;

    let markedElements = {}; // Store references to elements by ID
    let overlayContainer = null;
    // let lastContext = ""; // Not strictly needed globally if we return it

    // --- Message Listener ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "GET_VISUAL_CONTEXT") {
            const context = scanAndTagPage();
            sendResponse({ context: context });
        } else if (request.type === "EXECUTE_ACTION") {
            executeAgentAction(request.action).then((result) => {
                sendResponse(result);
            });
            return true; // Keep channel open
        } else if (request.type === "CLEAR_OVERLAYS") {
            clearOverlays();
            sendResponse({ success: true });
        }
    });

    // --- Visual Grounding Logic ---

    function scanAndTagPage() {
        clearOverlays();
        markedElements = {};

        // Create container for overlays
        overlayContainer = document.createElement("div");
        overlayContainer.id = "omni-agent-overlay-container";
        overlayContainer.style.position = "absolute";
        overlayContainer.style.top = "0";
        overlayContainer.style.left = "0";
        overlayContainer.style.width = "100%";
        overlayContainer.style.height = "100%";
        overlayContainer.style.pointerEvents = "none"; // Let clicks pass through
        overlayContainer.style.zIndex = "2147483647"; // Max z-index
        document.body.appendChild(overlayContainer);

        // Selector for interactive elements AND meaningful text
        // We want to "see" prices and titles even if they aren't clickable
        const selectors = [
            "a[href]",
            "button",
            "input:not([type='hidden'])",
            "textarea",
            "select",
            "[role='button']",
            "[onclick]",
            "h1, h2, h3, h4",
            "p",
            "span",
            "li",
            "blockquote",
            "pre",
            "code",
            "div[class*='price']",
            "div[class*='valor']",
            "[contenteditable='true']",
            "[contenteditable]"
        ].join(",");

        const allElements = document.body.querySelectorAll(selectors);
        let idCounter = 1;
        let contextLines = [];

        allElements.forEach((el) => {
            if (!isVisible(el)) return;

            // Filter out generic text containers that are too large or empty
            if (['P', 'DIV', 'SPAN', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE'].includes(el.tagName) &&
                (!el.innerText || el.innerText.trim().length < 2 || el.innerText.length > 800)) {
                return;
            }

            // For prices, specifically look for currency patterns if it's a generic span/div
            if ((el.tagName === 'SPAN' || el.tagName === 'DIV') &&
                !el.innerText.match(/(\$|R\$)\s*\d/)) { // Updated regex to include '$'
                // Is it a header? keep it. Otherwise, if not interactive, skip.
                if (!['H1', 'H2', 'H3', 'H4', 'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) &&
                    !el.getAttribute('role') && !el.getAttribute('onclick')) {
                    return;
                }
            }

            const rect = el.getBoundingClientRect();
            const id = idCounter++;

            // Store reference
            markedElements[id] = el;

            // Create Visual Badge
            const badge = document.createElement("div");
            badge.textContent = id;
            badge.style.position = "absolute";
            // Adjust badge position to not block text
            badge.style.left = `${rect.left + window.scrollX - 10}px`;
            badge.style.top = `${rect.top + window.scrollY}px`;
            badge.style.background = "#ffeb3b";
            badge.style.color = "black";
            badge.style.border = "1px solid black";
            badge.style.fontSize = "10px"; // Smaller font
            badge.style.fontWeight = "bold";
            badge.style.padding = "1px 3px";
            badge.style.borderRadius = "3px";
            badge.style.zIndex = "2147483647";
            badge.style.opacity = "0.8"; // Slightly transparent

            overlayContainer.appendChild(badge);

            // Generate Text Context for LLM
            let label = getElementLabel(el);
            let tagName = el.tagName.toLowerCase();
            let type = el.getAttribute("type") || "";
            let safeHref = el.href ? el.href : ""; // ABSOLUTE URL

            // Add extra info for links
            let extra = "";
            if (tagName === 'a' && safeHref) extra = ` href="${safeHref}"`;
            if (tagName === 'input') extra = ` value="${el.value || ''}"`; // Changed 'element.value' to 'el.value'

            contextLines.push(`[ID: ${id}] <${tagName}${extra}> "${label}"`);
        });

        return contextLines.join("\n");
    }

    function clearOverlays() {
        if (overlayContainer) {
            overlayContainer.remove();
            overlayContainer = null;
        }
        markedElements = {};
    }

    // --- Helper Functions ---

    function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (getComputedStyle(el).visibility === 'hidden') return false;
        if (getComputedStyle(el).display === 'none') return false;

        // Check if inside viewport (optional, but good for token saving)
        // For now, we scan everything to allow scrolling to it
        return true;
    }

    function getElementLabel(el) {
        // Try various sources for a meaningful label
        const cleanText = (str) => str ? str.trim().replace(/\s+/g, ' ').slice(0, 800) : "";

        if (el.innerText && cleanText(el.innerText).length > 0) return cleanText(el.innerText);
        if (el.getAttribute("aria-label")) return cleanText(el.getAttribute("aria-label"));
        if (el.getAttribute("placeholder")) return cleanText(el.getAttribute("placeholder"));
        if (el.getAttribute("name")) return cleanText(el.getAttribute("name"));
        if (el.value) return cleanText(el.value);
        if (el.getAttribute("title")) return cleanText(el.getAttribute("title"));

        // Look for image alt text inside
        const img = el.querySelector('img');
        if (img && img.alt) return `Img: ${cleanText(img.alt)}`;

        // ContentEditable specific checks
        if (el.isContentEditable) {
            // For empty editors, try looking for a placeholder attribute or data-placeholder
            if (el.getAttribute("placeholder")) return cleanText(el.getAttribute("placeholder"));
            if (el.getAttribute("data-placeholder")) return cleanText(el.getAttribute("data-placeholder"));
            // ProseMirror often uses a p tag inside for text
            if (el.innerText && cleanText(el.innerText).length > 0) return cleanText(el.innerText);
            return "Rich Text Editor";
        }

        return "Unlabeled Element";
    }

    // --- Action Execution ---

    async function executeAgentAction(actionObj) {
        console.log("Executing Action:", actionObj);

        if (actionObj.action === "DONE") {
            clearOverlays();
            return { success: true, message: "Task completed." };
        }

        const targetId = actionObj.target_id;
        const element = markedElements[targetId];

        if (!element && actionObj.action !== "SCROLL" && actionObj.action !== "NAVIGATE") {
            return { success: false, error: `Element [ID: ${targetId}] not found.` };
        }

        try {
            switch (actionObj.action) {
                case "CLICK":
                    highlightInteraction(element);
                    element.click();
                    element.focus();
                    break;

                case "TYPE":
                    if (actionObj.value !== null) {
                        highlightInteraction(element);
                        element.click();
                        element.focus();

                        // Delay to ensure focus took hold
                        await new Promise(r => setTimeout(r, 50));

                        // 1. CLEAR existing content if needed (optional, or we append)
                        // For now we assume append or overwrite based on context. 
                        // But mostly user expects "Type X" to put X there.

                        // 2. Dispatch 'beforeinput' (Crucial for generic frameworks)
                        // Not all browsers support constructing InputEvent with 'data' perfectly in standard, but modern ones do.
                        try {
                            const beforeInput = new InputEvent('beforeinput', {
                                bubbles: true,
                                cancelable: true,
                                view: window,
                                inputType: 'insertText',
                                data: actionObj.value
                            });
                            element.dispatchEvent(beforeInput);
                        } catch (e) { /* Ignore old browsers */ }

                        // 3. ExecCommand (The Gold Standard for contenteditable)
                        const success = document.execCommand('insertText', false, actionObj.value);

                        // 4. Fallback: Direct Manipulation + InputEvent
                        if (!success) {
                            console.warn("execCommand failed. Using direct manipulation with InputEvent.");

                            if (element.isContentEditable) {
                                element.textContent = actionObj.value;
                            } else {
                                // Input/Textarea - set prototype value to bypass React tracker
                                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                                if (nativeInputValueSetter && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
                                    nativeInputValueSetter.call(element, actionObj.value);
                                } else {
                                    element.value = actionObj.value;
                                }
                            }
                        }

                        // 5. Dispatch 'input' event (The most important one for React/Angular)
                        // It MUST have the 'data' property for some listener types
                        try {
                            const inputEvt = new InputEvent('input', {
                                bubbles: true,
                                cancelable: true,
                                view: window,
                                inputType: 'insertText',
                                data: actionObj.value
                            });
                            element.dispatchEvent(inputEvt);
                        } catch (e) {
                            // Fallback for older Event
                            const evt = new Event('input', { bubbles: true, cancelable: true, view: window });
                            element.dispatchEvent(evt);
                        }

                        // 6. TextEvent (Legacy but used by some obscure editors)
                        try {
                            if (document.createEvent) {
                                const textEvent = document.createEvent('TextEvent');
                                textEvent.initTextEvent('textInput', true, true, window, actionObj.value, 0, "en-US");
                                element.dispatchEvent(textEvent);
                            }
                        } catch (e) { }

                        element.dispatchEvent(new Event('change', { bubbles: true }));

                        // Wait
                        await new Promise(r => setTimeout(r, 300));

                        // 7. Enter Key check (If we aren't clicking Send manually)
                        const enterEventOpts = {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13,
                            bubbles: true, cancelable: true, view: window
                        };
                        element.dispatchEvent(new KeyboardEvent('keydown', enterEventOpts));
                        element.dispatchEvent(new KeyboardEvent('keypress', enterEventOpts));
                        element.dispatchEvent(new KeyboardEvent('keyup', enterEventOpts));

                        // Final change to be sure
                        element.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    break;

                case "SCROLL":
                    window.scrollBy(0, 500); // Simple scroll down for now
                    break;

                case "NAVIGATE":
                    if (actionObj.value) {
                        window.location.href = actionObj.value;
                    }
                    break;

                case "EXTRACT":
                    return { success: true, data: document.body.innerText };

                default:
                    return { success: false, error: "Unknown action type" };
            }

            // Small delay to let page react
            await new Promise(r => setTimeout(r, 1000));
            return { success: true };

        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    function highlightInteraction(el) {
        // Visual feedback when agent acts
        const originalBorder = el.style.border;
        el.style.border = "3px solid #f44336"; // Red border
        setTimeout(() => {
            el.style.border = originalBorder;
        }, 1000);
    }
}
