"use client";

import { BellRing, Settings } from "lucide-react";
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
import { track } from "@/lib/analytics";
import { sendReminderNotification } from "@/utils/notification";
import { useMobileConfig } from "./config-context";
import { useNotificationPermission } from "./notification-permission-context";
import { NotificationHealthCard } from "./notification-health-card";
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
  // 通知权限由 NotificationPermissionProvider 统一持有：今日 tab 的提示卡和
  // 这里的红字读同一份状态，切回前台也只查一次系统。
  const {
    permission,
    canRequest: notifCanRequest,
    request: requestNotification,
  } = useNotificationPermission();

  const toggleWeekday = (day: number) => {
    const weekdays = alert.weekdays ?? [];
    patchAlert({
      weekdays: weekdays.includes(day)
        ? weekdays.filter((value) => value !== day)
        : [...weekdays, day].sort((a, b) => a - b),
    });
  };

  async function sendTestNotification() {
    try {
      await sendReminderNotification();
      track("test_notification_click", { success: true });
      toast.success("测试通知已发送");
    } catch {
      track("test_notification_click", { success: false });
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
        tourId="goal"
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
        tourId="gap"
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

      <MobileSection
        title="重复"
        description="不选择任何一天则每天提醒"
        tourId="weekdays"
      >
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
            tourId="timeStart"
          />
          <span className="shrink-0 text-xs text-muted-foreground">至</span>
          <MobileTimeInput
            label="结束时间"
            value={alert.timeEnd}
            onChange={(value) => patchAlert({ timeEnd: value })}
            tourId="timeEnd"
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
            notifBlocked
              ? notifCanRequest
                ? "通知权限未开启，锁屏与后台的提醒收不到"
                : "通知权限已被系统拒绝，需到系统设置里手动开启"
              : general.isNotification
                ? "锁屏或退到后台也能到达，通知里可直接记一杯水"
                : "已关闭，锁屏与后台不再提醒"
          }
          descriptionClassName={notifBlocked ? "text-destructive" : undefined}
          control={
            <Switch
              checked={general.isNotification}
              onCheckedChange={(value) => patchGeneral({ isNotification: value })}
              aria-label="系统通知"
            />
          }
          // 行内文字链接的点击区只有十来个像素高，在开关旁边根本不像能点。
          // 未授权是「这个开关此刻是假的」这种状态，必须给一个实心按钮。
          footer={
            notifBlocked ? (
              <Button
                variant="destructive"
                className="min-h-10 w-full"
                onClick={() => void requestNotification()}
              >
                {notifCanRequest ? (
                  <>
                    <BellRing className="mr-1.5 h-4 w-4" />
                    允许通知
                  </>
                ) : (
                  <>
                    <Settings className="mr-1.5 h-4 w-4" />
                    去系统设置开启
                  </>
                )}
              </Button>
            ) : undefined
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

      <NotificationHealthCard />

      <div className="mb-3 flex gap-2">
        <Button
          className="min-h-12 flex-1"
          onClick={() => {
            track("preview_reminder_click");
            emitShowReminder();
          }}
        >
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
