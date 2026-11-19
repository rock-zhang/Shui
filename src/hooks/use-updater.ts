import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export function useUpdaterCheck() {
  const { t } = useI18n();
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
        toast(t("updater.upToDate"));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("检查更新失败:", err);
      // 把 Tauri 的真实错误（例如 TargetNotFound: darwin-aarch64）露出来，
      // 否则只能看到一句「检查更新失败」，排查得开 DevTools。
      toast.error(t("updater.checkFailed"), { description: message });
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
  const { t } = useI18n();
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);

  const downloadAndInstall = async () => {
    try {
      setInstalling(true);
      setProgress(0);

      const update = await check();
      if (!update) {
        throw new Error(t("updater.noUpdate"));
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
      const message = err instanceof Error ? err.message : String(err);
      console.error("更新安装失败:", err);
      toast.error(t("updater.installFailed"), { description: message });
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
