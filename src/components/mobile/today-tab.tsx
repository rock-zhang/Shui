"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
  Clock3,
  CupSoda,
  Droplet,
  Droplets,
  Flame,
  GlassWater,
  Plus,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDrinkData } from "@/hooks/use-drink-data";
import { usePlatform } from "@/hooks/use-platform";
import { useBackToClose } from "@/hooks/use-back-to-close";
import { track, trackDrinkRecorded } from "@/lib/analytics";
import { getLocalDateKey } from "@/lib/drink-history";
import { ackStreak } from "@/lib/streak";
import type { DrinkEntry, DrinkReceipt } from "@/lib/drink-day";
import {
  emitNextReminder,
  emitRefresh,
  formatTimeLabel,
  MAX_QUICK_AMOUNT,
  MIN_QUICK_AMOUNT,
  STEP_QUICK_AMOUNT,
  notifyGoalReached,
  onNextReminder,
  onRefresh,
} from "@/lib/mobile";
import {
  describeNextAt,
  findNextReminder,
  type NextReminderText,
} from "@/lib/reminder-schedule";
import { useMobileConfig } from "./config-context";
import { NotificationNudge } from "./notification-nudge";
import { MobileEmpty, MobileSection, ProgressRing } from "./ui";
import { useI18n, WEEKDAY_LONG_KEYS, type MessageKey } from "@/lib/i18n";

type Translate = ReturnType<typeof useI18n>["t"];

/** 长按卡片进入自定义杯量的按压时长；手指位移超过该像素视为滑动而非长按。 */
const CUP_HOLD_MS = 1000;
const CUP_MOVE_TOLERANCE_PX = 8;
/** 刻度尺上每一档（10ml）占的宽度，指针固定在正中。 */
const CUP_TICK_GAP = 14;
/** 刻度尺覆盖的完整档位序列，索引 i 对应的杯量是 MIN + i × STEP。 */
const CUP_SCALE_VALUES = Array.from(
  { length: (MAX_QUICK_AMOUNT - MIN_QUICK_AMOUNT) / STEP_QUICK_AMOUNT + 1 },
  (_, i) => MIN_QUICK_AMOUNT + i * STEP_QUICK_AMOUNT
);

/** 杯量换算成刻度索引，用于把指针定位到对应档位。 */
function amountToTick(amount: number): number {
  return (clampAmount(amount) - MIN_QUICK_AMOUNT) / STEP_QUICK_AMOUNT;
}
/** 杯量自定义引导的本地记忆：气泡是否已关、是否已自定义过、记录后 toast 是否已提示。 */
const CUP_HINT_BUBBLE_KEY = "shui.cupHint.bubbleDismissed";
const CUP_HINT_CUSTOMIZED_KEY = "shui.cupHint.customized";
const CUP_HINT_TOAST_KEY = "shui.cupHint.toastShown";

/** 杯名按档位自动映射，与 AMOUNT_ICONS 的图标分档保持一致。 */
function cupHintKey(amount: number): MessageKey {
  if (amount <= 50) return "mobile.today.hint.50";
  if (amount <= 100) return "mobile.today.hint.100";
  if (amount <= 200) return "mobile.today.hint.200";
  return "mobile.today.hint.300";
}

function clampAmount(amount: number): number {
  return Math.min(MAX_QUICK_AMOUNT, Math.max(MIN_QUICK_AMOUNT, amount));
}

/** 同一金额在该窗口内的重复点击复用同一 requestId，交给 Rust 幂等去重。 */
const QUICK_DEDUPE_MS = 1200;
/** 按钮「水位上涨 + ✓」就地反馈的持续时间。 */
const CELEBRATE_MS = 1400;
/** 主页面内联展示的明细条数，更早的记录收进底部抽屉。 */
const DETAIL_INLINE_COUNT = 3;

type Celebration = { amount: number; token: number };

