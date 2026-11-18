//! 桌面三端（macOS / Windows / Linux）的提醒通知。
//!
//! 这里不走 `plugin-notification` 的 JS 通道，而是直接调用 `notify-rust`
//! 并在 Rust 侧处理点击，原因有三条，都是实测踩出来的：
//!
//! 1. **Windows 只在 toast 还在屏幕上时上报点击**（plugin 文档原文）。用它发送时
//!    通知一收进操作中心，点按钮就没有任何回调，表现为「点了没反应、没记录」。
//!    改由这里发送并给 `Urgency::Critical`（映射成 toast 的 `Scenario::Reminder`），
//!    toast 会常驻到用户处理为止，点击才稳定可回收。
//! 2. **macOS 把两个以上动作折叠成一个下拉按钮**，下拉标题由 `actions_label` 决定，
//!    插件不暴露这个参数，默认就是英文 "Options"。改成中文只能自己发；最终这里
//!    干脆只给 macOS 一个动作，省掉下拉、一次点击完成（见 `send_desktop_reminder_notification`）。
//! 3. **动作落盘不依赖 WebView**：记水在 Rust 里直接写库，再向前端广播事件。
//!    窗口隐藏、脚本被节流、Channel 掉线都不会丢记录。
//!
//! 记水成功后前端只负责两件事：刷新明细 + 补一声确认音（对齐 Android）。

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use notify_rust::NotificationResponse;
use tauri::{AppHandle, Emitter, Manager};

use crate::drink_store::save_drink;

/// 前端收到后刷新饮水明细并播放确认音。payload 是 `Receipt` 的 JSON。
pub const DRINK_RECORDED_EVENT: &str = "shui:drink-recorded";

const SKIP_ACTION_ID: &str = "skip";
/// Windows / Linux 的第四个按钮。macOS 走单按钮方案，多一个动作就会被折叠成下拉，所以不发。
#[cfg(not(target_os = "macos"))]
const SKIP_ACTION_LABEL: &str = "稍后再说";

/// macOS 单按钮的兜底档位：前端没给档位（或全为 0）时用它。
#[cfg(target_os = "macos")]
const DEFAULT_DRINK_AMOUNT: u64 = 50;

/// 按钮文案必须自带动词。
///
/// Windows / Linux 的 toast 按钮、Android 的通知按钮都是脱离正文单独展示的，
/// `100ml` 这种纯数量读不出是「喝了」还是「目标」。所以三档长一个样：
/// `喝了 50ml` / `喝了 100ml` / `喝了 200ml`，Windows、Linux、Android 一致。
pub fn drink_action_label(amount: u64) -> String {
    format!("喝了 {amount}ml")
}

fn drink_action_id(amount: u64) -> String {
    format!("drink-{amount}")
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// 通知链路的日志落点。Windows 装包后没有 stdout，出了问题只能瞎猜，
/// 所以除 `eprintln!` 之外再往 `app_log_dir/notification.log` 追加一份。
static LOG_FILE: OnceLock<PathBuf> = OnceLock::new();

fn configure_log(app: &AppHandle) {
    if LOG_FILE.get().is_some() {
        return;
    }
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = LOG_FILE.set(dir.join("notification.log"));
    }
}

