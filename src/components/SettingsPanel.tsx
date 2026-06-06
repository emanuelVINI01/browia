import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Languages, MessageSquareText, Settings, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
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
} from "./settings/SettingsSections";

interface SettingsPanelProps {
  onClose: () => void;
  provider: AiProvider;
  model: string;
  onProviderChange: (provider: AiProvider) => void;
  onModelChange: (model: string) => void;
}

type SettingsTab = "api" | "google" | "language" | "prompt";

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

  const tabs = useMemo<SettingsTabItem[]>(() => {
    const providerLabel = provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : "Ollama";
    return [
      { id: "api", label: t.settings_tab_api, icon: KeyRound },
      { id: "google", label: providerLabel, icon: Sparkles },
      { id: "language", label: t.settings_tab_language, icon: Languages },
      { id: "prompt", label: t.settings_tab_prompt, icon: MessageSquareText },
    ];
  }, [t.settings_tab_api, t.settings_tab_language, t.settings_tab_prompt, provider]);

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
      className="glass-surface flex max-h-[86vh] w-full max-w-3xl flex-col gap-4 overflow-hidden rounded-xl border border-[var(--theme-border)] p-5 text-[var(--theme-text)]"
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

          {activeTab === "google" && (
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
