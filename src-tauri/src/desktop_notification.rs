//! 桌面三端（macOS / Windows / Linux）的提醒通知。
//!
//! 这里不走 `plugin-notification` 的 JS 通道，而是直接调用 `notify-rust`
//! 并在 Rust 侧处理点击，原因有三条，都是实测踩出来的：
//!
//! 1. **Windows 只在 toast 还在屏幕上时上报点击**（plugin 文档原文）。用它发送时
//!    通知一收进操作中心，点按钮就没有任何回调，表现为「点了没反应、没记录」。
//!    改由这里发送并给 `Urgency::Critical`（映射成 toast 的 `Scenario::Reminder`），
//!    toast 会常驻到用户处理为止，点击才稳定可回收。
//! 2. **macOS 把两个以上动作折叠成一个下拉按钮**。改成中文只能自己发；最终这里
//!    干脆只给 macOS 一个动作，省掉下拉、一次点击完成（见 `send_desktop_reminder_notification`）。
//! 3. **动作落盘不依赖 WebView**：记水在 Rust 里直接写库，再向前端广播事件。
//!    窗口隐藏、脚本被节流、Channel 掉线都不会丢记录。
//!
//! 记水成功后前端只负责两件事：刷新明细 + 补一声确认音（对齐 Android）。
//!
//! 通知正文与副标题也在这里生成：按今日完成度分档随机取文案，并带上「已喝 / 目标」
//! 进度，与 Android `ReminderReceiver.kt` 的口径保持一致。

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[cfg(not(target_os = "macos"))]
use notify_rust::NotificationResponse;
use tauri::{AppHandle, Emitter, Manager};

use crate::drink_store::save_drink;
use crate::reminder_session::{ClosedSession, Outcome};

/// 前端收到后刷新饮水明细并播放确认音。payload 是 `Receipt` 的 JSON。
pub const DRINK_RECORDED_EVENT: &str = "shui:drink-recorded";

const SKIP_ACTION_ID: &str = "skip";
/// Windows / Linux 的第四个按钮。macOS 走单按钮方案，多一个动作就会被折叠成下拉，所以不发。
#[cfg(not(target_os = "macos"))]
const SKIP_ACTION_LABEL: &str = "稍后再说";

/// macOS 单按钮的兜底档位：前端没给档位（或全为 0）时用它。
#[cfg(target_os = "macos")]
const DEFAULT_DRINK_AMOUNT: u64 = 50;

