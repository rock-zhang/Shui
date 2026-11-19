/**
 * 中英文词典。键名统一、扁平，方便做 key 对齐检查。
 * 新增文案时先加 zhCN 再补 enUS，enUS 用 satisfies 保证不漏键。
 */

export const zhCN = {
  "common.system": "跟随系统",
  "common.light": "浅色",
  "common.dark": "深色",
  "common.cancel": "取消",

  "language.title": "语言",
  "language.description": "界面语言；跟随系统时自动使用系统语言",
  "language.system": "跟随系统",
  "language.zh": "中文",
  "language.en": "English",

  "settings.general.title": "通用",
  "settings.general.autoStart.title": "开机自启动",
  "settings.general.autoStart.description":
    "登录后在后台开始倒计时，不弹出窗口；可从托盘打开偏好设置",
  "settings.general.countdown.title": "倒计时",
  "settings.general.countdown.description":
    "开启后将在菜单栏显示倒计时，支持 macOS 和 Linux",
  "settings.general.fullScreen.title": "全屏提醒",
  "settings.general.fullScreen.description":
    "开启后将以全屏方式显示提醒，关闭则使用系统通知",
  "settings.general.fullScreen.turnOffToast":
    "提醒将改用系统通知，请确认已允许 Shui 发送通知",
  "settings.general.fullScreen.authorize": "去授权",
  "settings.general.sound.title": "提醒音效",
  "settings.general.sound.description":
    "记录饮水后播放一声确认音，关闭后完全静音",
  "settings.general.notification.deniedTitle": "系统通知已被关闭",
  "settings.general.notification.deniedDescription":
    "系统设置中关闭了 Shui 的通知，倒计时结束后你将收不到任何提醒。请打开通知设置重新允许。",
  "settings.general.notification.unknownTitle": "系统通知可能不可达",
  "settings.general.notification.unknownDescription":
    "当前使用系统通知提醒。若系统设置中未允许 Shui 发送通知，倒计时结束后你将收不到任何提醒。请在下方开启权限后，再等待下一次提醒验证。",
  "settings.general.notification.openSettings": "打开系统通知设置",
  "settings.general.notification.sendTest": "发送测试通知",
  "settings.general.notification.testSent":
    "测试通知已发送；若没看到，请确认系统已允许 Shui 通知",
  "settings.general.notification.testFailed":
    "发送测试通知失败，请检查系统通知设置",
  "settings.general.notification.openHintMac":
    "请打开「系统设置 → 通知 → Shui」，开启「允许通知」",
  "settings.general.notification.openHintWindows":
    "请打开「设置 → 系统 → 通知」，找到 Shui 开启通知",
  "settings.general.notification.openHintLinux":
    "请在系统设置的通知页面中找到 Shui 并开启通知",
  "settings.general.appearance.title": "外观主题",
  "settings.general.appearance.description":
    "可选择浅色、深色或跟随系统外观",
  "settings.general.appearance.placeholder": "选择主题",
  "settings.general.analytics.title": "匿名使用统计",
  "settings.general.analytics.description":
    "仅统计功能使用与崩溃，不含饮水记录和时间，可随时关闭",
  "settings.general.language.title": "界面语言",
  "settings.general.language.description": "选择界面语言，或跟随系统",
  "settings.general.error.load": "读取通用设置失败，请重新打开设置",
  "settings.general.error.autoStart": "更新开机自启动失败，请重试",

  "settings.reminder.title": "提醒",
  "settings.reminder.goal.title": "每日目标",
  "settings.reminder.goal.description": "完成目标前将定时提醒",
  "settings.reminder.goal.placeholder": "选择目标",
  "settings.reminder.goal.hint": "建议不低于 1500ml",
  "settings.reminder.goal.option": "{amount}ml",
  "settings.reminder.gap.title": "提醒间隔",
  "settings.reminder.gap.placeholder": "选择间隔",
  "settings.reminder.gap.option": "{minutes}分钟",
  "settings.reminder.weekdays.title": "重复",
  "settings.reminder.weekdays.description": "按星期提醒",
  "settings.reminder.time.title": "时间范围",
  "settings.reminder.time.description": "仅在指定时间段内提醒",
  "settings.reminder.time.start": "开始时间",
  "settings.reminder.time.end": "结束时间",
  "settings.reminder.time.separator": "至",
  "settings.reminder.whitelist.title": "应用白名单",
  "settings.reminder.whitelist.description": "在这些应用活跃时暂停提醒",
  "settings.reminder.whitelist.placeholder": "选择应用",
  "settings.reminder.whitelist.search": "搜索应用...",
  "settings.reminder.whitelist.empty": "未找到应用",
  "weekday.short.0": "日",
  "weekday.short.1": "一",
  "weekday.short.2": "二",
  "weekday.short.3": "三",
  "weekday.short.4": "四",
  "weekday.short.5": "五",
  "weekday.short.6": "六",
} as const;

