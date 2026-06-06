/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from "react";
import { pt } from "./locales/pt";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { it } from "./locales/it";
import { ja } from "./locales/ja";
import { zh } from "./locales/zh";
import type { TranslationKeys, SupportedLanguage, LanguageOption } from "./types";
import { LANGUAGES, getBrowserLanguage } from "./types";
import { StorageService } from "../services/storageService";

export { LANGUAGES, getBrowserLanguage };
export type { SupportedLanguage, TranslationKeys, LanguageOption };

const dictionaries: Record<SupportedLanguage, TranslationKeys> = {
  pt,
  en,
  es,
  fr,
  de,
  it,
  ja,
  zh,
};

interface I18nContextType {
  language: SupportedLanguage;
  configLanguage: "browser" | SupportedLanguage;
  t: Required<TranslationKeys>;
  changeLanguage: (lang: "browser" | SupportedLanguage) => void;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [configLanguage, setConfigLanguage] = useState<"browser" | SupportedLanguage>(() => {
    const settings = StorageService.getSettings();
    return (settings.language as "browser" | SupportedLanguage) || "browser";
  });

  const [resolvedLanguage, setResolvedLanguage] = useState<SupportedLanguage>(() => {
    const settings = StorageService.getSettings();
    const val = settings.language || "browser";
    return val === "browser" ? getBrowserLanguage() : val as SupportedLanguage;
  });

  const changeLanguage = (lang: "browser" | SupportedLanguage) => {
    setConfigLanguage(lang);
    const resolved = lang === "browser" ? getBrowserLanguage() : lang;
    setResolvedLanguage(resolved);

    const settings = StorageService.getSettings();
    StorageService.saveSettings({ ...settings, language: lang });
  };

  useEffect(() => {
    const handleStorageChange = () => {
      const settings = StorageService.getSettings();
      const lang = (settings.language as "browser" | SupportedLanguage) || "browser";
      setConfigLanguage(lang);
      setResolvedLanguage(lang === "browser" ? getBrowserLanguage() : lang);
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const t = { ...dictionaries.en, ...dictionaries[resolvedLanguage] } as Required<TranslationKeys>;

  return (
    <I18nContext.Provider value={{ language: resolvedLanguage, configLanguage, t, changeLanguage }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
