"use client";

import { useState } from "react";
import { useDrinkData } from "@/hooks/use-drink-data";
import {
  type DrinkDaySummary,
  type DrinkPatternAnalysis,
  type DrinkTimeBucket,
} from "@/lib/drink-history";
import type { ReminderSummary } from "@/lib/reminder-history";
import { MobileEmpty, MobileSection, MobileSegmented, MobileStat } from "./ui";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { useI18n, type MessageKey } from "@/lib/i18n";

const BUCKET_LABEL_KEYS: Record<DrinkTimeBucket["key"], MessageKey> = {
  overnight: "settings.statistics.bucket.overnight",
  morning: "settings.statistics.bucket.morning",
  afternoon: "settings.statistics.bucket.afternoon",
  evening: "settings.statistics.bucket.evening",
};

type Translate = ReturnType<typeof useI18n>["t"];

function formatInterval(minutes: number | null, t: Translate) {
  if (minutes === null) return "--";
  if (minutes < 1) return t("settings.statistics.interval.lessThanMinute");
  const rounded = Math.round(minutes);
  if (rounded < 60)
    return t("settings.statistics.interval.minutes", { minutes: rounded });
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return remaining
    ? t("settings.statistics.interval.hoursMinutes", {
        hours,
        minutes: remaining,
      })
    : t("settings.statistics.interval.hours", { hours });
}

