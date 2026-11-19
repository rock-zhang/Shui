"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import {
  ONBOARDING_DISMISS_LIMIT,
  ONBOARDING_STEPS,
  bumpOnboardingDismiss,
  clampBubbleLeft,
  computeBubbleLayout,
  markOnboardingSeen,
  nextOnboardingIndex,
  type OnboardingOutcome,
  type OnboardingStepKey,
} from "@/lib/onboarding";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useMobileConfig } from "./config-context";

/**
 * 首次启动个性化引导：聚光灯导览。
 *
 * 不弹表单，而是把用户带到「提醒」页的真实设置项上：压暗其余区域、高亮目标、
 * 气泡说明这一步；用户点任意选项（时间范围则在原生选择器确认后）自动进入下一步。
 * 配置保存完全复用 reminder-tab 的 patchAlert，这里不碰配置。
 */

type Layout = {
  rect: { top: number; left: number; width: number; height: number };
  bubble: { top: number; left: number; width: number };
  hint: { top: number; left: number };
};

/** 步骤文案按 key 存，渲染时再取当前语言，避免模块常量锁死中文。 */
const STEP_TEXT: Record<
  OnboardingStepKey,
  { title: MessageKey; body: MessageKey }
> = {
  goal: {
    title: "mobile.onboarding.step.goal.title",
    body: "mobile.onboarding.step.goal.body",
  },
  gap: {
    title: "mobile.onboarding.step.gap.title",
    body: "mobile.onboarding.step.gap.body",
  },
  weekdays: {
    title: "mobile.onboarding.step.weekdays.title",
    body: "mobile.onboarding.step.weekdays.body",
  },
  timeStart: {
    title: "mobile.onboarding.step.timeStart.title",
    body: "mobile.onboarding.step.timeStart.body",
  },
  timeEnd: {
    title: "mobile.onboarding.step.timeEnd.title",
    body: "mobile.onboarding.step.timeEnd.body",
  },
};

