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
import { summarizeReminders } from "@/lib/reminder-history";
import {
  DrinkDaySummary,
  DrinkHistoryValue,
  DrinkPatternAnalysis,
  analyzeDrinkPatterns,
  exportDrinkHistoryCsv,
  getLocalDateKey,
  getRecentDates,
  summarizeDrinkDays,
} from "@/lib/drink-history";

const PERIODS = [7, 30] as const;

function formatShortDate(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
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
  const highestValue = Math.max(goal, ...days.map((day) => day.total), 1);
  const chartMax = Math.ceil(highestValue / 500) * 500;
  const goalHeight = Math.min((goal / chartMax) * 100, 100);

  return (
    <div className="rounded-lg border p-4 shadow-xs">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">饮水量趋势</h4>
          <p className="text-xs text-muted-foreground">每日累计饮水量（ml）</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-blue-500" />饮水量
          </span>
          <span className="flex items-center gap-1">
            <span className="h-px w-3 border-t border-dashed border-emerald-500" />
            当前目标
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex h-40 w-8 shrink-0 flex-col justify-between pb-5 text-right text-[10px] text-muted-foreground">
          <span>{chartMax}</span>
          <span>{Math.round(chartMax / 2)}</span>
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
                    title={`${formatShortDate(day.date)}：${day.total}ml / 目标 ${day.goal}ml`}
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
                        {formatShortDate(day.date)}
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

function formatInterval(minutes: number | null) {
  if (minutes === null) return "--";
  if (minutes < 1) return "不足 1 分钟";
  minutes = Math.round(minutes);
  if (minutes < 60) return `${minutes} 分钟`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `${hours} 小时 ${remainingMinutes} 分`
    : `${hours} 小时`;
}

function DrinkPatternCards({ analysis }: { analysis: DrinkPatternAnalysis }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3">
      <div className="rounded-lg border p-4 shadow-xs">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-cyan-500" />
          <div>
            <h4 className="text-sm font-medium">饮水时间分布</h4>
            <p className="text-[11px] text-muted-foreground">
              按当前本地时间统计，基于 {analysis.totalEntries} 次有效记录
            </p>
          </div>
        </div>

        {analysis.totalEntries === 0 ? (
          <div className="flex h-28 items-center justify-center text-center text-xs leading-5 text-muted-foreground">
            新记录积累后，将显示各时段的饮水分布
          </div>
        ) : (
          <div className="space-y-2.5">
            {analysis.timeBuckets.map((bucket) => (
              <div key={bucket.key}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">
                    {bucket.label}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      {bucket.range}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {bucket.amount}ml · {bucket.count}次
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
            <h4 className="text-sm font-medium">饮水间隔分析</h4>
            <p className="text-[11px] text-muted-foreground">
              仅计算同一天内的相邻记录
            </p>
          </div>
        </div>

        {analysis.intervalCount === 0 ? (
          <div className="flex h-28 items-center justify-center text-center text-xs leading-5 text-muted-foreground">
            同一天至少记录两次饮水后，即可分析间隔
          </div>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">平均间隔</p>
            <p className="mb-3 text-xl font-semibold">
              {formatInterval(analysis.averageIntervalMinutes)}
            </p>
            <div className="grid grid-cols-3 gap-1.5 border-t pt-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">最短</p>
                <p className="mt-0.5 text-xs font-medium">
                  {formatInterval(analysis.shortestIntervalMinutes)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">中位</p>
                <p className="mt-0.5 text-xs font-medium">
                  {formatInterval(analysis.medianIntervalMinutes)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">最长</p>
                <p className="mt-0.5 text-xs font-medium">
                  {formatInterval(analysis.longestIntervalMinutes)}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">
              基于 {analysis.intervalCount} 个有效间隔
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function StatisticsPage() {
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
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadStatistics() {
      setLoading(true);
      setError("");

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
        if (!cancelled) setError("暂时无法读取饮水记录，请稍后重试");
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
        toast.info("还没有可导出的饮水记录");
        return;
      }

      const csv = exportDrinkHistoryCsv(
        historyEntries,
        Number(alertConfig?.gold) || 0
      );
      const savedPath = await invoke<string | null>("save_drink_history_csv", {
        content: csv,
      });

      if (savedPath) toast.success("饮水记录已导出");
    } catch (exportError) {
      console.error("导出饮水记录失败:", exportError);
      toast.error("导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-medium">饮水统计</h3>
          <p className="text-[0.8rem] text-muted-foreground">
            看见变化，更容易坚持健康饮水习惯
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => setRevision(value => value + 1)}>刷新</Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs"
            disabled={exporting}
            onClick={handleExport}
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "导出中" : "导出 CSV"}
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
                {value} 天
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3 shadow-xs">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Droplets className="h-4 w-4 text-blue-500" />今日饮水
              </div>
              <p className="text-xl font-semibold">
                {loading ? "--" : summary.today}
                <span className="ml-1 text-xs font-normal text-muted-foreground">ml</span>
              </p>
            </div>
            <div className="rounded-lg border p-3 shadow-xs">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-indigo-500" />周期日均
              </div>
              <p className="text-xl font-semibold">
                {loading ? "--" : summary.average}
                <span className="ml-1 text-xs font-normal text-muted-foreground">ml</span>
              </p>
            </div>
            <div className="rounded-lg border p-3 shadow-xs">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Target className="h-4 w-4 text-emerald-500" />达标天数
              </div>
              <p className="text-xl font-semibold">
                {loading ? "--" : summary.completedDays}
                <span className="ml-1 text-xs font-normal text-muted-foreground">天</span>
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex h-56 items-center justify-center rounded-lg border text-sm text-muted-foreground">
              正在整理饮水记录...
            </div>
          ) : (
            <>
              <WaterTrendChart days={days} period={period} goal={goal} />
              <DrinkPatternCards analysis={patternAnalysis} />
              <section className="mt-4 rounded-lg border p-4 shadow-xs" aria-label="休息提醒统计">
                <h4 className="text-sm font-medium">休息提醒统计</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  仅统计已结束的全屏提醒（含托盘立即休息），多屏合并为一次，按开始日期归档。
                </p>
                {reminderError ? (
                  <p role="alert" className="mt-3 text-sm text-destructive">提醒统计暂时无法读取</p>
                ) : (
                  <>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      {[
                        ["已结束提醒", `${reminders.completed} 次`],
                        ["确认饮水", `${reminders.confirmed} 次`],
                        ["跳过 / Esc", `${reminders.skipped} 次`],
                        ["自动关闭", `${reminders.timedOut} 次`],
                        ["累计展示时长", `${Math.floor(reminders.displaySeconds / 60)} 分 ${reminders.displaySeconds % 60} 秒`],
                      ].map(([label, value]) => (
                        <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>
                      ))}
                    </dl>
                    {reminders.completed === 0 && <p className="mt-3 text-xs text-muted-foreground">此时间范围内暂无已结束提醒，记录从本版本开始积累。</p>}
                  </>
                )}
                <p className="mt-3 text-xs text-muted-foreground">展示时长不是实际休息时长；单次最多计入 30 秒。不包含系统通知，异常退出的提醒不计入。</p>
              </section>
              <p className="mt-2 text-[11px] text-muted-foreground">
                时间分析仅包含有时间信息的记录；旧版总量及未记录的饮水不参与分析。间隔不跨日，相同时间的记录不产生间隔。
              </p>
            </>
          )}

          {hasLegacyData && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              旧版记录未保存当天目标，达标结果按当前目标 {goal}ml 估算。
            </p>
          )}
        </>
      )}
    </div>
  );
}