/** Horizontally scrollable bars: 30 days no longer compress into 6px columns. */
function TrendChart({
  days,
  goal,
}: {
  days: DrinkDaySummary[];
  goal: number;
}) {
  const { t } = useI18n();
  const chartMax = Math.max(
    Math.ceil(Math.max(goal, ...days.map((day) => day.total), 1) / 500) * 500,
    500
  );
  const goalHeight = Math.min((goal / chartMax) * 100, 100);
  const width = Math.max(days.length * 20, 320);
  // 横轴按日期倒序：最近的一天在最左边，越往右越早。数据源本身是
  // 从旧到新的，这里只反转渲染顺序，汇总/分析仍使用原始顺序。
  const orderedDays = [...days].reverse();

  return (
    <div className="mobile-scroll-x -mx-1 overflow-x-auto overflow-y-hidden px-1 pb-2">
      <div className="relative h-44" style={{ width }}>
        <div className="absolute inset-x-0 bottom-6 border-b border-border" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/70" />
        {goal > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-emerald-500/80"
            style={{ bottom: `calc(1.5rem + ${goalHeight * 0.86}%)` }}
          />
        )}
        <div className="absolute inset-x-0 top-0 bottom-6 flex items-end gap-1">
          {orderedDays.map((day, index) => {
            const height = Math.min((day.total / chartMax) * 100, 100);
            const showLabel =
              orderedDays.length <= 7 ||
              index % 5 === 0 ||
              index === orderedDays.length - 1;
            return (
              <div
                key={day.key}
                className="relative flex h-full min-w-[14px] flex-1 items-end"
                title={t("mobile.data.trend.tooltip", {
                  date: `${day.date.getMonth() + 1}/${day.date.getDate()}`,
                  total: day.total,
                })}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm transition-[height] duration-300",
                    day.completed ? "bg-emerald-500" : "bg-blue-500"
                  )}
                  style={{ height: day.total > 0 ? `${Math.max(height, 2)}%` : 0 }}
                />
                {showLabel && (
                  <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">
                    {day.date.getMonth() + 1}/{day.date.getDate()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t("mobile.data.trend.note", { max: chartMax })}
      </p>
    </div>
  );
}

function PatternCards({ analysis }: { analysis: DrinkPatternAnalysis }) {
  const { t } = useI18n();
  return (
    <MobileSection title={t("mobile.data.habit.title")}>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("mobile.data.habit.description", { count: analysis.totalEntries })}
      </p>
      {analysis.totalEntries === 0 ? (
        <MobileEmpty
          title={t("mobile.data.habit.emptyTitle")}
          description={t("mobile.data.habit.emptyDescription")}
        />
      ) : (
        <div className="space-y-3">
          {analysis.timeBuckets.map((bucket) => (
            <div key={bucket.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium">
                  {t(BUCKET_LABEL_KEYS[bucket.key])}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    {bucket.range}
                  </span>
                </span>
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {t("mobile.data.habit.entry", {
                    amount: bucket.amount,
                    count: bucket.count,
                  })}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-[width] duration-300"
                  style={{ width: `${bucket.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-border/60 pt-3">
        <p className="text-xs text-muted-foreground">
          {t("mobile.data.interval.average")}
        </p>
        <p className="mt-1 text-xl font-semibold">
          {formatInterval(analysis.averageIntervalMinutes, t)}
        </p>
        {analysis.intervalCount > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {([
              ["settings.statistics.pattern.interval.shortest", analysis.shortestIntervalMinutes],
              ["settings.statistics.pattern.interval.median", analysis.medianIntervalMinutes],
              ["settings.statistics.pattern.interval.longest", analysis.longestIntervalMinutes],
            ] satisfies Array<readonly [MessageKey, number | null]>).map(([labelKey, value]) => (
              <div key={labelKey} className="rounded-lg bg-muted/60 py-2">
                <p className="text-[10px] text-muted-foreground">
                  {t(labelKey)}
                </p>
                <p className="mt-0.5 text-xs font-medium">
                  {formatInterval(value, t)}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("mobile.data.interval.note", { count: analysis.intervalCount })}
        </p>
      </div>
    </MobileSection>
  );
}

function ReminderStats({
  reminders,
  error,
}: {
  reminders: ReminderSummary;
  error: boolean;
}) {
  const { t } = useI18n();
  const rows: Array<[string, string]> = [
    [
      t("settings.statistics.reminder.completed"),
      t("settings.statistics.reminder.count", { count: reminders.completed }),
    ],
    [
      t("settings.statistics.reminder.confirmed"),
      t("settings.statistics.reminder.count", { count: reminders.confirmed }),
    ],
    [
      t("mobile.data.reminder.skipped"),
      t("settings.statistics.reminder.count", { count: reminders.skipped }),
    ],
    [
      t("mobile.data.reminder.timedOut"),
      t("settings.statistics.reminder.count", { count: reminders.timedOut }),
    ],
    [
      t("settings.statistics.reminder.duration"),
      t("settings.statistics.reminder.durationValue", {
        minutes: Math.floor(reminders.displaySeconds / 60),
        seconds: reminders.displaySeconds % 60,
      }),
    ],
  ];

  return (
    <MobileSection
      title={t("mobile.data.reminder.title")}
      description={t("mobile.data.reminder.description")}
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("mobile.data.reminder.error")}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-muted/50 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {reminders.completed === 0 && !error && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {t("mobile.data.reminder.empty")}
        </p>
      )}
    </MobileSection>
  );
}

export function DataTab() {
  const { t } = useI18n();
  const [periodValue, setPeriodValue] = useState<"7" | "30">("7");
  const period = periodValue === "7" ? 7 : 30;
  const {
    days,
    analysis,
    reminders,
    reminderError,
    summary,
    loading,
    error,
    goal,
    streak,
  } = useDrinkData(period);
  // 全新安装每天都会写入当天目标；只有从桌面导入的旧格式数字总量才缺少它。
  const hasLegacyData = days.some(
    (day) => day.total > 0 && !day.hasHistoricalGoal
  );

  return (
    <>
      <MobileSection>
        <MobileSegmented
          value={periodValue}
          options={[
            { value: "7", label: t("mobile.data.period.7") },
            { value: "30", label: t("mobile.data.period.30") },
          ]}
          onChange={(next) => {
            if (next !== periodValue) {
              track("data_period_changed", { from: periodValue, to: next });
            }
            setPeriodValue(next);
          }}
          label={t("mobile.data.period.label")}
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileStat label={t("mobile.data.today")} value={loading ? "--" : summary.today} unit="ml" />
          <MobileStat label={t("mobile.data.average")} value={loading ? "--" : summary.average} unit="ml" />
          <MobileStat
            label={t("mobile.data.completed")}
            value={loading ? "--" : summary.completedDays}
            unit={t("mobile.data.daysUnit")}
          />
          <MobileStat
            label={t("mobile.data.streak")}
            value={loading || !streak ? "--" : streak.current}
            unit={t("mobile.data.daysUnit")}
          />
        </div>
      </MobileSection>

      {error ? (
        <MobileSection>
          <p role="alert" className="text-sm text-destructive">
            {t("mobile.data.error")}
          </p>
        </MobileSection>
      ) : (
        <>
          <MobileSection
            title={t("mobile.data.trend.title")}
            description={t("mobile.data.trend.description", { goal: goal || "--" })}
          >
            <TrendChart days={days} goal={goal} />
          </MobileSection>
          <PatternCards analysis={analysis} />
          <ReminderStats reminders={reminders} error={reminderError} />
          {hasLegacyData && (
            <p className="px-1 text-[11px] leading-5 text-muted-foreground">
              {t("mobile.data.legacy", { goal: goal || "--" })}
            </p>
          )}
          <p className="px-1 pb-2 text-[11px] leading-5 text-muted-foreground">
            {t("mobile.data.note")}
          </p>
        </>
      )}
    </>
  );
}
