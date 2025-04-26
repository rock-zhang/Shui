import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

export function useUpdaterCheck() {
  const [checking, setChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
  } | null>(null);

  const checkForUpdate = async () => {
    console.log("checking for update");
    try {
      setChecking(true);

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
      } else {
        toast("当前已是最新版本");
      }
    } catch (err) {
      toast.error("检查更新失败");
      console.error(err instanceof Error ? err.message : "检查更新失败");
      setUpdateAvailable(false);
    } finally {
      setChecking(false);
    }
  };

  return {
    checking,
    updateAvailable,
    updateInfo,
    checkForUpdate,
  };
}

export function useUpdaterDownload() {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);

  const downloadAndInstall = async () => {
    try {
      setInstalling(true);
      setProgress(0);

      const update = await check();
      if (!update) {
        throw new Error("没有可用的更新");
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall(async (event) => {
        console.log("download progress", event);

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
            break;
        }
      });

      // 安装完成后重启应用
      await relaunch();
    } catch (err) {
      toast.error("更新安装失败");
      console.log(err);

      console.error(err instanceof Error ? err.message : "更新安装失败");
      setProgress(0);
    } finally {
      setInstalling(false);
    }
  };

  return {
    installing,
    progress,
    downloadAndInstall,
  };
}
