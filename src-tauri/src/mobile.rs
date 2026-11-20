//! Android 桥接层。
//!
//! 桌面用托盘 + 多窗口 + 线程计时；Android 换成：
//!  - 前台：Rust 计时线程 emit `timer-complete`，App 内全屏 overlay 承接；
//!  - 后台：Kotlin AlarmManager + 通知 Action（`mobile-reminder` / `native-drink`）；
//!  - 通知里记的水先落 `pending_drinks.json`，由这里 drain 进同一套 store。
//! 业务代码（饮水记录、统计、备份校验）全部复用，没有第二套口径。

use crate::core::store::settings::AppSettings;
use crate::data_backup::{self, ImportPreview};
use crate::drink_store;
use crate::reminder_session::{self, Outcome};
use crate::timer::IS_RUNNING;
use chrono::{DateTime, Local, TimeZone};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;

/// 由 `lib.rs` 的自定义 Android 插件注册，供所有 command 调用 Kotlin 侧能力。
pub struct MobileBridge<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

fn native<T: DeserializeOwned>(
    app: &tauri::AppHandle,
    command: &str,
    payload: impl Serialize,
) -> Result<T, String> {
    let bridge = app
        .try_state::<MobileBridge<tauri::Wry>>()
        .ok_or_else(|| "Android 原生服务未就绪，请重启应用".to_string())?;
    bridge
        .0
        .run_mobile_plugin::<T>(command, payload)
        .map_err(|error| error.to_string())
}

/// 把 config_store 里原始配置透传给 Kotlin，由原生侧自己判断工作日/时段/勿扰。
fn schedule_payload(app: &tauri::AppHandle) -> Value {
    let Ok(store) = app.store("config_store.json") else {
        return json!({ "alert": {}, "general": {}, "anchorMs": 0 });
    };
    json!({
        "alert": store.get("alert").unwrap_or_else(|| json!({})),
        "general": store.get("general").unwrap_or_else(|| json!({})),
        // 账本是唯一锚点：Kotlin 用它 + gap 推下一次，重复调用结果不变。
        // 0 表示首次安装/账本缺失，由原生侧回落到「当前时间」。
        "anchorMs": last_reminder_at(app),
    })
}

pub fn sync_schedule(app: &tauri::AppHandle) {
    let _ = native::<Value>(app, "schedule", schedule_payload(app));
}

/// 与 Kotlin ReminderScheduler 共享的「上次提醒时间」账本：内容为毫秒时间戳。
/// 前台全屏与后台通知写同一份账本，任一路触发后另一路在 gap 内不再重复；
/// 同时取代前台 timer 里会被后台冻结时长一次性撑爆的 elapsed 累加。
const LAST_REMINDER_FILE: &str = "last_reminder_at.txt";

fn ledger_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(LAST_REMINDER_FILE))
}

fn last_reminder_at(app: &tauri::AppHandle) -> i64 {
    ledger_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .unwrap_or(0)
}

