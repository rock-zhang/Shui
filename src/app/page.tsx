"use client";
import Image from "next/image";
import { useEffect } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

const TRAY_ID = "app-tray";

export default function Home({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let trayInstance: TrayIcon | null = null;

    const initTray = async () => {
      try {
        // 检查是否已存在托盘实例
        trayInstance = await TrayIcon.getById(TRAY_ID);
        console.log("trayInstance", trayInstance);

        if (trayInstance) {
          return;
        }

        const menu = await Menu.new();

        // 添加菜单项
        await menu.append(
          await MenuItem.new({
            text: "call reminder",
            action: async () => {
              console.log("call reminder");
              console.log("xxxx", await invoke("call_reminder"));
            },
          })
        );

        // 添加菜单项
        await menu.append(
          await MenuItem.new({
            text: "设置",
            action: async () => {
              console.log("打开设置");
              const mainWindow = await WebviewWindow.getByLabel("main");
              console.log("mainWindow", mainWindow);

              mainWindow?.setDecorations(true);
              mainWindow?.show();
              mainWindow?.setFocus();
            },
          })
        );

        // await menu.append(PredefinedMenuItem.new({ item: "Separator" }));

        await menu.append(
          await MenuItem.new({
            text: "检查更新",
            action: () => {
              console.log("检查更新");
            },
          })
        );

        // await menu.append(await PredefinedMenuItem.new("separator"));

        await menu.append(
          await MenuItem.new({
            text: "退出",
            action: () => {
              console.log("退出应用");
            },
          })
        );

        // 创建托盘图标
        const iconPath = "./icons/tray-mac.ico";
        const icon = await resolveResource(iconPath);

        console.log("icon", icon);

        trayInstance = await TrayIcon.new({
          menu,
          icon,
          id: TRAY_ID,
          tooltip: "我的应用",
          iconAsTemplate: true,
          menuOnLeftClick: true,
        });
      } catch (error) {
        console.error("创建托盘失败:", error);
      }
    };

    initTray();

    // 清理函数
    return () => {
      if (trayInstance) {
        TrayIcon.removeById(TRAY_ID);
      }
    };
  }, []);

  return (
    <SidebarProvider open defaultOpen>
      <AppSidebar />
      <main className="flex-1">{children}</main>
    </SidebarProvider>
  );
}
