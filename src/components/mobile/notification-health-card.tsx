"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Power,
  RefreshCw,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CHANNEL_IMPORTANCE,
  onRefresh,
  readDiagnostics,
  readNotificationHealth,
  rescheduleReminders,
  type Diagnostics,
  type NotificationHealth,
} from "@/lib/mobile";
import { romFromHealth } from "@/lib/rom";
import { track } from "@/lib/analytics";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useNotificationPermission } from "./notification-permission-context";
import { OPEN_GUIDE_EVENT } from "./notification-setup-guide";
import { MobileSection } from "./ui";

/** 跳系统设置后轮询确认结果的时长上限与间隔（与权限 Provider 保持一致）。 */
const WATCH_TOTAL_MS = 30_000;
const WATCH_INTERVAL_MS = 900;

/** 闹钟超过这么久没触发才判定「被系统拦了」，避开发送瞬间的正常抖动。 */
const OVERDUE_TOLERANCE_S = 90;

/** 一条可自动检测、且**检测结果为否就必须动手**的项。 */
type Check = {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
  action: React.ReactNode;
};

function clock(ms: number, locale: string): string {
  if (!ms || ms <= 0) return "—";
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

type Translate = ReturnType<typeof useI18n>["t"];

/** 把快照转成可复制的纯文本，便于在真机上取证后贴出来分析。 */
function toReport(
  health: NotificationHealth | null,
  diag: Diagnostics,
  t: Translate,
  locale: string
): string {
  const on = t("mobile.health.on");
  const off = t("mobile.health.off");
  const yes = t("mobile.health.yes");
  const no = t("mobile.health.no");
  return [
    `${t("mobile.health.report.title")} ${diag.appVersion}`,
    `${t("mobile.health.report.time")} ${clock(diag.now, locale)} · ${t("mobile.health.report.gap")} ${diag.gapMinutes} ${t("mobile.health.minutes")}`,
    `${t("mobile.health.report.scheduled")} ${clock(diag.nextAt, locale)} · ${t("mobile.health.report.lastReminder")} ${clock(diag.lastReminderAt, locale)}`,
    `${t("mobile.health.report.exact")} ${diag.exactAlarm ? on : off} · ${t("mobile.health.report.permission")} ${diag.notificationsEnabled ? on : off}`,
    `${t("mobile.health.report.importance")} ${diag.channelImportance} · ${t("mobile.health.report.headsUp")} ${health?.headsUp ? yes : no} · ${t("mobile.health.report.sound")} ${health?.channelSound ? yes : no} · ${t("mobile.health.report.vibration")} ${health?.channelVibration ? yes : no}`,
    `${t("mobile.health.report.whitelist")} ${diag.batteryIgnored ? yes : no} · ${diag.dozing ? t("mobile.health.report.dozing") : t("mobile.health.report.active")} · ${diag.interactive ? t("mobile.health.report.screenOn") : t("mobile.health.report.screenOff")}`,
    `${t("mobile.health.report.missed")} ${diag.missedAlarmAt > 0 ? clock(diag.missedAlarmAt, locale) : t("mobile.health.report.none")}`,
    `${t("mobile.health.report.device")} ${health?.manufacturer ?? "?"} / ${health?.brand ?? "?"} · SDK ${health?.sdkInt ?? "?"}`,
  ].join("\n");
}

/** 检测不到状态、只能带用户去设置页的项。 */
function ManualRow({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-left transition-colors hover:border-sky-400/60 disabled:opacity-60"
    >
      <span className="min-w-0 flex-1 text-xs">
        <span className="font-medium">{label}</span>
        <span className="block leading-4 text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/**
 * 通知体检：只回答一个问题——「为什么到点没反应」。
 *
 * 原来是「通知体检」+「后台诊断」两张卡，各说一半：权限、精确闹钟、渠道重要度
 * 在两处重复出现，一处能点、一处只是只读的勾；诊断卡的「定制系统必做」整段又和
 * 后台运行块说的是同一件事。合并成一张后分两层——
 *
 *   1. 配置层（默认可见）：只列**没通过且必须动手**的项，读完就知道该去点什么。
 *   2. 运行层（折叠）：排期、上次提醒、Doze、版本这些取证用的数字，平时不占版面，
 *      闹钟真的过期未触发时才在顶部报警。
 *
 * 另外刻意不放「电池优化白名单」的红色 ✗：`isIgnoringBatteryOptimizations` 读的是
 * Android 标准 Doze 白名单，而 ColorOS 的「耗电管理 → 允许后台运行」写的是厂商
 * 自己的策略，两边不通——用户在最显眼的地方点到死也不会变绿。提醒用
 * setExactAndAllowWhileIdle 排期，本就能穿透 Doze，这一项只是兜底，所以降级成
 * 中性状态 + 一个真正能弹出标准授权框的入口。
 */
export function NotificationHealthCard() {
  const { t, locale } = useI18n();
  const { canRequest, request } = useNotificationPermission();
  const [health, setHealth] = useState<NotificationHealth | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const watchTimer = useRef<number | null>(null);
  const followUpTimers = useRef<number[]>([]);

  const stopWatching = useCallback(() => {
    if (watchTimer.current !== null) {
      window.clearInterval(watchTimer.current);
      watchTimer.current = null;
    }
  }, []);

  const clearFollowUps = useCallback(() => {
    followUpTimers.current.forEach((id) => window.clearTimeout(id));
    followUpTimers.current = [];
  }, []);

  const read = useCallback(async (): Promise<NotificationHealth | null> => {
    const [next, snapshot] = await Promise.all([
      readNotificationHealth(),
      readDiagnostics(),
    ]);
    if (alive.current) {
      setHealth(next);
      setDiag(snapshot);
      setLoading(false);
    }
    return next;
  }, []);

  /**
   * 从系统设置页返回后短轮询：精确闹钟、电池白名单这类开关的改动不会派发
   * visibilitychange（WebView 一直是 visible），只能主动轮询确认。
   */
  const watchUntil = useCallback(
    (predicate: (value: NotificationHealth) => boolean, successKey: MessageKey) => {
      stopWatching();
      const deadline = Date.now() + WATCH_TOTAL_MS;
      const tick = async () => {
        const next = await read();
        if (next && predicate(next)) {
          stopWatching();
          toast.success(t(successKey));
          // 精确闹钟刚授予：已排的那一次仍是非精确的，必须立刻按原锚点重排。
          if (next.exactAlarm) void rescheduleReminders();
          return;
        }
        if (!alive.current || Date.now() >= deadline) stopWatching();
      };
      void tick();
      watchTimer.current = window.setInterval(() => void tick(), WATCH_INTERVAL_MS);
    },
    [read, stopWatching, t]
  );

  /**
   * 从系统设置返回时刷新。除了立刻读一次，还在短窗口内补读几次：
   * 系统渠道的震动/声音/重要度在部分 ROM 上不是同步落盘的，onResume 当场读
   * 很可能拿到旧值；此前只读一次，之后没有任何读取来纠正，模块就一直停在改之前
   * 的状态（表现为「改了震动但通知体检没反应」）。补读覆盖这段落盘延迟。
   */
  const refreshFromForeground = useCallback(() => {
    void read();
    clearFollowUps();
    for (const delay of [400, 1200, 2500]) {
      followUpTimers.current.push(
        window.setTimeout(() => {
          if (alive.current) void read();
        }, delay)
      );
    }
  }, [read, clearFollowUps]);

  useEffect(() => {
    alive.current = true;
    void read();

    const onForeground = () => {
      if (document.visibilityState === "visible") refreshFromForeground();
    };
    const onNativeForeground = () => refreshFromForeground();
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    window.addEventListener("shui:foreground", onNativeForeground);
    // 引导完成、权限变更、记录饮水等会发 shui:refresh；体检卡的状态全来自
    // read()，不订阅就一直停在旧快照（表现为「打开引导」按钮和检查项不更新）。
    const offRefresh = onRefresh(() => refreshFromForeground());
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("shui:foreground", onNativeForeground);
      offRefresh();
      stopWatching();
      clearFollowUps();
    };
  }, [refreshFromForeground, stopWatching, clearFollowUps]);

  const run = useCallback(
    async (command: string, successText?: string) => {
      setBusy(command);
      try {
        await invoke(command);
        if (successText) toast.info(successText);
      } catch {
        toast.error(t("mobile.notif.openSettingsFailed"));
      } finally {
        setBusy(null);
      }
    },
    [t]
  );

  /** 渠道被系统改坏时重建：这是渠道层面唯一能自愈的手段。 */
  const repair = useCallback(async () => {
    track("health_item_action", { item: "channel", action: "repair" });
    setBusy("repair");
    try {
      await invoke("repair_notification_channels");
      await read();
      toast.success(t("mobile.health.repaired"));
    } catch {
      toast.error(t("mobile.health.repairFailed"));
    } finally {
      setBusy(null);
    }
  }, [read, t]);

  /**
   * 加入标准电池白名单：优先弹系统的「忽略电池优化？」对话框，
   * 这是唯一能让 isIgnoringBatteryOptimizations 变 true 的 App 内路径。
   */
  const addToWhitelist = useCallback(async () => {
    track("health_item_action", { item: "battery", action: "add" });
    setBusy("battery");
    try {
      const res = await invoke<{ result: string }>("open_battery_settings");
      if (res?.result === "already") {
        toast.info(t("mobile.health.alreadyWhitelisted"));
      } else {
        watchUntil((value) => value.batteryIgnored, "mobile.health.addedWhitelist");
      }
    } catch {
      toast.error(t("mobile.health.whitelistFailed"));
    } finally {
      setBusy(null);
    }
  }, [watchUntil, t]);

  const copyReport = useCallback(async () => {
    if (!diag) return;
    try {
      await navigator.clipboard.writeText(toReport(health, diag, t, locale));
      track("health_diagnostics_copy", { result: "success" });
      toast.success(t("mobile.health.reportCopied"));
    } catch {
      track("health_diagnostics_copy", { result: "failed" });
      toast.error(t("mobile.health.copyFailed"));
    }
  }, [diag, health, t, locale]);

  // 体检卡浏览一次记一次：用失败项数量做维度，能看出「哪类问题最常见」。
  const viewLogged = useRef(false);
  useEffect(() => {
    if (viewLogged.current || !health || !diag) return;
    viewLogged.current = true;
    const channelHealthy =
      health.channelExists &&
      health.headsUp &&
      health.channelSound &&
      health.channelVibration;
    const failed =
      Number(!health.notificationsEnabled) +
      Number(!health.exactAlarm) +
      Number(!channelHealthy);
    track("health_card_view", {
      failed_items: failed,
      channel_ok: channelHealthy,
      overdue_seconds:
        diag.nextAt > 0
          ? Math.max(0, Math.round((Date.now() - diag.nextAt) / 1000))
          : 0,
      guide_needs_attention: failed > 0 || !channelHealthy,
    });
  }, [health, diag]);

  if (loading) {
    return (
      <MobileSection
        title={t("mobile.health.title")}
        description={t("mobile.health.loading")}
      >
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
      </MobileSection>
    );
  }

  // 桌面预览没有这套系统概念：如实说明，不摆一堆永远红的勾。
  if (!health) {
    return (
      <MobileSection
        title={t("mobile.health.title")}
        description={t("mobile.health.androidOnly")}
      >
        <p className="text-xs leading-5 text-muted-foreground">
          {t("mobile.health.noChannel")}
        </p>
      </MobileSection>
    );
  }

  const rom = romFromHealth(health, locale);
  const isDomesticRom = rom.domestic;

  /**
   * 渠道层是否自洽（不代表一定能弹横幅，见组件注释）。
   *
   * 这里刻意**不检查 lockscreenVisibility**：该字段在 API 30 起已被废弃，
   * `setLockscreenVisibility(PUBLIC)` 只是写在渠道对象上，真正决定锁屏是否
   * 显示正文的是系统「锁屏通知 → 显示所有内容」这个用户设置，App 读不到。
   * 拿它判定会常年报「非 PUBLIC」的假故障，重建渠道也修不好。
   */
  const channelOk =
    health.channelExists &&
    health.headsUp &&
    health.channelSound &&
    health.channelVibration;

  const channelIssues: string[] = [];
  if (!health.channelExists) {
    channelIssues.push(t("mobile.health.channelMissing"));
  } else {
    if (!health.headsUp) {
      channelIssues.push(
        health.channelImportance < CHANNEL_IMPORTANCE.HIGH
          ? t("mobile.health.lowImportance", { level: health.channelImportance })
          : t("mobile.health.importanceLow")
      );
    }
    if (!health.channelSound) channelIssues.push(t("mobile.health.noSound"));
    if (!health.channelVibration) channelIssues.push(t("mobile.health.noVibration"));
  }

  const checks: Check[] = [
    {
      key: "permission",
      label: t("mobile.health.check.permission"),
      ok: health.notificationsEnabled,
      hint: t("mobile.health.check.permissionHint"),
      action: (
        <Button
          size="sm"
          className="min-h-8 px-2.5 text-xs"
          disabled={busy !== null}
          onClick={() => {
            track("health_item_action", {
              item: "permission",
              action: canRequest ? "request" : "open_settings",
            });
            void request("health_card");
          }}
        >
          {canRequest ? t("mobile.health.allow") : t("mobile.health.goEnable")}
        </Button>
      ),
    },
    {
      key: "exact",
      label: t("mobile.health.check.exact"),
      ok: health.exactAlarm,
      hint: t("mobile.health.check.exactHint"),
      action: (
        <Button
          size="sm"
          variant="outline"
          className="min-h-8 px-2.5 text-xs"
          disabled={busy !== null}
          onClick={() => {
            track("health_item_action", {
              item: "exact_alarm",
              action: "open_settings",
            });
            void run("open_exact_alarm_settings", t("mobile.health.allowExact")).then(
              () => watchUntil((value) => value.exactAlarm, "mobile.health.exactEnabled")
            );
          }}
        >
          {t("mobile.health.goEnable")}
        </Button>
      ),
    },
  ];

  const todo = checks.filter((item) => !item.ok);

  // 排期已过期很久仍没动静——比任何配置项都说明问题，必须顶到最前面。
  const overdueSeconds =
    diag && diag.nextAt > 0
      ? Math.round((Date.now() - diag.nextAt) / 1000)
      : 0;
  const overdue = overdueSeconds > OVERDUE_TOLERANCE_S;

  /**
   * 引导入口要不要抢眼：只要还有可检测项没过（或渠道不自洽），说明用户
   * 压根没走完那三步，此时「重新查看引导」是个灰扑扑的虚线按钮就被跳过了。
   * 全部通过后才收起成低调的复查入口——没事可做还吆喝，反而像广告。
   */
  const guideNeedsAttention = todo.length > 0 || !channelOk;
  const openGuide = () => {
    track("health_item_action", { item: "guide", action: "open_guide" });
    window.dispatchEvent(
      new CustomEvent(OPEN_GUIDE_EVENT, {
        detail: { source: "health_card" },
      })
    );
  };

  return (
    <MobileSection
      title={t("mobile.health.title")}
      description={
        todo.length === 0
          ? t("mobile.health.allPassed")
          : t("mobile.health.todo", { count: todo.length })
      }
    >
      {/* 运行异常优先于配置项：配置全绿但闹钟根本不响，这才是用户真正遇到的场景。 */}
      {overdue && diag && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2">
          <p className="flex items-start gap-2 text-xs leading-5 text-destructive">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">{t("mobile.health.overdue.title")}</span>
              {t("mobile.health.overdue.body", {
                time: clock(diag.nextAt, locale),
                seconds: overdueSeconds,
              })}
            </span>
          </p>
        </div>
      )}

      {/* 渠道摘要：正常时一行，异常时才展开并提供唯一可自愈的动作。 */}
      <div className={overdue ? "mt-2" : undefined}>
        {channelOk ? (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            <p className="text-xs leading-5 text-emerald-700 dark:text-emerald-300">
              {t("mobile.health.channelOk")}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">{t("mobile.health.channelBad")}</span>
                {channelIssues.join(" · ")}
              </span>
            </p>
            <div className="mt-2 flex gap-1.5">
              <Button
                size="sm"
                className="min-h-8 px-2.5 text-xs"
                disabled={busy !== null}
                onClick={() => void repair()}
              >
                <Wrench className="mr-1 h-3.5 w-3.5" />
                {t("mobile.health.repair")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-8 px-2.5 text-xs"
                disabled={busy !== null}
                onClick={() => {
                  track("health_item_action", {
                    item: "channel",
                    action: "open_settings",
                  });
                  void run("open_notification_settings");
                }}
              >
                {t("mobile.health.goSettings")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 只列没过的检测项：通过的不占版面，避免"一片绿但就是不响"。 */}
      {todo.length > 0 && (
        <div className="mt-1.5 divide-y divide-border/50">
          {todo.map((item) => (
            <div key={item.key} className="flex items-start gap-2.5 py-2.5">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5">{item.label}</p>
                <p className="mt-0.5 text-xs leading-4 text-amber-600 dark:text-amber-400">
                  {item.hint}
                </p>
              </div>
              <div className="shrink-0 pt-0.5">{item.action}</div>
            </div>
          ))}
        </div>
      )}

      {/* 头号项单独成块：后台运行没开 = 划掉 App 后彻底收不到，比上面几项都致命。
          状态读不到（厂商私有），所以用「必开」强调 + 入口，而不是伪装成检测项。 */}
      <div className="mt-3 rounded-xl border-2 border-amber-500/70 bg-amber-500/10 p-3">
        <p className="flex items-start gap-2">
          <Power
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <span className="min-w-0 flex-1 text-xs leading-5">
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                {t("mobile.health.background.title")}
              </span>
              <span className="rounded bg-amber-500 px-1.5 py-px text-[9px] font-bold leading-4 text-white dark:text-amber-950">
                {t("mobile.health.mustEnable")}
              </span>
            </span>
            {/* 厂商开关没有公开 API，状态读不到，所以每次都请用户按路径检查。 */}
            <span className="mt-1 block text-xs leading-4 text-muted-foreground">
              {t("mobile.health.background.cannotRead")}
            </span>
            <span className="mt-0.5 block text-amber-700/90 dark:text-amber-300/80">
              {t("mobile.health.background.mustBoth")}
            </span>
          </span>
        </p>
        <Button
          size="sm"
          className="mt-2 w-full min-h-9 bg-amber-500 text-white shadow-none hover:bg-amber-600 dark:text-amber-950"
          disabled={busy !== null}
          onClick={() => {
            track("health_item_action", {
              item: "background",
              action: "open_guide",
            });
            window.dispatchEvent(
              new CustomEvent(OPEN_GUIDE_EVENT, {
                detail: { step: 2, source: "health_card" },
              })
            );
          }}
        >
          {t("mobile.health.background.check")}
        </Button>
      </div>

      {/* 系统私有开关：读不到状态，只有跳转入口，不装作能检测。 */}
      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-foreground">
          {t("mobile.health.private.title")}
          <span className="ml-1 font-normal text-muted-foreground">
            {t("mobile.health.private.note")}
          </span>
        </p>
        <div className="space-y-1.5">
          <ManualRow
            label={t("mobile.health.private.fourToggles")}
            hint={
              isDomesticRom
                ? t("mobile.health.private.domesticHint")
                : t("mobile.health.private.genericHint")
            }
            disabled={busy !== null}
            onClick={() => {
              track("health_item_action", {
                item: "channel",
                action: "open_settings",
              });
              void run("open_notification_settings", t("mobile.health.private.openHint"));
            }}
          />
        </div>
      </div>

      {/* 运行层：权限、精确闹钟、渠道在别处已经能看能改，这里只补它们覆盖不到的
          时间戳与设备状态，所以默认折叠，只在排查时展开。 */}
      {diag && (
        <details className="group mt-3 rounded-xl border border-border/70 bg-background/40">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
            <Activity aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">{t("mobile.health.details.title")}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {t("mobile.health.details.next", { time: clock(diag.nextAt, locale) })}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            />
          </summary>

          <div className="border-t border-border/60 px-3 pb-3 pt-2.5">
            <div className="space-y-1 text-[11px] leading-5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("mobile.health.report.scheduled")}</span>
                <span className="font-mono tabular-nums">{clock(diag.nextAt, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("mobile.health.report.lastReminder")}</span>
                <span className="font-mono tabular-nums">{clock(diag.lastReminderAt, locale)}</span>
              </div>
              {diag.missedAlarmAt > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("mobile.health.details.recentMissed")}</span>
                  <span className="tabular-nums text-amber-600 dark:text-amber-400">
                    {t("mobile.health.details.notDelivered", { time: clock(diag.missedAlarmAt, locale) })}
                  </span>
                </div>
              )}
              {diag.alarmCleared && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("mobile.health.details.alarmHandle")}</span>
                  <span className="text-amber-600 dark:text-amber-400">{t("mobile.health.details.clearedBySystem")}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("mobile.health.report.gap")}</span>
                <span className="tabular-nums">{diag.gapMinutes} {t("mobile.health.minutes")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("mobile.health.details.deviceState")}</span>
                <span className="tabular-nums">
                  {diag.dozing ? t("mobile.health.report.dozing") : t("mobile.health.report.active")} · {diag.interactive ? t("mobile.health.report.screenOn") : t("mobile.health.report.screenOff")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("mobile.health.report.importance")}</span>
                <span className="tabular-nums">
                  {diag.channelImportance}
                  {diag.channelImportance > 0 && diag.channelImportance < 4 && t("mobile.health.details.belowFour")}
                </span>
              </div>
            </div>

            {/* 白名单不标红：它不是硬门槛，且厂商店里的「允许后台运行」根本不写这张表，
                红了也没法靠那句提示修好。给一个真能弹出标准授权框的入口即可。 */}
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
              <BatteryCharging
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 text-[11px] leading-4">
                <span className="text-muted-foreground">{t("mobile.health.report.whitelist")}</span>{" "}
                <span
                  className={
                    diag.batteryIgnored
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground"
                  }
                >
                  {diag.batteryIgnored ? t("mobile.health.joined") : t("mobile.health.notJoined")}
                </span>
                {!diag.batteryIgnored && (
                  <span className="block text-[10px] leading-4 text-muted-foreground/80">
                    {t("mobile.health.whitelistOptional")}
                  </span>
                )}
              </span>
              {!diag.batteryIgnored && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void addToWhitelist()}
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-sky-600 transition-colors hover:bg-sky-500/10 disabled:opacity-60 dark:text-sky-400"
                >
                  {t("mobile.health.join")}
                </button>
              )}
            </div>

            <div className="mt-2 flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 px-2 text-[11px]"
                disabled={busy !== null}
                onClick={() => {
                  setBusy("refresh");
                  void read().finally(() => setBusy(null));
                }}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                {t("common.refresh")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 px-2 text-[11px]"
                onClick={() => void copyReport()}
              >
                <Activity className="mr-1 h-3 w-3" />
                {t("mobile.health.copyReport")}
              </Button>
            </div>

            <p className="mt-2 text-[10px] leading-4 text-muted-foreground/80">
              v{diag.appVersion} · {health.manufacturer || t("mobile.health.unknownDevice")} / SDK {health.sdkInt}
            </p>
          </div>
        </details>
      )}

      {/* 引导只自动弹一次，跳过了就再无入口。权限没配齐时这里是主 CTA，
          配齐后才退成低调的复查入口。 */}
      {guideNeedsAttention ? (
        <button
          type="button"
          onClick={openGuide}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-sky-500/20 transition-all duration-150 active:scale-[0.985]"
        >
          <BellRing aria-hidden="true" className="h-4 w-4" />
          {t("mobile.health.openGuide")}
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openGuide}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-sky-400/60 hover:text-foreground"
        >
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          {t("mobile.health.reviewGuide")}
        </button>
      )}
    </MobileSection>
  );
}