fn mark_reminder(app: &tauri::AppHandle) {
    let Some(path) = ledger_path(app) else { return };
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    // 写临时文件再原子替换，避免与 Kotlin 侧并发写时读到半截数字。
    let tmp = path.with_extension("tmp");
    let now = Local::now().timestamp_millis();
    if std::fs::write(&tmp, now.to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// 水量真正发生变化后重置提醒节奏：把账本锚点改到「现在」，并立刻让原生
/// 按 anchorMs + gap 重排。这样今日页的「预计下一杯」会跟着每次记水更新。
///
/// 只在 receipt.added / undone 为真时调用：Rust 侧 requestId 幂等命中时
/// 水量没变，若也重排，连续点同一按钮会把闹钟无限往后推。
pub fn reanchor_after_drink(app: &tauri::AppHandle) -> i64 {
    mark_reminder(app);
    sync_schedule(app);
    // 返回重锚后的绝对时间：调用方（record_drink / 通知回灌）可以直接回给前端，
    // 让「预计下一杯」与账本在同一次往返里保持一致。
    next_reminder_at(app)
}

pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 前台计时：以共享账本为唯一时间锚点。WebView 活着时给出全屏提醒；
    // 退后台由 Kotlin 闹钟兜底，两者写同一份账本，互不重复。
    let timer_handle = app.clone();
    std::thread::Builder::new()
        .name("mobile-timer".into())
        .spawn(move || loop {
            if !IS_RUNNING.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(500));
                continue;
            }
            // 首次启动把账本初始化为当前时间，避免一进 App 就补弹历史提醒。
            if last_reminder_at(&timer_handle) == 0 {
                mark_reminder(&timer_handle);
            }
            while IS_RUNNING.load(Ordering::SeqCst) {
                let settings = AppSettings::load_from_store::<tauri::Wry>(&timer_handle);
                // 全屏提醒关掉后前台计时器不该再跑：它只为全屏页服务，一旦到期
                // 会写共享账本，反而把后台闹钟那一通道也抑制掉。
                //
                // gap==1 是测试档：绕过工作日/时段/达标判断（否则下班后测试
                // 永远等不到），但仍尊重「暂停」与「全屏提醒」两个显式开关。
                let test_gap = settings.meta.gap_minutes == 1;
                let allowed = if test_gap {
                    !settings.is_paused && settings.is_full_screen
                } else {
                    settings.should_run_timer() && settings.is_full_screen
                };
                if !allowed {
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
                let now_ms = Local::now().timestamp_millis();
                let gap_ms = settings.gap as i64 * 1000; // AppSettings.gap 以秒存储
                if now_ms - last_reminder_at(&timer_handle) >= gap_ms {
                    // 到点后先问原生：此刻是否真的能弹 App 内全屏（前台+亮屏+未锁屏）。
                    // 裁决权完全在 Kotlin；Rust 只在明确拿到 "overlay" 时才动手。
                    //
                    // 关键：native 失败一律当作 "defer"，绝不兜底成 overlay。
                    // 后台 native 调用一旦失败（插件未就绪 / WebView 冻结导致 IPC 异常）
                    // 若兜底 overlay，会写账本 + 把 timer-complete 投给冻结的 WebView：
                    // 账本被抢写 → AlarmManager 判「间隔内已提醒」吞掉后台通知；
                    // 事件积压 → 用户打开 App 才弹全屏。这正是「后台没通知、打开才弹窗」。
                    let mode = native::<ReminderDelivery>(
                        &timer_handle,
                        "deliverReminder",
                        json!({}),
                    )
                    .map(|delivery| delivery.mode)
                    .unwrap_or_else(|_| "defer".to_string());
                    match mode.as_str() {
                        "overlay" => {
                            // Kotlin 已确认 WebView 在前台可见可交互：弹全屏。
                            // 先发事件再写账本，保证「提醒真的投递了才盖戳」；账本只由
                            // 这一路写，AlarmManager 随后读到新账本便不再补发通知。
                            IS_RUNNING.store(false, Ordering::SeqCst);
                            reminder_session::begin();
                            let _ = timer_handle.emit("timer-complete", ());
                            mark_reminder(&timer_handle);
                            // 全屏已承接本次提醒，把原生闹钟重排到账本 + gap。
                            sync_schedule(&timer_handle);
                            break;
                        }
                        "notification" => {
                            // Kotlin 当场发了通知并写好账本；Rust 只刷新下次时间。
                            sync_schedule(&timer_handle);
                            continue;
                        }
                        _ => {
                            // "defer"（含 native 失败）：Rust 完全放手——不写账本、
                            // 不 emit。账本留给 AlarmManager，由它独占后台通知这一路。
                            // 拉长空转间隔，避免每秒重复问一次原生。
                            std::thread::sleep(Duration::from_secs(5));
                            continue;
                        }
                    }
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        })?;

    // 通知 Action 在 WebView 未启动时写下的饮水记录，统一在这里回灌。
    let drain_handle = app.clone();
    std::thread::Builder::new()
        .name("pending-drinks".into())
        .spawn(move || loop {
            drain_pending_drinks(&drain_handle);
            std::thread::sleep(Duration::from_secs(2));
        })?;

    // 首次安装：先把默认配置写进 config_store，再下发排期。
    //
    // 顺序反了会出现「今日页说还有 30 分钟、设置页写着 20 分钟」：sync_schedule
    // 拿到的 alert 是空对象，Kotlin 只能按自己的兜底值排闹钟；随后上面的计时
    // 线程才调 load_from_store 写入默认 gap，前端读到的就是另一个数，而此刻
    // 没有任何东西会触发重排。load_from_store 内部只在 store 为空时写入默认值，
    // 已安装过的用户不受影响。
    AppSettings::load_from_store::<tauri::Wry>(app);
    sync_schedule(app);
    Ok(())
}

#[derive(Debug, Deserialize)]
struct ReminderDelivery {
    #[serde(default)]
    mode: String,
}

#[derive(Debug, Deserialize)]
struct PendingDrink {
    #[serde(default)]
    amount: u64,
    #[serde(default, rename = "requestId")]
    request_id: String,
    /// 点击通知按钮的时刻（毫秒）。进程被杀后这批记录要等 App 重新启动才回灌，
    /// 落库必须用它而不是回灌时刻；旧版本写下的队列没有这个字段，默认 0。
    #[serde(default)]
    timestamp: i64,
}

/// 回灌记录的落库时间：优先用点击时刻，缺失或不合理时退回当前时间。
///
/// 晚于当前时间（设备校时把过去的记录推到未来）会让明细出现「还没到就先记上」，
/// 所以只接受不超过 1 分钟时钟偏差的时间；其余情况按回灌时刻兜底。
fn pending_recorded_at(millis: i64, now: DateTime<Local>) -> DateTime<Local> {
    if millis <= 0 {
        return now;
    }
    match Local.timestamp_millis_opt(millis) {
        chrono::LocalResult::Single(time) if time <= now + chrono::Duration::minutes(1) => time,
        _ => now,
    }
}

fn drain_pending_drinks(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let path = dir.join("pending_drinks.json");
    if !path.exists() {
        return;
    }
    // 先改名，避免与 Kotlin 侧并发追加相互覆盖。
    let processing = dir.join("pending_drinks.processing.json");
    if std::fs::rename(&path, &processing).is_err() {
        return;
    }
    let raw = match std::fs::read_to_string(&processing) {
        Ok(raw) => raw,
        Err(_) => return,
    };
    let items = serde_json::from_str::<Vec<PendingDrink>>(&raw).unwrap_or_default();
    let now = Local::now();
    let mut recorded = false;
    for item in items {
        if item.amount == 0 || item.amount > 5000 {
            continue;
        }
        let id = if item.request_id.is_empty() {
            format!(
                "native-{}",
                Local::now().timestamp_nanos_opt().unwrap_or_default()
            )
        } else {
            item.request_id
        };
        // 用点击时刻落库：进程被杀期间攒下的多条记录各自有各自的真实时间，
        // 不能统一记成回灌这一刻。
        let at = pending_recorded_at(item.timestamp, now);
        if drink_store::save_drink_at(app, item.amount, &format!("manual:{id}"), at).is_ok() {
            recorded = true;
        }
    }
    let _ = std::fs::remove_file(&processing);
    if recorded {
        // 通知栏记的水同样是一次真实补水：必须把账本锚点重置到「现在」，
        // 否则下一杯仍按「上次提醒 + gap」算，用户刚喝完 5 分钟就会又被提醒。
        // 这一步要在 emit 之前完成，前端收到事件后读到的才是新排期。
        reanchor_after_drink(app);
        let _ = app.emit("drink-recorded-from-notification", ());
    }
}

// ---------------------------------------------------------------------------
// commands（只注册在 Android 的 invoke_handler 里）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn call_reminder(app: tauri::AppHandle) -> bool {
    if !reminder_session::begin() {
        return true;
    }
    let _ = app.emit("mobile-reminder", ());
    true
}

/// Kotlin 闹钟/通知唤醒 App 时调用，保证通知那一路也计入提醒统计。
#[tauri::command]
pub fn begin_mobile_reminder() -> bool {
    reminder_session::begin()
}

#[tauri::command]
pub fn finalize_mobile_reminder(app: tauri::AppHandle, outcome: Option<Outcome>) {
    reminder_session::close(&app, None, outcome.unwrap_or(Outcome::Skipped));
    IS_RUNNING.store(true, Ordering::SeqCst);
    sync_schedule(&app);
}

#[tauri::command]
pub fn reset_timer(app: tauri::AppHandle) {
    IS_RUNNING.store(true, Ordering::SeqCst);
    sync_schedule(&app);
}

#[tauri::command]
pub fn pause_timer(app: tauri::AppHandle) {
    IS_RUNNING.store(false, Ordering::SeqCst);
    let _ = native::<Value>(&app, "cancel", json!({}));
}

#[tauri::command]
pub fn start_timer(app: tauri::AppHandle) {
    IS_RUNNING.store(true, Ordering::SeqCst);
    sync_schedule(&app);
}

/// 提醒页「测试通知」：Android 统一走自定义原生插件。
/// `plugin-notification 2.2.2` 在 Android 上注册的 Action 会丢失 id/title，
/// 因此不能让 JS 通道发出一条「按钮点不动」的通知。
#[tauri::command]
pub fn send_mobile_notification(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "showNotification", json!({})).map(|_| ())
}

