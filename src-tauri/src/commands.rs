// use crate::core::store::AppSettings;
use crate::core::store::settings::AppSettings;
use crate::timer;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri_plugin_store::StoreExt;

// Remove this line since we don't need it
// use tauri::api::version::Version;
use tauri::{Emitter, LogicalPosition, Manager};
use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
use tauri_nspanel::{ManagerExt, WebviewWindowExt};
use timer::IS_RUNNING;
use tokio::time::{sleep, Duration};

const NSWindowStyleMaskUtilityWindow: i32 = 1 << 7;
#[allow(non_upper_case_globals)]

fn show_reminder_page(app_handle: &tauri::AppHandle) {
    if let Ok(monitors) = app_handle.available_monitors() {
        for (index, monitor) in monitors.iter().enumerate() {
            let reminder_label = format!("reminder_{}", index);

            // 检查是否已存在提醒窗口
            if let Ok(panel) = app_handle.get_webview_panel(&reminder_label) {
                panel.show();
                continue;
            }

            let size = monitor.size();
            let scale_factor = monitor.scale_factor();
            let position = monitor.position();

            // 根据缩放因子调整尺寸
            let scaled_width = size.width as f64 / scale_factor;
            let scaled_height = size.height as f64 / scale_factor;

            println!(
                "Monitor {}: size={:?}, position={:?}, scale_factor={:?}, scaled_size=({:?}, {:?})",
                index, size, position, scale_factor, scaled_width, scaled_height
            );

            let window = tauri::WebviewWindowBuilder::new(
                app_handle,
                format!("reminder_{}", index),
                tauri::WebviewUrl::App("reminder/".into()),
            )
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .focus()
            .inner_size(scaled_width as f64, scaled_height as f64)
            .position(position.x as f64, position.y as f64)
            .build()
            .expect(&format!("failed to create reminder window {}", index));

            let panel = window.to_panel().unwrap();
            panel.set_level(26);

            panel.set_style_mask(NSWindowStyleMaskUtilityWindow);

            // // 在各个桌面空间、全屏中共享窗口
            panel.set_collection_behaviour(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
            );

            // let window_clone = window.clone();
            // tauri::async_runtime::spawn(async move {
            //     loop {
            //         // 保证在切换 space 之后获取焦点，可以响应键盘、鼠标事件
            //         sleep(Duration::from_millis(100)).await;
            //         let _ = window_clone.set_focus();
            //     }
            // });
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReminderCaller {
    Preview,
    Timer,
}

use std::sync::Mutex;
use tokio::sync::mpsc;

// 只保留 channel 相关的静态变量
static COUNTDOWN_SENDER: Mutex<Option<mpsc::Sender<()>>> = Mutex::new(None);

#[tauri::command]
pub fn call_reminder(app_handle: tauri::AppHandle, caller: Option<ReminderCaller>) -> bool {
    println!("call_reminder");

    if let Ok(panel) = app_handle.get_webview_panel("reminder_0") {
        if let Ok(monitors) = app_handle.available_monitors() {
            for (index, monitor) in monitors.iter().enumerate() {
                let reminder_label = format!("reminder_{}", index);

                println!("show_reminder_windows: {}", reminder_label);

                // 检查是否已存在提醒窗口
                if let Ok(panel) = app_handle.get_webview_panel(&reminder_label) {
                    let win = app_handle.get_webview_window(&reminder_label).unwrap();
                    let position = monitor.position();
                    let _ = win.set_position(LogicalPosition::new(position.x, position.y));
                    panel.show();
                } else {
                    // 接入新的外接屏幕，需要重新创建Window
                    show_reminder_page(&app_handle);
                }
            }
        }
    } else {
        show_reminder_page(&app_handle);
    }

    // 取消之前的倒计时
    if let Some(sender) = COUNTDOWN_SENDER.lock().unwrap().take() {
        let _ = sender.try_send(());
    }

    // 创建新的 channel
    let (tx, mut rx) = mpsc::channel(1);
    *COUNTDOWN_SENDER.lock().unwrap() = Some(tx);

    // 启动新的倒计时任务
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let mut countdown = 30;
        let _ = app_handle_clone.emit("countdown", countdown);

        loop {
            tokio::select! {
                _ = rx.recv() => {
                    break; // 收到取消信号
                }
                _ = sleep(Duration::from_secs(1)) => {
                    countdown -= 1;
                    let _ = app_handle_clone.emit("countdown", countdown);
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
fn show_panel(app_handle: tauri::AppHandle, label: &str) {
    let panel = app_handle.get_webview_panel(label).unwrap();

    panel.show();
}

#[tauri::command]
pub fn hide_reminder_windows(app_handle: tauri::AppHandle) {
    if let Ok(monitors) = app_handle.available_monitors() {
        for (index, monitor) in monitors.iter().enumerate() {
            let reminder_label = format!("reminder_{}", index);

            println!("hide_reminder_windows: {}", reminder_label); // 打印 reminder_label 的值，以检查是否正确获取了窗口标签

            // 检查是否已存在提醒窗口
            if let Ok(panel) = app_handle.get_webview_panel(&reminder_label) {
                panel.order_out(None);
            }
        }

        // 取消之前的倒计时
        if let Some(sender) = COUNTDOWN_SENDER.lock().unwrap().take() {
            let _ = sender.try_send(());
        }
    }
}

#[tauri::command]
pub fn hide_reminder_window(app_handle: tauri::AppHandle, label: &str) {
    if let Ok(panel) = app_handle.get_webview_panel(&label) {
        panel.order_out(None);
    }
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
pub async fn get_app_runtime_info(app_handle: tauri::AppHandle) -> AppRuntimeInfoResponse {
    let store = app_handle
        .app_handle()
        .store("config_store.json")
        .expect("无法加载配置文件");
    let app_settings = AppSettings::load_from_store(&store);
    let is_running = IS_RUNNING.load(Ordering::SeqCst);
    // We can get version directly from package_info()
    let version = app_handle.package_info().version.to_string();

    AppRuntimeInfoResponse {
        app_settings,
        is_running,
        version,
    }
}
