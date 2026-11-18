#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
pub use linux::*;
#[cfg(target_os = "macos")]
pub use macos::*;

// #[cfg(target_os = "windows")]
// mod windows;
// #[cfg(target_os = "windows")]
// pub use windows::*;

pub fn is_frontapp_in_whitelist(whitelist_apps: &Vec<String>) -> bool {
    #[cfg(target_os = "macos")]
    {
        return check_whitelist(whitelist_apps);
    }

    // 白名单只在 macOS 实现了前台应用识别；Windows / Linux 走提醒前置检查时
    // 恒返回 false，即不因白名单抑制提醒。
    #[cfg(not(target_os = "macos"))]
    let _ = whitelist_apps;

    false
}

pub async fn get_installed_apps() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        return get_local_installed_apps().await;
    }

    vec![]
}
