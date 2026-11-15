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
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_ALERT,
  DEFAULT_GENERAL,
  GAP_OPTIONS,
  GOLD_OPTIONS,
  WEEKDAY_LABELS,
  emitShowReminder,
  readConfig,
  rescheduleReminders,
  writeConfig,
  type AlertConfig,
  type GeneralConfig,
} from "@/lib/mobile";
import { cn } from "@/lib/utils";
import { sendReminderNotification } from "@/utils/notification";
import { MobileRow, MobileSection } from "./ui";

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium tabular-nums transition-colors",
        selected
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function ReminderTab() {
  const [alert, setAlert] = useState<AlertConfig>(DEFAULT_ALERT);
  const [general, setGeneral] = useState<GeneralConfig>(DEFAULT_GENERAL);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">(
    "unknown"
  );

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
    isPermissionGranted()
      .then((granted) => !cancelled && setPermission(granted ? "granted" : "denied"))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(key: "alert" | "general", value: AlertConfig | GeneralConfig) {
    try {
      await writeConfig(key, value);
      await rescheduleReminders();
    } catch (failure) {
      console.error("保存提醒配置失败", failure);
      toast.error("设置未能保存，请重试");
    }
  }

  const patchAlert = (patch: Partial<AlertConfig>) => {
    const next = { ...alert, ...patch };
    setAlert(next);
    void persist("alert", next);
  };

  const patchGeneral = (patch: Partial<GeneralConfig>) => {
    const next = { ...general, ...patch };
    setGeneral(next);
    void persist("general", next);
  };

  const toggleWeekday = (day: number) => {
    const weekdays = alert.weekdays ?? [];
    patchAlert({
      weekdays: weekdays.includes(day)
        ? weekdays.filter((value) => value !== day)
        : [...weekdays, day].sort(),
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

  async function openBatterySettings() {
    try {
      await invoke("open_battery_settings");
    } catch {
      toast.info("请到 系统设置 → 应用 → 电池 中关闭本应用的电池优化");
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

  return (
    <>
      <MobileSection
        title="每日目标"
        description="达成目标后不再重复提醒，建议不低于 1500ml"
      >
        <div className="mobile-scroll flex gap-2 overflow-x-auto pb-1">
          {GOLD_OPTIONS.map((value) => (
            <Chip
              key={value}
              selected={alert.gold === value}
              onClick={() => patchAlert({ gold: value })}
            >
              {value} ml
            </Chip>
          ))}
        </div>
      </MobileSection>

      <MobileSection title="提醒间隔" description="按你设定的节奏循环提醒">
        <div className="flex gap-2">
          {GAP_OPTIONS.map((value) => (
            <Chip
              key={value}
              selected={alert.gap === value}
              onClick={() => patchAlert({ gap: value })}
            >
              {value}′
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
          <input
            type="time"
            aria-label="开始时间"
            value={alert.timeStart}
            onChange={(event) => patchAlert({ timeStart: event.target.value })}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm"
          />
          <span className="shrink-0 text-xs text-muted-foreground">至</span>
          <input
            type="time"
            aria-label="结束时间"
            value={alert.timeEnd}
            onChange={(event) => patchAlert({ timeEnd: event.target.value })}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm"
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
          description="复用桌面版彩虹渐变提醒页，30 秒倒计时"
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

      {/* Mobile equivalent of the desktop app whitelist + lock-screen pause. */}
      <MobileSection
        title="勿扰时段"
        description="对应桌面端「应用白名单 / 锁屏暂停」：在该时段内不发送提醒"
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
            <input
              type="time"
              aria-label="勿扰开始时间"
              value={general.quietStart}
              onChange={(event) => patchGeneral({ quietStart: event.target.value })}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm"
            />
            <span className="shrink-0 text-xs text-muted-foreground">至</span>
            <input
              type="time"
              aria-label="勿扰结束时间"
              value={general.quietEnd}
              onChange={(event) => patchGeneral({ quietEnd: event.target.value })}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm"
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

      <MobileSection title="桌面能力在手机上的对应">
        <p className="text-xs leading-5 text-muted-foreground">
          托盘倒计时 → 今日页「提醒节奏」；全局快捷键 → 通知快捷操作；
          开机自启 → 系统闹钟开机重建；应用白名单 / 锁屏暂停 → 勿扰时段与手动暂停；
          应用内自动更新 → 应用商店。桌面「已安装应用列表」涉及敏感权限，移动端不采集。
        </p>
      </MobileSection>
    </>
  );
}
