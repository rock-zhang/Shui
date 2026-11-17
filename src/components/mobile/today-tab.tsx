"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { usePlatform } from "@/hooks/use-platform";
import { getLocalDateKey } from "@/lib/drink-history";
import type { DrinkReceipt } from "@/lib/drink-day";
import {
  emitRefresh,
  formatTimeLabel,
  notifyGoalReached,
  onRefresh,
} from "@/lib/mobile";
import {
  describeNextAt,
  findNextReminder,
} from "@/lib/reminder-schedule";
import { useMobileConfig } from "./config-context";
import { NotificationNudge } from "./notification-nudge";
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

/** 同一金额在该窗口内的重复点击复用同一 requestId，交给 Rust 幂等去重。 */
const QUICK_DEDUPE_MS = 1200;
/** 按钮「水位上涨 + ✓」就地反馈的持续时间。 */
const CELEBRATE_MS = 1400;

type Celebration = { amount: number; token: number };

/**
 * 提醒节奏卡片的第二行。
 *
 * 绝对时间只来自原生已排定的闹钟，不再按「当前时间 + gap」现算——因此
 * 切换外观、切 tab 这类重渲染不会让文案跳动。水量真正变化（记水/撤销）
 * 时由 Rust 把账本锚点重置到「现在」并立即重排，这里收到 refresh 后重读，
 * 时间就会跟着更新。15s 节拍只更新「还有 N 分钟」和跨天文案。
 */
function NextReminderLine({
  goalReached,
  goal,
  todayTotal,
}: {
  goalReached: boolean;
  goal: number;
  todayTotal: number;
}) {
  const { alert, general, hydrated, scheduleRevision } = useMobileConfig();
  const { isTauri } = usePlatform();
  const [nextAt, setNextAt] = useState<number | null | undefined>(undefined);
  // idle = 首次读取中；unavailable = 没有原生命令（桌面预览），退回纯函数推算。
  const [nativeState, setNativeState] = useState<
    "idle" | "ready" | "unavailable"
  >("idle");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    if (!isTauri) {
      setNativeState("unavailable");
      return;
    }
    invoke<{ nextAt: number }>("get_next_reminder")
      .then((state) => {
        setNextAt(state.nextAt > 0 ? state.nextAt : null);
        // 同步刷新时间基准：重排后 nextAt 变了，若 now 还停在上一拍，
        // 「还有 N 分钟」会按旧基准算出偏大的值（1 分钟档尤其明显）。
        setNow(Date.now());
        setNativeState("ready");
      })
      .catch(() => {
        setNextAt(null);
        setNativeState("unavailable");
      });
  }, [isTauri]);

  // 配置变更后要等原生重排完成（scheduleRevision 递增）再读，避免读到旧值。
  // 音效、系统通知、全屏、外观等不改变节奏的开关不会递增它。
  useEffect(() => {
    load();
  }, [load, scheduleRevision]);

  // 记录/撤销、通知记水、全屏提醒结束都会广播 refresh。
  useEffect(() => onRefresh(load), [load]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  if (!hydrated) {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">正在读取提醒设置…</p>
    );
  }
  if (general.isPaused) {
    return <p className="mt-0.5 text-xs text-muted-foreground">提醒已暂停</p>;
  }
  if (goalReached) {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        今日目标已达成，暂停提醒
      </p>
    );
  }

  let text: string;
  if (isTauri && nativeState === "ready") {
    text =
      nextAt === null || nextAt === undefined
        ? "当前设置下没有下一次提醒"
        : describeNextAt(nextAt, now);
  } else if (isTauri && nativeState === "idle") {
    text = "正在读取提醒时间…";
  } else {
    // 桌面浏览器预览 / 原生命令不可用：退回同一套纯函数推算。
    const result = findNextReminder(
      {
        gap: alert.gap,
        weekdays: alert.weekdays,
        timeStart: alert.timeStart,
        timeEnd: alert.timeEnd,
        quietEnabled: general.quietEnabled,
        quietStart: general.quietStart,
        quietEnd: general.quietEnd,
        isPaused: general.isPaused,
        goal,
        todayTotal,
      },
      new Date(now)
    );
    text =
      result.kind === "time"
        ? describeNextAt(result.date.getTime(), now)
        : "当前设置下没有下一次提醒";
  }

  return <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>;
}

export function TodayTab() {
  const { today, goal, loading, error, reload } = useDrinkData(7);
  const { alert, general, hydrated } = useMobileConfig();
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

  const goalValue = goal || today.goal;
  const goalReached = goalValue > 0 && today.total >= goalValue;

  async function submit(amount: number) {
    // `busy` is a ref: repeated taps are dropped without disabling (and hence
    // dimming) all four cards, which was the visible "flash" on every record.
    if (busy.current) return;
    busy.current = true;
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
      // 成功不弹提示：卡片动画、进度环和「今日明细」已经反馈了结果。
      // 失败才需要 toast（见 catch），避免整页唯一的反馈渠道被噪声占用。
      // 仅真正新增时播放就地庆祝；幂等命中的重复点击不重复播放动画。
      if (receipt.added) celebrate(draft.amount);
      if (receipt.goalReached) {
        toast.success("🎉 今日目标已完成");
        // 只在真正达标的那一笔发系统通知；幂等重复点击 receipt.added 为 false，
        // 原生侧另有「今天已播报」去重，两处都拦一遍才不会被连点骗出两条。
        if (receipt.added) void notifyGoalReached(receipt.total, receipt.goal);
      }
      // Broadcast, not local reload: the Data tab stays mounted now and must
      // refresh its statistics too.
      emitRefresh();
    } catch (failure) {
      console.error("记录饮水失败", failure);
      toast.error("保存未确认，请再点一次原按钮（不会重复累加）");
    } finally {
      busy.current = false;
    }
  }

  async function undo(requestId: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      await invoke("undo_drink", {
        date: getLocalDateKey(new Date()),
        requestId,
      });
      setConfirmUndo(null);
      setCelebration(null);
      toast.success("已撤销这笔记录");
      emitRefresh();
    } catch (failure) {
      console.error("撤销失败", failure);
      toast.error("撤销未确认，请再试一次（重复撤销不会重复扣减）");
    } finally {
      busy.current = false;
    }
  }

  return (
    <>
      <NotificationNudge />

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
                <NextReminderLine
                  goalReached={goalReached}
                  goal={goalValue}
                  todayTotal={today.total}
                />
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
