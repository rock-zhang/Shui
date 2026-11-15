package com.shui.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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
     * 前台「测试通知」走这里，而不是 plugin-notification：
     * tauri-plugin-notification 2.2.2 的 NotificationStorage.writeActionGroup
     * 用 `type.id`（字符串）拼 key 写入，getActionGroup 却用 0..count 读取，
     * 导致 Android 上注册的所有 Action 的 id/title 都是空串，点了不记水。
     * 自定义通道没有这个问题，且 App 被杀时也能记账。
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
