/**
 * 与 Android `ReminderScheduler.scheduleNext` 同一套口径的下一次提醒推算。
 * 纯函数、零依赖，供今日页展示与回归测试共用；不要在这里另算「now + gap」，
 * 那会忽略重复日、时间范围、勿扰和达标，和真实闹钟对不上。
 */

export interface ReminderSchedule {
  gap: string | number;
  weekdays: number[] | null | undefined;
  timeStart: string;
  timeEnd: string;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  isPaused: boolean;
  goal: string | number;
  todayTotal: number;
}

export type NextReminder =
  | { kind: "paused" }
  | { kind: "goalReached" }
  | { kind: "none" }
  | { kind: "time"; date: Date };

const DAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const EVERY_DAY = new Set([0, 1, 2, 3, 4, 5, 6]);

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Mirrors Kotlin parseTime: a broken hour falls back to 09:00, minute to :00. */
function parseTime(value: string | null | undefined): number {
  const [rawHour = "", rawMinute = ""] = (value ?? "").split(":");
  const hour = Number.parseInt(rawHour, 10);
  if (!Number.isFinite(hour)) return 9 * 60;
  const minute = Number.parseInt(rawMinute, 10);
  return (
    clamp(hour, 0, 23) * 60 +
    clamp(Number.isFinite(minute) ? minute : 0, 0, 59)
  );
}

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** `end <= start` means the window crosses midnight (00:00 = next day's zero). */
function inWindow(value: number, start: number, end: number) {
  return end <= start
    ? value >= start || value <= end
    : value >= start && value <= end;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clock(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

export function findNextReminder(
  schedule: ReminderSchedule,
  now: Date = new Date()
): NextReminder {
  if (schedule.isPaused) return { kind: "paused" };
  const goal = Number(schedule.goal) || 0;
  if (goal > 0 && schedule.todayTotal >= goal) return { kind: "goalReached" };

  const parsedGap = Number(schedule.gap);
  const gap = clamp(
    Number.isFinite(parsedGap) ? Math.trunc(parsedGap) : 30,
    1,
    720
  );
  const weekdays =
    schedule.weekdays && schedule.weekdays.length > 0
      ? new Set(schedule.weekdays)
      : EVERY_DAY;
  const start = parseTime(schedule.timeStart);
  const end = parseTime(schedule.timeEnd);
  const quietStart = parseTime(schedule.quietStart);
  const quietEnd = parseTime(schedule.quietEnd);

  const candidate = new Date(now.getTime() + gap * 60_000);
  const maxMinutes = 8 * 24 * 60;
  for (let elapsed = gap; elapsed < maxMinutes; elapsed += gap) {
    const minute = minutesOfDay(candidate);
    const inWorkTime = inWindow(minute, start, end);
    const inQuiet =
      schedule.quietEnabled && inWindow(minute, quietStart, quietEnd);
    if (weekdays.has(candidate.getDay()) && inWorkTime && !inQuiet) {
      return { kind: "time", date: candidate };
    }
    // Calendar.add(MINUTE, gap) on the native side.
    candidate.setMinutes(candidate.getMinutes() + gap);
  }
  return { kind: "none" };
}

export function describeNextReminder(
  result: NextReminder,
  now: Date = new Date()
): string {
  switch (result.kind) {
    case "paused":
      return "提醒已暂停";
    case "goalReached":
      return "今日目标已达成，暂停提醒";
    case "none":
      return "当前设置下没有下一次提醒";
    case "time": {
      const time = clock(result.date);
      if (isSameDay(result.date, now)) return `预计下一杯约 ${time}`;
      const tomorrow = new Date(now.getTime());
      tomorrow.setDate(tomorrow.getDate() + 1);
      const when = isSameDay(result.date, tomorrow)
        ? "明天"
        : `周${DAY_LABELS[result.date.getDay()]}`;
      return `今天不提醒 · 下次${when} ${time}`;
    }
  }
}
