use dbus::blocking::Connection;
use std::process::Command;

pub fn check_whitelist(whitelist_apps: &Vec<String>) -> bool {
    #[cfg(target_os = "linux")]
    {
        // 使用 D-Bus 获取当前活动窗口的应用信息
        if let Ok(conn) = Connection::new_session() {
            let proxy = conn.with_proxy(
                "org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                std::time::Duration::from_millis(5000),
            );

            // 尝试获取活动窗口的应用名称
            let result: Result<(String,), _> = proxy.method_call(
                "org.freedesktop.DBus",
                "GetNameOwner",
                ("org.freedesktop.WindowManager",),
            );

            if let Ok((app_name,)) = result {
                return whitelist_apps.contains(&app_name);
            }
        }
    }
    false
}

pub fn get_local_installed_apps(app_handle: &tauri::AppHandle) -> Vec<String> {
    let self_name = app_handle.package_info().name.clone();

    // 获取常见应用目录下的 .desktop 文件
    let paths = vec![
        "/usr/share/applications",
        "/usr/local/share/applications",
        format!(
            "/home/{}/.local/share/applications",
            std::env::var("USER").unwrap_or_default()
        ),
    ];

    let mut apps = Vec::new();

    for path in paths {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.filter_map(Result::ok) {
                if let Some(file_name) = entry.file_name().to_str() {
                    if file_name.ends_with(".desktop")
                        && !file_name.starts_with(&format!("{}.desktop", self_name))
                    {
                        // 读取 .desktop 文件获取应用名称
                        if let Ok(content) = std::fs::read_to_string(entry.path()) {
                            if let Some(name) = content
                                .lines()
                                .find(|line| line.starts_with("Name="))
                                .and_then(|line| line.strip_prefix("Name="))
                            {
                                apps.push(name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    apps.sort();
    apps.dedup();
    apps
}
