"use client";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { useUpdaterCheck, useUpdaterDownload } from "@/hooks/use-updater";
import { useUpdate } from "@/components/update-provider";
import { useI18n } from "@/lib/i18n";
import { isSideloadBuild } from "@/lib/mobile";
import { track } from "@/lib/analytics";

export default function About() {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  // Play 包没有自更新能力（原生产物里也不含安装权限），隐藏更新按钮，
  // 只展示版本号；桌面端与 Android 侧载包保留入口。
  const canSelfUpdate = isSideloadBuild();
  const { checking, updateAvailable, checkForUpdate } = useUpdaterCheck();
  const { installing, progress, downloadAndInstall } = useUpdaterDownload();
  const { latestVersion, markSeen } = useUpdate();

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  // 进到关于页就算看过版本号：灭掉侧边栏红点；版本号旁的徽标继续留着，
  // 那是「有新版本」的常驻事实，不该因为看过就消失。
  //
  // 依赖 latestVersion 是必要的：冷启动的缓存读取和首次定时检查都是异步的，
  // 挂载那一刻 latestVersion 往往还是 null，markSeen 会因「还没数据」直接返回，
  // 结果用户明明站在关于页，侧边栏红点却在几秒后亮起来。等它落定再标记一次。
  useEffect(() => {
    if (latestVersion) markSeen();
  }, [markSeen, latestVersion]);

  const openGithub = async () => {
    await openUrl("https://github.com/rock-zhang/Shui");
    track("external_link_open", { target: "github" });
  };

  const handleCopyAppInfo = async () => {
    try {
      const appInfo = await invoke("get_app_runtime_info");
      await writeText(JSON.stringify(appInfo));
      track("app_info_copy", { success: true });
      toast.success(t("settings.about.copySuccess"));
    } catch (error) {
      console.error("复制应用信息失败:", error);
      track("app_info_copy", { success: false });
    }
  };

  const handleCheck = async () => {
    // checkForUpdate 内部已经负责「发现新版本 / 已是最新 / 检查失败」三种
    // 提示，这里再补一条就是连续两条重复 toast。
    track("update_check");
    await checkForUpdate();
  };

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">{t("settings.about.title")}</h3>

      <div className="relative overflow-hidden rounded-lg border bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-3 shadow-xs mb-4 dark:from-blue-950/50 dark:via-indigo-950/40 dark:to-purple-950/40">
        <div className="relative z-10 p-2">
          <div className="flex items-center gap-2 mb-2">
            <svg
              className="h-5 w-5 text-blue-600 dark:text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <label className="text-lg font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-300 dark:to-indigo-300">
              {t("settings.about.project.title")}
            </label>
          </div>
          <p className="text-sm leading-relaxed text-blue-800/70 dark:text-blue-200/80">
            {t("settings.about.project.description1")}
          </p>
          <p className="text-sm leading-relaxed text-blue-800/70 mt-2 dark:text-blue-200/80">
            {t("settings.about.project.description2")}
          </p>
        </div>
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.about.version")}
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-[0.8rem] text-muted-foreground">{version}</p>
            {/* 有新版本时在版本号旁挂一个红点徽标：这是「版本号更新那里」
                的常驻提醒，不受已读状态影响，安装完才消失。 */}
            {canSelfUpdate && updateAvailable && latestVersion && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-red-600 dark:text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {latestVersion}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {canSelfUpdate && (
            <Button
              variant="outline"
              onClick={handleCheck}
              disabled={checking || installing}
            >
              {checking ? t("settings.about.checking") : t("settings.about.check")}
            </Button>
          )}
          {canSelfUpdate && updateAvailable && (
            <Button
              onClick={() => {
                track("update_install");
                void downloadAndInstall();
              }}
              disabled={installing}
            >
              {installing
                ? t("settings.about.installing", { progress })
                : t("settings.about.updateNow")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.about.appInfo")}
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            {t("settings.about.appInfo.description")}
          </p>
        </div>
        <Button onClick={handleCopyAppInfo}>{t("settings.about.copy")}</Button>
      </div>

      <div className="rounded-lg border p-3 shadow-xs space-y-4 mb-4">
        <label className="block text-sm font-medium">
          {t("settings.about.contact")}
        </label>

        <div className="grid grid-cols-[2fr_3fr] gap-4">
          <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 min-w-0">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm text-muted-foreground">
                {t("settings.about.wechat", { id: "slash__z" })}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 min-w-0">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm text-muted-foreground">
                hey47_zhang@163.com
              </p>
            </div>
          </div>
        </div>

        <div
          className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors"
          onClick={openGithub}
        >
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">
              https://github.com/rock-zhang/Shui
            </p>
          </div>
        </div>

        {/* <div className="mt-4 flex justify-center space-x-6">
          <div className="text-center">
            <div className="mb-2">
              <img
                src="/qrcode.jpg"
                alt="微信群"
                className="w-[300px] rounded-lg border"
              />
            </div>
            <p className="text-sm text-muted-foreground">加入微信群</p>
          </div>
        </div> */}
      </div>
    </div>
  );
}
