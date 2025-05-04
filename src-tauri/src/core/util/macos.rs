use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use objc_foundation::{INSString, NSString};
use std::process::Command;

pub fn check_whitelist(whitelist_apps: &Vec<String>) -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
            if !workspace.is_null() {
                let app: *mut Object = msg_send![workspace, frontmostApplication];
                if !app.is_null() {
                    let name: *mut Object = msg_send![app, localizedName];
                    if !name.is_null() {
                        let ns_string: &NSString = unsafe { &*(name as *const NSString) };
                        let app_name = ns_string.as_str().to_string();

                        return whitelist_apps.contains(&app_name);
                    }
                }
            }
        }
    }
    false
}

pub fn get_local_installed_apps(app_handle: &tauri::AppHandle) -> Vec<String> {
    let self_name = app_handle.package_info().name.clone();

    let output = Command::new("ls")
        .arg("/Applications")
        .output()
        .expect("failed to execute command");

    String::from_utf8_lossy(&output.stdout)
        .split('\n')
        .filter(|app| app.ends_with(".app"))
        .filter(|app| !app.starts_with(&format!("{}.app", self_name))) // 过滤掉本应用
        .filter_map(|app| {
            let path = format!("/Applications/{}", app);
            let output = Command::new("mdls")
                .args(["-name", "kMDItemDisplayName", "-raw", &path])
                .output()
                .ok()?;

            let display_name = String::from_utf8_lossy(&output.stdout)
                .trim()
                .trim_end_matches(".app")
                .to_string();

            if !display_name.is_empty() {
                Some(display_name)
            } else {
                Some(app.trim_end_matches(".app").to_string())
            }
        })
        .collect()
}
