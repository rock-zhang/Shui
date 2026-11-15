"use client";

import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTheme } from "next-themes";
import {
  DatabaseBackup,
  Download,
  ExternalLink,
  Github,
  Info,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  backupError,
  confirmDrinkImport,
  exportDrinkBackup,
  formatBackupDate,
  previewDrinkImport,
  type ImportPreview,
} from "@/lib/data-backup";
import { MobileRow, MobileSection, MobileSegmented } from "./ui";

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const GITHUB_URL = "https://github.com/rock-zhang/Shui";
const STORE_URL = "https://play.google.com/store/apps/details?id=com.shui.app";

export function MeTab() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);

  useEffect(() => {
    setMounted(true);
    getVersion().then(setVersion).catch(() => {});
  }, []);

  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (failure) {
      setError(backupError(failure));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  const chooseFile = () =>
    run(async () => {
      setPreview(null);
      const selected = await previewDrinkImport();
      setPreview(selected);
      if (!selected) setMessage("已取消选择文件。");
    });

  const confirm = () =>
    run(async () => {
      if (!preview) return;
      const receipt = await confirmDrinkImport(preview.token);
      setPreview(null);
      setMessage(
        `${receipt.alreadyImported ? "本次导入已完成" : "导入完成"}：新增 ${receipt.importedDays} 天，共 ${receipt.importedAmount} ml；跳过 ${receipt.skippedDays} 个已有日期。`
      );
    });

  const openExternal = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      toast.info("当前为桌面预览，链接将在原生环境打开");
    }
  };

  const copyAppInfo = async () => {
    try {
      const info = await invoke("get_app_runtime_info");
      await writeText(JSON.stringify(info));
      toast.success("软件信息已复制");
    } catch {
      toast.error("复制失败，请稍后重试");
    }
  };

  return (
    <>
      <MobileSection title="外观" description="浅色、深色或跟随系统">
        <MobileSegmented
          value={mounted ? theme ?? "system" : "system"}
          options={THEME_OPTIONS}
          onChange={setTheme}
          label="外观主题"
        />
      </MobileSection>

      <MobileSection
        title="备份与导入"
        description="JSON 备份保留每日总量、逐笔明细与历史目标；不含主题和设置"
      >
        <MobileRow
          title="导出备份"
          description="生成 JSON 后通过系统分享保存到文件应用或发给自己"
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const path = await exportDrinkBackup();
                  setMessage(path ? "饮水记录备份已保存。" : "已取消保存备份。");
                })
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              导出
            </Button>
          }
        />
        <MobileRow
          title="导入备份"
          description="仅补充缺失日期，已有日期整天跳过，不覆盖"
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={busy}
              onClick={chooseFile}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              选择文件
            </Button>
          }
        />

        {preview && (
          <div className="mt-3 rounded-xl bg-muted/50 p-3">
            <p className="break-all text-sm font-medium">{preview.fileName}</p>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">
              {formatBackupDate(preview.firstDate)} 至{" "}
              {formatBackupDate(preview.lastDate)}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-[11px] text-muted-foreground">备份记录</dt>
                <dd>
                  {preview.days} 天 / {preview.detailedEntries} 笔
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">预计新增</dt>
                <dd>
                  {preview.newDays} 天 / {preview.newAmount} ml
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">已有日期</dt>
                <dd>{preview.skippedDays} 天将跳过</dd>
              </div>
            </dl>
            <div className="mt-3 flex gap-2">
              <Button
                className="min-h-11 flex-1"
                disabled={busy || preview.newDays === 0}
                onClick={confirm}
              >
                {busy ? "导入中…" : "确认导入"}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setMessage("已取消导入，本地记录未修改。");
                }}
              >
                取消
              </Button>
            </div>
            {preview.newDays === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                所有日期均已存在，无需导入。
              </p>
            )}
          </div>
        )}
        {message && (
          <p role="status" className="mt-3 text-xs leading-5">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 break-words text-xs leading-5 text-destructive">
            {error}
          </p>
        )}
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
          导出文件先写入应用缓存再调用系统分享；导入使用系统文件选择器（SAF），已有日期整体跳过、绝不覆盖。
        </p>
      </MobileSection>

      <MobileSection title="关于">
        <div className="mb-3 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 p-4 dark:from-blue-950/40 dark:to-indigo-950/30">
          <p className="text-sm leading-6">
            一个帮你养成健康饮水习惯的小工具。按你设定的目标，在合适的时间提醒你喝水，并记录每一次坚持。
          </p>
        </div>
        <MobileRow title="当前版本" description={version || "—"} />
        <MobileRow
          title="检查更新"
          description="Android 版通过应用商店更新（应用内自更新不符合商店政策）"
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={() => openExternal(STORE_URL)}
            >
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              前往商店
            </Button>
          }
        />
        <MobileRow
          title="软件信息"
          description="复制运行环境信息用于反馈问题"
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={copyAppInfo}
            >
              <Info className="mr-1 h-3.5 w-3.5" />
              复制
            </Button>
          }
        />
        <button
          type="button"
          onClick={() => openExternal(GITHUB_URL)}
          className="mt-1 flex min-h-12 w-full items-center gap-2 rounded-xl bg-muted/50 px-3 text-left text-sm"
        >
          <Github className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{GITHUB_URL}</span>
        </button>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          反馈：微信号 slash__z · hey47_zhang@163.com
        </p>
      </MobileSection>

      <MobileSection title="移动端与桌面端的差异">
        <p className="text-xs leading-5 text-muted-foreground">
          为符合 Android 权限与商店政策，「已安装应用列表」不采集，「应用白名单」改为勿扰时段，
          「开机自启」改为系统闹钟开机重建，「应用内更新」改为商店更新。
          其余目标、间隔、星期、时段、饮水记录、撤销、统计、CSV、备份导入与主题均与桌面端一致。
        </p>
      </MobileSection>
    </>
  );
}
