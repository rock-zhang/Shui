"use client";

import { useUpdate } from "@/components/update-provider";

/**
 * 检查更新的兼容封装。
 *
 * 检查逻辑已经统一到 `UpdateProvider`：tab 红点、「我」tab 的更新行、
 * 关于页三处必须共享同一份状态，各自 `new` 一个 hook 会出现「红点亮着
 * 但按钮说已是最新」的矛盾。这里只做字段映射，保留页面原有的调用形状。
 *
 * 注意：`checkForUpdate` 内部已经负责成功/失败提示，调用方不要再补 toast。
 */
export function useUpdaterCheck() {
  const { checking, available, latestVersion, checkNow } = useUpdate();
  return {
    checking,
    updateAvailable: available,
    updateInfo: latestVersion ? { version: latestVersion } : null,
    checkForUpdate: checkNow,
  };
}

/** 下载与安装。进度来自 Provider（Android 原生回调 / 桌面 updater 事件）。 */
export function useUpdaterDownload() {
  const { installing, progress, install } = useUpdate();
  return {
    installing,
    progress,
    downloadAndInstall: install,
  };
}
