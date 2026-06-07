import type { AiProvider } from "../config/aiModels";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  internal?: boolean;
  toolCalls?: Array<{
    name: string;
    params: Record<string, string>;
    result?: string;
    error?: string;
    status: "pending" | "success" | "error";
  }>;
}

export interface Session {
  id: string;
  title: string;
  provider: AiProvider;
  model: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  openaiApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  ollamaEndpoint: string;
  customSystemPrompt: string;
  language?: string;
  autoApproveSensitive?: boolean;
  devModeEnabled?: boolean;
}

export interface PendingToolCall {
  name: string;
  params: Record<string, string>;
}

export interface PendingExecutionPlan {
  summary: string;
  steps: Array<{
    tool: string;
    purpose: string;
    params: Record<string, string>;
  }>;
}

export interface PendingApproval {
  id: string;
  sessionId: string;
  provider: AiProvider;
  model: string;
  responseText: string;
  plan: PendingExecutionPlan;
  toolCalls: PendingToolCall[];
  createdAt: string;
  updatedAt: string;
}

export interface PendingAgentIntervention {
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
}

export interface AgentRuntimeState {
  sessionId: string | null;
  status: "idle" | "running" | "awaiting_approval" | "completed" | "error" | "cancelled";
  message: string;
  toolCalls: Array<{
    name: string;
    params: Record<string, string>;
    result?: string;
    error?: string;
    status: "pending" | "success" | "error";
  }>;
  updatedAt: string;
  budgetStats?: {
    totalTokens: number;
    requestCount: number;
    rawSize: number;
    compressedSize: number;
    compressionRatio: number;
    lastCompressedTool: string;
    lastInputTokens?: number;
    lastOutputTokens?: number;
    lastTokensPerSecond?: number;
    callHistory?: Array<{
      sequence: number;
      kind: "provider" | "tool_result";
      provider?: AiProvider;
      model?: string;
      iteration?: number;
      toolName?: string;
      inputTokens?: number;
      outputTokens: number;
      totalTokens: number;
      tokensPerSecond?: number;
      estimated?: boolean;
      timestamp: string;
    }>;
  };
}

export interface AgentDebugEvent {
  id: string;
  sessionId: string;
  provider: AiProvider;
  model: string;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

const STORAGE_KEYS = {
  SESSIONS: "browia_sessions",
  CURRENT_SESSION_ID: "browia_current_session_id",
  SETTINGS: "browia_settings",
  SELECTED_PROVIDER: "browia_selected_provider",
  SELECTED_MODEL: "browia_selected_model",
  PENDING_APPROVALS: "browia_pending_approvals",
  PENDING_AGENT_INTERVENTIONS: "browia_pending_agent_interventions",
  AGENT_RUNTIME_STATE: "browia_agent_runtime_state",
  AGENT_DEBUG_EVENTS: "browia_agent_debug_events",
};

export class StorageService {
  static getSettings(): AppSettings {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const defaultSettings: AppSettings = {
      openaiApiKey: "",
      geminiApiKey: "",
      groqApiKey: "",
      ollamaEndpoint: "http://localhost:11434",
      customSystemPrompt: "",
      language: "browser",
      autoApproveSensitive: false,
      devModeEnabled: false,
    };

    if (!data) return defaultSettings;
    try {
      return { ...defaultSettings, ...JSON.parse(data) };
    } catch {
      return defaultSettings;
    }
  }

  static saveSettings(settings: AppSettings): void {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }

  static getSelectedProvider(): AiProvider {
    const provider = localStorage.getItem(STORAGE_KEYS.SELECTED_PROVIDER);
    if (provider === "openai" || provider === "gemini" || provider === "groq" || provider === "ollama") {
      return provider;
    }
    return "openai";
  }

  static saveSelectedProvider(provider: AiProvider): void {
    localStorage.setItem(STORAGE_KEYS.SELECTED_PROVIDER, provider);
  }

  static getSelectedModel(provider: AiProvider): string {
    const key = `${STORAGE_KEYS.SELECTED_MODEL}_${provider}`;
    const model = localStorage.getItem(key);
    if (model) return model;

    if (provider === "openai") return "gpt-4o-mini";
    if (provider === "gemini") return "gemma-4-26b-a4b-it";
    if (provider === "groq") return "meta-llama/llama-4-scout-17b-16e-instruct";
    return "llama3";
  }

  static saveSelectedModel(provider: AiProvider, model: string): void {
    const key = `${STORAGE_KEYS.SELECTED_MODEL}_${provider}`;
    localStorage.setItem(key, model);
  }

