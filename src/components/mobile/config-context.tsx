"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { syncAnalyticsProperties, track } from "@/lib/analytics";
import {
  DEFAULT_ALERT,
  DEFAULT_GENERAL,
  emitRefresh,
  GAP_OPTIONS,
  normalizeQuickAmounts,
  readConfig,
  rescheduleReminders,
  syncReminderConfig,
  writeConfig,
  type AlertConfig,
  type GeneralConfig,
} from "@/lib/mobile";
import { useI18n } from "@/lib/i18n";

interface MobileConfigValue {
  alert: AlertConfig;
  general: GeneralConfig;
  /** False until the on-disk config has been read: consumers render a placeholder
   * instead of the defaults, so no value can flash before the real one arrives. */
  hydrated: boolean;
  /** 递增表示原生闹钟已按新配置重排，今日页据此重新读取下一次时间。 */
  scheduleRevision: number;
  patchAlert: (patch: Partial<AlertConfig>) => void;
  patchGeneral: (patch: Partial<GeneralConfig>) => void;
}

const MobileConfigContext = createContext<MobileConfigValue | null>(null);

/** 只有这些字段真正影响「下一次提醒时间」，其余开关不该重排闹钟。 */
const ALERT_SCHEDULE_FIELDS = [
  "gap",
  "weekdays",
  "timeStart",
  "timeEnd",
] as const;
const GENERAL_SCHEDULE_FIELDS = [
  "isPaused",
  "quietEnabled",
  "quietStart",
  "quietEnd",
] as const;

/** 埋点用的字段名：只记录真正会改变行为或提醒节奏的开关。 */
const ALERT_ANALYTICS_KEYS: Record<string, string> = {
  gap: "gap",
  gold: "goal_ml",
  weekdays: "weekdays",
  timeStart: "time_start",
  timeEnd: "time_end",
  quickAmounts: "quick_amounts",
};
const GENERAL_ANALYTICS_KEYS: Record<string, string> = {
  isNotification: "is_notification",
  isFullScreen: "is_full_screen",
  isSound: "is_sound",
  isPaused: "is_paused",
  quietEnabled: "quiet_enabled",
  quietStart: "quiet_start",
  quietEnd: "quiet_end",
};

function formatSetting(value: unknown): string {
  if (Array.isArray(value)) return value.join(",");
  if (value === null || value === undefined) return "none";
  return String(value).slice(0, 100);
}

