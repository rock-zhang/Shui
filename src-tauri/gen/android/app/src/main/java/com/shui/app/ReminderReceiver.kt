package com.shui.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID

/** 后台保底通道：精确闹钟 + 带「喝一杯」快捷操作的系统通知。 */
object ReminderScheduler {
    const val ACTION_REMINDER = "com.shui.app.REMINDER"
    const val ACTION_SKIP = "com.shui.app.SKIP"
    const val ACTION_DRINK_PREFIX = "com.shui.app.DRINK_"
    const val CHANNEL_ID = "shui-reminder"
    /**
     * 静音渠道。Android 8+ 的渠道创建后音效属性不可修改，所以「提醒音效」开关
     * 只能靠切渠道实现：开启走 CHANNEL_ID，关闭走这个无声通道。
     * 两者都是 IMPORTANCE_HIGH，区别只在有没有声音——关掉音效仍然要浮出横幅。
     */
    const val CHANNEL_ID_SILENT = "shui-reminder-silent"
    const val NOTIFICATION_ID = 2001
    const val ALARM_REQUEST_CODE = 3101

    /**
     * 与桌面 `registerActionTypes` 的档位保持一致（见 utils/notification.ts）。
     * Android 的闹钟通知与「测试通知」共用这一份配置，只有一套档位。
     */
    val DRINK_ACTIONS = listOf(200, 100, 50)

    private fun config(context: Context): JSONObject? {
        val raw = context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .getString(ReminderPlugin.KEY_CONFIG, null) ?: return null
        return try {
            JSONObject(raw)
        } catch (_: Exception) {
            null
        }
    }

    private fun parseTime(value: String): Int {
        val parts = value.split(":")
        val hour = parts.getOrNull(0)?.toIntOrNull() ?: return 9 * 60
        val minute = parts.getOrNull(1)?.toIntOrNull() ?: 0
        return (hour.coerceIn(0, 23) * 60 + minute.coerceIn(0, 59))
    }

