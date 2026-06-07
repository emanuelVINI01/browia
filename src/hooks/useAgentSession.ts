import { useCallback, useEffect, useRef, useState } from "react";
import {
  StorageService,
  type AgentRuntimeState,
  type Message,
  type PendingApproval,
  type Session,
} from "../services/storageService";
import type { AgentExecutionPlan, ToolCallState } from "../services/agentLoop";
import { useI18n, getBrowserLanguage } from "../i18n";
import type { AiProvider } from "../config/aiModels";

export interface ApprovalRequestState {
  plan: AgentExecutionPlan;
  toolCalls: ToolCallState[];
  pendingApproval: PendingApproval;
}

type Provider = AiProvider;

export function useAgentSession() {
  const { t } = useI18n();
  const [provider, setProvider] = useState<Provider>(() => StorageService.getSelectedProvider());
  const [model, setModel] = useState(() => StorageService.getSelectedModel(StorageService.getSelectedProvider()));
  const [sessions, setSessions] = useState<Session[]>(() => ensureInitialSessions());
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => ensureCurrentSessionId());

  const runtimeState = StorageService.getAgentRuntimeState();
  const initialPendingApproval = StorageService.getPendingApproval(currentSessionId);

  const [isAgentRunning, setIsAgentRunning] = useState(() =>
    isActiveRuntimeForSession(runtimeState, currentSessionId) || Boolean(initialPendingApproval),
  );
  const [agentRunningStatus, setAgentRunningStatus] = useState(() =>
    initialPendingApproval ? t.status_awaiting_approval : runtimeState.message,
  );
  const [runningToolsState, setRunningToolsState] = useState<ToolCallState[]>(() =>
    isActiveRuntimeForSession(runtimeState, currentSessionId) ? runtimeState.toolCalls : [],
  );
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequestState | null>(() =>
    initialPendingApproval ? pendingToApprovalRequest(initialPendingApproval) : null,
  );
  const [budgetStats, setBudgetStats] = useState<AgentRuntimeState["budgetStats"]>(() => runtimeState.budgetStats);
  const [queuedInterventionCount, setQueuedInterventionCount] = useState(() =>
    StorageService.getPendingAgentInterventions(currentSessionId).length,
  );
  const lastLocalStartRef = useRef<{ sessionId: string; timestamp: number } | null>(null);

  const applyRuntimeState = useCallback((state: AgentRuntimeState) => {
    const activeSessionId = StorageService.getCurrentSessionId();

    if (state.sessionId !== activeSessionId) {
      return;
    }

    const localStart = lastLocalStartRef.current;
    if (
      localStart &&
      localStart.sessionId === activeSessionId &&
      Date.now() - localStart.timestamp < 8000 &&
      state.status === "idle"
    ) {
      return;
    }

    if (state.status !== "idle") {
      lastLocalStartRef.current = null;
    }

    const pendingApproval = StorageService.getPendingApproval(activeSessionId);
    setQueuedInterventionCount(StorageService.getPendingAgentInterventions(activeSessionId).length);

    if (pendingApproval) {
      setApprovalRequest(pendingToApprovalRequest(pendingApproval));
      setIsAgentRunning(true);
      setAgentRunningStatus(t.status_awaiting_approval);
      setRunningToolsState(state.toolCalls);
      return;
    }

    setApprovalRequest(null);
    setIsAgentRunning(state.status === "running" || state.status === "awaiting_approval");
    setAgentRunningStatus(state.message);
    setRunningToolsState(state.toolCalls);
    setBudgetStats(state.budgetStats);
  }, [t.status_awaiting_approval]);

  const syncSessionsState = useCallback(() => {
    const loadedSessions = StorageService.getSessions();
    setSessions(loadedSessions);

    let activeSessionId = StorageService.getCurrentSessionId();
    if (!activeSessionId && loadedSessions.length > 0) {
      activeSessionId = loadedSessions[0].id;
      StorageService.saveCurrentSessionId(activeSessionId);
    }

    if (!activeSessionId) {
      const activeProvider = StorageService.getSelectedProvider();
      const activeModel = StorageService.getSelectedModel(activeProvider);
      const newSession = StorageService.createSession(activeProvider, activeModel, t.session_default_title);
      setSessions([newSession]);
      setCurrentSessionId(newSession.id);
      setProvider(activeProvider);
      setModel(activeModel);
      applyRuntimeState(StorageService.getAgentRuntimeState());
      return;
    }

    setCurrentSessionId(activeSessionId);
    setQueuedInterventionCount(StorageService.getPendingAgentInterventions(activeSessionId).length);
    const session = StorageService.getSession(activeSessionId);
    if (session) {
      setProvider(session.provider);
      setModel(session.model);
    }
    applyRuntimeState(StorageService.getAgentRuntimeState());
  }, [applyRuntimeState, t.session_default_title]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyRuntimeState(StorageService.getAgentRuntimeState());

    void sendBackgroundMessage<AgentRuntimeState>({ type: "AGENT_STATUS" })
      .then((state) => {
        applyRuntimeState(state);
        syncSessionsState();
      })
      .catch(() => {
        applyRuntimeState(StorageService.getAgentRuntimeState());
      });

    const listener = (message: { type?: string; payload?: AgentRuntimeState }) => {
      if (message.type !== "AGENT_STATE_CHANGED" || !message.payload) {
        return;
      }

      applyRuntimeState(message.payload);
      syncSessionsState();
    };

    chrome.runtime?.onMessage?.addListener(listener);

    return () => {
      chrome.runtime?.onMessage?.removeListener(listener);
    };
  }, [applyRuntimeState, syncSessionsState]);

  useEffect(() => {
    if (!isAgentRunning && !approvalRequest) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void sendBackgroundMessage<AgentRuntimeState>({ type: "AGENT_STATUS" })
        .then((state) => {
          applyRuntimeState(state);
          syncSessionsState();
        })
        .catch(() => {
          applyRuntimeState(StorageService.getAgentRuntimeState());
          syncSessionsState();
        });
    }, 750);

    return () => window.clearInterval(intervalId);
  }, [applyRuntimeState, approvalRequest, isAgentRunning, syncSessionsState]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      syncSessionsState();
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [syncSessionsState]);

  const handleSelectSession = useCallback((id: string) => {
    const state = StorageService.getAgentRuntimeState();
    if (state.status === "running" && state.sessionId !== id) return;

    setCurrentSessionId(id);
    StorageService.saveCurrentSessionId(id);

    const session = StorageService.getSession(id);
    if (session) {
      setProvider(session.provider);
      setModel(session.model);
      StorageService.saveSelectedProvider(session.provider);
      StorageService.saveSelectedModel(session.provider, session.model);
    }

    applyRuntimeState(StorageService.getAgentRuntimeState());
  }, [applyRuntimeState]);

  const handleNewSession = useCallback((optProvider?: Provider, optModel?: string) => {
    if (isAgentRunning || approvalRequest) return;

    const activeProvider = optProvider || provider;
    const activeModel = optModel || model;
    const newSession = StorageService.createSession(activeProvider, activeModel, t.session_default_title);
    setSessions(StorageService.getSessions());
    setCurrentSessionId(newSession.id);
    applyRuntimeState(StorageService.getAgentRuntimeState());
  }, [approvalRequest, applyRuntimeState, isAgentRunning, model, provider, t.session_default_title]);

  const handleDeleteSession = useCallback((id: string) => {
    if (isAgentRunning || approvalRequest) return;
    StorageService.deleteSession(id);
    setQueuedInterventionCount(StorageService.getPendingAgentInterventions(currentSessionId).length);
    syncSessionsState();
  }, [approvalRequest, currentSessionId, isAgentRunning, syncSessionsState]);

  const handleCancelAgent = useCallback(() => {
    if (!currentSessionId) return;

    void sendBackgroundMessage<AgentRuntimeState>({
      type: "AGENT_CANCEL",
      payload: { sessionId: currentSessionId },
    }).then(applyRuntimeState);
  }, [applyRuntimeState, currentSessionId]);

  const handleApprovePlan = useCallback(() => {
    const sessionId = approvalRequest?.pendingApproval.sessionId ?? currentSessionId;
    if (!sessionId) return;

    setApprovalRequest(null);
    setIsAgentRunning(true);
    setAgentRunningStatus(t.status_plan_approved);

    void sendBackgroundMessage<AgentRuntimeState>({
      type: "AGENT_APPROVE",
      payload: { sessionId },
    }).then(applyRuntimeState);
  }, [applyRuntimeState, approvalRequest, currentSessionId, t.status_plan_approved]);

  const handleRejectPlan = useCallback(() => {
    const sessionId = approvalRequest?.pendingApproval.sessionId ?? currentSessionId;
    if (!sessionId) return;

    setApprovalRequest(null);
    setIsAgentRunning(false);
    setAgentRunningStatus(t.status_plan_rejected);

    void sendBackgroundMessage<AgentRuntimeState>({
      type: "AGENT_REJECT",
      payload: { sessionId },
    }).then((state) => {
      applyRuntimeState(state);
      syncSessionsState();
    });
  }, [applyRuntimeState, approvalRequest, currentSessionId, syncSessionsState, t.status_plan_rejected]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!currentSessionId || isAgentRunning || approvalRequest) return;

    try {
      const session = StorageService.getSession(currentSessionId);
      if (!session) return;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };

      StorageService.saveSession({
        ...session,
        messages: [...session.messages, userMessage],
      });

      setSessions(StorageService.getSessions());
      StorageService.saveAgentRuntimeState({
        sessionId: currentSessionId,
        status: "running",
        message: t.status_agent_started,
        toolCalls: [],
        updatedAt: new Date().toISOString(),
      });
      lastLocalStartRef.current = { sessionId: currentSessionId, timestamp: Date.now() };
      setIsAgentRunning(true);
      setAgentRunningStatus(t.status_agent_started);
      setRunningToolsState([]);
      setApprovalRequest(null);

      const state = await sendBackgroundMessage<AgentRuntimeState>({
        type: "AGENT_START",
        payload: {
          provider,
          model,
          sessionId: currentSessionId,
        },
      });
      applyRuntimeState(state);
      syncSessionsState();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedSession = StorageService.getSession(currentSessionId);

      if (failedSession) {
        StorageService.saveSession({
          ...failedSession,
          messages: [
            ...failedSession.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Erro ao iniciar o agente: ${errorMessage}`,
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      StorageService.saveAgentRuntimeState({
        sessionId: currentSessionId,
        status: "error",
        message: errorMessage,
        toolCalls: [],
        updatedAt: new Date().toISOString(),
      });
      setIsAgentRunning(false);
      setAgentRunningStatus(errorMessage);
      setRunningToolsState([]);
      syncSessionsState();
    }
  }, [applyRuntimeState, approvalRequest, currentSessionId, isAgentRunning, model, provider, syncSessionsState, t.status_agent_started]);

  const handleQueueAgentMessage = useCallback((text: string) => {
    if (!currentSessionId || !text.trim()) return;

    StorageService.queueAgentIntervention(currentSessionId, text.trim());
    setQueuedInterventionCount(StorageService.getPendingAgentInterventions(currentSessionId).length);
  }, [currentSessionId]);

  const handleProviderChange = useCallback((newProvider: Provider) => {
    setProvider(newProvider);
    if (currentSessionId) {
      const session = StorageService.getSession(currentSessionId);
      if (session) {
        StorageService.saveSession({ ...session, provider: newProvider });
      }
    }
  }, [currentSessionId]);

  const handleModelChange = useCallback((newModel: string) => {
    setModel(newModel);
    if (currentSessionId) {
      const session = StorageService.getSession(currentSessionId);
      if (session) {
        StorageService.saveSession({ ...session, model: newModel });
      }
    }
    setSessions(StorageService.getSessions());
  }, [currentSessionId]);

  return {
    provider,
    model,
    sessions,
    currentSessionId,
    isAgentRunning,
    agentRunningStatus,
    runningToolsState,
    approvalRequest,
    queuedInterventionCount,
    syncSessionsState,
    handleSelectSession,
    handleNewSession,
    handleDeleteSession,
    handleCancelAgent,
    handleApprovePlan,
    handleRejectPlan,
    handleSendMessage,
    handleQueueAgentMessage,
    handleProviderChange,
    handleModelChange,
    budgetStats,
  };
}

function ensureInitialSessions(): Session[] {
  const loaded = StorageService.getSessions();
  if (loaded.length > 0) return loaded;

  const activeProvider = StorageService.getSelectedProvider();
  const activeModel = StorageService.getSelectedModel(activeProvider);
  const lang = getBrowserLanguage();
  const titlePrefix = lang === "pt" ? "Sessão" : lang === "es" ? "Sesión" : lang === "de" ? "Sitzung" : lang === "it" ? "Sessione" : lang === "ja" ? "セッション" : lang === "zh" ? "会话" : "Session";
  const newSession = StorageService.createSession(activeProvider, activeModel, titlePrefix);
  return [newSession];
}

function ensureCurrentSessionId(): string | null {
  const loaded = StorageService.getSessions();
  let activeId = StorageService.getCurrentSessionId();
  if (!activeId && loaded.length > 0) {
    activeId = loaded[0].id;
    StorageService.saveCurrentSessionId(activeId);
  }
  return activeId;
}

function pendingToApprovalRequest(pendingApproval: PendingApproval): ApprovalRequestState {
  return {
    plan: pendingApproval.plan,
    pendingApproval,
    toolCalls: pendingApproval.toolCalls.map((call) => ({
      name: call.name,
      params: call.params,
      status: "pending",
    })),
  };
}

function isActiveRuntimeForSession(state: AgentRuntimeState, sessionId: string | null): boolean {
  return (
    Boolean(sessionId) &&
    state.sessionId === sessionId &&
    (state.status === "running" || state.status === "awaiting_approval")
  );
}

async function sendBackgroundMessage<TResult>(message: Record<string, unknown>): Promise<TResult> {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    const lang = getBrowserLanguage();
    const errorMsg = lang === "pt" ? "Erro ao comunicar com background." : "Error communicating with background.";
    throw new Error(response?.error ?? errorMsg);
  }

  return response.result as TResult;
}
