import { StorageService, type AgentDebugEvent, type Message, type PendingApproval, type AgentRuntimeState } from "./storageService";
import { OpenaiService } from "./openaiService";
import { GeminiService } from "./geminiService";
import { GroqService } from "./groqService";
import { OllamaService } from "./ollamaService";
import { McpEngine, type ToolCall, normalizeToolArgs } from "./mcpEngine";
import type { AiProvider } from "../config/aiModels";
import { TokenBudgetManager } from "./tokenBudgetManager";
import { compressToolResultForModel } from "./toolResultCompressor";
import { resolveTabId } from "./mcp/utils";
import { SITE_RECIPES } from "./siteRecipes";

export interface PageSnapshotCache {
  tabId: number;
  url: string;
  capturedAt: number;
  tabInfo?: unknown;
  inventoryCompact?: unknown;
  domCandidates?: unknown;
  forms?: unknown;
}

class PageCache {
  private static cache: Record<number, PageSnapshotCache> = {};

  static get(tabId: number): PageSnapshotCache | undefined {
    return this.cache[tabId];
  }

  static set(tabId: number, data: Partial<PageSnapshotCache>) {
    const existing = this.cache[tabId] || { tabId, url: "", capturedAt: Date.now() };
    this.cache[tabId] = {
      ...existing,
      ...data,
      capturedAt: Date.now(),
    };
  }

  static invalidate(tabId: number) {
    delete this.cache[tabId];
  }

  static clear() {
    this.cache = {};
  }
}

export interface ToolCallState {
  name: string;
  params: Record<string, string>;
  result?: string;
  error?: string;
  status: "pending" | "success" | "error";
}

export interface AgentExecutionPlan {
  summary: string;
  steps: Array<{
    tool: string;
    purpose: string;
    params: Record<string, string>;
  }>;
}

export interface AgentStepUpdate {
  type:
    | "ai_thinking"
    | "approval_required"
    | "executing_tools"
    | "tool_complete"
    | "final_answer"
    | "error"
    | "cancelled";
  message?: string;
  toolCalls?: ToolCallState[];
  plan?: AgentExecutionPlan;
  pendingApproval?: PendingApproval;
  finalContent?: string;
}

export interface AgentStepResult {
  toolCall?: ToolCall;
  finalAnswer?: string;
}

export interface TaskCompletionCheck {
  completed: boolean;
  reason: string;
  nextAction?: AgentStepResult;
}

interface ExecutedStep {
  tool: string;
  params: Record<string, string>;
  result?: string;
  error?: string;
  status: "success" | "error";
}

export class AgentLoop {
  private static defaultSystemPrompt = "";

  static async loadDefaultSystemPrompt(): Promise<string> {
    if (this.defaultSystemPrompt) return this.defaultSystemPrompt;

    try {
      // Fetch prompt from extension assets
      const url = typeof chrome !== "undefined" && chrome.runtime?.getURL 
        ? chrome.runtime.getURL("assets/system_prompt.txt") 
        : "/assets/system_prompt.txt";
      
      const response = await fetch(url);
      if (!response.ok) throw new Error("Falha ao carregar system_prompt.txt");
      this.defaultSystemPrompt = await response.text();
      return this.defaultSystemPrompt;
    } catch (err) {
      console.error("Erro ao carregar prompt do asset, usando fallback embutido:", err);
      // Minimal fallback system prompt in Portuguese as requested
      return "Voce e um agente autonomo operando uma extensao Chrome por meio de MCP local. Controle o navegador emitindo chamadas XML: <tool_call name='...'><param name='...'>...</param></tool_call>";
    }
  }

  static isSafeTool(name: string): boolean {
    const safeTools = [
      "list_tabs",
      "get_dom_tree",
      "query_elements",
      "wait_for_element",
      "wait_for_page_ready",
      "wait_for_navigation_or_dom_change",
      "extract_page_text",
      "get_selection",
      "capture_screenshot",
      "get_page_resources",
      "list_cached_elements",
      "get_cached_element",
      "resolve_cached_element",
      "get_tab_info",
      "get_tab_zoom",
      "get_page_inventory",
      "get_links",
      "get_images",
      "get_forms",
      "get_meta_tags",
      "get_performance_entries",
      "page_storage_get",
      "cookies_get",
      "cookies_get_all",
      "bookmarks_search",
      "history_search",
      "read_clipboard",
      "final_answer",
      "think",
      "advise",
      "resolve_element",
      "summarize_current_page_compact",
    ];
    return safeTools.includes(name);
  }

