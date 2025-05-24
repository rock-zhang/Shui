use dbus::blocking::Connection;
use std::process::Command;
use tauri::{WebviewUrl, WebviewWindowBuilder, Manager};

pub fn check_whitelist(whitelist_apps: &Vec<String>) -> bool {
    // 使用xdotool获取当前活动窗口的应用信息
    if let Ok(output) = Command::new("xdotool")
        .args(["getactivewindow", "getwindowname"])
        .output()
    {
        let window_title = String::from_utf8_lossy(&output.stdout).trim().to_string();
        
        // 尝试获取当前窗口的WM_CLASS
        if let Ok(class_output) = Command::new("sh")
            .arg("-c")
            .arg("xprop -id $(xdotool getactivewindow) WM_CLASS")
            .output()
        {
            let class_output_str = String::from_utf8_lossy(&class_output.stdout);
            if let Some(app_name) = class_output_str
                .split('"')
                .nth(3)
                .map(|s| s.to_string())
            {
                println!("当前活动应用: {}", app_name);
                return whitelist_apps.contains(&app_name);
            }
        }
        
        // 尝试根据窗口标题匹配应用
        for app in whitelist_apps {
            if window_title.contains(app) {
                return true;
            }
        }
    }
    
    false
}

pub fn get_local_installed_apps(app_handle: &tauri::AppHandle) -> Vec<String> {
    let mut apps = Vec::new();
    let self_name = app_handle.package_info().name.clone();
    
    // 获取用户主目录
    let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/home".to_string());
    
    // 系统应用目录
    let paths = vec![
        "/usr/share/applications".to_string(),
        "/usr/local/share/applications".to_string(),
        format!("{}/.local/share/applications", home_dir),
        // Flatpak应用目录
        "/var/lib/flatpak/exports/share/applications".to_string(),
        format!("{}/.local/share/flatpak/exports/share/applications", home_dir),
    ];
    
    // 处理.desktop文件
    for path in paths {
        if let Ok(entries) = std::fs::read_dir(&path) {
            for entry in entries.filter_map(Result::ok) {
                if let Some(file_name) = entry.file_name().to_str() {
                    if file_name.ends_with(".desktop") && !file_name.starts_with(&format!("{}.desktop", self_name)) {
                        // 读取.desktop文件获取应用名称
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
    
    // 添加Snap应用
    if let Ok(output) = Command::new("snap").args(["list"]).output() {
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines().skip(1) { // 跳过标题行
            if let Some(app_name) = line.split_whitespace().next() {
                if app_name != self_name {
                    apps.push(app_name.to_string());
                }
            }
        }
    }
    
    apps.sort();
    apps.dedup();
    apps
}
