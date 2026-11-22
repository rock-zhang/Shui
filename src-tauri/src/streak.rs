//! 连续达标天数与里程碑。
//!
//! 账本格式在 `drink_store.rs`，这里只消费「日期键 → 当日总量」，不直接写饮水数据。
//! 规则：
//! - 当日总量 >= 每日目标即为达标；
//! - 今日尚未达标不算断连，从昨天开始回溯；
//! - 里程碑取 7 / 30 / 100 中不超过当前连续天数、且尚未庆祝过的最大值。

use chrono::{Days, Local, NaiveDate};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use tauri_plugin_store::StoreExt;

pub(crate) const MILESTONES: [u32; 3] = [7, 30, 100];
const STREAK_STORE: &str = "streak_store.json";
const CELEBRATED_KEY: &str = "celebrated";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StreakInfo {
    pub(crate) current: u32,
    pub(crate) best: u32,
    pub(crate) today_completed: bool,
    /// 需要弹一次庆祝的里程碑；0 表示没有新的里程碑。
    pub(crate) milestone: u32,
}

/// 从账本条目提取「日期 → 当日总量」。只认 `YYYYMMDD` 键，数字与对象两种旧格式都兼容。
pub(crate) fn totals_from_entries(entries: Vec<(String, Value)>) -> BTreeMap<NaiveDate, u64> {
    entries
        .into_iter()
        .filter_map(|(key, value)| {
            let date = NaiveDate::parse_from_str(&key, "%Y%m%d").ok()?;
            let total = value
                .as_u64()
                .or_else(|| value.get("total").and_then(Value::as_u64))?;
            Some((date, total))
        })
        .collect()
}

/// 纯计算，便于单测覆盖跨月、缺日与里程碑选值。
pub(crate) fn compute(
    totals: &BTreeMap<NaiveDate, u64>,
    today: NaiveDate,
    goal: u64,
    celebrated: u32,
) -> StreakInfo {
    let completed = |date: &NaiveDate| goal > 0 && totals.get(date).is_some_and(|total| *total >= goal);
    let today_completed = completed(&today);

    // 今日未达标时从昨天回溯：当天还没喝够不代表已经断连。
    let mut cursor = if today_completed {
        Some(today)
    } else {
        today.checked_sub_days(Days::new(1))
    };
    let mut current = 0;
    while let Some(date) = cursor {
        if !completed(&date) {
            break;
        }
        current += 1;
        cursor = date.checked_sub_days(Days::new(1));
    }

    let mut best = 0;
    let mut run = 0;
    let mut previous: Option<NaiveDate> = None;
    for (date, total) in totals {
        if goal == 0 || *total < goal {
            run = 0;
            previous = None;
            continue;
        }
        run = match previous {
            Some(prev) if prev.checked_add_days(Days::new(1)) == Some(*date) => run + 1,
            _ => 1,
        };
        best = best.max(run);
        previous = Some(*date);
    }

    let milestone = MILESTONES
        .iter()
        .rev()
        .copied()
        .find(|days| *days <= current && *days > celebrated)
        .unwrap_or(0);

    StreakInfo {
        current,
        best,
        today_completed,
        milestone,
    }
}

fn read_celebrated(app: &tauri::AppHandle) -> u32 {
    app.store(STREAK_STORE)
        .ok()
        .and_then(|store| store.get(CELEBRATED_KEY))
        .and_then(|value| value.as_u64())
        .filter(|value| *value <= u32::MAX as u64)
        .map(|value| value as u32)
        .unwrap_or(0)
}

#[tauri::command]
pub fn get_streak(app: tauri::AppHandle) -> Result<StreakInfo, String> {
    let goal = crate::drink_store::goal_amount(&app);
    let store = app
        .store("drink_history_store.json")
        .map_err(|error| error.to_string())?;
    let totals = totals_from_entries(store.entries());
    // 只关心今天与历史，未来日期即使有数据也不参与回溯；best 仍按全量算。
    let today = Local::now().date_naive();
    Ok(compute(&totals, today, goal, read_celebrated(&app)))
}

/// 记录已庆祝的里程碑。传 0 表示当前断连，允许下次重新达成时再次庆祝。
#[tauri::command]
pub fn ack_streak(app: tauri::AppHandle, days: u32) -> Result<(), String> {
    let next = if days == 0 {
        0
    } else {
        read_celebrated(&app).max(days)
    };
    let store = app.store(STREAK_STORE).map_err(|error| error.to_string())?;
    store.set(CELEBRATED_KEY, Value::from(next));
    store.save().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn totals(pairs: &[(NaiveDate, u64)]) -> BTreeMap<NaiveDate, u64> {
        pairs.iter().copied().collect()
    }

    #[test]
    fn counts_across_month_boundary() {
        let today = day(2026, 3, 2);
        let data = totals(&[
            (day(2026, 2, 27), 1200),
            (day(2026, 2, 28), 1200),
            (day(2026, 3, 1), 1200),
            (today, 1200),
        ]);
        let info = compute(&data, today, 1000, 0);
        assert_eq!(info.current, 4);
        assert_eq!(info.best, 4);
        assert!(info.today_completed);
        assert_eq!(info.milestone, 0);
    }

    #[test]
    fn missing_day_breaks_streak() {
        let today = day(2026, 3, 3);
        // 3 月 1 日缺失，只能算 2 天。
        let data = totals(&[
            (day(2026, 2, 28), 1100),
            (day(2026, 3, 2), 1100),
            (today, 1100),
        ]);
        assert_eq!(compute(&data, today, 1000, 0).current, 2);
    }

    #[test]
    fn today_not_completed_keeps_yesterdays_streak() {
        let today = day(2026, 3, 3);
        let data = totals(&[
            (day(2026, 3, 1), 1000),
            (day(2026, 3, 2), 1500),
            (today, 200),
        ]);
        let info = compute(&data, today, 1000, 0);
        assert_eq!(info.current, 2);
        assert!(!info.today_completed);
        assert_eq!(info.best, 2);
    }

    #[test]
    fn yesterday_missing_means_only_today_counts() {
        let today = day(2026, 3, 3);
        // 今天达标、昨天缺失：连续只能算今天 1 天。
        let completed_today = totals(&[(today, 1500)]);
        let info = compute(&completed_today, today, 1000, 0);
        assert_eq!(info.current, 1);
        assert!(info.today_completed);

        // 今天还没达标、昨天也缺失：连续为 0。
        let in_progress = totals(&[(today, 200)]);
        let info = compute(&in_progress, today, 1000, 0);
        assert_eq!(info.current, 0);
        assert!(!info.today_completed);
    }

    #[test]
    fn milestone_picks_largest_uncelebrated() {
        let today = day(2026, 3, 31);
        let data: BTreeMap<_, _> = (0..31)
            .map(|offset| {
                let date = today.checked_sub_days(Days::new(offset)).unwrap();
                (date, 1500)
            })
            .collect();
        assert_eq!(compute(&data, today, 1000, 0).milestone, 30);
        assert_eq!(compute(&data, today, 1000, 7).milestone, 30);
        assert_eq!(compute(&data, today, 1000, 30).milestone, 0);
        assert_eq!(compute(&data, today, 1000, 100).milestone, 0);
    }

    #[test]
    fn zero_goal_never_completes() {
        let today = day(2026, 3, 3);
        let data = totals(&[(today, 5000)]);
        let info = compute(&data, today, 0, 0);
        assert_eq!(info.current, 0);
        assert_eq!(info.best, 0);
        assert!(!info.today_completed);
    }
}
