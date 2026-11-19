"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import { STORE_NAME } from "@/lib/constants";
import {
  analyzeDrinkPatterns,
  getLocalDateKey,
  getRecentDates,
  normalizeDrinkDay,
  summarizeDrinkDays,
  type DrinkDaySummary,
} from "@/lib/drink-history";
import { summarizeReminders, type ReminderSummary } from "@/lib/reminder-history";
import type { DrinkDayRecord, DrinkHistoryValue } from "@/lib/drink-day";
import { isDemoPreview, isMobilePreview, onRefresh } from "@/lib/mobile";

interface Snapshot {
  goal: number;
  today: DrinkDayRecord;
  days: DrinkDaySummary[];
  entries: Array<[string, DrinkHistoryValue]>;
  reminders: ReminderSummary;
  reminderError: boolean;
}

const EMPTY: Snapshot = {
  goal: 0,
  today: normalizeDrinkDay(null, 0),
  days: [],
  entries: [],
  reminders: summarizeReminders([]),
  reminderError: false,
};

/** Fake but internally consistent data for the `?demo=1` desktop preview. */
function buildDemoSnapshot(period: 7 | 30): Snapshot {
  const goal = 1500;
  const dates = getRecentDates(period);
  const totals = [1200, 1650, 900, 1800, 1400, 1550, 2100, 1350, 1700, 1100];
  const values: DrinkHistoryValue[] = dates.map((date, index) => {
    const total = totals[index % totals.length];
    const at = (hour: number, minute: number) =>
      new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        hour,
        minute
      ).toISOString();
    const amounts = [0.2, 0.15, 0.35].map((share) =>
      Math.round((total * share) / 10) * 10
    );
    amounts.push(total - amounts.reduce((sum, value) => sum + value, 0));
    return {
      schemaVersion: 1,
      total,
      goal,
      entries: [
        { requestId: `demo-${index}-a`, amount: amounts[0], timestamp: at(8, 40) },
        { requestId: `demo-${index}-b`, amount: amounts[1], timestamp: at(11, 15) },
        { requestId: `demo-${index}-c`, amount: amounts[2], timestamp: at(15, 30) },
        { requestId: `demo-${index}-d`, amount: amounts[3], timestamp: at(19, 5) },
      ],
    };
  });

  return {
    goal,
    today: normalizeDrinkDay(values.at(-1), goal),
    days: summarizeDrinkDays(dates, values, goal),
    entries: dates.map(
      (date, index) =>
        [getLocalDateKey(date), values[index]] as [string, DrinkHistoryValue]
    ),
    reminders: {
      completed: 23,
      confirmed: 18,
      skipped: 4,
      timedOut: 1,
      displaySeconds: 412,
    },
    reminderError: false,
  };
}

/**
 * One read path shared by the Today and Data tabs. All aggregation still comes
 * from src/lib, so desktop and mobile can never disagree about the numbers.
 */
export function useDrinkData(period: 7 | 30 = 7) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  // Notification actions record water on the native side while the WebView is
  // frozen; a refresh bus keeps every tab in sync when it comes back.
  useEffect(() => onRefresh(reload), [reload]);

  useEffect(() => {
    if (isDemoPreview()) {
      setSnapshot(buildDemoSnapshot(period));
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    (async () => {
      const [configStore, historyStore] = await Promise.all([
        load(STORE_NAME.config, { autoSave: false }),
        load(STORE_NAME.drink_history, { autoSave: false }),
      ]);
      const alert = await configStore.get<{ gold?: string | number }>("alert");
      const goal = Number(alert?.gold) || 0;
      const dates = getRecentDates(period);
      const keys = dates.map((date) => getLocalDateKey(date));
      const values = await Promise.all(
        keys.map((key) => historyStore.get<DrinkHistoryValue>(key))
      );
      const todayValue = await historyStore.get<DrinkHistoryValue>(
        getLocalDateKey(new Date())
      );

      let reminders = summarizeReminders([]);
      let reminderError = false;
      try {
        const reminderStore = await load(STORE_NAME.reminder_history, {
          autoSave: false,
        });
        const records = await Promise.all(
          keys.map((key) => reminderStore.get(key))
        );
        reminders = summarizeReminders(records);
      } catch {
        reminderError = true;
      }

      if (!cancelled) {
        setSnapshot({
          goal,
          today: normalizeDrinkDay(todayValue, goal),
          days: summarizeDrinkDays(dates, values, goal),
          entries: dates.map(
            (date, index) =>
              [keys[index], values[index]] as [string, DrinkHistoryValue]
          ),
          reminders,
          reminderError,
        });
      }
    })()
      .catch((failure) => {
        console.error("读取饮水数据失败", failure);
        if (!cancelled) {
          if (isMobilePreview()) setSnapshot(EMPTY);
          else setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period, revision]);

  const analysis = useMemo(
    () => analyzeDrinkPatterns(snapshot.entries, snapshot.goal),
    [snapshot.entries, snapshot.goal]
  );

  const summary = useMemo(() => {
    const total = snapshot.days.reduce((sum, day) => sum + day.total, 0);
    return {
      average: snapshot.days.length ? Math.round(total / snapshot.days.length) : 0,
      completedDays: snapshot.days.filter((day) => day.completed).length,
      today: snapshot.today.total,
    };
  }, [snapshot.days, snapshot.today]);

  return {
    ...snapshot,
    analysis,
    summary,
    loading,
    error,
    reload,
  };
}
