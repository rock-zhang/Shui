export interface DrinkEntry {
  requestId?: string;
  amount: number;
  timestamp: string;
}

export interface DrinkDayRecord {
  schemaVersion: 1;
  total: number;
  goal: number;
  entries: DrinkEntry[];
}

export type DrinkHistoryValue = number | Partial<DrinkDayRecord> | null | undefined;

function nonNegative(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function getRecentDates(dayCount: number, endDate = new Date()) {
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(endDate);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (dayCount - index - 1));
    return date;
  });
}

export function normalizeDrinkDay(value: DrinkHistoryValue, fallbackGoal: number): DrinkDayRecord {
  const savedGoal = typeof value === "object" && value ? nonNegative(value.goal) : 0;
  return {
    schemaVersion: 1,
    total: nonNegative(typeof value === "number" ? value : value?.total),
    goal: savedGoal > 0 ? savedGoal : nonNegative(fallbackGoal),
    entries: typeof value === "object" && Array.isArray(value?.entries)
      ? value.entries.filter(entry => typeof entry?.timestamp === "string" && nonNegative(entry?.amount) > 0)
        .map(entry => ({
          ...(typeof entry.requestId === "string" ? { requestId: entry.requestId } : {}),
          amount: Number(entry.amount),
          timestamp: entry.timestamp,
        }))
      : [],
  };
}

export interface DrinkReceipt {
  date: string;
  total: number;
  goal: number;
  added: boolean;
  goalReached: boolean;
}
