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
import {
  useI18n,
  type LanguagePreference,
  type MessageKey,
} from "@/lib/i18n";
import { MobileRow, MobileSection, MobileSegmented } from "./ui";

const GITHUB_URL = "https://github.com/rock-zhang/Shui";
const STORE_URL = "https://play.google.com/store/apps/details?id=com.shui.app";

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
          description={version || "—"}
        />
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
    </>
  );
}
