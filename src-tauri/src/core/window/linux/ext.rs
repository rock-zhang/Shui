// Linux特定的窗口扩展功能
use std::process::Command;

pub struct LinuxWindowExt;

impl LinuxWindowExt {
    /// 检测当前桌面环境
    pub fn detect_desktop_environment() -> String {
        if let Ok(desktop) = std::env::var("XDG_CURRENT_DESKTOP") {
            return desktop;
        }

        if let Ok(desktop) = std::env::var("DESKTOP_SESSION") {
            return desktop;
        }

        "unknown".to_string()
    }

    /// 获取屏幕工作区信息
    pub fn get_workspaces() -> Vec<String> {
        let mut workspaces = Vec::new();

        // 尝试通过wmctrl获取工作区
        if let Ok(output) = Command::new("wmctrl").args(["-d"]).output() {
            let output_str = String::from_utf8_lossy(&output.stdout);
            for line in output_str.lines() {
                if let Some(name) = line.split_whitespace().nth(8) {
                    workspaces.push(name.to_string());
                }
            }
        }

        workspaces
    }

    /// 将窗口设置为在所有工作区可见
    pub fn make_visible_on_all_workspaces(window_id: &str) -> bool {
        if let Ok(output) = Command::new("wmctrl")
            .args(["-r", window_id, "-b", "add,sticky"])
            .output()
        {
            return output.status.success();
        }

        false
    }

    /// 检测窗口透明度/合成器支持
    pub fn has_compositing_support() -> bool {
        let desktop = Self::detect_desktop_environment();

        // GNOME和KDE通常支持合成
        if desktop.contains("GNOME") || desktop.contains("KDE") {
            return true;
        }

        // 检查是否有Compositor运行
        if let Ok(output) = Command::new("ps").args(["aux"]).output() {
            let output_str = String::from_utf8_lossy(&output.stdout);
            return output_str.contains("compton")
                || output_str.contains("picom")
                || output_str.contains("compiz")
                || output_str.contains("mutter")
                || output_str.contains("kwin");
        }

        false
    }
}
