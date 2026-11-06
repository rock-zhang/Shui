export interface ReminderSummary {
  completed: number;
  confirmed: number;
  skipped: number;
  timedOut: number;
  displaySeconds: number;
}

export function summarizeReminders(values: unknown[]): ReminderSummary {
  const total: ReminderSummary = {
    completed: 0, confirmed: 0, skipped: 0, timedOut: 0, displaySeconds: 0,
  };
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    for (const key of Object.keys(total) as Array<keyof ReminderSummary>) {
      const amount = (value as Record<string, unknown>)[key];
      if (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0) {
        total[key] += amount;
      }
    }
  }
  return total;
}
