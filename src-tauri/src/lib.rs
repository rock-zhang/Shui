mod commands;
mod drink_recording;
mod core;
use core::setup;
mod reminder_history;
mod statistics_export;
mod timer;
mod reminder_session;
mod drink_store;
mod startup;
mod autostart;
#[cfg(feature = "native-smoke")]
mod native_smoke;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
mod data_backup;

pub fn run() {
    // Register first so a second launch cannot start another timer or webview.
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_single_instance::init(
        |app, args, _cwd| {
            if !startup::is_silent_launch(args) {
                if let Err(error) = startup::show_main_window(app) {
                    eprintln!("打开设置窗口失败: {error}");
                }
            }
        },
    ));

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
            Some(vec![startup::SILENT_ARG]),
        ));

    // macOS 特有插件
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init())
    }

    #[cfg(feature = "native-smoke")]
    {
        builder = builder.plugin(native_smoke::init());
    }

    builder
        .setup(|app| {
            let app_handle = app.app_handle();
            data_backup::init(&app_handle)?;

            reminder_history::init(&app_handle);
            setup::default(&app_handle);

            // The main webview and tray load even when the window stays hidden.
            let silent = startup::is_silent_launch(std::env::args_os());
            if !silent {
                startup::show_main_window(&app_handle)?;
            }

            #[cfg(debug_assertions)]
            if let Some(main) = app_handle.get_webview_window("main") {
                eprintln!(
                    "[startup] silent={silent}, visible={:?}, focused={:?}",
                    main.is_visible(),
                    main.is_focused()
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::autostart::enable_silent_autostart,
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
            crate::data_backup::export_drink_backup,
            crate::data_backup::preview_drink_import,
            crate::data_backup::confirm_drink_import,
            commands::start_timer,
            commands::get_app_runtime_info,
            commands::get_installed_apps,
            crate::statistics_export::save_drink_history_csv,
            commands::quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Finder reopens an existing app without spawning a second process.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Err(error) = startup::show_main_window(_app) {
                    eprintln!("重新打开设置窗口失败: {error}");
                }
            }
        });
}
