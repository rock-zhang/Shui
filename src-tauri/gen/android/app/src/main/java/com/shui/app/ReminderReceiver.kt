package com.shui.app

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
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


/** 后台保底通道：精确闹钟 + 带「+Xml」快捷操作的系统通知。 */
object ReminderScheduler {
    /**
     * 通知全链路的诊断日志统一走这个 TAG：
     * `adb logcat -s ShuiReminder` 就能看到「闹钟有没有排上、到期有没有触发、
     * 为什么没发通知」。此前所有失败分支都是 catch 吞掉，用户侧只能看到
     * 「到点没反应」，无法判断断在系统权限、渠道还是调度。
     */
    const val TAG = "ShuiReminder"

    const val ACTION_REMINDER = "com.shui.app.REMINDER"
    const val ACTION_SKIP = "com.shui.app.SKIP"
    const val ACTION_DISMISS = "com.shui.app.DISMISS"
    const val ACTION_DRINK_PREFIX = "com.shui.app.DRINK_"
    // v5：有声渠道用系统默认通知提示音（RingtoneManager.TYPE_NOTIFICATION）。
    // 真机实锤：没声音的根因是国产 ROM 应用级的「铃声」开关默认关着，不是铃声 URI
    // 的问题，所以不需要内置音频——用系统默认音反而让用户能在系统里自己换铃声。
    // 渠道声音属性创建后固化，只能换 id 让新配置从零生效。
    const val CHANNEL_ID = "shui-reminder-v5"
    /**
     * 静音渠道。Android 8+ 的渠道创建后音效属性不可修改，所以「提醒音效」开关
     * 只能靠切渠道实现：开启走 CHANNEL_ID，关闭走这个无声通道。
     * 两者都是 IMPORTANCE_HIGH，区别只在有没有声音——关掉音效仍然要浮出横幅。
     */
    const val CHANNEL_ID_SILENT = "shui-reminder-silent-v5"

    /**
     * 历史渠道 id。
     *
     * 渠道的 importance / lockscreenVisibility 创建后**只有用户能改**，应用再调
     * createNotificationChannel 也不会生效。早期版本用这两个 id 建过渠道，
     * 一旦被建成就永远拿不到横幅，靠运行时「删除再重建」既不干净（同一次
     * create 可能被系统的待删状态吃掉），又会重置用户在系统里的自定义。
     *
     * 正确做法是换新 id 让配置从零开始，并在启动时清掉旧渠道——否则系统通知
     * 设置里会并排出现两个「喝水提醒」，用户不知道该关哪个。
     */
    val LEGACY_CHANNEL_IDS = listOf(
        "shui-reminder",
        "shui-reminder-silent",
        "shui-reminder-v2",
        "shui-reminder-silent-v2",
        "shui-reminder-v3",
        "shui-reminder-silent-v3",
        "shui-reminder-v4",
        "shui-reminder-silent-v4",
        // 更早的前台保活渠道，已废弃。
        "shui-keepalive"
    )
    const val NOTIFICATION_ID = 2001
    const val ALARM_REQUEST_CODE = 3101

    /** 原生已排定的下一次提醒时间（毫秒）；今日页直接读它，不再按 now 现算。 */
    const val KEY_NEXT_AT = "next_reminder_at_ms"

    /**
     * 上一次「排了但没响」的闹钟时刻。国产 ROM 划掉多任务走的是 force-stop，
     * 会连带清空本包所有 AlarmManager 闹钟，此后 KEY_NEXT_AT 就永久停在过去。
     * 这个键是唯一能留下的证据，供前端提示用户去开「后台运行」。
     */
    const val KEY_MISSED_AT = "missed_alarm_at_ms"

    /**
     * 用户已经确认过的那条漏报排期时刻。清账时记下当时的 KEY_MISSED_AT，
     * detectMissedAlarm 见到不晚于它的排期就不再写回。
     *
     * 为什么还要多存一个游标：KEY_NEXT_AT 是今日页「预计下一杯」的显示依据，
     * 不能因为清账就删掉。但只要它还停在过去，下一次 schedule() 的
     * detectMissedAlarm 又会把同一条漏报判出来写回，前端刚关的弹窗立刻复弹。
     * 只挡「已确认的那一条」：scheduleNext 把排期推到未来后，新漏报照常检测。
     */
    const val KEY_MISSED_ACK = "missed_alarm_ack_ms"

    /**
     * 上一次冷启动时是否发现闹钟句柄已被系统删除。
     *
     * 必须存快照而不是实时查：冷启动一进来就 `sync_schedule` 重排，PendingIntent
     * 立刻被重新创建，事后再查永远是「还在」，证据就没了。
     */
    const val KEY_ALARM_CLEARED = "alarm_handle_cleared"

    /**
     * 「今日目标已达成」通知已经播报过的日期（yyyyMMdd）。
     *
     * 达标后 shouldNotify() 会一直返回 false，到点的闹钟被静默跳过——用户喝完
     * 最后一杯后一整天再无任何反馈，很容易误判成「提醒坏了」。补一条收尾通知
     * 说清楚「今天够了」，但一天只能有一条，所以按日期去重。
     */
    const val KEY_GOAL_NOTIFIED = "goal_notified_date"

    /** 达标通知用独立 id：不能和喝水提醒互相覆盖。 */
    const val GOAL_NOTIFICATION_ID = 2002

    /**
     * App 自己撤销通知时写入的抑制截止时间（毫秒）。
     *
     * cancel() 同样会触发 setDeleteIntent 的广播；写入一个 short window 内的
     * 截止时间，让紧随其后的 dismiss 广播被识别为「我们自己撤的」而不是用户
     * 划走，避免把 skip / 记水 / 达标收通知误算成「划掉提醒」。
     */
    const val KEY_DISMISS_SUPPRESS_UNTIL = "dismiss_suppress_until_ms"

    /**
     * 通知快捷按钮的兜底杯量。用户在今日页长按卡片自定义 quickAmounts 后，
     * [drinkActions] 会取其中最小的三档；配置缺失/非法时回退到这里。
     * 升序不是随便定的：macOS 会把多个动作折叠进下拉菜单，直接点下拉按钮会被
     * 系统上报成第一个动作，最小档排首位时误点代价最小。
     */
    val DRINK_ACTIONS = listOf(50, 100, 200)

