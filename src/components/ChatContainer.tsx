import { useState, useRef, useEffect } from "react";
import type { Message, AgentRuntimeState } from "../services/storageService";
import { MessageItem } from "./MessageItem";
import { Send, Loader2, X, History, Camera, Search, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ExecutionApprovalPanel } from "./ExecutionApprovalPanel";
import type { ApprovalRequestState } from "../hooks/useAgentSession";
import { useI18n } from "../i18n";
import { ExecutionStepCard } from "./ExecutionStepCard";
import type { ToolResult } from "./ExecutionStepCard";
import { McpEngine } from "../services/mcpEngine";
import type { ToolCall } from "../services/mcpEngine";
import { SessionExportService, type SessionExportFormat } from "../services/sessionExportService";

interface ChatContainerProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  isAgentRunning: boolean;
  agentRunningStatus: string;
  runningToolsState?: Array<{
    name: string;
    params: Record<string, string>;
    result?: string;
    error?: string;
    status: "pending" | "success" | "error";
  }>;
  approvalRequest?: ApprovalRequestState | null;
  currentSessionId: string | null;
  devModeEnabled: boolean;
  queuedInterventionCount: number;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
  onCancelAgent: () => void;
  onQueueAgentMessage: (text: string) => void;
  budgetStats?: AgentRuntimeState["budgetStats"];
}

type TimelineItem =
  | {
      type: "message";
      message: Message;
    }
  | {
      type: "execution_step";
      id: string;
      planSummary: string;
      toolCalls: ToolCall[];
      toolResults: ToolResult[];
      internalThoughts?: string;
      timestamp: string;
    };

function parseToolResponses(content: string): Array<{ name: string; result?: string; error?: string; status: "success" | "error" }> {
  const responses: Array<{ name: string; result?: string; error?: string; status: "success" | "error" }> = [];
  const regex = /<tool_response\s+name="([^"]+)"\s*(?:status="([^"]+)")?\s*>([\s\S]*?)<\/tool_response>/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const isErrorStatus = match[2] === "error";
    const text = match[3].trim();
    if (isErrorStatus || text.startsWith("Erro:")) {
      responses.push({
        name,
        error: text.startsWith("Erro:") ? text.replace(/^Erro:\s*/, "") : text,
        status: "error",
      });
    } else {
      responses.push({
        name,
        result: text,
        status: "success",
      });
    }
  }
  return responses;
}