/// 按钮文案必须自带水量符号。
///
/// Windows / Linux 的 toast 按钮、Android 的通知按钮都是脱离正文单独展示的，
/// `100ml` 这种纯数量读不出是「加记」还是「目标」。三端统一为 `+50ml`，
/// 一眼就能看出是「加记这么多水」。macOS 只发一个动作，同样用这个文案。
pub fn drink_action_label(amount: u64) -> String {
    format!("+{amount}ml")
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
            // 桌面端通知 Action 是 WebView 不参与的一路，埋点在这里补齐，
            // 与 Android ReminderReceiver 的通知记水事件同名同参数。
            crate::desktop_analytics::log_event(
                app,
                "notification_action_drink",
                serde_json::json!({
                    "amount": amount,
                    "source": "notification",
                    "today_total_after": receipt.total,
                    "goal_reached_after": receipt.goal_reached
                }),
            );
            crate::desktop_analytics::log_drink(
                app,
                "notification",
                amount as i64,
                receipt.total as i64,
                receipt.goal as i64,
                receipt.goal_reached,
                true,
            );
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

/// 通知副标题：今日进度。与 Android 通知栏展示的文案一致。
///
/// 未设置目标时只展示已喝量，连一口都还没喝就不占副标题这一行。
fn progress_label(total: u64, goal: u64) -> String {
    if goal > 0 {
        let ratio = (total as f64 / goal as f64).clamp(0.0, 1.0);
        // 达标前最多显示 99%，避免 1999/2000 时看起来像已经完成。
        let percent = if total >= goal {
            100
        } else {
            ((ratio * 100.0) as u64).min(99)
        };
        format!("已喝 {total} / {goal}ml · {percent}%")
    } else if total > 0 {
        format!("今日已喝 {total}ml")
    } else {
        String::new()
    }
}

/// 提醒通知的文案池：按今日完成度分四档。
///
/// 与 Android `ReminderReceiver.kt` 的 `ReminderCopy` 逐条一致——固定文案用久了会被
/// 当成背景噪音直接划掉，进度不同给不同的鼓励也更贴合当下。改文案时两端要同步。
mod copy {
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    const START: [&str; 12] = [
        "新的一天从一杯水开始，来一杯吧",
        "刚起步，先喝口水润润嗓子",
        "身体刚开始补水，别停下",
        "现在喝一杯，今天会很轻松",
        "第一杯水永远最值，先从这杯开始",
        "还早，慢慢把节奏建立起来",
        "起身走走，顺便接杯水",
        "提醒一下：该补水了",
        "别等到口渴才喝，现在正好",
        "一小口水也是进步，来吧",
        "给身体开个好头，干杯",
        "先来一杯，给今天开个好头",
    ];

    const HALF: [&str; 12] = [
        "已经四分之一了，继续保持",
        "进度不错，再来一杯稳稳推进",
        "节奏起来了，别断",
        "喝一口，离目标更近一点",
        "身体正在变好，别停下来",
        "这一杯下去，状态会更清醒",
        "补水进行中，保持这个势头",
        "再补几杯，进度会更稳",
        "现在的你比刚起床时更水润了",
        "不必大口，小口多次最有效",
        "继续按节奏来，稳稳的",
        "记得喝水，也记得起身活动",
    ];

    const NEAR: [&str; 12] = [
        "已经过半，胜利在望",
        "再补几杯，今天就很稳了",
        "势头很好，别松懈",
        "今天的目标越来越近了",
        "继续喝，身体会感谢你",
        "过半的进度，值得再喝一杯",
        "保持住，这个节奏刚刚好",
        "再来一杯，向目标冲刺",
        "你已经比大多数人喝得多了",
        "喝口水，给自己一个小小的奖励",
        "补水过半，状态在线",
        "剩下的交给每一杯水",
    ];

    const ALMOST: [&str; 12] = [
        "只差最后几杯，别放弃",
        "快到目标了，一鼓作气",
        "胜利就在眼前，再来一杯",
        "最后冲刺，今天的目标马上达成",
        "已经很接近了，坚持一下",
        "再喝一杯就离目标更近了",
        "收尾阶段，稳稳喝完",
        "今天的你非常自律，继续",
        "最后这一段，交给这杯水",
        "差距不大了，喝完就达标",
        "保持住，马上就能完成目标",
        "再补一杯，今天就算圆满",
    ];

    /// 每档上一次用过的下标：连续两条不重复，固定文案更容易被当成噪音。
    static LAST: Mutex<[Option<usize>; 4]> = Mutex::new([None; 4]);

    pub(super) fn pick(ratio: f64) -> &'static str {
        let (bucket, pool): (usize, &'static [&'static str]) = if ratio >= 0.75 {
            (3, &ALMOST)
        } else if ratio >= 0.5 {
            (2, &NEAR)
        } else if ratio >= 0.25 {
            (1, &HALF)
        } else {
            (0, &START)
        };

        let mut index = random_index(pool.len());
        let mut last = LAST.lock().unwrap();
        if pool.len() > 1 && last[bucket] == Some(index) {
            index = (index + 1) % pool.len();
        }
        last[bucket] = Some(index);
        pool[index]
    }

    /// 不引入 rand：时间纳秒 + 自增序号混一遍，足够避免固定顺序。
    fn random_index(len: usize) -> usize {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);

        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.subsec_nanos() as u64)
            .unwrap_or(0);
        let mut state = nanos ^ seq.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        state ^= state >> 33;
        state = state.wrapping_mul(0xff51_afd7_ed55_8ccd);
        state ^= state >> 33;
        (state as usize) % len.max(1)
    }
}

/// 通知模式下的一次提醒也算进提醒统计。
///
/// 全屏提醒由 `reminder_session` 记账；系统通知没有会话概念，直接按同一条
/// `reminder-session-closed` 事件补一条，统计页才不会只统计全屏模式。
fn record_notification_outcome(app: &AppHandle, day: &str, started: Instant, confirmed: bool) {
    let closed = ClosedSession {
        day: day.to_string(),
        outcome: if confirmed {
            Outcome::Confirmed
        } else {
            Outcome::Skipped
        },
        display_seconds: started.elapsed().as_secs().min(30),
    };
    if let Err(error) = app.emit("reminder-session-closed", closed) {
        report(&format!("提醒统计事件广播失败：{error}"));
    }
}

/// `UNUserNotificationCenter` 会按应用把通知堆在通知中心里，这里用「已投递未处理」
/// 的标识队列限流：满 3 条就关掉最旧的一条，任意时刻最多保留 3 条。
#[cfg(target_os = "macos")]
mod delivered {
    use notify_rust::NotificationId;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    const LIMIT: usize = 3;
    static SENT: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

