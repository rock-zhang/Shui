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
  /** No reminders are sent between quietStart and quietEnd when enabled. */
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

export const DEFAULT_ALERT: AlertConfig = {
  gold: "1000",
  // 必须与 Rust 侧的默认配置（store/settings.rs 的 init_store / unwrap_or）以及
  // Kotlin 的兜底值保持一致，否则首次启动会出现「今日页 30 分钟、设置页 20 分钟」。
  gap: "20",
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

/**
 * 是否为 debug 构建。Rust 在页面脚本执行前注入 `__SHUI_DEBUG_BUILD__`：
 * debug 包（tauri dev / debug APK）为 true，release APK 为 false。
 * 浏览器预览没有原生注入，回退到 NODE_ENV（dev 可见、build 不可见），
 * 与桌面端设置页保持同一口径。
 */
export function isDebugBuild(): boolean {
  if (typeof window === "undefined") {
    return process.env.NODE_ENV === "development";
  }
  const flag = (
    window as unknown as { __SHUI_DEBUG_BUILD__?: boolean }
  ).__SHUI_DEBUG_BUILD__;
  if (typeof flag === "boolean") {
    return flag;
  }
  return process.env.NODE_ENV === "development";
}

/**
 * 当前包是否带自更新能力。
 *
 * - 桌面端：恒为 true，沿用 tauri-plugin-updater。
 * - Android 侧载包：Rust 在页面脚本前注入 `__SHUI_SIDELOAD__ = true`。
 * - Android Play 包：注入 false，且原生产物里没有安装权限与更新代码。
 *
 * 前端只有一份 dist 同时供 Play / 侧载使用，无法靠构建期常量区分，
 * 所以必须读运行时注入的 flag。
 */
export function isSideloadBuild(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  const host = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
    __SHUI_SIDELOAD__?: boolean;
  };
  // 浏览器预览：当作桌面语义，方便本地调 UI。
  if (!host.__TAURI_INTERNALS__ && !host.__TAURI__) {
    return true;
  }
  // 只有 Android 存在「Play / 侧载」两种包；桌面恒有自更新。
  // 注意 Rust 在桌面也会注入该 flag（值为 false），不能直接采信。
  try {
    if (platform() !== "android") {
      return true;
    }
  } catch {
    return true;
  }
  const flag = host.__SHUI_SIDELOAD__;
  return typeof flag === "boolean" ? flag : false;
}

const BASE_GAP_OPTIONS = ["10", "20", "30", "45", "60"];
// "1" 分钟是测试档：原生侧（Rust 前台 timer 与 Kotlin 闹钟）会识别 gap==1
// 并绕过提醒时段/工作日限制，方便随时验证通知链路，不必等到工作时段。
// 只在 debug 构建暴露；release APK 与正式桌面包不显示，避免用户误选。
export const GAP_OPTIONS = isDebugBuild()
  ? ["1", ...BASE_GAP_OPTIONS]
  : BASE_GAP_OPTIONS;
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

/**
 * 把最新配置推给原生，但不重排闹钟。
 * 音效、系统通知、目标这类不改变节奏的开关也必须同步——Kotlin 侧判断
 * 是否发通知、走哪个渠道、是否达标，都读这份原生配置快照。
 */
export async function syncReminderConfig(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("sync_reminder_config");
  } catch {
    // 桌面浏览器预览没有原生命令。
  }
}

/** 真机诊断快照：字段与 Rust get_diagnostics / Kotlin getDiagnostics 对齐。 */
export interface Diagnostics {
  now: number;
  nextAt: number;
  lastReminderAt: number;
  gapMinutes: number;
  exactAlarm: boolean;
  batteryIgnored: boolean;
  dozing: boolean;
  interactive: boolean;
  notificationsEnabled: boolean;
  channelImportance: number;
  /** 上一次「排了却没响」的闹钟时刻；0 表示没有漏报。 */
  missedAlarmAt: number;
  /** 上次冷启动时是否发现闹钟句柄已被系统删除（划掉多任务 force-stop 的后果）。 */
  alarmCleared: boolean;
  /** 厂商 / 品牌：文案按系统家族切换，避免把 ColorOS 的叫法写给所有人都看。 */
  manufacturer: string;
  brand: string;
  appVersion: string;
}

