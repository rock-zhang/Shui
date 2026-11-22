"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { clampBubbleLeft, computeBubbleLayout } from "@/lib/onboarding";
import {
  DESKTOP_ONBOARDING_STEPS,
  markDesktopOnboardingSeen,
  type DesktopOnboardingStep,
} from "@/lib/desktop-onboarding";

/**
 * 桌面首次启动引导：聚光灯依次高亮「提醒」页的真实设置项。
 *
 * 与移动端不同，桌面的下拉/开关不适合在点击后自动跳步（用户还要选具体值），
 * 因此由底部「下一步」确认，配置仍由提醒页自己保存。
 */

type Layout = {
  rect: { top: number; left: number; width: number; height: number };
  bubble: { top: number; left: number; width: number };
};

const STEP_TEXT: Record<
  DesktopOnboardingStep,
  { title: MessageKey; body: MessageKey }
> = {
  goal: {
    title: "desktop.onboarding.goal.title",
    body: "desktop.onboarding.goal.body",
  },
  gap: {
    title: "desktop.onboarding.gap.title",
    body: "desktop.onboarding.gap.body",
  },
  weekdays: {
    title: "desktop.onboarding.weekdays.title",
    body: "desktop.onboarding.weekdays.body",
  },
  time: {
    title: "desktop.onboarding.time.title",
    body: "desktop.onboarding.time.body",
  },
};

export function DesktopOnboardingTour({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const step = DESKTOP_ONBOARDING_STEPS[index];
  const text = STEP_TEXT[step];
  const last = index === DESKTOP_ONBOARDING_STEPS.length - 1;

  const place = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = document.querySelector<HTMLElement>(
      `[data-desktop-onboarding="${step}"]`
    );
    if (!el) {
      setLayout(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const bubbleWidth = Math.min(320, viewportWidth - 32);
    const bubbleHeight = bubbleRef.current?.offsetHeight ?? 176;
    const { top } = computeBubbleLayout({
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
        top,
        left: clampBubbleLeft(rect.left, bubbleWidth, viewportWidth),
        width: bubbleWidth,
      },
    });
  }, [step]);

  // 进入/换步：先滚动到目标，等滚动结束再量坐标。
  useEffect(() => {
    if (!open) return;
    let attempts = 0;
    let timer = 0;
    const tryPlace = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-desktop-onboarding="${step}"]`
      );
      if (!el) {
        if (attempts < 10) {
          attempts += 1;
          timer = window.setTimeout(tryPlace, 120);
        }
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      timer = window.setTimeout(place, 320);
    };
    tryPlace();
    return () => window.clearTimeout(timer);
  }, [open, index, place, step]);

  // 首次定位时气泡还没渲染，用估算高度选位；渲染后按真实高度修正一次。
  const correctedFor = useRef(-1);
  useEffect(() => {
    if (!open || !layout) return;
    if (correctedFor.current === index) return;
    correctedFor.current = index;
    const frame = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(frame);
  }, [open, layout, index, place]);

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

  const finish = useCallback(() => {
    markDesktopOnboardingSeen();
    toast.success(t("desktop.onboarding.completedToast"));
    onDone();
  }, [onDone, t]);

  if (!open || !layout) return null;

  const { rect, bubble } = layout;

  // z-40 是刻意的：下拉浮层（Radix popper）会把自身 z-index 复制到外层包装节点，
  // 值为 50。引导层必须低于它，否则选项浮层被压暗面板盖住，框外的选项也点不到；
  // 高于页面内容的需求由 40 本身满足。
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-onboarding-title"
      className="pointer-events-none fixed inset-0 z-40"
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
        style={{
          top: rect.top,
          height: rect.height,
          width: Math.max(0, rect.left),
        }}
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
        className="pointer-events-none fixed rounded-xl border-2 border-sky-400 ring-4 ring-sky-400/25"
        style={{
          top: rect.top - 2,
          left: rect.left - 2,
          width: rect.width + 4,
          height: rect.height + 4,
        }}
      />

      <div
        ref={bubbleRef}
        className="pointer-events-auto fixed rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
        style={{ top: bubble.top, left: bubble.left, width: bubble.width }}
      >
        <button
          type="button"
          onClick={finish}
          aria-label={t("desktop.onboarding.skip")}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <p className="text-[11px] font-medium text-sky-600 dark:text-sky-400">
          {t("desktop.onboarding.stepProgress", {
            index: index + 1,
            total: DESKTOP_ONBOARDING_STEPS.length,
          })}
        </p>
        <h3
          id="desktop-onboarding-title"
          className="mt-1 text-sm font-semibold"
        >
          {t(text.title)}
        </h3>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {t(text.body)}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("desktop.onboarding.skip")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (last) {
                finish();
              } else {
                setIndex((current) => current + 1);
              }
            }}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {last ? t("desktop.onboarding.finish") : t("desktop.onboarding.next")}
            {!last && <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
