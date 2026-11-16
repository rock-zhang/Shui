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
import {
  DEFAULT_ALERT,
  DEFAULT_GENERAL,
  readConfig,
  rescheduleReminders,
  syncReminderConfig,
  writeConfig,
  type AlertConfig,
  type GeneralConfig,
} from "@/lib/mobile";

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
      .then(([alertConfig, generalConfig]) => {
        if (cancelled) return;
        alertRef.current = alertConfig;
        generalRef.current = generalConfig;
        setAlert(alertConfig);
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
          return;
        }
        await rescheduleReminders();
        // 通知今日页：原生已按新配置重排，重新读取下次提醒时间。
        setScheduleRevision((revision) => revision + 1);
      } catch (failure) {
        console.error("保存提醒配置失败", failure);
        toast.error("设置未能保存，请重试");
      }
    },
    []
  );

  const patchAlert = useCallback(
    (patch: Partial<AlertConfig>) => {
      const next = { ...alertRef.current, ...patch };
      const reschedule = scheduleChanged(
        alertRef.current,
        next,
        ALERT_SCHEDULE_FIELDS
      );
      alertRef.current = next;
      setAlert(next);
      void persist("alert", next, reschedule);
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
