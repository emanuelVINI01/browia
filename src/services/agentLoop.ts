import { StorageService, type Message, type PendingApproval } from "./storageService";
import { OpenaiService } from "./openaiService";
import { GeminiService } from "./geminiService";
import { OllamaService } from "./ollamaService";
import { McpEngine, type ToolCall } from "./mcpEngine";

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
    ];
    return safeTools.includes(name);
  }

  static async run(
    provider: "openai" | "gemini" | "ollama",
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
    const ollamaEndpoint = parsedSettings.ollamaEndpoint || "http://localhost:11434";
    const customPrompt = parsedSettings.customSystemPrompt || "";

    const systemPrompt = customPrompt || (await this.loadDefaultSystemPrompt());
    
    const maxIterations = 12; // safety limit

    for (let iter = 0; iter < maxIterations; iter++) {
      if (signal?.aborted) {
        onUpdate({ type: "cancelled", message: "Execução cancelada pelo usuário." });
        throw new Error("Cancelled");
      }

      // Load session at the beginning of each iteration to get current history
      const session = StorageService.getSession(sessionId);
      if (!session) {
        throw new Error(`Sessão não encontrada: ${sessionId}`);
      }
      const originalUserRequest = this.getOriginalUserRequest(session.messages);
      const executedStepsAtIterationStart = this.extractExecutedSteps(session.messages);

      onUpdate({ type: "ai_thinking", message: `A IA está pensando (passo ${iter + 1})...` });

      let responseText: string;
      try {
        responseText = await this.sendProviderMessage(
          provider,
          model,
          systemPrompt,
          session.messages,
          { openaiApiKey, geminiApiKey, ollamaEndpoint },
        );
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        onUpdate({ type: "error", message: `Erro na chamada de IA: ${errMsg}` });
        throw err;
      }

      // Check if response contains tool calls
      let toolCalls = McpEngine.parseXmlCommands(responseText);

      if (toolCalls.length === 0 && this.shouldRequireBrowserTool(session.messages)) {
        onUpdate({
          type: "ai_thinking",
          message: "A IA respondeu sem ferramenta; reforçando uso de MCP...",
        });

        responseText = await this.sendProviderMessage(
          provider,
          model,
          `${systemPrompt}\n\nINSTRUCAO RUNTIME OBRIGATORIA: a ultima solicitacao depende do navegador/aba/DOM. A resposta anterior sem <tool_call> e invalida. Emita agora um <execution_plan> curto e pelo menos um <tool_call>. Nao responda em texto comum antes de executar ferramentas.`,
          session.messages,
          { openaiApiKey, geminiApiKey, ollamaEndpoint },
        );
        toolCalls = McpEngine.parseXmlCommands(responseText);
      }

      if (toolCalls.length === 0) {
        // Prevent premature ending: check if AI explains intent of action but forgot tool call block
        const textLower = responseText.toLowerCase();
        const containsActionIntent = 
          /\b(vou clicar|vou tentar|vou extrair|vou digitar|vou preencher|vou navegar|vou rolar|vou buscar|vou pesquisar|tentando|clicando|digitando|navegando|going to click|going to type|going to extract|going to navigate|will click|will type|will search|will extract|will navigate)\b/i.test(textLower);

        if (containsActionIntent && this.shouldRequireBrowserTool(session.messages)) {
          onUpdate({
            type: "ai_thinking",
            message: "Reforçando execução: o agente informou intenção de agir verbalmente mas não emitiu XML...",
          });

          const activeSession = StorageService.getSession(sessionId);
          if (activeSession) {
            activeSession.messages.push({
              id: crypto.randomUUID(),
              role: "assistant",
              content: responseText,
              timestamp: new Date().toISOString(),
            });
            activeSession.messages.push({
              id: crypto.randomUUID(),
              role: "user",
              content: "Você informou que iria realizar uma ação (como clicar, digitar ou navegar), mas não enviou nenhum bloco XML <tool_call>. Por favor, execute a ferramenta MCP apropriada para continuar a tarefa.",
              timestamp: new Date().toISOString(),
            });
            StorageService.saveSession(activeSession);
          }
          continue; // Rerun loop with prompt reinforcement
        }

        // No tools called, this is the final answer
        const cleanedResponse = responseText.trim();
        const requiresBrowserTool = this.shouldRequireBrowserTool(session.messages);
        const completion: TaskCompletionCheck = requiresBrowserTool
          ? await this.evaluateTaskCompletion({
              originalUserRequest,
              responseText: cleanedResponse,
              executedSteps: executedStepsAtIterationStart,
            })
          : {
              completed: cleanedResponse.length > 0,
              reason: "Conversa comum sem necessidade de ferramenta MCP.",
            };

        if (!completion.completed) {
          onUpdate({
            type: "ai_thinking",
            message: "A tarefa ainda não foi concluída; escolhendo a próxima ação...",
          });

          this.appendInternalContinuationPrompt(
            sessionId,
            originalUserRequest,
            executedStepsAtIterationStart,
            completion.reason,
            cleanedResponse,
          );
          continue;
        }
        
        // Save final assistant response to storage
        const activeSession = StorageService.getSession(sessionId);
        if (activeSession) {
          activeSession.messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: cleanedResponse,
            timestamp: new Date().toISOString(),
          });
          StorageService.saveSession(activeSession);
        }

        onUpdate({ type: "final_answer", finalContent: cleanedResponse });
        return cleanedResponse;
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
            toolCalls: toolStates, // UI receives complete tool list showing executed safe ones
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

        // Execute the approved sensitive tools
        const sensitiveSteps = await this.executeApprovedToolCalls(
          sessionId,
          responseText,
          pendingSensitiveTools,
          sensitiveStates,
          onUpdate,
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
          message: completion.completed
            ? "Validando resposta final..."
            : this.describeNextRuntimeStatus(originalUserRequest, allExecutedSteps),
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

    const executedSteps = await this.executeApprovedToolCalls(
      approval.sessionId,
      approval.responseText,
      approval.toolCalls,
      toolStates,
      onUpdate,
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
    provider: "openai" | "gemini" | "ollama",
    model: string,
    systemPrompt: string,
    history: Message[],
    settings: {
      openaiApiKey: string;
      geminiApiKey: string;
      ollamaEndpoint: string;
    },
  ): Promise<string> {
    if (provider === "openai") {
      return OpenaiService.sendMessage(settings.openaiApiKey, model, systemPrompt, history);
    }

    if (provider === "gemini") {
      return GeminiService.sendMessage(settings.geminiApiKey, model, systemPrompt, history);
    }

    if (provider === "ollama") {
      return OllamaService.sendMessage(settings.ollamaEndpoint, model, systemPrompt, history);
    }

    throw new Error(`Provedor desconhecido: ${provider}`);
  }

  private static shouldRequireBrowserTool(messages: Message[]): boolean {
    const latestUserMessage = this.getOriginalUserRequest(messages);
    const browserTaskPattern =
      /\b(site|url|aba|pagina|página|dom|html|clique|clica|clicar|foto|avatar|perfil|conta|nome|elemento|bot[aã]o|campo|digite|preencha|pesquisa|pesquise|buscar|busca|procura|google|resultado|screenshot|print|download|cookie|favorito|hist[oó]rico|localstorage|sessionstorage)\b/i;

    return browserTaskPattern.test(latestUserMessage);
  }

  private static getOriginalUserRequest(messages: Message[]): string {
    return [...messages]
      .reverse()
      .find((message) => message.role === "user" && !message.internal)
      ?.content
      .trim() ?? "";
  }

  private static async evaluateTaskCompletion(input: {
    originalUserRequest: string;
    responseText?: string;
    executedSteps: ExecutedStep[];
    lastToolResult?: ExecutedStep;
  }): Promise<TaskCompletionCheck> {
    const request = input.originalUserRequest.toLowerCase();
    const finalText = (input.responseText ?? "").trim();
    const steps = input.executedSteps;

    if (!request) {
      return { completed: Boolean(finalText), reason: "Sem objetivo original rastreavel." };
    }

    if (this.isScreenshotOrDownloadTask(request)) {
      const hasFileAction = steps.some((step) =>
        ["download_file", "download_screenshot"].includes(step.tool)
        || (step.tool === "capture_screenshot" && !/\b(baix|download|salv|arquivo)\b/i.test(request))
      );
      return {
        completed: hasFileAction && this.hasUsefulFinalAnswer(finalText),
        reason: hasFileAction
          ? "Arquivo/captura ja foi gerado; falta apenas informar conclusao ao usuario."
          : "Objetivo pede arquivo/captura, mas nenhuma ferramenta de captura/download foi concluida.",
      };
    }

    if (this.isSearchTask(request)) {
      const typedIndex = this.findLastStepIndex(steps, (step) =>
        step.tool === "interact_element"
        && step.params.action === "type"
        && Boolean(step.params.value?.trim())
      );
      let submittedIndex = this.findLastStepIndex(steps, (step) =>
        (step.tool === "press_key" && /^enter$/i.test(step.params.key ?? ""))
        || (step.tool === "interact_element" && step.params.action === "click" && this.looksLikeSearchSubmit(step.params))
        || (step.tool === "navigate_tab" && /[?&](q|query|search)=/i.test(step.params.url ?? ""))
        || step.tool === "search_web"
      );
      if (submittedIndex < 0 && typedIndex >= 0) {
        submittedIndex = this.findLastStepIndex(steps, (step) =>
          ["interact_element", "interact_cached_element"].includes(step.tool) && step.params.action === "click"
        );
        if (submittedIndex < typedIndex) {
          submittedIndex = -1;
        }
      }
      const readAfterSubmit = submittedIndex >= 0 && steps.some((step, index) =>
        index > submittedIndex && this.isReadTool(step.tool)
      );

      if (typedIndex >= 0 && submittedIndex < 0) {
        return { completed: false, reason: "A pesquisa foi digitada, mas ainda nao foi submetida." };
      }

      if (submittedIndex >= 0 && !readAfterSubmit && !steps.some((step) => step.tool === "search_web")) {
        return { completed: false, reason: "A pesquisa foi enviada, mas os resultados ainda nao foram aguardados/lidos." };
      }

      return {
        completed: (steps.some((step) => step.tool === "search_web") || readAfterSubmit) && this.hasUsefulFinalAnswer(finalText),
        reason: "Pesquisa exige submeter, ler resultados e responder ao usuario com resumo util.",
      };
    }

    if (this.isClickExtractionTask(request)) {
      const clickIndex = this.findLastStepIndex(steps, (step) =>
        ["interact_element", "interact_cached_element"].includes(step.tool) && step.params.action === "click"
      );
      const readAfterClick = clickIndex >= 0 && steps.some((step, index) =>
        index > clickIndex && this.isReadTool(step.tool)
      );

      if (clickIndex >= 0 && !readAfterClick) {
        return { completed: false, reason: "O clique foi executado, mas o estado resultante ainda nao foi lido." };
      }

      return {
        completed: readAfterClick && this.hasUsefulFinalAnswer(finalText),
        reason: "A tarefa pede clique seguido de extracao; e preciso ler o modal/pagina apos o clique e responder.",
      };
    }

    if (this.isFillOnlyTask(request)) {
      const filled = steps.some((step) =>
        ["interact_element", "interact_cached_element"].includes(step.tool)
        && ["type", "clear"].includes(step.params.action ?? "")
      );
      return {
        completed: filled && this.hasUsefulFinalAnswer(finalText),
        reason: filled
          ? "Formulario foi preenchido; falta confirmar ao usuario."
          : "Pedido de preenchimento ainda nao executou digitacao/limpeza.",
      };
    }

    const lastMutationIndex = this.findLastStepIndex(steps, (step) => this.isMutatingTool(step.tool));
    const readAfterMutation = lastMutationIndex >= 0 && steps.some((step, index) =>
      index > lastMutationIndex && this.isReadTool(step.tool)
    );
    const asksForInformation = /\b(qual|quais|quem|onde|quando|pega|extra(i|í)|ler|l[eê]|mostra|nome|resultado|informa|descobre)\b/i.test(request);

    if (asksForInformation && lastMutationIndex >= 0 && !readAfterMutation) {
      return { completed: false, reason: "Houve acao no navegador, mas a informacao resultante ainda nao foi lida." };
    }

    return {
      completed: this.hasUsefulFinalAnswer(finalText),
      reason: "Resposta final so e valida quando explica o resultado do objetivo original, nao apenas a ferramenta executada.",
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
        "Heuristicas obrigatorias: pesquisa precisa submeter a busca, aguardar/ler resultados e responder; clique para extrair informacao precisa ler o estado apos o clique; preencher formulario so envia com aprovacao explicita do usuario.",
      ].filter(Boolean).join("\n"),
      timestamp: new Date().toISOString(),
    });
    StorageService.saveSession(session);
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
    provider: "openai" | "gemini" | "ollama";
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

  private static isSearchTask(request: string): boolean {
    return /\b(pesquis|buscar|busca|procura|google|resultado|search)\b/i.test(request);
  }

  private static isClickExtractionTask(request: string): boolean {
    return /\b(clic|abre|abrir|toca)\b/i.test(request)
      && /\b(pega|extra(i|í)|ler|l[eê]|mostra|nome|texto|info|informacao|informação|resultado|modal|popup)\b/i.test(request);
  }

  private static isScreenshotOrDownloadTask(request: string): boolean {
    return /\b(screenshot|print|captura|baix|download|arquivo)\b/i.test(request);
  }

  private static isFillOnlyTask(request: string): boolean {
    const asksFill = /\b(preench|digita|escrev|coloca|insere)\b/i.test(request);
    const asksSubmit = /\b(enviar|submeter|submit|confirmar|comprar|publicar|salvar|pesquis|buscar)\b/i.test(request);
    return asksFill && !asksSubmit;
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

  private static findLastStepIndex(steps: ExecutedStep[], predicate: (step: ExecutedStep) => boolean): number {
    for (let index = steps.length - 1; index >= 0; index--) {
      if (predicate(steps[index])) {
        return index;
      }
    }
    return -1;
  }

  private static hasUsefulFinalAnswer(text: string): boolean {
    if (!text || McpEngine.parseXmlCommands(text).length > 0) {
      return false;
    }

    const compact = text.replace(/\s+/g, " ").trim();
    if (compact.length < 24) {
      return false;
    }

    return !/\b(vou|irei|tentarei|preciso|posso tentar|executando|digitando|clicando|navegando)\b/i.test(compact);
  }

  private static looksLikeSearchSubmit(params: Record<string, string>): boolean {
    const haystack = Object.values(params).join(" ").toLowerCase();
    return /\b(search|pesquis|buscar|busca|google|submit|lupa)\b/i.test(haystack);
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

  private static describeRuntimePhase(call: ToolCall): string {
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

  private static describeNextRuntimeStatus(originalUserRequest: string, steps: ExecutedStep[]): string {
    const request = originalUserRequest.toLowerCase();
    if (this.isSearchTask(request)) {
      const hasSubmit = steps.some((step) =>
        (step.tool === "press_key" && /^enter$/i.test(step.params.key ?? ""))
        || step.tool === "search_web"
        || (step.tool === "navigate_tab" && /[?&](q|query|search)=/i.test(step.params.url ?? ""))
      );
      return hasSubmit ? "Lendo resultados..." : "Enviando busca...";
    }

    if (this.isClickExtractionTask(request)) {
      return "Lendo informação após o clique...";
    }

    return "Avaliando se a tarefa foi concluída...";
  }

  private static async executeApprovedToolCalls(
    sessionId: string,
    responseText: string,
    toolCalls: ToolCall[],
    toolStates: ToolCallState[],
    onUpdate: (update: AgentStepUpdate) => void,
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
      toolStates[i].status = "pending";
      onUpdate({
        type: "executing_tools",
        message: this.describeRuntimePhase(call),
        toolCalls: [...toolStates],
      });

      let resultStr: string;
      let isError = false;

      try {
        const toolResult = await this.executeToolCall(call);
        resultStr = typeof toolResult === "object" ? JSON.stringify(toolResult) : String(toolResult);
        toolStates[i].status = "success";
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
      StorageService.saveSession(postToolSession);
    }

    return executedSteps;
  }

  private static async executeToolCall(call: ToolCall): Promise<unknown> {
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
}
