"use client";

import { useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, WEEKDAY_LONG_KEYS, WEEKDAY_SHORT_KEYS, type MessageKey } from "@/lib/i18n";
import { calendarDay, dateRange, defaultAlternating, holidayUrl, localCalendarDate, parseHolidayCalendar,
  type AlternatingWeeks, type DateOverride, type HolidayCalendar, type WorkCalendarConfig } from "@/lib/work-calendar";
import { useDayChange } from "@/hooks/use-day-change";
import type { AlertConfig } from "@/lib/mobile";

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm max-w-full";
const panelClass = "rounded-lg border p-3 space-y-3 min-w-0";

function Weekdays({ value, onChange, label }: { value: number[]; onChange: (days: number[]) => void; label: string }) {
  const { t } = useI18n();
  return <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
    {WEEKDAY_SHORT_KEYS.map((key, day) => <button key={day} type="button"
      aria-label={`${label} ${t(WEEKDAY_LONG_KEYS[day])}`} aria-pressed={value.includes(day)}
      onClick={() => onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort())}
      className={`h-9 min-w-9 rounded-full px-2 text-sm ${value.includes(day) ? "bg-primary text-primary-foreground" : "border bg-background"}`}>
      {t(key)}
    </button>)}
  </div>;
}

function Rotation({ value, onSave }: { value: AlternatingWeeks; onSave: (value: AlternatingWeeks) => Promise<boolean> }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  return <form data-calendar-rotation aria-label={t("calendar.alternating")} className="space-y-3" onSubmit={async (event) => {
    event.preventDefault(); await onSave(draft);
  }}>
    <label className="block text-sm space-y-1">{t("calendar.anchor")}
      <Input name="rotation-anchor" type="date" required value={draft.anchorDate} aria-label={t("calendar.anchor")}
        onChange={(event) => setDraft({ ...draft, anchorDate: event.target.value })} />
    </label>
    <p className="text-xs text-muted-foreground">{t("calendar.anchorHint")}</p>
    <p className="text-sm font-medium">{t("calendar.big")}</p>
    <Weekdays value={draft.bigWeekdays} label={t("calendar.big")} onChange={(bigWeekdays) => setDraft({ ...draft, bigWeekdays })} />
    <p className="text-sm font-medium">{t("calendar.small")}</p>
    <Weekdays value={draft.smallWeekdays} label={t("calendar.small")} onChange={(smallWeekdays) => setDraft({ ...draft, smallWeekdays })} />
    <Button size="sm" type="submit">{t("calendar.applyRotation")}</Button>
  </form>;
}

