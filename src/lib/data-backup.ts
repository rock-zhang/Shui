import { invoke } from "@tauri-apps/api/core";

export interface ImportPreview {
  token: string;
  fileName: string;
  days: number;
  newDays: number;
  skippedDays: number;
  newAmount: number;
  detailedEntries: number;
  firstDate: string;
  lastDate: string;
}

export interface ImportReceipt {
  importedDays: number;
  skippedDays: number;
  importedAmount: number;
  alreadyImported: boolean;
}

export const exportDrinkBackup = () => invoke<string | null>("export_drink_backup");
export const previewDrinkImport = () => invoke<ImportPreview | null>("preview_drink_import");
export const confirmDrinkImport = (token: string) => invoke<ImportReceipt>("confirm_drink_import", { token });

export function formatBackupDate(key: string) {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

export function backupError(error: unknown) {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "操作失败，请重试";
}
