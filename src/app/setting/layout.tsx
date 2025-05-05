"use client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Toaster } from "@/components/ui/sonner";
import { usePlatform } from "@/hooks/use-platform";
import {
  isSetFullScreen,
  sendReminderNotification,
} from "@/utils/notification";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { isMacOS } = usePlatform();

  useEffect(() => {
    const unlisten = listen("timer-complete", async (event) => {
      console.log("Timer completed", event);

      if (await isSetFullScreen()) {
        invoke("call_reminder");
      } else {
        sendReminderNotification();
        invoke("reset_timer");
      }
      // 这里可以添加倒计时结束后的处理逻辑
    });

    return () => {
      unlisten.then((unsubscribe) => unsubscribe());
    };
  }, []);

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
