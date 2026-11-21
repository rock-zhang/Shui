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
  RefreshCw,
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
import { emitRefresh, isSideloadBuild } from "@/lib/mobile";
import { useUpdate } from "@/components/update-provider";
import { UpdateDot } from "@/components/ui/update-dot";
import {
  useI18n,
  type LanguagePreference,
  type MessageKey,
} from "@/lib/i18n";
import { MobileRow, MobileSection, MobileSegmented } from "./ui";

const GITHUB_URL = "https://github.com/rock-zhang/Shui";
const STORE_URL = "https://play.google.com/store/apps/details?id=com.shui.app";

/**
 * 【临时跳转验证 demo】「设置-应用」相关的全部候选入口，逐一点击在真机上
 * 确认实际落地页。验证完成后随 demo 区块一起删除。
 */
const PROBE_TARGETS: { target: string; label: string }[] = [
  { target: "application_settings", label: "系统 action：应用主页" },
  { target: "manage_applications", label: "系统 action：应用管理（列表）" },
  { target: "manage_all_applications", label: "系统 action：全部应用（列表）" },
  { target: "app_details", label: "系统 action：本应用详情页" },
  { target: "default_apps", label: "系统 action：默认应用" },
  { target: "coloros_safecenter", label: "ColorOS 私有：手机管家自启动 ①" },
  { target: "coloros_startup", label: "ColorOS 私有：手机管家自启动 ②" },
  { target: "oplus_safecenter", label: "ColorOS 私有：oplus 管家自启动" },
  { target: "oppo_safe", label: "ColorOS 私有：旧版 safe 自启动" },
];

type Notice = { key: MessageKey; params?: Record<string, string | number> };

