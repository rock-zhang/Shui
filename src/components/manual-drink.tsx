"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { recordDrink } from "@/utils/record-drink";
import { trackDrinkRecorded } from "@/lib/analytics";
import { useI18n, type MessageKey } from "@/lib/i18n";

type Notice = { key: MessageKey; params?: Record<string, string | number> } | null;

export function ManualDrink({ onRecorded }: { onRecorded: () => void }) {
  const { t } = useI18n();
  const busy = useRef(false);
  const pending = useRef<{ amount: number; id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

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
      setNotice({
        key: receipt.goalReached
          ? receipt.added
            ? "common.manualDrink.recordedTotalGoal"
            : "common.manualDrink.alreadyTotalGoal"
          : receipt.added
            ? "common.manualDrink.recordedTotal"
            : "common.manualDrink.alreadyTotal",
        params: { total: receipt.total },
      });
      onRecorded();
    } catch (failure) {
      console.error("手动记录失败:", failure);
      setError(true);
      setNotice({ key: "common.manualDrink.uncertain" });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="mb-4 rounded-lg border p-4" aria-label={t("common.manualDrink.label")}>
      <h4 className="text-sm font-medium">{t("common.manualDrink.title")}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{t("common.manualDrink.description")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {[50, 100, 200, 300].map(amount => (
          <Button key={amount} size="sm" variant="outline" disabled={saving || error} onClick={() => submit(amount)}>
            +{amount}ml
          </Button>
        ))}
        {error && <Button size="sm" disabled={saving} onClick={() => submit(pending.current?.amount ?? 100)}>{t("common.manualDrink.retry")}</Button>}
      </div>
      <p className={`mt-2 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`} role={error ? "alert" : "status"}>
        {saving ? t("common.manualDrink.saving") : notice ? t(notice.key, notice.params) : ""}
      </p>
    </section>
  );
}
