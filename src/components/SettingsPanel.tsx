import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Languages, MessageSquareText, Settings, Sparkles, ShieldAlert } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "../i18n";
import {
  type AiProvider,
  getDefaultModel,
  getPresetIds,
} from "../config/aiModels";
import { StorageService, type AppSettings } from "../services/storageService";
import { OllamaService } from "../services/ollamaService";
import { SettingsSidebar, type SettingsTabItem } from "./settings/SettingsSidebar";
import {
  ApiSettingsSection,
  LanguageSettingsSection,
  ModelSettingsSection,
  PromptSettingsSection,
  GeneralSettingsSection,
} from "./settings/SettingsSections";

interface SettingsPanelProps {
  onClose: () => void;
  provider: AiProvider;
  model: string;
  onProviderChange: (provider: AiProvider) => void;
  onModelChange: (model: string) => void;
}

type SettingsTab = "api" | "models" | "general" | "language" | "prompt";

export function SettingsPanel({
  onClose,
  provider,
  model,
  onProviderChange,
  onModelChange,
}: SettingsPanelProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>("api");
  const [settings, setSettings] = useState<AppSettings>(() => StorageService.getSettings());
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingOllama, setLoadingOllama] = useState(false);
  const [customModel, setCustomModel] = useState(() => (isKnownModel(provider, model, []) ? "" : model));
  const [isCustomModelActive, setIsCustomModelActive] = useState(() => !isKnownModel(provider, model, []));
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);

  const tabs = useMemo<SettingsTabItem[]>(() => {
    return [
      { id: "api", label: t.settings_tab_api, icon: KeyRound },
      { id: "models", label: t.settings_tab_models, icon: Sparkles },
      { id: "general", label: t.settings_tab_general, icon: ShieldAlert },
      { id: "language", label: t.settings_tab_language, icon: Languages },
      { id: "prompt", label: t.settings_tab_prompt, icon: MessageSquareText },
    ];
  }, [t.settings_tab_api, t.settings_tab_general, t.settings_tab_language, t.settings_tab_models, t.settings_tab_prompt]);

  const fetchOllamaModels = useCallback(async (endpoint: string) => {
    setLoadingOllama(true);
    try {
      const models = await OllamaService.listModels(endpoint);
      setOllamaModels(models);
      if (provider === "ollama") {
        const hasModel = models.includes(model);
        setCustomModel(hasModel ? "" : model);
        setIsCustomModelActive(!hasModel);
      }
    } catch {
      setMessage({ text: t.settings_error_ollama, type: "error" });
    } finally {
      setLoadingOllama(false);
    }
  }, [model, provider, t.settings_error_ollama]);

  useEffect(() => {
    const isPreset = isKnownModel(provider, model, ollamaModels);
    Promise.resolve().then(() => {
      setIsCustomModelActive(!isPreset);
      setCustomModel(isPreset ? "" : model);
    });
  }, [model, ollamaModels, provider]);

  useEffect(() => {
    if (provider === "ollama") {
      Promise.resolve().then(() => {
        void fetchOllamaModels(settings.ollamaEndpoint);
      });
    }
  }, [fetchOllamaModels, provider, settings.ollamaEndpoint]);

  const handleProviderSelect = (nextProvider: AiProvider) => {
    onProviderChange(nextProvider);
    StorageService.saveSelectedProvider(nextProvider);

    const savedModel = StorageService.getSelectedModel(nextProvider);
    const nextModel = isKnownModel(nextProvider, savedModel, ollamaModels)
      ? savedModel
      : getDefaultModel(nextProvider, ollamaModels);

    onModelChange(nextModel);
    setIsCustomModelActive(false);
    setCustomModel("");

    if (nextProvider === "ollama") {
      void fetchOllamaModels(settings.ollamaEndpoint);
    }
  };

  const handleConfirmWarning = () => {
    setSettings((current) => ({ ...current, autoApproveSensitive: true }));
    setIsWarningModalOpen(false);
  };

  const handleCancelWarning = () => {
    setSettings((current) => ({ ...current, autoApproveSensitive: false }));
    setIsWarningModalOpen(false);
  };

  const handleSaveSettings = () => {
    StorageService.saveSettings(settings);

    const activeModel = resolveActiveModel({
      provider,
      model,
      customModel,
      isCustomModelActive,
      ollamaModels,
    });

    StorageService.saveSelectedModel(provider, activeModel);
    onModelChange(activeModel);

    setMessage({ text: t.settings_success_message, type: "success" });
    window.setTimeout(() => setMessage(null), 3000);
  };

  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0, y: 15 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.95, opacity: 0, y: 15 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="glass-surface flex max-h-[86vh] w-full max-w-3xl flex-col gap-4 overflow-hidden rounded-xl border border-[var(--theme-border)] p-5 text-[var(--theme-text)] relative"
    >
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] pb-3">
        <h2 className="flex items-center gap-2 text-xl font-display font-semibold text-[var(--theme-primary)]">
          <Settings className="h-5 w-5" />
          {t.settings_title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-semibold text-[var(--theme-muted)] transition-colors hover:text-[var(--theme-text)]"
        >
          {t.settings_close}
        </button>
      </div>

      {message && (
        <div
          className={`rounded-lg p-3 text-sm font-medium ${
            message.type === "success"
              ? "border border-[rgba(30,226,138,0.3)] bg-[rgba(30,226,138,0.1)] text-[var(--theme-accent)]"
              : "border border-[rgba(215,78,53,0.3)] bg-[rgba(215,78,53,0.1)] text-[var(--theme-danger)]"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
        <SettingsSidebar
          tabs={tabs}
          activeTab={activeTab}
          onSelect={(tabId) => setActiveTab(tabId as SettingsTab)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {activeTab === "api" && (
            <ApiSettingsSection
              provider={provider}
              settings={settings}
              setSettings={setSettings}
              loadingOllama={loadingOllama}
              onProviderSelect={handleProviderSelect}
              onRefreshOllama={() => fetchOllamaModels(settings.ollamaEndpoint)}
            />
          )}

          {activeTab === "models" && (
            <ModelSettingsSection
              provider={provider}
              model={model}
              ollamaModels={ollamaModels}
              customModel={customModel}
              isCustomModelActive={isCustomModelActive}
              loadingOllama={loadingOllama}
              onModelChange={onModelChange}
              onCustomModelChange={setCustomModel}
              onToggleCustomModel={() => setIsCustomModelActive((current) => !current)}
            />
          )}

          {activeTab === "general" && (
            <GeneralSettingsSection
              settings={settings}
              setSettings={setSettings}
              onShowWarning={() => setIsWarningModalOpen(true)}
            />
          )}

          {activeTab === "language" && (
            <LanguageSettingsSection settings={settings} setSettings={setSettings} />
          )}

          {activeTab === "prompt" && (
            <PromptSettingsSection settings={settings} setSettings={setSettings} />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleSaveSettings}
        className="theme-primary-button w-full py-2.5 text-sm"
      >
        {t.settings_save_button}
      </button>

      <AnimatePresence>
        {isWarningModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-md z-[60] flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="theme-card max-w-md w-full p-6 border border-[var(--theme-danger)]/40 bg-[var(--theme-surface)] shadow-[0_0_50px_rgba(215,78,53,0.15)] flex flex-col gap-4"
            >
              <h3 className="text-lg font-display font-extrabold text-[var(--theme-danger)] flex items-center gap-2">
                <ShieldAlert className="h-6 w-6 text-[var(--theme-danger)] animate-pulse" />
                {t.auto_approve_modal_title}
              </h3>
              
              <p className="text-sm font-medium text-[var(--theme-text)] leading-relaxed">
                {t.auto_approve_modal_warning}
              </p>
              
              <div className="bg-black/30 p-3 rounded-lg border border-[var(--theme-border)] font-sans text-xs text-[var(--theme-muted)] whitespace-pre-line leading-relaxed">
                {t.auto_approve_modal_risk_list}
              </div>
              
              <div className="flex flex-col sm:flex-row gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleConfirmWarning}
                  className="flex-1 py-2 px-3 rounded-lg bg-[var(--theme-danger)] hover:bg-[var(--theme-danger)]/90 text-white font-bold text-xs transition-colors cursor-pointer"
                >
                  {t.auto_approve_modal_confirm}
                </button>
                <button
                  type="button"
                  onClick={handleCancelWarning}
                  className="py-2 px-3 rounded-lg theme-secondary-button font-bold text-xs transition-colors cursor-pointer"
                >
                  {t.auto_approve_modal_cancel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function isKnownPreset(provider: AiProvider, model: string): boolean {
  if (provider === "ollama") {
    return false;
  }

  return getPresetIds(provider).includes(model);
}

function isKnownModel(provider: AiProvider, model: string, ollamaModels: string[]): boolean {
  if (provider === "ollama") {
    return ollamaModels.includes(model);
  }

  return isKnownPreset(provider, model);
}

function resolveActiveModel(input: {
  provider: AiProvider;
  model: string;
  customModel: string;
  isCustomModelActive: boolean;
  ollamaModels: string[];
}): string {
  if (input.isCustomModelActive && input.customModel.trim()) {
    return input.customModel.trim();
  }

  if (input.provider === "ollama") {
    return input.ollamaModels.includes(input.model)
      ? input.model
      : getDefaultModel(input.provider, input.ollamaModels);
  }

  return isKnownPreset(input.provider, input.model)
    ? input.model
    : getDefaultModel(input.provider);
}