    /**
     * 通知快捷按钮实际使用的杯量：读前端同步的 alert.quickAmounts（今日页
     * 长按卡片可自定义，经 saveConfig 写进配置快照），升序取最小三档。
     * 只影响通知按钮文案，不影响提醒节奏，因此随 saveConfig 同步即可。
     */
    fun drinkActions(context: Context): List<Int> {
        val amounts = config(context)?.optJSONObject("alert")
            ?.optJSONArray("quickAmounts")
            ?.let { arr ->
                (0 until arr.length()).mapNotNull { index ->
                    when (val value = arr.opt(index)) {
                        is Number -> value.toDouble().toInt()
                        is String -> value.toIntOrNull()
                        else -> null
                    }?.coerceIn(10, 1000)
                }
            }
            ?: emptyList()
        if (amounts.size < 3) return DRINK_ACTIONS
        return amounts.sorted().take(3)
    }

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
            // 提醒成功送达即说明链路已恢复，之前的漏报记录不再成立。
            clearMissedAlarm(context)
        }
    }

    fun gapMinutes(context: Context): Long =
        (config(context)?.optJSONObject("alert")?.optString("gap", "20")?.toLongOrNull() ?: 20L)
            .coerceIn(1, 720)

    fun todayAmount(context: Context): Long =
        storedTodayAmount(context) + pendingTodayAmount(context)

    /** 已回灌进 store 的今日总量。 */
    private fun storedTodayAmount(context: Context): Long {
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

    /**
     * 还在 `pending_drinks.json` 里、尚未被 Rust 回灌的今日饮水量。
     *
     * 通知栏记水只写待处理队列，要等 App 启动后 drain 线程才落进 store。
     * 若进度只读 store，用户连续用通知记水而不打开 App 时，下一条通知里的
     * 进度和达标判断会一直停在旧值。这里按点击时间戳只累加当天的记录：
     * 队列清空（已落库）后自然归零，不会重复计数；旧版本写入的记录没有
     * 时间戳，按当天计。
     *
     * 只读 pending 文件、不读 processing 文件：drain 期间 store 可能已写入
     * 而 processing 还没删，同时读会重复计数。
     */
    private fun pendingTodayAmount(context: Context): Long {
        return try {
            val file = File(appDataDir(context), "pending_drinks.json")
            if (!file.exists()) return 0
            val array = JSONArray(file.readText())
            val format = SimpleDateFormat("yyyyMMdd", Locale.getDefault())
            val today = format.format(Date())
            var sum = 0L
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val amount = item.optLong("amount", 0)
                if (amount <= 0) continue
                val timestamp = item.optLong("timestamp", 0)
                val day = if (timestamp > 0) format.format(Date(timestamp)) else today
                if (day == today) sum += amount
            }
            sum
        } catch (_: Exception) {
            // 与 Kotlin 侧并发追加撞上写入中的文件时按 0 处理：只影响一次展示。
            0
        }
    }

    /** 「暂停提醒」「系统通知」两个总开关；达标通知也要遵守，否则用户关了通知还会被打扰。 */
    fun alertsEnabled(context: Context): Boolean {
        val root = config(context) ?: return false
        val general = root.optJSONObject("general") ?: return true
        if (general.optBoolean("isPaused", false)) return false
        return general.optBoolean("isNotification", true)
    }

    /** 今日目标（ml）；未设置时为 0。 */
    fun goalAmount(context: Context): Long =
        config(context)?.optJSONObject("alert")?.optString("gold", "0")?.toLongOrNull() ?: 0L

    /**
     * 达标的进度快照，未达标返回 null。
     * total/goal 一起返回，通知文案里的数字必须与用户设置的一致。
     */
    fun goalProgress(context: Context): Pair<Long, Long>? {
        val goal = goalAmount(context)
        if (goal <= 0) return null
        val total = todayAmount(context)
        return if (total >= goal) total to goal else null
    }

    fun goalNotifiedToday(context: Context): Boolean =
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .getString(KEY_GOAL_NOTIFIED, "") ==
            SimpleDateFormat("yyyyMMdd", Locale.getDefault()).format(Date())

    fun markGoalNotified(context: Context) {
        val today = SimpleDateFormat("yyyyMMdd", Locale.getDefault()).format(Date())
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_GOAL_NOTIFIED, today)
            .apply()
    }

    fun shouldNotify(context: Context): Boolean {
        if (!alertsEnabled(context)) return false
        if (config(context)?.optJSONObject("alert") == null) return false
        // gap==1 是测试档：即使今日已达标也要发，否则测试时喝够一杯就再也测不到。
        if (gapMinutes(context) == 1L) return true
        val goal = goalAmount(context)
        return goal <= 0 || todayAmount(context) < goal
    }

    /** 「提醒音效」开关；缺省为有声，与前端默认值一致。 */
    fun isSoundEnabled(context: Context): Boolean =
        config(context)?.optJSONObject("general")?.optBoolean("isSound", true) ?: true

    /**
     * 通知栏记水后的气泡确认音。
     *
     * 在通知里点按钮时 App 处于后台，屏幕上唯一的变化是通知被撤掉；没有声音
     * 就完全没有「记上了」的确认感，容易让人怀疑没点中而再点一次。
     *
     * 音效是 Mixkit 的真实录音（Free License），已裁到约 0.9 秒并统一响度。
     *
     * 三条约束：
     * - 跟随「提醒音效」开关：用户明确关掉声音时不该被这一声回马枪打扰；
     * - 走 USAGE_NOTIFICATION_EVENT：音量随通知音量，勿扰模式下由系统抑制；
     * - 静音 / 震动档直接跳过，播放也听不见，白耗一次解码。
     */
    fun playConfirmTone(context: Context) {
        if (!isSoundEnabled(context)) return
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audio?.ringerMode == AudioManager.RINGER_MODE_SILENT) return
        if (audio != null) {
            val max = audio.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION)
            if (max > 0 && audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION) == 0) return
        }
        // 每次新建播放器：接收器可能被系统单独拉起，缓存全局句柄在进程回收后
        // 会变成失效引用；播放完由 completion 回调释放。
        try {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val afd = context.resources.openRawResourceFd(R.raw.confirm_bubble) ?: return
            val player = MediaPlayer()
            player.setAudioAttributes(attrs)
            player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            afd.close()
            player.setOnCompletionListener { it.release() }
            player.setOnErrorListener { mp, _, _ ->
                mp.release()
                true
            }
            player.prepare()
            player.start()
        } catch (error: Exception) {
            // 音效失败绝不能影响记水本身，静默降级。
            Log.w(TAG, "提示音播放失败：${error.message}")
        }
    }

    /** 当前生效的渠道：开启音效走有声渠道，关闭后走静音渠道。 */
    fun channelId(context: Context): String =
        if (isSoundEnabled(context)) CHANNEL_ID else CHANNEL_ID_SILENT

    private fun buildChannel(channelId: String, context: Context): NotificationChannel {
        val soundEnabled = channelId == CHANNEL_ID
        return NotificationChannel(
            channelId,
            AppStrings.channelName(context, soundEnabled),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = AppStrings.channelDescription(context, soundEnabled)
            // 横幅（Heads-up）的硬条件是渠道 importance >= HIGH；部分 ROM 还额外
            // 要求「有声音或震动」。静音渠道若两者皆无，提醒就只会静静躺在通知栏，
            // 所以这里必须给一段短震动兜底。
            enableVibration(true)
            vibrationPattern = if (soundEnabled) {
                longArrayOf(0, 200, 120, 200)
            } else {
                longArrayOf(0, 120)
            }
            // 锁屏显示完整内容：通知自身的 setVisibility(PUBLIC) 与这里缺一不可，
            // 任意一侧是 PRIVATE 都会在锁屏上被折叠成「内容已隐藏」。
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(true)
            if (soundEnabled) {
                // 用系统默认通知提示音，用户可在系统设置里自行更换铃声。
                // 真机实锤：没声音的根因是国产 ROM 应用级「铃声」开关默认关着，
                // 与铃声 URI 无关，所以不需要内置音频。
                val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                setSound(
                    soundUri,
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
            } else {
                setSound(null, null)
            }
        }
    }

    /**
     * 保证渠道存在。
     *
     * createNotificationChannel 是幂等的：渠道已存在时只更新名称与描述，
     * **不会**覆盖用户在系统里调过的重要性 / 横幅 / 锁屏开关。
     *
     * 所以渠道的默认属性由 id 承载（见 CHANNEL_ID 的 `-v5` 后缀）：
     * 要改默认配置就换一个新 id，不要指望在这里改已有渠道——那在 Android 上
     * 从设计上就不成立。
     */
    fun ensureChannel(
        context: Context,
        manager: NotificationManager,
        id: String = channelId(context),
        refreshName: Boolean = false
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        // ColorOS 实测：对**已存在**的渠道再调 createNotificationChannel，也会用传入
        // 参数覆盖用户在系统设置里改过的横幅/声音/振动。渠道一旦建好，这里就不能再碰，
        // 否则每次启动、每条通知、每次点「去设置」都会把用户的选择改回默认——表现
        // 就是「改了不生效、状态永远不刷新」。只有明确要刷新渠道名（语言切换）才写。
        if (!refreshName && manager.getNotificationChannel(id) != null) return
        manager.createNotificationChannel(buildChannel(id, context))
    }

    /**
     * App 启动时预创建两个提醒渠道（幂等，纯 createNotificationChannel）。
     *
     * 官方推荐在 App 启动时就建好渠道，理由有两个，都影响横幅：
     *
     * 1. 渠道不存在时，系统通知设置里根本看不到「喝水提醒」这一项，用户想确认
     *    自己有没有开横幅也无处可看——微信这类 App 一装上就能在设置里看到渠道，
     *    正是因为它们在启动时就建好了。
     * 2. 渠道的默认属性由「第一次创建」那一刻决定，之后应用永久改不了。如果
     *    一直拖到第一次发通知才建，这个时机就落在系统/ROM 对新装应用的通知
     *    观察期里，存在被以低重要度记录的风险，一旦写死就只能靠换 id 重来。
     *
     * 提前建只是把「默认 HIGH」这件事尽早钉死，不涉及任何权限申请。
     */
    fun ensureChannels(context: Context, refreshName: Boolean = false) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (refreshName) {
            // 语言变化时只刷新已存在的渠道名，缺失的不补建。
            for (id in listOf(CHANNEL_ID, CHANNEL_ID_SILENT)) {
                if (manager.getNotificationChannel(id) != null) {
                    manager.createNotificationChannel(buildChannel(id, context))
                }
            }
            return
        }
        // 只建当前要用的那个渠道：声音开关关着时用静音渠道，开着时用有声渠道。
        // 两个都预建会让系统设置里多出一个当前根本用不到的「静音」分类。
        ensureChannel(context, manager, channelId(context))
    }

    /** 渠道上次使用的语言（归一化后的 locale），用于判断是否需要刷新名称。 */
    const val KEY_CHANNEL_LOCALE = "channel_locale"

    /**
     * 语言偏好变化时刷新渠道名与描述。
     *
     * Android 上 createNotificationChannel 对已存在的渠道只更新 name 与 description，
     * **不会**覆盖用户在系统里调过的 importance / 横幅 / 锁屏 / 声音设置。因此切换
     * 语言时只需再调一次 ensureChannels 用新文案覆盖名称，绝不能删除重建（那会丢失
     * 用户的渠道自定义，也是高风险操作）。仅在检测到 locale 变化时触发，避免每次
     * 启动都去写系统通知设置。
     */
    fun syncChannelLocale(context: Context) {
        val locale = AppLocale.current(context)
        val prefs = context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY_CHANNEL_LOCALE, null) == locale) return
        prefs.edit().putString(KEY_CHANNEL_LOCALE, locale).apply()
        // 只有语言真的变了才重写渠道，用 refreshName 明确允许覆盖名称；
        // 其余时候 ensureChannel 会跳过已存在的渠道，避免清掉用户的自定义。
        ensureChannels(context, refreshName = true)
    }

    /**
     * 前端「一键修复」：删除并重建两个提醒渠道，让重要度/锁屏可见性回到默认。
     *
     * 用户在系统里把某个渠道的重要性调小、关了横幅之后，应用无法改回来，
     * 删除重建是唯一手段。顺带会清掉该渠道的其它自定义，所以只在用户显式
     * 点击时执行，不做后台自动自愈。
     */
    fun repairChannels(context: Context, manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        listOf(CHANNEL_ID, CHANNEL_ID_SILENT).forEach { id ->
            manager.deleteNotificationChannel(id)
        }
        ensureChannel(context, manager, CHANNEL_ID)
        ensureChannel(context, manager, CHANNEL_ID_SILENT)
        // 个别 ROM 在删除后立刻创建同名渠道会静默失败（渠道处于待删状态），
        // 那种情况下通知会因为渠道不存在被系统丢弃——读回来确认一次。
        val rebuilt = manager.getNotificationChannel(CHANNEL_ID)
        if (rebuilt == null) {
            Log.w(TAG, "渠道 $CHANNEL_ID 重建未生效，用户需退出并重新打开 App")
        } else {
            Log.i(
                TAG,
                "渠道已重建：$CHANNEL_ID 重要度=${rebuilt.importance} 锁屏=${rebuilt.lockscreenVisibility}"
            )
        }
    }

    /**
     * 清掉历史渠道。
     *
     * 旧 id 建过的渠道不会因为代码改名而消失，会一直挂在系统通知设置里；
     * 不清掉的话用户会看到两个同名「喝水提醒」，不知道该关哪个。
     */
    fun deleteLegacyChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        LEGACY_CHANNEL_IDS.forEach { id ->
            if (manager.getNotificationChannel(id) != null) {
                manager.deleteNotificationChannel(id)
                Log.i(TAG, "已清理历史通知渠道 $id")
            }
        }
    }

    /**
     * 系统是否还允许本应用发通知。Android 13+ 由 POST_NOTIFICATIONS 决定，
     * 低版本恒为 true（用户仍可在系统设置里整个关掉）。
     *
     * 注意：`areNotificationsEnabled()` 只看应用级开关。用户把「喝水提醒」这个
     * 渠道单独关掉（或降到「静音/不显示」）时它仍返回 true，notify() 会被系统
     * 静默丢弃——账本却已经盖上戳，前台 timer 随后也不会补全屏提醒，最终表现
     * 就是「权限都开着，但一条都没有」。所以这里必须再查一次渠道 importance。
     */
    fun canPostNotifications(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            Log.w(TAG, "canPostNotifications=false：应用级通知开关已关闭")
            return false
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = channelId(context)
        // 渠道尚未创建时视为可用：首次 notify 会顺带创建。
        val importance = manager.getNotificationChannel(channelId)?.importance
            ?: return true
        if (importance == NotificationManager.IMPORTANCE_NONE) {
            Log.w(TAG, "canPostNotifications=false：通知渠道 $channelId 已被单独关闭")
            return false
        }
        return true
    }

    /**
     * 只有「Activity 真正有窗口焦点 + 亮屏 + 未锁屏」才允许 WebView 弹全屏。
     *
     * 不能直接看 appForeground：它只在 onResume/onPause 维护，锁屏、分屏、
     * 系统对话框覆盖、失焦等场景都不准——一旦误判为前台，Rust 就会把
     * timer-complete 投给一个其实不可见的 WebView，用户关闭后打开 App
     * 才看到积压的弹窗，而后台通知又被抢写的账本吞掉。
     * hasWindowFocus() 由系统按真实焦点给出，是可靠得多前台判据。
     */
    fun canUseOverlay(context: Context): Boolean {
        val activity = ReminderPlugin.currentActivity()
        if (activity == null || activity.isFinishing) return false
        if (!activity.hasWindowFocus()) return false
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (power?.isInteractive != true) return false
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        if (keyguard?.isKeyguardLocked == true) return false
        Log.i(TAG, "canUseOverlay=true：窗口有焦点且亮屏未锁屏，本次走 App 内全屏")
        return true
    }

    /**
     * Rust 前台计时到点后的通道裁决：
     * - overlay：交给 WebView 弹全屏（仅窗口真有焦点 + 亮屏 + 未锁屏）
     * - notification：原生已校验通知可用、投递成功并写好账本
     * - defer：暂时不归任何一路处理，Rust 不写账本、不 emit，
     *          交给 AlarmManager 独占后台通知（暂停/关通知/无权限都归这里）
     */
    fun deliverForeground(context: Context): String {
        if (canUseOverlay(context)) {
            AnalyticsTracker.logReminderDelivered(context, "overlay")
            return "overlay"
        }
        val general = config(context)?.optJSONObject("general")
        // 刚点暂停、用户关掉系统通知、或无通知权限时不能把这次提醒静默吞掉：
        // 返回 defer 让 Rust 不盖账本，AlarmManager 那一路保留补偿机会。
        if (general?.optBoolean("isPaused", false) == true) {
            Log.i(TAG, "deliverForeground=defer：已暂停，交给 AlarmManager")
            AnalyticsTracker.logReminderDelivered(context, "defer_paused")
            return "defer"
        }
        if (general?.optBoolean("isNotification", true) == false) {
            Log.i(TAG, "deliverForeground=defer：系统通知已关闭")
            AnalyticsTracker.logReminderDelivered(context, "defer_notification_off")
            return "defer"
        }
        if (!canPostNotifications(context)) {
            Log.i(TAG, "deliverForeground=defer：无通知权限，不盖账本")
            AnalyticsTracker.logNotificationBlocked(
                context,
                "foreground",
                blockReason(context)
            )
            AnalyticsTracker.logReminderDelivered(context, "defer_no_permission")
            return "defer"
        }
        // 只在通知真正投递成功后才盖账本，杜绝「账本写了但通知没发出去」
        // 导致 AlarmManager 与前台全屏两路都被抑制的静默失败。
        val delivered = shouldNotify(context) && ReminderReceiver().showNotification(context, "foreground")
        if (delivered) {
            markReminder(context)
            Log.i(TAG, "deliverForeground=notification：通知已投递并写账本")
            AnalyticsTracker.logReminderDelivered(context, "notification")
        } else {
            // 已达标或投递失败：不盖账本，让 AlarmManager 按自己的判断处理。
            Log.i(TAG, "deliverForeground=defer：已达标或通知投递失败")
            AnalyticsTracker.logReminderDelivered(context, "defer_goal_or_failed")
        }
        return if (delivered) "notification" else "defer"
    }

    /** 通知发不出去的具体原因，供埋点区分「应用级关闭」与「渠道被关」。 */
    fun blockReason(context: Context): String {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return "app_disabled"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val importance = manager.getNotificationChannel(channelId(context))?.importance
            if (importance == NotificationManager.IMPORTANCE_NONE) return "channel_disabled"
        }
        return "no_permission"
    }

    /** 原生当前排定的下一次提醒；没有有效闹钟时为 0。 */
    fun nextReminderAt(context: Context): Long =
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_NEXT_AT, 0L)

    private fun rememberNext(context: Context, at: Long) {
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_NEXT_AT, at)
            .apply()
    }

    private fun forgetNext(context: Context) {
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_NEXT_AT)
            .apply()
    }

    /** 上一次漏掉的提醒时刻；0 表示没有漏报。 */
    fun missedAlarmAt(context: Context): Long =
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_MISSED_AT, 0L)

    /**
     * 系统里是否还留着我们那条闹钟的 PendingIntent。
     *
     * force-stop 会调用 `PendingIntentController.removePendingIntentsForPackage`
     * 把整个包的 PendingIntent 一起删掉，所以「查不到」就是被 force-stop 清过的
     * 铁证；查到只说明句柄还在，不代表闹钟还排着（触发过的 PendingIntent 不会自动
     * 消失），因此只用作单向判据。
     */
    fun pendingAlarmAlive(context: Context): Boolean {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION_REMINDER)
        val flags = PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE, intent, flags) != null
    }

    /** 用户已确认过的漏报排期时刻；0 表示没有确认过。 */
    fun missedAckAt(context: Context): Long =
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_MISSED_ACK, 0L)

    fun clearMissedAlarm(context: Context) {
        val prefs = context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
        val ack = prefs.getLong(KEY_MISSED_AT, 0L)
        // 一次 apply 提交：删证据和记游标之间若被 detectMissedAlarm 插进来，
        // 同一条记录会在清完的瞬间又被写回。
        val editor = prefs.edit()
            .remove(KEY_MISSED_AT)
            .remove(KEY_ALARM_CLEARED)
        if (ack > 0) {
            editor.putLong(KEY_MISSED_ACK, maxOf(ack, prefs.getLong(KEY_MISSED_ACK, 0L)))
        }
        editor.apply()
    }

    /** 上次冷启动时的快照：闹钟句柄是否已被系统删除。 */
    fun alarmHandleWasCleared(context: Context): Boolean =
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ALARM_CLEARED, false)

    /**
     * 冷启动 / 回到前台时，**在重排之前**调用：上一轮排定的闹钟到了点却没兑现，
     * 说明它已经从系统里消失。
     *
     * 国产 ROM 从多任务划掉 App 走的是 force-stop（`am force-stop` 的语义），
     * ActivityManagerService 会连带清空本包所有 AlarmManager 闹钟，并把包标记为
     * stopped 使静态广播不再投递。于是 KEY_NEXT_AT 永久停在过去——这是那次失败
     * 唯一还会留下的痕迹。一旦 scheduleNext() 重排就会把它覆盖掉，所以检测必须
     * 排在重排之前。
     *
     * 注意不能放进 scheduleNext()：闹钟自己触发时也会走那里，此时 KEY_NEXT_AT
     * 正好是刚刚响过的时间，会被误判成漏报。
     */
    fun detectMissedAlarm(context: Context) {
        val scheduled = nextReminderAt(context)
        if (scheduled <= 0L) return
        // 这条排期的漏报用户已经看过并确认过。KEY_NEXT_AT 不清（今日页还要显示
        // 下一杯），所以必须在这里显式跳过——否则 force-stop 后 cleared=true
        // 会让同一个 scheduled 在每次 schedule() 时被重新写回，弹窗刚关又弹。
        // 只挡 <= ack 的排期；重排推进到未来后的新漏报不受影响。
        if (scheduled <= missedAckAt(context)) return
        val now = System.currentTimeMillis()
        val last = lastReminderAt(context)
        val cleared = !pendingAlarmAlive(context)

        // 判据从「排期超期 + 句柄被清」改成更硬的「排期已过 + 账本没推进」。
        //
        // 账本 lastReminderAt 只在提醒真正投递后才写（见 onReceive：delivered 才
        // markReminder）。如果排期时刻已经过去、而账本还停在更早的一次，就说明那次
        // 闹钟没有兑现——不管 PendingIntent 是否还在。这解决了两类旧判据的漏判：
        //   1. 开了「后台运行」时 ColorOS 划掉未必清 PendingIntent，cleared=false
        //      被误判成没漏；
        //   2. 旧判据用「间隔+5分」宽限，划掉时排期还在未来，等一会儿重开仍不超期。
        // 排期已过留 2 分钟抖动余量，避免刚过点就误判。
        val schedulePassed = scheduled < now - 2 * 60_000L
        //
        // 「这次有没有兑现」看的是账本相对排期的落后量，不能用固定 2 分钟：
        //   - 排期刚排好还没到点：last = 上次投递时刻，scheduled = last + gap，
        //     落后量 ≈ 1 个 gap；
        //   - 这次真的兑现了：markReminder 把账本写到投递时刻（≈排期），
        //     落后量 ≈ 0；
        //   - 这次排了却没响：账本停在更早一次，落后量仍 ≈ 1 个 gap。
        // 所以判据是「落后量达到约一个 gap」，阈值取 gap 的一半。
        // 旧的 `last < scheduled - 2min` 在 gap=1 测试档下（落后仅 60 秒）永远
        // 为 false——哪怕杀掉后隔很久重开也判不出漏报，这正是真机复现的 bug。
        val gapMs = gapMinutes(context) * 60_000L
        val notDelivered = (scheduled - last) >= gapMs / 2
        val missed = (schedulePassed && notDelivered) || cleared

        if (!missed) {
            // 本轮没有新漏报：保留已有记录，不动它。清账只交给两个明确事件——
            // 提醒真正送达（onReceive delivered）与用户看过弹窗后确认
            // （clear_missed_alarm 命令）。
            //
            // 这里绝不能再 clearMissedAlarm：本函数挂在每次 schedule() 上，而
            // 冷启动/重排后 scheduled 已被 scheduleNext 推到未来、PendingIntent
            // 也已重建，紧随其后的下一次 schedule() 必然判定 !missed。若在此清账，
            // 刚写下的漏报证据会在前端 readDiagnostics 之前被抹掉，弹窗永不出现。
            return
        }
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_MISSED_AT, scheduled)
            .putBoolean(KEY_ALARM_CLEARED, cleared)
            .apply()
        Log.w(
            TAG,
            "检测到提醒中断：排期=${SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(scheduled)}，" +
                "账本=${SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(last)}，" +
                "排期已过=$schedulePassed，账本未推进=$notDelivered，句柄被清=$cleared"
        )
    }

    fun isPaused(context: Context): Boolean =
        config(context)?.optJSONObject("general")?.optBoolean("isPaused", false) ?: false

    fun cancel(context: Context) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        manager.cancel(alarmIntent(context, ACTION_REMINDER, ALARM_REQUEST_CODE))
        forgetNext(context)
    }

    private fun alarmIntent(context: Context, action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(action)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, requestCode, intent, flags)
    }

    /**
     * 以「上次提醒时间」为唯一锚点排下一次闹钟。
     *
     * 所有调用方（冷启动、配置变更、全屏关闭、闹钟触发、开机）都走这里，
     * 所以只要账本和配置没变，重复调用算出的绝对时间就完全一致，不会因为
     * 「什么时候调用了它」而漂移。`anchorMs` 只给首次安装等账本还不存在的
     * 场景用；缺省读共享账本。
     */
    fun scheduleNext(context: Context, anchorMs: Long? = null) {
        val root = config(context) ?: run {
            Log.w(TAG, "scheduleNext 跳过：SharedPreferences 里没有配置，说明 schedule 命令从未到达原生层")
            return
        }
        val alert = root.optJSONObject("alert") ?: JSONObject()
        val general = root.optJSONObject("general") ?: JSONObject()
        if (general.optBoolean("isPaused", false)) {
            cancel(context)
            return
        }

        // 兜底值与前端 DEFAULT_ALERT、Rust init_store 三处必须一致（20 分钟）。
        val gap = (alert.optString("gap", "20").toIntOrNull() ?: 20).coerceIn(1, 720)
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

        val now = System.currentTimeMillis()
        val rawAnchor = (anchorMs ?: lastReminderAt(context)).takeIf { it > 0 } ?: now
        // 账本可能停在很久以前（App 被关了几小时甚至几天）：仍沿 gap 网格
        // 追上当前时间，而不是退化成「现在 + gap」，这样节奏不会被打乱。
        val anchor = if (now - rawAnchor > 8L * 24 * 60 * 60_000) now else rawAnchor
        var candidateMs = anchor + gap * 60_000L
        while (candidateMs <= now) candidateMs += gap * 60_000L
        val candidate = Calendar.getInstance().apply { timeInMillis = candidateMs }

        // gap==1 是测试档：完全绕过工作日/提醒时段/勿扰，让任意时刻都能
        // 排到「now + 1 分钟」的闹钟，方便随时验证通知链路。否则当前时刻
        // 已过 18:00 时，闹钟会被一路推到次日 09:xx，等不到任何通知。
        val testMode = gap == 1
        var found = false
        // 最多向后找 8 天，覆盖「只在周一提醒」这类配置。
        var attempts = 0
        val maxAttempts = 8 * 24 * 60
        while (attempts < maxAttempts) {
            val weekday = candidate.get(Calendar.DAY_OF_WEEK) - 1 // 0 = 周日，与前端一致
            val minute = minutesOfDay(candidate)
            val inWorkTime = inWindow(minute, start, end)
            val inQuiet = quietEnabled && inWindow(minute, quietStart, quietEnd)
            if (testMode || (weekday in weekdays && inWorkTime && !inQuiet)) {
                found = true
                break
            }
            if (inWorkTime) {
                candidate.add(Calendar.MINUTE, gap)
            } else {
                // 时段外的候选点直接对齐到下一个时段起点，而不是继续沿 gap 网格
                // 硬走。网格锚在「上次提醒」上，一旦偏移出时段起点（如最后一杯
                // 落在 18:55、网格在 :05），整夜步进后次日第一个可提醒点会是
                // 08:05 而非时段起点 08:00，且这个偏移永远不自愈。对齐只发生在
                // 跨出时段时，当天时段内的提醒节奏不受影响。
                if (minute < start) {
                    candidate.set(Calendar.HOUR_OF_DAY, start / 60)
                    candidate.set(Calendar.MINUTE, start % 60)
                } else {
                    candidate.add(Calendar.DAY_OF_MONTH, 1)
                    candidate.set(Calendar.HOUR_OF_DAY, start / 60)
                    candidate.set(Calendar.MINUTE, start % 60)
                }
            }
            attempts += gap
        }
        if (!found) {
            // 当前配置下没有任何可提醒的时间：撤掉旧闹钟，也让今日页如实显示。
            Log.w(TAG, "scheduleNext 跳过：未来 8 天内没有落在提醒时段/工作日且避开勿扰的时刻")
            AnalyticsTracker.logScheduleFailed(context, "no_slot")
            cancel(context)
            return
        }

        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = alarmIntent(context, ACTION_REMINDER, ALARM_REQUEST_CODE)
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
        Log.i(
            TAG,
            "scheduleNext：下次闹钟 ${SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(candidate.time)}，" +
                "精确=${canExact}（Android 14+ 新装应用默认不授予 SCHEDULE_EXACT_ALARM）"
        )
        try {
            if (canExact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.timeInMillis, pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.timeInMillis, pending)
            }
        } catch (_: SecurityException) {
            Log.w(TAG, "setExact 被系统拒绝，降级为非精确闹钟")
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.timeInMillis, pending)
        }
        rememberNext(context, candidate.timeInMillis)
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
                        // 点击时刻：进程被杀时这批记录要等 App 重新启动才回灌，
                        // 不带时间就会被记成「打开 App 的那一刻」，明细时间全一样。
                        .put("timestamp", System.currentTimeMillis())
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
                AnalyticsTracker.logNotificationSkipped(context)
                cancelNotification(context)
                ReminderScheduler.scheduleNext(context)
            }
            action == ReminderScheduler.ACTION_DISMISS -> {
                // 只有超出抑制窗口的取消才算「用户划走」；App 自己 cancel 的
                // 广播在窗口内到达，直接忽略。
                val prefs = context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
                val suppressUntil = prefs.getLong(ReminderScheduler.KEY_DISMISS_SUPPRESS_UNTIL, 0L)
                if (System.currentTimeMillis() > suppressUntil) {
                    AnalyticsTracker.logNotificationDismissed(context)
                }
                prefs.edit().remove(ReminderScheduler.KEY_DISMISS_SUPPRESS_UNTIL).apply()
            }
            action.startsWith(ReminderScheduler.ACTION_DRINK_PREFIX) -> {
                val amount = action.removePrefix(ReminderScheduler.ACTION_DRINK_PREFIX).toIntOrNull()
                if (amount != null && amount > 0) {
                    // 通知 Action 是 WebView 不参与的一路，计数与事件都在这里落。
                    AnalyticsTracker.logNotificationDrink(context, amount.toLong())
                    ReminderScheduler.appendPendingDrink(context, amount)
                    // 先出声再撤通知：声音和「通知消失」几乎同时发生，反馈才连贯。
                    ReminderScheduler.playConfirmTone(context)
                    // 这一杯正好达标时立即补一条达标通知。否则要等下一个闹钟
                    // 周期才由兜底补发，最长会延迟一整个提醒间隔。
                    if (notifyGoalReached(context, "notification_action")) {
                        Log.i(ReminderScheduler.TAG, "通知栏记水达标：已发送达标通知")
                    }
                }
                cancelNotification(context)
                ReminderScheduler.scheduleNext(context)
            }
            else -> {
                val now = System.currentTimeMillis()
                val last = ReminderScheduler.lastReminderAt(context)
                val gapMs = ReminderScheduler.gapMinutes(context) * 60_000L
                Log.i(
                    ReminderScheduler.TAG,
                    "闹钟触发：距上次提醒 ${(now - last) / 60_000} 分钟 / 间隔阈值 ${gapMs / 60_000} 分钟"
                )
                // 前台 timer 刚弹过全屏并写了账本时，闹钟这一路不再补通知，
                // 避免「进 App 后通知 + 全屏同时弹」。首启/账本缺失时 last=0，
                // 视为该提醒一次，正常发通知并落账本。
                if (now - last >= gapMs) {
                    // 没有通知权限时不盖账本戳：notify() 会被系统静默丢弃，
                    // 若这里照旧落账本，用户打开 App 后前台 timer 会认为
                    // 「刚提醒过」，连全屏提醒都不补——提醒变成彻底静默的
                    // 失败。不盖章，让下次进 App 时补一次全屏提醒。
                    if (ReminderScheduler.canPostNotifications(context)) {
                        // 投递成功才盖账本：顺序反了会出现「账本说提醒过、用户
                        // 却一条都没看到」，这是后台静默失败最难查的一种。
                        val delivered = ReminderScheduler.shouldNotify(context) &&
                            showNotification(context, "alarm")
                        if (delivered) {
                            ReminderScheduler.markReminder(context)
                        } else if (notifyGoalReached(context)) {
                            Log.i(ReminderScheduler.TAG, "今日已达标：补发达标通知")
                        } else {
                            Log.i(ReminderScheduler.TAG, "不发通知：已暂停或今日饮水量已达标")
                        }
                    } else {
                        AnalyticsTracker.logNotificationBlocked(
                            context,
                            "alarm",
                            ReminderScheduler.blockReason(context)
                        )
                    }
                } else {
                    Log.i(ReminderScheduler.TAG, "不发通知：间隔内已提醒过（前台全屏承接）")
                }
                // 无论是否展示，都要安排下一次，保证达标/勿扰结束后能自动恢复。
                ReminderScheduler.scheduleNext(context)
            }
        }
    }

    private fun cancelNotification(context: Context) {
        // 先写抑制窗口再 cancel：cancel() 会触发 deleteIntent，不标记就会被
        // 当成「用户划走」多报一条 notification_dismissed。
        context.getSharedPreferences(ReminderPlugin.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(
                ReminderScheduler.KEY_DISMISS_SUPPRESS_UNTIL,
                System.currentTimeMillis() + 2000L
            )
            .apply()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(ReminderScheduler.NOTIFICATION_ID)
    }

    /**
     * 非 private：自定义插件的「测试通知」命令会复用同一条通知构建逻辑，
     * 保证测试通知与闹钟通知的图标、渠道、Action 完全一致。
     * 返回通知是否真正投递（POST_NOTIFICATIONS 被系统拒绝时为 false）。
     */
    /**
     * 达标后的收尾通知：一天最多一条。
     *
     * 为什么放在闹钟回调而不是 record_drink 之后：通知栏「喝了 Xml」由原生直接落盘，
     * WebView 根本没启动，前端那条 goalReached 分支永远走不到；全屏提醒、通知
     * Action 两条路径都必须由原生兜住。
     */
    private fun notifyGoalReached(context: Context, trigger: String = "alarm_fallback"): Boolean {
        if (!ReminderScheduler.alertsEnabled(context)) return false
        if (ReminderScheduler.goalNotifiedToday(context)) return false
        val progress = ReminderScheduler.goalProgress(context) ?: return false
        if (!ReminderScheduler.canPostNotifications(context)) return false
        if (!showGoalNotification(context, progress.first, progress.second, trigger)) return false
        ReminderScheduler.markGoalNotified(context)
        return true
    }

    /**
     * 非 private：自定义插件的 showGoalNotification 命令复用同一条构建逻辑，
     * 保证「App 前台记录达标」与「后台闹钟补发」两条路径的通知完全一致。
     */
    fun showGoalNotification(
        context: Context,
        total: Long,
        goal: Long,
        trigger: String = "unknown"
    ): Boolean {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // 跟随「提醒音效」开关：静音档走无声渠道，但横幅照旧。
        val channelId = ReminderScheduler.channelId(context)
        val soundEnabled = channelId == ReminderScheduler.CHANNEL_ID
        ReminderScheduler.ensureChannel(context, manager, channelId)

        val open = Intent(context, MainActivity::class.java).apply {
            // 不带 EXTRA_OPEN_REMINDER：达标后不该再弹全屏提醒。
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val content = PendingIntent.getActivity(context, 3, open, flags)

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_water)
            .setLargeIcon(BitmapFactory.decodeResource(context.resources, R.drawable.ic_notification_large))
            .setColor(0xFF10B981.toInt())
            .setContentTitle(AppStrings.goalTitle(context))
            .setContentText(AppStrings.goalText(context, total, goal))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // 状态类而不是提醒类：它不需要用户处理，只是告知。
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(content)
            .apply {
                if (soundEnabled) {
                    setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                        AudioManager.STREAM_NOTIFICATION
                    )
                    setVibrate(longArrayOf(0, 120, 90, 120))
                } else {
                    setSound(null)
                    setVibrate(longArrayOf(0, 100))
                }
            }

        return try {
            manager.notify(ReminderScheduler.GOAL_NOTIFICATION_ID, builder.build())
            Log.i(ReminderScheduler.TAG, "达标通知已投递：渠道=$channelId")
            AnalyticsTracker.logGoalNotification(context, trigger)
            true
        } catch (error: SecurityException) {
            Log.w(ReminderScheduler.TAG, "达标通知投递被拒绝（POST_NOTIFICATIONS 未授予）", error)
            false
        }
    }

    fun showNotification(context: Context, trigger: String = "alarm"): Boolean {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // 「提醒音效」开关：关掉后切到无声渠道，通知本身照常送达。
        val channelId = ReminderScheduler.channelId(context)
        val soundEnabled = channelId == ReminderScheduler.CHANNEL_ID

        // 渠道配置（重要度/锁屏可见性）决定横幅与锁屏内容，坏渠道在这里自愈。
        ReminderScheduler.ensureChannel(context, manager, channelId)

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

        // 用户划掉通知时系统发这条广播；用来补「未点击、未操作就忽略提醒」的埋点。
        val dismiss = Intent(context, ReminderReceiver::class.java)
            .setAction(ReminderScheduler.ACTION_DISMISS)
        val dismissIntent = PendingIntent.getBroadcast(context, 10, dismiss, flags)

        // 进度快照：通知里直接展示「已喝 / 目标」和比例条，用户不打开 App
        // 也能知道今天走到哪一步。未设置目标时不展示进度与副标题。
        val total = ReminderScheduler.todayAmount(context)
        val goal = ReminderScheduler.goalAmount(context)
        val ratio = if (goal > 0) (total.toDouble() / goal).coerceIn(0.0, 1.0) else 0.0

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_water)
            // 下拉大图标用桌面版「水」字 logo；状态栏小图标受系统限制只能单色剪影。
            .setLargeIcon(BitmapFactory.decodeResource(context.resources, R.drawable.ic_notification_large))
            .setColor(0xFF3B82F6.toInt())
            .setContentTitle(AppStrings.reminderTitle(context))
            // 正文按今日完成度从文案池随机取，连续两条不重复。
            .setContentText(ReminderCopy.pick(context, ratio))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // 锁屏显示完整标题+正文：NotificationCompat 默认是 PRIVATE，锁屏上只会
            // 留一句「内容已隐藏」，看起来和「没收到通知」没区别。渠道侧的
            // lockscreenVisibility 只是建议值，实际以通知自身为准，两者都要设。
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // 归类为提醒：让系统/ROM 按「提醒类」而非「普通消息」处理打断策略，
            // 也是各家 ROM 判定是否允许横幅、是否绕过勿扰的依据之一。
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setOnlyAlertOnce(false)
            .setAutoCancel(true)
            .setContentIntent(content)
            .setDeleteIntent(dismissIntent)
            .apply {
                if (goal > 0) {
                    // 达标前最多显示 99%：1999/2000 时向上取整成 100% 会显得「已达成」，
                    // 但达标通知并没有发，进度条也应该留一格。
                    val percent = if (total >= goal) 100 else (ratio * 100).toInt().coerceIn(0, 99)
                    // 副标题只有一行小字，手机窄屏下加「已喝」会被截断，
                    // 直接写「450 / 2000ml」；分母即目标，进度条负责表达比例。
                    setSubText("${total} / ${goal}ml · ${percent}%")
                    // 确定进度条由系统渲染在正文下方，百分比同时写进副标题。
                    setProgress(100, percent, false)
                }
            }
            // 声音/震动双保险：Android 8+ 官方以渠道为准，builder 上的设置会被忽略；
            // 但部分国产 ROM（含 ColorOS）实现有偏差，同时在 builder 上显式声明
            // 能让通知对象自身带齐 alert 属性，渠道正常时不冲突，渠道被降级时多一层兜底。
            // 注意绝不能用 setSilent——它会连横幅一起压掉（见下方说明）。
            .apply {
                // 与渠道层用同一个系统默认通知音 URI。
                val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                if (soundEnabled) {
                    // NotificationCompat.Builder.setSound 的第二参数是 stream type（Int），
                    // 不是 AudioAttributes（那是 8+ 的 Notification.Builder 才有）。
                    // 这里用通知流兜底；AudioAttributes 已在渠道层设好。
                    setSound(soundUri, AudioManager.STREAM_NOTIFICATION)
                    setVibrate(longArrayOf(0, 200, 120, 200))
                } else {
                    // 关音效不等于关提醒：保留短震动，只是不要声音。
                    setSound(null)
                    setVibrate(longArrayOf(0, 120))
                }
                // Android 7.x 无渠道，音效完全由 builder 决定。
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O && soundEnabled) {
                    setDefaults(NotificationCompat.DEFAULT_VIBRATE)
                }
            }

        // Android 一条通知最多显示 3 个操作按钮，多出来的会被系统直接丢弃。
        // 三档水量已占满名额，所以不放「稍后再说」——划掉通知本身就是忽略这一次。
        ReminderScheduler.drinkActions(context).forEachIndexed { index, amount ->
            // 收起态空间有限，动作一律用「+50ml」这种最省字的写法，
            // 一眼就能看出是「加记这么多水」。
            builder.addAction(
                R.drawable.ic_stat_water,
                "+${amount}ml",
                drinkAction(amount, 2 + index)
            )
        }

        val notification = builder.build()

        return try {
            manager.notify(ReminderScheduler.NOTIFICATION_ID, notification)
            Log.i(ReminderScheduler.TAG, "通知已投递：渠道=$channelId id=${ReminderScheduler.NOTIFICATION_ID}")
            AnalyticsTracker.logNotificationShown(context, trigger, soundEnabled)
            true
        } catch (error: SecurityException) {
            // 未授予 POST_NOTIFICATIONS：不能盖账本，交给前台全屏补偿。
            Log.w(ReminderScheduler.TAG, "通知投递被拒绝（POST_NOTIFICATIONS 未授予）", error)
            AnalyticsTracker.logNotificationFailed(context, trigger, "security_exception")
            false
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
