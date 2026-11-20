//! 原生侧轻量本地化。
//!
//! 语言偏好由前端写入 Tauri config store 的 `language` 键（见
//! `src/lib/i18n/locales.ts`），取值与前端一致：`"system" | "zh-CN" | "en-US"`。
//! 这里在启动时读取一次并缓存到进程内，之后由 `store://change` 事件在偏好变化时刷新；
//! 托盘标题 / tooltip 在计时器循环里每秒重设、通知在发送时取当前语言，因此切换语言后
//! 无需重启即可生效。
//!
//! 归一化规则与前端 `localeFromLanguageTag` 对齐：语言标签以 `zh` 开头 → 中文，
//! 其余 → 英文。未写入偏好等同于前端的 `"system"` → 检测系统语言；
//! 仅进程内缓存尚未初始化时（`CURRENT`）保留中文首帧兜底，与静态导出的首屏一致。

use std::sync::atomic::{AtomicU8, Ordering};

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// 应用支持的语言。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    Zh,
    En,
}

/// config store 中语言偏好的键，与前端 `LANGUAGE_STORE_KEY` 一致。
pub const LANGUAGE_STORE_KEY: &str = "language";
/// config store 文件名，与 `core::store::settings::store_files::CONFIG` 一致。
const CONFIG_STORE: &str = "config_store.json";

/// 当前语言缓存：0 = 中文（含未初始化的回退态），1 = 英文。
static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn current_locale() -> Locale {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Locale::En,
        _ => Locale::Zh,
    }
}

fn set_current(locale: Locale) {
    CURRENT.store(
        match locale {
            Locale::Zh => 0,
            Locale::En => 1,
        },
        Ordering::Relaxed,
    );
}

/// BCP 47 语言标签归一：`zh*` → 中文，其余 → 英文。
/// 与前端 `localeFromLanguageTag` 一致，用于系统语言检测。
pub fn locale_from_tag(tag: &str) -> Locale {
    if tag.to_lowercase().starts_with("zh") {
        Locale::Zh
    } else {
        Locale::En
    }
}

/// 用 `sys-locale` 取系统语言并归一；读不到则回退中文。
pub fn detect_system_locale() -> Locale {
    match sys_locale::get_locale() {
        Some(tag) => locale_from_tag(&tag),
        None => Locale::Zh,
    }
}

/// 解析 config store 中存储的语言偏好。归一化规则与前端 `localeFromLanguageTag` 一致。
///
/// - `None`（未写入 / 读取失败）与 `"system"` → 检测系统语言（`sys-locale`）；
/// - 任意语言标签：`zh*` → 中文，其余（`en` / `fr-FR` / 非法值）→ 英文。
pub fn resolve_preference(preference: Option<&str>) -> Locale {
    match preference {
        None | Some("system") => detect_system_locale(),
        Some(value) => locale_from_tag(value),
    }
}

fn read_preference(app: &AppHandle) -> Option<String> {
    let store = app.store(CONFIG_STORE).ok()?;
    store.get(LANGUAGE_STORE_KEY)?.as_str().map(str::to_string)
}

/// 启动时初始化：从 config store 读语言偏好，未写入则回退系统语言。
pub fn init(app: &AppHandle) {
    refresh_from_store(app);
}

/// `store://change` 事件里的 store 文件路径是否就是 config store。
/// 其它 store（drink_history 等）也可能带同名键，按文件名过滤一次。
pub fn is_config_store_path(path: &str) -> bool {
    path.ends_with(CONFIG_STORE)
}

/// 用事件负载里带的偏好值直接刷新缓存。
///
/// **不要改成回读 store**：`tauri-plugin-store` 在持有 store 互斥锁的情况下
/// 同步派发 `store://change`（`Store::set` → `StoreInner::set` → `app.emit`），
/// 监听器里再 `app.store(..).get(..)` 就是对同一把非重入锁自锁 —— 该线程永久挂起
/// 并一直占着锁，随后计时线程的 `AppSettings::load_from_store`、设置页的
/// `store.get` 全部堵死（表现为切语言后托盘倒计时冻住、设置页读不出数据）。
/// 事件负载本身已带 `value`，直接用即可，全程不碰 store。
pub fn apply_preference(preference: Option<&str>) {
    set_current(resolve_preference(preference));
}

/// 从 store 读取偏好并刷新缓存，仅用于启动初始化。
///
/// 运行时（`store://change`）必须走 [`apply_preference`]：事件由插件持锁派发，
/// 在这里回读 store 会自锁。
pub fn refresh_from_store(app: &AppHandle) {
    let preference = read_preference(app);
    set_current(resolve_preference(preference.as_deref()));
}