fn report(message: &str) {
    let stamped = format!("{} {message}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    eprintln!("[notification] {stamped}");
    let Some(path) = LOG_FILE.get() else {
        return;
    };
    // 超过 256KB 直接清空，只留最近一段；这个文件只用来事后定位，不做轮转。
    if std::fs::metadata(path)
        .map(|meta| meta.len() > 256 * 1024)
        .unwrap_or(false)
    {
        let _ = std::fs::write(path, b"");
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{stamped}");
    }
}

/// 通知归属的应用标识：macOS 的点击回调和系统设置里的授权条目都认它。
///
/// 通知必须归属 App 自己的 bundle，否则 AppKit 的 delegate 收不到点击。
/// dev 模式下进程由 Terminal 拉起，沿用插件同样的归属处理。
#[cfg(target_os = "macos")]
fn notification_owner(app: &AppHandle) -> String {
    if tauri::is_dev() {
        "com.apple.Terminal".to_string()
    } else {
        app.config().identifier.clone()
    }
}

/// 最近一次通知动作的时间戳（毫秒）。macOS 上点击通知会激活 App 并触发
/// `RunEvent::Reopen`，`lib.rs` 用它区分「用户主动重开」和「通知动作的副作用」。
static LAST_ACTION_AT: AtomicU64 = AtomicU64::new(0);

fn mark_action() {
    LAST_ACTION_AT.store(now_millis(), Ordering::SeqCst);
}

/// 通知动作刚刚发生过（2 秒窗口且只消费一次）。
pub fn action_reopen_pending() -> bool {
    let at = LAST_ACTION_AT.swap(0, Ordering::SeqCst);
    at != 0 && now_millis().saturating_sub(at) < 2_000
}

static ACTION_SEQ: AtomicU64 = AtomicU64::new(0);

/// `record_drink` 要求 requestId 非空、ASCII、不超过 128 字节，且同一 ID 幂等，
/// 这里用「时间戳 + 档位 + 自增序号」保证每次点击都是一笔新记录。
fn next_request_id(amount: u64) -> String {
    let seq = ACTION_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("notification:{}:{amount}:{seq}", now_millis())
}

fn parse_drink_amount(action: &str) -> Option<u64> {
    let rest = action.strip_prefix("drink-")?;
    rest.parse::<u64>()
        .ok()
        .filter(|amount| *amount > 0 && *amount <= 10_000)
}

fn commit_drink(app: &AppHandle, amount: u64) {
    let request_id = next_request_id(amount);
    match save_drink(app, amount, &format!("manual:{request_id}")) {
        Ok(receipt) => {
            report(&format!(
                "通知记水成功 +{amount}ml，今日累计 {}ml",
                receipt.total
            ));
            match serde_json::to_value(&receipt) {
                Ok(payload) => {
                    if let Err(error) = app.emit(DRINK_RECORDED_EVENT, payload) {
                        report(&format!("记水事件广播失败：{error}"));
                    }
                }
                Err(error) => report(&format!("记水回执序列化失败：{error}")),
            }
        }
        Err(error) => report(&format!("通知记水失败 +{amount}ml：{error}")),
    }
}

/// macOS 的 Accessory 应用被通知激活时，AppKit 会把可视窗口带到前台。
/// 如果通知发出时窗口本来是收起来的，就把这次副作用撤掉；本来开着就别动它。
#[cfg(target_os = "macos")]
fn restore_hidden_window(app: &AppHandle, was_visible: bool) {
    if was_visible {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[cfg(not(target_os = "macos"))]
fn restore_hidden_window(_app: &AppHandle, _was_visible: bool) {}

/// 桌面端通知授权状态与设置页入口。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationState {
    /// `granted` / `denied` / `unknown`
    pub status: String,
    /// 通知归属的 bundle id；macOS 的深链和 ncprefs 查询都按它匹配
    pub bundle_id: String,
    /// 直达本应用通知设置页的 URL；空串表示该平台没有可用 deep link
    pub settings_url: String,
}

/// macOS 的通知授权记录在 `com.apple.ncprefs` 的 `apps` 数组里，每个 App 一条，
/// `flags` 是未公开的位图，bit 25 表示「允许通知」。Apple 没有公开的查询接口，
/// `tauri-plugin-notification` 的 isPermissionGranted 在桌面端又恒为 true；
/// Electron 生态（macos-notification-state / ncprefs.py）同样读这一位。
///
/// 返回 None 表示还没有该 App 的记录：可能尚未发过通知，也可能系统还没写入。
#[cfg(target_os = "macos")]
fn ncprefs_notifications_allowed(bundle_id: &str) -> Option<bool> {
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::{CFTypeRef, TCFType};
    use core_foundation::dictionary::{CFDictionaryGetValue, CFDictionaryRef};
    use core_foundation::number::{CFNumber, CFNumberRef};
    use core_foundation::string::{CFString, CFStringRef};
    use std::os::raw::c_void;

    extern "C" {
        fn CFPreferencesCopyAppValue(key: CFStringRef, application_id: CFStringRef) -> CFTypeRef;
    }

    const ALLOW_NOTIFICATIONS: i64 = 1 << 25;

    unsafe {
        let key = CFString::new("apps");
        let domain = CFString::new("com.apple.ncprefs");
        let apps =
            CFPreferencesCopyAppValue(key.as_concrete_TypeRef(), domain.as_concrete_TypeRef());
        if apps.is_null() {
            return None;
        }
        let apps: CFArray<*const c_void> = CFArray::wrap_under_create_rule(apps as CFArrayRef);
        let bundle_key = CFString::new("bundle-id");
        let flags_key = CFString::new("flags");

        for item in apps.iter() {
            let entry = *item as CFDictionaryRef;
            if entry.is_null() {
                continue;
            }
            let bundle = CFDictionaryGetValue(
                entry,
                bundle_key.as_concrete_TypeRef() as *const c_void,
            );
            if bundle.is_null() {
                continue;
            }
            let bundle = CFString::wrap_under_get_rule(bundle as CFStringRef);
            if bundle.to_string() != bundle_id {
                continue;
            }

            let flags =
                CFDictionaryGetValue(entry, flags_key.as_concrete_TypeRef() as *const c_void);
            if flags.is_null() {
                return None;
            }
            let flags = CFNumber::wrap_under_get_rule(flags as CFNumberRef);
            return flags
                .to_i64()
                .map(|flags| flags & ALLOW_NOTIFICATIONS != 0);
        }
        None
    }
}

/// 读取系统通知授权状态，并给出直达本应用通知设置页的 URL。
fn notification_state(app: &AppHandle) -> DesktopNotificationState {
    #[cfg(target_os = "macos")]
    {
        let bundle_id = notification_owner(app);
        let status = match ncprefs_notifications_allowed(&bundle_id) {
            Some(true) => "granted",
            Some(false) => "denied",
            None => "unknown",
        };
        // macOS 13 起「通知」搬进了设置扩展，旧的 preference pane 不存在；
        // ?id= 是设置页用来定位具体 App 的未公开参数。
        let major = tauri_plugin_os::version()
            .to_string()
            .split('.')
            .next()
            .and_then(|major| major.parse::<u32>().ok())
            .unwrap_or(0);
        let base = if major >= 13 {
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        } else {
            "x-apple.systempreferences:com.apple.preference.notifications"
        };
        // 没有授权记录时系统设置里还看不到 Shui，带 id 会停在一个空页面。
        let settings_url = if status == "unknown" {
            base.to_string()
        } else {
            format!("{base}?id={bundle_id}")
        };
        return DesktopNotificationState {
            status: status.to_string(),
            bundle_id,
            settings_url,
        };
    }

    #[cfg(windows)]
    {
        DesktopNotificationState {
            status: "unknown".to_string(),
            bundle_id: app.config().identifier.clone(),
            settings_url: "ms-settings:notifications".to_string(),
        }
    }

    #[cfg(target_os = "linux")]
    {
        DesktopNotificationState {
            status: "unknown".to_string(),
            bundle_id: app.config().identifier.clone(),
            settings_url: String::new(),
        }
    }
}

#[tauri::command]
pub fn get_desktop_notification_state(app: AppHandle) -> DesktopNotificationState {
    notification_state(&app)
}

/// 打开系统通知设置。
///
/// 必须在 Rust 侧打开：前端 `openUrl` 走 opener 插件的命令通道，会先做
/// scheme 白名单校验，而 `opener:default` 只放行 http(s)/mailto/tel，
/// `x-apple.systempreferences:` 和 `ms-settings:` 都会被判 ForbiddenUrl。
/// 插件导出的 Rust 函数不经过这层 scope。
#[tauri::command]
pub fn open_desktop_notification_settings(app: AppHandle) -> Result<(), String> {
    let state = notification_state(&app);
    if state.settings_url.is_empty() {
        return Err("该平台请在系统设置中手动找到通知权限".to_string());
    }
    tauri_plugin_opener::open_url(&state.settings_url, None::<&str>)
        .map_err(|error| format!("打开通知设置失败：{error}"))
}

/// 发一条带记水按钮的提醒通知。立即返回，等待交互在独立线程里做。
#[tauri::command]
pub fn send_desktop_reminder_notification(
    app: AppHandle,
    title: String,
    body: String,
    amounts: Vec<u64>,
) -> Result<(), String> {
    configure_log(&app);

    let mut notification = notify_rust::Notification::new();
    notification.summary(&title).body(&body).auto_icon();

    // macOS 只给一个动作。两个及以上会被系统折叠成一个下拉按钮（还得单独设下拉标题），
    // 变成「点开下拉 → 再选一项」两步；单动作则渲染成真实按钮，一次点击就记上。
    // 因此 macOS 也不放「稍后再说」——它同样占一个动作位，会把按钮挤回下拉里，
    // 不想喝水直接关掉通知即可。
    #[cfg(target_os = "macos")]
    let action_count = {
        // 取最小档：万一误触，记的是最少的水量。
        let amount = amounts
            .iter()
            .copied()
            .filter(|amount| *amount > 0)
            .min()
            .unwrap_or(DEFAULT_DRINK_AMOUNT);
        notification.action(&drink_action_id(amount), &drink_action_label(amount));
        1
    };

    #[cfg(not(target_os = "macos"))]
    let action_count = {
        let mut count = 0;
        for amount in amounts.iter().copied().filter(|amount| *amount > 0) {
            notification.action(&drink_action_id(amount), &drink_action_label(amount));
            count += 1;
        }
        notification.action(SKIP_ACTION_ID, SKIP_ACTION_LABEL);
        count + 1
    };

    #[cfg(target_os = "macos")]
    {
        // 单动作走的是 MainButton::SingleAction，不经过下拉，`actions_label` 用不上。
        if let Err(error) = notify_rust::set_application(&notification_owner(&app)) {
            report(&format!("设置通知归属应用失败：{error}"));
        }
    }

    #[cfg(windows)]
    {
        use notify_rust::Urgency;
        // 见文件头注释：Critical 才能让 toast 常驻，进而保证按钮点击可回收。
        notification.urgency(Urgency::Critical);
        // 只有安装版才注册 AUMID；target/debug 下注册会让 toast 变成未知应用。
        if let Ok(exe) = tauri::utils::platform::current_exe() {
            let in_dev_dir = exe
                .parent()
                .map(|dir| {
                    let dir = dir.display().to_string();
                    dir.ends_with(r"\target\debug") || dir.ends_with(r"\target\release")
                })
                .unwrap_or(false);
            if !in_dev_dir {
                notification.app_id(&app.config().identifier);
            }
        }
    }

    let was_visible = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    let handler_app = app.clone();
    report(&format!("发送提醒通知（{action_count} 个动作）"));
    std::thread::Builder::new()
        .name("shui-notification".into())
        .spawn(move || {
            let handle = match notification.show() {
                Ok(handle) => handle,
                Err(error) => {
                    report(&format!("通知发送失败：{error}"));
                    return;
                }
            };
            let outcome = handle.wait_for_response(move |response: &NotificationResponse| {
                match response {
                    NotificationResponse::Action(action) => {
                        mark_action();
                        report(&format!("收到通知动作：{action}"));
                        match parse_drink_amount(action) {
                            Some(amount) => commit_drink(&handler_app, amount),
                            // 稍后再说：只关掉通知，不记账也不打扰。
                            None if action == SKIP_ACTION_ID => {}
                            None => report(&format!("未知的通知动作：{action}")),
                        }
                        restore_hidden_window(&handler_app, was_visible);
                    }
                    NotificationResponse::Default => {
                        // 点通知主体 = 用户想回到 App，这里与「点了记水按钮」区别对待。
                        if let Err(error) = crate::startup::show_main_window(&handler_app) {
                            report(&format!("唤回设置窗口失败：{error}"));
                        }
                    }
                    _ => {}
                }
            });
            if let Err(error) = outcome {
                report(&format!("等待通知交互结束失败：{error}"));
            }
        })
        .map_err(|error| format!("无法启动通知线程：{error}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drink_actions_round_trip() {
        assert_eq!(parse_drink_amount("drink-200"), Some(200));
        assert_eq!(parse_drink_amount("drink-50"), Some(50));
    }

    #[test]
    fn unrelated_actions_are_ignored() {
        assert_eq!(parse_drink_amount("skip"), None);
        assert_eq!(parse_drink_amount("tap"), None);
        assert_eq!(parse_drink_amount("drink-"), None);
        assert_eq!(parse_drink_amount("drink-0"), None);
        assert_eq!(parse_drink_amount("drink-abc"), None);
        assert_eq!(parse_drink_amount("drink-999999"), None);
    }

    #[test]
    fn labels_carry_the_verb() {
        assert_eq!(drink_action_label(100), "喝了 100ml");
        assert_eq!(drink_action_label(50), "喝了 50ml");
    }

    #[test]
    fn request_ids_are_unique_ascii_and_short() {
        let first = next_request_id(100);
        let second = next_request_id(100);
        assert_ne!(first, second);
        assert!(first.is_ascii());
        assert!(first.len() <= 128);
    }
}
