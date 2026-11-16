package com.shui.app

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.content.Context
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
            ReminderReceiver().showNotification(activity)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("发送通知失败：${error.message}")
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

    companion object {
        const val PREFS = "shui_reminder"
        const val KEY_CONFIG = "config"

        /** 已发起过几次通知权限请求；用于区分「首次」与「永久拒绝」。 */
        const val KEY_NOTIFICATION_ASKED = "notification_asked_count"
        const val EXTRA_OPEN_REMINDER = "openReminder"

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
