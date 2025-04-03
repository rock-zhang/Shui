import { useEffect } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion } from "@tauri-apps/api/app";

const TRAY_ID = "app-tray";

const menu = async () => {
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

  return menu;
};

export function useTray() {
  useEffect(() => {
    const checkTauriAndInit = async () => {
      try {
        // 尝试获取 Tauri 版本，如果失败则说明不在 Tauri 环境
        await getVersion();
      } catch (e) {
        console.log("非 Tauri 环境，跳过托盘初始化");
        throw e;
      }
    };

    let trayInstance: TrayIcon | null = null;

    const initTray = async () => {
      try {
        await checkTauriAndInit();

        // 检查是否已存在托盘实例
        trayInstance = await TrayIcon.getById(TRAY_ID);
        console.log("trayInstance", trayInstance);

        if (trayInstance) {
          return;
        }

        // 创建托盘图标
        const iconPath = "./icons/tray-mac.ico";
        const icon = await resolveResource(iconPath);

        console.log("icon", icon);

        trayInstance = await TrayIcon.new({
          menu: await menu(),
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

    // return () => {
    //   if (trayInstance) {
    //     TrayIcon.removeById(TRAY_ID);
    //   }
    // };
  }, []);
}
