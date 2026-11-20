"use client";

import { useEffect, useRef } from "react";
import { getLocalDateKey } from "@/lib/drink-history";

/**
 * 距离下一个本地零点还有多少毫秒。
 *
 * 用 `Date` 的年份/月/日构造器而不是「now + 86400000」：后者在夏令时切换
 * 当天会偏一小时，而构造器给的是「明天 00:00 这个本地时刻」，由运行环境
 * 自己处理偏移，跨时区/夏令时都正确。
 */
function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  // 补 50ms 缓冲：setTimeout 偶有提前一两毫秒落地，此时日期 key 还没翻，
  // 白跑一次就要再等一整天。宁可晚 50ms，不可错过。
  return Math.max(0, next.getTime() - now.getTime()) + 50;
}

/**
 * 本地日期（YYYYMMDD）变化时触发一次回调。
 *
 * 「今日」数据是按日期 key 读的，但组件不会在跨天时重新挂载：
 * - 移动端四个 tab 常驻（display:none 切换），切 tab 不重新读；
 * - 桌面窗口可能几天不关；
 * - App 挂后台过夜，第二天恢复时组件树原封不动。
 *
 * 结果就是过了零点，顶部进度环、明细列表、统计页还停在昨天，用户会以为
 * 数据没写进去。四条路径互补：
 *
 * 1. **定时到零点**（主路径）—— 按 `msUntilNextMidnight` 精确定时，
 *    到点触发后再排下一天。页面可见时这就是 00:00:00.05 的准点切换，
 *    不是「一分钟内某刻」。
 * 2. `visibilitychange` / `focus` —— 从后台/别的窗口回来。同时重排定时器：
 *    锁屏或最小化期间 WebView 的 timer 会被系统节流甚至冻结，回来必须对表。
 * 3. `shui:foreground` —— Android 的 onResume 由原生主动派发。切回前台时
 *    WebView 不保证派发 visibilitychange（项目里已踩过这个坑）。
 * 4. 5 分钟低频兜底 —— 系统休眠恢复后 timer 极小概率丢失、或用户手动改了
 *    系统时间/时区导致排期错位时把它捞回来。正常情况下永远不生效。
 *
 * 回调放进 ref：调用方常写成内联箭头函数，不该因此反复重绑监听。
 */
export function useDayChange(onDayChange: () => void) {
  const callbackRef = useRef(onDayChange);
  callbackRef.current = onDayChange;
  const dateKeyRef = useRef(getLocalDateKey(new Date()));

  useEffect(() => {
    let timer: number | undefined;

    const checkDate = () => {
      const next = getLocalDateKey(new Date());
      if (next === dateKeyRef.current) return;
      dateKeyRef.current = next;
      callbackRef.current();
    };

    /** 重排到下一个零点。重复调用是安全的：目标时刻恒定。 */
    const arm = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        checkDate();
        arm();
      }, msUntilNextMidnight(new Date()));
    };

    arm();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      checkDate();
      arm();
    };
    const onFocus = () => {
      checkDate();
      arm();
    };

    const fallback = window.setInterval(() => {
      checkDate();
      arm();
    }, 5 * 60_000);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("shui:foreground", onFocus);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(fallback);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("shui:foreground", onFocus);
    };
  }, []);
}
