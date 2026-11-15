package com.shui.app

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
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

    @Command
    fun schedule(invoke: Invoke) {
        val config = invoke.getArgs().toString()
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CONFIG, config)
            .apply()
        ReminderScheduler.scheduleNext(activity)
        invoke.resolve()
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

    @Suppress("UNUSED_PARAMETER")
    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
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

        /**
         * 必须在主线程调用。manifest 的 configChanges 含 uiMode，系统切深浅色
         * 不会重建 Activity，AppCompat 可能按旧主题重绘系统栏；从系统设置页 /
         * 分享页返回时部分 ROM 也会重置。因此 onCreate / onResume /
         * onConfigurationChanged 各重应用一次，成本只是设两个颜色。
         */
        fun applySystemBarTheme(activity: Activity) {
            val color = ContextCompat.getColor(
                activity,
                if (systemBarDark) R.color.shui_surface_dark else R.color.shui_surface_light
            )
            val window = activity.window
            window.statusBarColor = color
            window.navigationBarColor = color
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
