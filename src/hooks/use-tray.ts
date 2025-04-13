import { useCallback, useEffect } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion } from "@tauri-apps/api/app";

const TRAY_ID = "main-tray";

export function useTray() {
  useEffect(() => {
    setMenu();
  }, []);

  const checkTauriAndInit = async () => {
    try {
      // 尝试获取 Tauri 版本，如果失败则说明不在 Tauri 环境
      await getVersion();
    } catch (e) {
      console.log("非 Tauri 环境，跳过托盘初始化");
      throw e;
    }
  };

  const getMenu = useCallback(async () => {
    console.log("a");
    const menu = await Menu.new();

    // 创建子菜单
    const submenu = await Submenu.new({
      text: "计时控制",
      items: [
        {
          text: "暂停计时",
          action: async () => {
            invoke("pause_timer");
          },
        },
        {
          text: "重新开始",
          action: async () => {
            invoke("start_timer");
          },
        },
      ],
    });

    await menu.append(submenu);
    await menu.append(await PredefinedMenuItem.new({ item: "Separator" }));

    await menu.append(
      await MenuItem.new({
        text: "设置",
        action: async () => {
          console.log("打开设置");
          const mainWindow = await WebviewWindow.getByLabel("main");
          // mainWindow?.setDecorations(true);
          mainWindow?.show();
          mainWindow?.setFocus();
        },
      })
    );

    await menu.append(
      await PredefinedMenuItem.new({ text: "退出", item: "Quit" })
    );

    return menu;
  }, []);

  const setMenu = useCallback(async () => {
    let trayInstance: TrayIcon | null = null;

    try {
      await checkTauriAndInit();

      // 检查是否已存在托盘实例
      trayInstance = await TrayIcon.getById(TRAY_ID);
      console.log("trayInstance", trayInstance);

      trayInstance?.setMenu(await getMenu());
      // trayInstance?.setIconAsTemplate(true);
    } catch (error) {
      console.error("创建托盘失败:", error);
    }
  }, [getMenu]);
}
