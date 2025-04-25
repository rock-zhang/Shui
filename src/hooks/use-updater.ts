import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { exit, relaunch } from "@tauri-apps/plugin-process";

export function useUpdaterCheck() {
  const [checking, setChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = async () => {
    console.log("checking for update");
    try {
      setChecking(true);
      setError(null);

      const update = await check();

      if (update && update.version) {
        console.log("update", update);

        console.log(
          `found update ${update.version} from ${update.date} with notes ${update.body}`
        );
        setUpdateAvailable(true);
        setUpdateInfo({
          version: update.version,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "检查更新失败");
      setUpdateAvailable(false);
    } finally {
      setChecking(false);
    }
  };

  return {
    checking,
    updateAvailable,
    updateInfo,
    error,
    checkForUpdate,
  };
}

export function useUpdaterDownload() {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const downloadAndInstall = async () => {
    try {
      setInstalling(true);
      setError(null);
      setProgress(0);

      const update = await check();
      if (!update) {
        throw new Error("没有可用的更新");
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall(async (event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength as number;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            const percentage = Math.round((downloaded / contentLength) * 100);
            setProgress(percentage);
            break;
          case "Finished":
            setProgress(100);
            await exit(0);
            await relaunch();
            break;
        }
      });

      // 安装完成后重启应用
      await relaunch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新安装失败");
      setProgress(0);
    } finally {
      setInstalling(false);
    }
  };

  return {
    installing,
    progress,
    error,
    downloadAndInstall,
  };
}
