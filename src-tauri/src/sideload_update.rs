//! 侧载包专属自更新桥接。
//!
//! 用 `#[cfg(all(target_os = "android", feature = "sideload"))]` 门控：
//! Play 包既不启用 sideload feature，也不编译本文件，产物里没有自更新代码。
//!
//! 真正的网络下载、SHA-256 校验、安装 Intent 都在 Kotlin
//! （SideloadUpdaterPlugin）完成——Android 自带 JVM HTTP 栈与系统证书库，
//! 走原生比在 Rust 里引 rustls/aws-lc-sys 更稳、更小。这里只做参数转交与
//! 错误透传。
//!
//! 注意：Kotlin 侧在后台线程下载、主线程 resolve，所以这里必须用
//! `run_mobile_plugin_async` + 异步 command。同步版 `run_mobile_plugin` 会
//! 阻塞调用线程直到收到响应，若命令恰好跑在主线程就会和 resolve 互相等待
//! 而死锁。
//!
//! 硬约束：系统安装这一步始终要求用户手动确认，Android 不允许第三方应用
//! 静默安装；无法像桌面端那样 downloadAndInstall + relaunch 一条龙。

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

/// 侧载插件的独立 handle。不能用 mobile::MobileBridge——那是 ReminderPlugin
/// 的 handle，Tauri 按类型区分 state，同类型 manage 会互相覆盖。
pub struct SideloadBridge<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

async fn native_sideload<T: serde::de::DeserializeOwned>(
    app: &AppHandle,
    command: &str,
    payload: impl Serialize,
) -> Result<T, String> {
    // 先把 handle 克隆出来，避免把 State 借用跨越 await。
    let handle = {
        let bridge = app
            .try_state::<SideloadBridge<tauri::Wry>>()
            .ok_or_else(|| "侧载更新插件未就绪，请重启应用".to_string())?;
        bridge.0.clone()
    };
    handle
        .run_mobile_plugin_async::<T>(command, payload)
        .await
        .map_err(|error| error.to_string())
}

/// 版本清单条目，字段与 Kotlin `check` 返回的 latest 对象一致。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    pub apk_url: String,
    pub sha256: String,
}

/// 检查更新。返回结构直接由 Kotlin 组装（available / currentVersion / latest），
/// 用 Value 透传，避免两边各维护一份结构体漂移。
#[tauri::command]
pub async fn sideload_check_update(app: AppHandle) -> Result<serde_json::Value, String> {
    native_sideload::<serde_json::Value>(&app, "check", serde_json::json!({})).await
}

/// 下载 APK 到缓存并校验 sha256，返回本地路径。
#[tauri::command]
pub async fn sideload_download_update(app: AppHandle, info: UpdateInfo) -> Result<String, String> {
    native_sideload::<String>(
        &app,
        "download",
        serde_json::json!({ "apkUrl": info.apk_url, "sha256": info.sha256 }),
    )
    .await
}

/// 查询系统是否允许本来源安装未知应用。
#[tauri::command]
pub async fn sideload_can_install(app: AppHandle) -> Result<bool, String> {
    native_sideload::<bool>(&app, "canInstall", serde_json::json!({})).await
}

/// 跳「安装未知应用」授权页。
#[tauri::command]
pub async fn sideload_open_install_settings(app: AppHandle) -> Result<(), String> {
    native_sideload::<bool>(&app, "openInstallSettings", serde_json::json!({})).await?;
    Ok(())
}

/// 拉起系统安装界面（用户仍需手动点「安装」）。
#[tauri::command]
pub async fn sideload_install_apk(app: AppHandle, path: String) -> Result<(), String> {
    native_sideload::<bool>(&app, "installApk", serde_json::json!({ "path": path })).await?;
    Ok(())
}
