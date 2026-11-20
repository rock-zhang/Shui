"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import {
  readOnboardingSeen,
  type OnboardingOutcome,
} from "@/lib/onboarding";
import {
  installErrorTracking,
  screenView,
  syncAnalyticsProperties,
  track,
} from "@/lib/analytics";
import { MOBILE_TABS, MobileTabBar } from "./mobile-tab-bar";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useUpdate } from "@/components/update-provider";
import { MobileConfigProvider, useMobileConfig } from "./config-context";
import { NotificationPermissionProvider } from "./notification-permission-context";
import { TodayTab } from "./today-tab";
import { ReminderTab } from "./reminder-tab";
import { DataTab } from "./data-tab";
import { MeTab } from "./me-tab";
import { FullscreenReminder } from "./fullscreen-reminder";
import { NotificationSetupGuide } from "./notification-setup-guide";
import { OnboardingTour } from "./onboarding-tour";
import { MissedAlarmDialog } from "./missed-alarm-dialog";

const HEADERS: Record<
  MobileTabId,
  { titleKey: MessageKey; subtitleKey: MessageKey }
> = {
  today: {
    titleKey: "mobile.tab.today",
    subtitleKey: "mobile.header.today.subtitle",
  },
  reminder: {
    titleKey: "mobile.tab.reminder",
    subtitleKey: "mobile.header.reminder.subtitle",
  },
  data: {
    titleKey: "mobile.tab.data",
    subtitleKey: "mobile.header.data.subtitle",
  },
  me: {
    titleKey: "mobile.tab.me",
    subtitleKey: "mobile.header.me.subtitle",
  },
};

const TAB_STORAGE_KEY = "shui:mobile-tab";
const TAB_IDS = MOBILE_TABS.map(({ id }) => id);

/** 顶栏日期格式：跨天后要跟着刷新，抽成常量避免两处写法不一致。 */
const DATE_LABEL_FORMAT: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  weekday: "long",
};

/** 全屏提醒的触发来源：定时到点、点通知主体、提醒页预览。 */
export type ReminderTrigger = "alarm" | "notification_click" | "preview";

/** 读取上次停留的 tab；非法值或存储不可用时回落到「今日」。 */
function readStoredTab(): MobileTabId {
  try {
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (saved && (TAB_IDS as string[]).includes(saved)) return saved as MobileTabId;
  } catch {
    // 隐私模式 / 存储被禁用时忽略。
  }
  return "today";
}

/**
 * 原生提醒事件桥接。
 *
 * 必须放在 MobileConfigProvider 内部：「全屏提醒」关掉后，系统通知与定时器照常
 * 到达（统计、账本都照常记），但不再弹出全屏页。此前这个开关只写进配置、没有
 * 任何地方消费，关掉后前台照样弹全屏——界面在骗人。
 */
function ReminderEvents({
  openReminder,
}: {
  openReminder: (trigger: ReminderTrigger) => void;
}) {
  const { isTauri } = usePlatform();
  const { general } = useMobileConfig();
  // 回调不在渲染闭包里，用 ref 取最新值，避免改配置时重绑所有原生监听。
  const fullScreen = useRef(general.isFullScreen);
  fullScreen.current = general.isFullScreen;

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

    const remind = (trigger: ReminderTrigger) => {
      if (fullScreen.current) openReminder(trigger);
    };

    // `mobile-reminder` is emitted by the Android alarm bridge; `timer-complete`
    // keeps the desktop timer working when the mobile shell is previewed there.
    bind("mobile-reminder", () => {
      // 原生闹钟 / 通知唤醒 App 时开启会话，让通知这一路也计入提醒统计。
      invoke("begin_mobile_reminder").catch(() => {});
      remind("alarm");
    });
    bind("timer-complete", () => remind("alarm"));
    // A drink recorded from a notification action happens on the native side.
    bind("drink-recorded-from-notification", emitRefresh);

    return () => disposers.forEach((dispose) => dispose());
  }, [isTauri, openReminder]);

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
          if (fullScreen.current) openReminder("notification_click");
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
  }, [isTauri, openReminder]);

  return null;
}

type ActiveReminder = { session: string | null; trigger: ReminderTrigger };

