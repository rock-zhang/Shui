#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use windows::*;

pub fn show_reminder_windows(app_handle: &tauri::AppHandle) {
    show_reminder(&app_handle);
}

pub fn hide_reminder_windows(app_handle: &tauri::AppHandle) {
    hide_reminder(&app_handle);
}

pub fn hide_reminder_window(app_handle: &tauri::AppHandle, label: &str) {
    hide_reminder_single(&app_handle, &label);
}
