"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Toaster } from "@/components/ui/sonner";
import { usePlatform } from "@/hooks/use-platform";
import { useSystemBars } from "@/hooks/use-system-bars";
import {
  emitRefresh,
  onCheckReminder,
  onShowReminder,
  type MobileTabId,
} from "@/lib/mobile";
import { MOBILE_TABS, MobileTabBar } from "./mobile-tab-bar";
import { MobileConfigProvider } from "./config-context";
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
  // 系统栏底色 / 图标明暗跟随 App 内主题，避免亮色系统下出现紫色状态栏。
  useSystemBars();
  const scrollNodes = useRef<Partial<Record<MobileTabId, HTMLDivElement | null>>>(
    {}
  );
  const scrollOffsets = useRef<Partial<Record<MobileTabId, number>>>({});

  // Every tab stays mounted so its state (inputs, previews, scroll) survives
  // a switch. Restore the offset explicitly because WebViews may reset it
  // while a container is display:none.
  useLayoutEffect(() => {
    const node = scrollNodes.current[tab];
    if (node) node.scrollTop = scrollOffsets.current[tab] ?? 0;
  }, [tab]);

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

  // 通知主体点击：Kotlin 记下 pending 标志并让 WebView 派发 check 事件。
  // 冷启动时该事件可能早于 React 挂载，因此启动时与恢复前台时各查一次；
  // 标志由 Rust 侧消费，保证一次点击只弹一次。
  useEffect(() => {
    if (!isTauri) return;
    const consume = () => {
      invoke<boolean>("consume_pending_reminder")
        .then((pending) => {
          if (!pending) return;
          invoke("begin_mobile_reminder").catch(() => {});
          setReminderSession(null);
        })
        .catch(() => {
          // 桌面预览没有这个命令。
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") consume();
    };
    const stop = onCheckReminder(consume);
    document.addEventListener("visibilitychange", onVisible);
    consume();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isTauri]);

  const header = HEADERS[tab];
  const dateLabel = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <MobileConfigProvider>
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

        <main className="relative min-h-0 flex-1">
          {MOBILE_TABS.map(({ id }) => (
            <div
              key={id}
              ref={(node) => {
                scrollNodes.current[id] = node;
              }}
              aria-label={HEADERS[id].title}
              aria-hidden={tab !== id}
              style={{ display: tab === id ? "block" : "none" }}
              onScroll={(event) => {
                if (tab === id) {
                  scrollOffsets.current[id] = event.currentTarget.scrollTop;
                }
              }}
              className="mobile-scroll absolute inset-0 overflow-y-auto px-4 pb-6"
            >
              {id === "today" && <TodayTab />}
              {id === "reminder" && <ReminderTab />}
              {id === "data" && <DataTab />}
              {id === "me" && <MeTab />}
            </div>
          ))}
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
    </MobileConfigProvider>
  );
}
