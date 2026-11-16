"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  GAP_OPTIONS,
  GOLD_OPTIONS,
  WEEKDAY_LABELS,
  emitShowReminder,
} from "@/lib/mobile";
import { cn } from "@/lib/utils";
import { sendReminderNotification } from "@/utils/notification";
import { useMobileConfig } from "./config-context";
import { useNotificationPermission } from "./notification-permission-context";
import { MobileRow, MobileSection, MobileTimeInput } from "./ui";

/** 从系统设置返回后轮询确认授权结果的时长上限与间隔。 */
const WATCH_TOTAL_MS = 30_000;
const WATCH_INTERVAL_MS = 900;

function Chip({
  selected,
  onClick,
  children,
  sublabel,
  className,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  sublabel?: string;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        "flex min-h-11 shrink-0 flex-col items-center justify-center rounded-xl px-4 text-sm font-medium tabular-nums transition-colors",
        selected
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-muted text-muted-foreground",
        className
      )}
    >
      {children}
      {sublabel && (
        <span className="mt-0.5 text-[10px] font-normal leading-none opacity-75">
          {sublabel}
        </span>
      )}
    </button>
  );
}

/** Stable placeholder: never paints DEFAULT_ALERT before the stored config arrives. */
function ReminderSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="正在读取提醒设置">
      {[96, 96, 96, 96, 224, 168, 180].map((height, index) => (
        <Skeleton key={index} className="rounded-2xl" style={{ height }} />
      ))}
    </div>
  );
}

