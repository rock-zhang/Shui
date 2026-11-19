import { invoke } from "@tauri-apps/api/core";
import type { Locale } from "./i18n";

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

const HAS_CHINESE = /[\u3400-\u9fff]/;

/**
 * Tauri invoke 把 Rust 的中文错误消息原样抛回来。英文界面下不展示中文原文：
 * 回退调用方传入的通用提示，原文只留 console 供排查。
 */
export function backupError(
  error: unknown,
  fallback = "操作失败，请重试",
  locale: Locale = "zh-CN"
) {
  const raw =
    typeof error === "string" ? error : error instanceof Error ? error.message : fallback;
  if (locale === "en-US" && HAS_CHINESE.test(raw)) {
    console.error("[data-backup] native error (zh):", raw);
    return fallback;
  }
  return raw;
}
