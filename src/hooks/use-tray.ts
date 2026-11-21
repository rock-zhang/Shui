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
import { platform } from "@tauri-apps/plugin-os";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { emitRefresh } from "@/lib/mobile";
import { track, trackDrinkRecorded } from "@/lib/analytics";
import { playConfirmSound } from "@/utils/sound";
import type { DrinkReceipt } from "@/lib/drink-day";

const TRAY_ID = "main-tray";

/** 托盘快捷记水档位。 */
const TRAY_DRINK_AMOUNTS = [50, 100] as const;

export function useTray() {
  const { t, locale } = useI18n();
  // 语言切换后用当前语言重建托盘菜单。
  useEffect(() => {
    void setMenu();
  }, [locale]);

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
    const menu = await Menu.new();
    const openSettings = async () => {
      track("tray_action", { action: "open_settings" });
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        if (await mainWindow.isMinimized()) await mainWindow.unminimize();
        await mainWindow.show();
        await mainWindow.setFocus();
      }
    };
    if (typeof window !== "undefined") {
      window.__SHUI_NATIVE_SMOKE__?.setTrayAction(openSettings);
    }

    await menu.append(
      await MenuItem.new({
        text: t("tray.preferences"),
        action: openSettings,
      })
    );
    await menu.append(await PredefinedMenuItem.new({ item: "Separator" }));
    await menu.append(
      await MenuItem.new({
        text: t("tray.restNow"),
        action: async () => {
          track("tray_action", { action: "rest_now" });
          invoke("call_reminder");
        },
      })
    );

    // 托盘快捷记水：与通知按钮同一条 `record_drink` 落盘链路（带幂等 requestId），
    // 成功后广播刷新（饮水记录页、统计等监听者自行重读）并播确认音，对齐通知记水。
    const drinkSubmenu = await Submenu.new({ text: t("tray.recordDrink") });
    for (const amount of TRAY_DRINK_AMOUNTS) {
      await drinkSubmenu.append(
        await MenuItem.new({
          text: `+${amount}ml`,
          action: async () => {
            try {
              const receipt = await invoke<DrinkReceipt>("record_drink", {
                amount,
                requestId: crypto.randomUUID(),
              });
              trackDrinkRecorded(receipt, amount, "tray");
              emitRefresh();
              void playConfirmSound();
            } catch (error) {
              console.error("托盘记水失败:", error);
              toast.error(t("common.manualDrink.uncertain"));
            }
          },
        })
      );
    }
    await menu.append(drinkSubmenu);

    // 创建子菜单
    const submenu = await Submenu.new({
      text: t("tray.timerControl"),
      items: [
        {
          text: t("tray.pause"),
          action: async () => {
            track("tray_action", { action: "pause" });
            invoke("pause_timer");
          },
        },
        {
          text: t("tray.restart"),
          action: async () => {
            track("tray_action", { action: "resume" });
            invoke("start_timer");
          },
        },
      ],
    });
    await menu.append(submenu);

    await menu.append(await PredefinedMenuItem.new({ item: "Separator" }));

    // 根据平台选择不同的退出菜单实现
    const currentPlatform = await platform();
    if (currentPlatform === "linux") {
      // Linux 系统使用普通的 MenuItem
      await menu.append(
        await MenuItem.new({
          text: t("tray.quit"),
          action: async () => {
            console.log("退出应用");
            invoke("quit");
          },
        })
      );
    } else {
      // 其他平台使用 PredefinedMenuItem
      await menu.append(
        await PredefinedMenuItem.new({ text: t("tray.quit"), item: "Quit" })
      );
    }

    return menu;
  }, [t]);

  const setMenu = useCallback(async () => {
    let trayInstance: TrayIcon | null = null;

    try {
      await checkTauriAndInit();

      // 检查是否已存在托盘实例
      trayInstance = await TrayIcon.getById(TRAY_ID);
      console.log("trayInstance", trayInstance);

      if (trayInstance) {
        await trayInstance.setMenu(await getMenu());
        if (typeof window !== "undefined") {
          window.__SHUI_NATIVE_SMOKE__?.trayReady();
        }
      }
      // trayInstance?.setIconAsTemplate(true);
    } catch (error) {
      console.error("创建托盘失败:", error);
    }
  }, [getMenu]);
}
