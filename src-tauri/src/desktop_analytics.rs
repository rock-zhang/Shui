//! 桌面端 GA4 上报（Measurement Protocol）。
//!
//! Firebase Analytics 没有 Windows/Linux/macOS 原生 SDK，桌面端改用 GA4
//! Measurement Protocol。它与 Android 的 Firebase Analytics 落在同一个 GA4
//! 数据属性下，事件名、参数名保持一致，通过 `platform=desktop|android` 区分。
//!
//! 配置来源（缺一不可，缺失时整个模块静默 no-op）：
//!   - 编译期环境变量：`SHUI_GA4_MEASUREMENT_ID` / `SHUI_GA4_API_SECRET`
//!   - 运行期同名环境变量（优先级更高，便于本地调试）
//!
//! Measurement Protocol 文档：
//! https://developers.google.com/analytics/devguides/collection/protocol/ga4

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

const STATE_FILE: &str = "desktop-analytics.json";
const COLLECT_URL: &str = "https://www.google-analytics.com/mp/collect";
const MAX_PARAMS: usize = 25;
const MAX_STRING: usize = 100;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct State {
    client_id: String,
    enabled: bool,
    first_open_date: Option<String>,
    last_active_date: Option<String>,
    active_days: u64,
    goal_day: Option<String>,
    guide_status: String,
    counters: BTreeMap<String, i64>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            enabled: true,
            first_open_date: None,
            last_active_date: None,
            active_days: 0,
            goal_day: None,
            guide_status: "not_shown".to_string(),
            counters: BTreeMap::new(),
        }
    }
}

struct Ga4Config {
    measurement_id: String,
    api_secret: String,
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static STATE_PATH: OnceLock<PathBuf> = OnceLock::new();
static SESSION_ID: OnceLock<u64> = OnceLock::new();
static CONFIG: OnceLock<Option<Ga4Config>> = OnceLock::new();
static WARNED: OnceLock<()> = OnceLock::new();

fn state_path(app: &AppHandle) -> PathBuf {
    STATE_PATH
        .get_or_init(|| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            let _ = fs::create_dir_all(&dir);
            dir.join(STATE_FILE)
        })
        .clone()
}

fn state(app: &AppHandle) -> MutexGuard<'static, State> {
    let path = state_path(app);
    STATE
        .get_or_init(|| {
            let mut loaded = fs::read_to_string(&path)
                .ok()
                .and_then(|text| serde_json::from_str::<State>(&text).ok())
                .unwrap_or_default();
            if loaded.client_id.is_empty() {
                loaded.client_id = uuid::Uuid::new_v4().to_string();
            }
            Mutex::new(loaded)
        })
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn persist(app: &AppHandle, state: &State) {
    let path = state_path(app);
    if let Ok(text) = serde_json::to_string_pretty(state) {
        if let Err(error) = fs::write(&path, text) {
            eprintln!("[analytics] 写入本地状态失败: {error}");
        }
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn days_between(from: &str, to: &str) -> i64 {
    let parse = |value: &str| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok();
    match (parse(from), parse(to)) {
        (Some(start), Some(end)) => (end - start).num_days().max(0) + 1,
        _ => 1,
    }
}

fn session_id() -> u64 {
    *SESSION_ID.get_or_init(|| chrono::Local::now().timestamp_millis() as u64 / 1000)
}

fn env_or_build(runtime: &str, build: Option<&'static str>) -> Option<String> {
    std::env::var(runtime)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            build
                .map(str::to_string)
                .filter(|value| !value.trim().is_empty())
        })
}

fn config() -> Option<&'static Ga4Config> {
    CONFIG
        .get_or_init(|| {
            let measurement_id = env_or_build(
                "SHUI_GA4_MEASUREMENT_ID",
                option_env!("SHUI_GA4_MEASUREMENT_ID"),
            );
            let api_secret =
                env_or_build("SHUI_GA4_API_SECRET", option_env!("SHUI_GA4_API_SECRET"));
            match (measurement_id, api_secret) {
                (Some(measurement_id), Some(api_secret)) => Some(Ga4Config {
                    measurement_id,
                    api_secret,
                }),
                _ => None,
            }
        })
        .as_ref()
}