export type MessageKey = keyof typeof zhCN;

export const enUS = {
  "common.system": "System",
  "common.light": "Light",
  "common.dark": "Dark",
  "common.cancel": "Cancel",

  "language.title": "Language",
  "language.description":
    "Interface language. Follow system to use your device language",
  "language.system": "Follow system",
  "language.zh": "中文",
  "language.en": "English",

  "settings.general.title": "General",
  "settings.general.autoStart.title": "Launch at login",
  "settings.general.autoStart.description":
    "Starts the countdown in the background after login without showing a window. Open preferences from the tray.",
  "settings.general.countdown.title": "Menu bar countdown",
  "settings.general.countdown.description":
    "Shows the countdown in the menu bar. Supported on macOS and Linux.",
  "settings.general.fullScreen.title": "Full-screen reminder",
  "settings.general.fullScreen.description":
    "Show reminders full screen. When off, system notifications are used.",
  "settings.general.fullScreen.turnOffToast":
    "Reminders will use system notifications. Make sure Shui is allowed to send them.",
  "settings.general.fullScreen.authorize": "Open settings",
  "settings.general.sound.title": "Reminder sound",
  "settings.general.sound.description":
    "Plays a confirmation sound after logging water. Off means fully silent.",
  "settings.general.notification.deniedTitle":
    "System notifications are turned off",
  "settings.general.notification.deniedDescription":
    "Notifications for Shui are disabled in system settings. You will not receive any reminders when the countdown ends. Allow notifications again in system settings.",
  "settings.general.notification.unknownTitle":
    "System notifications may be unreachable",
  "settings.general.notification.unknownDescription":
    "Reminders currently use system notifications. If Shui is not allowed to send notifications, you will not receive any reminders when the countdown ends. Grant permission below, then wait for the next reminder.",
  "settings.general.notification.openSettings":
    "Open notification settings",
  "settings.general.notification.sendTest": "Send test notification",
  "settings.general.notification.testSent":
    "Test notification sent. If you do not see it, check that notifications are allowed for Shui.",
  "settings.general.notification.testFailed":
    "Failed to send the test notification. Check your system notification settings.",
  "settings.general.notification.openHintMac":
    "Open System Settings → Notifications → Shui and turn on Allow Notifications.",
  "settings.general.notification.openHintWindows":
    "Open Settings → System → Notifications, find Shui, and turn on notifications.",
  "settings.general.notification.openHintLinux":
    "Find Shui in your system notification settings and turn on notifications.",
  "settings.general.appearance.title": "Appearance",
  "settings.general.appearance.description":
    "Choose light, dark, or follow the system appearance.",
  "settings.general.appearance.placeholder": "Choose theme",
  "settings.general.analytics.title": "Anonymous usage analytics",
  "settings.general.analytics.description":
    "Only feature usage and crashes. No water logs or times. You can turn this off anytime.",
  "settings.general.language.title": "Interface language",
  "settings.general.language.description":
    "Choose the interface language, or follow the system.",
  "settings.general.error.load":
    "Failed to load general settings. Please reopen settings.",
  "settings.general.error.autoStart":
    "Failed to update launch at login. Please try again.",

  "settings.reminder.title": "Reminders",
  "settings.reminder.goal.title": "Daily goal",
  "settings.reminder.goal.description":
    "Reminders continue until the goal is reached",
  "settings.reminder.goal.placeholder": "Choose a goal",
  "settings.reminder.goal.hint": "1500 ml or more is recommended",
  "settings.reminder.goal.option": "{amount} ml",
  "settings.reminder.gap.title": "Reminder interval",
  "settings.reminder.gap.placeholder": "Choose an interval",
  "settings.reminder.gap.option": "{minutes} min",
  "settings.reminder.weekdays.title": "Repeat",
  "settings.reminder.weekdays.description":
    "Remind on the selected weekdays",
  "settings.reminder.time.title": "Active hours",
  "settings.reminder.time.description":
    "Only remind within this time range",
  "settings.reminder.time.start": "Start time",
  "settings.reminder.time.end": "End time",
  "settings.reminder.time.separator": "to",
  "settings.reminder.whitelist.title": "App whitelist",
  "settings.reminder.whitelist.description":
    "Pause reminders while these apps are active",
  "settings.reminder.whitelist.placeholder": "Choose apps",
  "settings.reminder.whitelist.search": "Search apps...",
  "settings.reminder.whitelist.empty": "No apps found",
  "weekday.short.0": "S",
  "weekday.short.1": "M",
  "weekday.short.2": "T",
  "weekday.short.3": "W",
  "weekday.short.4": "T",
  "weekday.short.5": "F",
  "weekday.short.6": "S",
} satisfies Record<MessageKey, string>;

export const messages = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const;