/// 达成每日目标后的系统通知：前台记录走这条，后台/通知 Action 记录由闹钟回调补发。
#[tauri::command]
pub fn show_goal_notification(
    app: tauri::AppHandle,
    total: u32,
    goal: u32,
) -> Result<(), String> {
    native::<Value>(
        &app,
        "showGoalNotification",
        json!({ "total": total, "goal": goal }),
    )
    .map(|_| ())
}

/// 设置页保存配置后显式重建原生闹钟。
#[tauri::command]
pub fn sync_reminder_schedule(app: tauri::AppHandle) -> Result<(), String> {
    let payload = schedule_payload(&app);
    native::<Value>(&app, "schedule", payload).map(|_| ())
}

/// 只同步配置给原生（音效、通知、目标等），不重排闹钟。
/// 不改变节奏的开关也必须走这里，否则 Kotlin 的通知/音效判断会读到旧配置。
#[tauri::command]
pub fn sync_reminder_config(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "saveConfig", schedule_payload(&app)).map(|_| ())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextReminderState {
    /// 原生已排定的下一次提醒（毫秒时间戳）；0 表示当前没有可用的下一次。
    pub next_at: i64,
    /// 「暂停提醒」时原生会撤掉闹钟，返回 0。
    pub paused: bool,
}

