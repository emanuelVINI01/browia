import type { Session } from "../services/storageService";
import { Plus, Trash2, MessageSquare, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "../i18n";

interface SessionListProps {
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  sessions: Session[];
  onDeleteSession: (id: string) => void;
}

export function SessionList({
  currentSessionId,
  onSelectSession,
  onNewSession,
  sessions,
  onDeleteSession,
}: SessionListProps) {
  const { t } = useI18n();
  const formatDate = (isoStr: string) => {
    try {
      const date = new Date(isoStr);
      return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 256, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: "tween", duration: 0.25, ease: "easeInOut" }}
      className="flex flex-col h-full bg-[var(--theme-surface)] border-r border-[var(--theme-border)] text-[var(--theme-text)] overflow-hidden shrink-0"
    >
      {/* Header */}
      <div className="p-4 border-b border-[var(--theme-border)] flex items-center justify-between shrink-0">
        <h3 className="font-display font-bold text-sm text-[var(--theme-primary-light)] tracking-wide uppercase">
          {t.sidebar_title}
        </h3>
        <button
          onClick={onNewSession}
          title={t.sidebar_new_session}
          className="theme-secondary-button p-1.5 flex items-center justify-center rounded-lg"
        >
          <Plus className="w-4 h-4 text-[var(--theme-primary)]" />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {sessions.length === 0 ? (
          <div className="text-xs text-[var(--theme-muted)] text-center py-8 px-4">
            {t.sidebar_empty_sessions}
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {sessions
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
              .map((session) => {
                const isActive = session.id === currentSessionId;
                return (
                  <motion.div
                    key={session.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.18 }}
                    className={`group relative flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
                      isActive
                        ? "text-[var(--theme-text)] font-semibold"
                        : "hover:bg-[rgba(255,255,255,0.03)] border border-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
                    }`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    {/* Sliding capsule indicator */}
                    {isActive && (
                      <motion.div
                        layoutId="active-session-indicator"
                        className="absolute inset-0 bg-[rgba(214,168,79,0.12)] border border-[rgba(214,168,79,0.25)] rounded-lg -z-10"
                        transition={{ type: "spring", stiffness: 350, damping: 28 }}
                      />
                    )}

                    <div className="flex items-start gap-2 overflow-hidden flex-1 mr-1">
                      <MessageSquare className={`w-4 h-4 shrink-0 mt-0.5 ${isActive ? "text-[var(--theme-primary)]" : "text-[var(--theme-muted)]"}`} />
                      <div className="flex flex-col overflow-hidden text-left">
                        <span className="text-xs truncate block">{session.title}</span>
                        <span className="text-[10px] text-[var(--theme-muted)] flex items-center gap-1 mt-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDate(session.updatedAt)}
                        </span>
                      </div>
                    </div>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      title={t.sidebar_delete_session}
                      className="opacity-0 group-hover:opacity-100 hover:text-[var(--theme-danger)] transition-all p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                );
              })}
          </AnimatePresence>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-[var(--theme-border)] text-[10px] text-[var(--theme-muted)] text-center shrink-0">
        {t.sidebar_version}
      </div>
    </motion.div>
  );
}
