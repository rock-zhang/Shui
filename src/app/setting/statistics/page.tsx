"use client";

import { useEffect, useMemo, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import {
  Clock3,
  Download,
  Droplets,
  Target,
  TimerReset,
  TrendingUp,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { STORE_NAME } from "@/lib/constants";
import { onRefresh } from "@/lib/mobile";
import { summarizeReminders } from "@/lib/reminder-history";
import {
  DrinkDaySummary,
  DrinkHistoryValue,
  DrinkPatternAnalysis,
  DrinkTimeBucket,
  analyzeDrinkPatterns,
  exportDrinkHistoryCsv,
  getLocalDateKey,
  getRecentDates,
  summarizeDrinkDays,
} from "@/lib/drink-history";
import { useI18n, type Locale, type MessageKey } from "@/lib/i18n";

const PERIODS = [7, 30] as const;

type Translate = ReturnType<typeof useI18n>["t"];

const BUCKET_LABEL_KEYS: Record<DrinkTimeBucket["key"], MessageKey> = {
  overnight: "settings.statistics.bucket.overnight",
  morning: "settings.statistics.bucket.morning",
  afternoon: "settings.statistics.bucket.afternoon",
  evening: "settings.statistics.bucket.evening",
};

function formatShortDate(date: Date, locale: Locale) {
  return date.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
}

function formatCount(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale).format(value);
}

function WaterTrendChart({
  days,
  period,
  goal,
}: {
  days: DrinkDaySummary[];
  period: number;
  goal: number;
}) {
  const { t, locale } = useI18n();
  const highestValue = Math.max(goal, ...days.map((day) => day.total), 1);
  const chartMax = Math.ceil(highestValue / 500) * 500;
  const goalHeight = Math.min((goal / chartMax) * 100, 100);

  return (
    <div className="rounded-lg border p-4 shadow-xs">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">
            {t("settings.statistics.chart.title")}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t("settings.statistics.chart.description")}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-blue-500" />
            {t("settings.statistics.chart.intake")}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-px w-3 border-t border-dashed border-emerald-500" />
            {t("settings.statistics.chart.goal")}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex h-40 w-8 shrink-0 flex-col justify-between pb-5 text-right text-[10px] text-muted-foreground">
          <span>{formatCount(chartMax, locale)}</span>
          <span>{formatCount(Math.round(chartMax / 2), locale)}</span>
          <span>0</span>
        </div>
        <div className="relative h-40 flex-1">
          <div className="absolute inset-x-0 top-0 bottom-5 border-b">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
            {goal > 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-emerald-500/80"
                style={{ bottom: `${goalHeight}%` }}
              />
            )}
            <div className="absolute inset-0 flex items-end gap-1">
              {days.map((day, index) => {
                const barHeight = Math.min((day.total / chartMax) * 100, 100);
                const showLabel =
                  period === 7 ||
                  index % 5 === 0 ||
                  index === days.length - 1;

                return (
                  <div
                    key={day.key}
                    className="group relative flex h-full min-w-0 flex-1 items-end"
                    title={t("settings.statistics.chart.tooltip", {
                      date: formatShortDate(day.date, locale),
                      total: day.total,
                      goal: day.goal,
                    })}
                  >
                    <div
                      className="w-full min-w-[3px] rounded-t-sm bg-blue-500 transition-[height] duration-300 group-hover:bg-blue-600"
                      style={{
                        height:
                          day.total > 0 ? `${Math.max(barHeight, 2)}%` : 0,
                      }}
                    />
                    {showLabel && (
                      <span className="absolute top-full left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-[9px] text-muted-foreground">
                        {formatShortDate(day.date, locale)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatInterval(minutes: number | null, t: Translate) {
  if (minutes === null) return "--";
  if (minutes < 1) return t("settings.statistics.interval.lessThanMinute");
  const rounded = Math.round(minutes);
  if (rounded < 60)
    return t("settings.statistics.interval.minutes", { minutes: rounded });

  const hours = Math.floor(rounded / 60);
  const remainingMinutes = rounded % 60;
  return remainingMinutes
    ? t("settings.statistics.interval.hoursMinutes", {
        hours,
        minutes: remainingMinutes,
      })
    : t("settings.statistics.interval.hours", { hours });
}

function DrinkPatternCards({ analysis }: { analysis: DrinkPatternAnalysis }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 grid grid-cols-1 gap-3">
      <div className="rounded-lg border p-4 shadow-xs">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-cyan-500" />
          <div>
            <h4 className="text-sm font-medium">
              {t("settings.statistics.pattern.timing.title")}
            </h4>
            <p className="text-[11px] text-muted-foreground">
              {t("settings.statistics.pattern.timing.description", {
                count: analysis.totalEntries,
              })}
            </p>
          </div>
        </div>

        {analysis.totalEntries === 0 ? (
          <div className="flex h-28 items-center justify-center text-center text-xs leading-5 text-muted-foreground">
            {t("settings.statistics.pattern.timing.empty")}
          </div>
        ) : (
          <div className="space-y-2.5">
            {analysis.timeBuckets.map((bucket) => (
              <div key={bucket.key}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">
                    {t(BUCKET_LABEL_KEYS[bucket.key])}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      {bucket.range}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {t("settings.statistics.pattern.timing.entry", {
                      amount: bucket.amount,
                      count: bucket.count,
                    })}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-cyan-500 transition-[width] duration-300"
                    style={{ width: `${bucket.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4 shadow-xs">
        <div className="mb-3 flex items-center gap-2">
          <TimerReset className="h-4 w-4 text-violet-500" />
          <div>
            <h4 className="text-sm font-medium">
              {t("settings.statistics.pattern.interval.title")}
            </h4>
            <p className="text-[11px] text-muted-foreground">
              {t("settings.statistics.pattern.interval.description")}
            </p>
          </div>
        </div>

        {analysis.intervalCount === 0 ? (
          <div className="flex h-28 items-center justify-center text-center text-xs leading-5 text-muted-foreground">
            {t("settings.statistics.pattern.interval.empty")}
          </div>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">
              {t("settings.statistics.pattern.interval.average")}
            </p>
            <p className="mb-3 text-xl font-semibold">
              {formatInterval(analysis.averageIntervalMinutes, t)}
            </p>
            <div className="grid grid-cols-3 gap-1.5 border-t pt-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">
                  {t("settings.statistics.pattern.interval.shortest")}
                </p>
                <p className="mt-0.5 text-xs font-medium">
                  {formatInterval(analysis.shortestIntervalMinutes, t)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">
                  {t("settings.statistics.pattern.interval.median")}
                </p>
                <p className="mt-0.5 text-xs font-medium">
                  {formatInterval(analysis.medianIntervalMinutes, t)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">
                  {t("settings.statistics.pattern.interval.longest")}
                </p>
                <p className="mt-0.5 text-xs font-medium">
                  {formatInterval(analysis.longestIntervalMinutes, t)}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">
              {t("settings.statistics.pattern.interval.basis", {
                count: analysis.intervalCount,
              })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function StatisticsPage() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(7);
  const [revision, setRevision] = useState(0);
  const [goal, setGoal] = useState(0);
  const [reminders, setReminders] = useState(() => summarizeReminders([]));
  const [reminderError, setReminderError] = useState(false);
  const [days, setDays] = useState<DrinkDaySummary[]>([]);
  const [historyEntries, setHistoryEntries] = useState<
    Array<[string, DrinkHistoryValue]>
  >([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(false);

  // 系统通知里点「+Xml」由 Rust 落盘后广播，桥接层转成 emitRefresh；
  // 桌面端订阅后统计才会跟着更新。
  useEffect(() => onRefresh(() => setRevision(value => value + 1)), []);

  useEffect(() => {
    let cancelled = false;

    async function loadStatistics() {
      setLoading(true);
      setError(false);

      try {
        const [configStore, historyStore] = await Promise.all([
          load(STORE_NAME.config, { autoSave: false }),
          load(STORE_NAME.drink_history, { autoSave: false }),
        ]);
        const alertConfig = await configStore.get<{ gold?: string | number }>(
          "alert"
        );
        const currentGoal = Number(alertConfig?.gold) || 0;
        const dates = getRecentDates(period);
        try {
          const reminderStore = await load(STORE_NAME.reminder_history, { autoSave: false });
          const records = await Promise.all(dates.map(date => reminderStore.get(getLocalDateKey(date))));
          if (!cancelled) {
            setReminders(summarizeReminders(records));
            setReminderError(false);
          }
        } catch {
          if (!cancelled) setReminderError(true);
        }
        const values = await Promise.all(
          dates.map((date) =>
            historyStore.get<DrinkHistoryValue>(getLocalDateKey(date))
          )
        );

        if (!cancelled) {
          const periodEntries = dates.map(
            (date, index) =>
              [getLocalDateKey(date), values[index]] as [
                string,
                DrinkHistoryValue
              ]
          );
          setGoal(currentGoal);
          setDays(summarizeDrinkDays(dates, values, currentGoal));
          setHistoryEntries(periodEntries);
        }
      } catch (loadError) {
        console.error("加载饮水统计失败:", loadError);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadStatistics();
    return () => {
      cancelled = true;
    };
  }, [period, revision]);

  const summary = useMemo(() => {
    const total = days.reduce((sum, day) => sum + day.total, 0);
    return {
      average: days.length ? Math.round(total / days.length) : 0,
      completedDays: days.filter((day) => day.completed).length,
      today: days.at(-1)?.total || 0,
    };
  }, [days]);

  const patternAnalysis = useMemo(
    () => analyzeDrinkPatterns(historyEntries, goal),
    [historyEntries, goal]
  );

  const hasLegacyData = days.some(
    (day) => day.total > 0 && !day.hasHistoricalGoal
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const [configStore, historyStore] = await Promise.all([
        load(STORE_NAME.config, { autoSave: false }),
        load(STORE_NAME.drink_history, { autoSave: false }),
      ]);
      const [alertConfig, entries] = await Promise.all([
        configStore.get<{ gold?: string | number }>("alert"),
        historyStore.entries<DrinkHistoryValue>(),
      ]);
      const historyEntries = entries.filter(([key]) => /^\d{8}$/.test(key));

      if (historyEntries.length === 0) {
        toast.info(t("settings.statistics.export.empty"));
        return;
      }

      const csv = exportDrinkHistoryCsv(
        historyEntries,
        Number(alertConfig?.gold) || 0,
        (key) => t(key)
      );
      const savedPath = await invoke<string | null>("save_drink_history_csv", {
        content: csv,
      });

      if (savedPath) toast.success(t("settings.statistics.export.success"));
    } catch (exportError) {
      console.error("导出饮水记录失败:", exportError);
      toast.error(t("settings.statistics.export.failed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-medium">
            {t("settings.statistics.title")}
          </h3>
          <p className="text-[0.8rem] text-muted-foreground">
            {t("settings.statistics.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t("settings.statistics.refresh")}</Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs"
            disabled={exporting}
            onClick={handleExport}
          >
            <Download className="h-3.5 w-3.5" />
            {exporting
              ? t("settings.statistics.exporting")
              : t("settings.statistics.export")}
          </Button>
          <div className="flex rounded-md border p-0.5">
            {PERIODS.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={period === value ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setPeriod(value)}
              >
                {t("settings.statistics.period", { days: value })}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {t("settings.statistics.error.load")}
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3 shadow-xs">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Droplets className="h-4 w-4 text-blue-500" />
                {t("settings.statistics.today")}
              </div>
              <p className="text-xl font-semibold">
                {loading ? "--" : summary.today}
                <span className="ml-1 text-xs font-normal text-muted-foreground">ml</span>
              </p>
            </div>
            <div className="rounded-lg border p-3 shadow-xs">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-indigo-500" />
                {t("settings.statistics.average")}
              </div>
              <p className="text-xl font-semibold">
                {loading ? "--" : summary.average}
                <span className="ml-1 text-xs font-normal text-muted-foreground">ml</span>
              </p>
            </div>
            <div className="rounded-lg border p-3 shadow-xs">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Target className="h-4 w-4 text-emerald-500" />
                {t("settings.statistics.completedDays")}
              </div>
              <p className="text-xl font-semibold">
                {loading ? "--" : summary.completedDays}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {t("settings.statistics.daysUnit")}
                </span>
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex h-56 items-center justify-center rounded-lg border text-sm text-muted-foreground">
              {t("settings.statistics.loading")}
            </div>
          ) : (
            <>
              <WaterTrendChart days={days} period={period} goal={goal} />
              <DrinkPatternCards analysis={patternAnalysis} />
              <section
                className="mt-4 rounded-lg border p-4 shadow-xs"
                aria-label={t("settings.statistics.reminder.title")}
              >
                <h4 className="text-sm font-medium">
                  {t("settings.statistics.reminder.title")}
                </h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.statistics.reminder.description")}
                </p>
                {reminderError ? (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {t("settings.statistics.reminder.error")}
                  </p>
                ) : (
                  <>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      {[
                        [
                          t("settings.statistics.reminder.completed"),
                          t("settings.statistics.reminder.count", {
                            count: reminders.completed,
                          }),
                        ],
                        [
                          t("settings.statistics.reminder.confirmed"),
                          t("settings.statistics.reminder.count", {
                            count: reminders.confirmed,
                          }),
                        ],
                        [
                          t("settings.statistics.reminder.skipped"),
                          t("settings.statistics.reminder.count", {
                            count: reminders.skipped,
                          }),
                        ],
                        [
                          t("settings.statistics.reminder.timedOut"),
                          t("settings.statistics.reminder.count", {
                            count: reminders.timedOut,
                          }),
                        ],
                        [
                          t("settings.statistics.reminder.duration"),
                          t("settings.statistics.reminder.durationValue", {
                            minutes: Math.floor(reminders.displaySeconds / 60),
                            seconds: reminders.displaySeconds % 60,
                          }),
                        ],
                      ].map(([label, value]) => (
                        <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>
                      ))}
                    </dl>
                    {reminders.completed === 0 && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {t("settings.statistics.reminder.empty")}
                      </p>
                    )}
                  </>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("settings.statistics.reminder.note")}
                </p>
              </section>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("settings.statistics.note")}
              </p>
            </>
          )}

          {hasLegacyData && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("settings.statistics.legacy", { goal })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
