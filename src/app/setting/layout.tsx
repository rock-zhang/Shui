"use client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Toaster } from "@/components/ui/sonner";
import { usePlatform } from "@/hooks/use-platform";
import { sendReminderNotification, setupDesktopNotificationBridge } from "@/utils/notification";
import { getGeneralConfig } from "@/utils/store";
import { MobileApp } from "@/components/mobile/mobile-app";
import { detectPlatform } from "@/lib/mobile";

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

  useEffect(() => {
    const kind = detectPlatform();
    const isMobileHost = kind === "android" || kind === "ios";
    setMobile(isMobileHost);
    if (isMobileHost) return;

    // 通知里的「喝了 Xml」由 Rust 记进库，这里只订阅它的广播来刷新明细 + 播确认音。
    void setupDesktopNotificationBridge();

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
    };
  }, []);

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
    </SidebarProvider>
  );
}