/** 逐字段上报变化，避免把整份配置当字符串塞进同一个参数。 */
function trackSettingChanges(
  prev: object,
  next: object,
  mapping: Record<string, string>,
  reschedule: boolean
) {
  for (const [field, key] of Object.entries(mapping)) {
    const before = (prev as Record<string, unknown>)[field];
    const after = (next as Record<string, unknown>)[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    track("setting_changed", {
      key,
      from: formatSetting(before),
      to: formatSetting(after),
      reschedule,
    });
  }
}

function scheduleChanged<T extends object>(
  prev: T,
  next: T,
  fields: readonly (keyof T)[]
) {
  return fields.some(
    (field) => JSON.stringify(prev[field]) !== JSON.stringify(next[field])
  );
}

/**
 * One config owner for the whole mobile shell. It loads once (not on every tab
 * switch) and keeps Today's "提醒节奏" in sync with the reminder settings.
 */
export function MobileConfigProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [alert, setAlert] = useState<AlertConfig>(DEFAULT_ALERT);
  const [general, setGeneral] = useState<GeneralConfig>(DEFAULT_GENERAL);
  const [hydrated, setHydrated] = useState(false);
  const [scheduleRevision, setScheduleRevision] = useState(0);
  // Refs keep rapid successive taps from basing a patch on a stale render.
  const alertRef = useRef(alert);
  const generalRef = useRef(general);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      readConfig<AlertConfig>("alert", DEFAULT_ALERT),
      readConfig<GeneralConfig>("general", DEFAULT_GENERAL),
    ])
      .then(([loadedAlert, generalConfig]) => {
        if (cancelled) return;
        // release 包不再提供 1 分钟测试档。旧 debug 包可能把它写进了 store，
        // 若继续沿用，界面上没有任何选项匹配、原生侧也会按 1 分钟疯狂提醒。
        // 归一到默认值并写回，让前后端口径重新一致。
        const gapValid = GAP_OPTIONS.includes(loadedAlert.gap);
        const alertConfig = gapValid
          ? loadedAlert
          : { ...loadedAlert, gap: DEFAULT_ALERT.gap };
        // 旧版本 store 没有 quickAmounts，或历史写入含非法值时归一到合法档位。
        const normalized = normalizeQuickAmounts(alertConfig.quickAmounts);
        const amountsDirty =
          JSON.stringify(normalized) !==
          JSON.stringify(alertConfig.quickAmounts);
        const alertNormalized = amountsDirty
          ? { ...alertConfig, quickAmounts: normalized }
          : alertConfig;
        if (!gapValid || amountsDirty) {
          void writeConfig("alert", alertNormalized).catch((error) =>
            console.error("归一化提醒间隔失败", error)
          );
        }
        alertRef.current = alertNormalized;
        generalRef.current = generalConfig;
        setAlert(alertNormalized);
        setGeneral(generalConfig);
        setHydrated(true);
      })
      .catch((failure) => {
        console.error("读取提醒配置失败", failure);
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (
      key: "alert" | "general",
      value: AlertConfig | GeneralConfig,
      reschedule: boolean
    ) => {
      try {
        await writeConfig(key, value);
        if (!reschedule) {
          // 不改变节奏的开关（音效/通知/目标/全屏）也要让 Kotlin 拿到新配置，
          // 否则原生会继续按旧值决定是否发通知、走哪个渠道、是否已达标。
          await syncReminderConfig();
        } else {
          await rescheduleReminders();
          // 通知今日页：原生已按新配置重排，重新读取下次提醒时间。
          setScheduleRevision((revision) => revision + 1);
        }
        // 目标量 / 间隔 / 提醒模式变了，user properties 也要跟着更新，
        // 否则受众分组会一直停在旧值上。
        syncAnalyticsProperties();
      } catch (failure) {
        console.error("保存提醒配置失败", failure);
        toast.error(t("mobile.config.saveFailed"));
      }
    },
    [t]
  );

  const patchAlert = useCallback(
    (patch: Partial<AlertConfig>) => {
      const goalChanged =
        patch.gold !== undefined &&
        String(patch.gold) !== String(alertRef.current.gold);
      const next = { ...alertRef.current, ...patch };
      const reschedule = scheduleChanged(
        alertRef.current,
        next,
        ALERT_SCHEDULE_FIELDS
      );
      trackSettingChanges(alertRef.current, next, ALERT_ANALYTICS_KEYS, reschedule);
      alertRef.current = next;
      setAlert(next);
      if (goalChanged) {
        // 目标变了要让「今日」页的进度区重新读取：写盘成功后再广播，
        // 否则监听方可能读到旧值。
        void persist("alert", next, reschedule).then(() => emitRefresh());
      } else {
        void persist("alert", next, reschedule);
      }
    },
    [persist]
  );

  const patchGeneral = useCallback(
    (patch: Partial<GeneralConfig>) => {
      const next = { ...generalRef.current, ...patch };
      const reschedule = scheduleChanged(
        generalRef.current,
        next,
        GENERAL_SCHEDULE_FIELDS
      );
      trackSettingChanges(generalRef.current, next, GENERAL_ANALYTICS_KEYS, reschedule);
      generalRef.current = next;
      setGeneral(next);
      void persist("general", next, reschedule);
    },
    [persist]
  );

  const value = useMemo<MobileConfigValue>(
    () => ({
      alert,
      general,
      hydrated,
      scheduleRevision,
      patchAlert,
      patchGeneral,
    }),
    [alert, general, hydrated, scheduleRevision, patchAlert, patchGeneral]
  );

  return (
    <MobileConfigContext.Provider value={value}>
      {children}
    </MobileConfigContext.Provider>
  );
}

export function useMobileConfig(): MobileConfigValue {
  const value = useContext(MobileConfigContext);
  if (!value) {
    throw new Error("useMobileConfig must be used inside MobileConfigProvider");
  }
  return value;
}
