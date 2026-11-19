"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlarmClockOff, CheckCircle2, Settings, X } from "lucide-react";
import { readDiagnostics } from "@/lib/mobile";
import { minutesBucket, track } from "@/lib/analytics";
import { localizeRomProfile, romProfile, type RomProfile } from "@/lib/rom";
import { useI18n } from "@/lib/i18n";
import { useMobileConfig } from "./config-context";
import { OPEN_GUIDE_EVENT } from "./notification-setup-guide";
import { BackgroundGuideCards } from "./background-guide-cards";

/**
 * 超过这个时长的旧记录不再弹窗——只在体检卡的「最近漏提醒」里留痕。
 * 弹窗比提示条打扰得多，隔了一夜的旧账没必要拦在开机第一屏。
 */
const STALE_MS = 12 * 60 * 60 * 1000;

function clockLabel(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 「上次提醒没送到」弹窗。
 *
 * 为什么用弹窗而不是今日页顶部的提示条：这条信息决定用户接下来会不会继续
 * 收不到提醒，滚动一下就被忽略掉的风险太高。而且它是低频事件（真的漏了才出），
 * 不会像常驻卡片那样变成噪音。
 *
 * 触发条件是 Kotlin 侧的 `missedAlarmAt`：上一轮排定的闹钟到了点没兑现。
 * 国产 ROM 从多任务划掉 App 走 force-stop，会把本包所有 AlarmManager 闹钟
 * 一起清掉，此后一条都收不到；这个弹窗就是那次失败的唯一可见证据。
 */
export function MissedAlarmDialog() {
  const { t, locale } = useI18n();
  const { general, alert, hydrated } = useMobileConfig();
  const [open, setOpen] = useState(false);
  const [missedAt, setMissedAt] = useState(0);
  // 当前弹窗对应的漏报时刻，供 close() 记确认用；不进 state，避免 close 依赖它重建。
  const currentAtRef = useRef(0);
  // 本会话已确认的时刻。只挡同一条，冷启动即失效，不会像旧 localStorage 方案
  // 那样把之后所有真漏都吞掉。
  const ackAtRef = useRef(0);
  const [cleared, setCleared] = useState(false);
  // 认不出系统时用中性档案：文案写通用的两项叫法，
  // 绝不把 ColorOS 的叫法写给小米用户看。
  // state 只存识别结果，文案在渲染时按当前语言取。
  const [romProfileState, setRom] = useState<RomProfile>(() => romProfile());
  const rom = localizeRomProfile(romProfileState, locale);

  const read = useCallback(async () => {
    const diag = await readDiagnostics();
    const at = diag?.missedAlarmAt ?? 0;
    if (at <= 0) return;
    // 旧账不弹，但也不清——体检卡里仍能看到具体时间。
    if (Date.now() - at > STALE_MS) return;
    // 只按「本会话已确认」去重：关窗时记下的时刻不再弹。清账请求在途时若有
    // visibilitychange / focus / shui:foreground 抢先调到这里，也不会把刚关的
    // 弹窗复活；原生若因排期未推进把同一条写回，同样被挡住。
    // 只挡 at <= ack 的同一条，重排后的新漏报照常弹。以前用 localStorage 跨会话
    // 去重，结果原生不写新值时时间戳停在旧账，之后所有真漏都被吞（弹一次再也不弹）。
    if (at <= ackAtRef.current) return;
    setRom(romProfile(diag?.manufacturer, diag?.brand));
    currentAtRef.current = at;
    setMissedAt(at);
    setCleared(diag?.alarmCleared ?? false);
    setOpen(true);
  }, []);

  useEffect(() => {
    void read();
    // 冷启动时 Rust setup 的 sync_schedule（原生写入漏报证据）可能与 WebView
    // mount 并发；第一次 read 若抢在写入之前就会读到 0。补两次延迟重读兜住
    // 这个先后顺序——原生侧已修掉「下轮 schedule 擦掉证据」的 bug，这里只
    // 负责不让前端成为第二个丢证据的地方。read 幂等，重复读不会有副作用。
    const retries = [
      window.setTimeout(() => void read(), 800),
      window.setTimeout(() => void read(), 2500),
    ];
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    const onNativeForeground = () => void read();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("shui:foreground", onNativeForeground);
    return () => {
      retries.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("shui:foreground", onNativeForeground);
    };
  }, [read]);

  /**
   * 关闭即清账。无论 × / 遮罩 / ESC 还是「知道了」，都必须让原生删掉这条记录，
   * 否则下次冷启动还会读到同一条。本会话内另用 ackAtRef 挡住竞态复读，
   * 两层加起来的目的：既不让刚关的弹窗复活，也不把之后真新增的漏报吞掉。
   */
  const close = useCallback((via: "close" | "acknowledge" = "close") => {
    const at = currentAtRef.current;
    const delayMinutes =
      at > 0 ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : 0;
    track("missed_dialog_action", {
      action: via === "acknowledge" ? "acknowledge" : "close",
      delay_minutes: minutesBucket(delayMinutes),
      alarm_cleared: cleared,
    });
    setOpen(false);
    // 先在本会话确认掉这一条，再发异步清账。顺序反过来会留下竞态窗口：
    // clear 还在途时任意一次 read() 读到旧记录，就把刚关的弹窗又打开。
    // 只在内存里记，清账失败也只是本次会话不弹；下次冷启动仍会读原生记录，
    // 不会把真漏永久吞掉。
    ackAtRef.current = Math.max(ackAtRef.current, at);
    void invoke("clear_missed_alarm")
      .then(() => {
        track("missed_acknowledged", {
          delay_minutes: minutesBucket(delayMinutes),
          via,
        });
      })
      .catch(() => {
        // 清账失败不会让本次会话复读；下次冷启动会再读一次记录。
      });
  }, [cleared]);

  const acknowledge = useCallback(() => {
    close("acknowledge");
  }, [close]);

  function openGuide() {
    track("missed_dialog_action", { action: "open_guide" });
    // 只收起弹窗，不清账：用户可能只是去看看步骤，证据要留到明确「知道了」。
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent(OPEN_GUIDE_EVENT, {
        detail: { step: 2, source: "missed_dialog" },
      })
    );
  }

  // 用户自己暂停了提醒、或关掉了系统通知，就是明确表示不想被打断，
  // 这时再报「没送到」纯属添堵。
  const enabled = hydrated && general.isNotification && !general.isPaused;

  useEffect(() => {
    if (!open || !enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close("close");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, enabled, open]);

  const shownAtRef = useRef(0);
  useEffect(() => {
    if (!open || !enabled) return;
    if (shownAtRef.current === missedAt) return;
    shownAtRef.current = missedAt;
    const delayMinutes = Math.max(0, Math.round((Date.now() - missedAt) / 60_000));
    track("missed_dialog_shown", {
      delay_minutes: minutesBucket(delayMinutes),
      alarm_cleared: cleared,
      missed_hour: new Date(missedAt).getHours(),
      gap_min: Number(alert.gap) || 0,
    });
  }, [open, enabled, missedAt, cleared, alert.gap]);

  if (!open || !enabled) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="missed-alarm-title"
      className="fixed inset-0 z-[55] flex items-end justify-center bg-slate-950/55 px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-in fade-in duration-200"
    >
      <section
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[420px] overflow-hidden rounded-[26px] border border-border/80 bg-card shadow-2xl shadow-slate-950/30 animate-in slide-in-from-bottom-6 duration-300"
      >
        {/* ── 头部：琥珀色而非品牌蓝，这是告警不是推广 ── */}
        <header className="relative overflow-hidden px-5 pb-4 pt-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-400/14 via-transparent to-orange-500/12"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-14 h-32 w-32 rounded-full bg-amber-400/20 blur-2xl"
          />
          <div className="relative flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/25">
              <AlarmClockOff className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2
                id="missed-alarm-title"
                className="text-[15px] font-semibold leading-5 tracking-tight"
              >
                {t("mobile.missed.title", { time: clockLabel(missedAt, locale) })}
              </h2>
              <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">
                {t(cleared ? "mobile.missed.cleared" : "mobile.missed.notShown")}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={() => close("close")}
              className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="px-5 pb-1">
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
            {t("mobile.missed.checkTwo")}
          </p>
          <BackgroundGuideCards rom={rom} source="missed_dialog" />

          <p className="mt-2.5 text-xs leading-[18px] text-muted-foreground">
            {t(cleared ? "mobile.missed.tipSwipe" : "mobile.missed.tipExact")}
          </p>
        </div>

        <footer className="px-5 pb-4 pt-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={openGuide}
              className="flex items-center gap-1 rounded-lg px-1.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              {t("mobile.missed.viewSteps")}
            </button>
            <button
              type="button"
              onClick={() => void acknowledge()}
              className="flex items-center gap-1 rounded-lg px-1.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t("mobile.missed.gotIt")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
