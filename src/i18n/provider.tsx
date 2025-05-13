"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  Locale,
  defaultLocale,
  getMessages,
  createI18n,
  locales,
} from "./config";
import { load } from "@tauri-apps/plugin-store";
import { STORE_NAME } from "@/lib/constants";

type Messages = Record<string, string | string[] | Record<string, string>>;

type I18nContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [i18n, setI18n] = useState<ReturnType<typeof createI18n> | null>(null);

  useEffect(() => {
    const loadLocale = async () => {
      const store = await load(STORE_NAME.config, { autoSave: false });
      const savedLocale = await store.get<Locale>("locale");
      if (savedLocale && locales.includes(savedLocale)) {
        setLocaleState(savedLocale);
      }
    };
    loadLocale();
  }, []);

  useEffect(() => {
    const loadMessages = async () => {
      const msgs = await getMessages(locale);
      setI18n(createI18n(locale, msgs));
    };
    loadMessages();
  }, [locale]);

  const setLocale = async (newLocale: Locale) => {
    const store = await load(STORE_NAME.config, { autoSave: false });
    await store.set("locale", newLocale);
    await store.save();
    setLocaleState(newLocale);
  };

  if (!i18n) {
    return null;
  }

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        t: (key: string, values?: Record<string, string | number>) => {
          const result = i18n.formatMessage({ id: key }, values);
          return typeof result === "string" ? result : String(result);
        },
      }}
    >
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
