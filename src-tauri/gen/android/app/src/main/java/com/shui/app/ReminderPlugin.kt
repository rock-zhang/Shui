package com.shui.app

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File

/**
 * Tauri 自定义 Android 插件：桥接 Rust command 与系统能力。
 *
 *  - schedule / cancel     : AlarmManager 精确闹钟（后台保底通道）
 *  - openBatterySettings   : 引导关闭电池优化
 *  - shareFile             : CSV / JSON 备份通过系统分享出去
 *  - pickBackup            : SAF 选择备份，复制到缓存后把真实路径交回 Rust
 */
@TauriPlugin
class ReminderPlugin(private val activity: Activity) : Plugin(activity) {

    private var webView: WebView? = null

    init {
        instance = this
    }

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        // 冷启动时 WebView 还没执行到 JS 的监听注册，延后一拍再投事件；
        // 即使这一步丢了，前端启动/恢复时还会主动查询 reminderPending。
        pendingIntent?.let { intent ->
            Handler(Looper.getMainLooper()).postDelayed({
                if (reminderPending && pendingIntent === intent) deliverIntent(intent)
            }, 900)
        }
    }

    override fun onNewIntent(intent: Intent) {
        deliverIntent(intent)
    }

    /**
     * Plugin.trigger() 只发给 registerListener 注册的 Channel，
     * 不会进入 Tauri 全局事件总线，JS 的 listen("mobile-reminder") 收不到。
     * 改用 WebView 直接派发 DOM 事件，JS 收到后去 Rust 侧消费 pending 标志。
     */
    private fun dispatchCheckReminder() {
        Handler(Looper.getMainLooper()).post {
            webView?.evaluateJavascript(
                "window.dispatchEvent(new Event('shui:check-reminder'));",
                null
            )
        }
    }

    /**
     * Activity 回到前台时通知 Web 端。从系统设置页、系统确认弹窗（如电池优化
     * 的「允许/不允许」）返回时，Android WebView 未必派发 visibilitychange
     * ——visibilityState 很可能一直是 visible，前端靠事件刷新权限状态会漏，
     * 表现为开关点了允许仍旧停在「关」。这里由原生侧主动派发。
     */
    private fun dispatchForeground() {
        Handler(Looper.getMainLooper()).post {
            webView?.evaluateJavascript(
                "window.dispatchEvent(new Event('shui:foreground'));",
                null
            )
        }
    }

    /**
     * 把 Rust 侧的最新配置写进 SharedPreferences，返回排期锚点。
     * 原生通知/音效/目标判断都读这份快照，所以每次配置变更都必须更新它。
     */
    private fun storeConfig(args: JSONObject): Long {
        val anchor = args.optLong("anchorMs", 0L)
        // anchorMs 只参与排期，不写进配置，避免 SharedPreferences 里留下一份
        // 会被下一次调度误读的旧锚点。
        args.remove("anchorMs")
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CONFIG, args.toString())
            .apply()
        return anchor
    }

    @Command
    fun schedule(invoke: Invoke) {
        // 必须在 storeConfig / scheduleNext 覆盖 KEY_NEXT_AT 之前读旧值，
        // 否则「上一轮闹钟被 ROM 清掉」的证据就没了。
        ReminderScheduler.detectMissedAlarm(activity)
        val payload = JSONObject(invoke.getArgs().toString())
        val anchor = storeConfig(payload)
        // 这条日志是「闹钟到底有没有被排上」的唯一入口判据：没有它就只能靠猜。
        Log.i(ReminderScheduler.TAG, "收到 schedule 命令，配置=${payload.toString().take(400)}")
        ReminderScheduler.scheduleNext(activity, anchor.takeIf { it > 0 })
        invoke.resolve()
    }

    /** 只同步配置（音效/通知/目标等），不重排闹钟。 */
    @Command
    fun saveConfig(invoke: Invoke) {
        storeConfig(JSONObject(invoke.getArgs().toString()))
        invoke.resolve()
    }

    /**
     * Rust 前台计时到点后由原生裁决提醒通道：
     * 只有「App 在前台 + 亮屏 + 未锁屏」才允许 WebView 弹全屏，
     * 其余情况直接走通知，避免全屏页在解锁后才迟到弹出。
     */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun deliverReminder(invoke: Invoke) {
        val mode = ReminderScheduler.deliverForeground(activity)
        Log.i(ReminderScheduler.TAG, "Rust 到点裁决结果=$mode")
        val payload = JSObject()
        payload.put("mode", mode)
        invoke.resolve(payload)
    }

    /** 今日页「预计下一杯」：直接读原生已排定的绝对时间。 */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun nextReminder(invoke: Invoke) {
        val payload = JSObject()
        payload.put("nextAt", ReminderScheduler.nextReminderAt(activity))
        payload.put("paused", ReminderScheduler.isPaused(activity))
        invoke.resolve(payload)
    }

    @Command
    fun cancel(invoke: Invoke) {
        ReminderScheduler.cancel(activity)
        invoke.resolve()
    }

    /**
     * 前台「测试通知」与后台闹钟共用这一条自定义通道，保证图标、渠道、
     * 三档 Action 完全一致，且点 Action 时静默落盘、不拉起 App，进程被杀后也能记账。
     *
     * 注：plugin-notification 2.2.2 的 writeActionGroup 曾按 type.id 拼 key 写入
     * （读侧按 0..count），导致 Action 的 id/title 为空；该缺陷已在 2.4.0 修复。
     * 升级到 2.8.1+ 后可评估切回官方通道，但官方 Action 基于 getActivity，
     * 点击会拉起界面且依赖 WebView 启动后的 onAction 回调，行为并不等价。
     */
    @Command
    fun showNotification(invoke: Invoke) {
        try {
            ReminderReceiver().showNotification(activity, "test")
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("发送通知失败：${error.message}")
        }
    }

    /**
     * 达成每日目标后的系统通知。
     *
     * 只在 Android 上有意义：桌面端走 plugin-notification 的 sendNotification，
     * 手机端过去只有一条 App 内 toast，App 在后台或从通知里记的那杯水永远等不到
     * 任何反馈。这条命令补上前台路径；后台路径由闹钟回调里的 notifyGoalReached 兜。
     */
    @Command
    fun showGoalNotification(invoke: Invoke) {
        try {
            val args = JSONObject(invoke.getArgs().toString())
            val total = args.optLong("total", 0L)
            val goal = args.optLong("goal", 0L)
            if (goal <= 0) {
                invoke.reject("目标值无效，无法生成达标通知")
                return
            }
            val delivered = ReminderReceiver().showGoalNotification(activity, total, goal, "foreground_record")
            // 发出去才记「今天已播报」，否则闹钟那一路还能再补一次。
            if (delivered) ReminderScheduler.markGoalNotified(activity)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("发送达标通知失败：${error.message}")
        }
    }

    /**
     * 旧实现把 startActivity 的异常全部吞掉后仍然 resolve：某些 ROM 上
     * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 静默不显示任何界面，
     * 前端便看不到任何反馈，表现成「按钮点了没反应」。
     * 现在先检查白名单状态，再按可用性依次降级，并把结果回传给前端。
     */
    @Command
    fun openBatterySettings(invoke: Invoke) {
        val power = activity.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val alreadyIgnored = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            power?.isIgnoringBatteryOptimizations(activity.packageName) == true
        val result = if (alreadyIgnored) {
            // 已加入白名单时也打开列表页：前端开关点下去要能进到设置里撤销或确认。
            val listIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            if (listIntent.resolveActivity(activity.packageManager) != null) {
                try {
                    listIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(listIntent)
                } catch (_: Exception) {
                    // 打不开就算了，状态仍是 already。
                }
            }
            "already"
        } else {
            val candidates = listOf(
                "requested" to Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:${activity.packageName}")
                },
                "list" to Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
                "details" to Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${activity.packageName}")
                }
            )
            var opened: String? = null
            for ((name, intent) in candidates) {
                if (intent.resolveActivity(activity.packageManager) == null) continue
                try {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(intent)
                    opened = name
                    break
                } catch (_: Exception) {
                    // 换下一种入口，最后一档「应用详情」在所有 ROM 上都存在。
                }
            }
            opened ?: "unavailable"
        }
        val payload = JSObject()
        payload.put("result", result)
        // resolve(JSObject) 走 PluginResult 的标准 JSON 路径；resolveObject 会
        // 用 Jackson 序列化 org.json.JSONObject，字段结构不可控。
        invoke.resolve(payload)
    }

    /** 电池优化白名单状态；已加入白名单（不受后台冻结）返回 granted=true。 */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun isBatteryOptimizationIgnored(invoke: Invoke) {
        val power = activity.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val ignored = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            power?.isIgnoringBatteryOptimizations(activity.packageName) == true
        val payload = JSObject()
        payload.put("granted", ignored)
        invoke.resolve(payload)
    }

    /**
     * 通知权限已开启时用户仍可能想调整或关闭，直接打开本应用的通知设置页；
     * 部分 ROM 没有该页时回退到应用详情。
     */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun openNotificationSettings(invoke: Invoke) {
        openAppNotificationSettings()
        invoke.resolve()
    }

    private fun openAppNotificationSettings() {
        val candidates = mutableListOf<Intent>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            candidates += Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            }
        }
        candidates += Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${activity.packageName}")
        }
        for (intent in candidates) {
            if (intent.resolveActivity(activity.packageManager) == null) continue
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(intent)
                break
            } catch (_: Exception) {
                // 换下一个入口。
            }
        }
    }

    /**
     * 直达「喝水提醒」这个渠道本身的通知设置页。
     *
     * 横幅（「允许横幅」）和锁屏显示（「在锁屏上显示」）都是渠道级开关，
     * 系统没有 API 可以读或写，只能把用户送到这一页；渠道不存在时该页面
     * 打不开，所以先确保渠道已创建。
     */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun openNotificationChannelSettings(invoke: Invoke) {
        val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = ReminderScheduler.channelId(activity)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ReminderScheduler.ensureChannel(activity, manager, channelId)
            val intent = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
                putExtra(Settings.EXTRA_CHANNEL_ID, channelId)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                activity.startActivity(intent)
                invoke.resolve()
                return
            } catch (_: Exception) {
                // 个别 ROM 没有渠道级设置页，退回应用通知页。
            }
        }
        openAppNotificationSettings()
        invoke.resolve()
    }

    /**
     * 通知链路的可读状态汇总，供前端做「通知体检」。
     *
     * 能自动判定的：应用级通知开关、渠道重要度（决定横幅）、渠道锁屏可见性。
     * 判定不了的：系统「锁屏通知 → 显示所有内容」总开关、以及各家 ROM 的
     * 「允许横幅」「后台弹出界面」等私有开关——这些没有公开 API，只能引导用户
     * 去对应设置页确认。
     */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun getNotificationHealth(invoke: Invoke) {
        val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = ReminderScheduler.channelId(activity)
        // 这里是「读状态」，绝不能顺手 createNotificationChannel：buildChannel 带的是
        // 默认 importance/震动/铃声，国产 ROM（ColorOS 实测）对已存在渠道也会用传入
        // 参数覆盖用户在系统设置里刚改的震动/声音，导致每次读回的都是默认值——表现
        // 就是「改了震动回来，体检卡永远不变，连手动刷新都不变」。渠道在 App 启动
        // （MainActivity.ensureChannels）与发通知时已经建好，读的时候只需如实读取。
        val channel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.getNotificationChannel(channelId)
        } else {
            null
        }
        val importance = channel?.importance ?: -1
        val lockscreen = channel?.lockscreenVisibility ?: -1
        val osHasChannels = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        // 渠道声音/震动的**真实配置**：ColorOS 17 会在渠道建好后把 sound 置空、
        // 关掉震动、把 importance 从 HIGH 偷偷降到 DEFAULT（伪装成用户操作），
        // 结果就是「下拉有、没声音、没震动、没横幅」。这三个都是公开 API 可读，
        // 读出来才能把「系统偷偷改了」这件事暴露给用户，而不是让他猜。
        val channelSound = if (osHasChannels && channel != null) channel.sound != null else true
        val channelVibration = if (osHasChannels && channel != null) channel.shouldVibrate() else true
        // 我们请求的是 IMPORTANCE_HIGH(4)；只要落在 1..3 就是被系统或用户调低了，
        // Android 不允许应用改回，只能引导用户在系统设置里手动调回「紧急」。
        val downgraded = osHasChannels && importance in 1 until NotificationManager.IMPORTANCE_HIGH

        val payload = JSObject()
        payload.put("channelId", channelId)
        payload.put("channelExists", channel != null)
        payload.put("channelImportance", importance)
        payload.put("channelLockscreen", lockscreen)
        payload.put("channelSound", channelSound)
        payload.put("channelVibration", channelVibration)
        payload.put("channelDowngraded", downgraded)
        // 横幅硬条件：渠道重要度 >= HIGH。Android 7.x 没有渠道，由
        // priority=HIGH 与声音/震动决定，视为可用。
        payload.put("headsUp", if (osHasChannels) {
            importance >= NotificationManager.IMPORTANCE_HIGH
        } else {
            true
        })
        payload.put("lockscreenPublic", if (osHasChannels) {
            lockscreen == Notification.VISIBILITY_PUBLIC
        } else {
            true
        })
        payload.put("notificationsEnabled",
            NotificationManagerCompat.from(activity).areNotificationsEnabled())
        payload.put("soundEnabled", ReminderScheduler.isSoundEnabled(activity))
        // 兜底通道的两道系统开关：缺任何一个，锁屏/杀进程后就可能收不到。
        val power = activity.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val alarm = activity.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        payload.put("exactAlarm", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarm?.canScheduleExactAlarms() == true
        } else {
            true
        })
        payload.put("batteryIgnored", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            power?.isIgnoringBatteryOptimizations(activity.packageName) == true)
        payload.put("manufacturer", Build.MANUFACTURER ?: "")
        payload.put("brand", Build.BRAND ?: "")
        payload.put("sdkInt", Build.VERSION.SDK_INT)
        invoke.resolve(payload)
    }

    /**
     * 「一键修复」：删除并按正确配置重建两个提醒渠道。
     *
     * 渠道的 importance 创建后应用无法修改，历史版本若用低重要度建过，
     * 用户就永远没有横幅——只能删除重建。这是唯一能由代码自愈的一条，
     * 其余（系统锁屏总开关、厂商自启动）只能引导。
     */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun repairNotificationChannels(invoke: Invoke) {
        val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ReminderScheduler.repairChannels(activity, manager)
        Log.i(ReminderScheduler.TAG, "已按 IMPORTANCE_HIGH + VISIBILITY_PUBLIC 重建提醒渠道")
        invoke.resolve()
    }

    /**
     * 自启动 / 后台运行管理页。各厂商是私有页面，没有统一规范，按品牌逐个
     * 试探；全部不存在时落到应用详情页（所有 ROM 都有）。
     *
     * 不用 resolveActivity 预判：Android 11+ 的包可见性限制会让它在没声明
     * <queries> 时一律返回 null，误判成「不存在」。直接 startActivity 并捕获
     * ActivityNotFoundException 更可靠（manifest 里也补了 queries 声明）。
     */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun openAutoStartSettings(invoke: Invoke) {
        for (intent in autoStartIntents()) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(intent)
                invoke.resolve()
                return
            } catch (_: Exception) {
                // 该机型没有这个页面，继续试下一个。
            }
        }
        if (!startApplicationDetails()) {
            invoke.reject("无法打开后台管理设置，请到系统设置中手动开启自启动")
            return
        }
        invoke.resolve()
    }

    private fun component(pkg: String, cls: String) =
        Intent().setComponent(ComponentName(pkg, cls))

    private fun autoStartIntents(): List<Intent> {
        val manufacturer = (Build.MANUFACTURER ?: "").lowercase()
        val brand = (Build.BRAND ?: "").lowercase()
        fun isOneOf(vararg keys: String) =
            keys.any { manufacturer.contains(it) || brand.contains(it) }

        return buildList {
            when {
                isOneOf("xiaomi", "redmi", "poco") -> {
                    add(component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
                }
                isOneOf("huawei", "honor") -> {
                    add(component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"))
                    add(component("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"))
                }
                isOneOf("oppo", "realme", "oneplus") -> {
                    add(component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"))
                    add(component("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"))
                    add(component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"))
                }
                isOneOf("vivo", "iqoo") -> {
                    add(component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"))
                    add(component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"))
                }
                isOneOf("meizu") ->
                    add(component("com.meizu.safe", "com.meizu.safe.security.SecureMainActivity"))
                isOneOf("samsung") ->
                    add(component("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"))
            }
            // 通用候选：部分 ROM 的自启动管理挂在安全中心里，与品牌无关。
            add(component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
            add(component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"))
            add(component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"))
        }
    }

    private fun startApplicationDetails(): Boolean {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${activity.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            activity.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * 真机诊断：一次性返回所有决定「提醒能否准时到达」的原生状态。
     * App 内拿不到系统对闹钟的具体 adjustment（那是 dumpsys alarm 的内部字段），
     * 但能判断是否处于 Doze、是否在电池优化白名单、通知权限、闹钟排期——
     * 这些足以在真机上定位国产 ROM 的冻结问题。
     * 注意：国产 ROM 的「完全允许后台行为」是厂商私有设置，无公开 API 可读，
     * 只能引导用户在系统设置里手动开启。
     */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun getDiagnostics(invoke: Invoke) {
        val power = activity.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val alarm = activity.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

        val payload = JSObject()
        payload.put("now", System.currentTimeMillis())
        payload.put("nextAt", ReminderScheduler.nextReminderAt(activity))
        payload.put("lastReminderAt", ReminderScheduler.lastReminderAt(activity))
        payload.put("gapMinutes", ReminderScheduler.gapMinutes(activity))
        // 精确闹钟权限
        val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarm?.canScheduleExactAlarms() == true
        } else {
            true
        }
        payload.put("exactAlarm", canExact)
        // 电池优化白名单
        val batteryIgnored = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            power?.isIgnoringBatteryOptimizations(activity.packageName) == true
        payload.put("batteryIgnored", batteryIgnored)
        // 设备 Doze 状态（深睡时 ROM 更容易冻结进程）
        val dozing = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            power?.isDeviceIdleMode == true
        } else {
            false
        }
        payload.put("dozing", dozing)
        payload.put("interactive", power?.isInteractive == true)
        // 通知权限 + 渠道是否被关
        payload.put("notificationsEnabled",
            androidx.core.app.NotificationManagerCompat.from(activity).areNotificationsEnabled())
        val channel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm?.getNotificationChannel(ReminderScheduler.CHANNEL_ID)
        } else null
        payload.put("channelImportance", channel?.importance ?: -1)
        // 上一次「排了却没响」的闹钟时刻，前端据此提示去开后台运行。
        payload.put("missedAlarmAt", ReminderScheduler.missedAlarmAt(activity))
        // 上次冷启动时的快照：闹钟句柄是否已被 force-stop 删除。
        // 用快照而不是实时查，因为启动时已经重排过，实时查永远是「还在」。
        payload.put("alarmCleared", ReminderScheduler.alarmHandleWasCleared(activity))
        payload.put("appVersion", appVersion())
        invoke.resolve(payload)
    }

    /** 用户看过漏提醒提示后调它，避免同一条记录反复顶在今日页。 */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun clearMissedAlarm(invoke: Invoke) {
        ReminderScheduler.clearMissedAlarm(activity)
        invoke.resolve()
    }

    private fun appVersion(): String = try {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "?"
    } catch (_: Exception) {
        "?"
    }

    /** 直达本应用详情页：国产 ROM 的自启动 / 后台运行 / 省电策略都在这里设。 */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun openAppSettings(invoke: Invoke) {
        if (!startApplicationDetails()) {
            invoke.reject("无法打开应用设置")
            return
        }
        invoke.resolve()
    }

    /** 供 Rust 侧消费「通知点击待弹提醒」标志，保证冷/热启动只弹一次。 */
    @Command
    fun consumePendingReminder(invoke: Invoke) {
        val pending = reminderPending
        reminderPending = false
        if (pending) pendingIntent = null
        val payload = JSObject()
        payload.put("pending", pending)
        invoke.resolve(payload)
    }

    @Command
    fun shareFile(invoke: Invoke) {
        val args = invoke.getArgs()
        val path = args.optString("path", "")
        val mime = args.optString("mime", "application/octet-stream")
        val file = File(path)
        if (path.isEmpty() || !file.exists()) {
            invoke.reject("要分享的文件不存在")
            return
        }
        try {
            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file
            )
            val share = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(share, "分享 Shui 文件"))
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("分享失败：${error.message}")
        }
    }

    @Command
    fun pickBackup(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("application/json", "text/plain", "application/octet-stream")
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        try {
            startActivityForResult(invoke, intent, "pickBackupResult")
        } catch (error: Exception) {
            invoke.reject("无法打开系统文件选择器：${error.message}")
        }
    }

    @ActivityCallback
    fun pickBackupResult(invoke: Invoke, result: ActivityResult) {
        val uri: Uri? = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolveObject("")
            return
        }
        try {
            val dir = File(activity.cacheDir, "imports").apply { mkdirs() }
            val out = File(dir, "shui-import-${System.currentTimeMillis()}.json")
            activity.contentResolver.openInputStream(uri)?.use { input ->
                out.outputStream().use { target -> input.copyTo(target) }
            } ?: run {
                invoke.reject("无法读取所选文件")
                return
            }
            invoke.resolveObject(out.absolutePath)
        } catch (error: Exception) {
            invoke.reject("读取备份失败：${error.message}")
        }
    }

    /**
     * 系统栏颜色与图标明暗跟随 App 内主题（next-themes 的 resolvedTheme），
     * 而不是只跟随系统深浅色：用户在 App 里手动选「深色」但系统是亮色时，
     * 仅靠 values-night 资源是错的一档。
     */
    @Command
    fun setSystemBarTheme(invoke: Invoke) {
        val dark = invoke.getArgs().optBoolean("dark", false)
        systemBarThemeFromWeb = true
        systemBarDark = dark
        activity.runOnUiThread { applySystemBarTheme(activity) }
        invoke.resolve()
    }

    /**
     * 通知权限的真实状态，附带「系统是否还会弹授权框」。
     *
     * Android 13+ 里用户拒绝两次后系统永久静默拒绝：requestPermissions 不再
     * 显示任何对话框，直接回调 denied。此时只能引导用户去系统设置手动开。
     * 区分「首次请求」和「永久拒绝」靠 shouldShowRequestPermissionRationale
     * 不够——两者都返回 false——所以额外用 SharedPreferences 记请求次数。
     */
    @Command
    fun notificationPermissionState(invoke: Invoke) {
        val granted: Boolean
        val canRequest: Boolean
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // 13 以下没有运行时通知权限，但用户仍能在系统设置里整体关闭通知，
            // areNotificationsEnabled 才是真实状态。
            granted = NotificationManagerCompat.from(activity).areNotificationsEnabled()
            canRequest = false
        } else {
            granted = NotificationManagerCompat.from(activity).areNotificationsEnabled()
            val asked = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getInt(KEY_NOTIFICATION_ASKED, 0)
            val rationale = ActivityCompat.shouldShowRequestPermissionRationale(
                activity,
                Manifest.permission.POST_NOTIFICATIONS
            )
            // 从未请求过 → 系统还会弹；请求过但 rationale 为 true → 只是拒过一次，仍会弹。
            canRequest = !granted && (asked == 0 || rationale)
        }
        val payload = JSObject()
        payload.put("granted", granted)
        payload.put("canRequest", canRequest)
        invoke.resolve(payload)
    }

    @Suppress("UNUSED_PARAMETER")
    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            // 记录来源，供 onRequestPermissionsResult 关联（引导/提示卡/体检卡）。
            permissionRequestSource = invoke.getArgs().optString("source", "unknown")
            val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            prefs.edit()
                .putInt(KEY_NOTIFICATION_ASKED, prefs.getInt(KEY_NOTIFICATION_ASKED, 0) + 1)
                .apply()
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                1001
            )
        }
        invoke.resolve()
    }

    /**
     * Android 12+ (API 31) 起，setExact 需要 ACTION_REQUEST_SCHEDULE_EXACT_ALARM
     * 特殊权限。未授权时调度器只能降级到非精确闹钟，Doze / 国产 ROM 下会被
     * 大幅延迟甚至不触发——这正是「后台收不到通知」的主因之一。低版本恒为 true。
     */
    @Suppress("UNUSED_PARAMETER")
    @Command
    fun isExactAlarmGranted(invoke: Invoke) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = activity.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            manager?.canScheduleExactAlarms() == true
        } else {
            true
        }
        val payload = JSObject()
        payload.put("granted", granted)
        invoke.resolve(payload)
    }

    @Suppress("UNUSED_PARAMETER")
    @Command
    fun openExactAlarmSettings(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                    data = Uri.parse("package:${activity.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                if (intent.resolveActivity(activity.packageManager) != null) {
                    activity.startActivity(intent)
                }
            } catch (_: Exception) {
                // 部分 ROM 无此设置页，前端提示用户手动开启。
            }
        }
        invoke.resolve()
    }

    // ───────────────────────── Firebase 埋点桥 ─────────────────────────

    @Command
    fun logAnalyticsEvent(invoke: Invoke) {
        val args = invoke.getArgs()
        AnalyticsTracker.logEvent(
            activity,
            args.optString("name", ""),
            args.optJSONObject("params")
        )
        invoke.resolve()
    }

    @Suppress("UNUSED_PARAMETER")
    @Command
    fun syncAnalyticsProperties(invoke: Invoke) {
        AnalyticsTracker.syncProperties(activity)
        invoke.resolve()
    }

    @Suppress("UNUSED_PARAMETER")
    @Command
    fun analyticsIsEnabled(invoke: Invoke) {
        val payload = JSObject()
        payload.put("enabled", AnalyticsTracker.isEnabled(activity))
        invoke.resolve(payload)
    }

    @Command
    fun setAnalyticsEnabled(invoke: Invoke) {
        AnalyticsTracker.setEnabled(activity, invoke.getArgs().optBoolean("enabled", true))
        invoke.resolve()
    }

    @Command
    fun recordAnalyticsException(invoke: Invoke) {
        val args = invoke.getArgs()
        AnalyticsTracker.recordException(
            args.optString("message", ""),
            args.optString("stack", ""),
            args.optString("screen", "")
        )
        invoke.resolve()
    }

    companion object {
        const val PREFS = "shui_reminder"
        const val KEY_CONFIG = "config"

        /** 已发起过几次通知权限请求；用于区分「首次」与「永久拒绝」。 */
        const val KEY_NOTIFICATION_ASKED = "notification_asked_count"
        const val EXTRA_OPEN_REMINDER = "openReminder"

        /** 最近一次通知权限请求的来源，供授权回调上报结果时使用。 */
        @Volatile
        var permissionRequestSource: String = "unknown"

        @Volatile
        var instance: ReminderPlugin? = null

        @Volatile
        var pendingIntent: Intent? = null

        /** 只有真正由通知主体点进来的 Intent 才置位。 */
        @Volatile
        var reminderPending = false

        /** Web 端是否已锁定主题；false 时按系统 uiMode 走。 */
        @Volatile
        var systemBarThemeFromWeb = false

        @Volatile
        var systemBarDark = false

        fun isNightMode(configuration: Configuration): Boolean =
            (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                Configuration.UI_MODE_NIGHT_YES

        /** 供 MainActivity.onResume 调用；WebView 未就绪时静默跳过。 */
        fun notifyForeground() {
            instance?.dispatchForeground()
        }

        /** 供通道裁决读取窗口焦点状态；插件未加载时返回 null（视为后台）。 */
        fun currentActivity(): Activity? = instance?.activity

        /**
         * 必须在主线程调用。manifest 的 configChanges 含 uiMode，系统切深浅色
         * 不会重建 Activity，AppCompat 可能按旧主题重绘系统栏；从系统设置页 /
         * 分享页返回时部分 ROM 也会重置。因此 onCreate / onResume /
         * onConfigurationChanged 各重应用一次，成本只是设一次背景与图标明暗。
         */
        fun applySystemBarTheme(activity: Activity) {
            val color = ContextCompat.getColor(
                activity,
                if (systemBarDark) R.color.shui_surface_dark else R.color.shui_surface_light
            )
            val window = activity.window
            // targetSdk 36 + Android 15+：系统栏强制透明，statusBarColor /
            // navigationBarColor 的赋值会被忽略。透过半透明系统栏看到的是
            // 窗口背景，所以这里改窗口背景色，保证栏底和 Web 页面同色。
            window.setBackgroundDrawable(ColorDrawable(color))
            // 图标明暗仍然由 insets controller 决定，与系统深浅色无关。
            WindowInsetsControllerCompat(window, window.decorView).apply {
                isAppearanceLightStatusBars = !systemBarDark
                isAppearanceLightNavigationBars = !systemBarDark
            }
            // API 29+ 会给浅色系统栏压一层半透明遮罩，会把纯白染成灰白。
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.isStatusBarContrastEnforced = false
                window.isNavigationBarContrastEnforced = false
            }
        }

        fun holdReminderIntent(intent: Intent?) {
            if (intent?.getBooleanExtra(EXTRA_OPEN_REMINDER, false) == true) {
                reminderPending = true
                pendingIntent = intent
            }
        }

        fun deliverIntent(intent: Intent?) {
            holdReminderIntent(intent)
            if (reminderPending) instance?.dispatchCheckReminder()
        }
    }
}