    /// 记下刚投递的通知标识；超出上限时关闭最旧的一条。
    /// 返回标识本身，供响应回调把它从队列里移除。
    pub(super) fn track(id: NotificationId) -> Option<String> {
        let NotificationId::Mac(id) = id else {
            return None;
        };
        track_mac(id)
    }

    /// 直接使用 mac-usernotifications 时传入的请求标识。
    pub(super) fn track_mac(id: String) -> Option<String> {
        let mut sent = SENT.lock().unwrap();
        if sent.len() >= LIMIT {
            if let Some(oldest) = sent.pop_front() {
                mac_usernotifications::blocking::close_delivered(&oldest);
            }
        }
        sent.push_back(id.clone());
        Some(id)
    }

    /// 用户已处理这条通知（点按钮 / 点主体 / 划掉），之后不必再清理它。
    pub(super) fn forget(id: Option<&str>) {
        let Some(id) = id else {
            return;
        };
        SENT.lock().unwrap().retain(|value| value != id);
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

/// 处理通知上的自定义动作（记水按钮 / 稍后再说）。返回是否完成记水。
fn handle_custom_action(app: &AppHandle, action: &str, was_visible: bool) -> bool {
    mark_action();
    report(&format!("收到通知动作：{action}"));
    let confirmed = match parse_drink_amount(action) {
        Some(amount) => {
            commit_drink(app, amount);
            true
        }
        // 稍后再说：只关掉通知，不记账也不打扰。
        None if action == SKIP_ACTION_ID => {
            crate::desktop_analytics::log_event(
                app,
                "notification_skipped",
                serde_json::json!({}),
            );
            false
        }
        None => {
            report(&format!("未知的通知动作：{action}"));
            false
        }
    };
    restore_hidden_window(app, was_visible);
    confirmed
}

/// 点通知主体：用户想回到 App，与「点了记水按钮」区别对待。
fn open_from_notification(app: &AppHandle) {
    crate::desktop_analytics::log_event(
        app,
        "notification_opened",
        serde_json::json!({ "cold_start": false }),
    );
    if let Err(error) = crate::startup::show_main_window(app) {
        report(&format!("唤回设置窗口失败：{error}"));
    }
}

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
/// 这条路径现在只用于 dev：正式运行时改用 `user_notification_authorization`。
/// 实测 macOS 27 上 ncprefs 不再随授权变化更新，用户开了权限也不会新增条目。
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

/// 读取 ncprefs 记录，映射成对外状态；拿不到记录就算 unknown。
#[cfg(target_os = "macos")]
fn ncprefs_status(bundle_id: &str) -> &'static str {
    match ncprefs_notifications_allowed(bundle_id) {
        Some(true) => "granted",
        Some(false) => "denied",
        None => "unknown",
    }
}

/// 提前加载 UserNotifications，保证 `Class::get` 能查到 UNUserNotificationCenter。
#[cfg(target_os = "macos")]
#[link(name = "UserNotifications", kind = "framework")]
extern "C" {}

/// 用官方 UserNotifications 读取本 App 的通知授权状态。
///
/// 这是系统设置「通知 → Shui」那个开关的真正数据源；`com.apple.ncprefs`
/// 的 `apps` 数组在 macOS 27 上已经不再随授权更新（开了权限也不会新增条目）。
/// 返回值是 `UNAuthorizationStatus` 原始值：
/// 0 未决定 / 1 拒绝 / 2 允许 / 3 临时允许 / 4 临时允许（App Clip）。
///
/// 只能在正式的 .app 进程里调用：dev 下进程由 Terminal 拉起、没有自己的 bundle，
/// `currentNotificationCenter` 会直接抛 ObjC 异常把进程带崩。
#[cfg(target_os = "macos")]
fn user_notification_authorization() -> Option<i64> {
    use block::ConcreteBlock;
    use objc::runtime::{Class, Object};
    use objc::{msg_send, sel, sel_impl};
    use std::sync::mpsc;
    use std::time::Duration;

    unsafe {
        let class = Class::get("UNUserNotificationCenter")?;
        let center: *mut Object = msg_send![class, currentNotificationCenter];
        if center.is_null() {
            return None;
        }

        let (sender, receiver) = mpsc::channel();
        let completion = ConcreteBlock::new(move |settings: *mut Object| {
            let status: i64 = if settings.is_null() {
                -1
            } else {
                msg_send![settings, authorizationStatus]
            };
            let _ = sender.send(status);
        })
        .copy();
        let _: () =
            msg_send![center, getNotificationSettingsWithCompletionHandler: &*completion];

        // 回调是毫秒级；超过 2 秒就当作读不到，让调用方退回 ncprefs。
        match receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(status) if status >= 0 => Some(status),
            _ => None,
        }
    }
}