fn warn_missing_config() {
    WARNED.get_or_init(|| {
        eprintln!(
            "[analytics] 未配置 SHUI_GA4_MEASUREMENT_ID / SHUI_GA4_API_SECRET，桌面端统计已跳过"
        );
    });
}

fn sanitize_name(name: &str) -> Option<String> {
    let mut cleaned: String = name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
        .take(40)
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    if !cleaned
        .chars()
        .next()
        .map(|ch| ch.is_ascii_alphabetic())
        .unwrap_or(false)
    {
        cleaned.insert(0, 'e');
    }
    Some(cleaned)
}

fn truncate(value: &str) -> String {
    value.chars().take(MAX_STRING).collect()
}

fn sanitize_value(value: &Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(json!(truncate(text))),
        Value::Bool(_) | Value::Number(_) => Some(value.clone()),
        other => Some(json!(truncate(&other.to_string()))),
    }
}

fn bump(state: &mut State, key: &str, delta: i64) {
    let counter = state.counters.entry(key.to_string()).or_insert(0);
    *counter = (*counter + delta).max(0);
}

fn mark_goal_day(state: &mut State) {
    let today = today();
    if state.goal_day.as_deref() == Some(today.as_str()) {
        return;
    }
    state.goal_day = Some(today);
    bump(state, "goal_reached_days", 1);
}

fn string_param(params: &Map<String, Value>, key: &str) -> String {
    params
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn number_param(params: &Map<String, Value>, key: &str) -> i64 {
    params.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn bool_param(params: &Map<String, Value>, key: &str) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// 写入与 Android 完全一致的用户级计数器。
fn apply_side_effects(state: &mut State, name: &str, params: &Map<String, Value>) {
    match name {
        "notification_shown" => bump(state, "notif_shown_count", 1),
        "notification_opened" => bump(state, "notif_opened_count", 1),
        "notification_action_drink" => bump(state, "notif_drink_count", 1),
        "fullscreen_reminder_shown" => bump(state, "fullscreen_shown_count", 1),
        "fullscreen_drink_click" => bump(state, "fullscreen_drink_count", 1),
        "drink_recorded" => {
            let amount = number_param(params, "amount").max(0);
            bump(state, "drink_record_count", 1);
            bump(state, "drink_ml_total", amount);
            if string_param(params, "source") == "manual_today" {
                bump(state, "manual_drink_count", 1);
            }
            if bool_param(params, "goal_reached") {
                mark_goal_day(state);
            }
        }
        "drink_goal_reached" => mark_goal_day(state),
        "guide_shown" => state.guide_status = "in_progress".to_string(),
        "guide_complete" => state.guide_status = "completed".to_string(),
        "guide_dismiss" => {
            let dismiss = number_param(params, "dismiss_count") as i64;
            let stored = *state.counters.get("guide_dismiss_count").unwrap_or(&0);
            state
                .counters
                .insert("guide_dismiss_count".to_string(), stored.max(dismiss));
            if dismiss >= 3 {
                state.guide_status = "dismissed".to_string();
            }
        }
        _ => {}
    }
}

fn user_properties(state: &State) -> Value {
    let mut map = Map::new();
    for (key, value) in &state.counters {
        map.insert(key.clone(), json!({ "value": value.to_string() }));
    }
    map.insert(
        "app_platform".to_string(),
        json!({ "value": "desktop" }),
    );
    map.insert(
        "app_env".to_string(),
        json!({ "value": if cfg!(debug_assertions) { "debug" } else { "release" } }),
    );
    map.insert(
        "guide_status".to_string(),
        json!({ "value": state.guide_status.clone() }),
    );
    Value::Object(map)
}

fn base_params() -> Map<String, Value> {
    let mut params = Map::new();
    params.insert("app_platform".to_string(), json!("desktop"));
    params.insert(
        "app_env".to_string(),
        json!(if cfg!(debug_assertions) { "debug" } else { "release" }),
    );
    params.insert("app_version".to_string(), json!(env!("CARGO_PKG_VERSION")));
    params.insert("os".to_string(), json!(std::env::consts::OS));
    params.insert("session_id".to_string(), json!(session_id()));
    params.insert("engagement_time_msec".to_string(), json!(100));
    if cfg!(debug_assertions) {
        params.insert("debug_mode".to_string(), json!(1));
    }
    params
}

fn send(config: &'static Ga4Config, payload: Value) {
    let url = format!(
        "{}?measurement_id={}&api_secret={}",
        COLLECT_URL, config.measurement_id, config.api_secret
    );
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                eprintln!("[analytics] 创建 HTTP 客户端失败: {error}");
                return;
            }
        };
        if let Err(error) = client.post(url).json(&payload).send().await {
            eprintln!("[analytics] 上报失败: {error}");
        }
    });
}

