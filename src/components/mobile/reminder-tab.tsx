"use client";

import { BellRing, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  GAP_OPTIONS,
  GOLD_OPTIONS,
  emitShowReminder,
} from "@/lib/mobile";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { sendReminderNotification } from "@/utils/notification";
import { useMobileConfig } from "./config-context";
import { useNotificationPermission } from "./notification-permission-context";
import { NotificationHealthCard } from "./notification-health-card";
import { MobileRow, MobileSection, MobileTimeInput } from "./ui";
import { useI18n, WEEKDAY_SHORT_KEYS } from "@/lib/i18n";

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
function ReminderSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      {[96, 96, 96, 96, 224, 168, 180].map((height, index) => (
        <Skeleton key={index} className="rounded-2xl" style={{ height }} />
      ))}
    </div>
  );
}

export function ReminderTab() {
  const { t } = useI18n();
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
      toast.success(t("mobile.reminder.testSent"));
    } catch {
      track("test_notification_click", { success: false });
      toast.info(t("mobile.reminder.desktopPreview"));
    }
  }

  if (!hydrated) return <ReminderSkeleton label={t("mobile.reminder.loading")} />;

  // 「想收通知」与「系统允许通知」是两件事：前者是 App 偏好，后者是系统权限。
  // 两者同时成立才会真正到达，所以只在这一行做联动提示，不再单列一个开关。
  const notifBlocked = general.isNotification && permission === "denied";

  return (
    <>
      <MobileSection
        title={t("mobile.reminder.goal.title")}
        description={t("mobile.reminder.goal.description")}
        tourId="goal"
      >
        <div className="mobile-scroll-x flex gap-2 overflow-x-auto overflow-y-hidden pb-1">
          {GOLD_OPTIONS.map((value) => (
            <Chip
              key={value}
              selected={alert.gold === value}
              onClick={() => patchAlert({ gold: value })}
              label={t("mobile.reminder.goal.aria", { amount: value })}
            >
              {value} ml
            </Chip>
          ))}
        </div>
      </MobileSection>

      <MobileSection
        title={t("mobile.reminder.gap.title")}
        description={t("mobile.reminder.gap.description")}
        tourId="gap"
      >
        <div className="grid grid-cols-5 gap-1.5">
          {GAP_OPTIONS.map((value) => (
            <Chip
              key={value}
              selected={alert.gap === value}
              onClick={() => patchAlert({ gap: value })}
              sublabel={t("mobile.reminder.gap.unit")}
              label={t("mobile.reminder.gap.aria", { minutes: value })}
              className="w-full shrink px-0"
            >
              {value}
            </Chip>
          ))}
        </div>
      </MobileSection>

      <MobileSection
        title={t("mobile.reminder.weekdays.title")}
        description={t("mobile.reminder.weekdays.description")}
        tourId="weekdays"
      >
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }, (_, day) => {
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
                {t(WEEKDAY_SHORT_KEYS[day])}
              </button>
            );
          })}
        </div>
      </MobileSection>

      <MobileSection
        title={t("mobile.reminder.time.title")}
        description={t("mobile.reminder.time.description")}
      >
        <div className="flex items-center gap-2">
          <MobileTimeInput
            label={t("settings.reminder.time.start")}
            value={alert.timeStart}
            onChange={(value) => patchAlert({ timeStart: value })}
            tourId="timeStart"
          />
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("settings.reminder.time.separator")}
          </span>
          <MobileTimeInput
            label={t("settings.reminder.time.end")}
            value={alert.timeEnd}
            onChange={(value) => patchAlert({ timeEnd: value })}
            tourId="timeEnd"
          />
        </div>
      </MobileSection>

      <MobileSection
        title={t("mobile.reminder.methods.title")}
        description={t("mobile.reminder.methods.description")}
      >
        <MobileRow
          title={t("mobile.reminder.notification.title")}
          description={
            notifBlocked
              ? notifCanRequest
                ? t("mobile.reminder.notification.deniedRequestable")
                : t("mobile.reminder.notification.deniedBlocked")
              : general.isNotification
                ? t("mobile.reminder.notification.on")
                : t("mobile.reminder.notification.off")
          }
          descriptionClassName={notifBlocked ? "text-destructive" : undefined}
          control={
            <Switch
              checked={general.isNotification}
              onCheckedChange={(value) => patchGeneral({ isNotification: value })}
              aria-label={t("mobile.reminder.notification.title")}
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
                    {t("mobile.reminder.notification.allow")}
                  </>
                ) : (
                  <>
                    <Settings className="mr-1.5 h-4 w-4" />
                    {t("mobile.reminder.notification.openSettings")}
                  </>
                )}
              </Button>
            ) : undefined
          }
        />
        <MobileRow
          title={t("mobile.reminder.fullscreen.title")}
          description={t("mobile.reminder.fullscreen.description")}
          control={
            <Switch
              checked={general.isFullScreen}
              onCheckedChange={(value) => patchGeneral({ isFullScreen: value })}
              aria-label={t("mobile.reminder.fullscreen.title")}
            />
          }
        />
        <MobileRow
          title={t("mobile.reminder.sound.title")}
          description={t("mobile.reminder.sound.description")}
          control={
            <Switch
              checked={general.isSound}
              onCheckedChange={(value) => patchGeneral({ isSound: value })}
              aria-label={t("mobile.reminder.sound.title")}
            />
          }
        />
        <MobileRow
          title={t("mobile.reminder.pause.title")}
          description={t("mobile.reminder.pause.description")}
          control={
            <Switch
              checked={general.isPaused}
              onCheckedChange={(value) => patchGeneral({ isPaused: value })}
              aria-label={t("mobile.reminder.pause.title")}
            />
          }
        />
      </MobileSection>

      <MobileSection
        title={t("mobile.reminder.quiet.title")}
        description={t("mobile.reminder.quiet.description")}
      >
        <MobileRow
          title={t("mobile.reminder.quiet.toggle")}
          description={t("mobile.reminder.quiet.toggleDescription")}
          control={
            <Switch
              checked={general.quietEnabled}
              onCheckedChange={(value) => patchGeneral({ quietEnabled: value })}
              aria-label={t("mobile.reminder.quiet.toggle")}
            />
          }
        />
        {general.quietEnabled && (
          <div className="flex items-center gap-2 pb-1 pt-2">
            <MobileTimeInput
              label={t("mobile.reminder.quiet.start")}
              value={general.quietStart}
              onChange={(value) => patchGeneral({ quietStart: value })}
            />
            <span className="shrink-0 text-xs text-muted-foreground">
              {t("settings.reminder.time.separator")}
            </span>
            <MobileTimeInput
              label={t("mobile.reminder.quiet.end")}
              value={general.quietEnd}
              onChange={(value) => patchGeneral({ quietEnd: value })}
            />
          </div>
        )}
      </MobileSection>

      <NotificationHealthCard />

      {/* 两列等宽网格 + 允许换行：英文文案比中文长得多，flex-1 搭配
          Button 自带的 whitespace-nowrap/shrink-0 会把整行撑出屏幕，
          导致页面可以左右滑动。这里锁定列宽并让文字折行。 */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button
          className="h-auto min-h-12 min-w-0 whitespace-normal px-2.5 py-2 text-center text-[13px] leading-tight"
          onClick={() => {
            track("preview_reminder_click");
            emitShowReminder();
          }}
        >
          <BellRing className="h-4 w-4 shrink-0" />
          <span className="min-w-0">{t("mobile.reminder.preview")}</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-12 min-w-0 whitespace-normal px-2.5 py-2 text-center text-[13px] leading-tight"
          onClick={sendTestNotification}
        >
          <span className="min-w-0">{t("mobile.reminder.testNotification")}</span>
        </Button>
      </div>
    </>
  );
}
