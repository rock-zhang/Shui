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
  patchAlert: (patch: Partial<AlertConfig>) => void;
  patchGeneral: (patch: Partial<GeneralConfig>) => void;
}

const MobileConfigContext = createContext<MobileConfigValue | null>(null);

/**
 * One config owner for the whole mobile shell. It loads once (not on every tab
 * switch) and keeps Today's "提醒节奏" in sync with the reminder settings.
 */
export function MobileConfigProvider({ children }: { children: ReactNode }) {
  const [alert, setAlert] = useState<AlertConfig>(DEFAULT_ALERT);
  const [general, setGeneral] = useState<GeneralConfig>(DEFAULT_GENERAL);
  const [hydrated, setHydrated] = useState(false);
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
    async (key: "alert" | "general", value: AlertConfig | GeneralConfig) => {
      try {
        await writeConfig(key, value);
        await rescheduleReminders();
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
      alertRef.current = next;
      setAlert(next);
      void persist("alert", next);
    },
    [persist]
  );

  const patchGeneral = useCallback(
    (patch: Partial<GeneralConfig>) => {
      const next = { ...generalRef.current, ...patch };
      generalRef.current = next;
      setGeneral(next);
      void persist("general", next);
    },
    [persist]
  );

  const value = useMemo<MobileConfigValue>(
    () => ({ alert, general, hydrated, patchAlert, patchGeneral }),
    [alert, general, hydrated, patchAlert, patchGeneral]
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
