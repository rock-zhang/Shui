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
import { useI18n } from "@/i18n/provider";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function Home() {
  const { t } = useI18n();
  const [config, setConfig] = useState({
    isAutoStart: false,
    isCountDown: false,
    isFullScreen: false,
  });
  const { isMacOS } = usePlatform();
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
        isFullScreen: generalSetting?.isFullScreen || false,
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
      <h3 className="mb-4 text-lg font-medium">{t("settings.title")}</h3>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.autoStart.title")}
          </label>
          <p className="text-[0.8rem] text-muted-foreground">
            {t("settings.autoStart.description")}
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
            {t("settings.countdown.title")}
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            {t("settings.countdown.description")}
          </p>
        </div>
        <Switch
          disabled={!isMacOS}
          checked={config.isCountDown}
          onCheckedChange={async (checked) => {
            await saveConfig("isCountDown", checked);
            invoke("reset_timer");
          }}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.fullScreen.title")}
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            {t("settings.fullScreen.description")}
          </p>
        </div>
        <Switch
          checked={config.isFullScreen}
          onCheckedChange={async (checked) => {
            await saveConfig("isFullScreen", checked);
          }}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("common.language")}
          </label>
        </div>
        {/* TODO: 切换语言之后要刷新【全屏提醒】页面，新语言才会生效 */}
        <LanguageSwitcher />
      </div>
    </div>
  );
}
