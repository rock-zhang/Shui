mod commands;
mod drink_recording;
mod core;
use core::setup;
mod reminder_history;
mod statistics_export;
mod timer;
mod reminder_session;
mod drink_store;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

pub fn run() {
    let mut builder = tauri::Builder::default();

    // 通用插件
    builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
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

            reminder_history::init(&app_handle);
            setup::default(&app_handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::drink_recording::record_drink,
            crate::drink_recording::undo_drink,
            commands::call_reminder,
            commands::setting,
            commands::hide_reminder_windows,
            commands::hide_reminder_window,
            crate::reminder_session::get_reminder_session,
            crate::reminder_session::record_reminder_drink,
            commands::reset_timer,
            commands::pause_timer,
            commands::start_timer,
            commands::get_app_runtime_info,
            commands::get_installed_apps,
            crate::statistics_export::save_drink_history_csv,
            commands::quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
