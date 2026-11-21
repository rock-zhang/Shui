import { invoke } from "@tauri-apps/api/core";
import { detectPlatform } from "./mobile";

/**
 * Firebase 埋点的 JS 封装。
 *
 * 所有事件最终落到 Kotlin 的 AnalyticsTracker：参数清洗、用户级计数、
 * user properties 都在原生侧完成，JS 不直接依赖 Firebase SDK。
 * 桌面 / 浏览器预览下全部是 no-op，调用方不需要判断平台。
 */

type ParamValue = string | number | boolean;
export type AnalyticsParams = Record<string, ParamValue>;

let errorTrackingInstalled = false;
let lastScreen: string | undefined;

function platformKind(): "android" | "desktop" | "web" {
  try {
    const kind = detectPlatform();
    if (kind === "android") return "android";
    if (kind === "macos" || kind === "windows" || kind === "linux") {
      return "desktop";
    }
    return "web";
  } catch {
    return "web";
  }
}

/**
 * Android 走 Firebase 原生 SDK（Kotlin），桌面走 GA4 Measurement Protocol
 * （Rust）。两边共用同一个命令名和方法签名，调用方无需关心平台。
 */
function canTrack(): boolean {
  return typeof window !== "undefined" && platformKind() !== "web";
}

export function track(name: string, params: AnalyticsParams = {}): void {
  if (!canTrack()) return;
  void invoke("analytics_log", { name, params }).catch(() => {
    // 埋点失败绝不影响业务：通知、记水、引导都要照常工作。
  });
}

/**
 * 等待上报完成。只用于「关闭统计」这类必须在停止采集前落地的最后一条事件，
 * 普通业务埋点请用 track()，不要阻塞交互。
 */
export async function trackNow(
  name: string,
  params: AnalyticsParams = {}
): Promise<void> {
  if (!canTrack()) return;
  try {
    await invoke("analytics_log", { name, params });
  } catch {
    // 忽略：关闭统计本身不能因为埋点失败而失败。
  }
}

/** 当前页面名，供 JS 异常上报带上上下文。 */
export function setCurrentScreen(screen: string): void {
  lastScreen = screen;
}

export function screenView(
  screen: string,
  previous?: string,
  isSwitch = false
): void {
  const params: AnalyticsParams = { screen_name: screen, is_switch: isSwitch };
  if (previous) params.previous_screen = previous;
  track("screen_view", params);
  setCurrentScreen(screen);
}

/**
 * 喝水记录统一入口：只有真正新增时上报；幂等命中走 duplicate 事件。
 * 来源区分 manual_today / tray / fullscreen / notification。
 */
export function trackDrinkRecorded(
  receipt: { total: number; goal: number; goalReached: boolean; added: boolean },
  amount: number,
  source: "manual_today" | "tray" | "fullscreen" | "notification"
): void {
  if (!receipt.added) {
    track("drink_duplicate_ignored", { source, amount_bucket: amountBucket(amount) });
    return;
  }
  const justReached =
    receipt.goalReached &&
    receipt.goal > 0 &&
    receipt.total - amount < receipt.goal;
  track("drink_recorded", {
    amount_bucket: amountBucket(amount),
    source,
    progress_bucket: progressBucket(receipt.total, receipt.goal),
    goal_reached: receipt.goalReached,
    deferred: false,
  });
  if (justReached) {
    track("drink_goal_reached", {
      progress_bucket: progressBucket(receipt.total, receipt.goal),
      source,
    });
  }
}

/** 水量分桶：精确毫升数只留在本机，分析平台只看到区间。 */
export function amountBucket(amount: number): string {
  if (amount <= 100) return "le_100";
  if (amount <= 200) return "le_200";
  if (amount <= 300) return "le_300";
  return "gt_300";
}

export function progressBucket(total: number, goal: number): string {
  if (!goal || goal <= 0) return "no_goal";
  const ratio = total / goal;
  if (ratio < 0.25) return "lt_25";
  if (ratio < 0.5) return "25_50";
  if (ratio < 0.75) return "50_75";
  if (ratio < 1) return "75_100";
  return "100";
}

/** 分钟分桶，避免把精确时间写进分析平台。 */
export function minutesBucket(minutes: number): string {
  if (minutes <= 15) return "le_15";
  if (minutes <= 60) return "15_60";
  if (minutes <= 6 * 60) return "1_6h";
  if (minutes <= 24 * 60) return "6_24h";
  return "gt_24h";
}

export function syncAnalyticsProperties(): void {
  if (!canTrack()) return;
  void invoke("analytics_sync_properties").catch(() => {});
}

export async function isAnalyticsEnabled(): Promise<boolean> {
  if (!canTrack()) return false;
  try {
    return await invoke<boolean>("analytics_is_enabled");
  } catch {
    return false;
  }
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  if (!canTrack()) return;
  try {
    await invoke("analytics_set_enabled", { enabled });
  } catch {
    // 开关失败时保持原状态即可，下次启动会重新读取。
  }
}

function reportException(
  message: string,
  stack: string | undefined,
  fatal: boolean
): void {
  if (!canTrack()) return;
  void invoke("analytics_record_exception", {
    message: fatal ? `[fatal] ${message}` : message,
    stack: (stack ?? "").slice(0, 3500),
    screen: lastScreen ?? "",
  }).catch(() => {});
}

/**
 * 捕获 WebView 内的 JS 异常，作为 Crashlytics non-fatal 上报。
 * 原生崩溃与 Kotlin 未捕获异常由 Crashlytics SDK 自动处理。
 */
export function installErrorTracking(): void {
  if (errorTrackingInstalled || typeof window === "undefined") return;
  errorTrackingInstalled = true;

  window.addEventListener("error", (event) => {
    const error = event.error as Error | undefined;
    reportException(
      error?.message ?? event.message ?? "Unknown error",
      error?.stack,
      false
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      reportException(reason.message, reason.stack, false);
      return;
    }
    reportException(String(reason ?? "Unhandled rejection"), undefined, false);
  });
}