    private fun minutesOfDay(calendar: Calendar) =
        calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)

    private fun inWindow(value: Int, start: Int, end: Int) =
        if (end <= start) value >= start || value <= end else value in start..end

    /**
     * 今日已喝量：直接读 Tauri store 的落盘文件，避免 Kotlin 与 WebView 双写缓存。
     * Tauri 的 app_data_dir() 对应 Android 的 `dataDir`（应用私有根），不是
     * `filesDir` 子目录；两边必须用同一个目录，否则 pending 记录永远回灌不了。
     */
    private fun appDataDir(context: Context): File = context.dataDir

    /** 与 Rust mobile.rs 共享的「上次提醒时间」账本，避免前台全屏与后台通知重复触发。 */
    private fun ledgerFile(context: Context): File = File(appDataDir(context), "last_reminder_at.txt")

    fun lastReminderAt(context: Context): Long = try {
        ledgerFile(context).readText().trim().toLongOrNull() ?: 0L
    } catch (_: Exception) {
        0L
    }

    fun markReminder(context: Context) {
        synchronized(this) {
            try {
                val file = ledgerFile(context)
                val tmp = File(file.parentFile, "last_reminder_at.tmp")
                tmp.writeText(System.currentTimeMillis().toString())
                tmp.renameTo(file)
            } catch (_: Exception) {
                // 账本写失败不影响本次提醒到达，下一轮仍能靠闹钟兜底。
            }
        }
    }

    fun gapMinutes(context: Context): Long =
        (config(context)?.optJSONObject("alert")?.optString("gap", "30")?.toLongOrNull() ?: 30L)
            .coerceIn(1, 720)

    private fun todayAmount(context: Context): Long {
        return try {
            val file = File(appDataDir(context), "drink_history_store.json")
            if (!file.exists()) return 0
            val root = JSONObject(file.readText())
            val key = SimpleDateFormat("yyyyMMdd", Locale.getDefault()).format(Date())
            val value = root.opt(key) ?: return 0
            if (value is Number) value.toLong()
            else (value as? JSONObject)?.optLong("total", 0) ?: 0
        } catch (_: Exception) {
            0
        }
    }

    fun shouldNotify(context: Context): Boolean {
        val root = config(context) ?: return false
        val alert = root.optJSONObject("alert") ?: return false
        val general = root.optJSONObject("general")
        if (general?.optBoolean("isPaused", false) == true) return false
        // 「系统通知」开关：关闭后后台不再发通知，前台的全屏提醒不受影响。
        if (general?.optBoolean("isNotification", true) == false) return false
        val goal = alert.optString("gold", "1000").toLongOrNull() ?: 1000L
        return goal <= 0 || todayAmount(context) < goal
    }

    /** 「提醒音效」开关；缺省为有声，与前端默认值一致。 */
    fun isSoundEnabled(context: Context): Boolean =
        config(context)?.optJSONObject("general")?.optBoolean("isSound", true) ?: true

    /**
     * 系统是否还允许本应用发通知。Android 13+ 由 POST_NOTIFICATIONS 决定，
     * 低版本恒为 true（用户仍可在系统设置里整个关掉）。
     */
    fun canPostNotifications(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun cancel(context: Context) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        manager.cancel(alarmIntent(context, ACTION_REMINDER, ALARM_REQUEST_CODE))
    }

    private fun alarmIntent(context: Context, action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(action)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, requestCode, intent, flags)
    }

    fun scheduleNext(context: Context) {
        val root = config(context) ?: return
        val alert = root.optJSONObject("alert") ?: JSONObject()
        val general = root.optJSONObject("general") ?: JSONObject()
        if (general.optBoolean("isPaused", false)) {
            cancel(context)
            return
        }

        val gap = (alert.optString("gap", "30").toIntOrNull() ?: 30).coerceIn(1, 720)
        val daysArray: JSONArray? = alert.optJSONArray("weekdays")
        val weekdays = if (daysArray != null && daysArray.length() > 0) {
            (0 until daysArray.length()).map { daysArray.optInt(it, 0) }.toSet()
        } else {
            (0..6).toSet()
        }
        val start = parseTime(alert.optString("timeStart", "09:00"))
        val end = parseTime(alert.optString("timeEnd", "18:00"))
        val quietEnabled = general.optBoolean("quietEnabled", false)
        val quietStart = parseTime(general.optString("quietStart", "22:00"))
        val quietEnd = parseTime(general.optString("quietEnd", "07:00"))

        val candidate = Calendar.getInstance().apply { add(Calendar.MINUTE, gap) }
        var found = false
        // 最多向后找 8 天，覆盖「只在周一提醒」这类配置。
        var attempts = 0
        val maxAttempts = 8 * 24 * 60
        while (attempts < maxAttempts) {
            val weekday = candidate.get(Calendar.DAY_OF_WEEK) - 1 // 0 = 周日，与前端一致
            val minute = minutesOfDay(candidate)
            val inWorkTime = inWindow(minute, start, end)
            val inQuiet = quietEnabled && inWindow(minute, quietStart, quietEnd)
            if (weekday in weekdays && inWorkTime && !inQuiet) {
                found = true
                break
            }
            candidate.add(Calendar.MINUTE, gap)
            attempts += gap
        }
        if (!found) return

        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = alarmIntent(context, ACTION_REMINDER, ALARM_REQUEST_CODE)
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
        try {
            if (canExact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.timeInMillis, pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.timeInMillis, pending)
            }
        } catch (_: SecurityException) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.timeInMillis, pending)
        }
    }

    /** 通知 Action 在 WebView 未启动时把饮水写进待处理文件，由 Rust 回灌。 */
    fun appendPendingDrink(context: Context, amount: Int) {
        synchronized(this) {
            try {
                val file = File(appDataDir(context), "pending_drinks.json")
                val array = if (file.exists()) {
                    try {
                        JSONArray(file.readText())
                    } catch (_: Exception) {
                        JSONArray()
                    }
                } else {
                    JSONArray()
                }
                array.put(
                    JSONObject()
                        .put("amount", amount)
                        .put("requestId", "notification:${UUID.randomUUID()}")
                )
                file.writeText(array.toString())
            } catch (_: Exception) {
                // 写失败时用户仍可在 App 内手动补记，不能让通知 Action 崩掉。
            }
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        when {
            action == ReminderScheduler.ACTION_SKIP -> {
                cancelNotification(context)
                ReminderScheduler.scheduleNext(context)
            }
            action.startsWith(ReminderScheduler.ACTION_DRINK_PREFIX) -> {
                val amount = action.removePrefix(ReminderScheduler.ACTION_DRINK_PREFIX).toIntOrNull()
                if (amount != null && amount > 0) ReminderScheduler.appendPendingDrink(context, amount)
                cancelNotification(context)
                ReminderScheduler.scheduleNext(context)
            }
            else -> {
                val now = System.currentTimeMillis()
                val last = ReminderScheduler.lastReminderAt(context)
                val gapMs = ReminderScheduler.gapMinutes(context) * 60_000L
                // 前台 timer 刚弹过全屏并写了账本时，闹钟这一路不再补通知，
                // 避免「进 App 后通知 + 全屏同时弹」。首启/账本缺失时 last=0，
                // 视为该提醒一次，正常发通知并落账本。
                if (now - last >= gapMs) {
                    // 没有通知权限时不盖账本戳：notify() 会被系统静默丢弃，
                    // 若这里照旧落账本，用户打开 App 后前台 timer 会认为
                    // 「刚提醒过」，连全屏提醒都不补——提醒变成彻底静默的
                    // 失败。不盖章，让下次进 App 时补一次全屏提醒。
                    if (ReminderScheduler.canPostNotifications(context)) {
                        ReminderScheduler.markReminder(context)
                        if (ReminderScheduler.shouldNotify(context)) showNotification(context)
                    }
                }
                // 无论是否展示，都要安排下一次，保证达标/勿扰结束后能自动恢复。
                ReminderScheduler.scheduleNext(context)
            }
        }
    }

    private fun cancelNotification(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(ReminderScheduler.NOTIFICATION_ID)
    }

    /**
     * 非 private：自定义插件的「测试通知」命令会复用同一条通知构建逻辑，
     * 保证测试通知与闹钟通知的图标、渠道、Action 完全一致。
     */
    fun showNotification(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // 「提醒音效」开关：关掉后切到无声渠道，通知本身照常送达。
        val soundEnabled = ReminderScheduler.isSoundEnabled(context)
        val channelId =
            if (soundEnabled) ReminderScheduler.CHANNEL_ID else ReminderScheduler.CHANNEL_ID_SILENT

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = if (soundEnabled) {
                NotificationChannel(
                    channelId,
                    "喝水提醒",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply { description = "定时喝水提醒，可直接在通知里记一杯水" }
            } else {
                NotificationChannel(
                    channelId,
                    "喝水提醒（静音）",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "已关闭提醒音效：照常提醒，但不发出声音"
                    setSound(null, null)
                }
            }
            manager.createNotificationChannel(channel)
        }

        val open = Intent(context, MainActivity::class.java).apply {
            putExtra(ReminderPlugin.EXTRA_OPEN_REMINDER, true)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val content = PendingIntent.getActivity(context, 1, open, flags)

        fun drinkAction(amount: Int, requestCode: Int): PendingIntent {
            val broadcast = Intent(context, ReminderReceiver::class.java)
                .setAction("${ReminderScheduler.ACTION_DRINK_PREFIX}$amount")
            return PendingIntent.getBroadcast(context, requestCode, broadcast, flags)
        }

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_water)
            // 下拉大图标用桌面版「水」字 logo；状态栏小图标受系统限制只能单色剪影。
            .setLargeIcon(BitmapFactory.decodeResource(context.resources, R.drawable.ic_notification_large))
            .setColor(0xFF3B82F6.toInt())
            .setContentTitle("该喝水啦")
            .setContentText("站起来喝杯水，顺便活动一下身体吧")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(content)
            // Android 7.x 没有渠道，音效由 builder 决定。
            .setSilent(!soundEnabled)

        ReminderScheduler.DRINK_ACTIONS.forEachIndexed { index, amount ->
            val label = if (index == 0) "喝一杯 ${amount}ml" else "${amount}ml"
            builder.addAction(
                R.drawable.ic_stat_water,
                label,
                drinkAction(amount, 2 + index)
            )
        }
        builder.addAction(
            R.drawable.ic_stat_water,
            "稍后再说",
            PendingIntent.getBroadcast(
                context, 2 + ReminderScheduler.DRINK_ACTIONS.size,
                Intent(context, ReminderReceiver::class.java).setAction(ReminderScheduler.ACTION_SKIP),
                flags
            )
        )

        val notification = builder.build()

        try {
            manager.notify(ReminderScheduler.NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // 未授予 POST_NOTIFICATIONS：App 前台的 timer-complete 通道仍然可用。
        }
    }
}

/** 开机 / 应用更新后重建闹钟，对应桌面的「开机自启」。 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            ReminderScheduler.scheduleNext(context)
        }
    }
}
