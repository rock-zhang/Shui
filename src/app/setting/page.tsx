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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "next-themes";
import { toast } from "sonner";

const themeOptions = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export default function Home() {
  const [config, setConfig] = useState({
    isAutoStart: false,
    isCountDown: false,
    isFullScreen: false, // 新增全屏提醒选项
  });
  const { isWindows } = usePlatform();
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const [autoStartPending, setAutoStartPending] = useState(true);
  useTray();

  useEffect(() => setThemeMounted(true), []);

  useEffect(() => {
    async function loadConfig() {
      try {
        const [generalSetting, isAutoStart] = await Promise.all([
          getGeneralConfig(),
          isEnabled(),
        ]);

        setConfig((current) => ({
          ...current,
          isCountDown: generalSetting?.isCountDown || false,
          isFullScreen: generalSetting?.isFullScreen || false,
          isAutoStart,
        }));
      } catch (error) {
        console.error("读取通用设置失败:", error);
        toast.error("读取通用设置失败，请重新打开设置");
      } finally {
        setAutoStartPending(false);
      }
    }

    loadConfig();
  }, []);

  const saveConfig = async (filed: string, checked: boolean) => {
    const store = await load(STORE_NAME.config, { autoSave: false });
    const oldConfig = await store.get<{ value: number }>("general");

    setConfig((current) => ({
      ...current,
      [filed]: checked,
    }));

    await store.set("general", {
      ...oldConfig,
      [filed]: checked,
    });
    await store.save();
  };

  const handleAutoStartChange = async (checked: boolean) => {
    setAutoStartPending(true);
    try {
      if (checked) {
        await enable();
      } else {
        await disable();
      }
      await saveConfig("isAutoStart", checked);
    } catch (error) {
      console.error("更新开机自启动失败:", error);
      toast.error("更新开机自启动失败，请重试");
    } finally {
      setAutoStartPending(false);
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
            登录后在后台开始倒计时，不弹出窗口；可从托盘打开偏好设置
          </p>
        </div>
        <Switch
          checked={config.isAutoStart}
          disabled={autoStartPending}
          aria-label="开机自启动"
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

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
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

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs">
        <div>
          <label className="text-sm font-medium leading-none">外观主题</label>
          <p className="text-[0.8rem] text-muted-foreground">
            可选择浅色、深色或跟随系统外观
          </p>
        </div>
        <Select
          value={themeMounted ? theme : "system"}
          disabled={!themeMounted}
          onValueChange={setTheme}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="选择主题" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {themeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
