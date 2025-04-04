"use client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useEffect(() => {
    const unlisten = listen("timer-complete", (event) => {
      console.log("Timer completed", event);
      invoke("call_reminder");
      // 这里可以添加倒计时结束后的处理逻辑
    });

    return () => {
      unlisten.then((unsubscribe) => unsubscribe());
    };
  }, []);

  return (
    <SidebarProvider open defaultOpen className="h-screen overflow-hidden">
      <AppSidebar />
      <main className="flex-1 p-10 overflow-y-auto">{children}</main>
    </SidebarProvider>
  );
}
