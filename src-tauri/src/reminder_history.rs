use crate::reminder_session::{ClosedSession, Outcome};
use serde::{Deserialize, Serialize};
use tauri::Listener;
use tauri_plugin_store::StoreExt;

const STORE: &str = "reminder_history_store.json";

#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct DaySummary {
    completed: u64,
    confirmed: u64,
    skipped: u64,
    timed_out: u64,
    display_seconds: u64,
}

impl DaySummary {
    fn record(&mut self, outcome: Outcome, seconds: u64) {
        self.completed += 1;
        match outcome {
            Outcome::Confirmed => self.confirmed += 1,
            Outcome::Skipped => self.skipped += 1,
            Outcome::TimedOut => self.timed_out += 1,
        }
        self.display_seconds += seconds.min(30);
    }
}

pub fn init(app: &tauri::AppHandle) {
    let handle = app.clone();
    app.listen("reminder-session-closed", move |event| {
        let result = (|| -> Result<(), String> {
            let session: ClosedSession =
                serde_json::from_str(event.payload()).map_err(|e| e.to_string())?;
            let store = handle.store(STORE).map_err(|e| e.to_string())?;
            let previous = store.get(&session.day);
            let mut day: DaySummary = previous
                .clone()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or_default();
            day.record(session.outcome, session.display_seconds);
            store.set(
                &session.day,
                serde_json::to_value(day).map_err(|e| e.to_string())?,
            );
            if let Err(error) = store.save() {
                match previous {
                    Some(value) => store.set(&session.day, value),
                    None => {
                        store.delete(&session.day);
                    }
                }
                return Err(error.to_string());
            }
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("保存提醒统计失败: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcomes_accumulate_and_roundtrip() {
        let mut day = DaySummary::default();
        day.record(Outcome::Confirmed, 12);
        day.record(Outcome::Skipped, 3);
        day.record(Outcome::TimedOut, 30);
        let restored: DaySummary =
            serde_json::from_value(serde_json::to_value(day).unwrap()).unwrap();
        assert_eq!(
            (
                restored.completed,
                restored.confirmed,
                restored.skipped,
                restored.timed_out
            ),
            (3, 1, 1, 1)
        );
        assert_eq!(restored.display_seconds, 45);
    }

    #[test]
    fn suspended_time_is_capped() {
        let mut day = DaySummary::default();
        day.record(Outcome::TimedOut, 7200);
        assert_eq!(day.display_seconds, 30);
    }
}