function buildTimelineItems(
  messages: Message[],
  isAgentRunning: boolean,
  runningToolsState?: Array<{
    name: string;
    params: Record<string, string>;
    result?: string;
    error?: string;
    status: "pending" | "success" | "error";
  }>
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const isDisplayableToolCall = (call: ToolCall) => call.name !== "final_answer";

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.internal) {
      continue;
    }

    if (msg.role === "user") {
      items.push({ type: "message", message: msg });
      continue;
    }

    if (msg.role === "assistant") {
      const toolCalls = McpEngine.parseXmlCommands(msg.content);
      if (toolCalls.length > 0) {
        const displayableToolCalls = toolCalls.filter(isDisplayableToolCall);
        if (displayableToolCalls.length === 0) {
          continue;
        }

        const nextMsg = messages[i + 1];
        let toolResults: ToolResult[];
        let hasToolResponse = false;

        if (nextMsg && nextMsg.role === "tool") {
          hasToolResponse = true;
          const parsedResults = parseToolResponses(nextMsg.content);
          toolResults = displayableToolCalls.map((call) => {
            const found = parsedResults.find((r) => r.name === call.name);
            if (found) {
              return {
                name: call.name,
                result: found.result,
                error: found.error,
                status: found.status,
              };
            }
            return {
              name: call.name,
              status: "pending" as const,
            };
          });
        } else {
          if (!isAgentRunning) {
            items.push({ type: "message", message: msg });
            continue;
          }

          toolResults = displayableToolCalls.map((call) => ({
            name: call.name,
            status: "pending" as const,
          }));
        }

        const planSummary = /<execution_plan\b[^>]*>([\s\S]*?)<\/execution_plan>/i.exec(msg.content)?.[1]?.trim() 
          || `Executar ${displayableToolCalls.length} ferramenta(s) MCP`;

        items.push({
          type: "execution_step",
          id: msg.id,
          planSummary,
          toolCalls: displayableToolCalls,
          toolResults,
          internalThoughts: undefined,
          timestamp: msg.timestamp,
        });

        if (hasToolResponse) {
          i++; // Skip the next message since it was consumed
        }
      } else {
        items.push({ type: "message", message: msg });
      }
      continue;
    }
  }

  if (isAgentRunning && runningToolsState && runningToolsState.length > 0) {
    const lastItem = items[items.length - 1];
    if (lastItem && lastItem.type === "execution_step") {
      lastItem.toolCalls = runningToolsState.map((ts) => ({
        name: ts.name,
        params: ts.params,
      }));
      lastItem.toolResults = runningToolsState.map((ts) => ({
        name: ts.name,
        result: ts.result,
        error: ts.error,
        status: ts.status === "pending" ? "pending" : ts.status === "success" ? "success" : "error",
      }));
    } else {
      items.push({
        type: "execution_step",
        id: "live-running-step",
        planSummary: "Executando ferramentas...",
        toolCalls: runningToolsState.map((ts) => ({
          name: ts.name,
          params: ts.params,
        })),
        toolResults: runningToolsState.map((ts) => ({
          name: ts.name,
          result: ts.result,
          error: ts.error,
          status: ts.status === "pending" ? "pending" : ts.status === "success" ? "success" : "error",
        })),
        timestamp: new Date().toISOString(),
      });
    }
  }

  return items;
}