  static async run(
    provider: AiProvider,
    model: string,
    sessionId: string,
    onUpdate: (update: AgentStepUpdate) => void,
    signal?: AbortSignal,
    requestApproval?: (approval: PendingApproval, toolCalls: ToolCallState[]) => Promise<boolean>
  ): Promise<string> {
    const settings = window.localStorage.getItem("browia_settings");
    const parsedSettings = settings ? JSON.parse(settings) : {};
    
    const openaiApiKey = parsedSettings.openaiApiKey || "";
    const geminiApiKey = parsedSettings.geminiApiKey || "";
    const groqApiKey = parsedSettings.groqApiKey || "";
    const ollamaEndpoint = parsedSettings.ollamaEndpoint || "http://localhost:11434";
    const customPrompt = parsedSettings.customSystemPrompt || "";

    const systemPrompt = customPrompt || (await this.loadDefaultSystemPrompt());
    
    const session = StorageService.getSession(sessionId);
    if (!session) {
      throw new Error(`Sessão não encontrada: ${sessionId}`);
    }

    // Initialize TokenBudgetManager (Parte 8)
    const budgetManager = new TokenBudgetManager(provider);
    const maxIterations = 12; // safety limit

    for (let iter = 0; iter < maxIterations; iter++) {
      if (signal?.aborted) {
        onUpdate({ type: "cancelled", message: "Execução cancelada pelo usuário." });
        throw new Error("Cancelled");
      }

      // Enforce budget limits
      const budgetCheck = budgetManager.isBudgetExceeded();
      if (budgetCheck.exceeded) {
        const budgetError = budgetCheck.reason || "Orçamento de tokens ou chamadas excedido para a tarefa.";
        onUpdate({ type: "error", message: budgetError });
        throw new Error(budgetError);
      }

      // Reload session to get current messages
      const currentSession = StorageService.getSession(sessionId);
      if (!currentSession) {
        throw new Error(`Sessão não encontrada: ${sessionId}`);
      }
      const originalUserRequest = this.getOriginalUserRequest(currentSession.messages);
      const executedStepsAtIterationStart = this.extractExecutedSteps(currentSession.messages);

      // Extract current tab info from executed steps if available
      const lastTabInfo = [...executedStepsAtIterationStart].reverse().find(s => s.tool === "get_tab_info" && s.status === "success" && s.result);
      let activeTabUrl = "";
      let activeTabTitle = "";
      if (lastTabInfo?.result) {
        try {
          const parsed = JSON.parse(lastTabInfo.result);
          if (parsed && typeof parsed === "object") {
            activeTabUrl = parsed.url || "";
            activeTabTitle = parsed.title || "";
          }
        } catch {
          // ignore
        }
      }

      const stats = budgetManager.getStats();
      onUpdate({ type: "ai_thinking", message: `A IA está pensando (passo ${iter + 1})...` });

      // Build compact model context (Parte 14)
      const compactHistory = this.buildAgentModelContext(
        originalUserRequest,
        executedStepsAtIterationStart,
        this.getLastToolResponseXml(currentSession.messages),
        activeTabUrl,
        activeTabTitle,
        stats
      );

      let responseText: string;
      let responseRes: { text: string; inputTokens?: number; outputTokens?: number; tokensPerSecond?: number };
      try {
        responseRes = await this.sendProviderMessage(
          provider,
          model,
          systemPrompt,
          compactHistory, // Compact context (no bloated DOM/inventory histories)
          { openaiApiKey, geminiApiKey, groqApiKey, ollamaEndpoint },
          {
            onGroqRateLimitRetry: (message, data) => {
              onUpdate({ type: "ai_thinking", message });
              this.logDebug({
                sessionId,
                provider,
                model,
                phase: "groq_rate_limit_retry",
                message,
                data,
              });
            },
            onGeminiRateLimitRetry: (message, data) => {
              onUpdate({ type: "ai_thinking", message });
              this.logDebug({
                sessionId,
                provider,
                model,
                phase: "gemini_rate_limit_retry",
                message,
                data,
              });
            },
          },
          signal
        );
        responseText = responseRes.text;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        onUpdate({ type: "error", message: `Erro na chamada de IA: ${errMsg}` });
        throw err;
      }

      // Record input and output tokens
      console.log(`[Browia API Tokens - Main Loop] Iteration: ${iter + 1}, Provider: ${provider}, Model: ${model}, Input: ${responseRes.inputTokens ?? 0}, Output: ${responseRes.outputTokens ?? 0}, Total: ${(responseRes.inputTokens ?? 0) + (responseRes.outputTokens ?? 0)}, Speed: ${responseRes.tokensPerSecond ?? 0} tok/s`);
      const promptForEstimation = `${systemPrompt}\n\n${JSON.stringify(compactHistory)}`;
      const callTokens = budgetManager.recordCall(promptForEstimation, responseText, responseRes.inputTokens, responseRes.outputTokens);

      // Save token usage details to budgetStats
      const currentStats = budgetManager.getStats();
      const providerCallEntry = {
        sequence: currentStats.requestCount,
        kind: "provider" as const,
        provider,
        model,
        iteration: iter + 1,
        inputTokens: callTokens.inputTokens,
        outputTokens: callTokens.outputTokens,
        totalTokens: callTokens.inputTokens + callTokens.outputTokens,
        tokensPerSecond: responseRes.tokensPerSecond,
        estimated: responseRes.inputTokens === undefined || responseRes.outputTokens === undefined,
        timestamp: new Date().toISOString(),
      };
      this.updateRuntimeBudgetStats(sessionId, currentStats, {
        lastInputTokens: callTokens.inputTokens,
        lastOutputTokens: callTokens.outputTokens,
        lastTokensPerSecond: responseRes.tokensPerSecond,
      }, providerCallEntry);
      this.logDebug({
        sessionId,
        provider,
        model,
        phase: "provider_token_usage",
        message: `Consumo de tokens da chamada ${currentStats.requestCount}.`,
        data: providerCallEntry,
      });

      // Check if response contains tool calls
      let toolCalls = this.normalizeModelToolCalls(McpEngine.parseXmlCommands(responseText));
      
      // If final_answer is present but called as a tool call, clean up
      const finalAnswerCall = toolCalls.find((call) => call.name === "final_answer");

      this.logDebug({
        sessionId,
        provider,
        model,
        phase: "model_response",
        message: toolCalls.length > 0 ? "Modelo emitiu XML MCP." : "Modelo respondeu sem XML MCP.",
        data: {
          iteration: iter + 1,
          toolCalls: toolCalls.map((call) => call.name),
          responsePreview: this.truncateForPrompt(responseText, 1200),
        },
      });

      if (finalAnswerCall && toolCalls.every((call) => call.name === "final_answer")) {
        const finalContent = this.extractFinalAnswer(finalAnswerCall);
        const completion = await this.evaluateTaskCompletion({
          originalUserRequest,
          responseText: finalContent,
          executedSteps: executedStepsAtIterationStart,
        });

        if (!completion.completed) {
          onUpdate({
            type: "ai_thinking",
            message: "Resposta final prematura; continuando execução...",
          });
          this.appendInternalContinuationPrompt(
            sessionId,
            originalUserRequest,
            executedStepsAtIterationStart,
            completion.reason,
            finalContent,
          );
          continue;
        }

        this.appendFinalAssistantMessage(sessionId, finalContent);
        onUpdate({ type: "final_answer", finalContent });
        return finalContent;
      }

      if (finalAnswerCall) {
        toolCalls = toolCalls.filter((call) => call.name !== "final_answer");
      }

      const hasTabContext = executedStepsAtIterationStart.some((step) => step.tool === "get_tab_info" && step.status === "success");
      const triesMutationWithoutTabContext = !hasTabContext
        && !toolCalls.some((call) => call.name === "get_tab_info")
        && toolCalls.some((call) => this.isMutatingTool(call.name));

      if (triesMutationWithoutTabContext) {
        const bootstrapTool: ToolCall = { name: "get_tab_info", params: {} };
        this.logDebug({
          sessionId,
          provider,
          model,
          phase: "unsafe_action_bootstrap",
          message: "Modelo tentou agir sem contexto de aba; executando get_tab_info antes.",
          data: {
            iteration: iter + 1,
            blockedTools: toolCalls.map((call) => call.name),
          },
        });

        const bootstrapResponse = `<execution_plan>Obter contexto da aba antes de qualquer interação.</execution_plan>\n${this.renderToolCallXml(bootstrapTool)}`;
        const bootstrapStates: ToolCallState[] = [{ name: bootstrapTool.name, params: {}, status: "pending" }];
        const bootstrapSteps = await this.executeApprovedToolCalls(
          sessionId,
          bootstrapResponse,
          [bootstrapTool],
          bootstrapStates,
          onUpdate,
          budgetManager,
          activeTabUrl,
          signal,
          { recordAssistantMessage: true },
        );
        this.appendInternalContinuationPrompt(
          sessionId,
          originalUserRequest,
          [...executedStepsAtIterationStart, ...bootstrapSteps],
          "O modelo tentou executar uma ação mutante sem primeiro identificar a aba. O runtime executou get_tab_info e bloqueou a ação prematura.",
          responseText,
        );
        continue;
      }

      const suggestedRecoveryTool = this.getSuggestedRecoveryTool(executedStepsAtIterationStart);
      const ignoresSuggestedRecovery = suggestedRecoveryTool
        && !toolCalls.some((call) => call.name === suggestedRecoveryTool.name)
        && toolCalls.some((call) => this.isMutatingTool(call.name));

      if (suggestedRecoveryTool && ignoresSuggestedRecovery) {
        this.logDebug({
          sessionId,
          provider,
          model,
          phase: "suggested_tool_recovery",
          message: `Executando ${suggestedRecoveryTool.name} sugerida por falha anterior antes de nova ação.`,
          data: {
            iteration: iter + 1,
            suggestedRecoveryTool,
            blockedTools: toolCalls.map((call) => call.name),
          },
        });

        const recoveryResponse = `<execution_plan>Buscar o elemento correto sugerido pela falha anterior antes de tentar nova interação.</execution_plan>\n${this.renderToolCallXml(suggestedRecoveryTool)}`;
        const recoveryStates: ToolCallState[] = [{
          name: suggestedRecoveryTool.name,
          params: suggestedRecoveryTool.params,
          status: "pending",
        }];
        const recoverySteps = await this.executeApprovedToolCalls(
          sessionId,
          recoveryResponse,
          [suggestedRecoveryTool],
          recoveryStates,
          onUpdate,
          budgetManager,
          activeTabUrl,
          signal,
          { recordAssistantMessage: true },
        );
        this.appendInternalContinuationPrompt(
          sessionId,
          originalUserRequest,
          [...executedStepsAtIterationStart, ...recoverySteps],
          `A ferramenta anterior sugeriu ${suggestedRecoveryTool.name}; o runtime executou essa busca antes de permitir nova interação.`,
          responseText,
        );
        continue;
      }

      if (toolCalls.length === 0) {
        const cleanedResponse = responseText.trim();

        if (cleanedResponse) {
          this.appendFinalAssistantMessage(sessionId, cleanedResponse);
          onUpdate({ type: "final_answer", finalContent: cleanedResponse });
          return cleanedResponse;
        }

        onUpdate({
          type: "ai_thinking",
          message: "A tarefa depende do navegador; solicitando próxima tool MCP...",
        });

        this.appendInternalContinuationPrompt(
          sessionId,
          originalUserRequest,
          executedStepsAtIterationStart,
          "O modelo respondeu vazio; precisa responder ao usuario ou emitir a proxima ferramenta MCP.",
          cleanedResponse,
        );
        continue;
      }

      // Prepare UI states for tool calls
      const toolStates: ToolCallState[] = toolCalls.map((tc) => ({
        name: tc.name,
        params: tc.params,
        status: "pending",
      }));

      // Split safe tools from sensitive action tools
      const executedSafeTools: ToolCall[] = [];
      const pendingSensitiveTools: ToolCall[] = [];
      let foundSensitive = false;

      for (const tc of toolCalls) {
        if (foundSensitive) {
          pendingSensitiveTools.push(tc);
        } else if (this.isSafeTool(tc.name)) {
          executedSafeTools.push(tc);
        } else {
          foundSensitive = true;
          pendingSensitiveTools.push(tc);
        }
      }

      // Execute safe tools first if any
      const executedStepsThisIteration: ExecutedStep[] = [];

      if (executedSafeTools.length > 0) {
        const safeStates = toolStates.slice(0, executedSafeTools.length);
        
        const safeSteps = await this.executeApprovedToolCalls(
          sessionId,
          responseText,
          executedSafeTools,
          safeStates,
          onUpdate,
          budgetManager,
          activeTabUrl,
          signal,
          { recordAssistantMessage: true },
        );
        executedStepsThisIteration.push(...safeSteps);

        // Feed back executed tool states to main list
        for (let i = 0; i < executedSafeTools.length; i++) {
          toolStates[i] = safeStates[i];
        }
      }

      // If we have sensitive tools remaining, ask for approval
      if (pendingSensitiveTools.length > 0) {
        const sensitiveStates = toolStates.slice(executedSafeTools.length);
        const plan = this.buildExecutionPlan(responseText, pendingSensitiveTools);

        const settings = StorageService.getSettings();
        if (settings.autoApproveSensitive) {
          onUpdate({
            type: "executing_tools",
            message: "Executando ferramentas sensíveis (Aprovação Automática ativa)...",
            toolCalls: toolStates,
          });
        } else if (requestApproval) {
          const pendingApproval = this.createPendingApproval({
            sessionId,
            provider,
            model,
            responseText,
            plan,
            toolCalls: pendingSensitiveTools,
          });
          StorageService.savePendingApproval(pendingApproval);

          onUpdate({
            type: "approval_required",
            message: "Aguardando aprovação para prosseguir com ações sensíveis...",
            plan,
            pendingApproval,
            toolCalls: toolStates,
          });

          const approved = await requestApproval(pendingApproval, toolStates);

          if (signal?.aborted) {
            onUpdate({ type: "cancelled", message: "Execução cancelada pelo usuário." });
            throw new Error("Cancelled");
          }

          if (!approved) {
            StorageService.clearPendingApproval(sessionId);
            const deniedMessage = "Plano de execução negado. Nenhuma ferramenta sensível foi executada.";
            const deniedSession = StorageService.getSession(sessionId);
            if (deniedSession) {
              deniedSession.messages.push({
                id: crypto.randomUUID(),
                role: "assistant",
                content: deniedMessage,
                timestamp: new Date().toISOString(),
              });
              StorageService.saveSession(deniedSession);
            }

            onUpdate({ type: "cancelled", message: deniedMessage });
            return deniedMessage;
          }

          StorageService.clearPendingApproval(sessionId);
        }

        // Execute approved sensitive tools
        const sensitiveSteps = await this.executeApprovedToolCalls(
          sessionId,
          responseText,
          pendingSensitiveTools,
          sensitiveStates,
          onUpdate,
          budgetManager,
          activeTabUrl,
          signal,
          { recordAssistantMessage: executedSafeTools.length === 0 },
        );
        executedStepsThisIteration.push(...sensitiveSteps);

        // Update main toolStates with results
        for (let i = 0; i < pendingSensitiveTools.length; i++) {
          toolStates[executedSafeTools.length + i] = sensitiveStates[i];
        }
      }

      if (executedStepsThisIteration.length > 0) {
        const latestSession = StorageService.getSession(sessionId);
        const allExecutedSteps = latestSession
          ? this.extractExecutedSteps(latestSession.messages)
          : [...executedStepsAtIterationStart, ...executedStepsThisIteration];
        const lastStep = executedStepsThisIteration[executedStepsThisIteration.length - 1];
        const completion = await this.evaluateTaskCompletion({
          originalUserRequest,
          executedSteps: allExecutedSteps,
          lastToolResult: lastStep,
        });

        onUpdate({
          type: "ai_thinking",
          message: completion.completed ? "Validando resposta final..." : "Avaliando próximo passo...",
        });

        this.appendInternalContinuationPrompt(
          sessionId,
          originalUserRequest,
          allExecutedSteps,
          completion.reason,
        );
      }
    }

    const maxError = "Limite de iterações do agente atingido sem resposta final.";
    onUpdate({ type: "error", message: maxError });
    throw new Error(maxError);
  }