/// Windows 的通知开关记在注册表里（HKCU）：
/// - 全局：`...\PushNotifications` 的 `ToastEnabled`，0 表示所有 toast 都被关掉；
/// - 单个 App：`...\Notifications\Settings\<AUMID>` 的 `Enabled`，0 表示该 App 被关闭。
///
/// 两者都是 DWORD，键不存在说明系统还没写过这项设置（默认允许），返回 None。
#[cfg(windows)]
fn registry_dword(path: &str, name: &str) -> Option<u32> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_DWORD,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let path = wide(path);
    let name = wide(name);
    let mut key = HKEY::default();
    unsafe {
        if RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(path.as_ptr()), 0, KEY_READ, &mut key)
            != ERROR_SUCCESS
        {
            return None;
        }
        let mut kind = REG_DWORD;
        let mut data = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        let result = RegQueryValueExW(
            key,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            Some(&mut data as *mut u32 as *mut u8),
            Some(&mut size),
        );
        let _ = RegCloseKey(key);
        if result == ERROR_SUCCESS && kind == REG_DWORD && size >= 4 {
            Some(data)
        } else {
            None
        }
    }
}

/// 读 Windows 的通知授权：先看全局总开关，再看当前 AUMID 自己的开关。
///
/// 注意 dev 构建不注册 AUMID（见 `send_desktop_reminder_notification`），
/// 此时通常查不到本 App 的注册表项，会落到 unknown。
#[cfg(windows)]
fn windows_notification_status(identifier: &str) -> &'static str {
    const PUSH_NOTIFICATIONS: &str =
        r"Software\Microsoft\Windows\CurrentVersion\PushNotifications";

    if registry_dword(PUSH_NOTIFICATIONS, "ToastEnabled") == Some(0) {
        return "denied";
    }
    let app_key =
        format!(r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\{identifier}");
    match registry_dword(&app_key, "Enabled") {
        Some(0) => "denied",
        Some(_) => "granted",
        None => "unknown",
    }
}

