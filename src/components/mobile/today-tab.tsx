"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDrinkData } from "@/hooks/use-drink-data";
import { usePlatform } from "@/hooks/use-platform";
import { track, trackDrinkRecorded } from "@/lib/analytics";
import { getLocalDateKey } from "@/lib/drink-history";
import type { DrinkEntry, DrinkReceipt } from "@/lib/drink-day";
import {
  emitNextReminder,
  emitRefresh,
  formatTimeLabel,
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

const QUICK_AMOUNTS: Array<{
  amount: number;
  hintKey: MessageKey;
  Icon: LucideIcon;
}> = [
  { amount: 50, hintKey: "mobile.today.hint.50", Icon: Droplet },
  { amount: 100, hintKey: "mobile.today.hint.100", Icon: Droplets },
  { amount: 200, hintKey: "mobile.today.hint.200", Icon: GlassWater },
  { amount: 300, hintKey: "mobile.today.hint.300", Icon: CupSoda },
];

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
  const { today, goal, loading, error, reload } = useDrinkData(7);
  const { alert, hydrated } = useMobileConfig();
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
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

      <MobileSection className="pt-5">
        <ProgressRing total={today.total} goal={goal || today.goal} />
        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
          {t("mobile.today.tip")}
        </p>
      </MobileSection>

      <MobileSection
        title={t("mobile.today.record.title")}
        description={t("mobile.today.record.description")}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {QUICK_AMOUNTS.map(({ amount, hintKey, Icon }) => {
            const celebrating = celebration?.amount === amount ? celebration : null;
            return (
              <button
                key={amount}
                type="button"
                onClick={() => submit(amount)}
                aria-label={t("mobile.today.record.aria", { amount })}
                className={cn(
                  "group relative flex min-h-[108px] flex-col justify-between overflow-hidden rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.97]",
                  celebrating
                    ? "border-sky-400/60"
                    : "border-border/70 hover:border-primary/40"
                )}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-5 -top-6 h-20 w-20 rounded-full bg-primary/10 transition-colors group-hover:bg-primary/15"
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
      </MobileSection>

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
        <div className="mb-2 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={reload}
            className="min-h-10"
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            {t("common.refresh")}
          </Button>
        </div>
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
    </>
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
