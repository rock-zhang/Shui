"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Toaster } from "@/components/ui/sonner";
import { usePlatform } from "@/hooks/use-platform";
import {
  emitRefresh,
  onShowReminder,
  type MobileTabId,
} from "@/lib/mobile";
import { MobileTabBar } from "./mobile-tab-bar";
import { TodayTab } from "./today-tab";
import { ReminderTab } from "./reminder-tab";
import { DataTab } from "./data-tab";
import { MeTab } from "./me-tab";
import { FullscreenReminder } from "./fullscreen-reminder";

const HEADERS: Record<MobileTabId, { title: string; subtitle: string }> = {
  today: { title: "今日", subtitle: "少量多次，慢慢喝就好" },
  reminder: { title: "提醒", subtitle: "设定属于你的喝水节奏" },
  data: { title: "数据", subtitle: "看见每一天的坚持" },
  me: { title: "我的", subtitle: "偏好、备份与关于" },
};

export function MobileApp() {
  const [tab, setTab] = useState<MobileTabId>("today");
  const [reminderSession, setReminderSession] = useState<string | null | undefined>(
    undefined
  );
  const { isTauri } = usePlatform();

  useEffect(() => {
    if (!isTauri) return;
    const disposers: Array<() => void> = [];
    const bind = (event: string, handler: () => void) => {
      listen(event, handler)
        .then((unlisten) => disposers.push(unlisten))
        .catch(() => {
          // Browser preview has no native event bus.
        });
    };

    // `mobile-reminder` is emitted by the Android alarm bridge; `timer-complete`
    // keeps the desktop timer working when the mobile shell is previewed there.
    bind("mobile-reminder", () => {
      // 原生闹钟 / 通知唤醒 App 时开启会话，让通知这一路也计入提醒统计。
      invoke("begin_mobile_reminder").catch(() => {});
      setReminderSession(null);
    });
    bind("timer-complete", () => setReminderSession(null));
    // A drink recorded from a notification action happens on the native side.
    bind("drink-recorded-from-notification", emitRefresh);

    return () => disposers.forEach((dispose) => dispose());
  }, [isTauri]);

  // "预览提醒" from the reminder tab opens the very same full-screen channel.
  useEffect(
    () => onShowReminder(() => setReminderSession(null)),
    []
  );

  const header = HEADERS[tab];
  const dateLabel = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div className="mobile-root flex flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 px-5 pb-3 pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Shui · 喝水提醒
        </p>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            {header.title}
          </h1>
          <span className="shrink-0 text-xs text-muted-foreground">
            {dateLabel}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {header.subtitle}
        </p>
      </header>

      <main
        key={tab}
        className="mobile-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-6"
      >
        {tab === "today" && <TodayTab />}
        {tab === "reminder" && <ReminderTab />}
        {tab === "data" && <DataTab />}
        {tab === "me" && <MeTab />}
      </main>

      <MobileTabBar active={tab} onChange={setTab} />
      <Toaster position="top-center" richColors />

      {reminderSession !== undefined && (
        <FullscreenReminder
          session={reminderSession}
          onClose={() => {
            setReminderSession(undefined);
            emitRefresh();
          }}
        />
      )}
    </div>
  );
}
