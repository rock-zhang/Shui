package com.shui.app

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * 原生侧本地化：语言偏好解析 + 通知文案池。
 *
 * 偏好来源与前端保持一致：Tauri plugin-store 的 config_store.json 中 `language`
 * 键（前端 I18nProvider.persistPreference 写入）。不使用 Android 资源目录的
 * values-zh / values-en 自动切换，因为 App 内语言偏好可能与系统语言不同，
 * 强行改 WebView 的 Configuration 风险更大；全部在代码内按归一化后的 locale
 * 选文案，行为可控且不影响 Tauri 的前端渲染。
 */
internal object AppLocale {
    const val ZH = "zh-CN"
    const val EN = "en-US"

    /** 读取并归一化语言偏好；"system" 用 Locale.getDefault() 按同样规则归一。 */
    fun current(context: Context): String {
        val pref = readPreference(context)
        val tag = when {
            pref.isNullOrBlank() -> "system"
            pref.equals("system", ignoreCase = true) ->
                Locale.getDefault().language.ifBlank { "en" }
            else -> pref
        }
        return if (tag.startsWith("zh", ignoreCase = true)) ZH else EN
    }

    fun isEnglish(context: Context): Boolean = current(context) == EN

    /**
     * 直接读 Tauri config store 的落盘文件（与前端同一个文件）。
     * 读不到时返回 null，交由 current() 回落到 "system"（与前端默认偏好一致）。
     * tauri_plugin_store 的 store 文件是普通 JSON 对象，键即 set 时用的 key。
     */
    private fun readPreference(context: Context): String? = try {
        val raw = File(context.dataDir, "config_store.json").readText()
        when (val value = JSONObject(raw).opt("language")) {
            is String -> value
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}

/** 通知相关的固定文案，中英各一份。 */
internal object AppStrings {
    fun channelName(context: Context, soundEnabled: Boolean): String =
        if (AppLocale.isEnglish(context)) {
            if (soundEnabled) "Water Reminder" else "Water Reminder (Silent)"
        } else {
            if (soundEnabled) "喝水提醒" else "喝水提醒（静音）"
        }

    fun channelDescription(context: Context, soundEnabled: Boolean): String =
        if (AppLocale.isEnglish(context)) {
            if (soundEnabled) {
                "Timed water reminders — log a glass right from the notification."
            } else {
                "Reminder sound is off: you'll still be reminded, just without sound."
            }
        } else {
            if (soundEnabled) {
                "定时喝水提醒，可直接在通知里记一杯水"
            } else {
                "已关闭提醒音效：照常提醒，但不发出声音"
            }
        }

    fun reminderTitle(context: Context): String =
        if (AppLocale.isEnglish(context)) "Time to hydrate" else "该喝水啦"

    fun goalTitle(context: Context): String =
        if (AppLocale.isEnglish(context)) "Daily goal reached" else "今日目标已完成"

    fun goalText(context: Context, total: Long, goal: Long): String =
        if (AppLocale.isEnglish(context)) {
            "You've had ${total}ml / ${goal}ml goal. That's all for today's reminders."
        } else {
            "已喝 ${total}ml / 目标 ${goal}ml，今天的提醒就到这里"
        }
}

/**
 * 提醒正文文案池：按完成度分四档，中英各一份，连续两条不重复。
 *
 * 切换语言后 last 下标仍按档位共用，不会重复（撞上一条就顺移），也不必为每种
 * 语言各存一个游标。
 */
internal object ReminderCopy {
    private const val KEY_PREFIX = "reminder_copy_last_"

    /** 完成度 < 25%：刚起步，重点是「开始喝」。 */
    private val START = listOf(
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
        "先来一杯，给今天开个好头"
    )

    /** 完成度 25% ~ 50%：节奏建立起来了，强调「保持」。 */
    private val HALF = listOf(
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
        "记得喝水，也记得起身活动"
    )

    /** 完成度 50% ~ 75%：过半，强调「推进」。 */
    private val NEAR = listOf(
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
        "剩下的交给每一杯水"
    )

    /** 完成度 >= 75%：收尾，强调「就差一点」。 */
    private val ALMOST = listOf(
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
        "再补一杯，今天就算圆满"
    )

    private val START_EN = listOf(
        "Start your day with a glass of water.",
        "Just getting started — take a sip.",
        "You're starting to rehydrate. Keep it up.",
        "Have a glass now and the day will feel easier.",
        "The first glass counts most. Start here.",
        "It's early. Build your rhythm slowly.",
        "Get up, stretch, and grab a glass of water.",
        "Just a reminder: time to hydrate.",
        "Don't wait until you're thirsty. Now is perfect.",
        "Even a small sip is progress. Go on.",
        "Give your body a good start. Cheers!",
        "Start with a glass and set the tone for today."
    )

    private val HALF_EN = listOf(
        "A quarter done. Keep it going.",
        "Good progress. One more glass keeps you on track.",
        "You've found your rhythm. Don't break it.",
        "Take a sip and get closer to your goal.",
        "Your body is thanking you. Don't stop now.",
        "This glass will help you feel more alert.",
        "Hydrating nicely. Keep this momentum.",
        "A few more glasses and you're in a steady place.",
        "You're more hydrated than when you woke up.",
        "No need to gulp. Small, frequent sips work best.",
        "Keep the pace steady. You're doing great.",
        "Remember to drink — and to move around."
    )

    private val NEAR_EN = listOf(
        "Over halfway there. Victory in sight.",
        "A few more glasses and today's a win.",
        "Great momentum. Don't ease up.",
        "Today's goal is getting closer.",
        "Keep drinking. Your body will thank you.",
        "You're over halfway — worth another glass.",
        "Hold this pace. It's just right.",
        "One more glass and you're sprinting to the goal.",
        "You're drinking more than most people today.",
        "Have a sip — a little reward for yourself.",
        "Over halfway hydrated and going strong.",
        "Let each glass take you the rest of the way."
    )

    private val ALMOST_EN = listOf(
        "Just a few glasses left. Don't give up.",
        "Almost at your goal. Push through.",
        "The finish line is here. One more glass.",
        "Final stretch — you'll hit today's goal soon.",
        "So close. Hang in there.",
        "One more glass brings you closer.",
        "The home stretch. Finish strong.",
        "You've been so disciplined today. Keep going.",
        "Let this glass carry you through the last bit.",
        "Barely any left. Finish it and you've made it.",
        "Stay with it. You'll reach your goal in no time.",
        "One more glass and today is complete."
    )

    /** 按完成度取一条文案；ratio 是 0.0 ~ 1.0 的完成比例。 */
    fun pick(context: Context, ratio: Double): String {
        val (bucket, zhPool, enPool) = when {
            ratio >= 0.75 -> Triple("almost", ALMOST, ALMOST_EN)
            ratio >= 0.5 -> Triple("near", NEAR, NEAR_EN)
            ratio >= 0.25 -> Triple("half", HALF, HALF_EN)
            else -> Triple("start", START, START_EN)
        }
        val pool = if (AppLocale.isEnglish(context)) enPool else zhPool
        val prefs = context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
        val key = KEY_PREFIX + bucket
        val last = prefs.getInt(key, -1)
        var index = pool.indices.random()
        if (pool.size > 1 && index == last) {
            // 撞上上一条就顺移一格，既换了文案又不用重摇。
            index = (index + 1) % pool.size
        }
        prefs.edit().putInt(key, index).apply()
        return pool[index]
    }
}
