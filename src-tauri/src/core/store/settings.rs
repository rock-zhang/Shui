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
    pub const TIMESTART: &str = "timeStart";
    pub const TIMEEND: &str = "timeEnd";
    pub const ISCOUNTDOWN: &str = "isCountDown";
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
    pub today_drink_amount: u64,
    pub is_work_day: bool,
    pub is_in_time_range: bool,
    pub is_show_countdown: bool,
    pub meta: AppSettingsMeta,
}

pub fn get_today_string() -> String {
    let now = Local::now();
    now.format("%Y%m%d").to_string()
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
                "gold": "1000",
                "weekdays": [1, 2, 3, 4, 5],
                "timeStart": "09:00",
                "timeEnd": "18:00"
            }),
        );
        store.set(
            config_store_category::GENERAL.to_string(),
            json!({
                "isAutoStart": false,
                "isCountDown": true
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
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        // println!("drink_amount: {:?}", drink_amount);

        let is_show_countdown = config_store
            .get(config_store_category::GENERAL)
            .and_then(|v| v.as_object().cloned())
            .and_then(|obj| obj.get(store_fields::ISCOUNTDOWN).cloned())
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        AppSettings {
            gold: gold,
            gap: gap_minutes * 60,
            today_drink_amount: drink_amount,
            is_work_day: is_work_day,
            is_in_time_range: is_in_time_range,
            is_show_countdown: is_show_countdown,
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
        self.is_work_day && self.is_in_time_range && self.today_drink_amount < self.gold
    }

    pub fn get_status_message(&self) -> (&str, &str) {
        if self.today_drink_amount >= self.gold {
            ("已达标", "太棒啦，再接再厉")
        } else {
            ("Shui", "非工作日或非工作时间")
        }
    }
}
