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

    init {
        instance = this
    }

    override fun load(webView: WebView) {
        super.load(webView)
        pendingIntent?.let { intent ->
            Handler(Looper.getMainLooper()).postDelayed({
                deliverIntent(intent)
                if (pendingIntent === intent) pendingIntent = null
            }, 900)
        }
    }

    override fun onNewIntent(intent: Intent) {
        deliverIntent(intent)
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

    @Command
    fun openBatterySettings(invoke: Invoke) {
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${activity.packageName}")
            }
            activity.startActivity(intent)
        } catch (_: Exception) {
            try {
                activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (_: Exception) {
                // 部分 ROM 没有该设置页，交由前端 toast 提示手动路径。
            }
        }
        invoke.resolve()
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

        fun deliverIntent(intent: Intent?) {
            if (intent?.getBooleanExtra(EXTRA_OPEN_REMINDER, false) != true) return
            intent.removeExtra(EXTRA_OPEN_REMINDER)
            Handler(Looper.getMainLooper()).post {
                instance?.trigger("mobile-reminder", JSObject())
            }
        }
    }
}
