use chrono::{Datelike, Local, NaiveTime};
use serde::Serialize;
use tauri_plugin_store::{Store, StoreExt}; // 添加这行到文件顶部

pub mod store_files {
    pub const CONFIG: &str = "config_store.json";
    pub const DRINK_HISTORY: &str = "drink_history_store.json";
}

pub mod config_store_category {
    pub const ALERT: &str = "alert";
    pub const GENERAL: &str = "general";
}

pub mod store_fields {
    pub const GAP: &str = "gap";
    pub const GOLD: &str = "gold";
    pub const WEEKDAYS: &str = "weekdays";
    pub const WHITELIST_APPS: &str = "whitelist_apps";
    pub const TIMESTART: &str = "timeStart";
    pub const TIMEEND: &str = "timeEnd";
    pub const ISCOUNTDOWN: &str = "isCountDown";
    pub const ISFULLSCREEN: &str = "isFullScreen";
    pub const ISPAUSED: &str = "isPaused";
}

#[derive(Debug, Clone, Serialize)] // 添加 Serialize
pub struct AppSettingsMeta {
    pub weekdays: Vec<u64>,
    pub current_time: NaiveTime,
    pub time_start: NaiveTime,
    pub time_end: NaiveTime,
    pub today_weekday: u64,
    pub gap_minutes: u64,
}

#[derive(Debug, Clone, Serialize)] // 添加 Serialize
pub struct AppSettings {
    pub gold: u64,
    pub gap: u64,
    pub whitelist_apps: Vec<String>,
    pub today_drink_amount: u64,
    pub is_work_day: bool,
    pub is_in_time_range: bool,
    pub is_show_countdown: bool,
    /// 「暂停提醒」：前后台都要停，前台 timer 也必须遵守。
    pub is_paused: bool,
    /// 「全屏提醒」：前台 timer 只为全屏页服务，关掉后不该继续跑——
    /// 否则它到期会写提醒账本，把后台通知也一并抑制掉。
    pub is_full_screen: bool,
    pub meta: AppSettingsMeta,
}

pub fn get_today_string() -> String {
    let now = Local::now();
    now.format("%Y%m%d").to_string()
}

fn drink_amount_from_value(value: &serde_json::Value) -> u64 {
    value
        .as_u64()
        .or_else(|| value.get("total").and_then(|total| total.as_u64()))
        .unwrap_or(0)
}

impl AppSettings {
    pub fn is_first_open<R: tauri::Runtime>(store: &Store<R>) -> bool {
        store.is_empty()
    }

    pub fn init_store<R: tauri::Runtime>(
        store: &Store<R>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        use serde_json::json;

        // 设置默认配置
        store.set(
            config_store_category::ALERT.to_string(),
            json!({
                "gap": "20",
                "gold": "1500",
                "weekdays": [1, 2, 3, 4, 5],
                "timeStart": "09:00",
                "timeEnd": "18:00",
                "whitelist_apps": ["腾讯会议", "Zoom", "Google Meet", "Microsoft Teams"]
            }),
        );
        store.set(
            config_store_category::GENERAL.to_string(),
            json!({
                "isAutoStart": false,
                "isCountDown": true,
                "isFullScreen": true
            }),
        );
        // 保存到文件
        store.save()?;

        Ok(())
    }

    pub fn load_from_store<R: tauri::Runtime>(app_handle: &tauri::AppHandle) -> AppSettings {
        let config_store = app_handle
            .store(store_files::CONFIG)
            .expect("无法获取 Store");
        let drink_history_store = app_handle
            .store(store_files::DRINK_HISTORY)
            .expect("无法获取 Store");

        // 检查是否首次打开
        if Self::is_first_open(&config_store) {
            if let Err(e) = Self::init_store(&config_store) {
                println!("初始化配置失败: {:?}", e);
            }
        }

        let alert_config = config_store
            .get(config_store_category::ALERT)
            .and_then(|v| v.as_object().cloned());

        let alert_config = alert_config.unwrap_or_default();

        let gap_minutes = alert_config
            .get(store_fields::GAP)
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(20);

        let gold = alert_config
            .get(store_fields::GOLD)
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(1000);

        let time_start = alert_config
            .get(store_fields::TIMESTART)
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveTime::parse_from_str(s, "%H:%M").ok())
            .unwrap_or(NaiveTime::from_hms_opt(9, 0, 0).unwrap());

