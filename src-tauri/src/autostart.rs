#[cfg(target_os = "linux")]
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

/// Keep the plugin's registration/status handling, but quote executable paths
/// omitted by the locked auto-launch 0.5 implementation on Windows and Linux.
#[tauri::command]
pub fn enable_silent_autostart(app_handle: tauri::AppHandle) -> Result<(), String> {
    enable(&app_handle)
}

pub fn enable(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let directory = app
            .path()
            .home_dir()
            .map_err(|e| e.to_string())?
            .join(".config/autostart");
        std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    }
    app.autolaunch().enable().map_err(|e| e.to_string())?;
    if let Err(error) = quote_registration(app) {
        // A failed correction must not leave a newly enabled, broken entry.
        let _ = app.autolaunch().disable();
        return Err(error);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn quote_registration(_app: &tauri::AppHandle) -> Result<(), String> {
    // LaunchAgent ProgramArguments is already an array of literal arguments.
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
fn windows_command(executable: &str) -> String {
    format!("\"{executable}\" {}", crate::startup::SILENT_ARG)
}

#[cfg(target_os = "windows")]
fn quote_registration(app: &tauri::AppHandle) -> Result<(), String> {
    use windows::{core::HSTRING, Win32::System::Registry::*};

    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let command = windows_command(&executable.to_string_lossy());
    let bytes: Vec<u8> = command
        .encode_utf16()
        .chain([0])
        .flat_map(u16::to_le_bytes)
        .collect();
    let mut key = HKEY::default();
    let result = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(r"Software\Microsoft\Windows\CurrentVersion\Run"),
            0,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    if result.0 != 0 {
        return Err(format!("无法打开自启动注册表项: {}", result.0));
    }
    let result = unsafe {
        RegSetValueExW(
            key,
            &HSTRING::from(app.package_info().name.as_str()),
            0,
            REG_SZ,
            Some(&bytes),
        )
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if result.0 != 0 {
        return Err(format!("无法保存自启动命令: {}", result.0));
    }
    Ok(())
}

#[cfg(any(target_os = "linux", test))]
fn desktop_command(executable: &str) -> Result<String, String> {
    if executable.contains(['\0', '\n', '\r', '=']) {
        return Err("安装路径包含 desktop Exec 不支持的字符".into());
    }
    // Exec quoting is decoded after the desktop-entry string escape layer.
    // Literal '%' must not become a field code such as %f or %u.
    let quoted = executable
        .replace('%', "%%")
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
        .replace('$', "\\$");
    Ok(format!("\"{quoted}\" {}", crate::startup::SILENT_ARG).replace('\\', "\\\\"))
}

#[cfg(target_os = "linux")]
fn quote_registration(app: &tauri::AppHandle) -> Result<(), String> {
    let executable = match app.env().appimage {
        Some(path) if path.to_str().is_some() => std::path::PathBuf::from(path),
        _ => std::env::current_exe().map_err(|e| e.to_string())?,
    };
    let command = desktop_command(&executable.to_string_lossy())?;
    let path = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join(".config/autostart")
        .join(format!("{}.desktop", app.package_info().name));
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let contents = contents
        .lines()
        .map(|line| {
            if line.starts_with("Exec=") {
                format!("Exec={command}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_keeps_a_spaced_install_path_as_one_executable() {
        assert_eq!(
            windows_command(r"C:\Program Files\Shui\shui.exe"),
            r#""C:\Program Files\Shui\shui.exe" --silent"#
        );
    }

    #[test]
    fn desktop_keeps_a_spaced_install_path_as_one_executable() {
        assert_eq!(
            desktop_command("/home/user/My Apps/shui").unwrap(),
            r#""/home/user/My Apps/shui" --silent"#
        );
    }

    #[test]
    fn desktop_escapes_field_codes_and_both_quoting_layers() {
        assert_eq!(
            desktop_command("/home/user/100%/shui").unwrap(),
            r#""/home/user/100%%/shui" --silent"#
        );
        assert_eq!(
            desktop_command("/home/user/$apps/shui").unwrap(),
            r#""/home/user/\\$apps/shui" --silent"#
        );
        assert_eq!(
            desktop_command(r"/home/user/a\b/shui").unwrap(),
            r#""/home/user/a\\\\b/shui" --silent"#
        );
    }

    #[test]
    fn desktop_rejects_paths_that_could_corrupt_the_entry() {
        for path in [
            "/tmp/a\nb/shui",
            "/tmp/a\rb/shui",
            "/tmp/a\0b/shui",
            "/tmp/a=b/shui",
        ] {
            assert!(desktop_command(path).is_err());
        }
    }
}
