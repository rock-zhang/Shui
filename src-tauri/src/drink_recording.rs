use crate::drink_store::{save_drink, History, Receipt, WRITER};
use serde::Serialize;
use serde_json::json;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize)]
pub struct UndoReceipt {
    total: u64,
    undone: bool,
}

fn undo<S: History>(store: &S, date: &str, request_id: &str) -> Result<UndoReceipt, String> {
    let _guard = WRITER.lock().map_err(|_| "饮水写入暂不可用")?;
    if date.len() != 8
        || !date.bytes().all(|b| b.is_ascii_digit())
        || request_id.is_empty()
        || request_id.len() > 160
        || !request_id.is_ascii()
    {
        return Err("无效的记录标识".into());
    }
    let previous = store.get(date).ok_or("记录不存在")?;
    if previous["schemaVersion"] != 1 || !previous["entries"].is_array() {
        return Err("旧版总量或未知格式不能逐笔撤销".into());
    }
    let total = previous["total"].as_u64().ok_or("无效的饮水总量")?;
    let mut next = previous.clone();
    if next.get("revokedRequestIds").is_none() {
        next["revokedRequestIds"] = json!([]);
    }
    let revoked = next["revokedRequestIds"]
        .as_array_mut()
        .ok_or("撤销记录格式错误")?;
    if revoked.iter().any(|id| id.as_str() == Some(request_id)) {
        return Ok(UndoReceipt {
            total,
            undone: false,
        });
    }
    revoked.push(json!(request_id));
    let entries = next["entries"].as_array_mut().unwrap();
    let matches: Vec<_> = entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| entry["requestId"].as_str() == Some(request_id))
        .map(|(i, _)| i)
        .collect();
    if matches.len() != 1 {
        return Err("记录不存在或标识不唯一，原数据未修改".into());
    }
    let index = matches[0];
    let amount = entries[index]["amount"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or("无效的饮水量")?;
    let total = total
        .checked_sub(amount)
        .ok_or("饮水总量不一致，原数据未修改")?;
    entries.remove(index);
    next["total"] = json!(total);
    store.set(date, next);
    if let Err(error) = store.save() {
        store.set(date, previous);
        return Err(format!("撤销保存失败，请重试：{error}"));
    }
    Ok(UndoReceipt {
        total,
        undone: true,
    })
}

fn undo_saved_drink(
    app: &tauri::AppHandle,
    date: &str,
    request_id: &str,
) -> Result<UndoReceipt, String> {
    let store = app
        .store("drink_history_store.json")
        .map_err(|e| e.to_string())?;
    undo(store.as_ref(), date, request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drink_store::{record, test_support::*};
    use std::sync::{atomic::Ordering, Arc};
    #[test]
    fn undo_preserves_legacy_total_goal_and_retry_tombstone() {
        let store = Memory::default();
        let date = now().format("%Y%m%d").to_string();
        store.set(&date, json!(800));
        record(&store, 200, "one", 1000, now()).unwrap();
        assert_eq!(undo(&store, &date, "one").unwrap().total, 800);
        assert!(!undo(&store, &date, "one").unwrap().undone);
        assert!(record(&store, 200, "one", 1000, now() + chrono::Duration::days(1)).is_err());
        let saved = store.get(&date).unwrap();
        assert_eq!(saved["goal"], 1000);
        assert_eq!(saved["entries"], json!([]));
        assert_eq!(saved["revokedRequestIds"], json!(["one"]));
        // A fresh store instance models reload of the persisted tombstone.
        let reloaded = Memory::default();
        reloaded.set(&date, saved);
        assert!(record(&reloaded, 200, "one", 1000, now()).is_err());
        assert_eq!(
            record(&reloaded, 100, "new", 1000, now()).unwrap().total,
            900
        );
    }

    #[test]
    fn failed_undo_restores_data_and_can_retry() {
        let store = Memory::default();
        let date = now().format("%Y%m%d").to_string();
        record(&store, 200, "one", 1000, now()).unwrap();
        let before = store.get(&date);
        store.fail.store(true, Ordering::SeqCst);
        assert!(undo(&store, &date, "one").is_err());
        assert_eq!(store.get(&date), before);
        store.fail.store(false, Ordering::SeqCst);
        assert_eq!(undo(&store, &date, "one").unwrap().total, 0);
    }

    #[test]
    fn concurrent_undo_and_add_do_not_double_subtract_or_lose_updates() {
        let store = Arc::new(Memory::default());
        let date = now().format("%Y%m%d").to_string();
        record(store.as_ref(), 200, "one", 1000, now()).unwrap();
        let threads: Vec<_> = (0..20)
            .map(|i| {
                let store = store.clone();
                let date = date.clone();
                std::thread::spawn(move || {
                    if i % 2 == 0 {
                        usize::from(undo(store.as_ref(), &date, "one").unwrap().undone)
                    } else {
                        record(store.as_ref(), 50, &format!("new-{i}"), 1000, now()).unwrap();
                        0
                    }
                })
            })
            .collect();
        assert_eq!(
            threads
                .into_iter()
                .map(|t| t.join().unwrap())
                .sum::<usize>(),
            1
        );
        assert_eq!(store.get(&date).unwrap()["total"], 500);
    }

    #[test]
    fn undo_rejects_legacy_missing_and_inconsistent_records_without_mutation() {
        let store = Memory::default();
        let date = now().format("%Y%m%d").to_string();
        for value in [
            json!(500),
            json!({"schemaVersion": 1, "total": 50, "entries": [{"amount": 100, "requestId": "one"}]}),
            json!({"schemaVersion": 9, "total": 100, "entries": []}),
        ] {
            store.set(&date, value.clone());
            assert!(undo(&store, &date, "one").is_err());
            assert_eq!(store.get(&date), Some(value));
        }
        assert!(undo(&store, "bad-date", "one").is_err());
        assert!(undo(&store, &date, "").is_err());
        assert!(undo(&store, "20000101", "missing").is_err());
    }
}

#[tauri::command]
pub async fn record_drink(
    app_handle: tauri::AppHandle,
    amount: u64,
    request_id: String,
) -> Result<Receipt, String> {
    if request_id.is_empty() || request_id.len() > 128 || !request_id.is_ascii() {
        return Err("无效的请求标识".into());
    }
    save_drink(&app_handle, amount, &format!("manual:{request_id}"))
}

#[tauri::command]
pub async fn undo_drink(
    app_handle: tauri::AppHandle,
    date: String,
    request_id: String,
) -> Result<UndoReceipt, String> {
    undo_saved_drink(&app_handle, &date, &request_id)
}
