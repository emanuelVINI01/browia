import { Check, X, ArrowRight, ShieldAlert } from "lucide-react";
import type { ApprovalRequestState } from "../hooks/useAgentSession";
import { useI18n } from "../i18n";

interface ExecutionApprovalPanelProps {
  approvalRequest: ApprovalRequestState;
  onApprove: () => void;
  onReject: () => void;
}

function getDetailedActionInfo(step: { tool: string; purpose: string; params: Record<string, string> }) {
  const params = step.params || {};
  let actionTitle: string;
  let targetDesc: string;

  switch (step.tool) {
    case "interact_element": {
      const act = params.action || "click";
      const val = params.value ? ` "${params.value}"` : "";
      actionTitle = act === "click" ? "Clicar no elemento" : act === "type" ? `Digitar${val} no campo` : act === "clear" ? "Limpar campo" : "Passar mouse sobre o elemento";
      targetDesc = params.vortexId ? `ID do Elemento Semântico: ${params.vortexId}` : "Elemento na página";
      break;
    }
    case "interact_cached_element": {
      const act = params.action || "click";
      const val = params.value ? ` "${params.value}"` : "";
      actionTitle = act === "click" ? "Clicar no elemento salvo" : act === "type" ? `Digitar${val} no campo salvo` : "Interagir com elemento salvo";
      targetDesc = `Chave do Elemento: ${params.key}`;
      break;
    }
    case "navigate_tab":
      actionTitle = "Navegar para nova URL";
      targetDesc = params.url || "URL de destino";
      break;
    case "reload_tab":
      actionTitle = "Recarregar página";
      targetDesc = "Aba ativa";
      break;
    case "press_key":
      actionTitle = `Pressionar tecla "${params.key}"`;
      targetDesc = "Elemento focado";
      break;
    case "scroll_page":
      actionTitle = `Rolar página (X: ${params.x || 0}, Y: ${params.y || 0})`;
      targetDesc = "Aba ativa";
      break;
    case "alter_element_dom":
      actionTitle = "Modificar propriedades do elemento DOM";
      targetDesc = `vortexId: ${params.vortexId}`;
      break;
    case "download_file":
      actionTitle = "Baixar arquivo";
      targetDesc = params.filename || params.url || "Arquivo solicitado";
      break;
    case "http_request":
      actionTitle = `Requisição HTTP ${params.method || 'GET'}`;
      targetDesc = params.url || "Endpoint externo";
      break;
    default:
      actionTitle = `Executar ferramenta: ${step.tool}`;
      targetDesc = Object.keys(params).length > 0 ? JSON.stringify(params) : "Aba ativa";
  }

  return { actionTitle, targetDesc };
}

export function ExecutionApprovalPanel({
  approvalRequest,
  onApprove,
  onReject,
}: ExecutionApprovalPanelProps) {
  const { t } = useI18n();

  const steps = approvalRequest.plan.steps || [];
  const nextStep = steps[0] || { tool: "unknown", purpose: "Executar ação MCP", params: {} };
  const { actionTitle, targetDesc } = getDetailedActionInfo(nextStep);
  const remainingSteps = steps.slice(1);

  return (
    <div className="mx-4 mb-3 rounded-xl border border-[rgba(214,168,79,0.3)] bg-[rgba(20,16,10,0.98)] p-4 text-xs text-[var(--theme-text)] shadow-[0_12px_36px_rgba(0,0,0,0.45)]">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between border-b border-[rgba(214,168,79,0.1)] pb-2.5">
        <div className="flex items-center gap-2 text-[var(--theme-primary-light)]">
          <ShieldAlert className="h-4 w-4 text-[var(--theme-primary)] shrink-0" />
          <span className="font-display font-bold uppercase tracking-wider text-[10px]">
            {t.approval_title}
          </span>
        </div>
        <span className="rounded bg-[rgba(214,168,79,0.12)] px-2 py-0.5 font-mono text-[9px] text-[var(--theme-primary-light)] uppercase tracking-wider">
          Ação Sensível
        </span>
      </div>

      {/* Main Info Card */}
      <div className="mb-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-white/[0.02] p-3 flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold text-[var(--theme-muted)] uppercase tracking-wider">Ação Proposta</span>
          <span className="text-sm font-semibold text-[rgba(255,255,255,0.95)]">{actionTitle}</span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold text-[var(--theme-muted)] uppercase tracking-wider">Motivo</span>
          <span className="text-[11px] leading-relaxed text-[var(--theme-text)]">{nextStep.purpose || approvalRequest.plan.summary}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-1 pt-1.5 border-t border-[rgba(255,255,255,0.03)]">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[9px] font-bold text-[var(--theme-muted)] uppercase tracking-wider">Alvo</span>
            <span className="text-[10px] font-mono text-[var(--theme-primary-light)] truncate" title={targetDesc}>{targetDesc}</span>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[9px] font-bold text-[var(--theme-muted)] uppercase tracking-wider">Ferramenta</span>
            <span className="text-[10px] font-mono text-purple-300 truncate" title={nextStep.tool}>{nextStep.tool}</span>
          </div>
        </div>
      </div>

      {/* Planned Remaining Path */}
      {remainingSteps.length > 0 && (
        <div className="mb-3.5">
          <span className="block text-[9px] font-bold text-[var(--theme-muted)] uppercase tracking-wider mb-1.5 pl-0.5">
            Caminho Planejado ({remainingSteps.length} passagens seguintes)
          </span>
          <div className="flex flex-col gap-1 max-h-20 overflow-y-auto pr-1">
            {remainingSteps.map((step, idx) => (
              <div
                key={`${step.tool}-${idx}`}
                className="flex items-center gap-1.5 text-[10px] text-[var(--theme-muted)] bg-black/15 px-2 py-1 rounded"
              >
                <ArrowRight className="h-3 w-3 text-[var(--theme-primary)] shrink-0" />
                <span className="font-mono font-bold text-[var(--theme-primary-light)] shrink-0">{step.tool}</span>
                <span className="truncate flex-1">— {step.purpose}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 border-t border-[rgba(214,168,79,0.08)] pt-2.5">
        <button
          type="button"
          onClick={onReject}
          className="flex items-center gap-1.5 rounded-lg border border-[rgba(215,78,53,0.3)] bg-[rgba(215,78,53,0.06)] hover:bg-[rgba(215,78,53,0.12)] px-4 py-2 font-bold uppercase tracking-wider text-[10px] text-[var(--theme-danger)] transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
        >
          <X className="h-3.5 w-3.5" />
          {t.approval_deny}
        </button>
        <button
          type="button"
          onClick={onApprove}
          className="flex items-center gap-1.5 rounded-lg border border-[rgba(30,226,138,0.35)] bg-[rgba(30,226,138,0.08)] hover:bg-[rgba(30,226,138,0.15)] px-4 py-2 font-bold uppercase tracking-wider text-[10px] text-[var(--theme-accent)] transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
        >
          <Check className="h-3.5 w-3.5" />
          {t.approval_approve}
        </button>
      </div>
    </div>
  );
}
