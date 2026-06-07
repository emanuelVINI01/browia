import {
  AgentLoop,
  type AgentStepUpdate,
  type ToolCallState,
} from "./services/agentLoop";
import {
  StorageService,
  type AgentRuntimeState,
  type PendingApproval,
} from "./services/storageService";
import type { AiProvider } from "./config/aiModels";

type Provider = AiProvider;

function getContextInfo(): string {
  const hasTabs = typeof chrome !== "undefined" && typeof chrome.tabs !== "undefined";
  const hasScripting = typeof chrome !== "undefined" && typeof chrome.scripting !== "undefined";
  
  let context: string;
  if (typeof window !== "undefined") {
    if (window.location.pathname.includes("offscreen")) {
      context = "offscreen";
    } else {
      context = "sidepanel/popup";
    }
  } else {
    context = "background/service-worker";
  }
  
  return `Context: ${context}, chrome.tabs available: ${hasTabs}, chrome.scripting available: ${hasScripting}`;
}

console.log("[Browia Offscreen Startup]", getContextInfo());

interface OffscreenStartMessage {
  target: "offscreen";
  type: "OFFSCREEN_AGENT_START";
  payload: {
    provider: Provider;
    model: string;
    sessionId: string;
  };
}

interface OffscreenSessionMessage {
  target: "offscreen";
  type: "OFFSCREEN_AGENT_APPROVE" | "OFFSCREEN_AGENT_REJECT" | "OFFSCREEN_AGENT_CANCEL";
  payload: {
    sessionId: string;
  };
}

interface OffscreenStatusMessage {
  target: "offscreen";
  type: "OFFSCREEN_AGENT_STATUS";
}

type OffscreenMessage = OffscreenStartMessage | OffscreenSessionMessage | OffscreenStatusMessage;