export function ReminderTab() {
  const { alert, general, hydrated, patchAlert, patchGeneral } =
    useMobileConfig();
  // 通知权限由 NotificationPermissionProvider 统一持有：今日 tab 的提示卡和
  // 这里的红字读同一份状态，切回前台也只查一次系统。
  const {
    permission,
    canRequest: notifCanRequest,
    request: requestNotification,
  } = useNotificationPermission();
  const [exactAlarm, setExactAlarm] = useState<"unknown" | "granted" | "denied">(
    "unknown"
  );
  const [battery, setBattery] = useState<"unknown" | "granted" | "denied">(
    "unknown"
  );
  const alive = useRef(true);
  const watchTimer = useRef<number | null>(null);

  const stopWatching = useCallback(() => {
    if (watchTimer.current !== null) {
      window.clearInterval(watchTimer.current);
      watchTimer.current = null;
    }
  }, []);

  const readExactAlarm = useCallback(async (): Promise<boolean> => {
    try {
      const granted = await invoke<boolean>("is_exact_alarm_granted");
      if (alive.current) setExactAlarm(granted ? "granted" : "denied");
      return granted;
    } catch {
      // 桌面预览 / Android 11 以下无此权限概念，按已满足处理。
      if (alive.current) setExactAlarm("granted");
      return true;
    }
  }, []);

  const readBattery = useCallback(async (): Promise<boolean> => {
    try {
      const granted = await invoke<boolean>("is_battery_optimization_ignored");
      if (alive.current) setBattery(granted ? "granted" : "denied");
      return granted;
    } catch {
      // 桌面预览没有电池优化概念，按已满足处理。
      if (alive.current) setBattery("granted");
      return true;
    }
  }, []);

  const refreshPermissions = useCallback(() => {
    // 通知权限由 Provider 在同一个前台信号里刷新，这里不重复查。
    void readExactAlarm();
    void readBattery();
  }, [readExactAlarm, readBattery]);

  /**
   * 跳系统设置或触发系统确认弹窗后，短轮询确认结果。
   * 电池优化的「允许/不允许」弹窗由系统设置承载，Tauri 的 WebView 在这种
   * 场景下不一定派发 hidden→visible，只靠 visibilitychange 会让开关一直
   * 停在「关」。轮询最多持续 WATCH_TOTAL_MS，状态变成期望值即停并提示。
   *
   * @param expect 期望的最终状态：去开启传 true，去关闭传 false。
   */
  const watchPermission = useCallback(
    (read: () => Promise<boolean>, successText: string, expect = true) => {
      stopWatching();
      const deadline = Date.now() + WATCH_TOTAL_MS;
      const tick = async () => {
        const current = await read();
        if (current === expect) {
          stopWatching();
          toast.success(successText);
          return;
        }
        if (!alive.current || Date.now() >= deadline) stopWatching();
      };
      void tick();
      watchTimer.current = window.setInterval(() => void tick(), WATCH_INTERVAL_MS);
    },
    [stopWatching]
  );

  useEffect(() => {
    alive.current = true;
    refreshPermissions();

    // visibilitychange 之外再叠加两个信号：focus 覆盖部分 ROM 的行为，
    // shui:foreground 由原生 onResume 主动派发，最可靠（系统确认弹窗返回时
    // visibilityState 往往一直是 visible，只有它一定会来）。
    const onForeground = () => {
      if (document.visibilityState === "visible") refreshPermissions();
    };
    const onNativeForeground = () => refreshPermissions();
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    window.addEventListener("shui:foreground", onNativeForeground);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("shui:foreground", onNativeForeground);
      stopWatching();
    };
  }, [refreshPermissions, stopWatching]);

  const toggleWeekday = (day: number) => {
    const weekdays = alert.weekdays ?? [];
    patchAlert({
      weekdays: weekdays.includes(day)
        ? weekdays.filter((value) => value !== day)
        : [...weekdays, day].sort((a, b) => a - b),
    });
  };

  async function openExactAlarmSettings() {
    // 已开启时点开关是去关闭，未开启才是去开启——文案和轮询方向都不同。
    const turningOff = exactAlarm === "granted";
    try {
      await invoke("open_exact_alarm_settings");
      toast.info(
        turningOff
          ? "已打开「闹钟和提醒」，可在此关闭"
          : "已打开「闹钟和提醒」，请允许 Shui"
      );
      watchPermission(
        readExactAlarm,
        turningOff ? "精确闹钟权限已关闭" : "精确闹钟权限已开启",
        !turningOff
      );
    } catch {
      toast.error("无法打开该设置页，请到 应用信息 → 闹钟和提醒 手动设置");
    }
  }

  async function openBatterySettings() {
    try {
      const result = await invoke<string>("open_battery_settings");
      if (result === "already") {
        toast.info("已打开电池优化列表，可在此关闭");
        watchPermission(readBattery, "已关闭电池优化白名单", false);
      } else if (result === "unavailable") {
        toast.error("当前系统未开放该设置页，请到 应用信息 → 电池 手动设置");
      } else if (result === "requested") {
        toast.info("请在系统弹窗中选「允许」");
        watchPermission(readBattery, "已加入电池优化白名单");
      } else {
        toast.info("请在列表中找到 Shui，选择「不优化」");
        watchPermission(readBattery, "已加入电池优化白名单");
      }
    } catch {
      toast.error("当前系统未开放该设置页，请到 应用信息 → 电池 手动设置");
    }
  }

  async function sendTestNotification() {
    try {
      await sendReminderNotification();
      toast.success("测试通知已发送");
    } catch {
      toast.info("当前为桌面预览，通知由 Android 原生通道发送");
    }
  }

  if (!hydrated) return <ReminderSkeleton />;

  // 「想收通知」与「系统允许通知」是两件事：前者是 App 偏好，后者是系统权限。
  // 两者同时成立才会真正到达，所以只在这一行做联动提示，不再单列一个开关。
  const notifBlocked = general.isNotification && permission === "denied";

  return (
    <>
      <MobileSection
        title="每日目标"
        description="达成目标后不再重复提醒，建议不低于 1500ml"
      >
        <div className="mobile-scroll-x flex gap-2 overflow-x-auto overflow-y-hidden pb-1">
          {GOLD_OPTIONS.map((value) => (
            <Chip
              key={value}
              selected={alert.gold === value}
              onClick={() => patchAlert({ gold: value })}
              label={`每日目标 ${value} 毫升`}
            >
              {value} ml
            </Chip>
          ))}
        </div>
      </MobileSection>

      <MobileSection
        title="提醒间隔"
        description="每隔设定时间提醒一次，单位为分钟"
      >
        <div className="grid grid-cols-5 gap-1.5">
          {GAP_OPTIONS.map((value) => (
            <Chip
              key={value}
              selected={alert.gap === value}
              onClick={() => patchAlert({ gap: value })}
              sublabel="分钟"
              label={`每 ${value} 分钟提醒一次`}
              className="w-full shrink px-0"
            >
              {value}
            </Chip>
          ))}
        </div>
      </MobileSection>

      <MobileSection title="重复" description="不选择任何一天则每天提醒">
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_LABELS.map((label, day) => {
            const selected = (alert.weekdays ?? []).includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleWeekday(day)}
                className={cn(
                  "flex h-11 min-w-0 items-center justify-center rounded-xl text-sm font-medium transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </MobileSection>

      <MobileSection title="时间范围" description="00:00 作为结束时间表示次日零点">
        <div className="flex items-center gap-2">
          <MobileTimeInput
            label="开始时间"
            value={alert.timeStart}
            onChange={(value) => patchAlert({ timeStart: value })}
          />
          <span className="shrink-0 text-xs text-muted-foreground">至</span>
          <MobileTimeInput
            label="结束时间"
            value={alert.timeEnd}
            onChange={(value) => patchAlert({ timeEnd: value })}
          />
        </div>
      </MobileSection>

      <MobileSection
        title="提醒方式"
        description="两种通道可同时开启：后台靠系统通知保底到达，App 在前台时展示全屏提醒"
      >
        <MobileRow
          title="系统通知"
          description={
            notifBlocked ? (
              <>
                {notifCanRequest
                  ? "通知权限未开启，当前收不到提醒 · "
                  : "通知权限已被系统禁止弹窗，当前收不到提醒 · "}
                <button
                  type="button"
                  onClick={() => void requestNotification()}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  去开启
                </button>
              </>
            ) : general.isNotification ? (
              "锁屏或退到后台也能到达，通知里可直接记一杯水"
            ) : (
              "已关闭，锁屏与后台不再提醒"
            )
          }
          descriptionClassName={notifBlocked ? "text-destructive" : undefined}
          control={
            <Switch
              checked={general.isNotification}
              onCheckedChange={(value) => patchGeneral({ isNotification: value })}
              aria-label="系统通知"
            />
          }
        />
        <MobileRow
          title="全屏提醒"
          description="打开 App 时显示彩虹渐变提醒页，30 秒倒计时"
          control={
            <Switch
              checked={general.isFullScreen}
              onCheckedChange={(value) => patchGeneral({ isFullScreen: value })}
              aria-label="全屏提醒"
            />
          }
        />
        <MobileRow
          title="提醒音效"
          description="提醒到达时播放水滴声"
          control={
            <Switch
              checked={general.isSound}
              onCheckedChange={(value) => patchGeneral({ isSound: value })}
              aria-label="提醒音效"
            />
          }
        />
        <MobileRow
          title="暂停提醒"
          description="临时关闭全部提醒，饮水记录仍可手动添加"
          control={
            <Switch
              checked={general.isPaused}
              onCheckedChange={(value) => patchGeneral({ isPaused: value })}
              aria-label="暂停提醒"
            />
          }
        />
      </MobileSection>

      <MobileSection
        title="勿扰时段"
        description="在该时段内不发送提醒，适合午休或夜间"
      >
        <MobileRow
          title="启用勿扰"
          description="适合午休、会议或夜间"
          control={
            <Switch
              checked={general.quietEnabled}
              onCheckedChange={(value) => patchGeneral({ quietEnabled: value })}
              aria-label="启用勿扰时段"
            />
          }
        />
        {general.quietEnabled && (
          <div className="flex items-center gap-2 pb-1 pt-2">
            <MobileTimeInput
              label="勿扰开始时间"
              value={general.quietStart}
              onChange={(value) => patchGeneral({ quietStart: value })}
            />
            <span className="shrink-0 text-xs text-muted-foreground">至</span>
            <MobileTimeInput
              label="勿扰结束时间"
              value={general.quietEnd}
              onChange={(value) => patchGeneral({ quietEnd: value })}
            />
          </div>
        )}
      </MobileSection>

      <MobileSection
        title="后台到达能力"
        description="Android 会冻结后台页面，提醒必须由系统闹钟驱动；以下系统权限决定能否准时到达"
      >
        <MobileRow
          title="精确闹钟权限"
          description={
            exactAlarm === "granted"
              ? "已开启 · 后台提醒可准时到达"
              : exactAlarm === "denied"
                ? "未开启 · 提醒会被系统延迟，点击去设置"
                : "检测中…"
          }
          control={
            <Switch
              checked={exactAlarm === "granted"}
              disabled={exactAlarm === "unknown"}
              onCheckedChange={() => void openExactAlarmSettings()}
              aria-label="精确闹钟权限"
            />
          }
        />
        <MobileRow
          title="电池优化白名单"
          description={
            battery === "granted"
              ? "已加入白名单 · 点击可去系统设置关闭"
              : battery === "denied"
                ? "未加入 · 厂商 ROM 可能冻结提醒，点击去设置"
                : "检测中…"
          }
          control={
            <Switch
              checked={battery === "granted"}
              disabled={battery === "unknown"}
              onCheckedChange={() => void openBatterySettings()}
              aria-label="电池优化白名单"
            />
          }
        />
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          国产 ROM 还需在「自启动 / 后台锁定」中允许本应用，这一步无法由代码替代。
        </p>
      </MobileSection>

      <div className="mb-3 flex gap-2">
        <Button className="min-h-12 flex-1" onClick={() => emitShowReminder()}>
          <BellRing className="mr-1.5 h-4 w-4" />
          预览全屏提醒
        </Button>
        <Button
          variant="outline"
          className="min-h-12 flex-1"
          onClick={sendTestNotification}
        >
          发送测试通知
        </Button>
      </div>
    </>
  );
}
