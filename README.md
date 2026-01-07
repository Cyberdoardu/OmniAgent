# 🤖 OmniAgent - Visual Browser AI

**OmniAgent** is an experimental open-source Chrome Extension that turns your browser into an autonomous agent. By combining Visual Grounding (analyzing the page structure) with Large Language Models (LLMs), it can understand web pages, click elements, type text, and navigate to help you complete tasks automatically.

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Status](https://img.shields.io/badge/status-experimental-orange.svg)

## 🚀 Key Features

*   **Visual Grounding**: The agent "sees" the page by analyzing interactive elements (buttons, inputs, prices) and their coordinates.
*   **Multi-Provider Support**: Works with **Google Gemini**, **OpenAI (GPT-4)**, **Anthropic (Claude)**, and local models via **Ollama**.
*   **Autonomy Modes**:
    *   **Manual**: Review and approve every single action.
    *   **Intermediate**: Only high-risk actions (purchases, logins) require approval.
    *   **Autonomous**: The agent runs freely (use with caution).
*   **Persistent Memory**: Remembers information across pages to perform comparisons or multi-step workflows.
*   **Chat Interface**: Interact with the agent naturally via a side panel chat.

## ⚠️ Disclaimer (Read Carefully)

**This tool is experimental technology.**

*   **Use at your own risk**: The authors are **not responsible** for any damages, financial losses, unintended purchases, data loss, or account bans resulting from the use of this software.
*   **Supervision Required**: AI models can hallucinate or misunderstand UI elements. Always monitor the agent's actions, especially in "Autonomous" or "Intermediate" modes.
*   **Safety**: Never use this tool on critical banking sessions or to handle highly sensitive unencrypted data without supervision.

## 📥 Installation

Since this is an experimental extension, you need to load it in Developer Mode:

1.  **Clone or Download** this repository.
    ```bash
    git clone https://github.com/Cyberdoardu/OmniAgent
    ```
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **"Developer mode"** (toggle in the top right).
4.  Click **"Load unpacked"**.
5.  Select the `omni-agent-extension` folder you just downloaded.
6.  The OmniAgent icon should appear in your toolbar.

## ⚙️ Configuration

1.  **Open the Side Panel**:
    *   Click the OmniAgent icon or use the browser's side panel menu to open the extension.
2.  **Access Settings**:
    *   Click the **gear icon (⚙️)** in the extension header.
3.  **Choose Your Provider**:
    *   **Google Gemini (Recommended for MVP)**: Select "Google Gemini" and paste your API Key.
    *   **Ollama (Local)**: Select "Ollama". Ensure Ollama is running (`ollama serve`). default endpoint is `http://localhost:11434/api/generate`.
4.  **Autonomy Settings**:
    *   **Fully Autonomous Mode**: Check this box if you want the agent to execute actions immediately.
    *   **Human-in-the-Loop (Unchecked)**: The agent will propose an action (e.g., "CLICK [12]"), and you must click "Approve" or "Reject".

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
