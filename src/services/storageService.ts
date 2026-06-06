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
  provider: "openai" | "gemini" | "ollama";
  model: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  openaiApiKey: string;
  geminiApiKey: string;
  ollamaEndpoint: string;
  customSystemPrompt: string;
  language?: string;
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
  provider: "openai" | "gemini" | "ollama";
  model: string;
  responseText: string;
  plan: PendingExecutionPlan;
  toolCalls: PendingToolCall[];
  createdAt: string;
  updatedAt: string;
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
}

const STORAGE_KEYS = {
  SESSIONS: "browia_sessions",
  CURRENT_SESSION_ID: "browia_current_session_id",
  SETTINGS: "browia_settings",
  SELECTED_PROVIDER: "browia_selected_provider",
  SELECTED_MODEL: "browia_selected_model",
  PENDING_APPROVALS: "browia_pending_approvals",
  AGENT_RUNTIME_STATE: "browia_agent_runtime_state",
};

export class StorageService {
  static getSettings(): AppSettings {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const defaultSettings: AppSettings = {
      openaiApiKey: "",
      geminiApiKey: "",
      ollamaEndpoint: "http://localhost:11434",
      customSystemPrompt: "",
      language: "browser",
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

  static getSelectedProvider(): "openai" | "gemini" | "ollama" {
    const provider = localStorage.getItem(STORAGE_KEYS.SELECTED_PROVIDER);
    return (provider as "openai" | "gemini" | "ollama") || "openai";
  }

  static saveSelectedProvider(provider: "openai" | "gemini" | "ollama"): void {
    localStorage.setItem(STORAGE_KEYS.SELECTED_PROVIDER, provider);
  }

  static getSelectedModel(provider: "openai" | "gemini" | "ollama"): string {
    const key = `${STORAGE_KEYS.SELECTED_MODEL}_${provider}`;
    const model = localStorage.getItem(key);
    if (model) return model;

    // Default models
    if (provider === "openai") return "gpt-4o-mini";
    if (provider === "gemini") return "gemma-4-26b-a4b-it";
    return "llama3";
  }

  static saveSelectedModel(provider: "openai" | "gemini" | "ollama", model: string): void {
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

  static createSession(provider: "openai" | "gemini" | "ollama", model: string, titlePrefix: string = "Session"): Session {
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
}
