"use client";

import { useI18n } from "@/i18n/provider";

export default function Shortcut() {
  const { t } = useI18n();

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">{t("settings.shortcut.title")}</h3>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.shortcut.exit.title")}
          </label>
          <p className="text-[0.8rem] text-muted-foreground">
            {t("settings.shortcut.exit.description")}
          </p>
        </div>
        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground">
          Esc
        </span>
      </div>
    </div>
  );
}
