import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { DEFAULT_ALERT, emitRefresh, type AlertConfig } from "@/lib/mobile";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useDayChange } from "@/hooks/use-day-change";

export function useCalendarSettings(allowedGaps: readonly string[]) {
  const { t } = useI18n();
  const [config, setConfig] = useState<AlertConfig>(DEFAULT_ALERT);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const writing = useRef(false);
  const loadConfig = useCallback(async () => {
    try {
      let response = await invoke<{ config: AlertConfig }>("get_calendar_settings");
      if (response.config.gap && !allowedGaps.includes(response.config.gap)) {
        response = await invoke<{ config: AlertConfig }>("update_reminder_settings", { patch: { gap: "20" } });
      }
      setConfig({ ...DEFAULT_ALERT, ...response.config });
      setLoadError(false);
      setReady(true);
    } catch { setLoadError(true); }
  }, [allowedGaps]);
  useEffect(() => { void loadConfig(); }, [loadConfig]);
  useDayChange(() => { void loadConfig(); });
  const savePatch = async (patch: Partial<AlertConfig>): Promise<boolean> => {
    if (writing.current || !ready) return false;
    writing.current = true;
    setSaving(true);
    try {
      const response = await invoke<{ config: AlertConfig }>("update_reminder_settings", { patch });
      setConfig({ ...DEFAULT_ALERT, ...response.config });
      emitRefresh();
      return true;
    } catch (error) {
      const key = String(error);
      toast.error(key.startsWith("calendar.") ? t(key as MessageKey) : t("calendar.saveFailed"));
      return false;
    } finally { writing.current = false; setSaving(false); }
  };
  return { config, ready, saving, loadError, loadConfig, savePatch };
}
