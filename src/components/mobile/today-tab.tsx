"use client";

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  Clock3,
  CupSoda,
  Droplet,
  Droplets,
  GlassWater,
  Plus,
  RefreshCw,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDrinkData } from "@/hooks/use-drink-data";
import { getLocalDateKey } from "@/lib/drink-history";
import type { DrinkReceipt } from "@/lib/drink-day";
import { emitRefresh, formatTimeLabel } from "@/lib/mobile";
import {
  describeNextReminder,
  findNextReminder,
} from "@/lib/reminder-schedule";
import { useMobileConfig } from "./config-context";
import { MobileEmpty, MobileSection, ProgressRing } from "./ui";

const QUICK_AMOUNTS: Array<{
  amount: number;
  hint: string;
  Icon: LucideIcon;
}> = [
  { amount: 50, hint: "小口", Icon: Droplet },
  { amount: 100, hint: "几口", Icon: Droplets },
  { amount: 200, hint: "一杯", Icon: GlassWater },
  { amount: 300, hint: "大杯", Icon: CupSoda },
];

type SaveStatus = {
  phase: "idle" | "saving" | "done" | "error";
  text: string;
};

const IDLE_STATUS: SaveStatus = { phase: "idle", text: "" };

/** 同一金额在该窗口内的重复点击复用同一 requestId，交给 Rust 幂等去重。 */
const QUICK_DEDUPE_MS = 1200;
/** 按钮「水位上涨 + ✓」就地反馈的持续时间。 */
const CELEBRATE_MS = 1400;

type Celebration = { amount: number; token: number };

