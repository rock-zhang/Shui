/**
 * 首次启动个性化引导的状态与步骤定义。
 *
 * 引导不在弹窗里改配置，而是直接高亮「提醒」页的真实控件；这里的步骤只负责
 * 顺序、文案与目标锚点，配置保存仍走 reminder-tab 自己的 patchAlert。
 */

export type OnboardingOutcome = "completed" | "dismissed" | "limit";

export type OnboardingStepKey =
  | "goal"
  | "gap"
  | "weekdays"
  | "timeStart"
  | "timeEnd";

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  body: string;
}

/** 开始与结束时间分开两步：时间范围是两次独立选择，不能并成一个高亮框。 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    key: "goal",
    title: "先定每日目标",
    body: "点一个金额，确认每天想喝多少；默认 1000 ml。",
  },
  {
    key: "gap",
    title: "再选提醒间隔",
    body: "点一个间隔确认；建议 20–30 分钟，太频繁容易烦。",
  },
  {
    key: "weekdays",
    title: "哪些天需要提醒",
    body: "点任意一天确认。默认周一至周五，点亮的日期才会提醒。",
  },
  {
    key: "timeStart",
    title: "选择开始时间",
    body: "点开始时间，选择每天从几点开始提醒；默认 09:00。",
  },
  {
    key: "timeEnd",
    title: "选择结束时间",
    body: "再选结束时间；默认 18:00，下班后不再打扰。",
  },
];

export const ONBOARDING_SEEN_KEY = "shui:onboarding-seen";
/** 流程结构升级时 +1，老版本标记失效后会重新引导。 */
export const ONBOARDING_SEEN_VERSION = "1";

export const ONBOARDING_DISMISS_KEY = "shui:onboarding-dismiss";
/** 与通知引导一致：连按三次「跳过」才彻底停止自动弹出。 */
export const ONBOARDING_DISMISS_LIMIT = 3;

export function readOnboardingSeen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === ONBOARDING_SEEN_VERSION;
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, ONBOARDING_SEEN_VERSION);
  } catch {
    // 存储不可用时仅影响自动弹出，不阻塞用户继续使用。
  }
}

export function readOnboardingDismissCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = Number(window.localStorage.getItem(ONBOARDING_DISMISS_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

export function bumpOnboardingDismiss(): number {
  const next = readOnboardingDismissCount() + 1;
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(ONBOARDING_DISMISS_KEY, String(next));
  } catch {
    // 存储不可用时本次仍按已跳过一次处理。
  }
  return next;
}

/**
 * 下一步序号；最后一步返回 done，由调用方落完成标记。
 * 抽成纯函数是为了让「最后一步不能越界」这类回归可被单测覆盖。
 */
export function nextOnboardingIndex(
  current: number,
  total: number = ONBOARDING_STEPS.length
): number | "done" {
  return current + 1 < total ? current + 1 : "done";
}

export interface BubbleLayoutInput {
  targetTop: number;
  targetBottom: number;
  bubbleHeight: number;
  viewportHeight: number;
  safeTop?: number;
  safeBottom?: number;
}

/**
 * 气泡优先放在目标下方；下方放不下翻到上方；两侧都放不下时夹在视口内，
 * 宁可轻微遮挡目标也不能让气泡跑出屏幕。
 */
export function computeBubbleLayout({
  targetTop,
  targetBottom,
  bubbleHeight,
  viewportHeight,
  safeTop = 8,
  safeBottom = 8,
}: BubbleLayoutInput): { top: number } {
  const margin = 12;
  const below = targetBottom + margin;
  if (below + bubbleHeight <= viewportHeight - safeBottom) {
    return { top: below };
  }
  const above = targetTop - margin - bubbleHeight;
  if (above >= safeTop) {
    return { top: above };
  }
  return {
    top: Math.max(safeTop, Math.min(below, viewportHeight - safeBottom - bubbleHeight)),
  };
}

/** 气泡跟随目标横向移动，但不越过左右安全边距。 */
export function clampBubbleLeft(
  targetLeft: number,
  bubbleWidth: number,
  viewportWidth: number,
  gutter = 16
): number {
  const max = Math.max(gutter, viewportWidth - bubbleWidth - gutter);
  return Math.min(Math.max(targetLeft, gutter), max);
}
