use crate::core::store::settings::AppSettings;
use crate::core::window;
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

#[tauri::command]
pub fn call_reminder(app_handle: tauri::AppHandle) -> bool {
    println!("call_reminder");

    // 直接传递引用，避免不必要的 clone
    window::show_reminder_windows(&app_handle);

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
}

#[tauri::command(async)]
pub async fn get_app_runtime_info(
    app_handle: tauri::AppHandle,
) -> Result<AppRuntimeInfoResponse, String> {
    let app_settings = AppSettings::load_from_store::<tauri::Wry>(&app_handle);
    let is_running = IS_RUNNING.load(Ordering::SeqCst);
    let version = app_handle.package_info().version.to_string();

    Ok(AppRuntimeInfoResponse {
        app_settings,
        is_running,
        version,
    })
}

use std::process::Command;

#[tauri::command]
pub fn get_installed_apps(app_handle: tauri::AppHandle) -> Vec<String> {
    let self_name = app_handle.package_info().name.clone();

    let output = Command::new("ls")
        .arg("/Applications")
        .output()
        .expect("failed to execute command");

    String::from_utf8_lossy(&output.stdout)
        .split('\n')
        .filter(|app| app.ends_with(".app"))
        .filter(|app| !app.starts_with(&format!("{}.app", self_name))) // 过滤掉本应用
        .filter_map(|app| {
            let path = format!("/Applications/{}", app);
            let output = Command::new("mdls")
                .args(["-name", "kMDItemDisplayName", "-raw", &path])
                .output()
                .ok()?;

            let display_name = String::from_utf8_lossy(&output.stdout)
                .trim()
                .trim_end_matches(".app")
                .to_string();

            if !display_name.is_empty() {
                Some(display_name)
            } else {
                Some(app.trim_end_matches(".app").to_string())
            }
        })
        .collect()
}