function nextReminderText(description: NextReminderText, t: Translate): string {
  switch (description.kind) {
    case "paused":
      return t("mobile.today.next.paused");
    case "goalReached":
      return t("mobile.today.next.goalReached");
    case "none":
      return t("mobile.today.next.none");
    case "imminent":
      return t("mobile.today.next.imminent");
    case "today":
      return description.minutes === null
        ? t("mobile.today.next.today", { time: description.time })
        : t("mobile.today.next.todayMinutes", {
            time: description.time,
            minutes: description.minutes,
          });
    case "later":
      return description.weekday === null
        ? t("mobile.today.next.tomorrow", { time: description.time })
        : t("mobile.today.next.weekday", {
            weekday: t(WEEKDAY_LONG_KEYS[description.weekday]),
            time: description.time,
          });
  }
}

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
  const { t } = useI18n();
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

  // 记水的 Receipt 直接带回重锚后的排期：先落地它，再等 refresh 的读取结果，
  // 两者一致时不闪；读取慢一拍时也不会显示成「上次提醒 + gap」的旧值。
  useEffect(
    () =>
      onNextReminder((nextAt) => {
        setNextAt(nextAt);
        setNativeState("ready");
        setNow(Date.now());
      }),
    []
  );

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
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("mobile.today.next.loadingSettings")}
      </p>
    );
  }
  if (general.isPaused) {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("mobile.today.next.paused")}
      </p>
    );
  }
  if (goalReached) {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("mobile.today.next.goalReached")}
      </p>
    );
  }

  let text: string;
  if (isTauri && nativeState === "ready") {
    text =
      nextAt === null || nextAt === undefined
        ? t("mobile.today.next.none")
        : nextReminderText(describeNextAt(nextAt, now), t);
  } else if (isTauri && nativeState === "idle") {
    text = t("mobile.today.next.loadingTime");
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
        ? nextReminderText(describeNextAt(result.date.getTime(), now), t)
        : t("mobile.today.next.none");
  }

  return <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>;
}

