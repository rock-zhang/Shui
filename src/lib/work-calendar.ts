/** Date-only calendar rules shared by settings, previews and next-reminder estimates. */
export interface DateOverride { date: string; remind: boolean; name?: string }
export interface AlternatingWeeks {
  anchorDate: string;
  bigWeekdays: number[];
  smallWeekdays: number[];
}
export interface HolidayCalendar {
  year: number;
  source: string;
  enabled: boolean;
  days: DateOverride[];
}
export interface WorkCalendarConfig {
  weekdays?: number[] | null;
  scheduleMode?: "weekly" | "alternating";
  alternatingWeeks?: AlternatingWeeks;
  dateOverrides?: DateOverride[];
  holidayCalendars?: HolidayCalendar[];
}
export type CalendarReason = "custom_workday" | "custom_day_off" | "holiday_workday" |
  "holiday_day_off" | "big_week" | "small_week" | "weekly_workday" | "weekly_day_off";
export interface CalendarDay { date: string; remind: boolean; reason: CalendarReason; name: string }

export function localCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
// UTC is used only for calendar-day arithmetic, never to derive the local date.
const ordinal = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
const fromOrdinal = (value: number) => new Date(value * 86_400_000).toISOString().slice(0, 10);
const monday = (value: string) => ordinal(value) - ((ordinal(value) + 3) % 7 + 7) % 7;

export function defaultAlternating(today = localCalendarDate()): AlternatingWeeks {
  return { anchorDate: fromOrdinal(monday(today)), bigWeekdays: [1, 2, 3, 4, 5, 6], smallWeekdays: [1, 2, 3, 4, 5] };
}
export function calendarDay(date: string, config: WorkCalendarConfig): CalendarDay {
  const custom = config.dateOverrides?.find((rule) => rule.date === date);
  if (custom) return { date, remind: custom.remind, reason: custom.remind ? "custom_workday" : "custom_day_off", name: custom.name ?? "" };
  const holiday = config.holidayCalendars?.filter((calendar) => calendar.enabled)
    .flatMap((calendar) => calendar.days).find((rule) => rule.date === date);
  if (holiday) return { date, remind: holiday.remind, reason: holiday.remind ? "holiday_workday" : "holiday_day_off", name: holiday.name ?? "" };
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (config.scheduleMode === "alternating" && config.alternatingWeeks) {
    const alternating = config.alternatingWeeks;
    const big = Math.floor((ordinal(date) - monday(alternating.anchorDate)) / 7) % 2 === 0;
    return { date, remind: (big ? alternating.bigWeekdays : alternating.smallWeekdays).includes(weekday), reason: big ? "big_week" : "small_week", name: "" };
  }
  const remind = (config.weekdays ?? []).includes(weekday);
  return { date, remind, reason: remind ? "weekly_workday" : "weekly_day_off", name: "" };
}
export function dateRange(start: string, end = start): string[] {
  if (!isCalendarDate(start) || !isCalendarDate(end) || start > end) throw new Error("calendar.invalidRange");
  const count = ordinal(end) - ordinal(start) + 1;
  if (count > 366) throw new Error("calendar.rangeTooLong");
  return Array.from({ length: count }, (_, index) => fromOrdinal(ordinal(start) + index));
}
export function parseHolidayCalendar(text: string, source: string): HolidayCalendar {
  const value = JSON.parse(text);
  if (!Number.isInteger(value.year) || value.year < 1 || value.year > 9999 || !Array.isArray(value.days) || !value.days.length) {
    throw new Error("calendar.invalidImport");
  }
  const seen = new Set<string>();
  const days: DateOverride[] = value.days.map((entry: { date: string; isOffDay: boolean; name?: string }) => {
    if (typeof entry.date !== "string" || !isCalendarDate(entry.date) || Number(entry.date.slice(0, 4)) !== value.year ||
      typeof entry.isOffDay !== "boolean" || seen.has(entry.date)) throw new Error("calendar.invalidImport");
    seen.add(entry.date);
    return { date: entry.date, remind: !entry.isOffDay, name: typeof entry.name === "string" ? entry.name : "" };
  });
  return { year: value.year, source, enabled: true, days: days.sort((a, b) => a.date.localeCompare(b.date)) };
}
export function holidayUrl(year: number): string {
  return `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`;
}
