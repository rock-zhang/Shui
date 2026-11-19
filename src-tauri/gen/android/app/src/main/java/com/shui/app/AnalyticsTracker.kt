package com.shui.app

import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.FirebaseCrashlytics
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Firebase Analytics / Crashlytics 的统一入口。
 *
 * 设计原则：
 *  - 所有方法都在内部 try/catch：Firebase 未配置（缺 google-services.json）或
 *    Google Play 服务不可用时，整个模块静默降级为 no-op，绝不影响提醒主链路。
 *  - 事件参数统一清洗：去 null、字符串截断 100 字符、最多 25 个参数。
 *  - 用户级计数只存在这里（SharedPreferences），由事件名驱动自增，
 *    JS 与原生共用同一套口径，避免两端各算一份。
 *  - user properties 在事件后合并写入（500ms 去抖），减少频繁写属性。
 */
object AnalyticsTracker {
    private const val TAG = "ShuiAnalytics"
    private const val PREFS = "shui_analytics"

    private const val KEY_ENABLED = "enabled"
    private const val KEY_LAST_SNAPSHOT = "last_permission_snapshot"
    private const val KEY_LAST_PERMISSION_SOURCE = "last_permission_source"
    private const val KEY_LAST_NOTIF_SHOWN_AT = "last_notification_shown_at"
    private const val KEY_GUIDE_STATUS = "guide_status"
    private const val KEY_GUIDE_DISMISS = "guide_dismiss_count"
    private const val KEY_LAST_ACTIVE_DATE = "last_active_date"
    private const val KEY_FIRST_OPEN_DATE = "first_open_date"
    private const val KEY_GOAL_DAY = "goal_reached_day"

    // 用户级计数器（同时映射为 Firebase user property）
    private const val C_NOTIF_SHOWN = "notif_shown_count"
    private const val C_NOTIF_OPENED = "notif_opened_count"
    private const val C_NOTIF_DRINK = "notif_drink_count"
    private const val C_FULLSCREEN_SHOWN = "fullscreen_shown_count"
    private const val C_FULLSCREEN_DRINK = "fullscreen_drink_count"
    private const val C_MANUAL_DRINK = "manual_drink_count"
    private const val C_DRINK_RECORDS = "drink_record_count"
    private const val C_DRINK_ML = "drink_ml_total"
    private const val C_GOAL_DAYS = "goal_reached_days"
    private const val C_ACTIVE_DAYS = "active_days"
    private const val C_INSTALL_DAYS = "install_days"

    private val dateFormat = SimpleDateFormat("yyyyMMdd", Locale.US)
    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var analytics: FirebaseAnalytics? = null

    @Volatile
    private var crashlytics: FirebaseCrashlytics? = null

    @Volatile
    private var syncScheduled = false

    /** 最近一次权限请求的来源，供系统授权回调关联（dialog 路径）。 */
    @Volatile
    var permissionRequestSource: String = "unknown"

    @Synchronized
    fun init(context: Context) {
        if (appContext != null) return
        val app = context.applicationContext
        appContext = app
        try {
            // 没有 google-services.json 时 FirebaseApp 不会初始化，
            // 这里保持 analytics/crashlytics 为 null，全部方法变成 no-op。
            if (FirebaseApp.getApps(app).isNotEmpty()) {
                analytics = FirebaseAnalytics.getInstance(app)
                crashlytics = FirebaseCrashlytics.getInstance()
                analytics?.setDefaultEventParameters(defaultParams(app))
            }
        } catch (error: Throwable) {
            analytics = null
            crashlytics = null
            Log.w(TAG, "Firebase 初始化失败，本次运行不采集分析数据：${error.message}")
        }
        applyEnabled(isEnabled(app))
        syncProperties(app)
    }

