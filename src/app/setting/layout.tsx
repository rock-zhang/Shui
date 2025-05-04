"use client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Toaster } from "@/components/ui/sonner";
import { platform } from "@tauri-apps/plugin-os";
import { PLATFORM_OS } from "@/lib/constants";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isMacOS, setIsMacOS] = useState(false);

  useEffect(() => {
    const unlisten = listen("timer-complete", (event) => {
      console.log("Timer completed", event);
      invoke("call_reminder");
      // 这里可以添加倒计时结束后的处理逻辑
    });

    // 检查操作系统
    const currentPlatform = platform();
    console.log("currentPlatform", currentPlatform);
    setIsMacOS(currentPlatform === PLATFORM_OS.MACOS);

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
      <div
        data-tauri-drag-region
        className="absolute top-0 left-0 right-0 h-8"
      />
      <AppSidebar />
      <main
        className={`flex-1 p-10 ${isMacOS ? "pt-8" : "pt-0"} overflow-y-auto`}
      >
        {children}
      </main>
      <Toaster />
    </SidebarProvider>
  );
}