export function TodayTab() {
  const { today, goal, loading, error, reload } = useDrinkData(7);
  const { alert, general, hydrated } = useMobileConfig();
  const [status, setStatus] = useState<SaveStatus>(IDLE_STATUS);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const busy = useRef(false);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrationToken = useRef(0);

  useEffect(
    () => () => {
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    },
    []
  );

  /** 让被点的那张卡片就地播放水位上涨 + ✓，连续记录时靠 token 重播动画。 */
  function celebrate(amount: number) {
    celebrationToken.current += 1;
    setCelebration({ amount, token: celebrationToken.current });
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    celebrationTimer.current = setTimeout(() => {
      setCelebration(null);
      celebrationTimer.current = null;
    }, CELEBRATE_MS);
  }
  const pending = useRef<{ amount: number; requestId: string } | null>(null);
  const lastQuick = useRef<{ amount: number; requestId: string; expiresAt: number } | null>(
    null
  );

  const nextReminderText = hydrated
    ? describeNextReminder(
        findNextReminder({
          gap: alert.gap,
          weekdays: alert.weekdays,
          timeStart: alert.timeStart,
          timeEnd: alert.timeEnd,
          quietEnabled: general.quietEnabled,
          quietStart: general.quietStart,
          quietEnd: general.quietEnd,
          isPaused: general.isPaused,
          goal: goal || today.goal,
          todayTotal: today.total,
        })
      )
    : "";

  async function submit(amount: number) {
    // `busy` is a ref: repeated taps are dropped without disabling (and hence
    // dimming) all four cards, which was the visible "flash" on every record.
    if (busy.current) return;
    busy.current = true;
    setStatus({ phase: "saving", text: "正在保存…" });
    try {
      // 失败重试沿用 pending 的 id；正常连点则在同一金额的冷却窗内复用 id，
      // 让 Rust 侧 requestId 幂等去重，避免本地 store 写入太快而记成两笔。
      let draft = pending.current;
      if (!draft) {
        const now = Date.now();
        const last = lastQuick.current;
        if (last && last.amount === amount && now < last.expiresAt) {
          draft = { amount, requestId: last.requestId };
        } else {
          draft = { amount, requestId: crypto.randomUUID() };
          lastQuick.current = {
            amount,
            requestId: draft.requestId,
            expiresAt: now + QUICK_DEDUPE_MS,
          };
        }
      }
      pending.current = draft;
      const receipt = await invoke<DrinkReceipt>("record_drink", {
        amount: draft.amount,
        requestId: draft.requestId,
      });
      pending.current = null;
      setStatus({
        phase: "done",
        text: `${receipt.added ? "已记录" : "这笔已记过"} · 今日累计 ${receipt.total} ml`,
      });
      // 仅真正新增时播放就地庆祝；幂等命中的重复点击不重复播放动画。
      if (receipt.added) celebrate(draft.amount);
      if (receipt.goalReached) toast.success("🎉 今日目标已完成");
      // Broadcast, not local reload: the Data tab stays mounted now and must
      // refresh its statistics too.
      emitRefresh();
    } catch (failure) {
      console.error("记录饮水失败", failure);
      setStatus({
        phase: "error",
        text: "未能确认保存，请再点一次原按钮重试（不会重复累加）",
      });
    } finally {
      busy.current = false;
    }
  }

  async function undo(requestId: string) {
    if (busy.current) return;
    busy.current = true;
    setStatus({ phase: "saving", text: "正在撤销…" });
    try {
      await invoke("undo_drink", {
        date: getLocalDateKey(new Date()),
        requestId,
      });
      setConfirmUndo(null);
      setCelebration(null);
      setStatus({ phase: "done", text: "已撤销这笔记录" });
      emitRefresh();
    } catch (failure) {
      console.error("撤销失败", failure);
      setStatus({
        phase: "error",
        text: "撤销未确认，请重试（重复撤销不会重复扣减）",
      });
    } finally {
      busy.current = false;
    }
  }

  const saving = status.phase === "saving";

  return (
    <>
      <MobileSection className="pt-5">
        <ProgressRing total={today.total} goal={goal || today.goal} />
        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
          建议每天 1500~1700ml，少量多次，每次不超过 200ml
        </p>
      </MobileSection>

      <MobileSection title="记录刚喝的水" description="点一下就记，重复点击同一笔不会累加">
        <div className="grid grid-cols-2 gap-2.5">
          {QUICK_AMOUNTS.map(({ amount, hint, Icon }) => {
            const celebrating = celebration?.amount === amount ? celebration : null;
            return (
              <button
                key={amount}
                type="button"
                aria-disabled={saving}
                aria-busy={saving}
                onClick={() => submit(amount)}
                aria-label={`记录 ${amount} 毫升饮水`}
                className={cn(
                  "group relative flex min-h-[108px] flex-col justify-between overflow-hidden rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.97]",
                  celebrating
                    ? "border-sky-400/60"
                    : "border-border/70 hover:border-primary/40"
                )}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-5 -top-6 h-20 w-20 rounded-full bg-primary/5 transition-colors group-hover:bg-primary/10"
                />
                {celebrating && (
                  <span
                    key={`wave-${celebrating.token}`}
                    aria-hidden="true"
                    className="drink-wave pointer-events-none absolute inset-0 bg-gradient-to-t from-sky-500/30 via-sky-400/15 to-transparent"
                  />
                )}
                {celebrating ? (
                  <span
                    key={`done-${celebrating.token}`}
                    className="drink-done absolute inset-0 flex flex-col items-center justify-center"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <Check className="h-5 w-5" strokeWidth={2.6} />
                    </span>
                    <span className="mt-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      已记录 +{amount} ml
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="relative flex items-start justify-between">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                      <Plus className="h-3.5 w-3.5 text-muted-foreground/50 transition-colors group-hover:text-primary" />
                    </span>
                    <span className="relative block">
                      <span className="block text-[22px] font-semibold leading-none tabular-nums tracking-tight">
                        +{amount}
                        <span className="ml-1 text-[11px] font-medium tracking-normal text-muted-foreground">
                          ml
                        </span>
                      </span>
                      <span className="mt-1.5 block text-[11px] text-muted-foreground">
                        {hint}
                      </span>
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        {/* Always present so the section height never jumps when a message
            appears/disappears during a save. */}
        <p
          role={status.phase === "error" ? "alert" : "status"}
          aria-live="polite"
          className={cn(
            "mt-3 flex min-h-5 items-center gap-1.5 text-xs leading-5",
            status.phase === "error"
              ? "text-destructive"
              : status.phase === "done"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
          )}
        >
          {status.phase === "done" && (
            <Check className="h-3.5 w-3.5 shrink-0" />
          )}
          {status.text}
        </p>
      </MobileSection>

      <MobileSection title="提醒节奏">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Clock3 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            {hydrated ? (
              <>
                <p className="text-sm font-medium">
                  每 {alert.gap} 分钟 · {alert.timeStart}–{alert.timeEnd}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {nextReminderText}
                </p>
              </>
            ) : (
              <>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-28" />
              </>
            )}
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