/// 今日页「预计下一杯」：返回原生侧真实排定的绝对时间。
/// 前端不再按「当前时间 + gap」现算，因此重渲染不会让文案跳动。
#[tauri::command]
pub fn get_next_reminder(app: tauri::AppHandle) -> Result<NextReminderState, String> {
    native::<NextReminderState>(&app, "nextReminder", json!({}))
}

/// 给 Receipt 用的轻量版本：只取下一次时刻，失败按「没有」处理。
///
/// 记水后紧接着调，拿到的是重锚后的新值，前端可以直接用它刷新「预计下一杯」，
/// 不必再走 emitRefresh → get_next_reminder 的往返（那条路中间有一拍延迟，
/// 1 分钟测试档下会明显看到文案落后）。
pub fn next_reminder_at(app: &tauri::AppHandle) -> i64 {
    native::<NextReminderState>(app, "nextReminder", json!({}))
        .map(|state| state.next_at)
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
struct ExactAlarmResult {
    granted: bool,
}

/// Android 12+ (API 31+) 精确闹钟需要用户单独授权；低版本恒为 true。
#[tauri::command]
pub fn is_exact_alarm_granted(app: tauri::AppHandle) -> Result<bool, String> {
    native::<ExactAlarmResult>(&app, "isExactAlarmGranted", json!({}))
        .map(|value| value.granted)
}

#[derive(Debug, Deserialize, Serialize)]
pub struct NotificationPermissionState {
    pub granted: bool,
    /// 系统是否还会弹授权框。Android 13+ 用户拒绝两次后变 false，
    /// 此后 requestPermissions 静默返回 denied，只能引导去系统设置。
    #[serde(rename = "canRequest")]
    pub can_request: bool,
}

#[tauri::command]
pub fn notification_permission_state(
    app: tauri::AppHandle,
) -> Result<NotificationPermissionState, String> {
    native::<NotificationPermissionState>(&app, "notificationPermissionState", json!({}))
}

#[tauri::command]
pub fn request_notification_permission(
    app: tauri::AppHandle,
    source: Option<String>,
) -> Result<(), String> {
    native::<Value>(
        &app,
        "requestNotificationPermission",
        json!({ "source": source.unwrap_or_else(|| "unknown".to_string()) }),
    )
    .map(|_| ())
}

// ───────────────────────── Firebase 埋点桥 ─────────────────────────
// 事件与参数由 Kotlin AnalyticsTracker 统一清洗、计数并写入 user properties。
// 这里只做透传，业务侧（JS/原生）不直接依赖 Firebase SDK。

#[tauri::command]
pub fn analytics_log(
    app: tauri::AppHandle,
    name: String,
    params: Option<Value>,
) -> Result<(), String> {
    native::<Value>(
        &app,
        "logAnalyticsEvent",
        json!({ "name": name, "params": params.unwrap_or_else(|| json!({})) }),
    )
    .map(|_| ())
}

#[tauri::command]
pub fn analytics_sync_properties(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "syncAnalyticsProperties", json!({})).map(|_| ())
}