  static getSessions(): Session[] {
    const data = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  static saveSessions(sessions: Session[]): void {
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
  }

  static getSession(id: string): Session | null {
    const sessions = this.getSessions();
    return sessions.find((s) => s.id === id) || null;
  }

  static saveSession(session: Session): void {
    const sessions = this.getSessions();
    const index = sessions.findIndex((s) => s.id === session.id);
    const updatedSession = { ...session, updatedAt: new Date().toISOString() };

    if (index >= 0) {
      sessions[index] = updatedSession;
    } else {
      sessions.push(updatedSession);
    }
    this.saveSessions(sessions);
  }

  static createSession(provider: AiProvider, model: string, titlePrefix: string = "Session"): Session {
    const newSession: Session = {
      id: crypto.randomUUID(),
      title: `${titlePrefix} ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      provider,
      model,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.saveSession(newSession);
    this.saveCurrentSessionId(newSession.id);
    return newSession;
  }

  static deleteSession(id: string): void {
    const sessions = this.getSessions().filter((s) => s.id !== id);
    this.saveSessions(sessions);
    this.clearPendingApproval(id);
    if (this.getCurrentSessionId() === id) {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION_ID);
    }
  }

  static getCurrentSessionId(): string | null {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION_ID);
  }

  static saveCurrentSessionId(id: string | null): void {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION_ID);
    }
  }

  static getPendingApprovals(): Record<string, PendingApproval> {
    const data = localStorage.getItem(STORAGE_KEYS.PENDING_APPROVALS);

    if (!data) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(data);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      return parsed as Record<string, PendingApproval>;
    } catch {
      return {};
    }
  }

  static getPendingApproval(sessionId: string | null): PendingApproval | null {
    if (!sessionId) {
      return null;
    }

    return this.getPendingApprovals()[sessionId] ?? null;
  }

  static savePendingApproval(approval: PendingApproval): void {
    const approvals = this.getPendingApprovals();
    approvals[approval.sessionId] = {
      ...approval,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEYS.PENDING_APPROVALS, JSON.stringify(approvals));
  }

  static clearPendingApproval(sessionId: string | null): void {
    if (!sessionId) {
      return;
    }

    const approvals = this.getPendingApprovals();
    delete approvals[sessionId];
    localStorage.setItem(STORAGE_KEYS.PENDING_APPROVALS, JSON.stringify(approvals));
  }

  static getPendingAgentInterventions(sessionId: string | null): PendingAgentIntervention[] {
    if (!sessionId) {
      return [];
    }

    const data = localStorage.getItem(STORAGE_KEYS.PENDING_AGENT_INTERVENTIONS);
    if (!data) {
      return [];
    }

    try {
      const parsed = JSON.parse(data) as Record<string, PendingAgentIntervention[]>;
      return parsed[sessionId] ?? [];
    } catch {
      return [];
    }
  }

  static queueAgentIntervention(sessionId: string, content: string): PendingAgentIntervention {
    const data = localStorage.getItem(STORAGE_KEYS.PENDING_AGENT_INTERVENTIONS);
    let queued: Record<string, PendingAgentIntervention[]> = {};

    if (data) {
      try {
        queued = JSON.parse(data) as Record<string, PendingAgentIntervention[]>;
      } catch {
        queued = {};
      }
    }

    const intervention: PendingAgentIntervention = {
      id: crypto.randomUUID(),
      sessionId,
      content,
      createdAt: new Date().toISOString(),
    };

    queued[sessionId] = [...(queued[sessionId] ?? []), intervention].slice(-5);
    localStorage.setItem(STORAGE_KEYS.PENDING_AGENT_INTERVENTIONS, JSON.stringify(queued));
    return intervention;
  }

  static consumePendingAgentInterventions(sessionId: string): PendingAgentIntervention[] {
    const data = localStorage.getItem(STORAGE_KEYS.PENDING_AGENT_INTERVENTIONS);
    if (!data) {
      return [];
    }

    try {
      const queued = JSON.parse(data) as Record<string, PendingAgentIntervention[]>;
      const interventions = queued[sessionId] ?? [];
      delete queued[sessionId];
      localStorage.setItem(STORAGE_KEYS.PENDING_AGENT_INTERVENTIONS, JSON.stringify(queued));
      return interventions;
    } catch {
      return [];
    }
  }

  static getAgentRuntimeState(): AgentRuntimeState {
    const data = localStorage.getItem(STORAGE_KEYS.AGENT_RUNTIME_STATE);
    const defaultState: AgentRuntimeState = {
      sessionId: null,
      status: "idle",
      message: "",
      toolCalls: [],
      updatedAt: new Date().toISOString(),
    };

    if (!data) {
      return defaultState;
    }

    try {
      return { ...defaultState, ...JSON.parse(data) };
    } catch {
      return defaultState;
    }
  }

  static saveAgentRuntimeState(state: AgentRuntimeState): void {
    localStorage.setItem(
      STORAGE_KEYS.AGENT_RUNTIME_STATE,
      JSON.stringify({
        ...state,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  static clearAgentRuntimeState(): void {
    this.saveAgentRuntimeState({
      sessionId: null,
      status: "idle",
      message: "",
      toolCalls: [],
      updatedAt: new Date().toISOString(),
    });
  }

  static getAgentDebugEvents(sessionId?: string): AgentDebugEvent[] {
    const data = localStorage.getItem(STORAGE_KEYS.AGENT_DEBUG_EVENTS);

    if (!data) {
      return [];
    }

    try {
      const events = JSON.parse(data) as AgentDebugEvent[];
      return sessionId ? events.filter((event) => event.sessionId === sessionId) : events;
    } catch {
      return [];
    }
  }

  static appendAgentDebugEvent(event: Omit<AgentDebugEvent, "id" | "createdAt">): void {
    const events = this.getAgentDebugEvents();
    events.push({
      ...event,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEYS.AGENT_DEBUG_EVENTS, JSON.stringify(events.slice(-300)));
  }

  static clearAgentDebugEvents(sessionId?: string): void {
    if (!sessionId) {
      localStorage.removeItem(STORAGE_KEYS.AGENT_DEBUG_EVENTS);
      return;
    }

    const events = this.getAgentDebugEvents().filter((event) => event.sessionId !== sessionId);
    localStorage.setItem(STORAGE_KEYS.AGENT_DEBUG_EVENTS, JSON.stringify(events));
  }
}
