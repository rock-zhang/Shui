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