export function MobileApp() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<MobileTabId>("today");
  const [activeReminder, setActiveReminder] = useState<ActiveReminder | undefined>(
    undefined
  );
  // 首启引导走完后才挂载通知三步引导，避免两个浮层同帧抢首屏。
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingCleared, setOnboardingCleared] = useState(false);
  const [notificationGuideReady, setNotificationGuideReady] = useState(false);
  const tabRef = useRef<MobileTabId>("today");
  const { markSeen, latestVersion } = useUpdate();
  // 进「我」tab 就算看过：灭掉 tab 红点，但版本行的「新版本 x.y.z」
  // 标记保留到真正装上，避免红点常驻变成噪音。
  //
  // 依赖 latestVersion 同理：结果落定前 markSeen 会因「还没数据」空转，
  // 之后检查出更新又会在用户正看着的 tab 上亮红点。
  useEffect(() => {
    if (tab === "me" && latestVersion) markSeen();
  }, [tab, markSeen, latestVersion]);
  // 系统栏底色 / 图标明暗跟随 App 内主题，避免亮色系统下出现紫色状态栏。
  useSystemBars();
  const scrollNodes = useRef<Partial<Record<MobileTabId, HTMLDivElement | null>>>(
    {}
  );
  const scrollOffsets = useRef<Partial<Record<MobileTabId, number>>>({});

  // 从系统设置改权限返回时，Android 可能重建 Activity（部分 ROM 甚至会重启
  // 进程来应用权限变更），WebView 重新加载会让整棵 React 树重挂载，内存里的
  // tab 就退回「今日」——看起来像 App 自己重启了。落到 localStorage 后恢复，
  // 重挂载在视觉上完全无感。
  // 用 effect 而非 useState 初始值：静态导出的 HTML 里必须是「今日」，
  // 否则首帧 hydration 与服务端不一致。
  useEffect(() => {
    const initial = readStoredTab();
    tabRef.current = initial;
    setTab(initial);
    // 首帧挂载完成：记录初始 tab、安装 JS 异常捕获并同步一次用户属性。
    track("app_ready", { initial_tab: initial });
    screenView(initial);
    installErrorTracking();
    syncAnalyticsProperties();
  }, []);

  const changeTab = useCallback((next: MobileTabId) => {
    const previous = tabRef.current;
    if (previous !== next) {
      screenView(next, previous, true);
      tabRef.current = next;
      // 数据 tab 常驻挂载，切回来不会重新读取统计；进入时主动刷新一次。
      if (next === "data") emitRefresh();
    }
    setTab(next);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // 存储不可用时仅内存生效，不影响本次切换。
    }
  }, []);

  // Every tab stays mounted so its state (inputs, previews, scroll) survives
  // a switch. Restore the offset explicitly because WebViews may reset it
  // while a container is display:none.
  useLayoutEffect(() => {
    const node = scrollNodes.current[tab];
    if (node) node.scrollTop = scrollOffsets.current[tab] ?? 0;
  }, [tab]);

  // 全新安装：先切到「提醒」页再开始引导，高亮目标必须在当前可见 tab 里。
  useEffect(() => {
    if (readOnboardingSeen()) {
      setOnboardingCleared(true);
      return;
    }
    changeTab("reminder");
    setOnboardingOpen(true);
  }, [changeTab]);

  const finishOnboarding = useCallback((outcome: OnboardingOutcome) => {
    setOnboardingOpen(false);
    // 只有走完，或连按三次跳过后才放行通知引导；单次跳过留到下次启动。
    if (outcome === "completed" || outcome === "limit") {
      setOnboardingCleared(true);
    }
  }, []);

  // 引导结束/放弃后留出关闭动画时间，再让通知引导自动弹。
  useEffect(() => {
    if (!onboardingCleared) return;
    const timer = window.setTimeout(() => setNotificationGuideReady(true), 400);
    return () => window.clearTimeout(timer);
  }, [onboardingCleared]);

  const openReminder = useCallback(
    (trigger: ReminderTrigger) => setActiveReminder({ session: null, trigger }),
    []
  );

  // "预览提醒" from the reminder tab opens the very same full-screen channel.
  // 用户主动预览不看「全屏提醒」开关，那个开关管的是被动提醒。
  useEffect(() => onShowReminder(() => openReminder("preview")), [openReminder]);

  const header = HEADERS[tab];
  /**
   * 顶栏日期不能只在 render 时现算：跨天后如果没有其他状态变化，
   * 组件不会重新渲染，日期就停在昨天。这里用轮询 + 回前台补查，
   * setState 传函数并在同值时返回旧引用，React 会跳过重渲染。
   */
  const [dateLabel, setDateLabel] = useState(() =>
    new Date().toLocaleDateString(locale, DATE_LABEL_FORMAT)
  );
  useEffect(() => {
    const update = () => {
      const next = new Date().toLocaleDateString(locale, DATE_LABEL_FORMAT);
      setDateLabel((previous) => (previous === next ? previous : next));
    };
    const timer = window.setInterval(update, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("shui:foreground", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("shui:foreground", update);
    };
  }, [locale]);

  return (
    <MobileConfigProvider>
      <NotificationPermissionProvider>
        <ReminderEvents openReminder={openReminder} />
        <div className="mobile-root flex flex-col overflow-hidden bg-background text-foreground">
          <header className="shrink-0 px-5 pb-3 pt-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Shui · {t("mobile.brand")}
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
                {t(header.titleKey)}
              </h1>
              <span className="shrink-0 text-xs text-muted-foreground">
                {dateLabel}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t(header.subtitleKey)}
            </p>
          </header>

          <main className="relative min-h-0 flex-1">
            {MOBILE_TABS.map(({ id }) => (
              <div
                key={id}
                ref={(node) => {
                  scrollNodes.current[id] = node;
                }}
                aria-label={t(HEADERS[id].titleKey)}
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

          {notificationGuideReady && <NotificationSetupGuide />}
          <MissedAlarmDialog />

          {onboardingOpen && (
            <OnboardingTour open onDone={finishOnboarding} />
          )}

          <MobileTabBar active={tab} onChange={changeTab} />
          <Toaster
            position="top-center"
            richColors
            // edge-to-edge 下状态栏透明盖在内容上，sonner 默认 top 偏移
            // （桌面 24px / 移动 16px）不感知安全区，toast 会顶进状态栏。
            // 只抬高 top，左右仍交给 sonner 默认值，避免移动端 center 布局被挤窄。
            offset={{ top: "calc(24px + env(safe-area-inset-top, 0px))" }}
            mobileOffset={{ top: "calc(16px + env(safe-area-inset-top, 0px))" }}
          />

          {activeReminder !== undefined && (
            <FullscreenReminder
              session={activeReminder.session}
              trigger={activeReminder.trigger}
              onClose={() => {
                setActiveReminder(undefined);
                emitRefresh();
              }}
            />
          )}
        </div>
      </NotificationPermissionProvider>
    </MobileConfigProvider>
  );
}
