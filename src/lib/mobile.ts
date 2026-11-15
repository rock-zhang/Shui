import { platform } from "@tauri-apps/plugin-os";
import { load } from "@tauri-apps/plugin-store";
import { PLATFORM_OS, STORE_NAME } from "@/lib/constants";

export type PlatformKind =
  | "android"
  | "ios"
  | "macos"
  | "windows"
  | "linux"
  | "web";

export type MobileTabId = "today" | "reminder" | "data" | "me";

/**
 * Resolve the host synchronously so the first paint already uses the right shell.
 * `?mobile=1` / `?platform=android` forces the mobile shell for desktop preview.
 */
export function detectPlatform(): PlatformKind {
  if (typeof window === "undefined") return "web";

  const params = new URLSearchParams(window.location.search);
  const forced =
    params.get("platform") ??
    (params.get("mobile") === "1" ? PLATFORM_OS.ANDROID : null);
  if (forced === PLATFORM_OS.ANDROID) return "android";
  if (forced === PLATFORM_OS.IOS) return "ios";

  const host = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  if (!host.__TAURI_INTERNALS__ && !host.__TAURI__) return "web";

  try {
    return platform() as PlatformKind;
  } catch {
    return "web";
  }
}

export interface AlertConfig {
  gold: string;
  gap: string;
  weekdays: number[];
  timeStart: string;
  timeEnd: string;
  whitelist_apps: string[];
}

export interface GeneralConfig {
  isAutoStart: boolean;
  isCountDown: boolean;
  isFullScreen: boolean;
  /** Android: system notification with drink actions (the reliable background channel). */
  isNotification: boolean;
  isSound: boolean;
  isPaused: boolean;
  /** Mobile equivalent of the desktop app whitelist / lock-screen pause. */
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

export const DEFAULT_ALERT: AlertConfig = {
  gold: "1000",
  gap: "30",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timeStart: "09:00",
  timeEnd: "18:00",
  whitelist_apps: [],
};

export const DEFAULT_GENERAL: GeneralConfig = {
  isAutoStart: false,
  isCountDown: false,
  isFullScreen: true,
  isNotification: true,
  isSound: true,
  isPaused: false,
  quietEnabled: false,
  quietStart: "22:00",
  quietEnd: "07:00",
};

export const GOLD_OPTIONS = [
  "1000",
  "1500",
  "2000",
  "2500",
  "3000",
  "3500",
  "4000",
];
export const GAP_OPTIONS = ["10", "20", "30", "45", "60"];
export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export const TIME_LIST = [
  ...Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour).padStart(2, "0");
    return [`${value}:00`, `${value}:30`];
  }).flat(),
  "00:00",
];

/** Shared with the desktop settings pages through the same config store. */
export async function readConfig<T extends object>(
  key: string,
  fallback: T
): Promise<T> {
  try {
    const store = await load(STORE_NAME.config, { autoSave: false });
    const value = await store.get<Partial<T>>(key);
    return value && typeof value === "object"
      ? { ...fallback, ...value }
      : fallback;
  } catch (error) {
    console.error(`读取配置 ${key} 失败`, error);
    return fallback;
  }
}

export async function writeConfig<T extends object>(
  key: string,
  value: T
): Promise<void> {
  const store = await load(STORE_NAME.config, { autoSave: false });
  await store.set(key, value);
  await store.save();
}

/**
 * Ask the native side to rebuild the timer / alarms. The desktop `reset_timer`
 * command exists today; the Android scheduler lands in the native phase.
 */
export async function rescheduleReminders(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("reset_timer");
  } catch {
    // Browser preview, or the Android alarm scheduler is not wired yet.
  }
}

export function formatDateKey(key: string) {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

export function formatTimeLabel(value: string | null | undefined) {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "时间未知";
}

/** Native notification actions write water without the WebView being alive. */
export const REFRESH_EVENT = "shui:refresh";

export function emitRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(REFRESH_EVENT));
  }
}

export function onRefresh(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REFRESH_EVENT, callback);
  return () => window.removeEventListener(REFRESH_EVENT, callback);
}

export const SHOW_REMINDER_EVENT = "shui:show-reminder";

export function emitShowReminder() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SHOW_REMINDER_EVENT));
  }
}

export function onShowReminder(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SHOW_REMINDER_EVENT, callback);
  return () => window.removeEventListener(SHOW_REMINDER_EVENT, callback);
}

/** Desktop-only UI preview; never writes to the local store. */
export function isMobilePreview() {
  if (typeof window === "undefined") return false;
  const host = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  if (host.__TAURI_INTERNALS__ || host.__TAURI__) return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("mobile") === "1" ||
    params.get("platform") === "android" ||
    params.get("platform") === "ios"
  );
}

export function isDemoPreview() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("demo") === "1";
}
