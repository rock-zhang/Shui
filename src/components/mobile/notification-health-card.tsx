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

function clock(ms: number): string {
  if (!ms || ms <= 0) return "—";
  return new Date(ms).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** 把快照转成可复制的纯文本，便于在真机上取证后贴出来分析。 */
function toReport(health: NotificationHealth | null, diag: Diagnostics): string {
  return [
    `Shui 诊断 ${diag.appVersion}`,
    `时间 ${clock(diag.now)} · 间隔 ${diag.gapMinutes} 分钟`,
    `闹钟排期 ${clock(diag.nextAt)} · 上次提醒 ${clock(diag.lastReminderAt)}`,
    `精确闹钟 ${diag.exactAlarm ? "开" : "关"} · 通知权限 ${diag.notificationsEnabled ? "开" : "关"}`,
    `渠道重要度 ${diag.channelImportance} · 横幅 ${health?.headsUp ? "是" : "否"} · 声音 ${health?.channelSound ? "是" : "否"} · 震动 ${health?.channelVibration ? "是" : "否"}`,
    `电池白名单 ${diag.batteryIgnored ? "是" : "否"} · ${diag.dozing ? "深睡 Doze" : "活跃"} · ${diag.interactive ? "亮屏" : "熄屏"}`,
    `漏提醒 ${diag.missedAlarmAt > 0 ? clock(diag.missedAlarmAt) : "无"}`,
    `机型 ${health?.manufacturer ?? "?"} / ${health?.brand ?? "?"} · SDK ${health?.sdkInt ?? "?"}`,
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
    (predicate: (value: NotificationHealth) => boolean, successText: string) => {
      stopWatching();
      const deadline = Date.now() + WATCH_TOTAL_MS;
      const tick = async () => {
        const next = await read();
        if (next && predicate(next)) {
          stopWatching();
          toast.success(successText);
          // 精确闹钟刚授予：已排的那一次仍是非精确的，必须立刻按原锚点重排。
          if (next.exactAlarm) void rescheduleReminders();
          return;
        }
        if (!alive.current || Date.now() >= deadline) stopWatching();
      };
      void tick();
      watchTimer.current = window.setInterval(() => void tick(), WATCH_INTERVAL_MS);
    },
    [read, stopWatching]
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
        toast.error("无法打开该设置页，请到系统设置中手动完成");
      } finally {
        setBusy(null);
      }
    },
    []
  );

  /** 渠道被系统改坏时重建：这是渠道层面唯一能自愈的手段。 */
  const repair = useCallback(async () => {
    setBusy("repair");
    try {
      await invoke("repair_notification_channels");
      await read();
      toast.success("通知渠道已重建，发一条测试通知看看横幅");
    } catch {
      toast.error("修复失败，请到系统通知设置里手动调整");
    } finally {
      setBusy(null);
    }
  }, [read]);

  /**
   * 加入标准电池白名单：优先弹系统的「忽略电池优化？」对话框，
   * 这是唯一能让 isIgnoringBatteryOptimizations 变 true 的 App 内路径。
   */
  const addToWhitelist = useCallback(async () => {
    setBusy("battery");
    try {
      const res = await invoke<{ result: string }>("open_battery_settings");
      if (res?.result === "already") {
        toast.info("已在白名单中，可在列表里确认或撤销");
      } else {
        watchUntil((value) => value.batteryIgnored, "已加入电池优化白名单");
      }
    } catch {
      toast.error("无法打开电池优化设置，请到系统设置里手动添加");
    } finally {
      setBusy(null);
    }
  }, [watchUntil]);

  const copyReport = useCallback(async () => {
    if (!diag) return;
    try {
      await navigator.clipboard.writeText(toReport(health, diag));
      toast.success("诊断信息已复制");
    } catch {
      toast.error("复制失败，请截图");
    }
  }, [diag, health]);

  if (loading) {
    return (
      <MobileSection title="通知体检" description="正在读取系统通知配置…">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
      </MobileSection>
    );
  }

  // 桌面预览没有这套系统概念：如实说明，不摆一堆永远红的勾。
  if (!health) {
    return (
      <MobileSection title="通知体检" description="仅在 Android App 内可用">
        <p className="text-xs leading-5 text-muted-foreground">
          当前环境没有 Android 通知通道。请在手机上打开 App 查看检查结果。
        </p>
      </MobileSection>
    );
  }

  const isDomesticRom = romFromHealth(health).domestic;

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
    channelIssues.push("渠道尚未创建");
  } else {
    if (!health.headsUp) {
      channelIssues.push(
        health.channelImportance < CHANNEL_IMPORTANCE.HIGH
          ? `重要度 ${health.channelImportance}（需 4「紧急」才弹横幅）`
          : "重要度不足"
      );
    }
    if (!health.channelSound) channelIssues.push("提示音为空");
    if (!health.channelVibration) channelIssues.push("震动被关");
  }

  const checks: Check[] = [
    {
      key: "permission",
      label: "通知权限",
      ok: health.notificationsEnabled,
      hint: "系统未允许 Shui 发送通知，所有提醒会被静默丢弃",
      action: (
        <Button
          size="sm"
          className="min-h-8 px-2.5 text-xs"
          disabled={busy !== null}
          onClick={() => void request()}
        >
          {canRequest ? "允许" : "去开启"}
        </Button>
      ),
    },
    {
      key: "exact",
      label: "精确闹钟",
      ok: health.exactAlarm,
      hint: "未开启，到点提醒会被系统推迟十几分钟甚至更久",
      action: (
        <Button
          size="sm"
          variant="outline"
          className="min-h-8 px-2.5 text-xs"
          disabled={busy !== null}
          onClick={() => {
            void run("open_exact_alarm_settings", "请允许 Shui 使用「闹钟和提醒」").then(
              () => watchUntil((value) => value.exactAlarm, "精确闹钟已开启")
            );
          }}
        >
          去开启
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
  const openGuide = () => window.dispatchEvent(new Event(OPEN_GUIDE_EVENT));

  return (
    <MobileSection
      title="通知体检"
      description={
        todo.length === 0
          ? "可自动检测的项目全部通过（下方「必开」项需你自己确认）"
          : `还有 ${todo.length} 项需要处理，否则提醒可能被系统静默拦掉`
      }
    >
      {/* 运行异常优先于配置项：配置全绿但闹钟根本不响，这才是用户真正遇到的场景。 */}
      {overdue && diag && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2">
          <p className="flex items-start gap-2 text-xs leading-5 text-destructive">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">闹钟没响：</span>
              排期 {clock(diag.nextAt)} 已过去 {overdueSeconds} 秒仍未触发，通常是后台运行被关
              或进程被系统冻结。先处理下面的「后台运行」。
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
              通知渠道正常 · 横幅 / 提示音 / 震动都已配置
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">通知渠道有问题：</span>
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
                一键修复
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-8 px-2.5 text-xs"
                disabled={busy !== null}
                onClick={() => void run("open_notification_settings")}
              >
                去设置
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
                后台运行 / 自启动
              </span>
              <span className="rounded bg-amber-500 px-1.5 py-px text-[9px] font-bold leading-4 text-white dark:text-amber-950">
                必开
              </span>
            </span>
            <span className="mt-0.5 block text-amber-700/90 dark:text-amber-300/80">
              不开这一项，从多任务划掉 App 后闹钟会被系统一起清掉，锁屏也不会有任何提醒。
              国产系统新装默认就是关闭的。
            </span>
            <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
              叫法：「允许自启动」「允许后台活动」「允许后台运行」
            </span>
          </span>
        </p>
        <Button
          size="sm"
          className="mt-2 w-full min-h-9 bg-amber-500 text-white shadow-none hover:bg-amber-600 dark:text-amber-950"
          disabled={busy !== null}
          onClick={() =>
            void run("open_autostart_settings", "找到 Shui，把「允许自启动 / 后台运行」打开")
          }
        >
          去开启后台运行
        </Button>
      </div>

      {/* 系统私有开关：读不到状态，只有跳转入口，不装作能检测。 */}
      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-foreground">
          其他系统私有开关
          <span className="ml-1 font-normal text-muted-foreground">
            （App 读不到状态，需你确认一次）
          </span>
        </p>
        <div className="space-y-1.5">
          <ManualRow
            label="横幅 / 锁屏 / 铃声 / 振动"
            hint={
              isDomesticRom
                ? "国产系统默认全关，不打开就只会躺在通知栏"
                : "确认这四项在本机通知设置里都已打开"
            }
            disabled={busy !== null}
            onClick={() => void run("open_notification_settings", "在这页打开这四项开关")}
          />
        </div>
      </div>

      {/* 运行层：权限、精确闹钟、渠道在别处已经能看能改，这里只补它们覆盖不到的
          时间戳与设备状态，所以默认折叠，只在排查时展开。 */}
      {diag && (
        <details className="group mt-3 rounded-xl border border-border/70 bg-background/40">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
            <Activity aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">运行详情</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              下次 {clock(diag.nextAt)}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            />
          </summary>

          <div className="border-t border-border/60 px-3 pb-3 pt-2.5">
            <div className="space-y-1 text-[11px] leading-5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">闹钟排期</span>
                <span className="font-mono tabular-nums">{clock(diag.nextAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">上次提醒</span>
                <span className="font-mono tabular-nums">{clock(diag.lastReminderAt)}</span>
              </div>
              {diag.missedAlarmAt > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">最近漏提醒</span>
                  <span className="tabular-nums text-amber-600 dark:text-amber-400">
                    {clock(diag.missedAlarmAt)} 未送达
                  </span>
                </div>
              )}
              {diag.alarmCleared && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">闹钟句柄</span>
                  <span className="text-amber-600 dark:text-amber-400">已被系统清除</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">间隔</span>
                <span className="tabular-nums">{diag.gapMinutes} 分钟</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">设备状态</span>
                <span className="tabular-nums">
                  {diag.dozing ? "深睡（Doze）" : "活跃"} · {diag.interactive ? "亮屏" : "熄屏"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">渠道重要度</span>
                <span className="tabular-nums">
                  {diag.channelImportance}
                  {diag.channelImportance > 0 && diag.channelImportance < 4 && "（低于 4 不弹横幅）"}
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
                <span className="text-muted-foreground">电池优化白名单</span>{" "}
                <span
                  className={
                    diag.batteryIgnored
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground"
                  }
                >
                  {diag.batteryIgnored ? "已加入" : "未加入"}
                </span>
                {!diag.batteryIgnored && (
                  <span className="block text-[10px] leading-4 text-muted-foreground/80">
                    非必开项，加上只是更稳一点
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
                  加入
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
                刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 px-2 text-[11px]"
                onClick={() => void copyReport()}
              >
                <Activity className="mr-1 h-3 w-3" />
                复制诊断
              </Button>
            </div>

            <p className="mt-2 text-[10px] leading-4 text-muted-foreground/80">
              v{diag.appVersion} · {health.manufacturer || "未知机型"} / SDK {health.sdkInt}
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
          打开「3 步设置」引导
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openGuide}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-sky-400/60 hover:text-foreground"
        >
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          重新查看「3 步设置」引导
        </button>
      )}
    </MobileSection>
  );
}
