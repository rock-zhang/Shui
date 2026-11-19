"use client";

import { useRef, useState } from "react";
import { DatabaseBackup, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n, type MessageKey } from "@/lib/i18n";
import {
  backupError, confirmDrinkImport, exportDrinkBackup, formatBackupDate,
  previewDrinkImport, type ImportPreview,
} from "@/lib/data-backup";

type Notice = { key: MessageKey; params?: Record<string, string | number> };

export default function DataPage() {
  const { t, locale } = useI18n();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await operation(); }
    catch (failure) { setError(failure); }
    finally { locked.current = false; setBusy(false); }
  }

  const chooseFile = () => run(async () => {
    setPreview(null);
    const selected = await previewDrinkImport();
    setPreview(selected);
    if (!selected) setNotice({ key: "settings.data.import.canceled" });
  });

  const confirm = () => run(async () => {
    if (!preview) return;
    const receipt = await confirmDrinkImport(preview.token);
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
  });

  return <div>
    <h3 className="mb-1 text-lg font-medium">{t("settings.data.title")}</h3>
    <p className="mb-4 text-xs leading-5 text-muted-foreground">{t("settings.data.description")}</p>

    <section className="mb-4 rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium"><DatabaseBackup className="h-4 w-4" />{t("settings.data.backup.title")}</div>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">{t("settings.data.backup.description")}</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => {
        const path = await exportDrinkBackup();
        setNotice({
          key: path ? "settings.data.backup.saved" : "settings.data.backup.canceled",
        });
      })}><Download className="h-4 w-4" />{t("settings.data.backup.export")}</Button>
    </section>

    <section className="rounded-lg border p-4">
      <h4 className="mb-2 text-sm font-medium">{t("settings.data.import.title")}</h4>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">{t("settings.data.import.description")}</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={chooseFile}><Upload className="h-4 w-4" />{t("settings.data.import.choose")}</Button>
      {preview && <div className="mt-4 rounded-md bg-muted/50 p-3" aria-label={t("settings.data.import.previewLabel")}>
        <p className="mb-2 break-all text-sm font-medium">{preview.fileName}</p>
        <p className="mb-3 text-xs text-muted-foreground">{t("settings.data.import.range", {
          from: formatBackupDate(preview.firstDate),
          to: formatBackupDate(preview.lastDate),
        })}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">{t("settings.data.import.backupRecords")}</dt><dd>{t("settings.data.import.backupRecordsValue", { days: preview.days, entries: preview.detailedEntries })}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("settings.data.import.expectedNew")}</dt><dd>{t("settings.data.import.expectedNewValue", { days: preview.newDays, amount: preview.newAmount })}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("settings.data.import.existingDates")}</dt><dd>{t("settings.data.import.existingDatesValue", { days: preview.skippedDays })}</dd></div>
        </dl>
        <p className="my-3 text-xs leading-5 text-muted-foreground">{t("settings.data.import.confirmNote")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || preview.newDays === 0} onClick={confirm}>{busy ? t("settings.data.import.importing") : t("settings.data.import.confirm")}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPreview(null); setError(""); setNotice({ key: "settings.data.import.canceledNotice" }); }}>{t("common.cancel")}</Button>
        </div>
        {preview.newDays === 0 && <p className="mt-2 text-xs text-muted-foreground">{t("settings.data.import.allExist")}</p>}
      </div>}
    </section>
    {busy && !preview && <p role="status" className="mt-3 text-sm text-muted-foreground">{t("settings.data.busy")}</p>}
    {notice && <p role="status" className="mt-3 text-sm leading-5">{t(notice.key, notice.params)}</p>}
    {error !== null && <p role="alert" className="mt-3 break-words text-sm leading-5 text-destructive">{backupError(error, t("settings.data.error"), locale)}</p>}
  </div>;
}
