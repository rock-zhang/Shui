use crate::core::window;
use crate::core::{store::settings::AppSettings, util};
use crate::timer;
use crate::reminder_session::{self, Outcome};
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

#[cfg(not(target_os = "android"))]
fn countdown_async(app_handle: tauri::AppHandle) {
    let token = reminder_session::current_id();
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
                        if reminder_session::close(&app_handle, token.as_deref(), Outcome::TimedOut) {
                            reset_timer();
                        }
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
    if !reminder_session::begin() { return true; }
    println!("call_reminder");

    // 到点停表，但不记为「手动暂停」：提醒结束后 reset_timer 会重新放行。
    timer::suspend_for_reminder();
    window::show_reminder_windows(&app_handle);

    countdown_async(app_handle);

    true
}

#[cfg(target_os = "windows")]
// windows的command居然要加async，笑死，浪费我2个晚上的时间
// https://github.com/tauri-apps/wry/issues/583
#[tauri::command]
pub async fn call_reminder(app_handle: tauri::AppHandle) -> bool {
    if !reminder_session::begin() { return true; }
    println!("call_reminder");

    // 到点停表，但不记为「手动暂停」：提醒结束后 reset_timer 会重新放行。
    timer::suspend_for_reminder();
    // 直接传递引用，避免不必要的 clone
    window::show_reminder_windows(&app_handle);

    countdown_async(app_handle);

    true
}

#[tauri::command]
pub async fn hide_reminder_windows(app_handle: tauri::AppHandle, outcome: Option<Outcome>, expected_session: Option<String>) {
    if !reminder_session::close(&app_handle, expected_session.as_deref(), outcome.unwrap_or(Outcome::Skipped)) {
        return;
    }
    #[cfg(not(target_os = "android"))]
    reset_timer();
    #[cfg(target_os = "android")]
    crate::mobile::reset_timer(app_handle.clone());

    // 取消之前的倒计时
    if let Some(sender) = REMINDER_PAGE_COUNTDOWN_SENDER.lock().unwrap().take() {
        let _ = sender.try_send(());
    }
}

#[tauri::command]
pub fn hide_reminder_window(app_handle: tauri::AppHandle, label: &str) {
    window::hide_reminder_window(&app_handle, &label);
}

// Android 下同名命令由 mobile.rs 提供（会顺带重建原生闹钟）。
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn reset_timer() {
    // 重置计时器：先停一秒让线程从头开始，再按「手动暂停 / 锁屏」两道闸门放行。
    IS_RUNNING.store(false, Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(1000)).await;
        timer::refresh_gate();
    });
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn pause_timer() {
    // 只有用户主动暂停才写 MANUAL_PAUSED；锁屏/到点提醒都不走这里。
    timer::pause_manually();
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn start_timer() {
    timer::resume_manually();
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
