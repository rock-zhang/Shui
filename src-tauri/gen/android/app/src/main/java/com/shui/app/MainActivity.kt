package com.shui.app

import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // 先初始化埋点：后续的权限申请、通知点击都需要它；没有 Firebase 配置时
        // AnalyticsTracker 内部会整体降级为 no-op。
        AnalyticsTracker.init(applicationContext)
        // targetSdk 36 在 Android 15+ 上强制 edge-to-edge。必须在 super 之前
        // 调用，否则 TauriActivity 创建 Window 时已经定下了非透明系统栏。
        // 内容避让由 WebView 的 env(safe-area-inset-*) 负责（viewportFit=cover）。
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // 冷启动首帧的颜色由 themes.xml 保证；这里按系统 uiMode 定下初始值，
        // 随后 Web 端会用 App 内主题（可能和系统相反）覆盖。
        if (!ReminderPlugin.systemBarThemeFromWeb) {
            ReminderPlugin.systemBarDark =
                ReminderPlugin.isNightMode(resources.configuration)
        }
        ReminderPlugin.applySystemBarTheme(this)

        // 从通知冷启动时，把 Intent 交给 ReminderPlugin，在 WebView 就绪后
        // 转成 mobile-reminder 事件，让 App 内全屏提醒通道也能承接。
        ReminderPlugin.holdReminderIntent(intent)

        // 冷启动来源：通知主体点击 / 桌面图标 / 其他（如分享回流）。
        val fromNotification =
            intent?.getBooleanExtra(ReminderPlugin.EXTRA_OPEN_REMINDER, false) == true
        val launchSource = when {
            fromNotification -> "notification"
            intent?.action == Intent.ACTION_MAIN -> "icon"
            else -> "other"
        }
        AnalyticsTracker.logAppOpen(this, launchSource, coldStart = true)
        if (fromNotification) {
            AnalyticsTracker.logNotificationOpened(this, coldStart = true)
        }
        AnalyticsTracker.logPermissionSnapshot(this, this, "startup")

        // 首次打开不主动弹系统通知权限框：用户刚进 App 还没理解提醒的用途就被
        // 追问一项系统权限，拒绝率很高，而 Android 13+ 拒绝两次后系统会永久
        // 静默拒绝，只能靠系统设置页救回来。授权入口交给「三步引导」第 1 步与
        // 今日页的提示卡——那里先讲清楚为什么需要通知，再由用户点「允许」。
        // 权限请求链路（onRequestPermissionsResult 埋点）保持不变。

        // 清理历史通知渠道：渠道 id 换了新版本后，旧 id 建过的渠道不会自动消失，
        // 会一直挂在系统通知设置里让用户看到两个同名「喝水提醒」。
        // 一并清掉 shui-reminder / shui-reminder-silent / 已废弃的前台保活渠道。
        try {
            ReminderScheduler.deleteLegacyChannels(this)
        } catch (_: Exception) {
            // 清理失败不影响提醒本身，只是设置页里会多一个旧条目。
        }

        // 启动即预创建新渠道：渠道的默认重要度由第一次创建决定且之后应用不可改，
        // 拖到首次发通知才建，这个时机可能撞上系统对新装应用的通知观察期，
        // 有被以低重要度写死的风险。提前建同时也让用户能立刻在系统设置里
        // 看到「喝水提醒」，确认横幅是否开启——这也是微信那类 App 的做法。
        try {
            ReminderScheduler.ensureChannels(this)
            // 记下当前渠道语言；后续语言偏好变化时由 onResume 用新文案刷新名称。
            ReminderScheduler.syncChannelLocale(this)
        } catch (_: Exception) {
            // 建渠道失败不影响提醒：发送时会再建一次。
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // 已在前台/后台时点通知主体：不重新走 onCreate，这里补一条打开来源。
        if (intent.getBooleanExtra(ReminderPlugin.EXTRA_OPEN_REMINDER, false)) {
            AnalyticsTracker.logAppOpen(this, "notification", coldStart = false)
            AnalyticsTracker.logNotificationOpened(this, coldStart = false)
        }
        ReminderPlugin.deliverIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // Tauri 通知插件每次启动都会建一个 id 为 "default"、名称 Default 的渠道，
        // 但 Android 上的提醒全部走 ReminderScheduler 自己的渠道，从不往它发通知。
        // 留着只会在系统通知设置里多出一个 "Default" 分类，这里在插件加载后删掉。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java)?.deleteNotificationChannel("default")
        }
        // 语言偏好可能在 WebView 内刚切换：变化时用新文案刷新渠道名/描述。
        // createNotificationChannel 只更新名称，不覆盖用户的渠道设置；仅在
        // locale 真的变化时才会执行，正常启动不会重建渠道。
        try {
            ReminderScheduler.syncChannelLocale(this)
        } catch (_: Exception) {
            // 渠道刷新失败不影响提醒，发通知时还会再建一次。
        }
        // 从系统设置 / 分享 chooser 回来后，部分 ROM 会把系统栏染回主题默认色。
        ReminderPlugin.applySystemBarTheme(this)
        // 系统设置页、电池优化「允许/不允许」弹窗返回时，WebView 不一定派发
        // visibilitychange，主动通知前端复查权限开关状态。
        ReminderPlugin.notifyForeground()
        // 权限/渠道状态变化才会上报，内部按快照指纹去重。
        AnalyticsTracker.logPermissionSnapshot(this, this, "resume")
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_NOTIFICATION_PERMISSION) {
            val granted =
                grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            AnalyticsTracker.logPermissionResult(
                this,
                granted,
                ReminderPlugin.permissionRequestSource
            )
            ReminderPlugin.permissionRequestSource = "unknown"
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // manifest 声明了 uiMode 变化不重建 Activity；若 Web 端还没锁定主题，
        // 就跟着系统重新取一次深浅色。
        if (!ReminderPlugin.systemBarThemeFromWeb) {
            ReminderPlugin.systemBarDark = ReminderPlugin.isNightMode(newConfig)
        }
        ReminderPlugin.applySystemBarTheme(this)
    }

    companion object {
        const val REQUEST_NOTIFICATION_PERMISSION = 1001
    }
}
