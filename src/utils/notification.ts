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
import { emitRefresh, emitShowReminder } from "@/lib/mobile";
import { recordDrink } from "@/utils/record-drink";

export const REMINDER_CHANNEL_ID = "reminder";
export const REMINDER_ACTION_TYPE = "shui-reminder";

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
          { id: "drink-200", title: "喝一杯 200ml" },
          { id: "drink-100", title: "100ml" },
          { id: "drink-50", title: "50ml" },
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
    await onAction((notification) => {
      const payload = notification as Options & { actionId?: string };
      const actionId =
        payload.actionId ??
        (payload.extra?.actionId as string | undefined) ??
        "";
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
