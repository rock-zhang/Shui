import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PLATFORM_OS } from "@/lib/constants";
import { detectPlatform, emitRefresh } from "@/lib/mobile";
import { playConfirmSound } from "@/utils/sound";

/** Rust 侧记水成功后广播的事件，payload 是 `Receipt`。 */
export const DRINK_RECORDED_EVENT = "shui:drink-recorded";

/**
 * 桌面通知的水量档位，升序。
 *
 * 各端用法不同（见 `src-tauri/src/desktop_notification.rs`）：
 * - macOS 只取其中**最小**的一档（50ml）做成单按钮。macOS 把两个以上动作折叠成
 *   下拉，点下拉按钮本身还会被上报成第一个动作；单按钮一次点击就完成，没有误点空间；
 * - Windows / Linux 三个按钮 + 「稍后再说」并列展示；
 * - Android 的 `ReminderScheduler.drinkActions` 按钮文案格式相同（`+Xml`）；
 *   Android 允许用户在今日页长按卡片自定义杯量（取最小三档），桌面保持这组
 *   静态档位不变，因此两端在自定义后允许不同。
 */
export const DRINK_ACTION_AMOUNTS = [50, 100, 200] as const;

/**
 * 桌面端记水事件的桥：Rust 已经把水记进库里了，这里只补界面层——
 * 刷新明细 + 播一声确认音（对齐 Android 通知栏记水后的确认音）。
 *
 * 之所以不在这里做记账：通知点击发生在 WebView 之外，窗口隐藏、脚本被节流
 * 或 Channel 掉线时 JS 根本收不到回调。落盘放在 Rust 才不会再丢记录。
 */
let bridgeReady = false;

export async function setupDesktopNotificationBridge(): Promise<void> {
  if (bridgeReady) return;
  bridgeReady = true;
  if (detectPlatform() === PLATFORM_OS.ANDROID) return;

  try {
    await listen(DRINK_RECORDED_EVENT, () => {
      emitRefresh();
      void playConfirmSound();
    });
  } catch (error) {
    bridgeReady = false;
    console.warn("通知记水事件监听注册失败", error);
  }
}

export type DesktopNotificationStatus = "granted" | "denied" | "unknown";

export interface DesktopNotificationState {
  status: DesktopNotificationStatus;
  bundleId: string;
  settingsUrl: string;
}

/**
 * 读取桌面端系统通知的授权状态与设置页深链。
 *
 * macOS 正式包走 UserNotifications 的 getNotificationSettings，dev 下退回
 * `com.apple.ncprefs` 里 Terminal 的记录；Windows 读注册表的全局开关与
 * AUMID 开关；Linux 没有统一接口，恒为 unknown。
 */
export const getDesktopNotificationState = () =>
  invoke<DesktopNotificationState>("get_desktop_notification_state");

/**
 * 直达系统「通知」设置里 Shui 的开关。
 *
 * 必须交给 Rust 打开：opener 插件的 JS 通道会按 `opener:default` 做 scheme
 * 白名单校验，只放行 http(s)/mailto/tel，`x-apple.systempreferences:` 和
 * `ms-settings:` 会被拒绝。Rust 侧同时负责拼 macOS 的 `?id=` 深链。
 */
export const openNotificationSettings = async (): Promise<void> => {
  await invoke("open_desktop_notification_settings");
};

export const sendReminderNotification = async () => {
  // Android 统一走自定义原生插件，与后台闹钟共用同一条通道，保证图标、
  // 渠道和三档 Action 完全一致；点 Action 由 BroadcastReceiver 静默落盘，
  // 不拉起 App，进程被杀后仍能记水。
  if (detectPlatform() === PLATFORM_OS.ANDROID) {
    await invoke("send_mobile_notification");
    return;
  }

  // 桌面三端由 Rust（desktop_notification.rs）直接调 notify-rust 发送：
  // Windows 需要 Critical 让 toast 常驻（否则收进操作中心后点击不上报），
  // macOS 只发一个动作避免被折叠成下拉；标题、正文与进度副标题都在 Rust 侧
  // 按今日完成度生成，点击后的记水同样在 Rust 落盘，不依赖这条 WebView 通道。
  try {
    await invoke("send_desktop_reminder_notification", {
      amounts: DRINK_ACTION_AMOUNTS,
    });
  } catch (error) {
    // 以前这里静默吞掉，表现为「到点没通知、也查不到原因」。
    console.error("系统通知发送失败", error);
  }
};

/**
 * 发一条只用于验证权限链路的测试通知。
 *
 * macOS 会顺带请求一次系统通知授权（让「系统设置 → 通知」里出现 Shui），
 * 用户从系统弹窗切回来后，设置页靠窗口重新聚焦刷新授权状态。
 */
export const sendTestNotification = () =>
  invoke("send_desktop_test_notification");
