#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "linux")]
pub use linux::*;

// Android 只有一个 Activity / 一个 WebView，没有多显示器全屏提醒窗口。
// 提醒改为「原生通知 + App 内全屏 overlay」，这三个入口保留空实现，
// 让共享的 reminder_session / commands 代码无需平台分支。
#[cfg(target_os = "android")]
pub fn show_reminder(_app_handle: &tauri::AppHandle) {}

#[cfg(target_os = "android")]
pub fn hide_reminder(_app_handle: &tauri::AppHandle) {}

#[cfg(target_os = "android")]
pub fn hide_reminder_single(_app_handle: &tauri::AppHandle, _label: &str) {}

pub fn show_reminder_windows(app_handle: &tauri::AppHandle) {
    show_reminder(app_handle);
}

pub fn hide_reminder_windows(app_handle: &tauri::AppHandle) {
    hide_reminder(app_handle);
}

pub fn hide_reminder_window(app_handle: &tauri::AppHandle, label: &str) {
    hide_reminder_single(app_handle, label);
}