export function TodayTab() {
  const { t, locale } = useI18n();
  const { today, goal, error, streak } = useDrinkData(7);
  const lastStreak = useRef<number | null>(null);
  const { alert, hydrated, patchAlert } = useMobileConfig();
  const quickAmounts = alert.quickAmounts;
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // 自定义杯量：editIdx 是被编辑的卡片槽位，draft 是抽屉里的草稿值。
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draftAmount, setDraftAmount] = useState(0);
  // 长按进行中的卡片：展示缩放 + 进度条，超时或位移过大即取消。
  const [holdingIdx, setHoldingIdx] = useState<number | null>(null);
  // 引导：卡片角上的气泡 + 首次记录后的 toast，各提示一次。
  const [cupHint, setCupHint] = useState({ bubble: false, toastPending: false });
  const editOpen = editIdx !== null;
  // Android 返回键先关今日明细弹层，而不是退到桌面。
  useBackToClose(detailsOpen, () => setDetailsOpen(false));
  useBackToClose(editOpen, () => setEditIdx(null));
  const busy = useRef(false);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrationToken = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStart = useRef({ x: 0, y: 0 });
  // 长按触发后抬起手指会再派发一次 click，用它抑制那一次「误记录」。
  const longPressFired = useRef(false);

  useEffect(() => {
    try {
      const customized =
        localStorage.getItem(CUP_HINT_CUSTOMIZED_KEY) === "1";
      const dismissed =
        localStorage.getItem(CUP_HINT_BUBBLE_KEY) === "1";
      const toastShown =
        localStorage.getItem(CUP_HINT_TOAST_KEY) === "1";
      setCupHint({
        bubble: !customized && !dismissed,
        toastPending: !customized && !toastShown,
      });
    } catch {
      // localStorage 不可用（隐私模式等）时静默放弃引导。
    }
  }, []);

  useEffect(
    () => () => {
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    []
  );

  // 连续达标里程碑只庆祝一次：Rust 返回未 ack 的 milestone 时弹提示并写回。
  // 断连（current 归 0）时重置记录，重新连到 7 天可以再次庆祝。
  useEffect(() => {
    if (!streak) return;
    if (streak.current === 0) {
      if (lastStreak.current !== 0) void ackStreak(0);
    } else if (streak.milestone > 0) {
      toast.success(t("streak.milestone", { days: streak.milestone }));
      void ackStreak(streak.milestone);
    }
    lastStreak.current = streak.current;
  }, [streak, t]);

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

  /** 首次成功记录后提示一次「长按可自定义」，之后不再打扰。 */
  function maybeHintAfterRecord() {
    if (!cupHint.toastPending) return;
    setCupHint((state) => ({ ...state, toastPending: false }));
    try {
      localStorage.setItem(CUP_HINT_TOAST_KEY, "1");
    } catch {
      // 忽略：下次启动会再提示一次，可接受。
    }
    toast.message(t("mobile.today.cup.hintBubble"));
  }

  function dismissCupHint() {
    track("cup_hint_dismiss");
    setCupHint((state) => ({ ...state, bubble: false }));
    try {
      localStorage.setItem(CUP_HINT_BUBBLE_KEY, "1");
    } catch {
      // 忽略。
    }
  }

  /** 长按进入编辑：按住 CUP_HOLD_MS 且位移不超限才触发，触发时轻震一下。 */
  function startCupHold(idx: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (editOpen || busy.current) return;
    holdStart.current = { x: event.clientX, y: event.clientY };
    longPressFired.current = false;
    setHoldingIdx(idx);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      longPressFired.current = true;
      setHoldingIdx(null);
      navigator.vibrate?.(10);
      setDraftAmount(quickAmounts[idx]);
      setEditIdx(idx);
      track("drink_dialog_open");
    }, CUP_HOLD_MS);
  }

  /** 取消长按；手指移远、提前抬起、移出卡片都走这里，不影响正常点击。 */
  function cancelCupHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHoldingIdx(null);
  }

  function onCardPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!holdTimer.current) return;
    const { x, y } = holdStart.current;
    if (
      Math.abs(event.clientX - x) > CUP_MOVE_TOLERANCE_PX ||
      Math.abs(event.clientY - y) > CUP_MOVE_TOLERANCE_PX
    ) {
      cancelCupHold();
    }
  }

  function onCardClick(amount: number) {
    // 长按结束后的那次 click 不记录，避免「改个杯量却多记了一笔」。
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    void submit(amount);
  }

  function saveCupAmount(amount: number) {
    if (editIdx === null) return;
    const next = [...quickAmounts];
    next[editIdx] = amount;
    setCupHint((state) => ({ ...state, bubble: false, toastPending: false }));
    try {
      localStorage.setItem(CUP_HINT_CUSTOMIZED_KEY, "1");
    } catch {
      // 忽略。
    }
    // 杯量属非节奏配置：写盘 + 同步原生快照（saveConfig），不重排闹钟。
    patchAlert({ quickAmounts: next });
    toast.success(t("mobile.today.cup.updated", { amount }));
    setEditIdx(null);
  }
  const pending = useRef<{ amount: number; requestId: string } | null>(null);
  const lastQuick = useRef<{ amount: number; requestId: string; expiresAt: number } | null>(
    null
  );

  const goalValue = goal || today.goal;
  const goalReached = goalValue > 0 && today.total >= goalValue;
  // 新→旧的展示顺序；原始 entries 顺序保持不动，避免影响其它消费方。
  const latestEntries = [...today.entries].reverse();

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
      if (receipt.added) {
        celebrate(draft.amount);
        maybeHintAfterRecord();
        // 原生重锚后把新排期随 Receipt 带回，立刻刷新「预计下一杯」，
        // 不等 emitRefresh 触发的那次往返读取。
        if (receipt.nextAt) emitNextReminder(receipt.nextAt);
      }
      trackDrinkRecorded(receipt, draft.amount, "manual_today");
      if (receipt.goalReached) {
        toast.success(t("mobile.today.goalToast"));
        // 只在真正达标的那一笔发系统通知；幂等重复点击 receipt.added 为 false，
        // 原生侧另有「今天已播报」去重，两处都拦一遍才不会被连点骗出两条。
        if (receipt.added) void notifyGoalReached(receipt.total, receipt.goal);
      }
      // Broadcast, not local reload: the Data tab stays mounted now and must
      // refresh its statistics too.
      emitRefresh();
    } catch (failure) {
      console.error("记录饮水失败", failure);
      toast.error(t("mobile.today.saveUnconfirmed"));
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
      track("drink_undo", { result: "success" });
      setConfirmUndo(null);
      setCelebration(null);
      toast.success(t("mobile.today.undoSuccess"));
      emitRefresh();
    } catch (failure) {
      console.error("撤销失败", failure);
      toast.error(t("mobile.today.undoFailed"));
    } finally {
      busy.current = false;
    }
  }

  return (
    <>
      <NotificationNudge />

      <MobileSection className="relative pt-5">
        {streak && streak.current > 0 && (
          <span className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-orange-200/70 bg-card/95 px-3 py-1.5 text-xs font-medium text-orange-600 shadow-md backdrop-blur-sm dark:border-orange-900/60 dark:text-orange-300">
            <Flame className="h-3.5 w-3.5" aria-hidden="true" />
            {t("streak.pill", { days: streak.current })}
          </span>
        )}
        <ProgressRing total={today.total} goal={goal || today.goal} />
        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
          {t("mobile.today.tip")}
        </p>
      </MobileSection>

      <div className="relative mb-3">
        {cupHint.bubble && (
          <div className="absolute -top-3 right-2 z-10 flex items-center gap-1.5 rounded-full border border-border/70 bg-card py-1.5 pl-3 pr-2 shadow-md">
            <span className="text-[11px] leading-none text-muted-foreground">
              {t("mobile.today.cup.hintBubble")}
            </span>
            <button
              type="button"
              onClick={dismissCupHint}
              aria-label={t("mobile.today.cup.hintBubbleDismiss")}
              className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          {quickAmounts.map((amount, idx) => {
            const Icon = amountIcon(amount);
            const hintKey = cupHintKey(amount);
            const celebrating = celebration?.amount === amount ? celebration : null;
            const holding = holdingIdx === idx;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onCardClick(amount)}
                onPointerDown={(event) => startCupHold(idx, event)}
                onPointerMove={onCardPointerMove}
                onPointerUp={cancelCupHold}
                onPointerLeave={cancelCupHold}
                onContextMenu={(event) => event.preventDefault()}
                aria-label={t("mobile.today.record.aria", { amount })}
                className={cn(
                  "group relative flex min-h-[108px] flex-col justify-between overflow-hidden rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.97]",
                  celebrating
                    ? "border-sky-400/60"
                    : holding
                      ? "scale-[0.98] border-primary/60"
                      : "border-border/70 hover:border-primary/40"
                )}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-5 -top-6 h-20 w-20 rounded-full bg-sky-500/10 transition-colors group-hover:bg-sky-500/20"
                />
                {/* 长按进度条：按住期间匀速充满，充满即进入编辑（时长跟随 CUP_HOLD_MS）。 */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary ease-linear",
                    holding ? "scale-x-100" : "scale-x-0"
                  )}
                  style={{
                    transitionDuration: holding ? `${CUP_HOLD_MS}ms` : "0ms",
                  }}
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
                      {t("mobile.today.record.done", { amount })}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="relative flex items-start justify-between">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                      <Plus className="h-4.5 w-4.5 text-muted-foreground/50 transition-colors group-hover:text-primary" />
                    </span>
                    <span className="relative block">
                      <span className="block text-[22px] font-semibold leading-none tabular-nums tracking-tight">
                        +{amount}
                        <span className="ml-1 text-[11px] font-medium tracking-normal text-muted-foreground">
                          ml
                        </span>
                      </span>
                      <span className="mt-1.5 block text-[11px] text-muted-foreground">
                        {t(hintKey)}
                      </span>
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <MobileSection title={t("mobile.today.rhythm.title")}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Clock3 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            {hydrated ? (
              <>
                <p className="text-sm font-medium">
                  {t("mobile.today.rhythm.summary", {
                    gap: alert.gap,
                    start: alert.timeStart,
                    end: alert.timeEnd,
                  })}
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
        title={t("mobile.today.details.title")}
        description={t("mobile.today.details.description")}
      >
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t("mobile.data.error")}
          </p>
        ) : today.entries.length === 0 ? (
          <MobileEmpty
            title={t("mobile.today.details.emptyTitle")}
            description={t("mobile.today.details.emptyDescription")}
          />
        ) : (
          <>
            <TodayDetailList
              entries={latestEntries.slice(0, DETAIL_INLINE_COUNT)}
              confirmUndo={confirmUndo}
              onRequestUndo={setConfirmUndo}
              onCancelUndo={() => setConfirmUndo(null)}
              onUndo={undo}
              t={t}
              locale={locale}
            />
            {latestEntries.length > DETAIL_INLINE_COUNT && (
              <Button
                variant="ghost"
                className="mt-1 w-full min-h-10"
                onClick={() => setDetailsOpen(true)}
              >
                <ChevronDown className="mr-1 h-3.5 w-3.5" />
                {t("mobile.today.details.viewAll", { count: latestEntries.length })}
              </Button>
            )}
          </>
        )}
      </MobileSection>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[80dvh] rounded-t-2xl">
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40" />
          <SheetHeader className="pr-10">
            <SheetTitle>{t("mobile.today.details.title")}</SheetTitle>
            <SheetDescription>{t("mobile.today.details.description")}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            <TodayDetailList
              entries={latestEntries}
              confirmUndo={confirmUndo}
              onRequestUndo={setConfirmUndo}
              onCancelUndo={() => setConfirmUndo(null)}
              onUndo={undo}
              t={t}
              locale={locale}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) setEditIdx(null);
        }}
      >
        <SheetContent side="bottom" className="mx-auto rounded-t-2xl">
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40" />
          <SheetHeader className="pr-10">
            <SheetTitle>{t("mobile.today.cup.editTitle")}</SheetTitle>
            <SheetDescription>{t("mobile.today.cup.range")}</SheetDescription>
          </SheetHeader>
          {editIdx !== null && (
            <CupAmountEditor
              key={editIdx}
              initialAmount={draftAmount}
              onSave={saveCupAmount}
              onCancel={() => setEditIdx(null)}
              t={t}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * 刻度层：拖动时只改 transform，不重建刻度节点。
 * 每 100ml 一根长刻度，其余为短刻度。
 */
const CupScale = memo(function CupScale({
  offset,
  animate,
}: {
  offset: number;
  animate: boolean;
}) {
  return (
    <div
      aria-hidden
      className="absolute inset-y-0 left-0 flex items-end will-change-transform"
      style={{
        transform: `translateX(${offset}px)`,
        transition: animate
          ? "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)"
          : "none",
      }}
    >
      {CUP_SCALE_VALUES.map((value) => (
        <div
          key={value}
          className="flex shrink-0 items-end justify-center"
          style={{ width: CUP_TICK_GAP }}
        >
          <span
            className={cn(
              "w-px rounded-full",
              value % 100 === 0 ? "h-5 bg-muted-foreground/40" : "h-3 bg-border"
            )}
          />
        </div>
      ))}
    </div>
  );
});

/**
 * 自定义杯量的编辑面板：中间固定指针，左右拖动刻度尺改数值，松手吸附到 10ml。
 * 拖动状态完全封装在这里，避免每次 pointermove 都重渲染整个今日页。
 */
function CupAmountEditor({
  initialAmount,
  onSave,
  onCancel,
  t,
}: {
  initialAmount: number;
  onSave: (amount: number) => void;
  onCancel: () => void;
  t: Translate;
}) {
  const [pos, setPos] = useState(() => amountToTick(initialAmount));
  const [width, setWidth] = useState(0);
  // 松手/点档位时开启过渡，让刻度回弹到整数格；拖动过程中必须关闭，否则跟手会滞后。
  const [snapping, setSnapping] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startPos: number } | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxPos = CUP_SCALE_VALUES.length - 1;
  const amount = clampAmount(
    MIN_QUICK_AMOUNT + Math.round(pos) * STEP_QUICK_AMOUNT
  );

  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const sync = () => setWidth(node.clientWidth);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
    },
    []
  );

  function animateTo(next: number | ((current: number) => number)) {
    setSnapping(true);
    setPos(next);
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      setSnapping(false);
      snapTimer.current = null;
    }, 180);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { startX: event.clientX, startPos: pos };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSnapping(false);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state) return;
    // 手指右移露出左边更小的刻度，因此索引反向变化。
    const delta = (event.clientX - state.startX) / CUP_TICK_GAP;
    setPos(Math.min(maxPos, Math.max(0, state.startPos - delta)));
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    animateTo((current) => Math.round(current));
    navigator.vibrate?.(8);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    animateTo((current) =>
      Math.min(maxPos, Math.max(0, Math.round(current) + step))
    );
  }

  const offset = width / 2 - (pos * CUP_TICK_GAP + CUP_TICK_GAP / 2);
  // 指针两侧各 50ml 的刻度标签，跟着当前值走；越界的一侧留空。
  const labels = [-5, 0, 5].map((step) => {
    const value = amount + step * STEP_QUICK_AMOUNT;
    return value < MIN_QUICK_AMOUNT || value > MAX_QUICK_AMOUNT ? null : value;
  });

  return (
    <div className="px-4 pb-6">
      <div className="flex flex-col items-center">
        <p className="text-4xl leading-none font-semibold tracking-tight tabular-nums">
          {amount}
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            ml
          </span>
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t(cupHintKey(amount))}
        </p>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={t("mobile.today.cup.editTitle")}
        aria-valuemin={MIN_QUICK_AMOUNT}
        aria-valuemax={MAX_QUICK_AMOUNT}
        aria-valuenow={amount}
        aria-valuetext={`${amount} ml`}
        className="relative mt-5 h-12 touch-none overflow-hidden select-none focus-visible:outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        {width > 0 && <CupScale offset={offset} animate={snapping} />}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-1/2 h-8 w-0.5 -translate-x-1/2 rounded-full bg-primary"
        />
      </div>

      <div className="mt-1 grid grid-cols-3 px-1 text-[11px] tabular-nums text-muted-foreground">
        <span className="text-left">{labels[0]}</span>
        <span className="text-center font-medium text-foreground">
          {labels[1]}
        </span>
        <span className="text-right">{labels[2]}</span>
      </div>

      <div className="mt-5 flex gap-2">
        <Button variant="ghost" className="min-h-11 flex-1" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button className="min-h-11 flex-1" onClick={() => onSave(amount)}>
          {t("mobile.today.cup.save")}
        </Button>
      </div>
    </div>
  );
}

