package com.shui.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import android.webkit.WebView
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 侧载专用自更新插件：只在 SHUI_VARIANT=sideload 时编译进包。
 *
 * Play 变体里这个类根本不存在——Gradle 的 sideload sourceSet 未加入编译，
 * Rust 侧也不注册对应插件。这样 REQUEST_INSTALL_PACKAGES + 安装 Intent
 * 这整套敏感能力不会出现在提交给 Google Play 的产物里。
 *
 * 为什么网络放在 Kotlin 而不是 Rust：Android 自带 JVM HTTP 栈与系统证书库，
 * 走 HttpURLConnection 无需引入 rustls/aws-lc-sys（后者要 C 交叉编译器，
 * Android 上极易炸），体积也更小。
 *
 * 命令：
 *  - check              : 拉版本清单，比对 versionName，返回是否有更新
 *  - download           : 下载 APK 到 cacheDir，校验 sha256，返回本地路径
 *  - canInstall         : 系统是否允许本来源安装未知应用
 *  - openInstallSettings: 跳「安装未知应用」授权页
 *  - installApk         : 用 FileProvider 的 content:// URI 拉起系统安装界面
 */
@TauriPlugin
class SideloadUpdaterPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private const val TAG = "SideloadUpdater"
        // 用 /releases/latest/download/ 稳定路径：始终指向最新已发布 Release 的资产，
        // 不绑定具体 tag，也不需要和桌面端 updater tag 耦合。
        // CI 会在版本 Release 里生成并上传 android-latest.json。
        private const val MANIFEST_URL =
            "https://github.com/rock-zhang/Shui/releases/latest/download/android-latest.json"
        private const val APK_FILENAME = "shui-sideload-update.apk"
        const val FILE_MISSING = "FILE_MISSING"
        const val PERMISSION_DENIED = "PERMISSION_DENIED"
    }

    private var webView: WebView? = null

    // 下载进度节流：JS 桥调用不便宜，按「百分比有变化 且 距上次 >=200ms」投放。
    private var lastProgressAt = 0L
    private var lastProgressPct = -1

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
    }

    /**
     * 把下载进度推到 WebView。
     *
     * 不能用 `Plugin.trigger()`——Tauri 的 trigger 只发给 registerListener
     * 注册的 Channel，不进全局事件总线，JS 的 `listen()` 收不到（ReminderPlugin
     * 里踩过同一个坑）。这里直接派发 DOM 事件，前端用 window.addEventListener 接。
     *
     * 必须回主线程：evaluateJavascript 只能在 WebView 所属线程调用，
     * 而下载跑在后台线程。
     */
    private fun emitProgress(percent: Int) {
        val pct = percent.coerceIn(0, 100)
        val now = System.currentTimeMillis()
        if (pct == lastProgressPct) return
        // 100 必须发出去，不能被节流吞掉，否则进度条会停在 99。
        if (pct < 100 && now - lastProgressAt < 200) return
        lastProgressAt = now
        lastProgressPct = pct
        activity.runOnUiThread {
            webView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('shui:update-progress',{detail:$pct}));",
                null
            )
        }
    }

    private fun currentVersionName(): String {
        return try {
            val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
            info.versionName ?: "0"
        } catch (e: Exception) {
            "0"
        }
    }

    /** 语义版本比较：a > b 返回 true。解析失败按 0 处理，不抛异常。 */
    private fun versionGt(a: String, b: String): Boolean {
        fun parse(s: String): List<Long> = s.trimStart('v')
            .split('.', '-', '+')
            .map { it.toLongOrNull() ?: 0L }
        val va = parse(a)
        val vb = parse(b)
        val n = maxOf(va.size, vb.size)
        for (i in 0 until n) {
            val x = va.getOrElse(i) { 0L }
            val y = vb.getOrElse(i) { 0L }
            if (x != y) return x > y
        }
        return false
    }

    private fun fetchText(url: String, connectTimeout: Int, readTimeout: Int): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = connectTimeout
        conn.readTimeout = readTimeout
        conn.instanceFollowRedirects = true
        conn.requestMethod = "GET"
        conn.setRequestProperty("User-Agent", "Shui-Sideload-Updater")
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw IllegalStateException("HTTP $code")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    @Command
    fun check(invoke: Invoke) {
        Thread {
            try {
                val manifest = JSONObject(fetchText(MANIFEST_URL, 15000, 30000))
                val latest = manifest.optString("version", "")
                val current = currentVersionName()
                val available = latest.isNotEmpty() && versionGt(latest, current)

                val payload = JSObject()
                payload.put("available", available)
                payload.put("currentVersion", current)
                if (available) {
                    val info = JSObject()
                    info.put("version", latest)
                    info.put("notes", manifest.optString("notes", ""))
                    info.put("apkUrl", manifest.optString("apkUrl", ""))
                    info.put("sha256", manifest.optString("sha256", ""))
                    payload.put("latest", info)
                } else {
                    payload.put("latest", JSONObject.NULL)
                }
                activity.runOnUiThread { invoke.resolve(payload) }
            } catch (e: Exception) {
                Log.w(TAG, "check failed", e)
                activity.runOnUiThread { invoke.reject("检查更新失败: ${e.message}") }
            }
        }.start()
    }

    @Command
    fun download(invoke: Invoke) {
        val args = invoke.getArgs()
        val apkUrl = args.optString("apkUrl", "")
        val expectedSha = args.optString("sha256", "")
        if (apkUrl.isBlank() || expectedSha.length != 64) {
            invoke.reject("版本清单缺少 apkUrl 或 sha256 不合法")
            return
        }
        Thread {
            val out = File(activity.cacheDir, APK_FILENAME)
            try {
                val digest = MessageDigest.getInstance("SHA-256")
                val conn = URL(apkUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 60000
                conn.instanceFollowRedirects = true
                conn.setRequestProperty("User-Agent", "Shui-Sideload-Updater")
                try {
                    val code = conn.responseCode
                    if (code !in 200..299) throw IllegalStateException("HTTP $code")
                    // GitHub 资产会经过重定向，最终响应带 content-length；
                    // 拿不到（-1）时退化为「不定进度」，前端只能显示不确定态。
                    val total = conn.contentLengthLong
                    var done = 0L
                    lastProgressPct = -1
                    lastProgressAt = 0L
                    emitProgress(0)
                    conn.inputStream.use { input ->
                        out.outputStream().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read <= 0) break
                                output.write(buffer, 0, read)
                                digest.update(buffer, 0, read)
                                done += read
                                if (total > 0) {
                                    // 顶到 99：最后 1% 留给 sha256 校验，否则
                                    // 进度条显示 100% 却还在算摘要，像卡死。
                                    emitProgress((done * 100 / total).toInt().coerceAtMost(99))
                                }
                            }
                        }
                    }
                } finally {
                    conn.disconnect()
                }

                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                if (!actual.equals(expectedSha, ignoreCase = true)) {
                    out.delete()
                    // 校验失败要把进度打回去，否则前端停在 99% 等不到结果。
                    emitProgress(0)
                    activity.runOnUiThread {
                        invoke.reject("APK 校验失败：期望 $expectedSha，实际 $actual")
                    }
                    return@Thread
                }
                emitProgress(100)
                activity.runOnUiThread { invoke.resolveObject(out.absolutePath) }
            } catch (e: Exception) {
                Log.e(TAG, "download failed", e)
                runCatching { out.delete() }
                emitProgress(0)
                activity.runOnUiThread { invoke.reject("下载失败: ${e.message}") }
            }
        }.start()
    }

    @Command
    fun canInstall(invoke: Invoke) {
        val allowed =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
                activity.packageManager.canRequestPackageInstalls()
        invoke.resolveObject(allowed)
    }

    @Command
    fun openInstallSettings(invoke: Invoke) {
        try {
            val uri = Uri.parse("package:${activity.packageName}")
            val intent = Intent(
                android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                uri
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            invoke.resolveObject(true)
        } catch (e: Exception) {
            Log.w(TAG, "openInstallSettings failed", e)
            invoke.reject("无法打开安装权限设置: ${e.message}")
        }
    }

    @Command
    fun installApk(invoke: Invoke) {
        val path = invoke.getArgs().optString("path", "")
        if (path.isBlank()) {
            invoke.reject("缺少 APK 路径")
            return
        }
        val apk = File(path)
        if (!apk.exists() || apk.length() == 0L) {
            invoke.reject(FILE_MISSING)
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            invoke.reject(PERMISSION_DENIED)
            return
        }

        try {
            val uri: Uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                apk
            )
            // 标准侧载安装：ACTION_VIEW + content:// URI + 读权限授予。
            // 不用已弃用的 ACTION_INSTALL_PACKAGE，也别加 EXTRA_NOT_UNKNOWN_SOURCE
            // 之类需要系统签名的 extra（普通应用无效，还会被安全扫描盯上）。
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            if (intent.resolveActivity(activity.packageManager) == null) {
                invoke.reject("系统没有可用的 APK 安装器")
                return
            }
            activity.startActivity(intent)
            invoke.resolveObject(true)
        } catch (e: Exception) {
            Log.e(TAG, "installApk failed", e)
            invoke.reject("拉起安装失败: ${e.message}")
        }
    }
}