#[tauri::command]
pub fn analytics_is_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    native::<Value>(&app, "analyticsIsEnabled", json!({}))
        .map(|value| value.get("enabled").and_then(Value::as_bool).unwrap_or(true))
}

#[tauri::command]
pub fn analytics_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    native::<Value>(&app, "setAnalyticsEnabled", json!({ "enabled": enabled })).map(|_| ())
}

#[tauri::command]
pub fn analytics_record_exception(
    app: tauri::AppHandle,
    message: Option<String>,
    stack: Option<String>,
    screen: Option<String>,
) -> Result<(), String> {
    native::<Value>(
        &app,
        "recordAnalyticsException",
        json!({
            "message": message.unwrap_or_default(),
            "stack": stack.unwrap_or_default(),
            "screen": screen.unwrap_or_default()
        }),
    )
    .map(|_| ())
}

#[tauri::command]
pub fn open_exact_alarm_settings(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "openExactAlarmSettings", json!({})).map(|_| ())
}

#[derive(Debug, Deserialize)]
struct BatterySettingsResult {
    result: String,
}

#[derive(Debug, Deserialize)]
struct PendingReminderFlag {
    pending: bool,
}

#[tauri::command]
pub fn open_battery_settings(app: tauri::AppHandle) -> Result<String, String> {
    native::<BatterySettingsResult>(&app, "openBatterySettings", json!({}))
        .map(|value| value.result)
}

#[derive(Debug, Deserialize)]
struct BatteryIgnoredResult {
    granted: bool,
}

/// 是否已加入电池优化白名单；未加入时国产 ROM 会冻结后台提醒。
#[tauri::command]
pub fn is_battery_optimization_ignored(app: tauri::AppHandle) -> Result<bool, String> {
    native::<BatteryIgnoredResult>(&app, "isBatteryOptimizationIgnored", json!({}))
        .map(|value| value.granted)
}

/// 通知权限已开启时，用户仍可能想去系统设置调整或关闭。
#[tauri::command]
pub fn open_notification_settings(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "openNotificationSettings", json!({})).map(|_| ())
}

