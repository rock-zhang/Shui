mod commands;
mod core;
use core::setup;
mod timer;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
#[cfg(target_os = "windows")]
use tauri_plugin_autostart::WindowsLauncher;

pub fn run() {
    let mut builder = tauri::Builder::default();

    // 通用插件
    builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build());

    // 根据操作系统配置自启动
  
        builder = builder.plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--silent"]),
        ));


    // macOS 特有插件
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init())
    }

    builder
        .setup(|app| {
            let app_handle = app.app_handle();

            setup::default(&app_handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::call_reminder,
            commands::setting,
            commands::hide_reminder_windows,
            commands::hide_reminder_window,
            commands::reset_timer,
            commands::pause_timer,
            commands::start_timer,
            commands::get_app_runtime_info,
            commands::get_installed_apps,
            commands::quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
