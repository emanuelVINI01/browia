import { McpEngine, type ToolCall } from "./services/mcpEngine";
import type { AgentRuntimeState } from "./services/storageService";

function setupOllamaRules() {
  if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
    const rules = [
      {
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders" as const,
          requestHeaders: [
            {
              header: "Origin",
              operation: "remove" as const,
            },
          ],
        },
        condition: {
          urlFilter: "*/api/chat",
          resourceTypes: ["xmlhttprequest" as const],
        },
      },
      {
        id: 2,
        priority: 1,
        action: {
          type: "modifyHeaders" as const,
          requestHeaders: [
            {
              header: "Origin",
              operation: "remove" as const,
            },
          ],
        },
        condition: {
          urlFilter: "*/api/tags",
          resourceTypes: ["xmlhttprequest" as const],
        },
      },
    ];

    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1, 2],
      addRules: rules,
    }).catch((err) => {
      console.error("Erro ao registrar regras do DeclarativeNetRequest:", err);
    });
  }
}

// Register rules on install, startup and import load
if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(() => {
    setupOllamaRules();
  });
  chrome.runtime.onStartup.addListener(() => {
    setupOllamaRules();
  });
}
setupOllamaRules();


export interface McpRunMessage {
  type: "MCP_RUN";
  payload: {
    aiOutput: string;
  };
}

export interface McpExecuteMessage {
  type: "MCP_EXECUTE";
  payload: {
    call: ToolCall;
  };
}

export interface AgentStartMessage {
  type: "AGENT_START";
  payload: {
    provider: "openai" | "gemini" | "ollama";
    model: string;
    sessionId: string;
  };
}

export interface AgentSessionControlMessage {
  type: "AGENT_APPROVE" | "AGENT_REJECT" | "AGENT_CANCEL";
  payload: {
    sessionId: string;
  };
}

export interface AgentStatusMessage {
  type: "AGENT_STATUS";
}

export interface AgentStateChangedMessage {
  type: "AGENT_STATE_CHANGED";
  payload: AgentRuntimeState;
}

export type BackgroundMessage =
  | McpRunMessage
  | McpExecuteMessage
  | AgentStartMessage
  | AgentSessionControlMessage
  | AgentStatusMessage
  | AgentStateChangedMessage;

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  if ((message as { target?: string }).target === "offscreen") {
    return false;
  }

  void handleMessage(message)
    .then((result) => {
      sendResponse({ ok: true, result });
    })
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

async function handleMessage(message: BackgroundMessage): Promise<unknown> {
  if (message.type === "AGENT_STATE_CHANGED") {
    return { received: true };
  }

  if (message.type === "AGENT_START") {
    await ensureOffscreenDocument();
    return forwardToOffscreen({
      target: "offscreen",
      type: "OFFSCREEN_AGENT_START",
      payload: message.payload,
    });
  }

  if (message.type === "AGENT_APPROVE") {
    await ensureOffscreenDocument();
    return forwardToOffscreen({
      target: "offscreen",
      type: "OFFSCREEN_AGENT_APPROVE",
      payload: message.payload,
    });
  }

  if (message.type === "AGENT_REJECT") {
    await ensureOffscreenDocument();
    return forwardToOffscreen({
      target: "offscreen",
      type: "OFFSCREEN_AGENT_REJECT",
      payload: message.payload,
    });
  }

  if (message.type === "AGENT_CANCEL") {
    await ensureOffscreenDocument();
    return forwardToOffscreen({
      target: "offscreen",
      type: "OFFSCREEN_AGENT_CANCEL",
      payload: message.payload,
    });
  }

  if (message.type === "AGENT_STATUS") {
    await ensureOffscreenDocument();
    return forwardToOffscreen({
      target: "offscreen",
      type: "OFFSCREEN_AGENT_STATUS",
    });
  }

  if (message.type === "MCP_EXECUTE") {
    return McpEngine.executeTool(message.payload.call);
  }

  if (message.type === "MCP_RUN") {
    const calls = McpEngine.parseXmlCommands(message.payload.aiOutput);
    const results = [];

    for (const call of calls) {
      results.push({
        call,
        result: await McpEngine.executeTool(call),
      });
    }

    return results;
  }

  throw new Error("Unknown background message type.");
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["LOCAL_STORAGE", "WORKERS"],
    justification: "Mantem o loop autonomo do agente ativo quando o popup da extensao fecha.",
  });
}

async function forwardToOffscreen(message: Record<string, unknown>): Promise<unknown> {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    throw new Error(response?.error ?? "Erro ao comunicar com runtime offscreen.");
  }

  return response.result;
}