/// 通知链路的可读状态：横幅（渠道重要度）与锁屏可见性都由它判定。
/// 系统「锁屏显示所有内容」「允许横幅」两个开关没有公开 API，只能引导。
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationHealth {
    pub channel_id: String,
    pub channel_exists: bool,
    /// NotificationManager.IMPORTANCE_*；-1 表示渠道尚未创建。
    pub channel_importance: i32,
    /// Notification.VISIBILITY_*；-1 表示渠道尚未创建。
    pub channel_lockscreen: i32,
    /// 渠道重要度是否达到可弹横幅的 HIGH。
    pub heads_up: bool,
    /// 渠道锁屏可见性是否为 PUBLIC。
    pub lockscreen_public: bool,
    /// 渠道实际是否配置了声音（ColorOS 会把 sound 置空）；读不出来时为 true。
    pub channel_sound: bool,
    /// 渠道实际是否开启了震动（ColorOS 会关掉）；读不出来时为 true。
    pub channel_vibration: bool,
    /// 渠道重要度是否被系统/用户从 HIGH 调低（ColorOS 会自动降级）；
    /// Android 不允许应用改回，只能引导用户在系统设置里手动调回「紧急」。
    pub channel_downgraded: bool,
    pub notifications_enabled: bool,
    pub sound_enabled: bool,
    /// 精确闹钟权限；未授予时闹钟只能非精确排期，Doze 下会被大幅推迟。
    pub exact_alarm: bool,
    /// 是否已加入电池优化白名单。
    pub battery_ignored: bool,
    pub manufacturer: String,
    pub brand: String,
    pub sdk_int: i32,
}

#[tauri::command]
pub fn get_notification_health(app: tauri::AppHandle) -> Result<NotificationHealth, String> {
    native::<NotificationHealth>(&app, "getNotificationHealth", json!({}))
}

/// 删除并按正确配置重建提醒渠道。渠道重要度创建后应用无法修改，
/// 历史版本用低重要度建过的渠道只能这样自愈。
#[tauri::command]
pub fn repair_notification_channels(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "repairNotificationChannels", json!({})).map(|_| ())
}

/// 直达「喝水提醒」渠道设置页：横幅与锁屏显示都是渠道级开关。
#[tauri::command]
pub fn open_notification_channel_settings(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "openNotificationChannelSettings", json!({})).map(|_| ())
}

/// 直达系统设置 →「应用」页；打不开时原生侧回退到应用详情。
#[tauri::command]
pub fn open_autostart_settings(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "openAutoStartSettings", json!({})).map(|_| ())
}

/// 【临时跳转验证 demo】按 target 打开某个「设置-应用」候选页面，
/// 用于真机确认各入口实际落地页。验证完成后随 demo 一起移除。
#[tauri::command]
pub fn open_settings_probe(app: tauri::AppHandle, target: String) -> Result<(), String> {
    native::<Value>(&app, "openSettingsProbe", json!({ "target": target })).map(|_| ())
}

/// 真机诊断快照：一次返回所有决定提醒能否准时到达的原生状态。
/// 字段与 Kotlin getDiagnostics 命令一一对应；桌面无原生桥接时为 None。
#[derive(Debug, Deserialize, Serialize)]
pub struct Diagnostics {
    pub now: i64,
    #[serde(rename = "nextAt")]
    pub next_at: i64,
    #[serde(rename = "lastReminderAt")]
    pub last_reminder_at: i64,
    #[serde(rename = "gapMinutes")]
    pub gap_minutes: i64,
    #[serde(rename = "exactAlarm")]
    pub exact_alarm: bool,
    #[serde(rename = "batteryIgnored")]
    pub battery_ignored: bool,
    pub dozing: bool,
    pub interactive: bool,
    #[serde(rename = "notificationsEnabled")]
    pub notifications_enabled: bool,
    #[serde(rename = "channelImportance")]
    pub channel_importance: i32,
    /// 上一次「排了却没响」的闹钟时刻；0 表示没有漏报。国产 ROM 划掉多任务
    /// 会 force-stop（连带清空 AlarmManager 闹钟），这是那次失败留下的唯一证据。
    #[serde(rename = "missedAlarmAt")]
    pub missed_alarm_at: i64,
    /// 上次冷启动时是否发现闹钟句柄已被系统删除（force-stop 的典型后果）。
    #[serde(rename = "alarmCleared")]
    pub alarm_cleared: bool,
    /// 厂商 / 品牌：前端据此切换系统名与私有开关的叫法。
    /// default 兜底：早期原生端没返回这两个字段，缺字段不该让整份诊断失败。
    #[serde(default)]
    pub manufacturer: String,
    #[serde(default)]
    pub brand: String,
    #[serde(rename = "appVersion")]
    pub app_version: String,
}

