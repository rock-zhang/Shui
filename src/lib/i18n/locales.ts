/**
 * 语言偏好的类型、解析与持久化。
 *
 * 偏好同时写两处：
 * - localStorage 镜像：静态导出首帧同步读取，避免先中文后英文的闪烁；
 * - Tauri config store 的 `language`：Rust / Kotlin 原生侧读取同一份偏好。
 */

export type Locale = "zh-CN" | "en-US";
export type LanguagePreference = "system" | Locale;

/** localStorage 镜像键，区别于原生配置里的 `language`。 */
export const LANGUAGE_MIRROR_KEY = "shui-language";
export const LANGUAGE_STORE_KEY = "language";

export function isLanguagePreference(
  value: unknown
): value is LanguagePreference {
  return value === "system" || value === "zh-CN" || value === "en-US";
}

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

/** 把 BCP 47 语言标签归一成应用支持的两种语言。 */
export function localeFromLanguageTag(tag: string | undefined | null): Locale {
  return (tag ?? "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

/** 系统语言只区分中文与英文，其余一律落到 en-US。 */
export function detectSystemLocale(): Locale {
  if (typeof navigator === "undefined") return "zh-CN";
  const languages = navigator.languages;
  const preferred =
    (languages && languages.length > 0 ? languages[0] : undefined) ??
    navigator.language;
  return localeFromLanguageTag(preferred);
}

export function resolveLocale(
  preference: LanguagePreference,
  systemLocale: Locale = detectSystemLocale()
): Locale {
  return preference === "system" ? systemLocale : preference;
}

export function readStoredPreference(): LanguagePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(LANGUAGE_MIRROR_KEY);
    return isLanguagePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function writeStoredPreference(preference: LanguagePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_MIRROR_KEY, preference);
  } catch {
    // 镜像失败只影响首帧，不影响本次运行。
  }
}

/** 轻量插值：只支持 `{name}`，不引入 ICU。 */
export function formatMessage(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
