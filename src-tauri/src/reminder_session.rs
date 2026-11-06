//! Shared reminder lifecycle; consumers may observe closed sessions without
//! depending on either the drink-recording or statistics feature.
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Confirmed,
    Skipped,
    TimedOut,
}

struct Session {
    id: String,
    day: String,
    started: Instant,
    confirmed: bool,
}

#[derive(Default)]
struct Tracker {
    active: Option<Session>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedSession {
    pub day: String,
    pub outcome: Outcome,
    pub display_seconds: u64,
}

impl Tracker {
    fn begin(&mut self) -> bool {
        if self.active.is_some() {
            return false;
        }
        self.active = Some(Session {
            id: format!(
                "{}-{}",
                std::process::id(),
                Local::now().timestamp_nanos_opt().unwrap_or_default()
            ),
            day: Local::now().format("%Y%m%d").to_string(),
            started: Instant::now(),
            confirmed: false,
        });
        true
    }

    fn finish(&mut self, expected: Option<&str>, outcome: Outcome) -> Option<ClosedSession> {
        let session = self.active.as_ref()?;
        if expected.is_some_and(|id| id != session.id) {
            return None;
        }
        let session = self.active.take()?;
        Some(ClosedSession {
            day: session.day,
            outcome: if session.confirmed {
                Outcome::Confirmed
            } else {
                outcome
            },
            display_seconds: session.started.elapsed().as_secs().min(30),
        })
    }
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker { active: None });

pub fn begin() -> bool {
    TRACKER.lock().unwrap().begin()
}

pub fn current_id() -> Option<String> {
    TRACKER
        .lock()
        .unwrap()
        .active
        .as_ref()
        .map(|session| session.id.clone())
}

/// Keep timeout/skip from interleaving with a successful save. Confirmation is
/// established before the closing animation, so timeout cannot misclassify it.
#[allow(dead_code)]
pub fn confirm_with<T>(
    id: &str,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let mut tracker = TRACKER.lock().map_err(|_| "提醒状态不可用")?;
    let session = tracker
        .active
        .as_mut()
        .filter(|session| session.id == id)
        .ok_or("本次提醒已结束，请在饮水记录页添加")?;
    let result = operation()?;
    session.confirmed = true;
    Ok(result)
}

pub fn close(app: &AppHandle, expected: Option<&str>, outcome: Outcome) -> bool {
    let closed = TRACKER.lock().unwrap().finish(expected, outcome);
    let Some(closed) = closed else {
        return false;
    };
    // Never hold TRACKER while calling native window/shortcut APIs: these can
    // wait on the UI thread, which can itself be handling a session command.
    crate::core::window::hide_reminder_windows(app);
    let _ = app.global_shortcut().unregister("Esc");
    let _ = app.emit("reminder_already_hidden", ());
    let _ = app.emit("reminder-session-closed", closed);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiple_monitors_share_one_session_and_close_once() {
        let mut tracker = Tracker::default();
        assert!(tracker.begin());
        assert!(!tracker.begin());
        assert!(tracker.finish(None, Outcome::Skipped).is_some());
        assert!(tracker.finish(None, Outcome::Skipped).is_none());
    }

    #[test]
    fn stale_close_does_not_end_a_new_session() {
        let mut tracker = Tracker::default();
        tracker.begin();
        assert!(tracker
            .finish(Some("old-session"), Outcome::TimedOut)
            .is_none());
        assert!(tracker.active.is_some());
    }

    #[test]
    fn saved_drink_wins_over_timeout_and_keeps_start_day() {
        let mut tracker = Tracker::default();
        tracker.begin();
        let session = tracker.active.as_mut().unwrap();
        session.confirmed = true;
        session.day = "20261022".into();
        session.started -= std::time::Duration::from_secs(7200);
        let closed = tracker.finish(None, Outcome::TimedOut).unwrap();
        assert_eq!(closed.outcome, Outcome::Confirmed);
        assert_eq!(closed.day, "20261022");
        assert_eq!(closed.display_seconds, 30);
    }
}

#[tauri::command]
pub fn get_reminder_session() -> Option<String> {
    current_id()
}

#[tauri::command]
pub async fn record_reminder_drink(
    app_handle: AppHandle,
    amount: u64,
    session: String,
) -> Result<crate::drink_store::Receipt, String> {
    confirm_with(&session, || {
        crate::drink_store::save_drink(&app_handle, amount, &format!("reminder:{session}"))
    })
}
