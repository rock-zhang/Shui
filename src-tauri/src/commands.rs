use crate::timer;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;

use tauri::Manager;
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
                return;
            }

            let size = monitor.size();
            let position = monitor.position();

            println!(
                "Monitor {}: size={:?}, position={:?}",
                index, size, position
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
            .inner_size(size.width as f64, size.height as f64)
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

            let window_clone = window.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    // 保证在切换 space 之后获取焦点，可以响应键盘、鼠标事件
                    sleep(Duration::from_millis(100)).await;
                    let _ = window_clone.set_focus();
                }
            });
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReminderCaller {
    Preview,
    Timer,
}

#[tauri::command]
pub fn call_reminder(app_handle: tauri::AppHandle, caller: Option<ReminderCaller>) -> bool {
    println!("call_reminder");

    // if call_by == ReminderCaller::Timer {
    //     if IS_RUNNING.load(Ordering::SeqCst) {
    //         println!("call_reminder: 计时器正在运行，不显示提醒页面");
    //         return false;
    //     }
    // }

    show_reminder_page(&app_handle);

    println!("call_reminder end");
    return true;
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
    }
}

#[tauri::command]
pub fn close_reminder_windows(app_handle: tauri::AppHandle, label: &str) {
    let panel = app_handle.get_webview_panel(label).unwrap();

    // 需设置 isReleasedWhenClosed = false，否则关闭窗口后对象可能被释放导致崩溃。
    panel.set_released_when_closed(false);

    panel.close();
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
