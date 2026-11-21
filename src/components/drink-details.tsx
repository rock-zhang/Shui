"use client";

import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { formatTimeLabel } from "@/lib/mobile";
import { track } from "@/lib/analytics";
import { normalizeDrinkDay, type DrinkHistoryValue } from "@/lib/drink-day";

type Notice = { key: MessageKey; params?: Record<string, string | number> } | null;

export function DrinkDetails({ entries, goal, onChanged }: {
  entries: Array<[string, DrinkHistoryValue]>;
  goal: number;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const busy = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const days = entries.map(([date, value]) => ({ date, ...normalizeDrinkDay(value, goal) }))
    .filter(day => day.total > 0 || day.entries.length > 0).reverse();

  async function undo(date: string, requestId: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(requestId);
    setNotice(null);
    try {
      await invoke("undo_drink", { date, requestId });
      track("drink_undo", { result: "success", surface: "details" });
      setConfirmation(null);
      setNotice({ key: "common.details.undoSuccess" });
      onChanged();
    } catch (error) {
      console.error("撤销失败", error);
      track("drink_undo", { result: "failed", surface: "details" });
      setNotice({ key: "common.details.undoFailed" });
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return <section className="mb-4 rounded-lg border p-4">
    <h2 className="mb-2 text-sm font-medium">{t("common.details.title")}</h2>
    <p className="mb-3 text-xs text-muted-foreground">{t("common.details.description")}</p>
    {notice && <p role="status" className="mb-2 text-sm">{t(notice.key, notice.params)}</p>}
    {days.length === 0 && <p className="text-sm text-muted-foreground">{t("common.details.empty")}</p>}
    <div className="max-h-80 space-y-3 overflow-y-auto">
      {days.map(day => {
        const untracked = Math.max(0, day.total - day.entries.reduce((sum, entry) => sum + entry.amount, 0));
        return <details key={day.date}>
          <summary className="cursor-pointer text-sm">{day.date.slice(0, 4)}-{day.date.slice(4, 6)}-{day.date.slice(6)} · {day.total} ml</summary>
          {untracked > 0 && <p className="my-2 text-xs text-muted-foreground">{t("common.details.untracked", { amount: untracked })}</p>}
          {[...day.entries].reverse().map((entry, index) => <div key={entry.requestId ?? index} className="flex items-center justify-between gap-2 border-b py-2 text-sm">
            <span>{formatTimeLabel(entry.timestamp, t("common.details.unknownTime"), locale)} · {entry.amount} ml</span>
            {entry.requestId ? <div className="flex items-center gap-2">
              {confirmation === entry.requestId ? <>
                <span className="text-xs">{t("common.details.confirmUndo")}</span>
                <Button size="sm" variant="destructive" disabled={pending !== null} onClick={() => undo(day.date, entry.requestId!)}>{pending === entry.requestId ? t("common.details.undoing") : t("common.details.confirm")}</Button>
                <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => setConfirmation(null)}>{t("common.cancel")}</Button>
              </> : <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => { setConfirmation(entry.requestId!); setNotice(null); }}>{t("common.details.undo")}</Button>}
            </div> : <span className="text-xs text-muted-foreground">{t("common.details.legacy")}</span>}
          </div>)}
        </details>;
      })}
    </div>
  </section>;
}