        let time_end = alert_config
            .get(store_fields::TIMEEND)
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveTime::parse_from_str(s, "%H:%M").ok())
            .unwrap_or(NaiveTime::from_hms_opt(18, 0, 0).unwrap());

        let current_time = Local::now().time();
        let is_in_time_range = if time_end == NaiveTime::from_hms_opt(0, 0, 0).unwrap() {
            // 如果结束时间是 00:00，表示次日 0 点
            current_time >= time_start || current_time <= time_end
        } else {
            // 普通情况
            current_time >= time_start && current_time <= time_end
        };

        let weekdays = alert_config
            .get(store_fields::WEEKDAYS)
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect::<Vec<u64>>())
            .unwrap_or_else(|| vec![]); // 默认为空数组
                                        // 获取今天是星期几（0-6，0 表示星期天）
        let today_weekday = Local::now().weekday().num_days_from_sunday() as u64;
        let is_work_day = weekdays.contains(&today_weekday);

        let drink_amount = drink_history_store
            .get(&get_today_string())
            .map(|value| drink_amount_from_value(&value))
            .unwrap_or(0);

        let whitelist_apps = alert_config
            .get(store_fields::WHITELIST_APPS)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_else(|| vec![]); // 默认为空数组

        let is_show_countdown = config_store
            .get(config_store_category::GENERAL)
            .and_then(|v| v.as_object().cloned())
            .and_then(|obj| obj.get(store_fields::ISCOUNTDOWN).cloned())
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let is_paused = config_store
            .get(config_store_category::GENERAL)
            .and_then(|v| v.as_object().cloned())
            .and_then(|obj| obj.get(store_fields::ISPAUSED).cloned())
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // 旧版本升级上来的用户没有这个字段，默认开启全屏（与前端 store.ts 一致）。
        let is_full_screen = config_store
            .get(config_store_category::GENERAL)
            .and_then(|v| v.as_object().cloned())
            .and_then(|obj| obj.get(store_fields::ISFULLSCREEN).cloned())
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        AppSettings {
            gold: gold,
            gap: gap_minutes * 60,
            whitelist_apps: whitelist_apps,
            today_drink_amount: drink_amount,
            is_work_day: is_work_day,
            is_in_time_range: is_in_time_range,
            is_show_countdown: is_show_countdown,
            is_paused: is_paused,
            is_full_screen: is_full_screen,
            meta: AppSettingsMeta {
                weekdays,
                current_time,
                time_start,
                time_end,
                today_weekday,
                gap_minutes,
            },
        }
    }

    pub fn should_run_timer(&self) -> bool {
        !self.is_paused
            && self.is_work_day
            && self.is_in_time_range
            && self.today_drink_amount < self.gold
    }

    // 仅桌面端使用（托盘状态文案）；Android 上 localization 模块不存在，
    // 不加 cfg 会让 Android 目标编译失败。
    #[cfg(not(target_os = "android"))]
    pub fn get_status_message(&self) -> (&'static str, &'static str) {
        use crate::localization::t;
        if self.today_drink_amount >= self.gold {
            (
                t("status.goal_reached.title"),
                t("status.goal_reached.tooltip"),
            )
        } else if self.is_paused {
            // 手动暂停与「非工作日/非工作时间」要分开说，否则用户会以为是时段问题。
            (t("status.paused.title"), t("status.paused.tooltip"))
        } else if !self.is_work_day {
            ("", t("status.not_workday.tooltip"))
        } else {
            ("", t("status.out_of_range.tooltip"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{drink_amount_from_value, AppSettings, AppSettingsMeta};
    use chrono::NaiveTime;
    use serde_json::json;

    /// 造一份「本该跑计时器」的设置，便于单个条件逐个放开验证。
    fn running_settings() -> AppSettings {
        let time = NaiveTime::from_hms_opt(10, 0, 0).unwrap();
        AppSettings {
            gold: 1500,
            gap: 1800,
            whitelist_apps: vec![],
            today_drink_amount: 200,
            is_work_day: true,
            is_in_time_range: true,
            is_show_countdown: true,
            is_paused: false,
            is_full_screen: true,
            meta: AppSettingsMeta {
                weekdays: vec![1, 2, 3, 4, 5],
                current_time: time,
                time_start: time,
                time_end: time,
                today_weekday: 1,
                gap_minutes: 30,
            },
        }
    }

    #[test]
    fn timer_pauses_when_user_pauses_reminders() {
        assert!(running_settings().should_run_timer());
        // 暂停提醒是前后台共用的开关，前台 timer 也必须停。
        let paused = AppSettings {
            is_paused: true,
            ..running_settings()
        };
        assert!(!paused.should_run_timer());
    }

    #[test]
    fn timer_stops_outside_work_hours_or_after_goal() {
        let off_day = AppSettings {
            is_work_day: false,
            ..running_settings()
        };
        assert!(!off_day.should_run_timer());

        let out_of_range = AppSettings {
            is_in_time_range: false,
            ..running_settings()
        };
        assert!(!out_of_range.should_run_timer());

        let goal_met = AppSettings {
            today_drink_amount: 1500,
            ..running_settings()
        };
        assert!(!goal_met.should_run_timer());
    }

    #[test]
    fn reads_legacy_numeric_drink_amount() {
        assert_eq!(drink_amount_from_value(&json!(850)), 850);
    }

    #[test]
    fn reads_structured_drink_amount() {
        assert_eq!(
            drink_amount_from_value(&json!({
                "schemaVersion": 1,
                "total": 1050,
                "goal": 1500,
                "entries": []
            })),
            1050
        );
    }

    #[test]
    fn treats_invalid_drink_amount_as_zero() {
        assert_eq!(drink_amount_from_value(&json!({ "total": "unknown" })), 0);
    }

    #[test]
    fn status_messages_pick_the_localized_key_for_each_state() {
        use crate::localization::t;

        // 未 init 的测试环境回退中文；这里验证每个状态取到的是对应文案的 key。
        assert_eq!(
            running_settings().get_status_message(),
            ("", t("status.out_of_range.tooltip"))
        );
        let paused = AppSettings {
            is_paused: true,
            ..running_settings()
        };
        assert_eq!(
            paused.get_status_message(),
            (t("status.paused.title"), t("status.paused.tooltip"))
        );
        let goal_met = AppSettings {
            today_drink_amount: 1500,
            ..running_settings()
        };
        assert_eq!(
            goal_met.get_status_message(),
            (
                t("status.goal_reached.title"),
                t("status.goal_reached.tooltip")
            )
        );
        let off_day = AppSettings {
            is_work_day: false,
            ..running_settings()
        };
        assert_eq!(
            off_day.get_status_message(),
            ("", t("status.not_workday.tooltip"))
        );
    }
}
