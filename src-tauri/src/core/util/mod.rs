#[cfg(target_os = "macos")]
mod macos;

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

    false
}

pub async fn get_installed_apps() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        return get_local_installed_apps().await;
    }

    vec![]
}