/** 与今日 tab 快捷卡片对齐的水量图标体系，明细里复用同一套视觉语义。 */
const AMOUNT_ICONS: Array<{ max: number; Icon: LucideIcon }> = [
  { max: 50, Icon: Droplet },
  { max: 100, Icon: Droplets },
  { max: 200, Icon: GlassWater },
  { max: Number.POSITIVE_INFINITY, Icon: CupSoda },
];

function amountIcon(amount: number): LucideIcon {
  return AMOUNT_ICONS.find((item) => amount <= item.max)!.Icon;
}

/** 明细条目列表（新→旧顺序），主页内联与抽屉共用。 */
function TodayDetailList({
  entries,
  confirmUndo,
  onRequestUndo,
  onCancelUndo,
  onUndo,
  t,
  locale,
}: {
  entries: DrinkEntry[];
  confirmUndo: string | null;
  onRequestUndo: (requestId: string) => void;
  onCancelUndo: () => void;
  onUndo: (requestId: string) => void;
  t: Translate;
  locale: ReturnType<typeof useI18n>["locale"];
}) {
  return (
    <ul className="space-y-2">
      {entries.map((entry, index) => {
        const Icon = amountIcon(entry.amount);
        return (
          <li
            key={entry.requestId ?? `${entry.timestamp}-${index}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-4 w-4 text-primary" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm tabular-nums">
              {formatTimeLabel(entry.timestamp, t("common.details.unknownTime"), locale)}
            </span>
            <span className="text-sm font-semibold tabular-nums text-primary">
              {entry.amount} ml
            </span>
            {entry.requestId &&
              (confirmUndo === entry.requestId ? (
                <span className="flex w-full items-center justify-end gap-1 pt-1">
                  <span className="mr-auto text-xs text-muted-foreground">
                    {t("common.details.confirmUndo")}
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="min-h-9"
                    onClick={() => onUndo(entry.requestId!)}
                  >
                    {t("common.details.confirm")}
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-9" onClick={onCancelUndo}>
                    {t("common.cancel")}
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("mobile.today.details.undoAria")}
                  className="h-9 w-9 p-0"
                  onClick={() => onRequestUndo(entry.requestId!)}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
