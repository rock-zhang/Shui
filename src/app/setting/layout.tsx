"use client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Toaster } from "@/components/ui/sonner";
import { usePlatform } from "@/hooks/use-platform";
import { useTray } from "@/hooks/use-tray";
import { sendReminderNotification, setupDesktopNotificationBridge } from "@/utils/notification";
import { getGeneralConfig } from "@/utils/store";
import { MobileApp } from "@/components/mobile/mobile-app";
import { DesktopOnboardingTour } from "@/components/desktop/onboarding-tour";
import { StreakMilestoneWatcher } from "@/components/streak-milestone";
import { readDesktopOnboardingSeen } from "@/lib/desktop-onboarding";
import { detectPlatform } from "@/lib/mobile";
import {
  installErrorTracking,
  screenView,
  syncAnalyticsProperties,
  track,
} from "@/lib/analytics";

/**
 * 托盘菜单是应用级的，挂在设置区布局里初始化一次即可。
 *
 * 快捷杯量在「饮水记录」页编辑，若只在概览 / 提醒页初始化托盘，
 * 其它页面保存后托盘仍显示旧档位；统一挂在布局里，配合 `emitRefresh` 才能做到改完即生效。
 */
function DesktopTray() {
  useTray();
  return null;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { isMacOS } = usePlatform();
  // Belt and braces: Tauri mobile may resolve / or /setting/ as the entry URL.
  // Both routes must land on the same 4-tab shell. Desktop starts as `false`
  // so its first frame is byte-for-byte the same as before this change.
  const [mobile, setMobile] = useState(false);
  // 首帧还不知道宿主类型时必须等检测完成再记 app_open，
  // 否则移动端会先误报一条桌面启动。
  const [ready, setReady] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const tourBooted = useRef(false);
  const tourPending = useRef(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const kind = detectPlatform();
    const isMobileHost = kind === "android" || kind === "ios";
    setMobile(isMobileHost);
    setReady(true);
    if (isMobileHost) return;

    // 通知里的「+Xml」由 Rust 记进库，这里只订阅它的广播来刷新明细 + 播确认音。
    void setupDesktopNotificationBridge();

    // 点通知主体唤回窗口后直达「饮水记录」页：Rust 只发事件，路由跳转留在前端，
    // 避免在 Rust 里改窗口 URL 导致整页重载、丢掉 WebView 里的运行时状态。
    const unlistenOpenHistory = listen("shui:open-drink-history", () => {
      router.push("/setting/history/");
    });

    const unlisten = listen("timer-complete", async (event) => {
      console.log("Timer completed", event);

      if ((await getGeneralConfig()).isFullScreen) {
        invoke("call_reminder");
      } else {
        sendReminderNotification();
        invoke("reset_timer");
      }
    }).then((unsubscribe) => {
      window.__SHUI_NATIVE_SMOKE__?.timerReady();
      return unsubscribe;
    });

    return () => {
      unlisten.then((unsubscribe) => unsubscribe());
      unlistenOpenHistory.then((unsubscribe) => unsubscribe());
    };
  }, []);

  // 桌面首次启动：先切到「提醒」页，再高亮真实设置项。只在挂载后判定一次，
  // 用户之后自行导航时不再被拉回引导页。
  useEffect(() => {
    if (!ready || mobile || tourBooted.current) return;
    tourBooted.current = true;
    if (readDesktopOnboardingSeen()) return;
    if (pathname !== "/setting/reminder/") {
      tourPending.current = true;
      router.replace("/setting/reminder/");
    } else {
      setTourOpen(true);
    }
  }, [ready, mobile, pathname, router]);

  useEffect(() => {
    if (!tourPending.current || pathname !== "/setting/reminder/") return;
    tourPending.current = false;
    setTourOpen(true);
  }, [pathname]);

  useEffect(() => {
    if (!ready || mobile) return;
    track("app_open", { launch_source: "icon", cold_start: true });
    installErrorTracking();
    syncAnalyticsProperties();
  }, [ready, mobile]);

  useEffect(() => {
    if (!ready || mobile) return;
    // /setting → overview，/setting/reminder → reminder
    const screen =
      pathname.replace(/^\/setting\/?/, "").replace(/\/$/, "") || "overview";
    screenView(screen);
  }, [pathname, ready, mobile]);

  if (mobile) return <MobileApp />;

  return (
    <SidebarProvider
      open
      defaultOpen
      className="h-screen overflow-hidden"
      onContextMenu={(e) => {
        if (process.env.NODE_ENV === "production") e.preventDefault();
      }}
    >
      {isMacOS && (
        <div
          data-tauri-drag-region
          className="absolute top-0 left-0 right-0 h-8"
        />
      )}
      <AppSidebar />
      <main className="flex-1 p-10 pt-8 overflow-y-auto">{children}</main>
      <Toaster />
      <DesktopTray />
      <StreakMilestoneWatcher />
      <DesktopOnboardingTour open={tourOpen} onDone={() => setTourOpen(false)} />
    </SidebarProvider>
  );
}
