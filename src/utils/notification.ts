import { invoke } from "@tauri-apps/api/core";
import {
  Importance,
  Visibility,
  createChannel,
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  sendNotification,
  type Options,
} from "@tauri-apps/plugin-notification";
import { PLATFORM_OS } from "@/lib/constants";
import { detectPlatform, emitRefresh, emitShowReminder } from "@/lib/mobile";
import { recordDrink } from "@/utils/record-drink";

export const REMINDER_CHANNEL_ID = "reminder";
export const REMINDER_ACTION_TYPE = "shui-reminder";

/**
 * 桌面通知（plugin-notification）的水量档位，与 Android 原生通知的
 * ReminderScheduler.DRINK_ACTIONS 保持一致。App 内全屏提醒额外提供 300ml。
 */
export const DRINK_ACTION_AMOUNTS = [200, 100, 50] as const;

let actionTypesReady = false;

/**
 * The desktop build shipped with this whole block commented out, so a
 * notification could only be *read*: users had to reopen the app to log water.
 * Register the action type once and let the foreground WebView handle the tap.
 * In the background the Kotlin bridge handles the same action natively.
 */
async function setupReminderActions() {
  if (actionTypesReady) return;
  actionTypesReady = true;

  try {
    await registerActionTypes([
      {
        id: REMINDER_ACTION_TYPE,
        actions: [
          ...DRINK_ACTION_AMOUNTS.map((amount, index) => ({
            id: `drink-${amount}`,
            title: index === 0 ? `喝一杯 ${amount}ml` : `${amount}ml`,
          })),
          { id: "skip", title: "稍后再说" },
        ],
      },
    ]);
  } catch (error) {
    console.warn("通知操作注册失败（桌面端可能不支持）", error);
  }

  try {
    await createChannel({
      id: REMINDER_CHANNEL_ID,
      name: "喝水提醒",
      description: "定时喝水提醒，可直接在通知里记录饮水",
      importance: Importance.High,
      visibility: Visibility.Private,
      vibration: true,
    });
  } catch (error) {
    console.warn("通知渠道创建失败（仅 Android 需要）", error);
  }

  try {
    await onAction((event) => {
      // plugin-notification 2.3+ 把回调参数从 `Options` 收窄成 `ActionPerformed`：
      // actionId 直接挂在顶层（点击通知主体时为 `tap`），不再藏在 extra 里。
      const actionId = event.actionId ?? "";
      const match = /^drink-(\d+)$/.exec(actionId);
      if (match) {
        // requestId keeps a retried tap from double counting.
        recordDrink(Number(match[1]), crypto.randomUUID())
          .then(emitRefresh)
          .catch((failure) => console.error("通知记录饮水失败", failure));
      } else if (actionId !== "skip") {
        emitShowReminder();
      }
    });
  } catch (error) {
    console.warn("通知操作监听注册失败", error);
  }
}

export const sendReminderNotification = async () => {
  // Android 统一走自定义原生插件，与后台闹钟共用同一条通道，保证图标、
  // 渠道和三档 Action 完全一致；点 Action 由 BroadcastReceiver 静默落盘，
  // 不拉起 App，进程被杀后仍能记水。
  // 2.2.2 的 writeActionGroup 曾把 key 写成 `id${type.id}`（读侧却是 `id0..idN`），
  // 该缺陷已在 plugin-notification 2.4.0 修复。若升级到 2.8.1+ 可重新评估切回
  // 官方通道，但官方 Action 用 getActivity，点击会拉起界面且依赖 WebView 启动后
  // 的 onAction 回调，与当前「静默记账」行为并不等价。
  if (detectPlatform() === PLATFORM_OS.ANDROID) {
    await invoke("send_mobile_notification");
    return;
  }

  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }

  if (permissionGranted) {
    await setupReminderActions();
    sendNotification({
      title: "⏰ 该喝水啦",
      body: "站起来喝杯水，顺便活动一下身体吧！",
      channelId: REMINDER_CHANNEL_ID,
      actionTypeId: REMINDER_ACTION_TYPE,
    });
  }
};
