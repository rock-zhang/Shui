"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Mobile design primitives. All colours come from the existing oklch tokens. */
export function MobileSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "mb-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm",
        className
      )}
    >
      {title && (
        <h2 className="mb-1 text-sm font-semibold tracking-tight">{title}</h2>
      )}
      {description && (
        <p className="mb-3 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

export function MobileRow({
  title,
  description,
  descriptionClassName,
  control,
  footer,
  className,
}: {
  title: string;
  /** 可以是字符串，也可以内嵌一个行内操作（如「去开启」）。 */
  description?: ReactNode;
  descriptionClassName?: string;
  control?: ReactNode;
  /** 行下方的整宽操作区。文案里的行内链接点击区太小，重要操作放这里。 */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-b border-border/50 py-2 last:border-0",
        className
      )}
    >
      <div className="flex min-h-14 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5">{title}</p>
          {description && (
            <p
              className={cn(
                "mt-0.5 text-xs leading-5 text-muted-foreground",
                descriptionClassName
              )}
            >
              {description}
            </p>
          )}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {footer && <div className="pb-1 pt-1.5">{footer}</div>}
    </div>
  );
}

/**
 * Android WebView paints the native time-picker drop arrow at the input's own
 * right edge and ignores `padding-right`, so a bordered input shows the arrow
 * flush against the frame. The wrapper owns the border/background and insets
 * the input, which guarantees a right gutter on every WebView build.
 * Keep `-webkit-appearance` untouched: resetting it also kills the native
 * picker dialog on Android.
 */
export function MobileTimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-h-11 min-w-0 flex-1 items-stretch rounded-xl border border-input bg-background pl-3 pr-4">
      <input
        type="time"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground"
      />
    </div>
  );
}

export function MobileSegmented<T extends string>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex w-full rounded-xl bg-muted p-1", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-10 min-w-0 flex-1 rounded-lg px-1.5 text-xs font-medium leading-tight transition-colors",
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 数字从旧值滚动到新值；撤销导致的减少同样平滑回落。 */
function useCountUp(target: number, duration = 550) {
  const [display, setDisplay] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (target - from) * eased);
      current.current = value;
      setDisplay(value);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return display;
}

export function ProgressRing({
  total,
  goal,
  size = 208,
}: {
  total: number;
  goal: number;
  size?: number;
}) {
  const displayTotal = useCountUp(total);
  const [pulseToken, setPulseToken] = useState(0);
  const previousTotal = useRef(total);

  useEffect(() => {
    if (total > previousTotal.current) setPulseToken((token) => token + 1);
    previousTotal.current = total;
  }, [total]);

  const radius = 82;
  const circumference = 2 * Math.PI * radius;
  const ratio = goal > 0 ? Math.min(total / goal, 1) : 0;
  const reached = goal > 0 && total >= goal;

  return (
    <div
      className="relative mx-auto shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`今日已喝 ${total} 毫升，目标 ${goal} 毫升`}
    >
      {pulseToken > 0 && (
        <span
          key={pulseToken}
          aria-hidden="true"
          className="ring-pulse pointer-events-none absolute inset-[9%] rounded-full"
        />
      )}
      <svg viewBox="0 0 200 200" width={size} height={size}>
        <defs>
          <linearGradient id="mobile-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="14"
        />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="url(#mobile-ring)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform="rotate(-90 100 100)"
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums tracking-tight">
          {displayTotal}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">
          / {goal || "--"} ml
        </span>
        <span
          className={cn(
            "mt-3 rounded-full px-3 py-1 text-xs font-medium",
            reached
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          {reached ? "今日目标已达成" : `还差 ${Math.max(goal - total, 0)} ml`}
        </span>
      </div>
    </div>
  );
}

export function MobileStat({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="text-xl font-semibold tabular-nums">
        {value}
        {unit && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

export function MobileEmpty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 px-4 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
