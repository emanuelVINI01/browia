# Browia 🌌 — AI Browser Agent Extension

**Browia** is a next-generation browser extension (Manifest V3) that docks a side panel (Sidepanel) where an autonomous Artificial Intelligence agent operates the active tab of your browser in real time using the **Model Context Protocol (MCP)** and local tool calls.

The project was strictly built following the principles of **Single Responsibility (SRP)**, service-oriented architecture, and a premium visual experience based on the **Dracula/Gold** theme.

---

## 🚀 Key Features

1. **Autonomous and Multi-provider AI Agent**
   - Full support for the official **OpenAI** APIs (with predefined models like GPT-4o, o1, o3-mini, GPT-4), **Google Gemini** (supporting the 1.5, 2.0, 2.5, 3.1, and 3.5 families), and local or remote **Ollama** instances.
   - Automatic synchronization of models installed on the user's computer when connecting to Ollama.

2. **Smart MCP Execution Loop**
   - Autonomous execution of up to 12 iterations per user task.
   - Automatic recovery from physical interruptions and real-time state persistence flow to protect the session if the side panel of the extension closes in the middle of a process.

3. **Smart Tool Separation (Safe vs. Sensitive)**
   - **Safe Tools (Read/Inspection):** Purely diagnostic actions (such as `list_tabs`, `get_dom_tree`, `query_elements`, `extract_page_text`, `capture_screenshot`) are automatically executed in the background, accelerating autonomous navigation.
   - **Sensitive Tools (Mutation/Navigation):** Actions that modify states (such as `click_element`, `interact_element`, `type_text`, `navigate_tab`, `download_file`) are temporarily paused, triggering an interactive user approval panel.

4. **Dynamic CORS/403 Bypass on Ollama**
   - Background configuration of `chrome.declarativeNetRequest` to intercept local HTTP calls destined for Ollama endpoints (`/api/chat` and `/api/tags`) and remove the `Origin` header imposed by browser extensions. This eliminates the `403 Forbidden` error without forcing the user to adjust local LLM server environment variables.

5. **Visual Timeline and Collapsible Logs**
   - Clean conversation free of XML payloads and raw tags.
   - Automatic grouping of tool calls and responses into elegant collapsible log blocks with structured code formatting, DOM element summaries, Chrome tabs, and an embedded horizontal scrollbar for large JSON payloads.
   - Smart hiding of intermediate agent reasoning in expandable log sections to keep the chat history clean.

6. **Smart Input Textarea**
   - Auto-expanding text field (dynamically grows between `38px` and `140px`) that supports line breaks with **Shift+Enter** and default automatic submission with **Enter**.
   - Safety padding and alignment that prevents text from invading or sliding underneath the submit button.

7. **Multi-language Internationalization (i18n)**
   - Full native support for **8 languages**: Portuguese (`pt`), English (`en`), Spanish (`es`), French (`fr`), German (`de`), Italian (`it`), Japanese (`ja`), and Chinese (`zh`).
   - Automatic detection of Chrome browser language with safe fallback to English and manual selector in the settings interface.

---

## 🎨 Design System & Aesthetics (Dracula/Gold)

Browia's interface was designed under the dark-premium style of the **Dracula/Gold** theme:
* **Surfaces:** Deep obsidian-gray background (`#0f0b06`) combined with translucent glass borders (`rgba(255, 255, 255, 0.08)`).
* **Typography:** High-readability fonts `Sora` (headings) and `Inter` (body and controls) via Google Fonts.
* **Accent Colors:** Gold/Amber (`#d6a84f`) as the primary button and focus color, success neon-green (`#1ee28a`), and terracotta (`#d74e35`) for alerts and deletions.
* **Animations (Framer Motion):** Smooth, elastic entry transitions for messages (fade-in and 12px slide-up), staggered (cascade) transitions for plan steps, interactive scale effects on cards and buttons (`whileHover`, `whileTap`), and an active session sliding indicator by layout ID.

---

## 🛠️ Technologies Used

* **Framework:** React 19 + TypeScript 6
* **Styling:** Tailwind CSS v4 + Vanilla CSS
* **Build System:** Vite 8
* **Animations:** Framer Motion 12
* **Icons:** Lucide React
* **Browser:** Chrome Extension APIs (Manifest V3 - Service Worker, Offscreen Document, Scripting, and DeclarativeNetRequest)

---

## 📂 Codebase Organization

The project structure strictly separates business logic from visual components:

```text
src/
├── assets/                      # Static assets (like base system prompt)
├── config/                      # Preset configurations and supported AI models
├── components/                  # Pure visual rendering components (No business logic)
│   ├── ChatContainer.tsx        # Chat timeline, quick suggestions, and input textarea
│   ├── MessageItem.tsx          # User/AI message bubbles with code formatting
│   ├── SessionList.tsx          # Sidebar list of conversation history
│   ├── SettingsPanel.tsx        # API keys, language, and endpoints modal
│   ├── ExecutionApprovalPanel.ts# Structured approval card for sensitive actions
│   ├── ExecutionStepCard.tsx    # Collapsible log card for tool payloads
│   └── settings/                # Subsections and menus of the settings panel
├── hooks/                       # Custom React hooks (State control)
│   └── useAgentSession.ts       # Hook integrating sessions with the offscreen runtime
├── i18n/                        # Internationalization
│   ├── locales/                 # Translated dictionaries for the 8 supported languages
│   ├── index.tsx                # Translation provider and hook with fallback merging
│   └── types.ts                 # Type contracts for translation keys
├── services/                    # Logic and network integration layer (Services)
│   ├── agentLoop.ts             # State machine and autonomous MCP agent loop
│   ├── mcpEngine.ts             # XML parser and central command execution in the browser
│   ├── openaiService.ts         # OpenAI ChatCompletions API integration
│   ├── geminiService.ts         # Gemini Content Generation API integration
│   ├── ollamaService.ts         # Local Ollama integration and tag listing
│   ├── storageService.ts        # Persistent local storage management for sessions and keys
│   └── mcp/                     # Individual registration and source code of each MCP tool
├── App.tsx                      # Thin dashboard composing the extension UI
├── background.ts                # Service Worker in background (Initialization and DNR)
├── offscreen.ts                 # Offscreen runtime script to keep the agent active
├── main.tsx                     # React DOM initializer
└── globals.css                  # Mapping of Dracula/Gold theme with Tailwind v4
```

---

## ⚙️ Installation and Development

### Prerequisites
* **Node.js** (version 18 or higher recommended)
* **npm** or your favorite package manager

### 1. Clone and Install Dependencies
```bash
git clone https://github.com/[your-username]/browia.git
cd browia
npm install
```

### 2. Run in Development Environment
To test the interface in your local browser in real time:
```bash
npm run dev
```

### 3. Build the Extension for Production
Generates optimized files ready for MV3 distribution in the `dist/` folder:
```bash
npm run build
```
*(Note: The build script automatically generates and validates the Service Worker structure, offscreen document, and the `manifest.json` ecosystem).*

### 4. Load the Extension in Google Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. In the top right corner, enable **Developer Mode**.
3. In the top left corner, click **Load unpacked**.
4. Select the **`dist`** folder generated inside the project directory.
5. Pin the **Browia** icon to the toolbar and click it to open the side panel!

---

## 🔒 Security and Data Handling

* **API Keys:** Your OpenAI and Gemini credentials, as well as Ollama endpoints, are stored locally and encrypted within your browser's secure storage (`chrome.storage.local`). No personal data or credentials are sent to third-party servers.
* **Minimal Permissions:** The extension requests only essential permissions to operate (such as reading and writing to the active browser tab to execute MCP actions).

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
