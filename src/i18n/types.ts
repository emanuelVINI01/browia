export interface TranslationKeys {
  sidebar_title: string;
  sidebar_new_session: string;
  sidebar_delete_session: string;
  sidebar_empty_sessions: string;
  sidebar_version: string;
  header_active: string;
  header_ready: string;
  header_toggle_history: string;
  header_settings: string;
  chat_welcome_title: string;
  chat_welcome_desc: string;
  chat_suggestions_title: string;
  chat_suggestion_tabs: string;
  chat_suggestion_search: string;
  chat_suggestion_screenshot: string;
  chat_input_placeholder: string;
  chat_input_placeholder_running: string;
  chat_stop_button: string;
  message_role_user: string;
  message_role_agent: string;
  settings_title: string;
  settings_close: string;
  settings_tab_api?: string;
  settings_tab_google?: string;
  settings_tab_general?: string;
  settings_tab_language?: string;
  settings_tab_prompt?: string;
  settings_api_title?: string;
  settings_api_desc?: string;
  settings_google_title?: string;
  settings_google_desc?: string;
  settings_google_quota_title?: string;
  settings_google_quota_desc?: string;
  settings_general_title?: string;
  settings_general_desc?: string;
  settings_general_auto_approve?: string;
  settings_general_auto_approve_desc?: string;
  settings_language_title?: string;
  settings_language_desc?: string;
  settings_prompt_title?: string;
  settings_prompt_desc?: string;
  auto_approve_modal_title?: string;
  auto_approve_modal_warning?: string;
  auto_approve_modal_risk_list?: string;
  auto_approve_modal_confirm?: string;
  auto_approve_modal_cancel?: string;
  settings_provider_label: string;
  settings_openai_key: string;
  settings_gemini_key: string;
  settings_ollama_endpoint: string;
  settings_sync_button: string;
  settings_model_label: string;
  settings_custom_model: string;
  settings_preset_model: string;
  settings_custom_model_placeholder: string;
  settings_system_prompt_label: string;
  settings_system_prompt_placeholder: string;
  settings_save_button: string;
  settings_success_message: string;
  settings_error_ollama: string;
  settings_language_label: string;
  settings_language_browser_default: string;
  approval_title: string;
  approval_deny: string;
  approval_approve: string;
  session_default_title: string;
  settings_loading: string;
  status_awaiting_approval: string;
  status_plan_approved: string;
  status_plan_rejected: string;
  status_agent_started: string;
  error_background_communication: string;
}

export type SupportedLanguage = "pt" | "en" | "es" | "fr" | "de" | "it" | "ja" | "zh";

export interface LanguageOption {
  code: SupportedLanguage;
  name: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "pt", name: "Português" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "简体中文" },
];

export function getBrowserLanguage(): SupportedLanguage {
  let lang = "";
  if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function") {
    lang = chrome.i18n.getUILanguage();
  } else if (typeof navigator !== "undefined") {
    lang = navigator.language;
  }

  const code = lang.split("-")[0].toLowerCase();
  const supportedCodes: string[] = ["pt", "en", "es", "fr", "de", "it", "ja", "zh"];
  if (supportedCodes.includes(code)) {
    return code as SupportedLanguage;
  }
  return "en";
}