  static async resumePendingApproval(
    approval: PendingApproval,
    onUpdate: (update: AgentStepUpdate) => void,
    signal?: AbortSignal,
    requestApproval?: (approval: PendingApproval, toolCalls: ToolCallState[]) => Promise<boolean>,
  ): Promise<string> {
    const toolStates = approval.toolCalls.map((call) => ({
      name: call.name,
      params: call.params,
      status: "pending" as const,
    }));

    StorageService.clearPendingApproval(approval.sessionId);

    const budgetManager = new TokenBudgetManager(approval.provider);

    const executedSteps = await this.executeApprovedToolCalls(
      approval.sessionId,
      approval.responseText,
      approval.toolCalls,
      toolStates,
      onUpdate,
      budgetManager,
      "",
      signal,
      { recordAssistantMessage: true },
    );

    const session = StorageService.getSession(approval.sessionId);
    if (session) {
      const allExecutedSteps = this.extractExecutedSteps(session.messages);
      const originalUserRequest = this.getOriginalUserRequest(session.messages);
      const lastStep = executedSteps[executedSteps.length - 1];
      const completion = await this.evaluateTaskCompletion({
        originalUserRequest,
        executedSteps: allExecutedSteps,
        lastToolResult: lastStep,
      });

      this.appendInternalContinuationPrompt(
        approval.sessionId,
        originalUserRequest,
        allExecutedSteps,
        completion.reason,
      );
    }

    return this.run(
      approval.provider,
      approval.model,
      approval.sessionId,
      onUpdate,
      signal,
      requestApproval,
    );
  }

