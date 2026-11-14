use crate::drink_store::{History, WRITER};
use chrono::{DateTime, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;

const HISTORY: &str = "drink_history_store.json";
const FORMAT: &str = "shui-drink-backup";
const MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_NUMBER: u64 = 9_007_199_254_740_991;
type Days = BTreeMap<String, Value>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Backup {
    format: String,
    version: u32,
    exported_at: String,
    #[serde(deserialize_with = "deserialize_days")]
    drink_history: Days,
}

fn deserialize_days<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Days, D::Error> {
    struct Visitor;
    impl<'de> serde::de::Visitor<'de> for Visitor {
        type Value = Days;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("unique drink-history dates")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(self, mut map: M) -> Result<Days, M::Error> {
            let mut days = Days::new();
            while let Some((key, value)) = map.next_entry::<String, Value>()? {
                if days.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("duplicate date"));
                }
            }
            Ok(days)
        }
    }
    deserializer.deserialize_map(Visitor)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    token: String,
    file_name: String,
    days: usize,
    new_days: usize,
    skipped_days: usize,
    new_amount: u64,
    detailed_entries: usize,
    first_date: String,
    last_date: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReceipt {
    imported_days: usize,
    skipped_days: usize,
    imported_amount: u64,
    already_imported: bool,
}

struct Pending {
    token: String,
    backup: Backup,
    receipt: Option<ImportReceipt>,
}

impl Pending {
    fn confirm(
        &mut self,
        token: &str,
        operation: impl FnOnce(&Days) -> Result<ImportReceipt, String>,
    ) -> Result<ImportReceipt, String> {
        if self.token != token {
            return Err("预览已失效，请重新选择文件".into());
        }
        if let Some(receipt) = &self.receipt {
            return Ok(ImportReceipt {
                already_imported: true,
                ..receipt.clone()
            });
        }
        let result = operation(&self.backup.drink_history)?;
        self.receipt = Some(result.clone());
        Ok(result)
    }
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize before the timer or webviews access this Store. All drink
    // writers explicitly save; disabling debounce prevents an older automatic
    // write from racing an atomic import replacement.
    app.store_builder(HISTORY).disable_auto_save().build()?;
    Ok(())
}

fn valid_date(key: &str) -> bool {
    key.len() == 8
        && key.bytes().all(|b| b.is_ascii_digit())
        && NaiveDate::parse_from_str(key, "%Y%m%d").is_ok()
}

fn number(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= MAX_NUMBER)
}

fn add_id(ids: &mut HashSet<String>, value: &Value) -> Result<(), String> {
    let id = value
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 160 && id.is_ascii())
        .ok_or("备份包含无效的记录标识")?;
    if !ids.insert(id.to_owned()) {
        return Err("备份包含重复或已撤销的记录标识".into());
    }
    Ok(())
}

fn validate_days(days: &Days) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    for (key, value) in days {
        if !valid_date(key) {
            return Err(format!("无效的记录日期：{key}"));
        }
        if number(value).is_some() {
            continue;
        }
        if value["schemaVersion"] != 1 {
            return Err(format!("{key} 的记录格式不受支持"));
        }
        let total = number(&value["total"]).ok_or("备份包含无效的每日总量")?;
        if number(&value["goal"]).filter(|n| *n > 0).is_none() {
            return Err("备份包含无效的历史目标".into());
        }
        let entries = value["entries"].as_array().ok_or("备份缺少逐笔记录列表")?;
        let mut sum = 0_u64;
        for entry in entries {
            let amount = number(&entry["amount"])
                .filter(|n| *n > 0)
                .ok_or("备份包含无效的单次饮水量")?;
            sum = sum.checked_add(amount).ok_or("备份饮水量超出范围")?;
            let timestamp = entry["timestamp"].as_str().ok_or("备份缺少记录时间")?;
            DateTime::parse_from_rfc3339(timestamp).map_err(|_| "备份包含无效的记录时间")?;
            if let Some(id) = entry.get("requestId") {
                add_id(&mut ids, id)?;
            }
        }
        if sum > total {
            return Err(format!("{key} 的逐笔水量超过每日总量"));
        }
        if let Some(revoked) = value.get("revokedRequestIds") {
            for id in revoked.as_array().ok_or("备份撤销标识格式错误")? {
                add_id(&mut ids, id)?;
            }
        }
    }
    Ok(ids)
}

