import { useState } from "react";
import { useAgentSession } from "./hooks/useAgentSession";
import { SessionList } from "./components/SessionList";
import { ChatContainer } from "./components/ChatContainer";
import { SettingsPanel } from "./components/SettingsPanel";
import { Settings, Bot, Menu, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "./i18n";

function App() {
  const { t } = useI18n();
  const {
    provider,
    model,
    sessions,
    currentSessionId,
    isAgentRunning,
    agentRunningStatus,
    runningToolsState,
    approvalRequest,
    syncSessionsState,
    handleSelectSession,
    handleNewSession,
    handleDeleteSession,
    handleCancelAgent,
    handleApprovePlan,
    handleRejectPlan,
    handleSendMessage,
    handleProviderChange,
    handleModelChange,
  } = useAgentSession();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const activeMessages = currentSession ? currentSession.messages : [];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--theme-bg)] font-sans text-[var(--theme-text)]">
      {/* App Header */}
      <header className="flex justify-between items-center px-4 py-3 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] select-none shrink-0">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={t.header_toggle_history}
            className="theme-secondary-button p-2 flex items-center justify-center rounded-lg"
          >
            <Menu className="w-4 h-4 text-[var(--theme-primary)]" />
          </button>
          
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-[rgba(214,168,79,0.1)] flex items-center justify-center border border-[rgba(214,168,79,0.2)]">
              <Bot className="w-4.5 h-4.5 text-[var(--theme-primary)]" />
            </div>
            <h1 className="text-lg font-display font-black tracking-wider bg-gradient-to-r from-[var(--theme-primary-light)] to-[var(--theme-primary)] bg-clip-text text-transparent my-0">
              BROWIA
            </h1>
          </div>
        </div>

        {/* Status indicator / Loaded Model info */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--theme-surface-2)] border border-[var(--theme-border)] text-xs">
          <div className={`w-2 h-2 rounded-full ${isAgentRunning ? "bg-yellow-500 pulse-live" : "bg-[var(--theme-accent)] pulse-live"}`} />
          <span className="font-semibold text-[var(--theme-muted)] uppercase tracking-wider text-[10px]">
            {isAgentRunning ? t.header_active : t.header_ready}
          </span>
          <span className="text-[var(--theme-border)]">|</span>
          <Cpu className="w-3.5 h-3.5 text-[var(--theme-primary)]" />
          <span className="font-mono font-medium text-[rgba(255,255,255,0.95)]">
            {provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : "Ollama"}: {model}
          </span>
        </div>

        <div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            title={t.header_settings}
            className="theme-secondary-button p-2 flex items-center justify-center rounded-lg"
          >
            <Settings className="w-4 h-4 text-[var(--theme-primary)]" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <AnimatePresence mode="popLayout">
          {isSidebarOpen && (
            <SessionList
              currentSessionId={currentSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={() => handleNewSession()}
              sessions={sessions}
              onDeleteSession={handleDeleteSession}
            />
          )}
        </AnimatePresence>

        {/* Chat Interface */}
        <ChatContainer
          messages={activeMessages}
          onSendMessage={handleSendMessage}
          isAgentRunning={isAgentRunning}
          agentRunningStatus={agentRunningStatus}
          runningToolsState={runningToolsState}
          approvalRequest={approvalRequest}
          onApprovePlan={handleApprovePlan}
          onRejectPlan={handleRejectPlan}
          onCancelAgent={handleCancelAgent}
        />

        {/* Settings Overlay Modal */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            >
              <SettingsPanel
                onClose={() => {
                  setIsSettingsOpen(false);
                  syncSessionsState();
                }}
                provider={provider}
                model={model}
                onProviderChange={handleProviderChange}
                onModelChange={handleModelChange}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
