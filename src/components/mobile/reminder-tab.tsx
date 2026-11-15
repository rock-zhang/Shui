"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { BatteryCharging, BellRing, ShieldCheck } from "lucide-react";
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
import { MobileRow, MobileSection, MobileTimeInput } from "./ui";

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
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">(
    "unknown"
  );
  const [exactAlarm, setExactAlarm] = useState<"unknown" | "granted" | "denied">(
    "unknown"
  );

  useEffect(() => {
    let cancelled = false;
    isPermissionGranted()
      .then((granted) => !cancelled && setPermission(granted ? "granted" : "denied"))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Android 12+ 精确闹钟是独立权限；用户从系统设置返回后自动复查。
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      invoke<boolean>("is_exact_alarm_granted")
        .then((granted) => {
          if (!cancelled) setExactAlarm(granted ? "granted" : "denied");
        })
        .catch(() => {
          // 桌面预览 / Android 11 以下无此权限概念，按已满足处理。
          if (!cancelled) setExactAlarm("granted");
        });
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const toggleWeekday = (day: number) => {
    const weekdays = alert.weekdays ?? [];
    patchAlert({
      weekdays: weekdays.includes(day)
        ? weekdays.filter((value) => value !== day)
        : [...weekdays, day].sort((a, b) => a - b),
    });
  };

  async function ensurePermission() {
    try {
      if (await isPermissionGranted()) {
        setPermission("granted");
        toast.success("通知权限已开启");
        return;
      }
      const result = await requestPermission();
      const granted = result === "granted";
      setPermission(granted ? "granted" : "denied");
      toast[granted ? "success" : "error"](
        granted ? "通知权限已开启" : "未获得通知权限，请到系统设置中开启"
      );
    } catch {
      toast.info("当前为桌面预览，权限由 Android 系统管理");
    }
  }

  async function openExactAlarmSettings() {
    try {
      await invoke("open_exact_alarm_settings");
      toast.info("请允许「闹钟和提醒」权限，返回后状态会自动刷新");
    } catch {
      toast.info("请在 系统设置 → 应用 → Shui → 闹钟和提醒 中手动开启");
    }
  }

  async function openBatterySettings() {
    const manual = "请到 系统设置 → 应用 → Shui → 电池 中关闭电池优化";
    try {
      const result = await invoke<string>("open_battery_settings");
      if (result === "already") {
        toast.success("已在电池优化白名单中，无需重复设置");
      } else if (result === "unavailable") {
        toast.info(`当前系统未开放该设置页，${manual}`);
      } else {
        toast.info("已打开系统设置，请把 Shui 设为「不优化」");
      }
    } catch {
      toast.info(manual);
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
          description="锁屏或退到后台也能到达，通知里可直接记一杯水"
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
        description="Android 会冻结后台页面，提醒必须由系统闹钟驱动"
      >
        <MobileRow
          title="通知权限"
          description={
            permission === "granted"
              ? "已开启"
              : permission === "denied"
                ? "未开启，后台提醒无法送达"
                : "点击右侧检查"
          }
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={ensurePermission}
            >
              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
              检查
            </Button>
          }
        />
        <MobileRow
          title="精确闹钟权限"
          description={
            exactAlarm === "granted"
              ? "已开启，后台提醒可准时到达"
              : exactAlarm === "denied"
                ? "未开启，后台提醒会被系统延迟或不触发"
                : "点击右侧检查"
          }
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={openExactAlarmSettings}
            >
              <BellRing className="mr-1 h-3.5 w-3.5" />
              {exactAlarm === "denied" ? "去开启" : "检查"}
            </Button>
          }
        />
        <MobileRow
          title="电池优化白名单"
          description="避免厂商 ROM 冻结定时提醒"
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={openBatterySettings}
            >
              <BatteryCharging className="mr-1 h-3.5 w-3.5" />
              去设置
            </Button>
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