  // Simple mock responses for browser-based testing when not running inside an extension
  private static async mockExecuteTool(call: { name: string; params: Record<string, string> }): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 1000));
    
    if (call.name === "list_tabs") {
      return [
        { id: 1, url: "https://github.com", title: "GitHub" },
        { id: 2, url: "https://google.com", title: "Google" },
        { id: 3, url: "https://ollama.com", title: "Ollama" }
      ];
    }
    if (call.name === "get_dom_tree") {
      return {
        url: "https://google.com",
        title: "Google",
        root: {
          vortexId: 1,
          tag: "body",
          text: "",
          visible: true,
          attributes: {},
          rect: { x: 0, y: 0, w: 1280, h: 720 },
          children: [
            {
              vortexId: 2,
              tag: "input",
              text: "",
              visible: true,
              attributes: { type: "text", name: "q", placeholder: "Pesquisar" },
              rect: { x: 400, y: 300, w: 480, h: 40 },
              children: []
            },
            {
              vortexId: 3,
              tag: "button",
              text: "Pesquisa Google",
              visible: true,
              attributes: { type: "submit" },
              rect: { x: 500, y: 360, w: 120, h: 36 },
              children: []
            }
          ]
        }
      };
    }
    return { ok: true, message: `Mocked success response for tool '${call.name}'` };
  }

  private static async sendProviderMessage(
    provider: AiProvider,
    model: string,
    systemPrompt: string,
    history: Message[],
    settings: {
      openaiApiKey: string;
      geminiApiKey: string;
      groqApiKey: string;
      ollamaEndpoint: string;
    },
    callbacks: {
      onGroqRateLimitRetry?: (message: string, data: Record<string, unknown>) => void;
      onGeminiRateLimitRetry?: (message: string, data: Record<string, unknown>) => void;
    } = {},
    signal?: AbortSignal,
  ): Promise<{ text: string; inputTokens?: number; outputTokens?: number; tokensPerSecond?: number }> {
    const startTime = Date.now();
    let res: { text: string; inputTokens?: number; outputTokens?: number };

    if (provider === "openai") {
      res = await OpenaiService.sendMessage(settings.openaiApiKey, model, systemPrompt, history);
    } else if (provider === "gemini") {
      res = await GeminiService.sendMessage(settings.geminiApiKey, model, systemPrompt, history, {
        maxRetries: 3,
        onRateLimitRetry: (info) => {
          const waitSeconds = Math.ceil(info.waitMs / 1000);
          callbacks.onGeminiRateLimitRetry?.(
            `Gemini 429: aguardando ${waitSeconds}s antes de tentar novamente. Retry ${info.attempt}/${info.maxRetries}...\nMotivo do retry: limite de taxa; fonte=${info.source}, retryAfter=${info.retryAfterMs ?? "n/a"}ms, retryDelay=${info.retryDelayMs ?? "n/a"}ms.`,
            {
              waitMs: info.waitMs,
              retryAfterMs: info.retryAfterMs,
              retryDelayMs: info.retryDelayMs,
              source: info.source,
              attempt: info.attempt,
              maxRetries: info.maxRetries,
            },
          );
        },
      }, signal);
    } else if (provider === "groq") {
      res = await GroqService.sendMessage(settings.groqApiKey, model, systemPrompt, history, {
        maxRetries: 3,
        onRateLimitRetry: (info) => {
          const waitSeconds = Math.ceil(info.waitMs / 1000);
          const remaining = info.remainingTokens ?? "0";
          const limit = info.limitTokens ?? "?";
          callbacks.onGroqRateLimitRetry?.(
            `Groq 429: aguardando ${waitSeconds}s para liberar tokens. Retry ${info.attempt}/${info.maxRetries}...\nMotivo do retry: limite de taxa; tokens restantes=${remaining}/${limit}, resetTokens=${info.resetTokensMs ?? "n/a"}ms, retryAfter=${info.retryAfterMs ?? "n/a"}ms.`,
            {
              waitMs: info.waitMs,
              retryAfterMs: info.retryAfterMs,
              resetTokensMs: info.resetTokensMs,
              remainingTokens: info.remainingTokens,
              limitTokens: info.limitTokens,
              attempt: info.attempt,
              maxRetries: info.maxRetries,
            },
          );
        },
      }, signal);
    } else if (provider === "ollama") {
      res = await OllamaService.sendMessage(settings.ollamaEndpoint, model, systemPrompt, history);
    } else {
      throw new Error(`Provedor desconhecido: ${provider}`);
    }

    const durationMs = Date.now() - startTime;
    const durationSec = durationMs / 1000;
    const tokensPerSecond = res.outputTokens && durationSec > 0 ? Math.round(res.outputTokens / durationSec) : undefined;

    return {
      ...res,
      tokensPerSecond,
    };
  }

  private static getOriginalUserRequest(messages: Message[]): string {
    return [...messages]
      .reverse()
      .find((message) => message.role === "user" && !message.internal)
      ?.content
      .trim() ?? "";
  }

  private static extractFinalAnswer(call: ToolCall): string {
    return (call.params.answer ?? call.params.content ?? call.params.message ?? "").trim();
  }

  private static appendFinalAssistantMessage(sessionId: string, content: string): void {
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

  private static async evaluateTaskCompletion(input: {
    originalUserRequest: string;
    responseText?: string;
    executedSteps: ExecutedStep[];
    lastToolResult?: ExecutedStep;
  }): Promise<TaskCompletionCheck> {
    const finalText = (input.responseText ?? "").trim();

    if (finalText) {
      return {
        completed: this.hasUsefulFinalAnswer(finalText),
        reason: "O modelo emitiu resposta final; o runtime valida apenas que o texto nao esteja vazio nem contenha XML MCP aninhado.",
      };
    }

    return {
      completed: false,
      reason: "Ferramentas foram executadas. Decida pelo objetivo original e pelos resultados se deve chamar mais uma ferramenta MCP ou emitir final_answer.",
    };
  }

  private static appendInternalContinuationPrompt(
    sessionId: string,
    originalUserRequest: string,
    executedSteps: ExecutedStep[],
    reason: string,
    blockedFinalAnswer?: string,
  ): void {
    const session = StorageService.getSession(sessionId);
    if (!session) {
      return;
    }

    const lastStep = executedSteps[executedSteps.length - 1];
    const pageState = this.summarizeCurrentPageState(executedSteps);
    const blockedText = blockedFinalAnswer
      ? `\nResposta final bloqueada por estar prematura:\n${this.truncateForPrompt(blockedFinalAnswer, 1200)}\n`
      : "";

    session.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      internal: true,
      content: [
        "[INSTRUCAO INTERNA DO RUNTIME - NAO MOSTRAR AO USUARIO]",
        "Sucesso de ferramenta MCP NAO significa conclusao da tarefa.",
        `Objetivo original do usuario: ${originalUserRequest}`,
        `Motivo da checagem: ${reason}`,
        `Ultima ferramenta executada: ${lastStep ? `${lastStep.tool} (${lastStep.status})` : "nenhuma"}`,
        `Ferramentas ja executadas: ${this.summarizeExecutedSteps(executedSteps)}`,
        `Estado atual conhecido da pagina/resultados: ${pageState}`,
        blockedText,
        "Pergunta obrigatoria: a tarefa do usuario ja foi concluida de ponta a ponta?",
        "Se NAO, escolha a proxima acao emitindo <tool_call>. Nao responda em texto comum.",
        "Se SIM, responda ao usuario com uma resposta final util, concreta e curta.",
        "O runtime nao classifica a tarefa por regex. Use seu proprio entendimento do objetivo, do estado conhecido e dos resultados das ferramentas.",
      ].filter(Boolean).join("\n"),
      timestamp: new Date().toISOString(),
    });
    StorageService.saveSession(session);
  }

  private static renderToolCallXml(call: ToolCall): string {
    const params = Object.entries(call.params)
      .map(([name, value]) => `<param name="${this.escapeXmlAttribute(name)}">${this.escapeXmlText(value)}</param>`)
      .join("");

    if (!params) {
      return `<tool_call name="${this.escapeXmlAttribute(call.name)}"/>`;
    }

    return `<tool_call name="${this.escapeXmlAttribute(call.name)}">${params}</tool_call>`;
  }

  private static normalizeModelToolCalls(toolCalls: ToolCall[]): ToolCall[] {
    return toolCalls.map((call) => {
      const params = { ...call.params };
      let name = call.name;

      if (name === "navigate_to" || name === "open_url") {
        name = "navigate_tab";
      }

      if (name === "read_page") {
        name = "extract_page_text";
      }

      if (name === "interact_element" && params.value === undefined && params.text !== undefined) {
        params.value = params.text;
        delete params.text;
      }

      return { ...call, name, params };
    });
  }

  private static getSuggestedRecoveryTool(steps: ExecutedStep[]): ToolCall | null {
    const lastStep = [...steps].reverse().find((step) => step.status === "error" && step.error);

    if (!lastStep?.error) {
      return null;
    }

    try {
      const parsed = JSON.parse(lastStep.error) as {
        suggestedNextTool?: unknown;
        suggestedArgs?: unknown;
      };

      if (
        typeof parsed.suggestedNextTool !== "string"
        || !parsed.suggestedArgs
        || typeof parsed.suggestedArgs !== "object"
        || Array.isArray(parsed.suggestedArgs)
      ) {
        return null;
      }

      const allowedRecoveryTools = new Set(["query_elements", "resolve_element", "get_page_inventory"]);
      if (!allowedRecoveryTools.has(parsed.suggestedNextTool)) {
        return null;
      }

      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed.suggestedArgs as Record<string, unknown>)) {
        if (value !== undefined && value !== null) {
          params[key] = String(value);
        }
      }

      return {
        name: parsed.suggestedNextTool,
        params,
      };
    } catch {
      return null;
    }
  }

  private static extractExecutedSteps(messages: Message[]): ExecutedStep[] {
    const steps: ExecutedStep[] = [];
    let pendingCalls: ToolCall[] = [];

    for (const message of messages) {
      if (message.role === "assistant") {
        pendingCalls = McpEngine.parseXmlCommands(message.content);
        continue;
      }

      if (message.role !== "tool") {
        continue;
      }

      const regex = /<tool_response\s+name="([^"]+)"\s*(?:status="([^"]+)")?\s*>([\s\S]*?)<\/tool_response>/gi;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(message.content)) !== null) {
        const name = match[1];
        const statusAttr = match[2];
        const text = match[3].trim();
        const pendingIndex = pendingCalls.findIndex((call) => call.name === name);
        const call = pendingIndex >= 0 ? pendingCalls.splice(pendingIndex, 1)[0] : undefined;
        const isError = statusAttr === "error" || text.startsWith("Erro:");

        steps.push({
          tool: name,
          params: call?.params ?? {},
          result: isError ? undefined : text,
          error: isError ? text.replace(/^Erro:\s*/, "") : undefined,
          status: isError ? "error" : "success",
        });
      }
    }

    return steps;
  }

  private static buildExecutionPlan(responseText: string, toolCalls: ToolCall[]): AgentExecutionPlan {
    const planText = /<execution_plan\b[^>]*>([\s\S]*?)<\/execution_plan>/i.exec(responseText)?.[1]
      ?.replace(/\s+/g, " ")
      .trim();

    return {
      summary: planText || `Executar ${toolCalls.length} ferramenta(s) MCP na aba ativa do Chrome.`,
      steps: toolCalls.map((call) => ({
        tool: call.name,
        purpose: this.describeTool(call),
        params: call.params,
      })),
    };
  }

  private static describeTool(call: ToolCall): string {
    const descriptions: Record<string, string> = {
      get_tab_info: "identificar a aba alvo e sua URL atual",
      get_dom_tree: "ler a arvore semantica purificada do DOM da aba ativa",
      get_page_inventory: "obter um resumo compacto dos elementos visiveis da pagina",
      query_elements: "procurar elementos por texto ou atributos estaveis",
      wait_for_page_ready: "aguardar a pagina ficar carregada e estavel antes de concluir ou ler dados",
      wait_for_navigation_or_dom_change: "aguardar navegacao, rota SPA ou mudanca de DOM apos uma acao",
      call_on_condition: "aguardar uma condicao e executar outra ferramenta MCP quando ela for satisfeita",
      think: "informar ao usuario, de forma curta, o que o agente esta analisando",
      advise: "informar ao usuario uma decisao, cuidado ou proximo passo durante a execucao",
      interact_element: "interagir fisicamente com um elemento pelo vortexId",
      interact_cached_element: "interagir com um elemento salvo no cache",
      extract_page_text: "extrair texto visivel da pagina",
      capture_screenshot: "capturar a area visivel da aba",
      list_tabs: "listar abas abertas",
      focus_tab: "focar uma aba especifica",
    };

    return descriptions[call.name] ?? "executar ferramenta MCP no navegador";
  }

  private static createPendingApproval(input: {
    sessionId: string;
    provider: AiProvider;
    model: string;
    responseText: string;
    plan: AgentExecutionPlan;
    toolCalls: ToolCall[];
  }): PendingApproval {
    const now = new Date().toISOString();

    return {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      provider: input.provider,
      model: input.model,
      responseText: input.responseText,
      plan: input.plan,
      toolCalls: input.toolCalls,
      createdAt: now,
      updatedAt: now,
    };
  }

  private static isReadTool(tool: string): boolean {
    return [
      "get_tab_info",
      "get_dom_tree",
      "query_elements",
      "wait_for_element",
      "extract_page_text",
      "get_page_inventory",
      "get_links",
      "get_images",
      "get_forms",
      "get_meta_tags",
      "get_selection",
      "capture_screenshot",
      "search_web",
    ].includes(tool);
  }

  private static isMutatingTool(tool: string): boolean {
    return [
      "interact_element",
      "interact_cached_element",
      "alter_element_dom",
      "press_key",
      "scroll_page",
      "navigate_tab",
      "reload_tab",
      "go_back",
      "go_forward",
    ].includes(tool);
  }

  private static hasUsefulFinalAnswer(text: string): boolean {
    const compact = text.replace(/\s+/g, " ").trim();
    return compact.length > 0 && McpEngine.parseXmlCommands(compact).length === 0;
  }

  private static summarizeExecutedSteps(steps: ExecutedStep[]): string {
    if (steps.length === 0) {
      return "nenhuma";
    }

    return steps
      .slice(-10)
      .map((step, index) => {
        const params = Object.entries(step.params)
          .filter(([key]) => ["action", "key", "value", "query", "url", "vortexId"].includes(key))
          .map(([key, value]) => `${key}=${this.truncateForPrompt(value, 80)}`)
          .join(", ");
        return `${index + 1}. ${step.tool} ${step.status}${params ? ` (${params})` : ""}`;
      })
      .join("\n");
  }

  private static summarizeCurrentPageState(steps: ExecutedStep[]): string {
    const latestRead = [...steps].reverse().find((step) => step.result && this.isReadTool(step.tool));
    if (!latestRead?.result) {
      return "nenhum estado lido ainda";
    }

    return this.truncateForPrompt(latestRead.result, 1800);
  }

  private static truncateForPrompt(value: string, maxChars: number): string {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length <= maxChars) {
      return compact;
    }
    return `${compact.slice(0, maxChars)}...`;
  }

  private static escapeXmlAttribute(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private static escapeXmlText(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private static logDebug(event: Omit<AgentDebugEvent, "id" | "createdAt">): void {
    try {
      StorageService.appendAgentDebugEvent(event);
    } catch (error) {
      console.debug("Browia debug log failed", error);
    }
  }

  private static updateRuntimeBudgetStats(
    sessionId: string,
    stats: ReturnType<TokenBudgetManager["getStats"]>,
    update: Partial<NonNullable<AgentRuntimeState["budgetStats"]>>,
    callEntry?: NonNullable<NonNullable<AgentRuntimeState["budgetStats"]>["callHistory"]>[number],
  ): void {
    const currentRuntime = StorageService.getAgentRuntimeState();
    const sameSession = currentRuntime.sessionId === sessionId;
    const previousBudgetStats = sameSession ? currentRuntime.budgetStats : undefined;
    const previousHistory = previousBudgetStats?.callHistory ?? [];
    const callHistory = callEntry ? [...previousHistory, callEntry].slice(-50) : previousHistory;

    StorageService.saveAgentRuntimeState({
      ...currentRuntime,
      sessionId,
      budgetStats: {
        ...previousBudgetStats,
        totalTokens: stats.totalTokens,
        requestCount: stats.requestCount,
        rawSize: previousBudgetStats?.rawSize ?? 0,
        compressedSize: previousBudgetStats?.compressedSize ?? 0,
        compressionRatio: previousBudgetStats?.compressionRatio ?? 0,
        lastCompressedTool: previousBudgetStats?.lastCompressedTool ?? "",
        ...update,
        callHistory,
      },
    });
  }

  private static describeRuntimePhase(call: ToolCall): string {
    if (call.name === "think" || call.name === "advise") {
      return call.params.message || "Atualizando raciocínio do agente...";
    }

    if (call.name === "interact_element" || call.name === "interact_cached_element") {
      if (call.params.action === "type") return "Digitando pesquisa...";
      if (call.params.action === "click") return "Clicando no elemento...";
      if (call.params.action === "clear") return "Limpando campo...";
      if (call.params.action === "hover") return "Movendo cursor sobre elemento...";
    }

    if (call.name === "press_key") {
      return /^enter$/i.test(call.params.key ?? "") ? "Enviando busca..." : `Pressionando ${call.params.key ?? "tecla"}...`;
    }

    if (call.name === "wait_for_element") return "Aguardando resultados...";
    if (call.name === "wait_for_page_ready") return "Aguardando a página carregar...";
    if (call.name === "wait_for_navigation_or_dom_change") return "Aguardando navegação ou mudança na página...";
    if (call.name === "call_on_condition") return "Aguardando condição e executando próxima ação...";
    if (["extract_page_text", "get_page_inventory", "get_dom_tree", "query_elements", "get_links"].includes(call.name)) {
      return "Lendo resultados...";
    }
    if (call.name === "get_tab_info") return "Identificando aba atual...";
    if (["download_file", "download_screenshot", "capture_screenshot"].includes(call.name)) return "Gerando arquivo/captura...";
    if (call.name === "navigate_tab") return "Navegando na aba...";

    return `Executando ${call.name}...`;
  }

  private static describePostToolPhase(call: ToolCall): string {
    if (call.name === "think" || call.name === "advise") {
      return call.params.message || "Atualização registrada. Continuando...";
    }

    if (call.name === "press_key" && /^enter$/i.test(call.params.key ?? "")) return "Busca enviada. Aguardando leitura dos resultados...";
    if (call.name === "wait_for_page_ready") return "Página estabilizada. Lendo próximo estado...";
    if (call.name === "wait_for_navigation_or_dom_change") return "Mudança detectada. Lendo próximo estado...";
    if (call.name === "call_on_condition") return "Ação condicional concluída. Verificando resultado...";
    if (["extract_page_text", "get_page_inventory", "get_dom_tree", "query_elements", "get_links"].includes(call.name)) {
      return "Resultados lidos. Verificando se a tarefa foi concluída...";
    }
    if (call.name === "interact_element" && call.params.action === "type") return "Texto digitado. Verificando próximo passo...";
    if (call.name === "interact_element" && call.params.action === "click") return "Clique concluído. Verificando resultado...";
    return `${call.name} concluída. Verificando próximo passo...`;
  }

  private static async executeApprovedToolCalls(
    sessionId: string,
    responseText: string,
    toolCalls: ToolCall[],
    toolStates: ToolCallState[],
    onUpdate: (update: AgentStepUpdate) => void,
    budgetManager: TokenBudgetManager,
    activeTabUrl: string,
    signal?: AbortSignal,
    options: { recordAssistantMessage?: boolean } = {},
  ): Promise<ExecutedStep[]> {
    const activeSession = StorageService.getSession(sessionId);
    if (activeSession && options.recordAssistantMessage !== false) {
      const latestMsg = activeSession.messages[activeSession.messages.length - 1];
      const isAlreadyAppended = latestMsg && latestMsg.role === "assistant" && latestMsg.content === responseText;

      if (!isAlreadyAppended) {
        activeSession.messages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: responseText,
          timestamp: new Date().toISOString(),
        });
        StorageService.saveSession(activeSession);
      }
    }

    onUpdate({
      type: "executing_tools",
      message: `Executando ${toolCalls.length} ferramenta(s)...`,
      toolCalls: toolStates,
    });

    const toolResponseXmlBlocks: string[] = [];
    const executedSteps: ExecutedStep[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      if (signal?.aborted) {
        onUpdate({ type: "cancelled", message: "Execução cancelada pelo usuário." });
        throw new Error("Cancelled");
      }

      const call = toolCalls[i];
      
      // Schema validation/conversion (Parte 11 / 1)
      const normalizedArgs = normalizeToolArgs(call.name, call.params);
      call.params = normalizedArgs as Record<string, string>;

      toolStates[i].status = "pending";
      onUpdate({
        type: "executing_tools",
        message: this.describeRuntimePhase(call),
        toolCalls: [...toolStates],
      });

      let resultStr: string;
      let isError = false;

      try {
        let toolResult: unknown;
        const tabId = await this.resolveTabIdWithTimeout(call.params.tabId);

        // Mutating tools invalidate the cache, read tools query/pull from cache
        if (this.isMutatingTool(call.name)) {
          PageCache.invalidate(tabId);
          toolResult = await this.executeToolCall(call);
        } else {
          // Check cache (Parte 15)
          const cache = PageCache.get(tabId);
          const now = Date.now();
          if (cache) {
            if (call.name === "get_tab_info" && cache.tabInfo && now - cache.capturedAt < 2000) {
              toolResult = cache.tabInfo;
            } else if (call.name === "get_page_inventory" && cache.inventoryCompact && now - cache.capturedAt < 10000) {
              toolResult = cache.inventoryCompact;
            } else if (call.name === "get_dom_tree" && cache.domCandidates && now - cache.capturedAt < 5000) {
              toolResult = cache.domCandidates;
            }
          }

          if (toolResult === undefined) {
            toolResult = await this.executeToolCall(call);
            // Save to cache
            if (call.name === "get_tab_info") PageCache.set(tabId, { tabInfo: toolResult });
            if (call.name === "get_page_inventory") PageCache.set(tabId, { inventoryCompact: toolResult });
            if (call.name === "get_dom_tree") PageCache.set(tabId, { domCandidates: toolResult });
          }
        }

        if (toolResult && typeof toolResult === "object") {
          const resObj = toolResult as { success?: boolean; ok?: boolean };
          if (resObj.success === false || resObj.ok === false) {
            isError = true;
          }
        }

        const rawStr = typeof toolResult === "object" ? JSON.stringify(toolResult) : String(toolResult);
        const rawSize = rawStr.length;

        // Compress tool result (Parte 5)
        const currentUrl = activeTabUrl;
        const currentDomain = activeTabUrl ? new URL(activeTabUrl).hostname.replace("www.", "") : "";
        const compressed = compressToolResultForModel(call.name, toolResult, {
          originalGoal: activeSession ? this.getOriginalUserRequest(activeSession.messages) : "",
          currentUrl,
          currentDomain,
        });

        resultStr = typeof compressed === "object" ? JSON.stringify(compressed) : String(compressed);
        const compressedSize = resultStr.length;

        // Record tool-result tokens separately from provider API requests.
        const toolResultTokens = budgetManager.recordToolResult(resultStr);
        const stats = budgetManager.getStats();

        // Update runtime state with stats for UI debug (Parte 16)
        this.updateRuntimeBudgetStats(sessionId, stats, {
          rawSize,
          compressedSize,
          compressionRatio: rawSize > 0 ? Math.round(((rawSize - compressedSize) / rawSize) * 100) : 0,
          lastCompressedTool: call.name,
        }, {
          sequence: (StorageService.getAgentRuntimeState().budgetStats?.callHistory?.length ?? 0) + 1,
          kind: "tool_result",
          toolName: call.name,
          outputTokens: toolResultTokens.outputTokens,
          totalTokens: toolResultTokens.outputTokens,
          estimated: true,
          timestamp: new Date().toISOString(),
        });

        if (isError) {
          toolStates[i].status = "error";
          toolStates[i].error = (toolResult as { error?: string }).error || "Ação falhou";
        } else {
          toolStates[i].status = "success";
        }
        toolStates[i].result = resultStr;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        resultStr = `Erro: ${errMsg}`;
        toolStates[i].status = "error";
        toolStates[i].error = errMsg;
        isError = true;
      }

      executedSteps.push({
        tool: call.name,
        params: call.params,
        result: isError ? undefined : resultStr,
        error: isError ? resultStr.replace(/^Erro:\s*/, "") : undefined,
        status: isError ? "error" : "success",
      });

      onUpdate({
        type: "tool_complete",
        message: isError ? `${call.name} falhou; analisando alternativa...` : this.describePostToolPhase(call),
        toolCalls: [...toolStates],
      });

      toolResponseXmlBlocks.push(`<tool_response name="${call.name}" status="${isError ? "error" : "success"}">\n${resultStr}\n</tool_response>`);
    }

    const postToolSession = StorageService.getSession(sessionId);
    if (postToolSession) {
      postToolSession.messages.push({
        id: crypto.randomUUID(),
        role: "tool",
        content: toolResponseXmlBlocks.join("\n\n"),
        timestamp: new Date().toISOString(),
      });

      const interventions = StorageService.consumePendingAgentInterventions(sessionId);
      if (interventions.length > 0) {
        postToolSession.messages.push({
          id: crypto.randomUUID(),
          role: "user",
          internal: true,
          content: [
            "[INTERVENCAO DO USUARIO APOS TOOL_RESULT - NAO MOSTRAR AO USUARIO]",
            "O usuario enviou a(s) mensagem(ns) abaixo enquanto o agente estava executando ferramentas.",
            "Use isso como ajuste/contexto para a proxima decisao, sem perder o objetivo original da tarefa.",
            ...interventions.map((item, index) => `${index + 1}. ${item.content}`),
          ].join("\n"),
          timestamp: new Date().toISOString(),
        });

        this.logDebug({
          sessionId,
          provider: postToolSession.provider,
          model: postToolSession.model,
          phase: "queued_user_intervention_consumed",
          message: `${interventions.length} intervenção(ões) do usuário anexada(s) após tool_result.`,
          data: {
            interventionIds: interventions.map((item) => item.id),
            contents: interventions.map((item) => this.truncateForPrompt(item.content, 400)),
          },
        });
      }
      StorageService.saveSession(postToolSession);
    }

    return executedSteps;
  }

  private static async executeToolCall(call: ToolCall): Promise<unknown> {
    const timeoutMs = this.getToolTimeoutMs(call.name);
    return this.withTimeout(
      this.executeToolCallWithoutTimeout(call),
      timeoutMs,
      `Timeout executando ferramenta ${call.name} após ${timeoutMs}ms.`,
    );
  }

  private static async resolveTabIdWithTimeout(tabId?: string): Promise<number> {
    const timeoutMs = 10_000;
    return this.withTimeout(
      resolveTabId(tabId),
      timeoutMs,
      `Timeout resolvendo aba ativa após ${timeoutMs}ms.`,
    );
  }

  private static async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  private static getToolTimeoutMs(toolName: string): number {
    if (["wait_for_element", "wait_for_page_ready", "wait_for_navigation_or_dom_change", "call_on_condition"].includes(toolName)) {
      return 65_000;
    }

    if (["extract_page_text", "get_dom_tree", "get_page_inventory", "query_elements"].includes(toolName)) {
      return 20_000;
    }

    return 15_000;
  }

  private static async executeToolCallWithoutTimeout(call: ToolCall): Promise<unknown> {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      const bgResponse = await chrome.runtime.sendMessage({
        type: "MCP_EXECUTE",
        payload: { call },
      });

      if (bgResponse?.ok) {
        return bgResponse.result;
      }

      throw new Error(bgResponse?.error || "Erro de execução desconhecido no background.");
    }

    console.log("Mock execution in non-extension environment for:", call);
    return this.mockExecuteTool(call);
  }

  private static getLastToolResponseXml(messages: Message[]): string | undefined {
    const toolMsg = [...messages].reverse().find((m) => m.role === "tool");
    return toolMsg?.content;
  }

  private static buildAgentModelContext(
    originalGoal: string,
    executedSteps: ExecutedStep[],
    lastToolResultXml: string | undefined,
    activeTabUrl?: string,
    activeTabTitle?: string,
    budgetStats?: {
      requestCount?: number;
      totalTokens?: number;
    }
  ): Message[] {
    const domain = activeTabUrl ? new URL(activeTabUrl).hostname.replace("www.", "") : "";
    const recipe = domain ? SITE_RECIPES[domain as keyof typeof SITE_RECIPES] : undefined;
    
    let recipePrompt = "";
    if (recipe) {
      recipePrompt = `
[RECEITA DE ATALHO DE SITES ENCONTRADA PARA ${domain.toUpperCase()}]
Descrição: ${recipe.description}
Elementos conhecidos que você pode interagir diretamente via interact_element (passando "selector" ou "id"):
${Object.entries(recipe.elements).map(([name, locators]) => {
  return `- ${name}: use ${locators.map(l => `${l.type}=${l.value || l.role}`).join(" ou ")}`;
}).join("\n")}

Dica: Nunca peça get_dom_tree ou get_page_inventory para este site. Use os locators acima diretamente no interact_element!
`;
    }

    let warningPrompt = "";
    if (executedSteps.length > 0) {
      const lastStep = executedSteps[executedSteps.length - 1];
      const hasError = lastStep.status === "error" || lastStep.error !== undefined;
      const isInteraction = lastStep.tool === "interact_element";
      
      if (isInteraction && hasError) {
        warningPrompt = `
[ALERTA DE FALHA CRÍTICA NA AÇÃO ANTERIOR]
A última chamada para 'interact_element' falhou (Erro: ${lastStep.error || "Elemento não encontrado"}).
Você NÃO pode chamar 'get_dom_tree' ou 'get_page_inventory' brutas sob nenhuma circunstância neste passo.
Para encontrar o elemento correto, você deve usar 'resolve_element' ou 'query_elements' direcionado com termos específicos (ex: textbox, button, search).
`;
      }
    }

    const compactStateStr = `
[ESTADO ATUAL DA TAREFA]
Objetivo Original: ${originalGoal}
URL atual: ${activeTabUrl || "Não detectada"}
Título atual: ${activeTabTitle || "Não detectado"}
Estatísticas de Consumo: Requests=${budgetStats?.requestCount ?? 0}, Tokens estimados=${budgetStats?.totalTokens ?? 0}
Passos executados até agora:
${executedSteps.length > 0 ? executedSteps.map((s, i) => `${i+1}. Tool: ${s.tool} -> status: ${s.status}${s.error ? ` (Erro: ${s.error})` : ""}`).join("\n") : "Nenhum passo executado ainda."}
${recipePrompt}
${warningPrompt}
`;

    const messages: Message[] = [
      {
        id: crypto.randomUUID(),
        role: "system",
        content: compactStateStr,
        timestamp: new Date().toISOString()
      }
    ];

    messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: `Por favor, execute o objetivo: ${originalGoal}`,
      timestamp: new Date().toISOString()
    });

    if (executedSteps.length > 0) {
      const lastStep = executedSteps[executedSteps.length - 1];
      const lastCallXml = `<execution_plan>Executar ação anterior</execution_plan>\n<tool_call name="${lastStep.tool}">${Object.entries(lastStep.params).map(([k, v]) => `<param name="${k}">${v}</param>`).join("")}</tool_call>`;
      
      messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: lastCallXml,
        timestamp: new Date().toISOString()
      });

      if (lastToolResultXml) {
        messages.push({
          id: crypto.randomUUID(),
          role: "tool",
          content: lastToolResultXml,
          timestamp: new Date().toISOString()
        });
      }
    }

    return messages;
  }
}
