import {
  StorageService,
  type AgentDebugEvent,
  type AgentRuntimeState,
  type AppSettings,
  type PendingApproval,
  type Session,
} from "./storageService";

export type SessionExportFormat = "json" | "txt";

interface SessionExportPayload {
  exportedAt: string;
  formatVersion: 1;
  session: Session;
  runtimeState: AgentRuntimeState;
  pendingApproval: PendingApproval | null;
  debugEvents: AgentDebugEvent[];
  settings: SanitizedSettings;
}

interface SanitizedSettings {
  language?: string;
  autoApproveSensitive: boolean;
  devModeEnabled: boolean;
  ollamaEndpoint: string;
  hasOpenaiApiKey: boolean;
  hasGeminiApiKey: boolean;
  hasGroqApiKey: boolean;
  hasCustomSystemPrompt: boolean;
}

export class SessionExportService {
  static exportCurrentSession(sessionId: string, format: SessionExportFormat): void {
    const payload = this.buildPayload(sessionId);
    const filename = this.buildFilename(payload.session, format);
    const content = format === "json"
      ? JSON.stringify(payload, null, 2)
      : this.serializeAsText(payload);

    this.downloadTextFile(filename, content, format === "json" ? "application/json" : "text/plain");
  }

  private static buildPayload(sessionId: string): SessionExportPayload {
    const session = StorageService.getSession(sessionId);

    if (!session) {
      throw new Error(`Sessão não encontrada: ${sessionId}`);
    }

    return {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      session,
      runtimeState: StorageService.getAgentRuntimeState(),
      pendingApproval: StorageService.getPendingApproval(sessionId),
      debugEvents: StorageService.getAgentDebugEvents(sessionId),
      settings: this.sanitizeSettings(StorageService.getSettings()),
    };
  }

  private static sanitizeSettings(settings: AppSettings): SanitizedSettings {
    return {
      language: settings.language,
      autoApproveSensitive: Boolean(settings.autoApproveSensitive),
      devModeEnabled: Boolean(settings.devModeEnabled),
      ollamaEndpoint: settings.ollamaEndpoint,
      hasOpenaiApiKey: Boolean(settings.openaiApiKey),
      hasGeminiApiKey: Boolean(settings.geminiApiKey),
      hasGroqApiKey: Boolean(settings.groqApiKey),
      hasCustomSystemPrompt: Boolean(settings.customSystemPrompt),
    };
  }

  private static serializeAsText(payload: SessionExportPayload): string {
    const lines = [
      "Browia Session Export",
      `Exported at: ${payload.exportedAt}`,
      `Session: ${payload.session.title} (${payload.session.id})`,
      `Provider: ${payload.session.provider}`,
      `Model: ${payload.session.model}`,
      `Created at: ${payload.session.createdAt}`,
      `Updated at: ${payload.session.updatedAt}`,
      "",
      "Runtime State",
      JSON.stringify(payload.runtimeState, null, 2),
      "",
      "Pending Approval",
      payload.pendingApproval ? JSON.stringify(payload.pendingApproval, null, 2) : "none",
      "",
      "Messages",
      ...payload.session.messages.flatMap((message, index) => [
        "",
        `#${index + 1} ${message.timestamp} [${message.role}${message.internal ? " internal" : ""}]`,
        message.content,
      ]),
      "",
      "Debug Events",
      payload.debugEvents.length > 0 ? JSON.stringify(payload.debugEvents, null, 2) : "none",
      "",
      "Sanitized Settings",
      JSON.stringify(payload.settings, null, 2),
      "",
    ];

    return lines.join("\n");
  }

  private static buildFilename(session: Session, format: SessionExportFormat): string {
    const title = session.title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || session.id;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `browia-session-${title}-${timestamp}.${format}`;
  }

  private static downloadTextFile(filename: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
