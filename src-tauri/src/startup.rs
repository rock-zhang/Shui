use std::ffi::OsStr;
use tauri::Manager;

pub const SILENT_ARG: &str = "--silent";

/// Both process arguments and single-instance callbacks include the executable.
pub fn is_silent_launch<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    args.into_iter()
        .skip(1)
        .any(|arg| arg.as_ref() == SILENT_ARG)
}

pub fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    #[cfg(debug_assertions)]
    eprintln!("[startup] showing settings");
    let window = app
        .get_webview_window("main")
        .ok_or(tauri::Error::WindowNotFound)?;

    if window.is_minimized()? {
        window.unminimize()?;
    }
    window.show()?;
    window.set_focus()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tauri::utils::{config::parse::read_from, platform::Target};

    #[test]
    fn manual_launches_show_settings() {
        assert!(!is_silent_launch(["Shui"]));
        assert!(!is_silent_launch([
            "/Applications/Shui.app/Contents/MacOS/shui"
        ]));
        assert!(!is_silent_launch(["Shui", "-psn_0_12345"]));
    }

    #[test]
    fn autostart_is_silent_even_with_other_arguments() {
        assert!(is_silent_launch(["Shui", "--silent"]));
        assert!(is_silent_launch(["Shui", "--other", "--silent"]));
        assert!(is_silent_launch(["Shui", "--silent", "--other"]));
        // Single-instance callbacks supply owned strings, rather than OsStrings.
        assert!(is_silent_launch(vec![
            "Shui".to_string(),
            SILENT_ARG.to_string()
        ]));
    }

    #[test]
    fn only_an_exact_flag_after_the_executable_enables_silent_launch() {
        for arg in ["--silently", "--silent=false", "--SILENT", "/tmp/--silent"] {
            assert!(!is_silent_launch(["Shui", arg]), "{arg}");
        }
        assert!(!is_silent_launch(["--silent"]));
        assert!(!is_silent_launch(Vec::<String>::new()));
    }

    #[cfg(unix)]
    #[test]
    fn non_unicode_arguments_do_not_break_startup() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt};

        let args = vec![OsString::from("Shui"), OsString::from_vec(vec![0xff])];
        assert!(!is_silent_launch(args.clone()));
        assert!(is_silent_launch(
            args.into_iter().chain([OsString::from(SILENT_ARG)])
        ));
    }

    #[cfg(windows)]
    #[test]
    fn non_unicode_arguments_do_not_break_startup() {
        use std::{ffi::OsString, os::windows::ffi::OsStringExt};

        let args = vec![OsString::from("Shui"), OsString::from_wide(&[0xd800])];
        assert!(!is_silent_launch(args.clone()));
        assert!(is_silent_launch(
            args.into_iter().chain([OsString::from(SILENT_ARG)])
        ));
    }

    #[test]
    fn all_desktop_configs_create_a_hidden_unfocused_main_window() {
        // Use Tauri's platform merge: Linux replaces the entire windows array.
        for target in [Target::MacOS, Target::Windows, Target::Linux] {
            let (value, _) = read_from(target, Path::new(env!("CARGO_MANIFEST_DIR"))).unwrap();
            let config: tauri::Config = serde_json::from_value(value).unwrap();
            let main = config
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .unwrap();
            assert!(
                main.create,
                "{target:?}: the hidden webview must still load"
            );
            assert!(!main.visible, "{target:?}: no initial window flash");
            assert!(!main.focus, "{target:?}: no initial focus theft");
            if target == Target::MacOS {
                assert_eq!(
                    main.background_throttling,
                    Some(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                );
            }
            assert_eq!(main.url, tauri::WebviewUrl::App("setting/".into()));
            assert_eq!(
                config.app.tray_icon.unwrap().id.as_deref(),
                Some("main-tray")
            );
        }
    }
}