export function OnboardingTour({
  open,
  onDone,
}: {
  open: boolean;
  onDone: (outcome: OnboardingOutcome) => void;
}) {
  const { t } = useI18n();
  const { hydrated, alert } = useMobileConfig();
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);

  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const indexRef = useRef(0);
  const advancing = useRef(false);
  const advanceTimer = useRef<number | null>(null);
  const shownAt = useRef(Date.now());
  const loggedSteps = useRef<Set<number>>(new Set());
  const alertRef = useRef(alert);

  indexRef.current = index;
  alertRef.current = alert;

  const step = ONBOARDING_STEPS[index];
  const stepText = STEP_TEXT[step.key];
  const last = index === ONBOARDING_STEPS.length - 1;

  const place = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = document.querySelector<HTMLElement>(
      `[data-onboarding="${step.key}"]`
    );
    if (!el) {
      setLayout(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const bubbleWidth = Math.min(360, viewportWidth - 32);
    const bubbleHeight = bubbleRef.current?.offsetHeight ?? 196;
    const { top: bubbleTop } = computeBubbleLayout({
      targetTop: rect.top,
      targetBottom: rect.bottom,
      bubbleHeight,
      viewportHeight,
    });
    setLayout({
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      bubble: {
        top: bubbleTop,
        left: clampBubbleLeft(rect.left, bubbleWidth, viewportWidth),
        width: bubbleWidth,
      },
      hint: {
        // 目标贴近顶部时提示放到目标内部，避免被状态栏裁掉。
        top: rect.top >= 52 ? rect.top - 34 : rect.top + 8,
        left: Math.max(12, Math.min(rect.left, viewportWidth - 132)),
      },
    });
  }, [step.key]);

  const finish = useCallback(
    (outcome: OnboardingOutcome) => {
      if (outcome === "completed") {
        markOnboardingSeen();
        const config = alertRef.current;
        track("onboarding_completed", {
          duration_ms: Math.max(0, Date.now() - shownAt.current),
          goal_ml: config.gold,
          gap_min: config.gap,
          weekdays: (config.weekdays ?? []).join(","),
          time_start: config.timeStart,
          time_end: config.timeEnd,
        });
        toast.success(t("mobile.onboarding.completedToast"));
      }
      onDone(outcome);
    },
    [onDone, t]
  );

  const advance = useCallback(
    (delay = 420) => {
      if (advancing.current) return;
      advancing.current = true;
      advanceTimer.current = window.setTimeout(() => {
        advanceTimer.current = null;
        advancing.current = false;
        const next = nextOnboardingIndex(indexRef.current);
        if (next === "done") {
          finish("completed");
          return;
        }
        track("onboarding_step_nav", {
          from_step: indexRef.current,
          to_step: next,
          direction: "next",
        });
        setIndex(next);
      }, delay);
    },
    [finish]
  );

  const dismiss = useCallback(() => {
    const count = bumpOnboardingDismiss();
    const limit = count >= ONBOARDING_DISMISS_LIMIT;
    if (limit) markOnboardingSeen();
    track("onboarding_dismissed", {
      step: indexRef.current,
      dismiss_count: count,
      will_auto_show_again: !limit,
    });
    onDone(limit ? "limit" : "dismissed");
  }, [onDone]);

  // 进入/换步：先滚动到目标，等滚动结束再量坐标。
  useEffect(() => {
    if (!open || !hydrated) return;
    let attempts = 0;
    let timer = 0;
    const tryPlace = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-onboarding="${step.key}"]`
      );
      if (!el) {
        if (attempts < 10) {
          attempts += 1;
          timer = window.setTimeout(tryPlace, 120);
        }
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      timer = window.setTimeout(place, 360);
    };
    tryPlace();
    return () => window.clearTimeout(timer);
  }, [open, hydrated, index, place, step.key]);

  // 首次定位时气泡还没渲染，用估算高度选位；渲染后按真实高度再修正一次。
  const correctedFor = useRef(-1);
  useEffect(() => {
    if (!open || !layout) return;
    if (correctedFor.current === index) return;
    correctedFor.current = index;
    const frame = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(frame);
  }, [open, layout, index, place]);

  // 滚动、旋转、窗口变化都会让固定坐标失效，实时重算。
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(place);
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
    };
  }, [open, place]);

  // 检测用户在真实控件上的操作。
  useEffect(() => {
    if (!open) return;
    const current = step.key;
    const inCurrentStep = (node: EventTarget | null) =>
      node instanceof Element && Boolean(node.closest(`[data-onboarding="${current}"]`));

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const control = target.closest("button, input, [role='button']");
      if (!control) return;
      // 点时间输入只是打开原生选择器，真正完成以 change 事件为准。
      if (control instanceof HTMLInputElement && control.type === "time") return;
      if (!inCurrentStep(target)) return;
      advance(420);
    };

    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.type !== "time") return;
      if (!inCurrentStep(target)) return;
      advance(240);
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
    };
  }, [open, step.key, advance]);

  useEffect(() => {
    if (!open) return;
    shownAt.current = Date.now();
    loggedSteps.current = new Set();
    track("onboarding_shown", {
      trigger: "auto_first_launch",
      entry_source: "startup",
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (loggedSteps.current.has(index)) return;
    loggedSteps.current.add(index);
    track("onboarding_step_view", { step: index, step_name: step.key });
  }, [open, index, step.key]);

  useEffect(
    () => () => {
      if (advanceTimer.current !== null) {
        window.clearTimeout(advanceTimer.current);
      }
    },
    []
  );

  if (!open || !hydrated || !layout) return null;

  const { rect, bubble, hint } = layout;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="pointer-events-none fixed inset-0 z-[60]"
    >
      {/* 四块压暗面板围出高亮洞：洞内无元素，点击直达真实控件。 */}
      <div
        className="pointer-events-auto fixed left-0 right-0 top-0 bg-slate-950/55"
        style={{ height: Math.max(0, rect.top) }}
      />
      <div
        className="pointer-events-auto fixed bottom-0 left-0 right-0 bg-slate-950/55"
        style={{ top: rect.top + rect.height }}
      />
      <div
        className="pointer-events-auto fixed left-0 bg-slate-950/55"
        style={{ top: rect.top, height: rect.height, width: Math.max(0, rect.left) }}
      />
      <div
        className="pointer-events-auto fixed right-0 bg-slate-950/55"
        style={{
          top: rect.top,
          height: rect.height,
          left: rect.left + rect.width,
        }}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-2xl border-2 border-sky-400 ring-4 ring-sky-400/25 transition-all duration-300"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
        }}
      />

      <div
        className="pointer-events-none fixed flex h-7 items-center rounded-full bg-sky-500 px-2.5 text-[11px] font-semibold text-white shadow-lg shadow-sky-500/30"
        style={hint}
      >
        {t("mobile.onboarding.hint")}
      </div>

      <div
        ref={bubbleRef}
        className="pointer-events-auto fixed rounded-[22px] border border-border/80 bg-card p-4 shadow-2xl shadow-slate-950/25"
        style={{
          top: bubble.top,
          left: bubble.left,
          width: bubble.width,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold leading-4 text-sky-700 dark:text-sky-300">
            {t("mobile.onboarding.stepProgress", {
              index: index + 1,
              total: ONBOARDING_STEPS.length,
            })}
          </span>
          <button
            type="button"
            aria-label={t("mobile.onboarding.skip")}
            onClick={dismiss}
            className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2
          id="onboarding-title"
          className="mt-2 text-[17px] font-semibold leading-6 tracking-tight"
        >
          {t(stepText.title)}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          {t(stepText.body)}
        </p>

        {last ? (
          <button
            type="button"
            onClick={() => finish("completed")}
            className="mt-3 flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-[15px] font-semibold text-white shadow-lg shadow-sky-500/20 transition-transform duration-150 active:scale-[0.985]"
          >
            {t("mobile.onboarding.finish")}
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => advance(0)}
            className="mt-3 flex h-10 w-full items-center justify-center rounded-xl border border-border/70 bg-background/60 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {t("mobile.onboarding.next")}
          </button>
        )}
      </div>
    </div>
  );
}
