package com.shui.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                REQUEST_NOTIFICATION_PERMISSION
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        ReminderPlugin.deliverIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // 从系统设置 / 分享 chooser 回来后，部分 ROM 会把系统栏染回主题默认色。
        ReminderPlugin.applySystemBarTheme(this)
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
