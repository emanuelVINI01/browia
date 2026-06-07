import type { Dispatch, SetStateAction } from "react";
import { Cpu, Globe, Info, Key, MessageSquareText, RefreshCw, Server } from "lucide-react";
import { LANGUAGES, type SupportedLanguage, useI18n } from "../../i18n";
import type { AppSettings } from "../../services/storageService";
import {
  type AiProvider,
  geminiModels,
  getDefaultModel,
  groqModels,
  openAiModels,
} from "../../config/aiModels";

interface ApiSettingsSectionProps {
  provider: AiProvider;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  loadingOllama: boolean;
  onProviderSelect: (provider: AiProvider) => void;
  onRefreshOllama: () => void;
}

interface ModelSettingsSectionProps {
  provider: AiProvider;
  model: string;
  ollamaModels: string[];
  customModel: string;
  isCustomModelActive: boolean;
  loadingOllama: boolean;
  onModelChange: (model: string) => void;
  onCustomModelChange: (model: string) => void;
  onToggleCustomModel: () => void;
}

interface LanguageSettingsSectionProps {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
}

interface PromptSettingsSectionProps {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
}

export function ApiSettingsSection({
  provider,
  settings,
  setSettings,
  loadingOllama,
  onProviderSelect,
  onRefreshOllama,
}: ApiSettingsSectionProps) {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title={t.settings_api_title} description={t.settings_api_desc} />

      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
          {t.settings_provider_label}
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["openai", "gemini", "groq", "ollama"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onProviderSelect(item)}
              className={`rounded-lg border p-2 text-sm font-bold transition-all ${
                provider === item
                  ? "border-[var(--theme-primary)] bg-[rgba(214,168,79,0.15)] text-[var(--theme-primary-light)]"
                  : "border-transparent bg-[var(--theme-surface-2)] text-[var(--theme-muted)] hover:bg-[rgba(255,255,255,0.05)]"
              }`}
            >
              {getProviderLabel(item)}
            </button>
          ))}
        </div>
      </div>

      {provider === "openai" && (
        <LabeledInput
          icon={Key}
          label={t.settings_openai_key}
          type="password"
          placeholder="sk-..."
          value={settings.openaiApiKey}
          onChange={(value) => setSettings((current) => ({ ...current, openaiApiKey: value }))}
        />
      )}

      {provider === "gemini" && (
        <LabeledInput
          icon={Key}
          label={t.settings_gemini_key}
          type="password"
          placeholder="AIzaSy..."
          value={settings.geminiApiKey}
          onChange={(value) => setSettings((current) => ({ ...current, geminiApiKey: value }))}
        />
      )}

      {provider === "groq" && (
        <LabeledInput
          icon={Key}
          label={t.settings_groq_key}
          type="password"
          placeholder="gsk_..."
          value={settings.groqApiKey}
          onChange={(value) => setSettings((current) => ({ ...current, groqApiKey: value }))}
        />
      )}

      {provider === "ollama" && (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1 text-xs font-semibold text-[var(--theme-muted)]">
            <Server className="h-3.5 w-3.5 text-[var(--theme-primary)]" />
            {t.settings_ollama_endpoint}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="http://localhost:11434"
              value={settings.ollamaEndpoint}
              onChange={(event) => setSettings((current) => ({ ...current, ollamaEndpoint: event.target.value }))}
              className="input-neon flex-1 text-sm"
            />
            <button
              type="button"
              onClick={onRefreshOllama}
              disabled={loadingOllama}
              className="theme-secondary-button flex shrink-0 items-center justify-center gap-1 p-2 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingOllama ? "animate-spin" : ""}`} />
              {t.settings_sync_button}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function ModelSettingsSection({
  provider,
  model,
  ollamaModels,
  customModel,
  isCustomModelActive,
  loadingOllama,
  onModelChange,
  onCustomModelChange,
  onToggleCustomModel,
}: ModelSettingsSectionProps) {
  const { t } = useI18n();
  const selectedModels = getPresetModels(provider);
  const recommendedModels = selectedModels.filter((item) => item.recommended);

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title={t.settings_models_title} description={t.settings_models_desc} />

      {provider === "gemini" && (
        <div className="rounded-lg border border-[rgba(214,168,79,0.2)] bg-[rgba(214,168,79,0.08)] p-3 text-xs leading-relaxed text-[var(--theme-text)]">
          <div className="mb-1 flex items-center gap-2 font-bold text-[var(--theme-primary-light)]">
            <Info className="h-3.5 w-3.5" />
            {t.settings_google_quota_title}
          </div>
          <p className="text-[var(--theme-muted)]">{t.settings_google_quota_desc}</p>
        </div>
      )}

      {provider === "groq" && (
        <div className="rounded-lg border border-[rgba(214,168,79,0.2)] bg-[rgba(214,168,79,0.08)] p-3 text-xs leading-relaxed text-[var(--theme-text)]">
          <div className="mb-1 flex items-center gap-2 font-bold text-[var(--theme-primary-light)]">
            <Info className="h-3.5 w-3.5" />
            {t.settings_groq_quota_title}
          </div>
          <p className="text-[var(--theme-muted)]">{t.settings_groq_quota_desc}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
            <Cpu className="h-3.5 w-3.5 text-[var(--theme-primary)]" />
            {t.settings_model_label}
          </label>
          <button
            type="button"
            onClick={onToggleCustomModel}
            className="text-xs text-[var(--theme-primary)] hover:underline"
          >
            {isCustomModelActive ? t.settings_preset_model : t.settings_custom_model}
          </button>
        </div>

        {isCustomModelActive ? (
          <input
            type="text"
            placeholder={t.settings_custom_model_placeholder}
            value={customModel}
            onChange={(event) => onCustomModelChange(event.target.value)}
            className="input-neon w-full text-sm"
          />
        ) : (
          <select
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            className="input-neon w-full cursor-pointer bg-[var(--theme-surface-2)] text-sm"
          >
            {provider !== "ollama" &&
              selectedModels.map((item) => (
                <option key={item.id} value={item.id} className="bg-[var(--theme-surface-2)]">
                  {item.label} ({item.id}){item.note ? ` - ${item.note}` : ""}
                </option>
              ))}
            {provider === "ollama" &&
              ollamaModels.map((item) => (
                <option key={item} value={item} className="bg-[var(--theme-surface-2)]">
                  {item}
                </option>
              ))}
            {provider === "ollama" && ollamaModels.length === 0 && (
              <option value={getDefaultModel("ollama")}>
                {getDefaultModel("ollama")} ({loadingOllama ? t.settings_loading : "Ollama"})
              </option>
            )}
          </select>
        )}
      </div>

      {provider !== "ollama" && recommendedModels.length > 0 && (
        <div className="grid gap-2">
          {recommendedModels.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-[var(--theme-border)] bg-[rgba(20,16,10,0.5)] p-3"
            >
              <div>
                <div className="text-sm font-bold text-[var(--theme-primary-light)]">{item.label}</div>
                <div className="mt-1 font-mono text-[10px] text-[var(--theme-muted)]">{item.id}</div>
              </div>
              <div className="max-w-[45%] text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-accent)]">
                {item.note}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function getProviderLabel(provider: AiProvider): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Google";
  if (provider === "groq") return "Groq";
  return "Ollama";
}

function getPresetModels(provider: AiProvider) {
  if (provider === "openai") return openAiModels;
  if (provider === "gemini") return geminiModels;
  if (provider === "groq") return groqModels;
  return [];
}

export function LanguageSettingsSection({ settings, setSettings }: LanguageSettingsSectionProps) {
  const { t, changeLanguage } = useI18n();

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title={t.settings_language_title} description={t.settings_language_desc} />

      <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
        <Globe className="h-3.5 w-3.5 text-[var(--theme-primary)]" />
        {t.settings_language_label}
      </label>
      <select
        value={settings.language || "browser"}
        onChange={(event) => {
          const value = event.target.value as "browser" | SupportedLanguage;
          setSettings((current) => ({ ...current, language: value }));
          changeLanguage(value);
        }}
        className="input-neon w-full cursor-pointer bg-[var(--theme-surface-2)] text-sm"
      >
        <option value="browser" className="bg-[var(--theme-surface-2)]">
          {t.settings_language_browser_default}
        </option>
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code} className="bg-[var(--theme-surface-2)]">
            {language.name}
          </option>
        ))}
      </select>
    </section>
  );
}

export function PromptSettingsSection({ settings, setSettings }: PromptSettingsSectionProps) {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title={t.settings_prompt_title} description={t.settings_prompt_desc} />

      <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
        <MessageSquareText className="h-3.5 w-3.5 text-[var(--theme-primary)]" />
        {t.settings_system_prompt_label}
      </label>
      <textarea
        rows={8}
        placeholder={t.settings_system_prompt_placeholder}
        value={settings.customSystemPrompt}
        onChange={(event) => setSettings((current) => ({ ...current, customSystemPrompt: event.target.value }))}
        className="input-neon min-h-48 w-full resize-none font-mono text-xs"
      />
    </section>
  );
}

interface GeneralSettingsSectionProps {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  onShowWarning: () => void;
}

export function GeneralSettingsSection({ settings, setSettings, onShowWarning }: GeneralSettingsSectionProps) {
  const { t } = useI18n();

  const handleToggle = (checked: boolean) => {
    if (checked) {
      onShowWarning();
    } else {
      setSettings((current) => ({ ...current, autoApproveSensitive: false }));
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title={t.settings_general_title} description={t.settings_general_desc} />

      <div className="flex items-start gap-3 rounded-lg border border-[var(--theme-border)] bg-[rgba(20,16,10,0.5)] p-4">
        <input
          id="auto-approve-toggle"
          type="checkbox"
          checked={Boolean(settings.autoApproveSensitive)}
          onChange={(event) => handleToggle(event.target.checked)}
          className="mt-1 h-4 w-4 cursor-pointer rounded border-[var(--theme-border)] bg-[var(--theme-surface-2)] text-[var(--theme-primary)] focus:ring-[var(--theme-primary)]"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="auto-approve-toggle" className="cursor-pointer text-sm font-bold text-[var(--theme-primary-light)] select-none">
            {t.settings_general_auto_approve}
          </label>
          <span className="text-xs text-[var(--theme-muted)] leading-relaxed select-none">
            {t.settings_general_auto_approve_desc}
          </span>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[var(--theme-border)] bg-[rgba(20,16,10,0.5)] p-4">
        <input
          id="dev-mode-toggle"
          type="checkbox"
          checked={Boolean(settings.devModeEnabled)}
          onChange={(event) => setSettings((current) => ({ ...current, devModeEnabled: event.target.checked }))}
          className="mt-1 h-4 w-4 cursor-pointer rounded border-[var(--theme-border)] bg-[var(--theme-surface-2)] text-[var(--theme-primary)] focus:ring-[var(--theme-primary)]"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="dev-mode-toggle" className="cursor-pointer text-sm font-bold text-[var(--theme-primary-light)] select-none">
            {t.settings_general_dev_mode}
          </label>
          <span className="text-xs text-[var(--theme-muted)] leading-relaxed select-none">
            {t.settings_general_dev_mode_desc}
          </span>
        </div>
      </div>
    </section>
  );
}

interface SectionHeaderProps {
  title: string;
  description: string;
}

function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div>
      <h3 className="text-base font-display font-bold text-[var(--theme-primary-light)]">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--theme-muted)]">{description}</p>
    </div>
  );
}

interface LabeledInputProps {
  icon: typeof Key;
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

function LabeledInput({ icon: Icon, label, type, placeholder, value, onChange }: LabeledInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1 text-xs font-semibold text-[var(--theme-muted)]">
        <Icon className="h-3.5 w-3.5 text-[var(--theme-primary)]" />
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-neon w-full text-sm"
      />
    </div>
  );
}
