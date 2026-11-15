"use client";

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clock3, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDrinkData } from "@/hooks/use-drink-data";
import { getLocalDateKey } from "@/lib/drink-history";
import type { DrinkReceipt } from "@/lib/drink-day";
import {
  DEFAULT_ALERT,
  DEFAULT_GENERAL,
  formatTimeLabel,
  readConfig,
  type AlertConfig,
  type GeneralConfig,
} from "@/lib/mobile";
import { MobileEmpty, MobileSection, ProgressRing } from "./ui";

const AMOUNTS = [50, 100, 200, 300];

function nextCupLabel(gap: number) {
  const next = new Date(Date.now() + Math.max(gap, 1) * 60_000);
  return next.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TodayTab() {
  const { today, goal, loading, error, reload } = useDrinkData(7);
  const [alert, setAlert] = useState<AlertConfig>(DEFAULT_ALERT);
  const [general, setGeneral] = useState<GeneralConfig>(DEFAULT_GENERAL);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failureText, setFailureText] = useState("");
  const [pending, setPending] = useState<{
    amount: number;
    requestId: string;
  } | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      readConfig<AlertConfig>("alert", DEFAULT_ALERT),
      readConfig<GeneralConfig>("general", DEFAULT_GENERAL),
    ]).then(([alertConfig, generalConfig]) => {
      if (!cancelled) {
        setAlert(alertConfig);
        setGeneral(generalConfig);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(amount: number) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setFailureText("");
    setMessage("");
    try {
      // A failed/uncertain response keeps its id, so a retry cannot double count.
      const draft = pending ?? { amount, requestId: crypto.randomUUID() };
      setPending(draft);
      const receipt = await invoke<DrinkReceipt>("record_drink", {
        amount: draft.amount,
        requestId: draft.requestId,
      });
      setPending(null);
      setMessage(
        `${receipt.added ? "已记录" : "这笔已记过"} · 今日累计 ${receipt.total} ml`
      );
      if (receipt.goalReached) toast.success("🎉 今日目标已完成");
      reload();
    } catch (failure) {
      console.error("记录饮水失败", failure);
      setFailureText("未能确认保存，请再点一次原按钮重试（不会重复累加）");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function undo(requestId: string) {
    if (busy.current) return;
    busy.current = true;
    setFailureText("");
    try {
      await invoke("undo_drink", {
        date: getLocalDateKey(new Date()),
        requestId,
      });
      setConfirmUndo(null);
      setMessage("已撤销这笔记录");
      reload();
    } catch (failure) {
      console.error("撤销失败", failure);
      setFailureText("撤销未确认，请重试（重复撤销不会重复扣减）");
    } finally {
      busy.current = false;
    }
  }

  return (
    <>
      <MobileSection className="pt-5">
        <ProgressRing total={today.total} goal={goal || today.goal} />
        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
          建议每天 1500~1700ml，少量多次，每次不超过 200ml
        </p>
      </MobileSection>

      <MobileSection title="记录刚喝的水" description="点一下就记，重复点击同一笔不会累加">
        <div className="grid grid-cols-2 gap-3">
          {AMOUNTS.map((amount) => (
            <button
              key={amount}
              type="button"
              disabled={saving}
              onClick={() => submit(amount)}
              className="flex min-h-16 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95 disabled:opacity-60"
            >
              <span className="text-xl font-semibold tabular-nums leading-none">
                +{amount}
              </span>
              <span className="mt-1 text-[11px] opacity-80">ml</span>
            </button>
          ))}
        </div>
        {(message || failureText) && (
          <p
            role={failureText ? "alert" : "status"}
            className={`mt-3 text-xs leading-5 ${failureText ? "text-destructive" : "text-muted-foreground"}`}
          >
            {saving ? "正在保存…" : failureText || message}
          </p>
        )}
      </MobileSection>

      {/* Mobile equivalent of the desktop tray countdown: always visible here. */}
      <MobileSection title="提醒节奏">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Clock3 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              每 {alert.gap} 分钟 · {alert.timeStart}–{alert.timeEnd}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {general.isPaused
                ? "提醒已暂停"
                : `预计下一杯约 ${nextCupLabel(Number(alert.gap) || 30)}`}
            </p>
          </div>
        </div>
      </MobileSection>

      <MobileSection
        title="今日明细"
        description="点撤销可修正误记，二次确认后生效"
      >
        <div className="mb-2 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={reload}
            className="min-h-10"
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : today.entries.length === 0 ? (
          <MobileEmpty
            title="今天还没有记录"
            description="喝第一杯水后，这里会显示时间和水量"
          />
        ) : (
          <ul className="space-y-2">
            {[...today.entries].reverse().map((entry, index) => (
              <li
                key={entry.requestId ?? index}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-muted/50 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 text-sm tabular-nums">
                  {formatTimeLabel(entry.timestamp)}
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {entry.amount} ml
                </span>
                {entry.requestId &&
                  (confirmUndo === entry.requestId ? (
                    <span className="flex w-full items-center justify-end gap-1 pt-1">
                      <span className="mr-auto text-xs text-muted-foreground">
                        确认撤销？
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="min-h-9"
                        onClick={() => undo(entry.requestId!)}
                      >
                        确认
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-9"
                        onClick={() => setConfirmUndo(null)}
                      >
                        取消
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="撤销这笔记录"
                      className="h-9 w-9 p-0"
                      onClick={() => setConfirmUndo(entry.requestId!)}
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </MobileSection>
    </>
  );
}
