"use client";

import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useTray } from "@/hooks/use-tray";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { STORE_NAME } from "@/lib/constants";
import { usePlatform } from "@/hooks/use-platform";
import { getGeneralConfig } from "@/utils/store";

export default function Home() {
  const [config, setConfig] = useState({
    isAutoStart: false,
    isCountDown: false,
    isFullScreen: false, // 新增全屏提醒选项
  });
  const { isWindows } = usePlatform();
  useTray();

  useEffect(() => {
    async function loadConfig() {
      const [generalSetting, isAutoStart] = await Promise.all([
        getGeneralConfig(),
        isEnabled(),
      ]);

      setConfig({
        ...config,
        isCountDown: generalSetting?.isCountDown || false,
        isFullScreen: generalSetting?.isFullScreen || false, // 设置默认值
        isAutoStart,
      });
    }

    loadConfig();
  }, []);

  const saveConfig = async (filed: string, checked: boolean) => {
    const store = await load(STORE_NAME.config, { autoSave: false });
    const oldConfig = await store.get<{ value: number }>("general");

    setConfig({
      ...config,
      [filed]: checked,
    });

    await store.set("general", {
      ...oldConfig,
      [filed]: checked,
    });
    await store.save();
  };

  const handleAutoStartChange = async (checked: boolean) => {
    saveConfig("isAutoStart", checked);

    if (checked) {
      enable();
      console.log("isAutoStart", await isEnabled());
    } else {
      disable();
      console.log("isAutoStart", await isEnabled());
    }
  };

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">通用</h3>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            开机自启动
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            电脑重启之后自动开始倒计时
          </p>
        </div>
        <Switch
          checked={config.isAutoStart}
          onCheckedChange={handleAutoStartChange}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            倒计时
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            开启后将在菜单栏显示倒计时，支持macOS和linux
          </p>
        </div>
        <Switch
          disabled={isWindows}
          checked={config.isCountDown}
          onCheckedChange={async (checked) => {
            await saveConfig("isCountDown", checked);
            // 重置计时器
            invoke("reset_timer");
          }}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            全屏提醒
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            开启后将以全屏方式显示提醒，关闭则使用系统通知
          </p>
        </div>
        <Switch
          checked={config.isFullScreen}
          onCheckedChange={async (checked) => {
            await saveConfig("isFullScreen", checked);
          }}
        />
      </div>
    </div>
  );
}
