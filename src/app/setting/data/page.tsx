"use client";

import { useRef, useState } from "react";
import { DatabaseBackup, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  backupError, confirmDrinkImport, exportDrinkBackup, formatBackupDate,
  previewDrinkImport, type ImportPreview,
} from "@/lib/data-backup";

export default function DataPage() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try { await operation(); }
    catch (failure) { setError(backupError(failure)); }
    finally { locked.current = false; setBusy(false); }
  }

  const chooseFile = () => run(async () => {
    setPreview(null);
    const selected = await previewDrinkImport();
    setPreview(selected);
    if (!selected) setMessage("已取消选择文件。");
  });

  const confirm = () => run(async () => {
    if (!preview) return;
    const receipt = await confirmDrinkImport(preview.token);
    setPreview(null);
    setMessage(`${receipt.alreadyImported ? "本次导入已完成" : "导入完成"}：新增 ${receipt.importedDays} 天，共 ${receipt.importedAmount} ml；跳过 ${receipt.skippedDays} 个已有日期。`);
  });

  return <div>
    <h3 className="mb-1 text-lg font-medium">备份与导入</h3>
    <p className="mb-4 text-xs leading-5 text-muted-foreground">保存和恢复饮水记录，支持旧版每日总量和新版逐笔明细。</p>

    <section className="mb-4 rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium"><DatabaseBackup className="h-4 w-4" />备份饮水记录</div>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">JSON 备份保留每日总量、记录时间、历史目标及撤销信息。不包含提醒统计、应用设置和主题。</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => {
        const path = await exportDrinkBackup();
        setMessage(path ? "饮水记录备份已保存。" : "已取消保存备份。");
      })}><Download className="h-4 w-4" />导出 JSON 备份</Button>
    </section>

    <section className="rounded-lg border p-4">
      <h4 className="mb-2 text-sm font-medium">导入备份</h4>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">选择本功能导出的 JSON 文件（最多 16 MB）。确认前仅检查和预览；导入只补充缺失日期，已有日期整天跳过，不累加或覆盖。CSV 不支持导入。</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={chooseFile}><Upload className="h-4 w-4" />选择备份文件</Button>
      {preview && <div className="mt-4 rounded-md bg-muted/50 p-3" aria-label="导入预览">
        <p className="mb-2 break-all text-sm font-medium">{preview.fileName}</p>
        <p className="mb-3 text-xs text-muted-foreground">{formatBackupDate(preview.firstDate)} 至 {formatBackupDate(preview.lastDate)}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">备份记录</dt><dd>{preview.days} 天 / {preview.detailedEntries} 笔明细</dd></div>
          <div><dt className="text-xs text-muted-foreground">预计新增</dt><dd>{preview.newDays} 天 / {preview.newAmount} ml</dd></div>
          <div><dt className="text-xs text-muted-foreground">已有日期</dt><dd>{preview.skippedDays} 天将跳过</dd></div>
        </dl>
        <p className="my-3 text-xs leading-5 text-muted-foreground">确认时会再次检查本地记录；预览后新增的日期也会跳过。若整天已存在，即使部分明细缺失，也不会合并该日。</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || preview.newDays === 0} onClick={confirm}>{busy ? "正在导入…" : "确认导入缺失日期"}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPreview(null); setError(""); setMessage("已取消导入，本地记录未修改。"); }}>取消</Button>
        </div>
        {preview.newDays === 0 && <p className="mt-2 text-xs text-muted-foreground">所有日期均已存在，无需导入。</p>}
      </div>}
    </section>
    {busy && !preview && <p role="status" className="mt-3 text-sm text-muted-foreground">正在处理，请稍候…</p>}
    {message && <p role="status" className="mt-3 text-sm leading-5">{message}</p>}
    {error && <p role="alert" className="mt-3 break-words text-sm leading-5 text-destructive">{error}</p>}
  </div>;
}
