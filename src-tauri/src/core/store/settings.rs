use chrono::{Datelike, Local, NaiveTime};
use tauri_plugin_store::Store;

pub mod store_pages {
    pub const ALERT: &str = "alert";
    pub const GENERAL: &str = "general";
    pub const DRINK_HISTORY: &str = "drink_history";
}

pub mod store_keys {
    pub const GAP: &str = "gap";
    pub const GOLD: &str = "gold";
    pub const WEEKDAYS: &str = "weekdays";
    pub const TIMESTART: &str = "timeStart";
    pub const TIMEEND: &str = "timeEnd";
    pub const ISCOUNTDOWN: &str = "isCountDown";
}

#[derive(Debug, Clone)]
pub struct AppSettings {
    pub gold: u64,
    pub gap: u64,
    pub today_drink_amount: u64,
    pub is_work_day: bool,
    pub is_in_time_range: bool,
    pub is_show_countdown: bool,
}

pub fn get_today_string() -> String {
    let now = Local::now();
    now.format("%Y%m%d").to_string()
}

impl AppSettings {
    pub fn is_first_open<R: tauri::Runtime>(store: &Store<R>) -> bool {
        println!("is_first_open: {:?}", store.is_empty());
        store.is_empty()
    }

    pub fn init_store<R: tauri::Runtime>(
        store: &Store<R>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        use serde_json::json;

        // 设置默认配置
        store.set(
            store_pages::ALERT.to_string(),
            json!({
                "gap": "20",
                "gold": "1000",
                "weekdays": [1, 2, 3, 4, 5],
                "timeStart": "09:00",
                "timeEnd": "18:00"
            }),
        );
        store.set(
            store_pages::GENERAL.to_string(),
            json!({
                "isAutoStart": false,
                "isCountDown": true
            }),
        );
        // 保存到文件
        store.save()?;

        Ok(())
    }

    pub fn load_from_store<R: tauri::Runtime>(store: &Store<R>) -> AppSettings {
        // 检查是否首次打开
        if Self::is_first_open(store) {
            if let Err(e) = Self::init_store(store) {
                println!("初始化配置失败: {:?}", e);
            }
        }

        let alert_config = store
            .get(store_pages::ALERT)
            .and_then(|v| v.as_object().cloned());

        let alert_config = alert_config.unwrap_or_default();
        println!("alert_config: {:?}", alert_config);

        let gap_minutes = alert_config
            .get(store_keys::GAP)
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(20);

        let gold = alert_config
            .get(store_keys::GOLD)
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(1000);

        let time_start = alert_config
            .get(store_keys::TIMESTART)
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveTime::parse_from_str(s, "%H:%M").ok())
            .unwrap_or(NaiveTime::from_hms_opt(9, 0, 0).unwrap());

        let time_end = alert_config
            .get(store_keys::TIMEEND)
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveTime::parse_from_str(s, "%H:%M").ok())
            .unwrap_or(NaiveTime::from_hms_opt(18, 0, 0).unwrap());

        let current_time = Local::now().time();
        let is_in_time_range = current_time >= time_start && current_time <= time_end;

        println!(
            "time_range: {:?} - {:?}, current: {:?}, is_in_range: {}",
            time_start, time_end, current_time, is_in_time_range
        );

        let weekdays = alert_config
            .get(store_keys::WEEKDAYS)
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect::<Vec<u64>>())
            .unwrap_or_else(|| vec![]); // 默认为空数组
                                        // 获取今天是星期几（0-6，0 表示星期天）
        let today_weekday = Local::now().weekday().num_days_from_sunday() as u64;
        let is_work_day = weekdays.contains(&today_weekday);

        println!(
            "weekdays: {:?}, today: {}, is_work_day: {}",
            weekdays, today_weekday, is_work_day
        );

        let drink_amount = store
            .get(store_pages::DRINK_HISTORY)
            .and_then(|v| v.as_object().cloned())
            .and_then(|obj| obj.get(&get_today_string()).cloned())
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let is_show_countdown = store
            .get(store_pages::GENERAL)
            .and_then(|v| v.as_object().cloned())
            .and_then(|obj| obj.get(store_keys::ISCOUNTDOWN).cloned())
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        println!("gap_minutes: {:?}", gap_minutes);
        println!("gold: {:?}", gold);
        println!("drink_amount: {:?}", drink_amount);
        println!("weekdays: {:?}", weekdays);
        println!("get_today_string(): {:?}", get_today_string());
        println!("is_show_countdown(): {:?}", is_show_countdown);

        AppSettings {
            gold: gold,
            gap: gap_minutes * 60,
            today_drink_amount: drink_amount,
            is_work_day: is_work_day,
            is_in_time_range: is_in_time_range,
            is_show_countdown: is_show_countdown,
        }
    }
}
