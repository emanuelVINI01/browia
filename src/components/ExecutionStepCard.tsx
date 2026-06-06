import { useState } from "react";
import { ChevronDown, ChevronUp, Terminal, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ToolCall } from "../services/mcpEngine";

export interface ToolResult {
  name: string;
  result?: string;
  error?: string;
  status: "success" | "error" | "pending";
}

interface ElementInventoryItem {
  tag?: string;
  vortexId?: number;
  text?: string;
  attributes?: Record<string, string | boolean | number>;
}

interface ChromeTabItem {
  id?: number;
  title?: string;
  url?: string;
}


interface ExecutionStepCardProps {
  planSummary: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  internalThoughts?: string;
  timestamp: string;
}

export function ExecutionStepCard({
  planSummary,
  toolCalls,
  toolResults,
  internalThoughts,
  timestamp,
}: ExecutionStepCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Determine overall status
  const hasError = toolResults.some((r) => r.status === "error");
  const isPending = toolResults.some((r) => r.status === "pending") || toolResults.length < toolCalls.length;
  
  const statusIcon = isPending ? (
    <Loader2 className="h-4.5 w-4.5 text-yellow-500 animate-spin shrink-0" />
  ) : hasError ? (
    <XCircle className="h-4.5 w-4.5 text-[var(--theme-danger)] shrink-0" />
  ) : (
    <CheckCircle2 className="h-4.5 w-4.5 text-[var(--theme-accent)] shrink-0" />
  );

  const statusTextClass = isPending
    ? "text-yellow-400"
    : hasError
    ? "text-[var(--theme-danger)]"
    : "text-[var(--theme-accent)]";

  const formatTime = (isoStr: string) => {
    try {
      return new Date(isoStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "";
    }
  };

  const tryFormatJson = (text: string) => {
    if (!text) return "";
    try {
      const parsed = JSON.parse(text);
      
      // If it is element inventory or search list, format it as clean summary rows
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) return "[] (Retorno vazio)";
        
        // Element Query Result Format:
        if (parsed[0] && typeof parsed[0] === "object" && ("vortexId" in parsed[0] || "tag" in parsed[0])) {
          return parsed.map((item: ElementInventoryItem) => {
            const attrs = item.attributes || {};
            const desc = attrs.placeholder || attrs.aria_label || attrs.name || attrs.id || attrs.type || "";
            const textContent = item.text ? ` "${item.text.substring(0, 30)}"` : "";
            return `[${item.tag || "elemento"}] vortexId: ${item.vortexId || "?"} ${desc ? `(${desc})` : ""}${textContent}`;
          }).join("\n");
        }
        
        // Chrome Tabs Format:
        if (parsed[0] && typeof parsed[0] === "object" && "url" in parsed[0] && "title" in parsed[0]) {
          return parsed.map((tab: ChromeTabItem) => `Aba ID ${tab.id}: "${tab.title}" — URL: ${tab.url}`).join("\n");
        }
      }
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  };

  return (
    <div className="w-full flex flex-col gap-1.5 my-1.5">
      {/* Outer Card Header */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.03)] cursor-pointer select-none transition-all duration-150"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {statusIcon}
          <div className="min-w-0 flex-1">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${statusTextClass}`}>
              {isPending ? "Executando" : hasError ? "Ação com Falhas" : "Ação Concluída"}
            </span>
            <p className="text-xs text-[var(--theme-text)] font-medium truncate mt-0.5" title={planSummary}>
              {planSummary}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] text-[var(--theme-muted)] font-mono">
            {formatTime(timestamp)}
          </span>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-[var(--theme-muted)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--theme-muted)]" />
          )}
        </div>
      </div>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-3.5 rounded-lg border border-[rgba(255,255,255,0.03)] bg-black/25 flex flex-col gap-3.5">
              {/* Internal Thoughts / Reasoning */}
              {internalThoughts && (
                <div className="flex flex-col gap-1 border-b border-[rgba(255,255,255,0.04)] pb-2.5">
                  <span className="text-[9px] font-bold text-[var(--theme-muted)] uppercase tracking-wider">
                    Raciocínio Interno do Agente
                  </span>
                  <p className="text-[11px] leading-relaxed text-[var(--theme-muted)] whitespace-pre-wrap">
                    {internalThoughts}
                  </p>
                </div>
              )}

              {/* Tools Executed List */}
              <div className="flex flex-col gap-2.5">
                <span className="text-[9px] font-bold text-[var(--theme-muted)] uppercase tracking-wider pl-0.5">
                  Logs de Ferramentas ({toolCalls.length})
                </span>
                
                {toolCalls.map((call, idx) => {
                  const state = toolResults.find((r) => r.name === call.name) || {
                    name: call.name,
                    status: "pending" as const,
                  };

                  const isToolPending = state.status === "pending";
                  const isToolError = state.status === "error";

                  return (
                    <div
                      key={`${call.name}-${idx}`}
                      className="border border-[rgba(255,255,255,0.03)] rounded-md bg-white/[0.01] p-2.5 flex flex-col gap-2"
                    >
                      {/* Tool name & Status */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-purple-300">
                          <Terminal className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                          {call.name}
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                            isToolPending
                              ? "bg-yellow-500/10 text-yellow-400"
                              : isToolError
                              ? "bg-[rgba(215,78,53,0.1)] text-[var(--theme-danger)]"
                              : "bg-[rgba(30,226,138,0.1)] text-[var(--theme-accent)]"
                          }`}
                        >
                          {isToolPending ? "Executando" : isToolError ? "Erro" : "Sucesso"}
                        </span>
                      </div>

                      {/* Tool parameters */}
                      {Object.keys(call.params || {}).length > 0 && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[8px] font-bold text-[var(--theme-muted)] uppercase tracking-wider">Parâmetros</span>
                          <div className="bg-black/30 p-2 rounded text-[10px] font-mono text-[rgba(255,255,255,0.85)] max-h-24 overflow-y-auto whitespace-pre-wrap">
                            {JSON.stringify(call.params, null, 2)}
                          </div>
                        </div>
                      )}

                      {/* Tool Result/Output */}
                      {!isToolPending && (state.result || state.error) && (
                        <div className="flex flex-col gap-1 mt-1 border-t border-[rgba(255,255,255,0.02)] pt-1.5">
                          <span className="text-[8px] font-bold text-[var(--theme-muted)] uppercase tracking-wider">
                            {isToolError ? "Saída de Erro" : "Retorno / Payload"}
                          </span>
                          <pre className={`text-[10px] font-mono p-2 rounded max-h-40 overflow-auto border whitespace-pre bg-black/40 ${
                            isToolError 
                              ? "text-[var(--theme-danger)] border-[rgba(215,78,53,0.12)]" 
                              : "text-[rgba(255,255,255,0.7)] border-[rgba(214,168,79,0.08)]"
                          }`}>
                            <code>{tryFormatJson(state.result || state.error || "")}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