fn parse_backup(bytes: &[u8]) -> Result<Backup, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("备份文件不能超过 16 MB".into());
    }
    let backup: Backup =
        serde_json::from_slice(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes))
            .map_err(|_| "文件不是有效的 Shui JSON 备份")?;
    if backup.format != FORMAT || backup.version != 1 {
        return Err("不支持此备份格式或版本".into());
    }
    DateTime::parse_from_rfc3339(&backup.exported_at).map_err(|_| "备份生成时间无效")?;
    if backup.drink_history.is_empty() {
        return Err("备份中没有饮水记录".into());
    }
    validate_days(&backup.drink_history)?;
    Ok(backup)
}

fn merge_missing(current: &Days, incoming: &Days) -> Result<(Days, ImportReceipt), String> {
    let mut merged = current.clone();
    let mut result = ImportReceipt {
        imported_days: 0,
        skipped_days: 0,
        imported_amount: 0,
        already_imported: false,
    };
    for (key, value) in incoming {
        if current.contains_key(key) {
            result.skipped_days += 1;
            continue;
        }
        merged.insert(key.clone(), value.clone());
        result.imported_days += 1;
        let amount = number(value)
            .or_else(|| number(&value["total"]))
            .ok_or("备份包含无效的每日总量")?;
        result.imported_amount = result
            .imported_amount
            .checked_add(amount)
            .filter(|n| *n <= MAX_NUMBER)
            .ok_or("导入总量超出范围")?;
    }
    // Validate the union too: a missing day can still carry an ID already used
    // or revoked on another date. Never resurrect those requests by importing.
    validate_days(&merged)?;
    Ok((merged, result))
}

fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| format!("无法读取文件：{e}"))?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取文件失败：{e}"))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("备份文件不能超过 16 MB".into());
    }
    Ok(bytes)
}

fn atomic_write_with(
    path: &Path,
    write: impl FnOnce(&mut File) -> std::io::Result<()>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("文件位置无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建目录：{e}"))?;
    let mut temporary = None;
    for _ in 0..32 {
        let candidate = parent.join(format!(
            ".shui-backup-{}-{}.tmp",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        // The save dialog can return any filename. Cleanup must never target
        // the selected destination, including when it uses our temp prefix.
        if candidate == path {
            continue;
        }
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                temporary = Some((candidate, file));
                break;
            }
            // A crash can leave an old temp file; do not overwrite or remove it.
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建临时文件：{error}")),
        }
    }
    let (temp, mut file) = temporary.ok_or("无法创建独立的临时文件，请重试")?;
    let _cleanup = scopeguard::guard(temp.clone(), |path| {
        let _ = fs::remove_file(path);
    });
    let written = write(&mut file).and_then(|_| file.sync_all());
    drop(file);
    written.map_err(|e| format!("写入失败，原文件未替换：{e}"))?;
    fs::rename(&temp, path).map_err(|e| format!("替换文件失败，原文件未修改：{e}"))?;
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    atomic_write_with(path, |file| file.write_all(bytes))
}

fn check_export_path(selected: &Path, protected: &[std::path::PathBuf]) -> Result<(), String> {
    let resolved = fs::canonicalize(selected).unwrap_or_else(|_| selected.to_owned());
    if protected
        .iter()
        .any(|path| fs::canonicalize(path).unwrap_or_else(|_| path.clone()) == resolved)
    {
        return Err("不能覆盖应用正在使用的数据文件，请选择其他位置".into());
    }
    Ok(())
}

fn persist_import(path: &Path, current: &Days, merged: &Days) -> Result<(), String> {
    // Store's loader ignores malformed-file errors. Protect unreadable or stale
    // on-disk data instead of replacing it with a possibly empty cache.
    let disk: Days = match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "本地记录文件无法解析，导入已停止")?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Days::new(),
        Err(e) => return Err(format!("无法读取本地记录：{e}")),
    };
    if &disk != current {
        return Err("本地记录已发生变化，请重启应用后重试".into());
    }
    let bytes = serde_json::to_vec(merged).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("合并后的记录超过 16 MB，导入已停止".into());
    }
    atomic_write(path, &bytes)
}

fn snapshot(store: &impl History) -> Days {
    store.entries().into_iter().collect()
}

