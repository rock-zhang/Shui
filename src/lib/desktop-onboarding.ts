/**
 * 桌面首次启动引导的状态与步骤定义。
 *
 * 与移动端一致：不弹表单，而是把用户带到「提醒」页的真实设置项上。
 * 桌面用独立的 storage key，避免装了移动端预览或换端后互相干扰。
 */

export const DESKTOP_ONBOARDING_KEY = "shui:desktop-onboarding-seen";
export const DESKTOP_ONBOARDING_VERSION = "1";

export type DesktopOnboardingStep = "goal" | "gap" | "weekdays" | "time";

export const DESKTOP_ONBOARDING_STEPS: readonly DesktopOnboardingStep[] = [
  "goal",
  "gap",
  "weekdays",
  "time",
];

export function readDesktopOnboardingSeen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(DESKTOP_ONBOARDING_KEY) ===
      DESKTOP_ONBOARDING_VERSION
    );
  } catch {
    return false;
  }
}

export function markDesktopOnboardingSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DESKTOP_ONBOARDING_KEY,
      DESKTOP_ONBOARDING_VERSION
    );
  } catch {
    // 存储不可用时仅影响自动弹出，不阻塞使用。
  }
}
