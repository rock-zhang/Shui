"use client";

import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { normalizeDrinkDay, type DrinkHistoryValue } from "@/lib/drink-day";

export function DrinkDetails({ entries, goal, onChanged }: {
  entries: Array<[string, DrinkHistoryValue]>;
  goal: number;
  onChanged: () => void;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const days = entries.map(([date, value]) => ({ date, ...normalizeDrinkDay(value, goal) }))
    .filter(day => day.total > 0 || day.entries.length > 0).reverse();

  async function undo(date: string, requestId: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(requestId);
    setMessage("");
    try {
      await invoke("undo_drink", { date, requestId });
      setConfirmation(null);
      setMessage("已撤销，统计数据已重新加载。");
      onChanged();
    } catch (error) {
      console.error("撤销失败", error);
      setMessage("撤销未能确认，请重试；重复撤销不会重复扣减。");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return <section className="mb-4 rounded-lg border p-4">
    <h2 className="mb-2 text-sm font-medium">饮水明细</h2>
    <p className="mb-3 text-xs text-muted-foreground">展示所选日期范围；撤销仅修正饮水记录，不改变提醒次数。旧记录没有唯一标识时仅可查看。</p>
    {message && <p role="status" className="mb-2 text-sm">{message}</p>}
    {days.length === 0 && <p className="text-sm text-muted-foreground">暂无饮水记录</p>}
    <div className="max-h-80 space-y-3 overflow-y-auto">
      {days.map(day => {
        const untracked = Math.max(0, day.total - day.entries.reduce((sum, entry) => sum + entry.amount, 0));
        return <details key={day.date}>
          <summary className="cursor-pointer text-sm">{day.date.slice(0, 4)}-{day.date.slice(4, 6)}-{day.date.slice(6)} · {day.total} ml</summary>
          {untracked > 0 && <p className="my-2 text-xs text-muted-foreground">无逐笔明细的历史水量：{untracked} ml（不可逐笔撤销）</p>}
          {[...day.entries].reverse().map((entry, index) => <div key={entry.requestId ?? index} className="flex items-center justify-between gap-2 border-b py-2 text-sm">
            <span>{Number.isFinite(Date.parse(entry.timestamp)) ? new Date(entry.timestamp).toLocaleString() : "时间未知"} · {entry.amount} ml</span>
            {entry.requestId ? <div className="flex items-center gap-2">
              {confirmation === entry.requestId ? <>
                <span className="text-xs">确认撤销？</span>
                <Button size="sm" variant="destructive" disabled={pending !== null} onClick={() => undo(day.date, entry.requestId!)}>{pending === entry.requestId ? "撤销中" : "确认"}</Button>
                <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => setConfirmation(null)}>取消</Button>
              </> : <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => { setConfirmation(entry.requestId!); setMessage(""); }}>撤销</Button>}
            </div> : <span className="text-xs text-muted-foreground">旧记录 · 仅查看</span>}
          </div>)}
        </details>;
      })}
    </div>
  </section>;
}
