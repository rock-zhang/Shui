"use client";

import { useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import { Button } from "@/components/ui/button";
import { ManualDrink } from "@/components/manual-drink";
import { DrinkDetails } from "@/components/drink-details";
import { getLocalDateKey, getRecentDates, type DrinkHistoryValue } from "@/lib/drink-day";
import { STORE_NAME } from "@/lib/constants";
import { onRefresh } from "@/lib/mobile";

export default function DrinkHistoryPage() {
  const [period, setPeriod] = useState<7 | 30>(7);
  const [revision, setRevision] = useState(0);
  const [entries, setEntries] = useState<Array<[string, DrinkHistoryValue]>>([]);
  const [goal, setGoal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      const [config, history] = await Promise.all([
        load(STORE_NAME.config, { autoSave: false }),
        load(STORE_NAME.drink_history, { autoSave: false }),
      ]);
      const alert = await config.get<{ gold?: number | string }>("alert");
      const days = await Promise.all(getRecentDates(period).map(async date => {
        const key = getLocalDateKey(date);
        return [key, await history.get<DrinkHistoryValue>(key)] as [string, DrinkHistoryValue];
      }));
      if (!cancelled) {
        setGoal(Number(alert?.gold) || 0);
        setEntries(days);
      }
    })().catch(error => {
      console.error("读取饮水记录失败", error);
      if (!cancelled) setError("暂时无法读取记录，请刷新重试。");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, revision]);

  const refresh = () => setRevision(value => value + 1);
  // 系统通知里点「+Xml」由 Rust 直接落盘，再广播 shui:drink-recorded，
  // 前端桥接层转成 emitRefresh。桌面端此前没有监听者，通知记账后本页仍显示
  // 旧数据，要手动点刷新或切路由才更新。
  useEffect(() => onRefresh(refresh), []);
  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-lg font-medium">饮水记录</h3>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={loading} onClick={refresh}>刷新</Button>
        {([7, 30] as const).map(value => <Button key={value} size="sm" variant={period === value ? "secondary" : "ghost"} onClick={() => setPeriod(value)}>{value} 天</Button>)}
      </div>
    </div>
    <ManualDrink onRecorded={refresh} />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : loading ? <p className="text-sm text-muted-foreground">正在读取饮水记录…</p>
        : <DrinkDetails entries={entries} goal={goal} onChanged={refresh} />}
  </div>;
}
