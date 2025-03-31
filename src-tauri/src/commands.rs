use crate::{core::panel, timer};
use serde::Serialize;
// use std::thread::{self, sleep};
// use std::time::Duration;

use tauri::Manager;
use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, panel_delegate};
use tauri_nspanel::{ManagerExt, WebviewWindowExt};
use timer::{IS_RUNNING, TIMER_STATE};
use tokio::time::{sleep, Duration};

const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
const NSWindowStyleMaskUtilityWindow: i32 = 1 << 7;
#[allow(non_upper_case_globals)]
const NSResizableWindowMask: i32 = 1 << 3;

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
                tauri::WebviewUrl::App("http://localhost:3000/reminder/".into()),
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

            // // 不抢占其它窗口的焦点和支持缩放
            // panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel | NSResizableWindowMask);
            panel.set_style_mask(NSWindowStyleMaskUtilityWindow);

            // | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
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

#[tauri::command]
pub fn call_reminder(app_handle: tauri::AppHandle) -> bool {
    println!("call_reminder");
    let timer = TIMER_STATE.lock();
    println!("Timer: {:?}", timer);
    let elapsed = timer.elapsed();
    println!("Timer has been running for {} seconds", elapsed.as_secs());
    let is_running = IS_RUNNING.load(std::sync::atomic::Ordering::SeqCst);
    println!("IS_RUNNING: {}", is_running);

    if is_running && elapsed.as_secs() >= 5 {
        println!("Timer is running and has been running for 20 minutes");
        show_reminder_page(&app_handle);
    }

    println!("call_reminder end");
    return true;
}

#[derive(Serialize)]
pub struct SettingResponse {
    screen: i32,
}

#[tauri::command]
pub fn setting(app_handle: tauri::AppHandle) -> SettingResponse {
    println!("app_handle");

    // let _ = app_handle
    //     .get_webview_window("main")
    //     .unwrap()
    //     .set_cursor_visible(true);

    let main_window = app_handle.get_webview_window("main").unwrap();
    let main_window_size = main_window.inner_size().unwrap();
    println!("main_window_size: {:?}", main_window_size);

    // let _ = app_handle
    //     .get_webview_window("main")
    //     .unwrap()
    //     .set_cursor_visible(false);

    SettingResponse { screen: 2 }
}

#[tauri::command]
pub fn close_window(app_handle: tauri::AppHandle, label: &str) {
    println!("Closing window: {}", label);
    app_handle.get_webview_window(label).unwrap().close();
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
