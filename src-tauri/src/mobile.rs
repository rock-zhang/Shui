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
use chrono::Local;
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
        return json!({ "alert": {}, "general": {} });
    };
    json!({
        "alert": store.get("alert").unwrap_or_else(|| json!({})),
        "general": store.get("general").unwrap_or_else(|| json!({})),
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
                if !settings.should_run_timer() {
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
                let now_ms = Local::now().timestamp_millis();
                let gap_ms = settings.gap as i64 * 1000; // AppSettings.gap 以秒存储
                if now_ms - last_reminder_at(&timer_handle) >= gap_ms {
                    // 先写账本再弹窗：后台闹钟随后读到新账本，就不会再补一条通知。
                    mark_reminder(&timer_handle);
                    IS_RUNNING.store(false, Ordering::SeqCst);
                    reminder_session::begin();
                    let _ = timer_handle.emit("timer-complete", ());
                    // 全屏已承接本次提醒，把原生闹钟重排到 now+gap。
                    sync_schedule(&timer_handle);
                    break;
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

    sync_schedule(app);
    Ok(())
}

#[derive(Debug, Deserialize)]
struct PendingDrink {
    #[serde(default)]
    amount: u64,
    #[serde(default, rename = "requestId")]
    request_id: String,
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
        if drink_store::save_drink(app, item.amount, &format!("manual:{id}")).is_ok() {
            recorded = true;
        }
    }
    let _ = std::fs::remove_file(&processing);
    if recorded {
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

/// 设置页保存配置后显式重建原生闹钟。
#[tauri::command]
pub fn sync_reminder_schedule(app: tauri::AppHandle) -> Result<(), String> {
    let payload = schedule_payload(&app);
    native::<Value>(&app, "schedule", payload).map(|_| ())
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