/// 读取系统通知授权状态，并给出直达本应用通知设置页的 URL。
fn notification_state(app: &AppHandle) -> DesktopNotificationState {
    #[cfg(target_os = "macos")]
    {
        let bundle_id = notification_owner(app);
        let status = if tauri::is_dev() {
            ncprefs_status(&bundle_id)
        } else {
            match user_notification_authorization() {
                Some(2) | Some(3) | Some(4) => "granted",
                Some(1) => "denied",
                Some(0) => "unknown",
                _ => ncprefs_status(&bundle_id),
            }
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
        let identifier = app.config().identifier.clone();
        DesktopNotificationState {
            status: windows_notification_status(&identifier).to_string(),
            bundle_id: identifier,
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
///
/// 标题、正文、副标题都在这里生成：正文按今日完成度从文案池随机取，副标题带
/// 「已喝 / 目标」进度，与 Android 通知栏同一套口径。前端只负责告诉这里「哪几档水量」。
#[tauri::command]
pub fn send_desktop_reminder_notification(app: AppHandle, amounts: Vec<u64>) -> Result<(), String> {
    configure_log(&app);

    let (total, goal) = crate::drink_store::today_progress(&app);
    let ratio = if goal > 0 {
        (total as f64 / goal as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let mut notification = notify_rust::Notification::new();
    let body = copy::pick(ratio);
    notification
        .summary("该喝水啦")
        .body(&body)
        .auto_icon();
    let progress = progress_label(total, goal);
    if !progress.is_empty() {
        // subtitle 在 macOS / Windows 上都有对应的展示位；Linux 会忽略。
        notification.subtitle(&progress);
    }

    // macOS 只给一个动作。两个及以上会被系统折叠成一个下拉按钮（还得单独设下拉标题），
    // 变成「点开下拉 → 再选一项」两步；单动作则渲染成真实按钮，一次点击就记上。
    // 因此 macOS 也不放「稍后再说」——它同样占一个动作位，会把按钮挤回下拉里，
    // 不想喝水直接关掉通知即可。
    #[cfg(target_os = "macos")]
    let (action_count, mac_action_id, mac_action_label) = {
        // 取最小档：万一误触，记的是最少的水量。
        let amount = amounts
            .iter()
            .copied()
            .filter(|amount| *amount > 0)
            .min()
            .unwrap_or(DEFAULT_DRINK_AMOUNT);
        let id = drink_action_id(amount);
        let label = drink_action_label(amount);
        notification.action(&id, &label);
        (1, id, label)
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
        // UNUserNotificationCenter 必须先进系统授权列表才允许投递；
        // 已授权时这次调用是空操作，只在首次触发系统弹窗。
        request_notification_authorization_once();
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

    let day = chrono::Local::now().format("%Y%m%d").to_string();
    report(&format!("发送提醒通知（{action_count} 个动作）"));

    #[cfg(target_os = "macos")]
    {
        let handler_app = app.clone();
        std::thread::Builder::new()
            .name("shui-notification".into())
            .spawn(move || {
                let started = Instant::now();
                let mut mac_notification = mac_usernotifications::Notification::new()
                    .title("该喝水啦")
                    .message(body);
                if !progress.is_empty() {
                    mac_notification = mac_notification.subtitle(progress);
                }
                mac_notification = mac_notification.action(
                    mac_usernotifications::Action::button(mac_action_id, mac_action_label),
                );

                // 必须用异步 API：notify-rust 的同步 show() 会走
                // block_on_current，在 Tauri 主线程非 waiting 时直接报
                // Mainthread not running，通知根本发不出去。
                tauri::async_runtime::block_on(async move {
                    let handle = match mac_notification.send().await {
                        Ok(handle) => {
                            crate::desktop_analytics::log_event(
                                &handler_app,
                                "notification_shown",
                                serde_json::json!({ "trigger": "desktop" }),
                            );
                            handle
                        }
                        Err(error) => {
                            report(&format!("通知发送失败：{error}"));
                            crate::desktop_analytics::log_event(
                                &handler_app,
                                "notification_shown_failed",
                                serde_json::json!({
                                    "trigger": "desktop",
                                    "reason": "send_failed"
                                }),
                            );
                            return;
                        }
                    };
                    let notification_id =
                        delivered::track_mac(handle.notification_id().to_string());
                    let response = match handle.response().await {
                        Ok(response) => response,
                        Err(error) => {
                            report(&format!("等待通知交互结束失败：{error}"));
                            delivered::forget(notification_id.as_deref());
                            record_notification_outcome(
                                &handler_app,
                                &day,
                                started,
                                false,
                            );
                            return;
                        }
                    };
                    let confirmed = if response.is_default_action() {
                        open_from_notification(&handler_app);
                        false
                    } else if response.is_dismiss_action()
                        || response.close_reason.is_some()
                    {
                        false
                    } else {
                        handle_custom_action(
                            &handler_app,
                            &response.action_identifier,
                            was_visible,
                        )
                    };
                    record_notification_outcome(&handler_app, &day, started, confirmed);
                    delivered::forget(notification_id.as_deref());
                });
            })
            .map_err(|error| format!("无法启动通知线程：{error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let handler_app = app.clone();
        std::thread::Builder::new()
            .name("shui-notification".into())
            .spawn(move || {
                let started = Instant::now();

                let handle = match notification.show() {
                    Ok(handle) => {
                        crate::desktop_analytics::log_event(
                            &handler_app,
                            "notification_shown",
                            serde_json::json!({ "trigger": "desktop" }),
                        );
                        handle
                    }
                    Err(error) => {
                        report(&format!("通知发送失败：{error}"));
                        crate::desktop_analytics::log_event(
                            &handler_app,
                            "notification_shown_failed",
                            serde_json::json!({
                                "trigger": "desktop",
                                "reason": "send_failed"
                            }),
                        );
                        return;
                    }
                };
                let outcome =
                    handle.wait_for_response(move |response: &NotificationResponse| {
                        let confirmed = match response {
                            NotificationResponse::Action(action) => {
                                handle_custom_action(&handler_app, action, was_visible)
                            }
                            NotificationResponse::Default => {
                                open_from_notification(&handler_app);
                                false
                            }
                            _ => false,
                        };
                        record_notification_outcome(&handler_app, &day, started, confirmed);
                    });
                if let Err(error) = outcome {
                    report(&format!("等待通知交互结束失败：{error}"));
                }
            })
            .map_err(|error| format!("无法启动通知线程：{error}"))?;
    }

    Ok(())
}

/// macOS：主动请求一次通知授权，让「系统设置 → 通知」里出现 Shui。
///
/// 默认的 `NSUserNotificationCenter` 只会在首次投递时被动触发系统弹窗，代码里
/// 没有别的时机能确保这个开关被创建出来。这里 fire-and-forget：用户在系统弹窗里
/// 选完之后，设置页靠窗口重新聚焦时刷新状态即可。
///
/// dev 模式下进程没有自己的 bundle，调用 `currentNotificationCenter` 会抛 ObjC
/// 异常把进程带崩，所以只在正式包里调用。
#[cfg(target_os = "macos")]
fn request_notification_authorization() {
    use block::ConcreteBlock;
    use objc::runtime::{Class, Object};
    use objc::{msg_send, sel, sel_impl};

    if tauri::is_dev() {
        return;
    }
    unsafe {
        let Some(class) = Class::get("UNUserNotificationCenter") else {
            return;
        };
        let center: *mut Object = msg_send![class, currentNotificationCenter];
        if center.is_null() {
            return;
        }
        // UNAuthorizationOptionBadge | Sound | Alert
        let options: core::ffi::c_ulong = 1 | 2 | 4;
        let completion =
            ConcreteBlock::new(|_granted: core::ffi::c_char, _error: *mut Object| {}).copy();
        let _: () = msg_send![
            center,
            requestAuthorizationWithOptions: options
            completionHandler: &*completion
        ];
    }
}

/// 进程内只请求一次授权：提醒可能每 10 分钟发一次，没必要反复调用。
#[cfg(target_os = "macos")]
fn request_notification_authorization_once() {
    static REQUESTED: std::sync::Once = std::sync::Once::new();
    REQUESTED.call_once(request_notification_authorization);
}

/// 发一条没有任何按钮的测试通知，用来验证权限链路是否打通。
///
/// 和正式提醒走同一个后端（macOS 上是 `UNUserNotificationCenter`）。
#[tauri::command]
pub fn send_desktop_test_notification(app: AppHandle) -> Result<(), String> {
    configure_log(&app);

    #[cfg(target_os = "macos")]
    request_notification_authorization();

    let _ = &app;
    std::thread::Builder::new()
        .name("shui-notification-test".into())
        .spawn(move || {
            // 系统授权弹窗需要用户先点一下，留一点时间再投递，避免被直接丢弃。
            std::thread::sleep(std::time::Duration::from_millis(800));

            #[cfg(target_os = "macos")]
            {
                let notification = mac_usernotifications::Notification::new()
                    .title("通知正常")
                    .message("以后提醒会以这个形式出现，看到这一条说明链路通了");
                match tauri::async_runtime::block_on(notification.send()) {
                    Ok(_handle) => {
                        report("发送测试通知");
                        crate::desktop_analytics::log_event(
                            &app,
                            "notification_shown",
                            serde_json::json!({ "trigger": "test" }),
                        );
                    }
                    Err(error) => report(&format!("测试通知发送失败：{error}")),
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                let mut notification = notify_rust::Notification::new();
                notification
                    .summary("通知正常")
                    .body("以后提醒会以这个形式出现，看到这一条说明链路通了")
                    .auto_icon();

                match notification.show() {
                    Ok(handle) => {
                        report("发送测试通知");
                        crate::desktop_analytics::log_event(
                            &app,
                            "notification_shown",
                            serde_json::json!({ "trigger": "test" }),
                        );
                        drop(handle);
                    }
                    Err(error) => report(&format!("测试通知发送失败：{error}")),
                }
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
    fn labels_match_android_notification_actions() {
        assert_eq!(drink_action_label(100), "+100ml");
        assert_eq!(drink_action_label(50), "+50ml");
    }

    #[test]
    fn progress_label_matches_android_rules() {
        // 达标前最多 99%，避免看起来像已经完成。
        assert_eq!(progress_label(1999, 2000), "已喝 1999 / 2000ml · 99%");
        assert_eq!(progress_label(1000, 2000), "已喝 1000 / 2000ml · 50%");
        assert_eq!(progress_label(2000, 2000), "已喝 2000 / 2000ml · 100%");
        // 没设目标只展示已喝量；一口没喝时副标题留空。
        assert_eq!(progress_label(250, 0), "今日已喝 250ml");
        assert_eq!(progress_label(0, 0), "");
    }

    #[test]
    fn copy_pool_never_repeats_back_to_back() {
        let first = copy::pick(0.1);
        let second = copy::pick(0.1);
        assert_ne!(first, second);
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
