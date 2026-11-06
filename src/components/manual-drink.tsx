"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { recordDrink } from "@/utils/record-drink";

export function ManualDrink({ onRecorded }: { onRecorded: () => void }) {
  const busy = useRef(false);
  const pending = useRef<{ amount: number; id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(amount: number) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(false);
    try {
      // A failed/uncertain response keeps its ID for an explicit retry.
      if (!pending.current) pending.current = { amount, id: crypto.randomUUID() };
      const receipt = await recordDrink(pending.current.amount, pending.current.id);
      pending.current = null;
      setMessage(`${receipt.added ? "已记录" : "该笔饮水已记录"}，累计 ${receipt.total}ml${receipt.goalReached ? "，今日目标已完成！" : ""}`);
      onRecorded();
    } catch (failure) {
      console.error("手动记录失败:", failure);
      setError(true);
      setMessage("未能确认保存结果，请点击重试；同一笔记录不会重复累加。");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="mb-4 rounded-lg border p-4" aria-label="手动记录饮水">
      <h4 className="text-sm font-medium">记录刚喝的水</h4>
      <p className="mt-1 text-xs text-muted-foreground">按当前本地日期记录，即使使用系统通知也可随时添加。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {[50, 100, 200, 300].map(amount => (
          <Button key={amount} size="sm" variant="outline" disabled={saving || error} onClick={() => submit(amount)}>
            +{amount}ml
          </Button>
        ))}
        {error && <Button size="sm" disabled={saving} onClick={() => submit(pending.current?.amount ?? 100)}>重试</Button>}
      </div>
      <p className={`mt-2 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`} role={error ? "alert" : "status"}>
        {saving ? "正在保存…" : message}
      </p>
    </section>
  );
}
