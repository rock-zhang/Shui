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
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useI18n, type MessageKey } from "@/lib/i18n";

/**
 * `unsupported` = 桌面浏览器预览，没有这套系统权限概念。
 * 调用方必须区分它和 `denied`：把预览当未授权会让界面一直报红。
 */
export type NotificationPermission =
  | "unknown"
  | "granted"
  | "denied"
  | "unsupported";

/** 跳系统设置或触发系统确认弹窗后，轮询确认授权结果的时长上限与间隔。 */
const WATCH_TOTAL_MS = 30_000;
const WATCH_INTERVAL_MS = 900;

interface NativePermissionState {
  granted: boolean;
  canRequest: boolean;
}

interface NotificationPermissionValue {
  permission: NotificationPermission;
  /** 系统是否还会弹授权框；永久拒绝后为 false，只能去设置页开。 */
  canRequest: boolean;
  /** 重新读取系统权限（从设置页返回、切回前台时用）。 */
  refresh: () => void;
  /** 申请权限：能弹框就弹，已被永久拒绝则跳系统设置页。 */
  request: (source?: string) => Promise<void>;
}

const NotificationPermissionContext =
  createContext<NotificationPermissionValue | null>(null);

/**
 * 整个移动端共用一份通知权限状态。
 *
 * 四个 tab 同时挂载（切换只改 display），如果每个消费方各自 invoke，
 * 一次切回前台就会打出多份系统查询、跳设置页时还会跑起多条轮询。
 * 状态收在这里，今日 tab 的提示卡和提醒 tab 的红字读的是同一个值。
 */
export function NotificationPermissionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [permission, setPermission] = useState<NotificationPermission>("unknown");
  const [canRequest, setCanRequest] = useState(true);
  const alive = useRef(true);
  const watchTimer = useRef<number | null>(null);

  const stopWatching = useCallback(() => {
    if (watchTimer.current !== null) {
      window.clearInterval(watchTimer.current);
      watchTimer.current = null;
    }
  }, []);

  /** 读一次系统状态；返回是否已授权，供轮询判断。 */
  const read = useCallback(async (): Promise<boolean> => {
    try {
      const state = await invoke<NativePermissionState>(
        "notification_permission_state"
      );
      if (alive.current) {
        setPermission(state.granted ? "granted" : "denied");
        setCanRequest(state.canRequest);
      }
      return state.granted;
    } catch {
      // 桌面预览没有原生命令，退回插件查询；两者都不可用则视为「无此概念」，
      // 按已满足处理，避免在 dev 环境里天天看到红色警示。
      try {
        const granted = await isPermissionGranted();
        if (alive.current) {
          setPermission(granted ? "granted" : "denied");
          setCanRequest(true);
        }
        return granted;
      } catch {
        if (alive.current) setPermission("unsupported");
        return true;
      }
    }
  }, []);

  /**
   * 跳系统设置或弹系统确认框之后短轮询。
   *
   * 电池优化那种系统弹窗不会派发 hidden→visible，只靠 visibilitychange 会一直
   * 停在旧状态；这里最多持续 WATCH_TOTAL_MS，状态变成已授权即停并提示。
   */
  const watch = useCallback(
    (successKey: MessageKey, source: string, reportResult: boolean) => {
      stopWatching();
      const deadline = Date.now() + WATCH_TOTAL_MS;
      const tick = async () => {
        const granted = await read();
        if (granted) {
          stopWatching();
          // 系统授权框的拒绝/允许由原生 onRequestPermissionsResult 上报；
          // 设置页返回没有回调，只能在这里补一条结果。
          if (reportResult) {
            track("permission_result", { source, result: "granted" });
          }
          toast.success(t(successKey));
          return;
        }
        if (!alive.current || Date.now() >= deadline) {
          stopWatching();
          if (reportResult) {
            track("permission_result", { source, result: "timeout" });
          }
        }
      };
      void tick();
      watchTimer.current = window.setInterval(() => void tick(), WATCH_INTERVAL_MS);
    },
    [read, stopWatching, t]
  );

  /**
   * 打开系统通知设置页。Android 13+ 拒绝两次后 requestPermissions 会静默失败，
   * 那时只有设置页能救回来。
   */
  const openSettings = useCallback(
    async (source: string) => {
      track("settings_opened", { target: "notification", source });
      try {
        await invoke("open_notification_settings");
        toast.info(t("mobile.notif.noMorePrompt"));
        watch("mobile.notif.enabled", source, true);
      } catch {
        toast.error(t("mobile.notif.openSettingsFailed"));
      }
    },
    [watch, t]
  );

  const request = useCallback(
    async (source = "unknown") => {
      try {
        const state = await invoke<NativePermissionState>(
          "notification_permission_state"
        );
        // 竞态：用户可能刚在系统设置里打开，只是本地还没刷新。
        if (state.granted) {
          setPermission("granted");
          track("permission_result", { source, result: "already_granted" });
          toast.success(t("mobile.notif.enabled"));
          return;
        }
        track("permission_request", {
          source,
          can_request: state.canRequest,
        });
        if (state.canRequest) {
          // 系统授权框本身就是反馈，这里不再叠一层 toast。
          // 授权结果由原生 onRequestPermissionsResult 上报，避免重复。
          await invoke("request_notification_permission", { source });
          watch("mobile.notif.enabled", source, false);
          return;
        }
        await openSettings(source);
      } catch {
        toast.info(t("mobile.notif.desktopPreview"));
      }
    },
    [openSettings, watch, t]
  );

  const refresh = useCallback(() => {
    void read();
  }, [read]);

  useEffect(() => {
    alive.current = true;
    void read();

    // visibilitychange 之外再叠加两个信号：focus 覆盖部分 ROM 的行为，
    // shui:foreground 由原生 onResume 主动派发，最可靠（系统确认弹窗返回时
    // visibilityState 往往一直是 visible，只有它一定会来）。
    const onForeground = () => {
      if (document.visibilityState === "visible") void read();
    };
    const onNativeForeground = () => void read();
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    window.addEventListener("shui:foreground", onNativeForeground);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("shui:foreground", onNativeForeground);
      stopWatching();
    };
  }, [read, stopWatching]);

  const value = useMemo<NotificationPermissionValue>(
    () => ({ permission, canRequest, refresh, request }),
    [permission, canRequest, refresh, request]
  );

  return (
    <NotificationPermissionContext.Provider value={value}>
      {children}
    </NotificationPermissionContext.Provider>
  );
}

export function useNotificationPermission(): NotificationPermissionValue {
  const value = useContext(NotificationPermissionContext);
  if (!value) {
    throw new Error(
      "useNotificationPermission must be used inside NotificationPermissionProvider"
    );
  }
  return value;
}