#[tauri::command]
pub fn get_diagnostics(app: tauri::AppHandle) -> Result<Diagnostics, String> {
    native::<Diagnostics>(&app, "getDiagnostics", json!({}))
}

/// 用户确认过「上次提醒没送到」后调用，清掉原生侧的唯一一条漏报记录。
#[tauri::command]
pub fn clear_missed_alarm(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "clearMissedAlarm", json!({})).map(|_| ())
}

/// 直达系统应用详情页，供国产 ROM 设置自启动 / 后台运行。
#[tauri::command]
pub fn open_app_settings(app: tauri::AppHandle) -> Result<(), String> {
    native::<Value>(&app, "openAppSettings", json!({})).map(|_| ())
}

/// 让状态栏 / 导航栏的底色与图标明暗跟随 App 内主题，而不是只跟随系统
/// 深浅色设置。冷启动首帧由 values(-night)/themes.xml 兜底，这里负责
/// 用户手动切主题、以及 configChanges 含 uiMode 时的运行时同步。
#[tauri::command]
pub fn set_system_bar_theme(app: tauri::AppHandle, dark: bool) -> Result<(), String> {
    native::<Value>(&app, "setSystemBarTheme", json!({ "dark": dark })).map(|_| ())
}

/// 通知主体被点击后 Kotlin 只记一个标志；前端在启动 / 恢复 / 收到
/// `shui:check-reminder` 时来消费它。冷启动时 WebView 尚未注册监听也不会丢，
/// 且标志被消费后一次点击只会弹一次全屏提醒。
/// 这里刻意不 emit 全局事件：JS 直接拿返回值弹窗，避免 listen 注册时序竞争。
#[tauri::command]
pub fn consume_pending_reminder(app: tauri::AppHandle) -> bool {
    native::<PendingReminderFlag>(&app, "consumePendingReminder", json!({}))
        .map(|value| value.pending)
        .unwrap_or(false)
}

#[tauri::command]
pub async fn save_drink_history_csv(
    app: tauri::AppHandle,
    content: String,
) -> Result<Option<String>, String> {
    let name = format!("shui-drink-history-{}.csv", Local::now().format("%Y%m%d"));
    write_and_share(&app, &name, content.as_bytes(), "text/csv")
}

#[tauri::command]
pub async fn export_drink_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let bytes = data_backup::build_backup_bytes(&app)?;
    let name = format!("shui-drink-backup-{}.json", Local::now().format("%Y%m%d"));
    write_and_share(&app, &name, &bytes, "application/json")
}

fn write_and_share(
    app: &tauri::AppHandle,
    name: &str,
    bytes: &[u8],
    mime: &str,
) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("exports");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    let path_string = path.to_string_lossy().into_owned();
    native::<Value>(
        app,
        "shareFile",
        json!({ "path": path_string, "mime": mime }),
    )
    .map_err(|error| format!("文件已生成，但系统分享不可用：{error}"))?;
    Ok(Some(path_string))
}

#[tauri::command]
pub async fn preview_drink_import(
    app: tauri::AppHandle,
) -> Result<Option<ImportPreview>, String> {
    let picked = native::<String>(&app, "pickBackup", json!({}))?;
    if picked.is_empty() {
        return Ok(None);
    }
    data_backup::preview_backup_from_path(&app, PathBuf::from(picked))
}
