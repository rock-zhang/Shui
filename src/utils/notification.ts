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
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PLATFORM_OS } from "@/lib/constants";
import { detectPlatform, emitRefresh, emitShowReminder } from "@/lib/mobile";
import { recordDrink } from "@/utils/record-drink";

export const REMINDER_CHANNEL_ID = "reminder";
export const REMINDER_ACTION_TYPE = "shui-reminder";

/**
 * 桌面通知（plugin-notification）的水量档位。App 内全屏提醒额外提供 300ml。
 *
 * 顺序与 Android 的 `ReminderScheduler.DRINK_ACTIONS`（200/100/50）**故意相反**：
 * macOS 上两个以上 action 会被折叠进 "Options" 菜单，而点击菜单按钮本身会被
 * 上报成第一个 action（见 tauri-plugin-notification 2.8.1 `desktop.rs` 的
 * Platform-specific 说明）。把最小的 50ml 放在首位，用户在 macOS 上误点
 * Options 时最坏只记 50ml，不会凭空多出 200ml。
 * Android 的 action 是并列按钮、不存在折叠，仍以 200ml 作为主推档位。
 */
export const DRINK_ACTION_AMOUNTS = [50, 100, 200] as const;

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
        // 点通知主体（`tap`）：桌面端没有全屏提醒的事件订阅者，直接把设置窗
        // 唤回来。此前这里只发 emitShowReminder，桌面无监听者，等于点了没反应。
        emitShowReminder();
        void getCurrentWindow()
          .show()
          .then(() => getCurrentWindow().setFocus())
          .catch((error) => console.warn("唤回设置窗口失败", error));
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
