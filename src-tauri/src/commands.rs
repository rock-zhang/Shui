use crate::core::window;
use crate::core::{store::settings::AppSettings, util};
use crate::timer;
use serde::Serialize;
use std::sync::atomic::Ordering;

// Remove this line since we don't need it
// use tauri::api::version::Version;
use tauri::{Emitter, Manager};
use timer::IS_RUNNING;
use tokio::time::{sleep, Duration};

use std::sync::Mutex;
use tokio::sync::mpsc;

// 只保留 channel 相关的静态变量
static REMINDER_PAGE_COUNTDOWN_SENDER: Mutex<Option<mpsc::Sender<()>>> = Mutex::new(None);

fn countdown_async(app_handle: tauri::AppHandle) {
    // 取消之前的倒计时
    if let Some(sender) = REMINDER_PAGE_COUNTDOWN_SENDER.lock().unwrap().take() {
        let _ = sender.try_send(());
    }

    // 创建新的 channel
    let (tx, mut rx) = mpsc::channel(1);
    *REMINDER_PAGE_COUNTDOWN_SENDER.lock().unwrap() = Some(tx);

    // 只在需要移动所有权到异步闭包时才 clone
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let mut countdown = 30;
        let _ = app_handle.emit("countdown", countdown);

        loop {
            tokio::select! {
                _ = rx.recv() => {
                    break; // 收到取消信号
                }
                _ = sleep(Duration::from_secs(1)) => {
                    countdown -= 1;
                    let _ = app_handle.emit("countdown", countdown);
                    if countdown <= 0 {
                        break;
                    }
                }
            }
        }
    });
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tauri::command]
pub fn call_reminder(app_handle: tauri::AppHandle) -> bool {
    println!("call_reminder");

    pause_timer();
    window::show_reminder_windows(&app_handle);

    countdown_async(app_handle);

    true
}

// TODO: windows的command居然要加async，笑死，浪费我2个晚上的时间
// https://github.com/tauri-apps/wry/issues/583
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn call_reminder(app_handle: tauri::AppHandle) -> bool {
    println!("call_reminder");

    pause_timer();
    // 直接传递引用，避免不必要的 clone
    window::show_reminder_windows(&app_handle);

    countdown_async(app_handle);

    true
}

#[tauri::command]
pub fn hide_reminder_windows(app_handle: tauri::AppHandle) {
    window::hide_reminder_windows(&app_handle);

    // 取消之前的倒计时
    if let Some(sender) = REMINDER_PAGE_COUNTDOWN_SENDER.lock().unwrap().take() {
        let _ = sender.try_send(());
    }
}

#[tauri::command]
pub fn hide_reminder_window(app_handle: tauri::AppHandle, label: &str) {
    window::hide_reminder_window(&app_handle, &label);
}

#[tauri::command]
pub fn reset_timer() {
    // 重置计时器
    IS_RUNNING.store(false, Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(1000)).await;
        IS_RUNNING.store(true, Ordering::SeqCst);
    });
}

#[tauri::command]
pub fn pause_timer() {
    IS_RUNNING.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn start_timer() {
    IS_RUNNING.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn quit(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[derive(Serialize)]
pub struct SettingResponse {
    screen: i32,
}

#[tauri::command]
pub fn setting(app_handle: tauri::AppHandle) -> SettingResponse {
    let main_window = app_handle.get_webview_window("main").unwrap();
    let main_window_size = main_window.inner_size().unwrap();
    println!("main_window_size: {:?}", main_window_size);

    SettingResponse { screen: 2 }
}

#[derive(Serialize, Debug)]
pub struct AppRuntimeInfoResponse {
    is_running: bool,
    app_settings: AppSettings,
    version: String,
    os_version: String,
    os_arch: String,
    chip_info: String,
}

#[tauri::command(async)]
pub async fn get_app_runtime_info(
    app_handle: tauri::AppHandle,
) -> Result<AppRuntimeInfoResponse, String> {
    let app_settings = AppSettings::load_from_store::<tauri::Wry>(&app_handle);
    let is_running = IS_RUNNING.load(Ordering::SeqCst);
    let version = app_handle.package_info().version.to_string();

    // 获取操作系统信息
    let os_info = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);
    let os_arch = std::env::consts::ARCH.to_string();

    // 获取芯片信息
    let chip_info = {
        #[cfg(target_os = "macos")]
        {
            let output = std::process::Command::new("sysctl")
                .args(["-n", "machdep.cpu.brand_string"])
                .output()
                .map_err(|e| e.to_string())?;
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        #[cfg(not(target_os = "macos"))]
        {
            "Unknown".to_string()
        }
    };

    Ok(AppRuntimeInfoResponse {
        app_settings,
        is_running,
        version,
        os_version: os_info,
        os_arch,
        chip_info,
    })
}

#[tauri::command]
pub async fn get_installed_apps() -> Vec<String> {
    util::get_installed_apps().await
}
