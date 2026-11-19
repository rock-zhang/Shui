"use client";

import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTheme } from "next-themes";
import {
  Copy,
  Download,
  ExternalLink,
  Github,
  Info,
  Mail,
  MessageCircle,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  backupError,
  confirmDrinkImport,
  exportDrinkBackup,
  formatBackupDate,
  previewDrinkImport,
  type ImportPreview,
} from "@/lib/data-backup";
import {
  isAnalyticsEnabled,
  setAnalyticsEnabled as setNativeAnalyticsEnabled,
  track,
  trackNow,
} from "@/lib/analytics";
import { emitRefresh } from "@/lib/mobile";
import { useI18n, type LanguagePreference } from "@/lib/i18n";
import { MobileRow, MobileSection, MobileSegmented } from "./ui";

const GITHUB_URL = "https://github.com/rock-zhang/Shui";
const STORE_URL = "https://play.google.com/store/apps/details?id=com.shui.app";

export function MeTab() {
  const { t, preference, setPreference } = useI18n();
  const themeOptions = [
    { value: "system", label: t("common.system") },
    { value: "light", label: t("common.light") },
    { value: "dark", label: t("common.dark") },
  ];
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [analyticsOn, setAnalyticsOn] = useState(true);
  const locked = useRef(false);

  useEffect(() => {
    setMounted(true);
    getVersion().then(setVersion).catch(() => {});
    isAnalyticsEnabled().then(setAnalyticsOn).catch(() => {});
  }, []);

  async function toggleAnalytics(next: boolean) {
    if (!next) {
      // 先等最后一条事件落到原生，再关闭采集；否则这条也会被一起丢掉。
      await trackNow("analytics_opt_out");
    }
    setAnalyticsOn(next);
    await setNativeAnalyticsEnabled(next);
  }

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
      if (selected) {
        track("backup_import_preview", {
          days: selected.days,
          new_days: selected.newDays,
          skipped_days: selected.skippedDays,
        });
      } else {
        setMessage("已取消选择文件。");
      }
    });

  const confirm = () =>
    run(async () => {
      if (!preview) return;
      const receipt = await confirmDrinkImport(preview.token);
      track("backup_import_confirm", {
        imported_days: receipt.importedDays,
        imported_amount: receipt.importedAmount,
        skipped_days: receipt.skippedDays,
        already_imported: receipt.alreadyImported,
      });
      setPreview(null);
      setMessage(
        `${receipt.alreadyImported ? "本次导入已完成" : "导入完成"}：新增 ${receipt.importedDays} 天，共 ${receipt.importedAmount} ml；跳过 ${receipt.skippedDays} 个已有日期。`
      );
      // Tabs stay mounted; broadcast so Today / Data pick up the imported days.
      emitRefresh();
    });

  const openExternal = async (url: string, target: "store" | "github") => {
    try {
      await openUrl(url);
      track("external_link_open", { target });
    } catch {
      toast.info("当前为桌面预览，链接将在原生环境打开");
    }
  };

  const copyAppInfo = async () => {
    try {
      const info = await invoke("get_app_runtime_info");
      await writeText(JSON.stringify(info));
      track("app_info_copy", { success: true });
      toast.success("软件信息已复制");
    } catch {
      track("app_info_copy", { success: false });
      toast.error("复制失败，请稍后重试");
    }
  };

  const copyContact = async (label: string, value: string) => {
    try {
      await writeText(value);
      track("contact_copy", {
        channel: label === "微信号" ? "wechat" : "email",
      });
      toast.success(`${label}已复制`);
    } catch {
      toast.error("复制失败，请长按手动复制");
    }
  };

  return (
    <>
      <MobileSection
        title={t("settings.general.appearance.title")}
        description={t("settings.general.appearance.description")}
      >
        <MobileSegmented
          value={mounted ? theme ?? "system" : "system"}
          options={themeOptions}
          onChange={(next) => {
            const current = theme ?? "system";
            if (next !== current) {
              track("theme_changed", { from: current, to: next });
            }
            setTheme(next);
          }}
          label={t("settings.general.appearance.title")}
        />
      </MobileSection>

      <MobileSection
        title={t("language.title")}
        description={t("language.description")}
      >
        <MobileSegmented
          value={preference}
          options={[
            { value: "system", label: t("language.system") },
            { value: "zh-CN", label: t("language.zh") },
            { value: "en-US", label: t("language.en") },
          ]}
          onChange={(next) =>
            setPreference(next as LanguagePreference)
          }
          label={t("language.title")}
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
                  track("backup_export", {
                    result: path ? "success" : "cancel",
                  });
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
                  track("backup_import_cancel");
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

      <MobileSection
        title="隐私与统计"
        description="只统计功能使用与崩溃，不包含饮水记录、时间或任何可识别身份的信息"
      >
        <MobileRow
          title="匿名使用统计"
          description={
            analyticsOn
              ? "已开启：帮助我们了解哪些功能真正有用，可随时关闭"
              : "已关闭：应用不再上报任何使用数据或崩溃信息"
          }
          control={
            <Switch
              checked={analyticsOn}
              onCheckedChange={(next) => void toggleAnalytics(next)}
              aria-label="匿名使用统计"
            />
          }
        />
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
          description="前往应用商店查看最新版本"
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={() => openExternal(STORE_URL, "store")}
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
          onClick={() => openExternal(GITHUB_URL, "github")}
          className="mt-1 flex min-h-12 w-full items-center gap-2 rounded-xl bg-muted/50 px-3 text-left text-sm"
        >
          <Github className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{GITHUB_URL}</span>
        </button>
      </MobileSection>

      <MobileSection
        title="反馈与联系"
        description="遇到问题或有建议，欢迎通过以下任一方式联系我"
      >
        <div className="overflow-hidden rounded-xl border border-border/70">
          <button
            type="button"
            onClick={() => copyContact("微信号", "slash__z")}
            className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageCircle className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-4 text-muted-foreground">
                微信号
              </span>
              <span className="block select-text truncate text-sm font-medium">
                slash__z
              </span>
            </span>
            <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-[11px] text-muted-foreground">复制</span>
          </button>
          <div className="mx-3 h-px bg-border/70" />
          <button
            type="button"
            onClick={() => copyContact("邮箱", "hey47_zhang@163.com")}
            className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-4 text-muted-foreground">
                邮箱
              </span>
              <span className="block select-text truncate text-sm font-medium">
                hey47_zhang@163.com
              </span>
            </span>
            <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-[11px] text-muted-foreground">复制</span>
          </button>
        </div>
      </MobileSection>
    </>
  );
}