export function MeTab() {
  const { t, locale, preference, setPreference } = useI18n();
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState("");
  const [analyticsOn, setAnalyticsOn] = useState(true);
  const locked = useRef(false);
  const {
    available: updateAvailable,
    latestVersion,
    installing,
    progress,
    checking,
    checkNow,
    install,
  } = useUpdate();
  // 侧载包能自己装（原生下载 + 系统安装器）；Play 包原生产物里没有安装
  // 权限，只能引导去商店——这条分流和原生能力必须一致，否则按钮点了必然失败。
  const canSelfUpdate = isSideloadBuild();

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

  // 【临时跳转验证 demo】逐个入口发起跳转，成功/失败都 toast 出来，
  // 用户在真机上对照每个 target 的实际落地页。
  const runProbe = async (target: string) => {
    try {
      await invoke("open_settings_probe", { target });
      toast.success(`已发起跳转：${target}，请回到 App 对照落地页`, {
        duration: 6000,
      });
    } catch (error) {
      toast.error(`跳转失败 ${target}：${String(error)}`, { duration: 8000 });
    }
  };

  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      await operation();
    } catch (failure) {
      setError(backupError(failure, t("settings.data.error"), locale));
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
        setNotice({ key: "settings.data.import.canceled" });
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
      setNotice({
        key: receipt.alreadyImported
          ? "settings.data.import.alreadyReceived"
          : "settings.data.import.received",
        params: {
          days: receipt.importedDays,
          amount: receipt.importedAmount,
          skipped: receipt.skippedDays,
        },
      });
      // Tabs stay mounted; broadcast so Today / Data pick up the imported days.
      emitRefresh();
    });

  const openExternal = async (url: string, target: "store" | "github") => {
    try {
      await openUrl(url);
      track("external_link_open", { target });
    } catch {
      toast.info(t("mobile.me.desktopPreview"));
    }
  };

  const copyAppInfo = async () => {
    try {
      const info = await invoke("get_app_runtime_info");
      await writeText(JSON.stringify(info));
      track("app_info_copy", { success: true });
      toast.success(t("mobile.me.appInfoCopied"));
    } catch {
      track("app_info_copy", { success: false });
      toast.error(t("mobile.me.copyFailedRetry"));
    }
  };

  const copyContact = async (
    channel: "wechat" | "email",
    labelKey: MessageKey,
    value: string
  ) => {
    try {
      await writeText(value);
      track("contact_copy", { channel });
      toast.success(
        t("mobile.me.copySuccess", { label: t(labelKey) })
      );
    } catch {
      toast.error(t("mobile.me.copyFailed"));
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
        title={t("mobile.me.data.title")}
        description={t("mobile.me.data.description")}
      >
        <MobileRow
          title={t("mobile.me.export.title")}
          description={t("mobile.me.export.description")}
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
                  setNotice({
                    key: path
                      ? "settings.data.backup.saved"
                      : "settings.data.backup.canceled",
                  });
                })
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {t("mobile.me.export.action")}
            </Button>
          }
        />
        <MobileRow
          title={t("mobile.me.import.title")}
          description={t("mobile.me.import.description")}
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={busy}
              onClick={chooseFile}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              {t("mobile.me.import.choose")}
            </Button>
          }
        />

        {preview && (
          <div className="mt-3 rounded-xl bg-muted/50 p-3">
            <p className="break-all text-sm font-medium">{preview.fileName}</p>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">
              {t("settings.data.import.range", {
                from: formatBackupDate(preview.firstDate),
                to: formatBackupDate(preview.lastDate),
              })}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-[11px] text-muted-foreground">
                  {t("settings.data.import.backupRecords")}
                </dt>
                <dd>
                  {t("mobile.me.import.count", {
                    days: preview.days,
                    entries: preview.detailedEntries,
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">
                  {t("settings.data.import.expectedNew")}
                </dt>
                <dd>
                  {t("settings.data.import.expectedNewValue", {
                    days: preview.newDays,
                    amount: preview.newAmount,
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">
                  {t("settings.data.import.existingDates")}
                </dt>
                <dd>
                  {t("settings.data.import.existingDatesValue", {
                    days: preview.skippedDays,
                  })}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex gap-2">
              <Button
                className="min-h-11 flex-1"
                disabled={busy || preview.newDays === 0}
                onClick={confirm}
              >
                {busy
                  ? t("mobile.me.import.importing")
                  : t("mobile.me.import.confirm")}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  track("backup_import_cancel");
                  setPreview(null);
                  setNotice({ key: "settings.data.import.canceledNotice" });
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
            {preview.newDays === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("settings.data.import.allExist")}
              </p>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="mt-3 text-xs leading-5">
            {t(notice.key, notice.params)}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 break-words text-xs leading-5 text-destructive">
            {error}
          </p>
        )}
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
          {t("mobile.me.import.note")}
        </p>
      </MobileSection>

      <MobileSection
        title={t("mobile.me.privacy.title")}
        description={t("mobile.me.privacy.description")}
      >
        <MobileRow
          title={t("mobile.me.analytics.title")}
          description={
            analyticsOn
              ? t("mobile.me.analytics.on")
              : t("mobile.me.analytics.off")
          }
          control={
            <Switch
              checked={analyticsOn}
              onCheckedChange={(next) => void toggleAnalytics(next)}
              aria-label={t("mobile.me.analytics.title")}
            />
          }
        />
      </MobileSection>

      <MobileSection title={t("mobile.me.about.title")}>
        <div className="mb-3 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 p-4 dark:from-blue-950/40 dark:to-indigo-950/30">
          <p className="text-sm leading-6">
            {t("mobile.me.about.description")}
          </p>
        </div>
        <MobileRow
          title={t("mobile.me.about.version")}
          description={
            updateAvailable && latestVersion ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span>{version || "—"}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-red-600 dark:text-red-400">
                  <span className="h-1 w-1 rounded-full bg-red-500" />
                  {latestVersion}
                </span>
              </span>
            ) : (
              version || "—"
            )
          }
          // 侧载包把更新入口收进版本行：不再单独占一行「检查更新」，
          // 有更新时直接给「立即更新」，否则给手动检查。
          control={
            canSelfUpdate ? (
              <div className="relative">
                {updateAvailable ? (
                  <Button
                    size="sm"
                    className="min-h-10"
                    disabled={installing}
                    onClick={() => void install()}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    {installing
                      ? t("settings.about.installing", { progress })
                      : t("mobile.me.about.updateNow")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    disabled={checking}
                    onClick={() => void checkNow()}
                  >
                    <RefreshCw
                      className={`mr-1 h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`}
                    />
                    {checking
                      ? t("settings.about.checking")
                      : t("mobile.me.about.checkNow")}
                  </Button>
                )}
                {/* 红点挂在按钮上：进入「我」tab 后 tab 红点会灭，这里继续
                    提示「有东西可点」，直到真正装上。 */}
                {updateAvailable && <UpdateDot className="-right-1 -top-1" />}
              </div>
            ) : undefined
          }
        />
        {/* 只有 Google Play 包才引导去商店；侧载包的原生产物里没有商店
            渠道可言，跳过去只会让用户装到另一个签名的包。 */}
        {!canSelfUpdate && (
          <MobileRow
            title={t("mobile.me.about.updateTitle")}
            description={t("mobile.me.about.updateDescription")}
            control={
              <Button
                variant="outline"
                size="sm"
                className="min-h-10"
                onClick={() => openExternal(STORE_URL, "store")}
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                {t("mobile.me.about.store")}
              </Button>
            }
          />
        )}
        <MobileRow
          title={t("mobile.me.about.appInfoTitle")}
          description={t("mobile.me.about.appInfoDescription")}
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={copyAppInfo}
            >
              <Info className="mr-1 h-3.5 w-3.5" />
              {t("mobile.me.copy")}
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
        title={t("mobile.me.contact.title")}
        description={t("mobile.me.contact.description")}
      >
        <div className="overflow-hidden rounded-xl border border-border/70">
          <button
            type="button"
            onClick={() =>
              copyContact("wechat", "mobile.me.contact.wechat", "slash__z")
            }
            className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageCircle className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-4 text-muted-foreground">
                {t("mobile.me.contact.wechat")}
              </span>
              <span className="block select-text truncate text-sm font-medium">
                slash__z
              </span>
            </span>
            <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("mobile.me.copy")}
            </span>
          </button>
          <div className="mx-3 h-px bg-border/70" />
          <button
            type="button"
            onClick={() =>
              copyContact("email", "mobile.me.contact.email", "hey47_zhang@163.com")
            }
            className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-4 text-muted-foreground">
                {t("mobile.me.contact.email")}
              </span>
              <span className="block select-text truncate text-sm font-medium">
                hey47_zhang@163.com
              </span>
            </span>
            <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("mobile.me.copy")}
            </span>
          </button>
        </div>
      </MobileSection>

      {/* 【临时跳转验证 demo】验证各「设置-应用」入口的实际落地页，验证后删除。 */}
      <MobileSection
        title="跳转验证 demo"
        description="逐个点击，确认每个入口在这台手机上实际落在哪个页面。失败的会提示原因。验证完成后整个区块会删除。"
      >
        <div className="overflow-hidden rounded-xl border border-dashed border-amber-500/60">
          {PROBE_TARGETS.map(({ target, label }) => (
            <button
              key={target}
              type="button"
              onClick={() => void runProbe(target)}
              className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 active:bg-muted"
            >
              <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                {label}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-amber-600 dark:text-amber-400">
                {target}
              </span>
            </button>
          ))}
        </div>
      </MobileSection>
    </>
  );
}
