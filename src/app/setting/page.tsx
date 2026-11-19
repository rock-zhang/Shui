"use client";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, SendHorizontal } from "lucide-react";
import { useEffect, useCallback, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useTray } from "@/hooks/use-tray";
import { isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { STORE_NAME } from "@/lib/constants";
import { usePlatform } from "@/hooks/use-platform";
import { getGeneralConfig } from "@/utils/store";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import {
  isAnalyticsEnabled,
  setAnalyticsEnabled,
  trackNow,
} from "@/lib/analytics";
import {
  getDesktopNotificationState,
  openNotificationSettings,
  sendTestNotification,
  type DesktopNotificationStatus,
} from "@/utils/notification";

const themeOptions = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

/** 与 Android config-context 的 setting_changed 参数名保持一致。 */
const GENERAL_ANALYTICS_KEYS: Record<string, string> = {
  isAutoStart: "autostart",
  isCountDown: "countdown",
  isFullScreen: "is_full_screen",
  isSound: "is_sound",
};

export default function Home() {
  const [config, setConfig] = useState({
    isAutoStart: false,
    isCountDown: false,
    isFullScreen: false, // 新增全屏提醒选项
    isSound: true,
  });
  const { isWindows, isMacOS, isMobile, isTauri } = usePlatform();

  // 全屏提醒关闭后能否收到提醒，取决于系统设置里有没有给 Shui 授权。
  // 桌面端由 Rust 读取真实状态（macOS 走 UserNotifications，Windows 读注册表，
  // Linux 无统一接口只能 unknown），打开设置时也由 Rust 拼好深链。
  const goToNotificationSettings = async () => {
    try {
      await openNotificationSettings();
    } catch {
      toast.info(
        isMacOS
          ? "请打开「系统设置 → 通知 → Shui」，开启「允许通知」"
          : isWindows
            ? "请打开「设置 → 系统 → 通知」，找到 Shui 开启通知"
            : "请在系统设置的通知页面中找到 Shui 并开启通知"
      );
    }
  };
  const [notificationStatus, setNotificationStatus] =
    useState<DesktopNotificationStatus | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(true);

  // 发一条测试通知：macOS 会顺带请求一次授权，用户从系统弹窗回来后靠
  // window focus 重新读取状态，警告卡片会自动消失。
  const sendTest = async () => {
    setTestPending(true);
    try {
      await sendTestNotification();
      toast.info("测试通知已发送；若没看到，请确认系统已允许 Shui 通知", {
        duration: 6000,
      });
    } catch {
      toast.error("发送测试通知失败，请检查系统通知设置");
    } finally {
      setTestPending(false);
    }
  };

  // 用户从系统设置切回来时窗口会重新聚焦，这时再读一次，
  // 不必关掉设置页重开。移动端与浏览器预览没有这条命令。
  const refreshNotificationStatus = useCallback(async () => {
    if (!isTauri || isMobile) return;
    try {
      const state = await getDesktopNotificationState();
      setNotificationStatus(state.status);
    } catch (error) {
      console.warn("读取系统通知授权状态失败", error);
      setNotificationStatus(null);
    }
  }, [isTauri, isMobile]);

  useEffect(() => {
    void refreshNotificationStatus();
    const onFocus = () => void refreshNotificationStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshNotificationStatus]);

  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const [autoStartPending, setAutoStartPending] = useState(true);
  useTray();

  useEffect(() => setThemeMounted(true), []);

  useEffect(() => {
    async function loadConfig() {
      try {
        const [generalSetting, isAutoStart] = await Promise.all([
          getGeneralConfig(),
          isEnabled(),
        ]);

        setConfig((current) => ({
          ...current,
          isCountDown: generalSetting?.isCountDown || false,
          isFullScreen: generalSetting?.isFullScreen || false,
          // 旧版本没有这个字段：默认开启，与移动端口径一致。
          isSound: generalSetting?.isSound !== false,
          isAutoStart,
        }));
      } catch (error) {
        console.error("读取通用设置失败:", error);
        toast.error("读取通用设置失败，请重新打开设置");
      } finally {
        setAutoStartPending(false);
      }
    }

    loadConfig();
    isAnalyticsEnabled().then(setAnalyticsOn).catch(() => {});
  }, []);

  async function toggleAnalytics(next: boolean) {
    if (!next) {
      // 先等最后一条事件发出去，再关闭采集。
      await trackNow("analytics_opt_out");
    }
    setAnalyticsOn(next);
    await setAnalyticsEnabled(next);
  }

  const saveConfig = async (filed: string, checked: boolean) => {
    const store = await load(STORE_NAME.config, { autoSave: false });
    const oldConfig = await store.get<{ value: number }>("general");

    track("setting_changed", {
      key: GENERAL_ANALYTICS_KEYS[filed] ?? filed,
      from: Boolean(
        (config as unknown as Record<string, unknown>)[filed]
      ),
      to: checked,
      reschedule: filed !== "isSound",
    });

    setConfig((current) => ({
      ...current,
      [filed]: checked,
    }));

    await store.set("general", {
      ...oldConfig,
      [filed]: checked,
    });
    await store.save();
  };

  const handleAutoStartChange = async (checked: boolean) => {
    setAutoStartPending(true);
    try {
      if (checked) {
        await invoke("enable_silent_autostart");
      } else {
        await disable();
      }
      await saveConfig("isAutoStart", checked);
    } catch (error) {
      console.error("更新开机自启动失败:", error);
      toast.error("更新开机自启动失败，请重试");
    } finally {
      setAutoStartPending(false);
    }
  };

  // 有权限时整块提示都不展示，只有 denied / unknown 才需要提醒用户去授权。
  const notificationCard =
    notificationStatus === "denied"
      ? {
          tone: "border-destructive/40 bg-destructive/5",
          icon: "text-destructive",
          title: "text-destructive",
          titleText: "系统通知已被关闭",
          description:
            "系统设置中关闭了 Shui 的通知，倒计时结束后你将收不到任何提醒。请打开通知设置重新允许。",
        }
      : {
          tone: "border-amber-500/40 bg-amber-50 dark:bg-amber-950/20",
          icon: "text-amber-600 dark:text-amber-400",
          title: "text-amber-800 dark:text-amber-300",
          titleText: "系统通知可能不可达",
          description:
            "当前使用系统通知提醒。若系统设置中未允许 Shui 发送通知，倒计时结束后你将收不到任何提醒。请在下方开启权限后，再等待下一次提醒验证。",
        };

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">通用</h3>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            开机自启动
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            登录后在后台开始倒计时，不弹出窗口；可从托盘打开偏好设置
          </p>
        </div>
        <Switch
          checked={config.isAutoStart}
          disabled={autoStartPending}
          aria-label="开机自启动"
          onCheckedChange={handleAutoStartChange}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            倒计时
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            开启后将在菜单栏显示倒计时，支持macOS和linux
          </p>
        </div>
        <Switch
          disabled={isWindows}
          checked={config.isCountDown}
          onCheckedChange={async (checked) => {
            await saveConfig("isCountDown", checked);
            // 重置计时器
            invoke("reset_timer");
          }}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            全屏提醒
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            开启后将以全屏方式显示提醒，关闭则使用系统通知
          </p>
        </div>
        <Switch
          checked={config.isFullScreen}
          onCheckedChange={async (checked) => {
            await saveConfig("isFullScreen", checked);
            if (!checked) {
              // 关闭全屏提醒的当下就把话说清楚：能否收到取决于系统通知权限。
              // toast 的 action 让用户可以一键直达，不必自己翻系统设置。
              toast.warning("提醒将改用系统通知，请确认已允许 Shui 发送通知", {
                duration: 8000,
                action: {
                  label: "去授权",
                  onClick: () => void goToNotificationSettings(),
                },
              });
            }
          }}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            提醒音效
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            记录饮水后播放一声确认音，关闭后完全静音
          </p>
        </div>
        <Switch
          checked={config.isSound}
          aria-label="提醒音效"
          onCheckedChange={async (checked) => {
            await saveConfig("isSound", checked);
          }}
        />
      </div>

      {!autoStartPending &&
        !config.isFullScreen &&
        notificationStatus !== "granted" && (
          <div
            className={`flex flex-row items-start gap-3 rounded-lg border p-3 shadow-xs mb-4 ${notificationCard.tone}`}
          >
            <AlertTriangle
              className={`mt-0.5 size-4 shrink-0 ${notificationCard.icon}`}
            />
            <div className="flex-1">
              <p className={`text-sm font-medium leading-none ${notificationCard.title}`}>
                {notificationCard.titleText}
              </p>
              <p className="mt-1.5 text-[0.8rem] text-muted-foreground">
                {notificationCard.description}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void goToNotificationSettings()}
                >
                  <ExternalLink className="mr-1.5 size-3.5" />
                  打开系统通知设置
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testPending}
                  onClick={() => void sendTest()}
                >
                  <SendHorizontal className="mr-1.5 size-3.5" />
                  发送测试通知
                </Button>
              </div>
            </div>
          </div>
        )}

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs">
        <div>
          <label className="text-sm font-medium leading-none">外观主题</label>
          <p className="text-[0.8rem] text-muted-foreground">
            可选择浅色、深色或跟随系统外观
          </p>
        </div>
        <Select
          value={themeMounted ? theme : "system"}
          disabled={!themeMounted}
          onValueChange={setTheme}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="选择主题" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {themeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs">
        <div>
          <label className="text-sm font-medium leading-none">
            匿名使用统计
          </label>
          <p className="text-[0.8rem] text-muted-foreground">
            仅统计功能使用与崩溃，不含饮水记录和时间，可随时关闭
          </p>
        </div>
        <Switch
          checked={analyticsOn}
          aria-label="匿名使用统计"
          onCheckedChange={(checked) => void toggleAnalytics(checked)}
        />
      </div>
    </div>
  );
}