/// 上报事件。Android 侧的 `AnalyticsTracker.logEvent` 与此保持同名同参数。
pub fn log_event(app: &AppHandle, name: &str, params: Value) {
    let Some(safe_name) = sanitize_name(name) else {
        return;
    };
    let Some(config) = config() else {
        warn_missing_config();
        return;
    };

    let mut state = state(app);
    if !state.enabled {
        return;
    }

    let mut incoming = params.as_object().cloned().unwrap_or_default();
    if safe_name == "app_open" {
        let today = today();
        let first_open = state.first_open_date.clone().unwrap_or_else(|| {
            state.first_open_date = Some(today.clone());
            today.clone()
        });
        if state.last_active_date.as_deref() != Some(today.as_str()) {
            state.last_active_date = Some(today.clone());
            state.active_days += 1;
        }
        incoming.insert("active_days".to_string(), json!(state.active_days));
        incoming.insert(
            "install_days".to_string(),
            json!(days_between(&first_open, &today)),
        );
    }
    apply_side_effects(&mut state, &safe_name, &incoming);
    let properties = user_properties(&state);
    let client_id = state.client_id.clone();
    persist(app, &state);

    let mut event_params = base_params();
    for (key, value) in incoming {
        if event_params.len() >= MAX_PARAMS {
            break;
        }
        let key: String = key
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
            .take(40)
            .collect();
        if key.is_empty() {
            continue;
        }
        if let Some(value) = sanitize_value(&value) {
            event_params.insert(key, value);
        }
    }

    let payload = json!({
        "client_id": client_id,
        "user_properties": properties,
        "events": [{
            "name": safe_name,
            "params": event_params
        }]
    });
    send(config, payload);
}

/// 记水统一入口：与 Android `AnalyticsTracker.logDrink` 对齐。
pub fn log_drink(
    app: &AppHandle,
    source: &str,
    amount: i64,
    today_total_after: i64,
    goal: i64,
    goal_reached: bool,
    deferred: bool,
) {
    let before = (today_total_after - amount).max(0);
    log_event(
        app,
        "drink_recorded",
        json!({
            "amount": amount,
            "source": source,
            "today_total_after": today_total_after,
            "goal_reached": goal_reached,
            "deferred": deferred
        }),
    );
    if goal_reached && goal > 0 && before < goal {
        log_event(
            app,
            "drink_goal_reached",
            json!({
                "total_ml": today_total_after,
                "goal_ml": goal,
                "source": source
            }),
        );
    }
}

pub fn is_enabled(app: &AppHandle) -> bool {
    state(app).enabled
}

#[tauri::command]
pub async fn analytics_log(app: AppHandle, name: String, params: Option<Value>) {
    log_event(&app, &name, params.unwrap_or_else(|| json!({})));
}

#[tauri::command]
pub async fn analytics_sync_properties(_app: AppHandle) {
    // Measurement Protocol 每次请求都会带上 user_properties，无需单独同步。
}

#[tauri::command]
pub async fn analytics_is_enabled(app: AppHandle) -> bool {
    is_enabled(&app)
}

#[tauri::command]
pub async fn analytics_set_enabled(app: AppHandle, enabled: bool) {
    let mut state = state(&app);
    state.enabled = enabled;
    persist(&app, &state);
}

#[tauri::command]
pub async fn analytics_record_exception(
    app: AppHandle,
    message: Option<String>,
    stack: Option<String>,
    screen: Option<String>,
) {
    let message = message.unwrap_or_default();
    let stack = stack.unwrap_or_default();
    eprintln!(
        "[analytics] JS 异常 screen={} message={} stack={}",
        screen.as_deref().unwrap_or(""),
        message,
        stack
    );
    if is_enabled(&app) {
        log_event(
            &app,
            "js_error",
            json!({
                "message": truncate(&message),
                "screen": truncate(screen.as_deref().unwrap_or("")),
                "has_stack": !stack.is_empty()
            }),
        );
    }
}
