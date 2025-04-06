"use client";

import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useTray } from "@/hooks/use-tray";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";

export default function Home() {
  const [config, setConfig] = useState({
    isAutoStart: false,
    isCountDown: false,
  });
  useTray();

  useEffect(() => {
    async function loadConfig() {
      const store = await load("config_store.json", { autoSave: false });
      const [generalSetting, isAutoStart] = await Promise.all([
        store.get<{
          isAutoStart: boolean;
          isCountDown: boolean;
        }>("general"),
        isEnabled(),
      ]);
      setConfig({
        ...config,
        isCountDown: generalSetting?.isCountDown || false,
        isAutoStart,
      });
    }

    loadConfig();
  }, []);

  const saveConfig = async (filed: string, checked: boolean) => {
    const store = await load("config_store.json", { autoSave: false });
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
            电脑重启之后自动开始计时
          </p>
        </div>
        <Switch
          checked={config.isAutoStart}
          onCheckedChange={handleAutoStartChange}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            倒计时
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            开启后将在菜单栏显示倒计时
          </p>
        </div>
        <Switch
          checked={config.isCountDown}
          onCheckedChange={async (checked) => {
            await saveConfig("isCountDown", checked);
            // 重置计时器
            invoke("reset_timer");
          }}
        />
      </div>
    </div>
  );
}
