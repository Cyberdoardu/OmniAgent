
# OmniAgent - Your Autonomous AI Browser Mate

**OmniAgent** turns your browser into an autonomous agent capable of reasoning, planning, and executing complex tasks across the web. Built with privacy and power in mind, it integrates with state-of-the-art LLMs to automate your workflow.


## 🚀 Features

*   **Multi-Model Intelligence**: Seamlessly switch between **Google Gemini** (default), **OpenAI GPT-4**, **Anthropic Claude**, or local **Ollama** models.
*   **Autonomous Browsing**: Can click, type, scroll, and navigate to achieve your goals.
*   **Visual Grounding**: Sees what you see. Uses DOM snapshots to understand page context.
*   **Secure Secrets Management**: Store passwords and other values. The agent uses them without "seeing" the raw data.
*   **Human-in-the-Loop**:
    *   **Manual**: Approve every action.
    *   **Semi-Auto**: Runs safe actions automatically; asks for confirmation for high-risk ones (forms, payments).
    *   **Fully Autonomous**: Let it fly.
*   **Advanced Config**:
    *   **Custom Instructions**: Define your agent's persona.
    *   **Notifications**: Get sound/popup alerts when tasks are done.
    *   **MCP Support**: (Experimental/TO-DO) Connect to Model Context Protocol servers.

## ⚠️ Disclaimer (Read Carefully)

**This tool is experimental technology.**

*   **Use at your own risk**: The authors are **not responsible** for any damages, financial losses, unintended purchases, data loss, or account bans resulting from the use of this software.
*   **Supervision Required**: AI models can hallucinate or misunderstand UI elements. Always monitor the agent's actions, especially in "Autonomous" or "Intermediate" modes.
*   **Safety**: Never use this tool on critical banking sessions or to handle highly sensitive unencrypted data without supervision.

## �️ Installation

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/Cyberdoardu/OmniAgent.git
    cd OmniAgent
    ```
2.  **Load in Chrome**:
    *   Go to `chrome://extensions/`.
    *   Enable **Developer mode** (top right).
    *   Click **Load unpacked**.
    *   Select the `OmniAgent` folder.

## ⚙️ Configuration

1.  **Open the Side Panel**: Click the OmniAgent icon in the toolbar.
2.  **Go to Settings** (Gear Icon):
    *   **Main**: Select your LLM Provider and enter your API Key.
        *   Keys are stored in your browser's secure sync storage.
        *   Only you and the LLM provider see them.
    *   **Instructions**: Give the agent a role (e.g., "You act as a Senior React Developer").
    *   **Notifications**: Enable sound effects for task completion.
    *   **Secrets**: Add keys like `MY_PASSWORD`. Refer to them in chat as "Use my secret MY_PASSWORD".

## 🛡️ Security & Privacy

*   **No Middlemen**: Requests go directly from your browser to the LLM Provider APIs.
*   **Masked Secrets**: Stored secrets are injected *only* at the moment of execution. The LLM sees a placeholder (`{{SECRET}}`), not the value.
*   **Open Source**: Verify the code yourself.

## 🧩 Development

This project uses standard web technologies (HTML/CSS/JS) and the Chrome Extension Manifest V3.

*   `background.js`: Central logic, API handlers, and LLM communication.
*   `content.js`: Eyes and hands. Scans the DOM and executes actions on pages.
*   `sidepanel.js`: UI logic, state management, and user interaction.

## 🤝 Contributing

Contributions are welcome! Please open an issue or PR to suggest improvements.

## 📄 License

MIT License.

## 🎮 How to Use

1.  **Navigate directly** to a website (e.g., amazon.com, google.com).
2.  **Open the OmniAgent Side Panel**.
3.  **Type a command**, for example:
    *   *"Search for 'mechanical keyboards' and sort by price"*
    *   *"Go to Hacker News and click on the first story"*
    *   *"Fill this contact form with dummy data"*
4.  **Watch the magic**:
    *   The agent identifies elements with yellow tags (e.g., `[42]`).
    *   It thinks about the step and executes it (or asks for approval).

## ⚠️ Troubleshooting

*   **"No active tab found"**: Make sure you are focused on a webpage, not a browser settings page (like `chrome://...`).
*   **"Could not scan page"**: Try refreshing the web page. The content script needs to load on the page *after* the extension was installed/reloaded.
*   **Gemini Error (400/403)**: Verify your API Key and ensure you have enabled the Generative Language API in your Google Cloud Console.
