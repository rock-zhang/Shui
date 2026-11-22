"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recordDrink } from "@/utils/record-drink";
import { trackDrinkRecorded } from "@/lib/analytics";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_ALERT,
  DEFAULT_QUICK_AMOUNTS,
  emitRefresh,
  MAX_QUICK_AMOUNT,
  MIN_QUICK_AMOUNT,
  normalizeQuickAmounts,
  readConfig,
  STEP_QUICK_AMOUNT,
  writeConfig,
  type AlertConfig,
} from "@/lib/mobile";

export function ManualDrink({ onRecorded }: { onRecorded: () => void }) {
  const { t } = useI18n();
  const busy = useRef(false);
  const pending = useRef<{ amount: number; id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [amounts, setAmounts] = useState<number[]>([...DEFAULT_QUICK_AMOUNTS]);
  const [draft, setDraft] = useState<number[]>([...DEFAULT_QUICK_AMOUNTS]);
  const [editing, setEditing] = useState(false);
  const [savingAmounts, setSavingAmounts] = useState(false);

  // 快捷杯量与提醒窗口 / 通知 / 托盘共用 `alert.quickAmounts`，
  // 这里只负责读取和编辑，其它消费方各自读同一份配置。
  useEffect(() => {
    let cancelled = false;
    void readConfig<AlertConfig>("alert", DEFAULT_ALERT).then((alert) => {
      if (cancelled) return;
      const next = normalizeQuickAmounts(alert.quickAmounts);
      setAmounts(next);
      setDraft(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(amount: number) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(false);
    try {
      // A failed/uncertain response keeps its ID for an explicit retry.
      if (!pending.current) pending.current = { amount, id: crypto.randomUUID() };
      const entry = pending.current;
      const receipt = await recordDrink(entry.amount, entry.id);
      pending.current = null;
      trackDrinkRecorded(receipt, entry.amount, "manual_today");
      onRecorded();
    } catch (failure) {
      console.error("手动记录失败:", failure);
      setError(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function adjust(index: number, delta: number) {
    setDraft((previous) =>
      previous.map((value, slot) =>
        slot === index
          ? Math.min(
              MAX_QUICK_AMOUNT,
              Math.max(MIN_QUICK_AMOUNT, value + delta)
            )
          : value
      )
    );
  }

  async function saveAmounts() {
    if (savingAmounts) return;
    setSavingAmounts(true);
    try {
      // 写回时合并当前 alert，避免覆盖目标、间隔等其它字段。
      const alert = await readConfig<AlertConfig>("alert", DEFAULT_ALERT);
      await writeConfig("alert", { ...alert, quickAmounts: draft });
      setAmounts(draft);
      setEditing(false);
      // 提醒窗口 / 托盘 / 系统通知都监听刷新事件，保存后立即切换到新档位。
      emitRefresh();
    } catch (failure) {
      console.error("保存快捷杯量失败:", failure);
      toast.error(t("common.manualDrink.quickAmountsSaveFailed"));
    } finally {
      setSavingAmounts(false);
    }
  }

  return (
    <section className="mb-4 rounded-lg border p-4" aria-label={t("common.manualDrink.label")}>
      <h4 className="text-sm font-medium">{t("common.manualDrink.title")}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{t("common.manualDrink.description")}</p>
      {editing ? (
        <div className="mt-3 space-y-2">
          {draft.map((amount, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"
            >
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t("common.manualDrink.decrease")}
                disabled={savingAmounts || amount <= MIN_QUICK_AMOUNT}
                onClick={() => adjust(index, -STEP_QUICK_AMOUNT)}
              >
                <Minus />
              </Button>
              <span className="w-16 text-center text-sm font-medium tabular-nums">
                {amount}ml
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t("common.manualDrink.increase")}
                disabled={savingAmounts || amount >= MAX_QUICK_AMOUNT}
                onClick={() => adjust(index, STEP_QUICK_AMOUNT)}
              >
                <Plus />
              </Button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savingAmounts}
              onClick={() => setDraft([...DEFAULT_QUICK_AMOUNTS])}
            >
              {t("common.manualDrink.resetQuickAmounts")}
            </Button>
            <Button type="button" size="sm" disabled={savingAmounts} onClick={() => void saveAmounts()}>
              {t("common.manualDrink.done")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {amounts.map((amount, index) => (
            <Button
              key={index}
              size="sm"
              variant="outline"
              disabled={saving || error}
              onClick={() => submit(amount)}
            >
              +{amount}ml
            </Button>
          ))}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={t("common.manualDrink.editQuickAmounts")}
            title={t("common.manualDrink.editQuickAmounts")}
            onClick={() => {
              setDraft(amounts);
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          {error && <Button size="sm" disabled={saving} onClick={() => submit(pending.current?.amount ?? 100)}>{t("common.manualDrink.retry")}</Button>}
        </div>
      )}
      <p className={`mt-2 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`} role={error ? "alert" : "status"}>
        {saving ? t("common.manualDrink.saving") : error ? t("common.manualDrink.uncertain") : ""}
      </p>
    </section>
  );
}
