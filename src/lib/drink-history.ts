import { normalizeDrinkDay, getLocalDateKey, type DrinkHistoryValue } from "./drink-day";
import type { MessageKey } from "./i18n/messages";
export { normalizeDrinkDay, getLocalDateKey, getRecentDates } from "./drink-day";
export type { DrinkEntry, DrinkDayRecord, DrinkHistoryValue } from "./drink-day";

export interface DrinkDaySummary {
  key: string;
  date: Date;
  total: number;
  goal: number;
  completed: boolean;
  hasHistoricalGoal: boolean;
}

export interface DrinkTimeBucket {
  key: "overnight" | "morning" | "afternoon" | "evening";
  label: string;
  range: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface DrinkPatternAnalysis {
  totalEntries: number;
  totalAmount: number;
  timeBuckets: DrinkTimeBucket[];
  intervalCount: number;
  averageIntervalMinutes: number | null;
  medianIntervalMinutes: number | null;
  shortestIntervalMinutes: number | null;
  longestIntervalMinutes: number | null;
}

function toPositiveNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function summarizeDrinkDays(
  dates: Date[],
  values: DrinkHistoryValue[],
  fallbackGoal: number
): DrinkDaySummary[] {
  return dates.map((date, index) => {
    const value = values[index];
    const normalized = normalizeDrinkDay(value, fallbackGoal);
    const hasHistoricalGoal =
      typeof value === "object" &&
      value !== null &&
      toPositiveNumber(value.goal) > 0;

    return {
      key: getLocalDateKey(date),
      date,
      total: normalized.total,
      goal: normalized.goal || fallbackGoal,
      completed:
        normalized.goal > 0 && normalized.total >= normalized.goal,
      hasHistoricalGoal,
    };
  });
}

const TIME_BUCKETS: Array<
  Pick<DrinkTimeBucket, "key" | "label" | "range">
> = [
  { key: "overnight", label: "凌晨", range: "00:00–06:00" },
  { key: "morning", label: "上午", range: "06:00–12:00" },
  { key: "afternoon", label: "下午", range: "12:00–18:00" },
  { key: "evening", label: "晚间", range: "18:00–24:00" },
];

export function analyzeDrinkPatterns(
  entries: Array<[string, DrinkHistoryValue]>,
  fallbackGoal: number
): DrinkPatternAnalysis {
  const timeBuckets = TIME_BUCKETS.map((bucket) => ({
    ...bucket,
    amount: 0,
    count: 0,
    percentage: 0,
  }));
  const intervals: number[] = [];
  const selectedDays = new Set(entries.map(([key]) => key));
  const timestampsByDay = new Map<string, number[]>();

  entries
    .filter(([key]) => /^\d{8}$/.test(key))
    .forEach(([, value]) => {
      const day = normalizeDrinkDay(value, fallbackGoal);

      day.entries.forEach((entry) => {
        const date = new Date(entry.timestamp);
        const timestamp = date.getTime();
        if (!Number.isFinite(timestamp)) return;
        const localDay = getLocalDateKey(date);
        if (!selectedDays.has(localDay)) return;

        const hour = date.getHours();
        const bucketIndex = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
        timeBuckets[bucketIndex].amount += entry.amount;
        timeBuckets[bucketIndex].count += 1;
        const timestamps = timestampsByDay.get(localDay) ?? [];
        timestamps.push(timestamp);
        timestampsByDay.set(localDay, timestamps);
      });
    });

  timestampsByDay.forEach((timestamps) => {
      timestamps.sort((left, right) => left - right);
      for (let index = 1; index < timestamps.length; index += 1) {
        const interval = (timestamps[index] - timestamps[index - 1]) / 60_000;
        if (interval > 0) intervals.push(interval);
      }
    });

  const totalAmount = timeBuckets.reduce(
    (sum, bucket) => sum + bucket.amount,
    0
  );
  const totalEntries = timeBuckets.reduce(
    (sum, bucket) => sum + bucket.count,
    0
  );
  timeBuckets.forEach((bucket) => {
    bucket.percentage = totalAmount
      ? Math.round((bucket.amount / totalAmount) * 100)
      : 0;
  });

  const sortedIntervals = [...intervals].sort((left, right) => left - right);
  const middle = Math.floor(sortedIntervals.length / 2);
  const median = sortedIntervals.length
    ? sortedIntervals.length % 2 === 0
      ? (sortedIntervals[middle - 1] + sortedIntervals[middle]) / 2
      : sortedIntervals[middle]
    : null;

  return {
    totalEntries,
    totalAmount,
    timeBuckets,
    intervalCount: intervals.length,
    averageIntervalMinutes: intervals.length
      ? intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
      : null,
    medianIntervalMinutes: median,
    shortestIntervalMinutes: sortedIntervals.at(0) ?? null,
    longestIntervalMinutes: sortedIntervals.at(-1) ?? null,
  };
}

function escapeCsvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function formatDateKeyForExport(key: string) {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

const CSV_TEXT_KEYS = {
  date: "settings.statistics.csv.date",
  total: "settings.statistics.csv.total",
  goal: "settings.statistics.csv.goal",
  reached: "settings.statistics.csv.reached",
  amount: "settings.statistics.csv.amount",
  time: "settings.statistics.csv.time",
  yes: "settings.statistics.csv.yes",
  no: "settings.statistics.csv.no",
} as const satisfies Record<string, MessageKey>;

type CsvTextKey = (typeof CSV_TEXT_KEYS)[keyof typeof CSV_TEXT_KEYS];

/** 不传翻译函数时的中文默认值，兼容旧调用方与 Node 测试。 */
const CSV_ZH: Record<string, string> = {
  [CSV_TEXT_KEYS.date]: "日期",
  [CSV_TEXT_KEYS.total]: "每日总量(ml)",
  [CSV_TEXT_KEYS.goal]: "当日目标(ml)",
  [CSV_TEXT_KEYS.reached]: "是否达标",
  [CSV_TEXT_KEYS.amount]: "单次饮水量(ml)",
  [CSV_TEXT_KEYS.time]: "记录时间(ISO)",
  [CSV_TEXT_KEYS.yes]: "是",
  [CSV_TEXT_KEYS.no]: "否",
};

/**
 * 导出 CSV。表头与「是/否」通过 translate 注入，纯函数本身不持有具体语言文案。
 */
export function exportDrinkHistoryCsv(
  entries: Array<[string, DrinkHistoryValue]>,
  fallbackGoal: number,
  translate?: (key: CsvTextKey) => string
) {
  const tr = (key: CsvTextKey) => (translate ? translate(key) : CSV_ZH[key] ?? key);
  const rows: Array<Array<string | number>> = [
    [
      tr(CSV_TEXT_KEYS.date),
      tr(CSV_TEXT_KEYS.total),
      tr(CSV_TEXT_KEYS.goal),
      tr(CSV_TEXT_KEYS.reached),
      tr(CSV_TEXT_KEYS.amount),
      tr(CSV_TEXT_KEYS.time),
    ],
  ];

  entries
    .filter(([key]) => /^\d{8}$/.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => {
      const day = normalizeDrinkDay(value, fallbackGoal);
      const commonFields: Array<string | number> = [
        formatDateKeyForExport(key),
        day.total,
        day.goal,
        day.goal > 0 && day.total >= day.goal ? tr(CSV_TEXT_KEYS.yes) : tr(CSV_TEXT_KEYS.no),
      ];

      if (day.entries.length === 0) {
        rows.push([...commonFields, "", ""]);
        return;
      }

      day.entries.forEach((entry) => {
        rows.push([...commonFields, entry.amount, entry.timestamp]);
      });
    });

  // BOM ensures that spreadsheet apps such as Excel detect UTF-8 Chinese headers.
  return `\uFEFF${rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\r\n")}\r\n`;
}