export function ChatContainer({
  messages,
  onSendMessage,
  isAgentRunning,
  agentRunningStatus,
  runningToolsState,
  approvalRequest,
  currentSessionId,
  devModeEnabled,
  queuedInterventionCount,
  onApprovePlan,
  onRejectPlan,
  onCancelAgent,
  onQueueAgentMessage,
  budgetStats,
}: ChatContainerProps) {
  const { t } = useI18n();
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const statusLines = splitStatus(agentRunningStatus);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || approvalRequest) return;

    if (isAgentRunning) {
      onQueueAgentMessage(inputText.trim());
      setInputText("");
      return;
    }

    shouldStickToBottomRef.current = true;
    void Promise.resolve(onSendMessage(inputText.trim())).catch((error: unknown) => {
      console.error("Erro ao enviar mensagem para o agente:", error);
    });
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (isAgentRunning || approvalRequest) return;
    shouldStickToBottomRef.current = true;
    void Promise.resolve(onSendMessage(suggestion)).catch((error: unknown) => {
      console.error("Erro ao enviar sugestão para o agente:", error);
    });
  };

  const handleExportSession = (format: SessionExportFormat) => {
    if (!currentSessionId) return;

    try {
      SessionExportService.exportCurrentSession(currentSessionId, format);
    } catch (error) {
      console.error("Erro ao exportar sessão:", error);
    }
  };

  // Auto-resize textarea height as content changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
    }
  }, [inputText]);

  const handleMessagesScroll = () => {
    const element = messagesScrollRef.current;
    if (!element) return;

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 96;
  };

  // Scroll only when the user is already near the bottom. Status polling must not steal scroll.
  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAgentRunning, runningToolsState]);

  const suggestions = [
    {
      text: t.chat_suggestion_tabs,
      icon: <History className="w-4 h-4 text-[var(--theme-primary)]" />,
    },
    {
      text: t.chat_suggestion_search,
      icon: <Search className="w-4 h-4 text-[var(--theme-accent)]" />,
    },
    {
      text: t.chat_suggestion_screenshot,
      icon: <Camera className="w-4 h-4 text-purple-400" />,
    },
  ];

  const timelineItems = buildTimelineItems(messages, isAgentRunning, runningToolsState);

  return (
    <div className="flex flex-col flex-1 h-full bg-[var(--theme-bg)] text-[var(--theme-text)] overflow-hidden">
      {/* Messages Timeline */}
      <div
        ref={messagesScrollRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto p-4 flex flex-col gap-4"
      >
        {timelineItems.length === 0 ? (
          /* Empty/Welcome State */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto gap-6"
          >
            <div className="relative">
              <div className="w-18 h-18 rounded-full bg-[rgba(214,168,79,0.05)] flex items-center justify-center border border-[rgba(214,168,79,0.15)] overflow-hidden neon-pulse shadow-[0_0_20px_rgba(214,168,79,0.15)]">
                <img src="/logo.png" className="w-16 h-16 object-contain" alt="Browia Logo" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-display font-bold text-[var(--theme-primary-light)]">
                {t.chat_welcome_title}
              </h2>
              <p className="text-xs text-[var(--theme-muted)] mt-2">
                {t.chat_welcome_desc}
              </p>
            </div>
            
            <div className="flex flex-col gap-2 w-full text-left">
              <span className="text-[10px] font-bold text-[var(--theme-muted)] uppercase tracking-wider pl-1">
                {t.chat_suggestions_title}
              </span>
              {suggestions.map((suggestion, index) => (
                <motion.button
                  key={index}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + index * 0.08, duration: 0.25 }}
                  whileHover={{ scale: 1.015, borderColor: "rgba(214,168,79,0.4)" }}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => handleSuggestionClick(suggestion.text)}
                  disabled={isAgentRunning}
                  className="theme-card p-3 flex items-center gap-3 text-xs text-left cursor-pointer transition-all w-full text-[var(--theme-text)] border border-[rgba(214,168,79,0.1)] bg-[rgba(20,16,10,0.5)]"
                >
                  <div className="p-1.5 rounded bg-[var(--theme-surface-2)] shrink-0">
                    {suggestion.icon}
                  </div>
                  <span className="flex-1 font-medium">{suggestion.text}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
            {timelineItems.map((item) => {
              if (item.type === "message") {
                return (
                  <MessageItem
                    key={item.message.id}
                    message={item.message}
                  />
                );
              } else {
                return (
                  <ExecutionStepCard
                    key={item.id}
                    planSummary={item.planSummary}
                    toolCalls={item.toolCalls}
                    toolResults={item.toolResults}
                    internalThoughts={item.internalThoughts}
                    timestamp={item.timestamp}
                  />
                );
              }
            })}
          </AnimatePresence>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Agent Processing status overlay bar */}
      <AnimatePresence>
        {approvalRequest ? (
          <motion.div
            key="approval"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ExecutionApprovalPanel
              approvalRequest={approvalRequest}
              onApprove={onApprovePlan}
              onReject={onRejectPlan}
            />
          </motion.div>
        ) : isAgentRunning ? (
          <motion.div
            key="running"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-4 mb-2 p-3 rounded-lg border border-[rgba(214,168,79,0.2)] bg-[rgba(20,16,10,0.9)] flex items-center justify-between text-xs text-[var(--theme-text)]"
          >
            <div className="flex items-start gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--theme-primary)] shrink-0" />
              <span className="flex flex-col gap-1 font-mono">
                <span>{statusLines.main}</span>
                {statusLines.detail && (
                  <span className="text-[10px] leading-relaxed text-[var(--theme-muted)]">
                    {statusLines.detail}
                  </span>
                )}
              </span>
            </div>
            <button
              onClick={onCancelAgent}
              className="flex items-center gap-1 text-[var(--theme-danger)] hover:text-red-400 font-bold uppercase tracking-wider text-[10px] px-2.5 py-1 rounded bg-[rgba(215,78,53,0.1)] border border-[rgba(215,78,53,0.2)] transition-colors"
            >
              <X className="w-3 h-3" /> {t.chat_stop_button}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Input area */}
      <form onSubmit={handleSend} className="p-4 border-t border-[var(--theme-border)] bg-[rgba(15,11,6,0.3)]">
        {devModeEnabled && (
          <div className="mb-2 flex flex-col gap-2 rounded-lg border border-[rgba(214,168,79,0.16)] bg-[rgba(20,16,10,0.55)] px-3 py-2 text-[10px] text-[var(--theme-text)]">
            <div className="flex items-center justify-between gap-2 border-b border-[rgba(214,168,79,0.1)] pb-1.5">
              <div className="flex items-center gap-1">
                <span className="font-bold uppercase tracking-wider text-[var(--theme-primary-light)]">{t.dev_mode_label}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportSession("json")}
                  disabled={!currentSessionId}
                  className="theme-secondary-button flex items-center gap-1 px-2 py-0.5 text-[9px]"
                >
                  <Download className="h-2.5 w-2.5" />
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => handleExportSession("txt")}
                  disabled={!currentSessionId}
                  className="theme-secondary-button flex items-center gap-1 px-2 py-0.5 text-[9px]"
                >
                  <Download className="h-2.5 w-2.5" />
                  TXT
                </button>
              </div>
            </div>
            
            {budgetStats ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[9px] text-[var(--theme-muted)]">
                <div>Requests: <span className="text-yellow-400 font-bold">{budgetStats.requestCount}</span></div>
                <div>Tokens: <span className="text-yellow-400 font-bold">{budgetStats.totalTokens} / {budgetStats.maxTokens}</span></div>
                {budgetStats.lastInputTokens !== undefined && budgetStats.lastOutputTokens !== undefined && (
                  <div>Último I/O: <span className="text-cyan-400 font-bold">{budgetStats.lastInputTokens}</span> / <span className="text-purple-400 font-bold">{budgetStats.lastOutputTokens}</span></div>
                )}
                {budgetStats.lastTokensPerSecond !== undefined && (
                  <div>Velocidade: <span className="text-green-400 font-bold">{budgetStats.lastTokensPerSecond} tok/s</span></div>
                )}
                {budgetStats.lastCompressedTool && (
                  <>
                    <div className="truncate">Tool: <span className="text-[var(--theme-primary-light)]">{budgetStats.lastCompressedTool}</span></div>
                    <div>Comprimido: <span className="text-green-400 font-bold">{budgetStats.compressionRatio}% salvo</span> ({Math.round(budgetStats.rawSize / 102.4) / 10}KB → {Math.round(budgetStats.compressedSize / 102.4) / 10}KB)</div>
                  </>
                )}
              </div>
            ) : (
              <div className="text-[9px] text-[var(--theme-muted)] italic">Nenhuma estatística de consumo gravada ainda nesta tarefa.</div>
            )}
          </div>
        )}
        {isAgentRunning && !approvalRequest && (
          <div className="mb-2 rounded-lg border border-[rgba(214,168,79,0.16)] bg-[rgba(20,16,10,0.45)] px-3 py-2 text-[10px] text-[var(--theme-muted)]">
            {queuedInterventionCount > 0
              ? t.chat_queued_intervention_count.replace("{count}", String(queuedInterventionCount))
              : t.chat_queue_intervention_hint}
          </div>
        )}
        <div className="flex gap-2 relative items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              approvalRequest
                ? t.status_awaiting_approval
                : isAgentRunning
                  ? t.chat_input_placeholder_queue
                  : t.chat_input_placeholder
            }
            disabled={Boolean(approvalRequest)}
            className="input-neon text-sm flex-1 resize-none min-h-[38px] max-h-[140px] py-2 overflow-y-auto leading-normal animate-none"
            style={{ paddingRight: "48px" }}
          />
          <button
            type="submit"
            disabled={Boolean(approvalRequest) || !inputText.trim()}
            className="theme-primary-button w-8 h-8 absolute right-1.5 bottom-1.5 flex items-center justify-center rounded-lg aspect-square text-[var(--theme-on-primary)] shadow-none"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

function splitStatus(status: string): { main: string; detail: string | null } {
  const [main, ...details] = status.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    main: main || status,
    detail: details.length > 0 ? details.join(" ") : null,
  };
}
