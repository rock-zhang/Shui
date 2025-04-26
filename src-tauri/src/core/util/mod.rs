#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use windows::*;

pub fn is_frontapp_in_whitelist(whitelist_apps: &Vec<String>) -> bool {
    check_whitelist(whitelist_apps)
}

pub fn get_installed_apps(app_handle: &tauri::AppHandle) -> Vec<String> {
    get_local_installed_apps(&app_handle)
}