fn apply_import(
    store: &impl History,
    incoming: &Days,
    persist: impl FnOnce(&Days) -> Result<(), String>,
) -> Result<ImportReceipt, String> {
    let current = snapshot(store);
    let (merged, result) = merge_missing(&current, incoming)?;
    if result.imported_days == 0 {
        return Ok(result);
    }
    persist(&merged)?;
    // Disk replacement succeeds before modifying the cache or notifying views.
    for (key, value) in incoming {
        if !current.contains_key(key) {
            store.set(key, value.clone());
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn export_drink_backup(app_handle: AppHandle) -> Result<Option<String>, String> {
    let bytes = {
        let _writer = WRITER.lock().map_err(|_| "饮水数据暂不可用")?;
        let store = app_handle.store(HISTORY).map_err(|e| e.to_string())?;
        let days = snapshot(store.as_ref());
        if days.is_empty() {
            return Err("还没有可备份的饮水记录".into());
        }
        validate_days(&days)?;
        let bytes = serde_json::to_vec_pretty(&Backup {
            format: FORMAT.into(),
            version: 1,
            exported_at: Local::now().to_rfc3339(),
            drink_history: days,
        })
        .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("备份超过 16 MB，暂不支持导出".into());
        }
        bytes
    };
    let file = app_handle
        .dialog()
        .file()
        .set_title("备份饮水记录")
        .set_file_name(format!(
            "shui-drink-backup-{}.json",
            Local::now().format("%Y%m%d")
        ))
        .add_filter("Shui JSON 备份", &["json"])
        .blocking_save_file();
    let Some(file) = file else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let protected = [HISTORY, "config_store.json", "reminder_history_store.json"]
        .map(|name| {
            tauri_plugin_store::resolve_store_path(&app_handle, name).map_err(|e| e.to_string())
        })
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    check_export_path(&path, &protected)?;
    atomic_write(&path, &bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn preview_drink_import(app_handle: AppHandle) -> Result<Option<ImportPreview>, String> {
    *PENDING.lock().map_err(|_| "导入状态不可用")? = None;
    let file = app_handle
        .dialog()
        .file()
        .set_title("选择饮水记录备份")
        .add_filter("Shui JSON 备份", &["json"])
        .blocking_pick_file();
    let Some(file) = file else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let backup = parse_backup(&read_limited(&path)?)?;
    let (_, result) = {
        let _writer = WRITER.lock().map_err(|_| "饮水数据暂不可用")?;
        let store = app_handle.store(HISTORY).map_err(|e| e.to_string())?;
        merge_missing(&snapshot(store.as_ref()), &backup.drink_history)?
    };
    let token = format!(
        "{}-{}",
        Local::now().timestamp_nanos_opt().unwrap_or_default(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let preview = ImportPreview {
        token: token.clone(),
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        days: backup.drink_history.len(),
        new_days: result.imported_days,
        skipped_days: result.skipped_days,
        new_amount: result.imported_amount,
        detailed_entries: backup
            .drink_history
            .values()
            .filter_map(|v| v["entries"].as_array())
            .map(Vec::len)
            .sum(),
        first_date: backup.drink_history.keys().next().unwrap().clone(),
        last_date: backup.drink_history.keys().next_back().unwrap().clone(),
    };
    *PENDING.lock().map_err(|_| "导入状态不可用")? = Some(Pending {
        token,
        backup,
        receipt: None,
    });
    Ok(Some(preview))
}

#[tauri::command]
pub async fn confirm_drink_import(
    app_handle: AppHandle,
    token: String,
) -> Result<ImportReceipt, String> {
    let mut pending = PENDING.lock().map_err(|_| "导入状态不可用")?;
    let pending = pending.as_mut().ok_or("预览已失效，请重新选择文件")?;
    pending.confirm(&token, |incoming| {
        let _writer = WRITER.lock().map_err(|_| "饮水数据暂不可用")?;
        let store = app_handle.store(HISTORY).map_err(|e| e.to_string())?;
        let path = tauri_plugin_store::resolve_store_path(&app_handle, HISTORY)
            .map_err(|e| e.to_string())?;
        apply_import(store.as_ref(), incoming, |merged| {
            persist_import(&path, &snapshot(store.as_ref()), merged)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drink_store::{
        record,
        test_support::{now, Memory},
    };
    use serde_json::json;
    use std::sync::Arc;

    fn day() -> Value {
        json!({ "schemaVersion": 1, "total": 900, "goal": 1500,
            "entries": [{ "amount": 100, "timestamp": "2026-10-22T01:00:00Z", "requestId": "manual:one" }],
            "revokedRequestIds": ["manual:revoked"] })
    }

    fn backup(days: Days) -> Backup {
        Backup {
            format: FORMAT.into(),
            version: 1,
            exported_at: "2026-11-06T12:00:00+08:00".into(),
            drink_history: days,
        }
    }

    fn encode(days: Days) -> Vec<u8> {
        serde_json::to_vec(&backup(days)).unwrap()
    }

    fn directory() -> scopeguard::ScopeGuard<std::path::PathBuf, impl FnOnce(std::path::PathBuf)> {
        let path = std::env::temp_dir().join(format!(
            "shui-backup-test-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        scopeguard::guard(path, |path| {
            let _ = fs::remove_dir_all(path);
        })
    }

    #[test]
    fn roundtrip_preserves_legacy_totals_entries_goals_and_tombstones() {
        let days = Days::from([("20261021".into(), json!(800)), ("20261022".into(), day())]);
        assert_eq!(
            parse_backup(&encode(days.clone())).unwrap().drink_history,
            days
        );
        let mut bom = vec![0xef, 0xbb, 0xbf];
        bom.extend(encode(days.clone()));
        assert_eq!(parse_backup(&bom).unwrap().drink_history, days);
    }

    #[test]
    fn rejects_malformed_empty_wrong_format_and_future_versions() {
        for bytes in [b"not json".to_vec(), b"{}".to_vec(), encode(Days::new())] {
            assert!(parse_backup(&bytes).is_err());
        }
        let mut value =
            serde_json::to_value(backup(Days::from([("20261022".into(), day())]))).unwrap();
        value["version"] = json!(2);
        assert!(parse_backup(&serde_json::to_vec(&value).unwrap()).is_err());
        value["version"] = json!(1);
        value["format"] = json!("unrelated-app");
        assert!(parse_backup(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn rejects_duplicate_dates_instead_of_silently_keeping_the_last_total() {
        let bytes = br#"{"format":"shui-drink-backup","version":1,"exportedAt":"2026-11-06T12:00:00+08:00","drinkHistory":{"20261022":100,"20261022":200}}"#;
        assert!(parse_backup(bytes).is_err());
    }

    #[test]
    fn validates_real_calendar_dates_and_size_limits() {
        assert!(parse_backup(&encode(Days::from([("20240229".into(), json!(100))]))).is_ok());
        for key in ["20230229", "20261301", "20261131", "2026-11-06", "../../xx"] {
            assert!(parse_backup(&encode(Days::from([(key.into(), json!(100))]))).is_err());
        }
        assert!(parse_backup(&vec![b' '; MAX_BYTES as usize + 1])
            .unwrap_err()
            .contains("16 MB"));
    }

    #[test]
    fn rejects_unsafe_numbers_goals_unknown_schema_and_inconsistent_totals() {
        for value in [json!(-1), json!(1.5), json!(MAX_NUMBER + 1)] {
            assert!(parse_backup(&encode(Days::from([("20261022".into(), value)]))).is_err());
        }
        for (field, bad) in [
            ("goal", json!(0)),
            ("schemaVersion", json!(2)),
            ("total", json!(50)),
        ] {
            let mut value = day();
            value[field] = bad;
            assert!(parse_backup(&encode(Days::from([("20261022".into(), value)]))).is_err());
        }
    }

    #[test]
    fn rejects_invalid_times_and_duplicate_or_revoked_live_ids() {
        let mut value = day();
        value["entries"][0]["timestamp"] = json!("invalid");
        assert!(parse_backup(&encode(Days::from([("20261022".into(), value)]))).is_err());
        let mut value = day();
        value["revokedRequestIds"] = json!(["manual:one"]);
        assert!(parse_backup(&encode(Days::from([("20261022".into(), value)]))).is_err());
        assert!(parse_backup(&encode(Days::from([
            ("20261021".into(), day()),
            ("20261022".into(), day())
        ])))
        .is_err());
    }

    #[test]
    fn only_adds_missing_dates_and_never_sums_or_overwrites_existing_days() {
        let store = Memory::default();
        store.set("20261021", json!(500));
        let incoming = Days::from([("20261021".into(), json!(800)), ("20261022".into(), day())]);
        let result = apply_import(&store, &incoming, |merged| {
            assert_eq!(merged["20261021"], 500);
            assert_eq!(merged["20261022"], day());
            Ok(())
        })
        .unwrap();
        assert_eq!(
            (
                result.imported_days,
                result.skipped_days,
                result.imported_amount
            ),
            (1, 1, 900)
        );
        assert_eq!(store.get("20261021"), Some(json!(500)));
        let repeated =
            apply_import(&store, &incoming, |_| panic!("repeat must not write disk")).unwrap();
        assert_eq!((repeated.imported_days, repeated.skipped_days), (0, 2));
    }

    #[test]
    fn confirmation_rechecks_dates_added_since_preview() {
        let store = Memory::default();
        let incoming = Days::from([("20261022".into(), json!(800))]);
        assert_eq!(
            merge_missing(&snapshot(&store), &incoming)
                .unwrap()
                .1
                .imported_days,
            1
        );
        store.set("20261022", json!(200));
        assert_eq!(
            apply_import(&store, &incoming, |_| panic!("new day must be skipped"))
                .unwrap()
                .skipped_days,
            1
        );
        assert_eq!(store.get("20261022"), Some(json!(200)));
    }

    #[test]
    fn rejects_request_id_collisions_across_local_and_imported_dates() {
        let store = Memory::default();
        store.set("20261021", day());
        let before = snapshot(&store);
        assert!(apply_import(
            &store,
            &Days::from([("20261022".into(), day())]),
            |_| panic!("invalid merge must not persist")
        )
        .is_err());
        assert_eq!(snapshot(&store), before);
    }

    #[test]
    fn persist_failure_does_not_mutate_cache_and_retry_succeeds() {
        let store = Memory::default();
        store.set("20261021", json!(500));
        let before = snapshot(&store);
        let incoming = Days::from([("20261022".into(), day())]);
        assert!(apply_import(&store, &incoming, |_| Err("disk full".into())).is_err());
        assert_eq!(snapshot(&store), before);
        assert_eq!(
            apply_import(&store, &incoming, |_| Ok(()))
                .unwrap()
                .imported_days,
            1
        );
    }

    #[test]
    fn real_file_partial_write_failure_preserves_original_and_cleans_temp() {
        let dir = directory();
        let path = dir.join("history.json");
        fs::write(&path, br#"{"20261021":500}"#).unwrap();
        let before = fs::read(&path).unwrap();
        assert!(atomic_write_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("simulated full disk"))
        })
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read_dir(&*dir).unwrap().count(), 1);
    }

    #[test]
    fn selected_backup_name_matching_temp_name_is_not_deleted() {
        let dir = directory();
        let path = dir.join(format!(
            ".shui-backup-{}-{}.tmp",
            std::process::id(),
            SEQUENCE.load(Ordering::Relaxed)
        ));
        atomic_write(&path, b"backup").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"backup");
    }

    #[test]
    fn existing_temp_files_are_preserved_and_do_not_prevent_saving() {
        let dir = directory();
        let leftover = dir.join(format!(
            ".shui-backup-{}-{}.tmp",
            std::process::id(),
            SEQUENCE.load(Ordering::Relaxed)
        ));
        fs::write(&leftover, b"leftover").unwrap();
        let path = dir.join("backup.json");
        atomic_write(&path, b"new backup").unwrap();
        assert_eq!(fs::read(&leftover).unwrap(), b"leftover");
        assert_eq!(fs::read(&path).unwrap(), b"new backup");
        assert_eq!(fs::read_dir(&*dir).unwrap().count(), 2);
    }

    #[test]
    fn real_file_import_roundtrip_and_rename_failure_are_safe() {
        let dir = directory();
        let path = dir.join("history.json");
        let incoming = Days::from([("20261022".into(), day())]);
        let store = Memory::default();
        apply_import(&store, &incoming, |merged| {
            atomic_write(&path, &serde_json::to_vec(merged).unwrap())
        })
        .unwrap();
        let reloaded: Days = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(reloaded, incoming);
        let directory_target = dir.join("directory");
        fs::create_dir(&directory_target).unwrap();
        fs::write(directory_target.join("keep"), b"original").unwrap();
        assert!(atomic_write(&directory_target, b"new").is_err());
        assert_eq!(
            fs::read(directory_target.join("keep")).unwrap(),
            b"original"
        );
        assert_eq!(fs::read_dir(&*dir).unwrap().count(), 2);
    }

    #[test]
    fn restored_ids_still_prevent_duplicate_drinks_and_resurrection() {
        let store = Memory::default();
        apply_import(
            &store,
            &Days::from([("20261022".into(), day())]),
            |_| Ok(()),
        )
        .unwrap();
        assert!(
            !record(&store, 100, "manual:one", 1000, now())
                .unwrap()
                .added
        );
        assert!(record(&store, 100, "manual:revoked", 1000, now()).is_err());
    }

    #[test]
    fn refuses_to_replace_corrupt_or_externally_changed_local_files() {
        let dir = directory();
        let path = dir.join("history.json");
        let merged = Days::from([("20261022".into(), day())]);
        fs::write(&path, b"corrupt").unwrap();
        assert!(persist_import(&path, &Days::new(), &merged).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"corrupt");
        fs::write(&path, br#"{"20261021":500}"#).unwrap();
        assert!(persist_import(&path, &Days::new(), &merged).is_err());
        assert_eq!(fs::read(&path).unwrap(), br#"{"20261021":500}"#);
    }

    #[test]
    fn export_cannot_replace_live_application_data_files() {
        let dir = directory();
        let path = dir.join(HISTORY);
        fs::write(&path, b"original").unwrap();
        assert!(check_export_path(&path, &[path.clone()]).is_err());
        assert!(check_export_path(&dir.join("backup.json"), &[path.clone()]).is_ok());
        #[cfg(unix)]
        {
            let alias = dir.join("alias.json");
            std::os::unix::fs::symlink(&path, &alias).unwrap();
            assert!(check_export_path(&alias, &[path.clone()]).is_err());
        }
        assert_eq!(fs::read(&path).unwrap(), b"original");
    }

    #[test]
    fn normal_recording_continues_after_importing_structured_today() {
        let store = Memory::default();
        let date = now().format("%Y%m%d").to_string();
        apply_import(&store, &Days::from([(date.clone(), day())]), |_| Ok(())).unwrap();
        assert_eq!(
            record(&store, 50, "new-after-import", 1500, now())
                .unwrap()
                .total,
            950
        );
        let value = store.get(&date).unwrap();
        assert_eq!(value["entries"].as_array().unwrap().len(), 2);
        assert_eq!(value["revokedRequestIds"], json!(["manual:revoked"]));
    }

    #[test]
    fn confirmation_validates_token_retries_failures_and_returns_cached_receipt() {
        let mut pending = Pending {
            token: "valid".into(),
            backup: backup(Days::from([("20261022".into(), day())])),
            receipt: None,
        };
        assert!(pending
            .confirm("expired", |_| panic!("wrong token must not write"))
            .is_err());
        assert!(pending
            .confirm("valid", |_| Err("disk full".into()))
            .is_err());
        assert!(pending.receipt.is_none());
        assert!(
            !pending
                .confirm("valid", |_| Ok(ImportReceipt {
                    imported_days: 1,
                    skipped_days: 0,
                    imported_amount: 900,
                    already_imported: false,
                }))
                .unwrap()
                .already_imported
        );
        let retry = pending
            .confirm("valid", |_| {
                panic!("uncertain response must not import again")
            })
            .unwrap();
        assert!(retry.already_imported);
        assert_eq!((retry.imported_days, retry.imported_amount), (1, 900));
    }

    #[test]
    fn import_and_normal_recording_use_the_same_writer_lock() {
        let store = Arc::new(Memory::default());
        let date = now().format("%Y%m%d").to_string();
        let mut threads = Vec::new();
        for i in 0..20 {
            let store = store.clone();
            let date = date.clone();
            threads.push(std::thread::spawn(move || {
                if i % 2 == 0 {
                    let _writer = WRITER.lock().unwrap();
                    apply_import(
                        store.as_ref(),
                        &Days::from([(date, json!(800))]),
                        |_| Ok(()),
                    )
                    .unwrap();
                } else {
                    record(store.as_ref(), 50, &format!("concurrent-{i}"), 1000, now()).unwrap();
                }
            }));
        }
        for thread in threads {
            thread.join().unwrap();
        }
        let value = store.get(&date).unwrap();
        let total = value["total"].as_u64().unwrap();
        assert!(total == 500 || total == 1300); // import won first, or was safely skipped
        assert_eq!(value["entries"].as_array().unwrap().len(), 10);
    }
}