export function WorkCalendarSettings({ config, onSave }: {
  config: WorkCalendarConfig;
  onSave: (patch: Partial<AlertConfig>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [today, setToday] = useState(localCalendarDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(today);
  const [end, setEnd] = useState("");
  const [remind, setRemind] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string>();
  const [pendingDates, setPendingDates] = useState<{ rules: DateOverride[]; count: number; conflicts: number }>();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [imported, setImported] = useState<HolidayCalendar>();
  useDayChange(() => {
    const next = localCalendarDate();
    setToday(next);
    if (!editing && !end && !name && !remind) {
      setDate((value) => value === today ? next : value);
    }
  });
  const rules = config.dateOverrides ?? [];
  const calendars = config.holidayCalendars ?? [];
  const day = calendarDay(today, config);
  const save = async (patch: Partial<AlertConfig>) => {
    setBusy(true); setError("");
    try { return await onSave(patch); }
    finally { setBusy(false); }
  };
  const reset = () => { setDate(today); setEnd(""); setName(""); setRemind(false); setEditing(undefined); setPendingDates(undefined); setError(""); };
  const saveDates = async (next: DateOverride[]) => {
    if (await save({ dateOverrides: next })) reset();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const dates = dateRange(date, end || date);
      if (dates.length === 1 && rules.some((rule) => rule.date === date && rule.date !== editing)) throw new Error("calendar.duplicate");
      const next = new Map(rules.filter((rule) => rule.date !== editing).map((rule) => [rule.date, rule]));
      const conflicts = dates.filter((date) => next.has(date)).length;
      dates.forEach((date) => next.set(date, { date, remind, name: name.trim() }));
      const updated = [...next.values()].sort((a, b) => a.date.localeCompare(b.date));
      if (dates.length > 1) setPendingDates({ rules: updated, count: dates.length, conflicts });
      else await saveDates(updated);
    } catch (error) { setError(t((error as Error).message as MessageKey)); }
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    setImported(undefined); setError("");
    try { setImported(parseHolidayCalendar(await file.text(), file.name)); }
    catch { setError(t("calendar.invalidImport")); }
  };
  const fetchYear = async () => {
    setBusy(true); setImported(undefined); setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(holidayUrl(year), { signal: controller.signal });
      if (!response.ok) throw new Error();
      const calendar = parseHolidayCalendar(await response.text(), "holiday-cn");
      if (calendar.year !== year) throw new Error();
      setImported(calendar);
    } catch { setError(t("calendar.fetchFailed")); }
    finally { window.clearTimeout(timeout); setBusy(false); }
  };
  return <fieldset disabled={busy} aria-busy={busy} data-calendar-ready={String(!busy)} className="min-w-0 space-y-4 mb-4">
    <section className={panelClass} aria-label={t("calendar.title")}>
      <h4 className="text-sm font-medium">{t("calendar.title")}</h4>
      <p className="text-xs text-muted-foreground">{t("calendar.priority")}</p>
      <div role="status" data-calendar-today={today} data-calendar-reason={day.reason}
        className="rounded-md bg-muted p-2 text-sm">
        <p className="font-medium">{t("calendar.today", { date: today, state: t(day.remind ? "calendar.remind" : "calendar.rest") })}</p>
        <p className="text-xs text-muted-foreground">{t(`calendar.${day.reason}`)}{day.name && ` · ${day.name}`}</p>
      </div>
      <p className="text-xs text-muted-foreground">{t("calendar.gates")}</p>
      <div data-onboarding="weekdays" className="space-y-3">
      <label className="flex flex-wrap items-center justify-between gap-2 text-sm">{t("calendar.mode")}
        <select name="schedule-mode" aria-label={t("calendar.mode")} className={selectClass} value={config.scheduleMode ?? "weekly"}
          onChange={(event) => save({ scheduleMode: event.target.value as "weekly" | "alternating",
            alternatingWeeks: config.alternatingWeeks ?? defaultAlternating(today) })}>
          <option value="weekly">{t("calendar.weekly")}</option><option value="alternating">{t("calendar.alternating")}</option>
        </select>
      </label>
      {config.scheduleMode === "alternating" ? <Rotation key={JSON.stringify(config.alternatingWeeks)}
        value={config.alternatingWeeks ?? defaultAlternating(today)} onSave={(alternatingWeeks) => save({ alternatingWeeks })} /> :
        <Weekdays label={t("calendar.weekly")} value={config.weekdays ?? []} onChange={(weekdays) => save({ weekdays })} />}
      </div>
      <details><summary className="cursor-pointer text-sm">{t("calendar.preview")}</summary>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs max-h-72 overflow-y-auto" aria-label={t("calendar.preview")}>
          {dateRange(today, (() => { const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate() + 27); return localCalendarDate(date); })()).map((date) => {
            const plan = calendarDay(date, config);
            return <li key={date} data-preview-date={date} data-preview-remind={String(plan.remind)} className="rounded border p-2">
              <p className="font-medium">{date} · {t(plan.remind ? "calendar.remind" : "calendar.rest")}</p>
              <p className="text-muted-foreground">{t(`calendar.${plan.reason}`)}{plan.name && ` · ${plan.name}`}</p>
            </li>;
          })}
        </ul>
      </details>
    </section>

    <section className={panelClass} aria-label={t("calendar.customTitle")}>
      <h4 className="text-sm font-medium">{t("calendar.customTitle")}</h4>
      <form data-calendar-custom aria-label={t("calendar.customTitle")} onSubmit={submit} className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs">{t("calendar.date")}<Input name="custom-start" aria-label={t("calendar.date")} type="date" required value={date} onChange={(e) => { setDate(e.target.value); setPendingDates(undefined); }} /></label>
          <label className="text-xs">{t("calendar.end")}<Input name="custom-end" aria-label={t("calendar.end")} type="date" min={date} value={end} onChange={(e) => { setEnd(e.target.value); setPendingDates(undefined); }} /></label>
        </div>
        <label className="block text-xs">{t("calendar.name")}<Input name="custom-name" aria-label={t("calendar.name")} value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setPendingDates(undefined); }} /></label>
        <div className="flex flex-wrap gap-2">
          <select name="custom-arrangement" className={selectClass} aria-label={t("calendar.arrangement")} value={String(remind)} onChange={(e) => { setRemind(e.target.value === "true"); setPendingDates(undefined); }}>
            <option value="false">{t("calendar.dayOff")}</option><option value="true">{t("calendar.workday")}</option>
          </select>
          <Button type="submit" size="sm">{t(editing ? "calendar.saveEdit" : "calendar.add")}</Button>
          {editing && <Button type="button" variant="outline" size="sm" onClick={reset}>{t("common.cancel")}</Button>}
        </div>
      </form>
      {pendingDates && <div className="rounded border p-2 space-y-2" role="status">
        <p className="text-xs">{t("calendar.rangeConfirm", { count: pendingDates.count, conflicts: pendingDates.conflicts })}</p>
        <Button size="sm" onClick={() => saveDates(pendingDates.rules)}>{t("calendar.confirm")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setPendingDates(undefined)}>{t("common.cancel")}</Button>
      </div>}
      {!rules.length ? <p className="text-xs text-muted-foreground">{t("calendar.empty")}</p> :
        <ul className="divide-y max-h-64 overflow-y-auto">
          {rules.map((rule) => <li key={rule.date} data-rule-date={rule.date} className="flex flex-wrap items-center justify-between gap-1 py-2 text-xs">
            <span className="min-w-0 break-words">{rule.date} · {t(rule.remind ? "calendar.workday" : "calendar.dayOff")}{rule.name && ` · ${rule.name}`}</span>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" aria-label={t("calendar.edit", { date: rule.date })}
                onClick={() => { setDate(rule.date); setEnd(""); setRemind(rule.remind); setName(rule.name ?? ""); setEditing(rule.date); setPendingDates(undefined); setError(""); }}>{t("calendar.edit", { date: "" })}</Button>
              <Button type="button" variant="ghost" size="sm" aria-label={t("calendar.delete", { date: rule.date })}
                onClick={async () => { if (await save({ dateOverrides: rules.filter((r) => r.date !== rule.date) }) && editing === rule.date) reset(); }}>{t("calendar.delete", { date: "" })}</Button>
            </div>
          </li>)}
        </ul>}
    </section>

    <section className={panelClass} aria-label={t("calendar.holidays")}>
      <h4 className="text-sm font-medium">{t("calendar.holidays")}</h4>
      <p className="text-xs text-muted-foreground">{t("calendar.importHint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">{t("calendar.year")}<Input type="number" min={2007} max={9999} className="w-24" aria-label={t("calendar.year")} value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <Button size="sm" onClick={fetchYear} disabled={!Number.isInteger(year) || year < 2007 || year > 9999}>{t(busy ? "calendar.fetching" : "calendar.fetch")}</Button>
        <label className="inline-flex cursor-pointer items-center rounded border px-3 h-8 text-sm">
          {t("calendar.file")}<input name="holiday-file" type="file" accept=".json,application/json" aria-label={t("calendar.file")} className="sr-only"
            onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => openUrl("https://github.com/NateScarlet/holiday-cn")}>{t("calendar.source")}</button>
      {imported && <div data-import-preview={imported.year} className="rounded border p-2 space-y-2">
        <p className="text-sm font-medium">{t("calendar.importSummary", { year: imported.year, rest: imported.days.filter((d) => !d.remind).length, work: imported.days.filter((d) => d.remind).length })}</p>
        <p className="text-xs text-muted-foreground">{t("calendar.importConflicts", { count: rules.filter((r) => imported.days.some((d) => d.date === r.date)).length })}</p>
        <ul className="max-h-40 overflow-y-auto text-xs space-y-1">{imported.days.map((rule) => <li key={rule.date}>{rule.date} · {t(rule.remind ? "calendar.workday" : "calendar.dayOff")} · {rule.name}</li>)}</ul>
        <Button size="sm" onClick={async () => {
          if (await save({ holidayCalendars: [...calendars.filter((c) => c.year !== imported.year), imported].sort((a, b) => a.year - b.year) })) setImported(undefined);
        }}>{t("calendar.importConfirm")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setImported(undefined)}>{t("common.cancel")}</Button>
      </div>}
      {!calendars.length && <p className="text-xs text-muted-foreground">{t("calendar.noHolidays")}</p>}
      {calendars.map((calendar) => <div key={calendar.year} data-holiday-year={calendar.year} className="flex flex-wrap items-center justify-between gap-2 text-xs border-t pt-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={calendar.enabled} aria-label={t("calendar.enableYear", { year: calendar.year })}
          onChange={(e) => save({ holidayCalendars: calendars.map((c) => c.year === calendar.year ? { ...c, enabled: e.target.checked } : c) })} />
          <span>{calendar.year} · {calendar.days.length} · {calendar.source}</span></label>
        <Button size="sm" variant="ghost" aria-label={t("calendar.removeYear", { year: calendar.year })}
          onClick={() => save({ holidayCalendars: calendars.filter((c) => c.year !== calendar.year) })}>{t("calendar.delete", { date: "" })}</Button>
      </div>)}
    </section>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </fieldset>;
}