/// 按 key 取当前语言的文案。未命中时回退中文，再兜底空串。
pub fn t(key: &'static str) -> &'static str {
    t_in(current_locale(), key)
}

/// 按指定语言取文案（便于测试与确定语境）。
pub fn t_in(locale: Locale, key: &'static str) -> &'static str {
    match (locale, key) {
        // 托盘状态 / tooltip
        (Locale::Zh, "tray.whitelist_paused.title") => "暂停",
        (Locale::En, "tray.whitelist_paused.title") => "Paused",
        (Locale::Zh, "tray.whitelist_paused.tooltip") => "白名单应用前台运行中",
        (Locale::En, "tray.whitelist_paused.tooltip") => "Whitelisted app is in the foreground",

        (Locale::Zh, "status.goal_reached.title") => "已达标",
        (Locale::En, "status.goal_reached.title") => "Goal reached",
        (Locale::Zh, "status.goal_reached.tooltip") => "太棒啦，再接再厉",
        (Locale::En, "status.goal_reached.tooltip") => "Great job — keep it up!",
        (Locale::Zh, "status.paused.title") => "已暂停",
        (Locale::En, "status.paused.title") => "Paused",
        (Locale::Zh, "status.paused.tooltip") => "提醒已暂停，可在托盘菜单点「重新计时」",
        (Locale::En, "status.paused.tooltip") => {
            "Reminders paused. Choose Restart in the tray menu to resume."
        }
        (Locale::Zh, "status.not_workday.tooltip") => "今天不是提醒日",
        (Locale::En, "status.not_workday.tooltip") => "No reminders today",
        (Locale::Zh, "status.out_of_range.tooltip") => "不在提醒时段",
        (Locale::En, "status.out_of_range.tooltip") => "Outside reminder hours",

        // 桌面通知
        (Locale::Zh, "notification.title") => "该喝水啦",
        (Locale::En, "notification.title") => "Time for a drink",
        (Locale::Zh, "notification.skip_action") => "稍后再说",
        (Locale::En, "notification.skip_action") => "Later",
        (Locale::Zh, "notification.progress") => "已喝 {total} / {goal}ml · {percent}%",
        (Locale::En, "notification.progress") => "{total} / {goal}ml · {percent}%",
        (Locale::Zh, "notification.progress_no_goal") => "今日已喝 {total}ml",
        (Locale::En, "notification.progress_no_goal") => "{total}ml today",
        (Locale::Zh, "notification.test.title") => "通知正常",
        (Locale::En, "notification.test.title") => "Notifications work",
        (Locale::Zh, "notification.test.body") => {
            "以后提醒会以这个形式出现，看到这一条说明链路通了"
        }
        (Locale::En, "notification.test.body") => {
            "This is how reminders will look. Seeing this means notifications are working."
        }

        // 文件对话框
        (Locale::Zh, "dialog.export_backup.title") => "备份饮水记录",
        (Locale::En, "dialog.export_backup.title") => "Back up drink records",
        (Locale::Zh, "dialog.import_backup.title") => "选择饮水记录备份",
        (Locale::En, "dialog.import_backup.title") => "Choose a drink records backup",
        (Locale::En, "dialog.backup_filter") => "Shui JSON backup",
        (Locale::Zh, "dialog.backup_filter") => "Shui JSON 备份",
        (Locale::Zh, "dialog.export_csv.title") => "导出饮水记录",
        (Locale::En, "dialog.export_csv.title") => "Export drink records",

        // 未命中：英文先退回中文，中文仍找不到才给空串（避免相互递归）。
        (Locale::En, _) => t_in(Locale::Zh, key),
        (Locale::Zh, _) => "",
    }
}

/// 轻量插值：把 `{name}` 占位符替换成给定值，与前端 `formatMessage` 一致。
pub fn format_message(template: &str, params: &[(&str, String)]) -> String {
    let mut out = template.to_string();
    for (name, value) in params {
        out = out.replace(&format!("{{{name}}}"), value);
    }
    out
}

// ---------------------------------------------------------------------------
// 提醒文案池：按今日完成度分四档，每档 12 条。与 Android ReminderReceiver.kt
// 的 ReminderCopy 逐条对应；改文案时两端要同步。
// ---------------------------------------------------------------------------

const COPY_START_ZH: [&str; 12] = [
    "新的一天从一杯水开始，来一杯吧",
    "刚起步，先喝口水润润嗓子",
    "身体刚开始补水，别停下",
    "现在喝一杯，今天会很轻松",
    "第一杯水永远最值，先从这杯开始",
    "还早，慢慢把节奏建立起来",
    "起身走走，顺便接杯水",
    "提醒一下：该补水了",
    "别等到口渴才喝，现在正好",
    "一小口水也是进步，来吧",
    "给身体开个好头，干杯",
    "先来一杯，给今天开个好头",
];
const COPY_START_EN: [&str; 12] = [
    "Start your day with a glass of water",
    "Just getting started — take a sip",
    "You're rehydrating. Keep it going",
    "A glass now makes the day easier",
    "The first glass counts most. Start here",
    "Plenty of time — build your rhythm",
    "Stand up, stretch, and grab some water",
    "Friendly reminder: time to hydrate",
    "Don't wait for thirst — now is perfect",
    "Every sip counts. Cheers!",
    "Give your body a good start — cheers",
    "Start with one glass and set the tone",
];

const COPY_HALF_ZH: [&str; 12] = [
    "已经四分之一了，继续保持",
    "进度不错，再来一杯稳稳推进",
    "节奏起来了，别断",
    "喝一口，离目标更近一点",
    "身体正在变好，别停下来",
    "这一杯下去，状态会更清醒",
    "补水进行中，保持这个势头",
    "再补几杯，进度会更稳",
    "现在的你比刚起床时更水润了",
    "不必大口，小口多次最有效",
    "继续按节奏来，稳稳的",
    "记得喝水，也记得起身活动",
];
const COPY_HALF_EN: [&str; 12] = [
    "A quarter done — keep it up",
    "Good progress — one more to keep moving",
    "You've found your rhythm. Don't stop",
    "One sip brings you closer",
    "Your body is thanking you. Keep going",
    "This glass will sharpen your focus",
    "Hydrating nicely — hold this pace",
    "A few more and you're on solid ground",
    "You're more hydrated than when you woke up",
    "Small sips, often, work best",
    "Keep the steady pace going",
    "Remember to drink — and to move",
];

const COPY_NEAR_ZH: [&str; 12] = [
    "已经过半，胜利在望",
    "再补几杯，今天就很稳了",
    "势头很好，别松懈",
    "今天的目标越来越近了",
    "继续喝，身体会感谢你",
    "过半的进度，值得再喝一杯",
    "保持住，这个节奏刚刚好",
    "再来一杯，向目标冲刺",
    "你已经比大多数人喝得多了",
    "喝口水，给自己一个小小的奖励",
    "补水过半，状态在线",
    "剩下的交给每一杯水",
];
const COPY_NEAR_EN: [&str; 12] = [
    "Over halfway — the finish is in sight",
    "A few more and today's a win",
    "Great momentum — stay with it",
    "Today's goal is getting closer",
    "Keep drinking — your body will thank you",
    "Past halfway — you've earned another glass",
    "Hold it — this pace is just right",
    "One more, then sprint to the goal",
    "You've had more water than most today",
    "Take a sip — a little reward for yourself",
    "Halfway hydrated and feeling sharp",
    "Let each glass carry you the rest",
];

const COPY_ALMOST_ZH: [&str; 12] = [
    "只差最后几杯，别放弃",
    "快到目标了，一鼓作气",
    "胜利就在眼前，再来一杯",
    "最后冲刺，今天的目标马上达成",
    "已经很接近了，坚持一下",
    "再喝一杯就离目标更近了",
    "收尾阶段，稳稳喝完",
    "今天的你非常自律，继续",
    "最后这一段，交给这杯水",
    "差距不大了，喝完就达标",
    "保持住，马上就能完成目标",
    "再补一杯，今天就算圆满",
];
const COPY_ALMOST_EN: [&str; 12] = [
    "Just a few glasses left — don't quit now",
    "Almost there — give it one last push",
    "Victory in sight — one more glass",
    "Final stretch — today's goal is within reach",
    "So close — hang in there",
    "Another glass brings you even closer",
    "The home stretch — finish strong",
    "You've been so disciplined today. Keep it up",
    "Let this glass carry you through the last stretch",
    "Almost even — finish this and you're there",
    "Hold on — you'll hit your goal any moment",
    "One more and today is complete",
];

/// 取某语言、某档位的提醒文案池。bucket: 0=START, 1=HALF, 2=NEAR, 3=ALMOST。
pub fn reminder_copy_pool(locale: Locale, bucket: usize) -> &'static [&'static str] {
    match (locale, bucket) {
        (Locale::Zh, 0) => &COPY_START_ZH,
        (Locale::En, 0) => &COPY_START_EN,
        (Locale::Zh, 1) => &COPY_HALF_ZH,
        (Locale::En, 1) => &COPY_HALF_EN,
        (Locale::Zh, 2) => &COPY_NEAR_ZH,
        (Locale::En, 2) => &COPY_NEAR_EN,
        (Locale::Zh, 3) => &COPY_ALMOST_ZH,
        (Locale::En, 3) => &COPY_ALMOST_EN,
        _ => &COPY_START_ZH,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_from_tag_normalizes_zh_vs_others() {
        assert_eq!(locale_from_tag("zh-CN"), Locale::Zh);
        assert_eq!(locale_from_tag("zh"), Locale::Zh);
        assert_eq!(locale_from_tag("zh_Hans_CN"), Locale::Zh);
        assert_eq!(locale_from_tag("ZH-tw"), Locale::Zh);
        assert_eq!(locale_from_tag("en-US"), Locale::En);
        assert_eq!(locale_from_tag("fr-FR"), Locale::En);
        assert_eq!(locale_from_tag(""), Locale::En);
    }

    #[test]
    fn resolves_explicit_preferences() {
        assert_eq!(resolve_preference(Some("zh-CN")), Locale::Zh);
        assert_eq!(resolve_preference(Some("zh")), Locale::Zh);
        assert_eq!(resolve_preference(Some("zh-Hans-CN")), Locale::Zh);
        assert_eq!(resolve_preference(Some("en-US")), Locale::En);
        assert_eq!(resolve_preference(Some("en")), Locale::En);
        // 非标准标签与非法值按 zh* / 其余归一，与前端 localeFromLanguageTag 一致。
        assert_eq!(resolve_preference(Some("fr-FR")), Locale::En);
        assert_eq!(resolve_preference(Some("not-a-language")), Locale::En);
    }

    #[test]
    fn missing_preference_falls_back_to_system_locale() {
        // 未写入偏好等价于前端 "system"：英文系统新用户的托盘/通知也应是英文。
        assert_eq!(resolve_preference(None), detect_system_locale());
        assert_eq!(resolve_preference(Some("system")), detect_system_locale());
    }

    #[test]
    fn system_preference_uses_detected_locale() {
        // "system" 的结果必须是一个合法 Locale（具体值取决于测试机系统语言）。
        let locale = resolve_preference(Some("system"));
        assert!(locale == Locale::Zh || locale == Locale::En);
        assert_eq!(locale, detect_system_locale());
    }

    #[test]
    fn t_returns_both_languages_for_key_copy() {
        assert_eq!(t_in(Locale::Zh, "notification.title"), "该喝水啦");
        assert_eq!(t_in(Locale::En, "notification.title"), "Time for a drink");
        assert_eq!(t_in(Locale::Zh, "status.paused.title"), "已暂停");
        assert_eq!(t_in(Locale::En, "status.paused.title"), "Paused");
        assert_eq!(t_in(Locale::Zh, "tray.whitelist_paused.tooltip"), "白名单应用前台运行中");
        assert_eq!(
            t_in(Locale::En, "tray.whitelist_paused.tooltip"),
            "Whitelisted app is in the foreground"
        );
        assert_eq!(t_in(Locale::Zh, "notification.skip_action"), "稍后再说");
        assert_eq!(t_in(Locale::En, "notification.skip_action"), "Later");
    }

    #[test]
    fn t_falls_back_to_zh_for_unknown_key() {
        assert_eq!(t_in(Locale::En, "definitely.missing.key"), "");
    }

    #[test]
    fn fallback_locale_is_zh_before_init() {
        // 未调用 init 时（含单元测试环境）必须回退中文，与前端首帧一致。
        assert_eq!(current_locale(), Locale::Zh);
        assert_eq!(t("notification.title"), "该喝水啦");
    }

    #[test]
    fn format_message_replaces_named_placeholders() {
        let out = format_message(
            t_in(Locale::Zh, "notification.progress"),
            &[
                ("total", "300".into()),
                ("goal", "1000".into()),
                ("percent", "30".into()),
            ],
        );
        assert_eq!(out, "已喝 300 / 1000ml · 30%");
        assert_eq!(
            format_message(
                t_in(Locale::En, "notification.progress_no_goal"),
                &[("total", "250".into())]
            ),
            "250ml today"
        );
    }

    #[test]
    fn config_store_path_matching() {
        assert!(is_config_store_path(
            "/Users/me/Library/Application Support/com.shui.app/config_store.json"
        ));
        assert!(is_config_store_path("config_store.json"));
        // 其它 store 即使写了同名 language 键也不该触发刷新。
        assert!(!is_config_store_path(
            "/Users/me/Library/Application Support/com.shui.app/drink_history_store.json"
        ));
        assert!(!is_config_store_path(""));
    }

    #[test]
    fn copy_pools_have_matching_buckets_in_both_languages() {
        for bucket in 0..4 {
            let zh = reminder_copy_pool(Locale::Zh, bucket);
            let en = reminder_copy_pool(Locale::En, bucket);
            assert_eq!(zh.len(), 12);
            assert_eq!(en.len(), 12);
            assert_ne!(zh[0], en[0]);
        }
        assert_eq!(reminder_copy_pool(Locale::Zh, 0)[0], "新的一天从一杯水开始，来一杯吧");
        assert_eq!(
            reminder_copy_pool(Locale::En, 0)[0],
            "Start your day with a glass of water"
        );
    }
}