    fun isEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
        applyEnabled(enabled)
    }

    private fun applyEnabled(enabled: Boolean) {
        try {
            analytics?.setAnalyticsCollectionEnabled(enabled)
        } catch (_: Throwable) {
        }
        try {
            crashlytics?.setCrashlyticsCollectionEnabled(enabled)
        } catch (_: Throwable) {
        }
    }

    // ───────────────────────── 事件入口 ─────────────────────────

    fun logEvent(context: Context, name: String?, params: JSONObject? = null) {
        if (name.isNullOrBlank()) return
        // 通知 Action 可能在没有 Activity 的进程里触发（用户点完就退出），
        // 因此不能只依赖 MainActivity.onCreate 初始化。
        ensureInitialized(context)
        if (!isEnabled(context)) return
        val client = analytics ?: return
        try {
            val bundle = toBundle(params)
            client.logEvent(name.take(40), bundle)
            applyCounterSideEffects(context, name, params)
            schedulePropertySync(context)
        } catch (error: Throwable) {
            Log.w(TAG, "事件 $name 上报失败：${error.message}")
        }
    }

    // ───────────────────────── App 生命周期 ─────────────────────────

    fun logAppOpen(
        context: Context,
        launchSource: String,
        coldStart: Boolean,
    ) {
        ensureInitialized(context)
        if (!isEnabled(context)) return
        val p = prefs(context)
        val today = todayKey()
        val firstOpenDate = p.getString(KEY_FIRST_OPEN_DATE, null)
        val isFirstOpen = firstOpenDate == null
        if (isFirstOpen) p.edit().putString(KEY_FIRST_OPEN_DATE, today).apply()

        val lastActive = p.getString(KEY_LAST_ACTIVE_DATE, null)
        var activeDays = p.getLong(C_ACTIVE_DAYS, if (isFirstOpen) 0L else 1L)
        if (lastActive != today) {
            activeDays += 1
            p.edit()
                .putString(KEY_LAST_ACTIVE_DATE, today)
                .putLong(C_ACTIVE_DAYS, activeDays)
                .apply()
        }
        val installDays = daysBetween(firstOpenDate ?: today, today)

        logEvent(
            context,
            "app_open",
            JSONObject()
                .put("launch_source", launchSource)
                .put("cold_start", coldStart)
                .put("is_first_open", isFirstOpen)
                .put("version_name", versionName(context))
                .put("active_days", activeDays)
                .put("install_days", installDays)
        )
        syncProperties(context)
    }

    // ───────────────────────── 权限与通知状态 ─────────────────────────

    fun logPermissionSnapshot(
        context: Context,
        activity: Activity?,
        source: String,
    ) {
        ensureInitialized(context)
        if (!isEnabled(context)) return
        val snapshot = healthSnapshot(context)
        val (granted, canRequest) = permissionState(context, activity)
        val params = JSONObject()
            .put("notification_granted", granted)
            .put("can_request", canRequest)
            .put("asked_count", askedCount(context))
            .put("exact_alarm", snapshot.exactAlarm)
            .put("battery_ignored", snapshot.batteryIgnored)
            .put("notifications_enabled", snapshot.notificationsEnabled)
            .put("channel_exists", snapshot.channelExists)
            .put("channel_importance", snapshot.channelImportance)
            .put("heads_up", snapshot.headsUp)
            .put("channel_sound", snapshot.channelSound)
            .put("channel_vibration", snapshot.channelVibration)
            .put("sdk_int", Build.VERSION.SDK_INT)
            .put("manufacturer", Build.MANUFACTURER ?: "")
            .put("rom_family", snapshot.romFamily)
            .put("domestic_rom", snapshot.domestic)

        // 状态没变化就不上报，避免每次回前台都刷一条。
        // asked_count 会随授权次数增长，不参与「状态是否变化」的判断。
        val fingerprint = JSONObject(params.toString()).apply { remove("asked_count") }.toString()
        val previous = prefs(context).getString(KEY_LAST_SNAPSHOT, null)
        if (fingerprint == previous) return
        prefs(context).edit().putString(KEY_LAST_SNAPSHOT, fingerprint).apply()

        logEvent(context, "permission_snapshot", params.put("source", source))
        syncProperties(context)
    }

    fun logPermissionRequest(context: Context, source: String, canRequest: Boolean) {
        logEvent(
            context,
            "permission_request",
            JSONObject()
                .put("source", source)
                .put("can_request", canRequest)
                .put("asked_count", askedCount(context))
        )
    }

    fun logPermissionResult(context: Context, granted: Boolean, source: String) {
        logEvent(
            context,
            "permission_result",
            JSONObject()
                .put("source", source)
                .put("result", if (granted) "granted" else "denied")
                .put("asked_count", askedCount(context))
        )
        syncProperties(context)
    }

    private fun permissionState(context: Context, activity: Activity?): Pair<Boolean, Boolean> {
        val granted = NotificationManagerCompat.from(context).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return granted to false
        val asked = askedCount(context)
        val rationale = activity != null && ActivityCompat.shouldShowRequestPermissionRationale(
            activity,
            android.Manifest.permission.POST_NOTIFICATIONS
        )
        return granted to (!granted && (asked == 0 || rationale))
    }

    private fun askedCount(context: Context): Int =
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .getInt(ReminderPlugin.KEY_NOTIFICATION_ASKED, 0)

    // ───────────────────────── 通知链路 ─────────────────────────

    fun markNotificationShown(context: Context) {
        prefs(context).edit()
            .putLong(KEY_LAST_NOTIF_SHOWN_AT, System.currentTimeMillis())
            .apply()
    }

    fun logNotificationOpened(context: Context, coldStart: Boolean) {
        val shownAt = prefs(context).getLong(KEY_LAST_NOTIF_SHOWN_AT, 0L)
        val delaySeconds = if (shownAt > 0) {
            ((System.currentTimeMillis() - shownAt) / 1000).coerceIn(0, 86_400)
        } else {
            -1
        }
        val params = JSONObject()
            .put("cold_start", coldStart)
            .put("delay_seconds", delaySeconds)
        val snapshot = healthSnapshot(context)
        params.put("progress_bucket", progressBucket(ReminderScheduler.todayAmount(context), snapshot.goalMl))
        logEvent(context, "notification_opened", params)
    }

    fun logNotificationShown(
        context: Context,
        trigger: String,
        channelSound: Boolean,
    ) {
        val total = ReminderScheduler.todayAmount(context)
        val goal = ReminderScheduler.goalAmount(context)
        logEvent(
            context,
            "notification_shown",
            JSONObject()
                .put("trigger", trigger)
                .put("channel_sound", channelSound)
                .put("progress_bucket", progressBucket(total, goal))
                .put("total_ml", total)
                .put("goal_ml", goal)
                .put("percent", percent(total, goal))
        )
        markNotificationShown(context)
    }

    fun logNotificationFailed(context: Context, trigger: String, reason: String) {
        logEvent(
            context,
            "notification_shown_failed",
            JSONObject().put("trigger", trigger).put("reason", reason)
        )
    }

    fun logNotificationBlocked(context: Context, trigger: String, reason: String) {
        logEvent(
            context,
            "notification_blocked",
            JSONObject().put("trigger", trigger).put("reason", reason)
        )
    }

    fun logNotificationSkipped(context: Context) {
        logEvent(
            context,
            "notification_skipped",
            JSONObject()
                .put("progress_bucket", progressBucket(
                    ReminderScheduler.todayAmount(context),
                    ReminderScheduler.goalAmount(context)
                ))
        )
    }

    fun logGoalNotification(context: Context, total: Long, goal: Long, trigger: String) {
        logEvent(
            context,
            "goal_notification_shown",
            JSONObject()
                .put("total_ml", total)
                .put("goal_ml", goal)
                .put("trigger", trigger)
        )
    }

    fun logReminderDelivered(context: Context, mode: String) {
        logEvent(context, "reminder_delivered", JSONObject().put("mode", mode))
    }

    fun logScheduleFailed(context: Context, reason: String) {
        logEvent(context, "reminder_schedule_failed", JSONObject().put("reason", reason))
    }

    /**
     * 通知 Action（+50/+100/+200）与延迟回灌共用的一份记水埋点。
     * 计数器在这里自增一次，pending_drinks 回灌时不再重复计数。
     */
    fun logNotificationDrink(context: Context, amount: Long) {
        val before = ReminderScheduler.todayAmount(context)
        val goal = ReminderScheduler.goalAmount(context)
        val after = before + amount
        val goalReached = goal > 0 && after >= goal

        logEvent(
            context,
            "notification_action_drink",
            JSONObject()
                .put("amount", amount)
                .put("source", "notification")
                .put("today_total_after", after)
                .put("progress_bucket", progressBucket(after, goal))
                .put("goal_reached_after", goalReached)
        )
        logDrink(context, "notification", amount, after, goal, goalReached, deferred = true)
    }

    fun logDrink(
        context: Context,
        source: String,
        amount: Long,
        todayTotalAfter: Long,
        goal: Long,
        goalReached: Boolean,
        deferred: Boolean,
        isFirstToday: Boolean = false,
    ) {
        val before = (todayTotalAfter - amount).coerceAtLeast(0)
        val justReached = goalReached && goal > 0 && before < goal
        logEvent(
            context,
            "drink_recorded",
            JSONObject()
                .put("amount", amount)
                .put("source", source)
                .put("today_total_after", todayTotalAfter)
                .put("progress_bucket", progressBucket(todayTotalAfter, goal))
                .put("goal_reached", goalReached)
                .put("deferred", deferred)
                .put("is_first_today", isFirstToday)
        )
        if (justReached) {
            logEvent(
                context,
                "drink_goal_reached",
                JSONObject()
                    .put("total_ml", todayTotalAfter)
                    .put("goal_ml", goal)
                    .put("source", source)
            )
        }
    }

    // ───────────────────────── Crashlytics ─────────────────────────

    fun recordException(message: String?, stack: String?, screen: String?) {
        val context = appContext ?: return
        if (!isEnabled(context)) return
        val client = crashlytics ?: return
        try {
            val text = buildString {
                if (!message.isNullOrBlank()) append(message)
                if (!stack.isNullOrBlank()) {
                    if (isNotEmpty()) append('\n')
                    append(stack.take(3_500))
                }
                if (isEmpty()) append("Unknown JavaScript error")
            }
            if (!screen.isNullOrBlank()) client.setCustomKey("last_screen", screen.take(60))
            client.recordException(IllegalStateException(text))
        } catch (error: Throwable) {
            Log.w(TAG, "崩溃上报失败：${error.message}")
        }
    }

    // ───────────────────────── 计数器 / 用户属性 ─────────────────────────

    private fun applyCounterSideEffects(context: Context, name: String, params: JSONObject?) {
        when (name) {
            "notification_shown" -> bump(context, C_NOTIF_SHOWN)
            "notification_opened" -> bump(context, C_NOTIF_OPENED)
            "notification_action_drink" -> bump(context, C_NOTIF_DRINK)
            "fullscreen_reminder_shown" -> bump(context, C_FULLSCREEN_SHOWN)
            "fullscreen_drink_click" -> bump(context, C_FULLSCREEN_DRINK)
            "drink_recorded" -> {
                val amount = params?.optLong("amount", 0L) ?: 0L
                bump(context, C_DRINK_RECORDS)
                bump(context, C_DRINK_ML, amount)
                if (params?.optString("source") == "manual_today") bump(context, C_MANUAL_DRINK)
                if (params?.optBoolean("goal_reached", false) == true) markGoalDay(context)
            }
            "drink_goal_reached" -> markGoalDay(context)
            "guide_shown" -> setGuideStatus(context, "in_progress")
            "guide_complete" -> setGuideStatus(context, "completed")
            "guide_dismiss" -> {
                val count = params?.optInt("dismiss_count", 0) ?: 0
                val stored = prefs(context).getInt(KEY_GUIDE_DISMISS, 0)
                prefs(context).edit()
                    .putInt(KEY_GUIDE_DISMISS, maxOf(stored, count))
                    .apply()
                if (count >= 3) setGuideStatus(context, "dismissed")
            }
        }
    }

    private fun markGoalDay(context: Context) {
        val today = todayKey()
        if (prefs(context).getString(KEY_GOAL_DAY, null) == today) return
        prefs(context).edit().putString(KEY_GOAL_DAY, today).apply()
        bump(context, C_GOAL_DAYS)
    }

    private fun setGuideStatus(context: Context, status: String) {
        prefs(context).edit().putString(KEY_GUIDE_STATUS, status).apply()
    }

    @Synchronized
    private fun bump(context: Context, key: String, delta: Long = 1L): Long {
        val p = prefs(context)
        val next = (p.getLong(key, 0L) + delta).coerceAtLeast(0L)
        p.edit().putLong(key, next).apply()
        return next
    }

    private fun schedulePropertySync(context: Context) {
        if (syncScheduled) return
        syncScheduled = true
        handler.postDelayed({
            syncScheduled = false
            syncProperties(context)
        }, 500)
    }

    fun syncProperties(context: Context) {
        ensureInitialized(context)
        val client = analytics ?: return
        if (!isEnabled(context)) return
        val p = prefs(context)
        val snapshot = healthSnapshot(context)
        val properties = linkedMapOf<String, String>(
            "notification_permission" to if (snapshot.notificationsEnabled) "granted" else "denied",
            "exact_alarm" to snapshot.exactAlarm.toString(),
            "battery_ignored" to snapshot.batteryIgnored.toString(),
            "notif_heads_up" to snapshot.headsUp.toString(),
            "domestic_rom" to snapshot.domestic.toString(),
            "rom_family" to snapshot.romFamily,
            "reminder_gap_min" to snapshot.gapMinutes.toString(),
            "goal_ml" to snapshot.goalMl.toString(),
            "reminder_mode" to snapshot.reminderMode,
            "guide_status" to (p.getString(KEY_GUIDE_STATUS, "not_shown") ?: "not_shown"),
            "app_env" to if (BuildConfig.DEBUG) "debug" else "release",
            C_NOTIF_SHOWN to p.getLong(C_NOTIF_SHOWN, 0L).toString(),
            C_NOTIF_OPENED to p.getLong(C_NOTIF_OPENED, 0L).toString(),
            C_NOTIF_DRINK to p.getLong(C_NOTIF_DRINK, 0L).toString(),
            C_FULLSCREEN_SHOWN to p.getLong(C_FULLSCREEN_SHOWN, 0L).toString(),
            C_FULLSCREEN_DRINK to p.getLong(C_FULLSCREEN_DRINK, 0L).toString(),
            C_MANUAL_DRINK to p.getLong(C_MANUAL_DRINK, 0L).toString(),
            C_DRINK_RECORDS to p.getLong(C_DRINK_RECORDS, 0L).toString(),
            C_DRINK_ML to p.getLong(C_DRINK_ML, 0L).toString(),
            C_GOAL_DAYS to p.getLong(C_GOAL_DAYS, 0L).toString(),
            C_ACTIVE_DAYS to p.getLong(C_ACTIVE_DAYS, 1L).toString(),
            C_INSTALL_DAYS to p.getLong(C_INSTALL_DAYS, 1L).toString()
        )
        // install_days 不落盘，每次按首启日期现算。
        val firstOpen = p.getString(KEY_FIRST_OPEN_DATE, null)
        if (firstOpen != null) {
            properties[C_INSTALL_DAYS] = daysBetween(firstOpen, todayKey()).toString()
        }
        try {
            properties.forEach { (key, value) ->
                client.setUserProperty(key, value.take(36))
            }
        } catch (error: Throwable) {
            Log.w(TAG, "用户属性写入失败：${error.message}")
        }
    }

    // ───────────────────────── 内部工具 ─────────────────────────

    private fun ensureInitialized(context: Context) {
        if (appContext == null) init(context)
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun defaultParams(context: Context): Bundle = Bundle().apply {
        putString("app_env", if (BuildConfig.DEBUG) "debug" else "release")
        putString("app_version", versionName(context))
        putInt("sdk_int", Build.VERSION.SDK_INT)
        putString("rom_family", romFamily())
    }

    private fun toBundle(params: JSONObject?): Bundle {
        val bundle = Bundle()
        if (params == null) return bundle
        val keys = params.keys()
        var count = 0
        while (keys.hasNext() && count < 25) {
            val key = keys.next()
            val value = params.opt(key)
            if (value == null || value == JSONObject.NULL) continue
            val safeKey = key.take(40)
            when (value) {
                is Boolean -> bundle.putBoolean(safeKey, value)
                is Int -> bundle.putInt(safeKey, value)
                is Long -> bundle.putLong(safeKey, value)
                is Double -> bundle.putDouble(safeKey, value)
                is Float -> bundle.putDouble(safeKey, value.toDouble())
                is Number -> bundle.putDouble(safeKey, value.toDouble())
                else -> bundle.putString(safeKey, value.toString().take(100))
            }
            count += 1
        }
        return bundle
    }

    private fun versionName(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
    } catch (_: Exception) {
        "?"
    }

    private fun todayKey(): String = synchronized(dateFormat) {
        dateFormat.format(Date())
    }

    private fun daysBetween(from: String, to: String): Long = try {
        synchronized(dateFormat) {
            val start = dateFormat.parse(from)?.time ?: return 1L
            val end = dateFormat.parse(to)?.time ?: return 1L
            ((end - start) / 86_400_000L).coerceAtLeast(0L) + 1L
        }
    } catch (_: Exception) {
        1L
    }

    private fun percent(total: Long, goal: Long): Int {
        if (goal <= 0) return 0
        return (total * 100 / goal).coerceIn(0L, 100L).toInt()
    }

    private fun progressBucket(total: Long, goal: Long): String {
        if (goal <= 0) return "no_goal"
        val ratio = total.toDouble() / goal
        return when {
            ratio < 0.25 -> "lt_25"
            ratio < 0.5 -> "25_50"
            ratio < 0.75 -> "50_75"
            ratio < 1.0 -> "75_100"
            else -> "100"
        }
    }

    private data class HealthSnapshot(
        val notificationsEnabled: Boolean,
        val exactAlarm: Boolean,
        val batteryIgnored: Boolean,
        val channelExists: Boolean,
        val channelImportance: Int,
        val headsUp: Boolean,
        val channelSound: Boolean,
        val channelVibration: Boolean,
        val romFamily: String,
        val domestic: Boolean,
        val goalMl: Long,
        val gapMinutes: Long,
        val reminderMode: String,
    )

    private fun healthSnapshot(context: Context): HealthSnapshot {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        val channelId = ReminderScheduler.channelId(context)
        val channel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager?.getNotificationChannel(channelId)
        } else {
            null
        }
        val importance = channel?.importance ?: -1
        val osHasChannels = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

        val config = try {
            context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
                .getString(ReminderPlugin.KEY_CONFIG, null)
                ?.let { JSONObject(it) }
        } catch (_: Exception) {
            null
        }
        val alert = config?.optJSONObject("alert")
        val general = config?.optJSONObject("general")
        val goal = alert?.optString("gold", "0")?.toLongOrNull() ?: 0L
        val gap = alert?.optString("gap", "20")?.toLongOrNull() ?: 20L
        val notify = general?.optBoolean("isNotification", true) ?: true
        val fullscreen = general?.optBoolean("isFullScreen", true) ?: true

        val family = romFamily()
        return HealthSnapshot(
            notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled(),
            exactAlarm = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                alarm?.canScheduleExactAlarms() == true,
            batteryIgnored = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                power?.isIgnoringBatteryOptimizations(context.packageName) == true,
            channelExists = channel != null,
            channelImportance = importance,
            headsUp = if (osHasChannels) importance >= NotificationManager.IMPORTANCE_HIGH else true,
            channelSound = if (osHasChannels && channel != null) channel.sound != null else true,
            channelVibration = if (osHasChannels && channel != null) channel.shouldVibrate() else true,
            romFamily = family,
            domestic = family in setOf("xiaomi", "huawei", "oppo", "vivo", "meizu"),
            goalMl = goal,
            gapMinutes = gap,
            reminderMode = when {
                notify && fullscreen -> "both"
                notify -> "notification"
                fullscreen -> "fullscreen"
                else -> "off"
            }
        )
    }

    private fun romFamily(): String {
        val manufacturer = (Build.MANUFACTURER ?: "").lowercase(Locale.ROOT)
        val brand = (Build.BRAND ?: "").lowercase(Locale.ROOT)
        return when {
            manufacturer.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco") -> "xiaomi"
            manufacturer.contains("huawei") || brand.contains("honor") -> "huawei"
            manufacturer.contains("oppo") || brand.contains("realme") || brand.contains("oneplus") -> "oppo"
            manufacturer.contains("vivo") || brand.contains("iqoo") -> "vivo"
            manufacturer.contains("meizu") -> "meizu"
            manufacturer.contains("samsung") -> "samsung"
            else -> "other"
        }
    }
}
