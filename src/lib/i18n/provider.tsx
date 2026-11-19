"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { load } from "@tauri-apps/plugin-store";
import { STORE_NAME } from "@/lib/constants";
import {
  detectSystemLocale,
  formatMessage,
  isLanguagePreference,
  readStoredPreference,
  resolveLocale,
  writeStoredPreference,
  LANGUAGE_STORE_KEY,
  type LanguagePreference,
  type Locale,
} from "./locales";
import { messages, type MessageKey } from "./messages";

type Params = Record<string, string | number>;

interface I18nValue {
  locale: Locale;
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
  t: (key: MessageKey, params?: Params) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/** 客户端用 layout effect，保证首屏绘制前就切到系统语言；服务端退回 effect。 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** 偏好写回 config store，供 Rust / Kotlin 原生侧读取；浏览器预览没有 store。 */
async function persistPreference(preference: LanguagePreference) {
  try {
    const store = await load(STORE_NAME.config, { autoSave: false });
    await store.set(LANGUAGE_STORE_KEY, preference);
    await store.save();
  } catch {
    // 非 Tauri 环境或存储失败时，localStorage 镜像仍然有效。
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] =
    useState<LanguagePreference>("system");
  // 固定 zh-CN 作为首帧，服务端与 hydration 首渲染必须一致。
  const [systemLocale, setSystemLocale] = useState<Locale>("zh-CN");
  const touched = useRef(false);

  // 首帧统一用 system + zh-CN，避免静态导出的服务端 HTML 与客户端不一致；
  // layout effect 会在浏览器绘制前读镜像与系统语言，因此不会出现中文闪一下。
  useIsomorphicLayoutEffect(() => {
    setPreferenceState(readStoredPreference());
    setSystemLocale(detectSystemLocale());
  }, []);

  // 以 store 为准回填一次，覆盖镜像被清空但原生偏好还在的情况。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const store = await load(STORE_NAME.config, { autoSave: false });
        const stored = await store.get<unknown>(LANGUAGE_STORE_KEY);
        if (cancelled || touched.current) return;
        if (isLanguagePreference(stored)) {
          setPreferenceState(stored);
          writeStoredPreference(stored);
        }
      } catch {
        // 浏览器预览或首次启动没有 store。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = useMemo(
    () => resolveLocale(preference, systemLocale),
    [preference, systemLocale]
  );

  useIsomorphicLayoutEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setPreference = useCallback((next: LanguagePreference) => {
    touched.current = true;
    setPreferenceState(next);
    writeStoredPreference(next);
    void persistPreference(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, params?: Params) => {
      const dict = messages[locale];
      const template = dict[key] ?? messages["zh-CN"][key];
      return formatMessage(template, params);
    },
    [locale]
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, preference, setPreference, t }),
    [locale, preference, setPreference, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}