export async function readDiagnostics(): Promise<Diagnostics | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<Diagnostics>("get_diagnostics");
  } catch {
    return null;
  }
}

/**
 * 达成每日目标时的系统通知。
 *
 * 手机端过去只有一条 App 内 toast：从通知栏快捷记录、或在后台待着根本看不到。
 * 这条通道补齐前台路径；后台路径由原生闹钟回调补发，两条路径共用同一个
 * 「今天已播报」标记去重，不会重复弹。
 */
export async function notifyGoalReached(total: number, goal: number): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_goal_notification", { total, goal });
  } catch {
    // 桌面预览或通知权限被拒：App 内的 toast 已经反馈过，不必再打扰。
  }
}

/** Android NotificationManager.IMPORTANCE_*，用于判断能否弹横幅。 */
export const CHANNEL_IMPORTANCE = {
  NONE: 0,
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
} as const;

/** Android Notification.VISIBILITY_*。 */
export const CHANNEL_VISIBILITY = {
  SECRET: -1,
  PRIVATE: 0,
  PUBLIC: 1,
} as const;

/**
 * 通知体检快照：字段与 Kotlin `getNotificationHealth` 一一对应。
 *
 * 这里刻意不含「系统是否允许锁屏显示通知」「ROM 是否允许横幅」——它们没有
 * 公开 API 可读，前端只能把它们写成引导，不能写成勾选状态。
 */
export interface NotificationHealth {
  channelId: string;
  channelExists: boolean;
  /** 渠道重要度；-1 = 渠道尚未创建。>= HIGH(4) 才有横幅。 */
  channelImportance: number;
  /** 渠道锁屏可见性；-1 = 渠道尚未创建。PUBLIC(1) 才会在锁屏显示正文。 */
  channelLockscreen: number;
  /** 渠道重要度是否达到弹横幅的门槛。 */
  headsUp: boolean;
  /** 锁屏是否显示完整内容（渠道侧）。 */
  lockscreenPublic: boolean;
  /** 渠道实际是否配了声音；ColorOS 17 会把它置空。 */
  channelSound: boolean;
  /** 渠道实际是否开了震动；ColorOS 17 会关掉。 */
  channelVibration: boolean;
  /** 渠道重要度是否被系统/用户从 HIGH 调低（ColorOS 会自动降级）。 */
  channelDowngraded: boolean;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  exactAlarm: boolean;
  batteryIgnored: boolean;
  manufacturer: string;
  brand: string;
  sdkInt: number;
}

export async function readNotificationHealth(): Promise<NotificationHealth | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NotificationHealth>("get_notification_health");
  } catch {
    return null;
  }
}

export function formatDateKey(key: string) {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

export function formatTimeLabel(
  value: string | null | undefined,
  fallback = "时间未知",
  locale = "zh-CN"
) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : fallback;
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

/**
 * 记水后立即广播重锚得到的新排期。
 *
 * `record_drink` 的 Receipt 已经带上重锚后的绝对时间，直接用它比「先 refresh
 * 再 invoke(get_next_reminder) 回来一次」更快，也避免一拍的延迟：1 分钟测试档
 * 下那 100~300ms 足以让「还有 N 分钟」显示旧值。
 */
export const NEXT_REMINDER_EVENT = "shui:next-reminder";

export function emitNextReminder(nextAt: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<number>(NEXT_REMINDER_EVENT, { detail: nextAt })
  );
}

export function onNextReminder(callback: (nextAt: number) => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    if (typeof detail === "number" && detail > 0) callback(detail);
  };
  window.addEventListener(NEXT_REMINDER_EVENT, handler);
  return () => window.removeEventListener(NEXT_REMINDER_EVENT, handler);
}

/** Native WebView event: a notification tap asked the front end to check for a
 * pending reminder. The actual pop-up is driven by the Rust command result. */
export const CHECK_REMINDER_EVENT = "shui:check-reminder";

export function onCheckReminder(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHECK_REMINDER_EVENT, callback);
  return () => window.removeEventListener(CHECK_REMINDER_EVENT, callback);
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
