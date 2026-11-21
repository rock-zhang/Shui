//! Local calendar precedence: personal exceptions, imported holidays, weekly rotation.
use chrono::{Datelike, Duration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, sync::Mutex};
use tauri_plugin_store::StoreExt;

static SETTINGS_WRITE: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DateOverride {
    pub date: String,
    pub remind: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlternatingWeeks {
    pub anchor_date: String,
    pub big_weekdays: Vec<u64>,
    pub small_weekdays: Vec<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HolidayCalendar {
    pub year: i32,
    pub source: String,
    pub enabled: bool,
    pub days: Vec<DateOverride>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkCalendar {
    pub weekdays: Vec<u64>,
    pub schedule_mode: String,
    pub alternating_weeks: Option<AlternatingWeeks>,
    pub date_overrides: Vec<DateOverride>,
    pub holiday_calendars: Vec<HolidayCalendar>,
}
#[derive(Debug, Clone, Serialize)]
pub struct CalendarDay {
    pub date: String,
    pub remind: bool,
    pub reason: &'static str,
    pub name: String,
}
pub fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .filter(|date| {
            value.len() == 10 && date.year() > 0 && date.format("%Y-%m-%d").to_string() == value
        })
}
fn week_start(date: NaiveDate) -> NaiveDate {
    date - Duration::days(date.weekday().num_days_from_monday().into())
}
impl WorkCalendar {
    pub fn read(config: &Value) -> Self {
        serde_json::from_value(config.clone()).unwrap_or_default()
    }
    pub fn day(&self, date: NaiveDate) -> CalendarDay {
        let iso = date.format("%Y-%m-%d").to_string();
        let custom = self.date_overrides.iter().find(|rule| rule.date == iso);
        let holiday = self
            .holiday_calendars
            .iter()
            .filter(|calendar| calendar.enabled)
            .flat_map(|calendar| &calendar.days)
            .find(|rule| rule.date == iso);
        let (remind, reason, name) = if let Some(rule) = custom {
            (
                rule.remind,
                if rule.remind {
                    "custom_workday"
                } else {
                    "custom_day_off"
                },
                rule.name.clone(),
            )
        } else if let Some(rule) = holiday {
            (
                rule.remind,
                if rule.remind {
                    "holiday_workday"
                } else {
                    "holiday_day_off"
                },
                rule.name.clone(),
            )
        } else if let Some((weeks, anchor)) = self
            .alternating_weeks
            .as_ref()
            .filter(|_| self.schedule_mode == "alternating")
            .and_then(|weeks| parse_date(&weeks.anchor_date).map(|anchor| (weeks, anchor)))
        {
            let big = (date - week_start(anchor))
                .num_days()
                .div_euclid(7)
                .rem_euclid(2)
                == 0;
            let weekdays = if big {
                &weeks.big_weekdays
            } else {
                &weeks.small_weekdays
            };
            (
                weekdays.contains(&(date.weekday().num_days_from_sunday() as u64)),
                if big { "big_week" } else { "small_week" },
                String::new(),
            )
        } else {
            let remind = self
                .weekdays
                .contains(&(date.weekday().num_days_from_sunday() as u64));
            (
                remind,
                if remind {
                    "weekly_workday"
                } else {
                    "weekly_day_off"
                },
                String::new(),
            )
        };
        CalendarDay {
            date: iso,
            remind,
            reason,
            name,
        }
    }
    fn validate(&self) -> Result<(), String> {
        let valid_days = |days: &[u64]| days.iter().all(|day| *day <= 6);
        if !valid_days(&self.weekdays) {
            return Err("calendar.invalidWeekdays".into());
        }
        if !["", "weekly", "alternating"].contains(&self.schedule_mode.as_str()) {
            return Err("calendar.invalidMode".into());
        }
        if let Some(weeks) = &self.alternating_weeks {
            if parse_date(&weeks.anchor_date).is_none()
                || !valid_days(&weeks.big_weekdays)
                || !valid_days(&weeks.small_weekdays)
            {
                return Err("calendar.invalidRotation".into());
            }
        } else if self.schedule_mode == "alternating" {
            return Err("calendar.invalidRotation".into());
        }
        validate_dates(&self.date_overrides, None)?;
        let mut years = BTreeSet::new();
        for calendar in &self.holiday_calendars {
            if !years.insert(calendar.year) || calendar.days.is_empty() {
                return Err("calendar.invalidImport".into());
            }
            validate_dates(&calendar.days, Some(calendar.year))?;
        }
        Ok(())
    }
}
fn validate_dates(rules: &[DateOverride], year: Option<i32>) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for rule in rules {
        let date = parse_date(&rule.date).ok_or("calendar.invalidRange")?;
        if !seen.insert(&rule.date) || year.is_some_and(|year| date.year() != year) {
            return Err("calendar.invalidImport".into());
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSettings {
    pub config: Value,
    pub today: CalendarDay,
    pub preview: Vec<CalendarDay>,
}
#[tauri::command]
pub fn get_calendar_settings(app: tauri::AppHandle) -> Result<CalendarSettings, String> {
    // Also initializes defaults on a first launch.
    let _ = crate::core::store::settings::AppSettings::load_from_store::<tauri::Wry>(&app);
    let store = app.store("config_store.json").map_err(|e| e.to_string())?;
    let config = store.get("alert").unwrap_or_else(|| json!({}));
    let calendar = WorkCalendar::read(&config);
    let now = Local::now().date_naive();
    Ok(CalendarSettings {
        today: calendar.day(now),
        preview: (0..28)
            .map(|days| calendar.day(now + Duration::days(days)))
            .collect(),
        config,
    })
}
/// Patches keep calendar fields intact when another reminder setting changes.
#[tauri::command]
pub fn update_reminder_settings(
    app: tauri::AppHandle,
    patch: Value,
) -> Result<CalendarSettings, String> {
    let _write = SETTINGS_WRITE.lock().map_err(|e| e.to_string())?;
    let store = app.store("config_store.json").map_err(|e| e.to_string())?;
    let previous = store.get("alert").unwrap_or_else(|| json!({}));
    let mut next = previous.as_object().cloned().unwrap_or_default();
    let fields = patch.as_object().ok_or("calendar.invalidImport")?;
    for (key, value) in fields {
        next.insert(key.clone(), value.clone());
    }
    let next = Value::Object(next);
    let calendar: WorkCalendar =
        serde_json::from_value(next.clone()).map_err(|_| "calendar.invalidImport")?;
    calendar.validate()?;
    let reschedule = fields.keys().any(|key| {
        [
            "gap",
            "weekdays",
            "timeStart",
            "timeEnd",
            "scheduleMode",
            "alternatingWeeks",
            "dateOverrides",
            "holidayCalendars",
        ]
        .contains(&key.as_str())
    });
    store.set("alert", next);
    if let Err(error) = store.save() {
        store.set("alert", previous);
        return Err(error.to_string());
    }
    #[cfg(not(target_os = "android"))]
    if reschedule {
        crate::commands::reset_timer();
    }
    #[cfg(target_os = "android")]
    if reschedule {
        crate::mobile::sync_reminder_schedule(app.clone())?;
    } else {
        crate::mobile::sync_reminder_config(app.clone())?;
    }
    get_calendar_settings(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rotation_uses_calendar_weeks_across_years_and_before_the_anchor() {
        let calendar =
            WorkCalendar::read(&json!({"scheduleMode":"alternating", "alternatingWeeks":{
                "anchorDate":"2026-12-30", "bigWeekdays":[1,2,3,4,5,6], "smallWeekdays":[1,2,3,4,5]
            }}));
        for (date, expected) in [
            ("2026-12-26", false),
            ("2027-01-02", true),
            ("2027-01-09", false),
            ("2027-01-16", true),
        ] {
            assert_eq!(
                calendar.day(parse_date(date).unwrap()).remind,
                expected,
                "{date}"
            );
        }
    }
    #[test]
    fn personal_dates_override_imports_and_imports_override_rotation() {
        let mut calendar = WorkCalendar::read(
            &json!({"weekdays":[1,2,3,4,5], "holidayCalendars":[{
            "year":2026,"source":"holiday-cn","enabled":true,"days":[
                {"date":"2026-01-01","remind":false,"name":"元旦"},{"date":"2026-01-04","remind":true}
            ]}], "dateOverrides":[{"date":"2026-01-01","remind":true}]}),
        );
        assert_eq!(
            calendar.day(parse_date("2026-01-01").unwrap()).reason,
            "custom_workday"
        );
        assert_eq!(
            calendar.day(parse_date("2026-01-04").unwrap()).reason,
            "holiday_workday"
        );
        calendar.date_overrides.clear();
        assert_eq!(
            calendar.day(parse_date("2026-01-01").unwrap()).reason,
            "holiday_day_off"
        );
        calendar.holiday_calendars[0].enabled = false;
        assert_eq!(
            calendar.day(parse_date("2026-01-01").unwrap()).reason,
            "weekly_workday"
        );
    }
    #[test]
    fn legacy_dates_and_an_empty_weekly_selection_keep_their_meaning() {
        let calendar = WorkCalendar::read(
            &json!({"weekdays":[],"dateOverrides":[{"date":"2028-02-29","remind":true}]}),
        );
        assert!(calendar.day(parse_date("2028-02-29").unwrap()).remind);
        assert!(!calendar.day(parse_date("2028-03-01").unwrap()).remind);
    }
}
