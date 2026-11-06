use chrono::{DateTime, Local};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri_plugin_store::{Store, StoreExt};

pub(crate) static WRITER: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    date: String,
    pub(crate) total: u64,
    goal: u64,
    pub added: bool,
    goal_reached: bool,
}

pub(crate) trait History {
    fn entries(&self) -> Vec<(String, Value)>;
    fn get(&self, key: &str) -> Option<Value>;
    fn set(&self, key: &str, value: Value);
    fn delete(&self, key: &str);
    fn save(&self) -> Result<(), String>;
}

impl History for Store<tauri::Wry> {
    fn entries(&self) -> Vec<(String, Value)> {
        self.entries()
    }
    fn get(&self, key: &str) -> Option<Value> {
        self.get(key)
    }
    fn set(&self, key: &str, value: Value) {
        self.set(key, value);
    }
    fn delete(&self, key: &str) {
        self.delete(key);
    }
    fn save(&self) -> Result<(), String> {
        self.save().map_err(|e| e.to_string())
    }
}

// Every entry point takes this same lock, including read, deduplication and save.
pub(crate) fn record<S: History>(
    store: &S,
    amount: u64,
    request_id: &str,
    goal: u64,
    now: DateTime<Local>,
) -> Result<Receipt, String> {
    let _guard = WRITER.lock().map_err(|_| "饮水写入暂不可用")?;
    if ![50, 100, 200, 300].contains(&amount) {
        return Err("不支持的饮水量".into());
    }
    if request_id.is_empty() || request_id.len() > 160 || !request_id.is_ascii() {
        return Err("无效的请求标识".into());
    }
    // Search persisted IDs across days as retries can arrive after midnight/restart.
    for (date, value) in store.entries() {
        if value["revokedRequestIds"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(request_id)))
        {
            return Err("该记录已撤销，不能重试添加；请创建新记录".into());
        }
        if let Some(entries) = value.get("entries").and_then(Value::as_array) {
            if entries
                .iter()
                .any(|entry| entry.get("requestId").and_then(Value::as_str) == Some(request_id))
            {
                return Ok(Receipt {
                    date,
                    total: value["total"].as_u64().ok_or("饮水记录格式错误")?,
                    goal,
                    added: false,
                    goal_reached: false,
                });
            }
        }
    }
    let date = now.format("%Y%m%d").to_string();
    let previous = store.get(&date);
    let mut next = match &previous {
        None => json!({ "schemaVersion": 1, "total": 0, "entries": [] }),
        Some(value) if value.is_u64() => {
            json!({ "schemaVersion": 1, "total": value, "entries": [] })
        }
        Some(value)
            if value["schemaVersion"] == 1
                && value["total"].is_u64()
                && value["entries"].is_array() =>
        {
            value.clone()
        }
        _ => return Err("饮水记录格式不受支持，原数据未修改".into()),
    };
    let before = next["total"].as_u64().ok_or("无效的饮水总量")?;
    let total = before
        .checked_add(amount)
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or("饮水总量超出范围")?;
    next["total"] = json!(total);
    next["goal"] = json!(goal);
    next["entries"].as_array_mut().unwrap().push(json!({
        "amount": amount, "timestamp": now.to_rfc3339(), "requestId": request_id,
    }));
    store.set(&date, next);
    if let Err(error) = store.save() {
        match previous {
            Some(value) => store.set(&date, value),
            None => store.delete(&date),
        }
        return Err(format!("保存失败，请重试：{error}"));
    }
    Ok(Receipt {
        date,
        total,
        goal,
        added: true,
        goal_reached: goal > 0 && before < goal && total >= goal,
    })
}