let activeController: AbortController | null = null;
let activeSessionId: string | null = null;
let approvalResolver: ((approved: boolean) => void) | null = null;

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message.target !== "offscreen") {
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

async function handleMessage(message: OffscreenMessage): Promise<unknown> {
  if (message.type === "OFFSCREEN_AGENT_STATUS") {
    return StorageService.getAgentRuntimeState();
  }

  if (message.type === "OFFSCREEN_AGENT_START") {
    const runtime = StorageService.getAgentRuntimeState();
    const hasLiveRuntime = activeController && (runtime.status === "running" || runtime.status === "awaiting_approval");

    if (hasLiveRuntime) {
      return StorageService.getAgentRuntimeState();
    }

    if (activeController && runtime.status !== "awaiting_approval") {
      activeController = null;
      activeSessionId = null;
      approvalResolver = null;
    }

    void startAgent(message.payload.provider, message.payload.model, message.payload.sessionId);
    return StorageService.getAgentRuntimeState();
  }

  if (message.type === "OFFSCREEN_AGENT_APPROVE") {
    return approvePlan(message.payload.sessionId);
  }

  if (message.type === "OFFSCREEN_AGENT_REJECT") {
    return rejectPlan(message.payload.sessionId);
  }

  if (message.type === "OFFSCREEN_AGENT_CANCEL") {
    return cancelAgent(message.payload.sessionId);
  }

  throw new Error("Unknown offscreen message type.");
}

async function startAgent(provider: Provider, model: string, sessionId: string): Promise<void> {
  activeController = new AbortController();
  activeSessionId = sessionId;
  updateRuntime({
    sessionId,
    status: "running",
    message: "Iniciando agente no runtime em segundo plano...",
    toolCalls: [],
  });

  try {
    await AgentLoop.run(
      provider,
      model,
      sessionId,
      handleAgentUpdate,
      activeController.signal,
      requestApproval,
    );

    const pending = StorageService.getPendingApproval(sessionId);
    updateRuntime({
      sessionId,
      status: pending ? "awaiting_approval" : "completed",
      message: pending ? "Aguardando aprovação do plano..." : "Execução concluída.",
      toolCalls: [],
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Cancelled") {
      updateRuntime({
        sessionId,
        status: StorageService.getPendingApproval(sessionId) ? "awaiting_approval" : "cancelled",
        message: "Execução cancelada.",
        toolCalls: [],
      });
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendAssistantMessage(sessionId, `Erro no runtime do agente: ${errorMessage}`);
      updateRuntime({
        sessionId,
        status: "error",
        message: errorMessage,
        toolCalls: [],
      });
    }
  } finally {
    if (!StorageService.getPendingApproval(sessionId)) {
      activeController = null;
      activeSessionId = null;
      approvalResolver = null;
    }
  }
}

function handleAgentUpdate(update: AgentStepUpdate): void {
  const sessionId = update.pendingApproval?.sessionId ?? activeSessionId;

  if (!sessionId) {
    return;
  }

  if (update.type === "approval_required") {
    updateRuntime({
      sessionId,
      status: "awaiting_approval",
      message: update.message ?? "Aguardando aprovação do plano...",
      toolCalls: update.toolCalls ?? [],
    });
    return;
  }

  if (update.type === "executing_tools" || update.type === "tool_complete") {
    updateRuntime({
      sessionId,
      status: "running",
      message: update.message ?? "Executando ferramentas...",
      toolCalls: update.toolCalls ?? [],
    });
    return;
  }

  if (update.type === "final_answer") {
    updateRuntime({
      sessionId,
      status: "completed",
      message: "Resposta final recebida.",
      toolCalls: [],
    });
    return;
  }

  if (update.type === "error") {
    updateRuntime({
      sessionId,
      status: "error",
      message: update.message ?? "Erro no agente.",
      toolCalls: [],
    });
    return;
  }

  if (update.type === "ai_thinking") {
    updateRuntime({
      sessionId,
      status: "running",
      message: update.message ?? "A IA está pensando...",
      toolCalls: [],
    });
  }
}

function requestApproval(
  approval: PendingApproval,
  toolCalls: ToolCallState[],
): Promise<boolean> {
  updateRuntime({
    sessionId: approval.sessionId,
    status: "awaiting_approval",
    message: "Aguardando aprovação do plano...",
    toolCalls,
  });

  return new Promise((resolve) => {
    approvalResolver = resolve;
  });
}

async function approvePlan(sessionId: string): Promise<AgentRuntimeState> {
  if (approvalResolver) {
    approvalResolver(true);
    approvalResolver = null;
    updateRuntime({
      sessionId,
      status: "running",
      message: "Plano aprovado. Executando ferramentas...",
      toolCalls: [],
    });
    return StorageService.getAgentRuntimeState();
  }

  const pendingApproval = StorageService.getPendingApproval(sessionId);
  if (!pendingApproval) {
    return StorageService.getAgentRuntimeState();
  }

  void resumePendingApproval(pendingApproval);
  return StorageService.getAgentRuntimeState();
}

async function resumePendingApproval(pendingApproval: PendingApproval): Promise<void> {
  activeController = new AbortController();
  activeSessionId = pendingApproval.sessionId;
  updateRuntime({
    sessionId: pendingApproval.sessionId,
    status: "running",
    message: "Plano aprovado. Retomando execução...",
    toolCalls: [],
  });

  try {
    await AgentLoop.resumePendingApproval(
      pendingApproval,
      handleAgentUpdate,
      activeController.signal,
      requestApproval,
    );
    updateRuntime({
      sessionId: pendingApproval.sessionId,
      status: "completed",
      message: "Execução concluída.",
      toolCalls: [],
    });
  } catch (error: unknown) {
    updateRuntime({
      sessionId: pendingApproval.sessionId,
      status: error instanceof Error && error.message === "Cancelled" ? "cancelled" : "error",
      message: error instanceof Error ? error.message : String(error),
      toolCalls: [],
    });
  } finally {
    activeController = null;
    activeSessionId = null;
    approvalResolver = null;
  }
}

async function rejectPlan(sessionId: string): Promise<AgentRuntimeState> {
  if (approvalResolver) {
    approvalResolver(false);
    approvalResolver = null;
  } else {
    StorageService.clearPendingApproval(sessionId);
    appendAssistantMessage(sessionId, "Plano de execução negado. Nenhuma ferramenta foi executada.");
  }

  updateRuntime({
    sessionId,
    status: "cancelled",
    message: "Plano negado.",
    toolCalls: [],
  });
  activeController = null;
  activeSessionId = null;

  return StorageService.getAgentRuntimeState();
}

async function cancelAgent(sessionId: string): Promise<AgentRuntimeState> {
  approvalResolver?.(false);
  approvalResolver = null;
  StorageService.clearPendingApproval(sessionId);
  activeController?.abort();
  activeController = null;
  activeSessionId = null;
  updateRuntime({
    sessionId,
    status: "cancelled",
    message: "Execução cancelada.",
    toolCalls: [],
  });

  return StorageService.getAgentRuntimeState();
}

function updateRuntime(state: Omit<AgentRuntimeState, "updatedAt">): void {
  const previous = StorageService.getAgentRuntimeState();
  const sameSession = previous.sessionId === state.sessionId;
  const isFreshStart = state.status === "running" && state.message.includes("Iniciando agente");
  const toolCalls = state.toolCalls.length > 0 || !sameSession || isFreshStart
    ? state.toolCalls
    : previous.toolCalls;

  StorageService.saveAgentRuntimeState({
    ...state,
    toolCalls,
    budgetStats: state.budgetStats ?? (sameSession ? previous.budgetStats : undefined),
    updatedAt: new Date().toISOString(),
  });

  void chrome.runtime
    .sendMessage({
      type: "AGENT_STATE_CHANGED",
      payload: StorageService.getAgentRuntimeState(),
    })
    .catch(() => {
      // Popup may be closed; state is persisted in localStorage.
    });
}

function appendAssistantMessage(sessionId: string, content: string): void {
  const session = StorageService.getSession(sessionId);

  if (!session) {
    return;
  }

  session.messages.push({
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
  });
  StorageService.saveSession(session);
}
