"use client";

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDrinkData } from "@/hooks/use-drink-data";
import { STORE_NAME } from "@/lib/constants";
import {
  exportDrinkHistoryCsv,
  type DrinkDaySummary,
  type DrinkPatternAnalysis,
} from "@/lib/drink-history";
import type { DrinkHistoryValue } from "@/lib/drink-day";
import type { ReminderSummary } from "@/lib/reminder-history";
import { MobileEmpty, MobileSection, MobileSegmented, MobileStat } from "./ui";
import { cn } from "@/lib/utils";

const PERIOD_OPTIONS = [
  { value: "7", label: "近 7 天" },
  { value: "30", label: "近 30 天" },
] as const;

function formatInterval(minutes: number | null) {
  if (minutes === null) return "--";
  if (minutes < 1) return "不足 1 分钟";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} 分钟`;
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return remaining ? `${hours} 小时 ${remaining} 分` : `${hours} 小时`;
}

/** Horizontally scrollable bars: 30 days no longer compress into 6px columns. */
function TrendChart({
  days,
  goal,
}: {
  days: DrinkDaySummary[];
  goal: number;
}) {
  const chartMax = Math.max(
    Math.ceil(Math.max(goal, ...days.map((day) => day.total), 1) / 500) * 500,
    500
  );
  const goalHeight = Math.min((goal / chartMax) * 100, 100);
  const width = Math.max(days.length * 20, 320);

  return (
    <div className="mobile-scroll -mx-1 overflow-x-auto px-1 pb-2">
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
          {days.map((day, index) => {
            const height = Math.min((day.total / chartMax) * 100, 100);
            const showLabel =
              days.length <= 7 || index % 5 === 0 || index === days.length - 1;
            return (
              <div
                key={day.key}
                className="relative flex h-full min-w-[14px] flex-1 items-end"
                title={`${day.date.getMonth() + 1}/${day.date.getDate()}：${day.total}ml`}
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
        纵轴上限 {chartMax} ml · 绿色为达标日 · 虚线为当前目标 · 左右滑动查看
      </p>
    </div>
  );
}

function PatternCards({ analysis }: { analysis: DrinkPatternAnalysis }) {
  return (
    <MobileSection title="饮水习惯">
      <p className="mb-3 text-xs text-muted-foreground">
        时间分布 · 基于 {analysis.totalEntries} 次有效记录
      </p>
      {analysis.totalEntries === 0 ? (
        <MobileEmpty title="还没有足够数据" description="记录几次饮水后，这里会显示时段偏好" />
      ) : (
        <div className="space-y-3">
          {analysis.timeBuckets.map((bucket) => (
            <div key={bucket.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium">
                  {bucket.label}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    {bucket.range}
                  </span>
                </span>
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {bucket.amount}ml · {bucket.count}次
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
        <p className="text-xs text-muted-foreground">平均饮水间隔</p>
        <p className="mt-1 text-xl font-semibold">
          {formatInterval(analysis.averageIntervalMinutes)}
        </p>
        {analysis.intervalCount > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              ["最短", analysis.shortestIntervalMinutes],
              ["中位", analysis.medianIntervalMinutes],
              ["最长", analysis.longestIntervalMinutes],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg bg-muted/60 py-2">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="mt-0.5 text-xs font-medium">
                  {formatInterval(value as number | null)}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          仅计算同一天内的相邻记录，基于 {analysis.intervalCount} 个有效间隔
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
  const rows: Array<[string, string]> = [
    ["已结束提醒", `${reminders.completed} 次`],
    ["确认饮水", `${reminders.confirmed} 次`],
    ["跳过 / 关闭", `${reminders.skipped} 次`],
    ["自动超时", `${reminders.timedOut} 次`],
    [
      "累计展示时长",
      `${Math.floor(reminders.displaySeconds / 60)} 分 ${reminders.displaySeconds % 60} 秒`,
    ],
  ];

  return (
    <MobileSection
      title="提醒结果统计"
      description="全屏提醒与通知操作都会计入，按开始日期归档"
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          提醒统计暂时无法读取
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
          此时间范围内暂无已结束提醒。通知 Action 的计数由原生侧在阶段 2 接入。
        </p>
      )}
    </MobileSection>
  );
}

export function DataTab() {
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
    reload,
    goal,
  } = useDrinkData(period);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
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
      const saved = await invoke<string | null>("save_drink_history_csv", {
        content: csv,
      });
      if (saved) toast.success("饮水记录已导出");
    } catch (failure) {
      console.error("导出饮水记录失败", failure);
      toast.error("导出失败：Android 需接入系统文件选择器（阶段 2）");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <MobileSection>
        <MobileSegmented
          value={periodValue}
          options={PERIOD_OPTIONS}
          onChange={setPeriodValue}
          label="统计周期"
        />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MobileStat label="今日" value={loading ? "--" : summary.today} unit="ml" />
          <MobileStat label="日均" value={loading ? "--" : summary.average} unit="ml" />
          <MobileStat
            label="达标"
            value={loading ? "--" : summary.completedDays}
            unit="天"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-10 flex-1"
            disabled={loading}
            onClick={reload}
          >
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-10 flex-1"
            disabled={exporting}
            onClick={handleExport}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            {exporting ? "导出中" : "导出 CSV"}
          </Button>
        </div>
      </MobileSection>

      {error ? (
        <MobileSection>
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        </MobileSection>
      ) : (
        <>
          <MobileSection
            title="饮水量趋势"
            description={`每日累计饮水量 · 目标 ${goal || "--"} ml`}
          >
            <TrendChart days={days} goal={goal} />
          </MobileSection>
          <PatternCards analysis={analysis} />
          <ReminderStats reminders={reminders} error={reminderError} />
          <p className="px-1 pb-2 text-[11px] leading-5 text-muted-foreground">
            旧版记录未保存当天目标，达标结果按当前目标估算；时间分析仅包含有时间信息的记录，间隔不跨日。
          </p>
        </>
      )}
    </>
  );
}
