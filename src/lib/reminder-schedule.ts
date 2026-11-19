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

/**
 * 供渲染层翻译的结构化文案。纯函数不持有任何语言文案，周几用 0-6 的
 * getDay() 下标表示，`weekday: null` 表示「明天」。
 */
export type NextReminderText =
  | { kind: "paused" }
  | { kind: "goalReached" }
  | { kind: "none" }
  | { kind: "imminent" }
  | { kind: "today"; time: string; minutes: number | null }
  | { kind: "later"; weekday: number | null; time: string };

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
): NextReminderText {
  switch (result.kind) {
    case "paused":
      return { kind: "paused" };
    case "goalReached":
      return { kind: "goalReached" };
    case "none":
      return { kind: "none" };
    case "time": {
      const time = clock(result.date);
      if (isSameDay(result.date, now)) {
        return { kind: "today", time, minutes: null };
      }
      const tomorrow = new Date(now.getTime());
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        kind: "later",
        weekday: isSameDay(result.date, tomorrow) ? null : result.date.getDay(),
        time,
      };
    }
  }
}

/**
 * 把原生已排定的绝对时间（毫秒）格式化成今日页文案。
 *
 * 原生返回的是一个固定的时间点，重渲染不会改变它；这里只负责按 `now`
 * 更新「还有 N 分钟」这类相对描述。`now` 可注入，便于回归测试。
 */
export function describeNextAt(
  nextAt: number,
  now: number = Date.now()
): NextReminderText {
  const target = new Date(nextAt);
  if (!Number.isFinite(target.getTime())) {
    return { kind: "none" };
  }
  if (target.getTime() <= now) {
    return { kind: "imminent" };
  }

  const time = clock(target);
  if (isSameDay(target, new Date(now))) {
    // 用四舍五入而非向上取整：闹钟排在「锚点+gap」的网格点上，真实剩余恒
    // 不超过 gap，ceil 会把「还剩 59 秒」也报成「2 分钟」（1 分钟测试档尤其
    // 明显）。调用方的时间快照可能有几秒滞后，round 也能把它吸收掉，不会
    // 因为多出几秒就凭空多报一分钟。
    const minutes = Math.max(1, Math.round((target.getTime() - now) / 60_000));
    return { kind: "today", time, minutes };
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    kind: "later",
    weekday: isSameDay(target, tomorrow) ? null : target.getDay(),
    time,
  };
}
