use crate::timer;
use serde::Serialize;
use tauri::Manager;
use timer::{IS_RUNNING, TIMER_STATE};

fn show_reminder_page(app_handle: &tauri::AppHandle) {
    tauri::WebviewWindowBuilder::new(
        app_handle,
        "reminder1111",
        tauri::WebviewUrl::App("http://localhost:3000/reminder/".into()),
    )
    .title("休息提醒")
    .decorations(false)
    // .always_on_top(true)
    .transparent(true)
    .visible_on_all_workspaces(true)
    .inner_size(800.0, 900.0)
    .build()
    .expect("failed to create reminder window");
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

    if (is_running && elapsed.as_secs() >= 5) {
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
    if let Some(window) = app_handle.get_webview_window(label) {
        window.close().unwrap();
    }
}
