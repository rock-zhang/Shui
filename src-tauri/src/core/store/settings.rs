use chrono::Local;
use tauri_plugin_store::Store;

pub mod store_pages {
    pub const ALERT: &str = "alert";
    pub const DRINK_HISTORY: &str = "drink_history";
}

pub mod store_keys {
    pub const GAP: &str = "gap";
    pub const GOLD: &str = "gold";
}

#[derive(Debug, Clone)]
pub struct AppSettings {
    pub gold: u64,
    pub gap: u64,
    pub today_drink_amount: u64,
}

pub fn get_today_string() -> String {
    let now = Local::now();
    now.format("%Y%m%d").to_string()
}

impl AppSettings {
    pub fn load_from_store<R: tauri::Runtime>(store: &Store<R>) -> AppSettings {
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

        let drink_amount = store
            .get(store_pages::DRINK_HISTORY)
            .and_then(|v| v.as_object().cloned())
            .and_then(|obj| obj.get(&get_today_string()).cloned())
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        println!("gap_minutes: {:?}", gap_minutes);
        println!("gold: {:?}", gold);
        println!("drink_amount: {:?}", drink_amount);
        println!("get_today_string(): {:?}", get_today_string());

        AppSettings {
            gold: gold,
            gap: gap_minutes * 60,
            today_drink_amount: drink_amount,
        }
    }
}