pub(crate) fn save_drink(
    app: &tauri::AppHandle,
    amount: u64,
    request_id: &str,
) -> Result<Receipt, String> {
    let config = app.store("config_store.json").map_err(|e| e.to_string())?;
    let goal = config
        .get("alert")
        .and_then(|value| {
            value["gold"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .or_else(|| value["gold"].as_u64())
        })
        .filter(|value| *value > 0)
        .unwrap_or(1000);
    let store = app
        .store("drink_history_store.json")
        .map_err(|e| e.to_string())?;
    record(store.as_ref(), amount, request_id, goal, Local::now())
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::{
        collections::HashMap,
        sync::atomic::{AtomicBool, Ordering},
    };
    #[derive(Default)]
    pub(crate) struct Memory {
        data: Mutex<HashMap<String, Value>>,
        pub(crate) fail: AtomicBool,
    }
    impl History for Memory {
        fn entries(&self) -> Vec<(String, Value)> {
            self.data
                .lock()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        }
        fn get(&self, key: &str) -> Option<Value> {
            self.data.lock().unwrap().get(key).cloned()
        }
        fn set(&self, key: &str, value: Value) {
            self.data.lock().unwrap().insert(key.into(), value);
        }
        fn delete(&self, key: &str) {
            self.data.lock().unwrap().remove(key);
        }
        fn save(&self) -> Result<(), String> {
            if self.fail.load(Ordering::SeqCst) {
                Err("disk full".into())
            } else {
                Ok(())
            }
        }
    }
    pub(crate) fn now() -> DateTime<Local> {
        DateTime::parse_from_rfc3339("2026-10-23T12:00:00+08:00")
            .unwrap()
            .with_timezone(&Local)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use std::sync::{atomic::Ordering, Arc};
    #[test]
    fn upgrades_legacy_and_notifies_only_on_crossing() {
        let store = Memory::default();
        let date = now().format("%Y%m%d").to_string();
        store.set(&date, json!(800));
        let result = record(&store, 200, "one", 1000, now()).unwrap();
        assert_eq!(result.total, 1000);
        assert!(result.goal_reached);
        assert!(
            !record(&store, 100, "two", 1000, now())
                .unwrap()
                .goal_reached
        );
        assert_eq!(
            store.get(&date).unwrap()["entries"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn concurrent_unique_requests_do_not_lose_updates() {
        let store = Arc::new(Memory::default());
        let threads: Vec<_> = (0..20)
            .map(|i| {
                let store = store.clone();
                std::thread::spawn(move || {
                    record(store.as_ref(), 50, &format!("id-{i}"), 1000, now()).unwrap()
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(
            store.get(&now().format("%Y%m%d").to_string()).unwrap()["total"],
            1000
        );
    }
    #[test]
    fn concurrent_session_requests_only_record_once_and_retry_across_days() {
        let store = Arc::new(Memory::default());
        let threads: Vec<_> = (0..10)
            .map(|_| {
                let store = store.clone();
                std::thread::spawn(move || {
                    record(store.as_ref(), 100, "reminder-session", 1000, now())
                        .unwrap()
                        .added
                })
            })
            .collect();
        let added = threads
            .into_iter()
            .map(|t| usize::from(t.join().unwrap()))
            .sum::<usize>();
        assert_eq!(added, 1);
        assert!(
            !record(
                store.as_ref(),
                100,
                "reminder-session",
                1000,
                now() + chrono::Duration::days(1)
            )
            .unwrap()
            .added
        );
    }
    #[test]
    fn failed_save_restores_memory_and_retry_adds_once() {
        let store = Memory::default();
        let date = now().format("%Y%m%d").to_string();
        store.set(&date, json!(500));
        store.fail.store(true, Ordering::SeqCst);
        assert!(record(&store, 100, "retry", 1000, now()).is_err());
        assert_eq!(store.get(&date), Some(json!(500)));
        store.fail.store(false, Ordering::SeqCst);
        assert_eq!(
            record(&store, 100, "retry", 1000, now()).unwrap().total,
            600
        );
    }
    #[test]
    fn invalid_inputs_and_unknown_schema_leave_data_intact() {
        let store = Memory::default();
        assert!(record(&store, 0, "id", 1000, now()).is_err());
        assert!(record(&store, 100, "", 1000, now()).is_err());
        let date = now().format("%Y%m%d").to_string();
        let bad = json!({ "schemaVersion": 9, "total": 500 });
        store.set(&date, bad.clone());
        assert!(record(&store, 100, "id", 1000, now()).is_err());
        assert_eq!(store.get(&date), Some(bad));
    }
}
