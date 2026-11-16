mod commands;
mod core;
mod data_backup;
mod drink_recording;
mod drink_store;
mod reminder_history;
mod reminder_session;
mod timer;

#[cfg(not(target_os = "android"))]
mod autostart;
#[cfg(not(target_os = "android"))]
mod startup;
#[cfg(not(target_os = "android"))]
mod statistics_export;
#[cfg(target_os = "android")]
mod mobile;
#[cfg(feature = "native-smoke")]
mod native_smoke;

#[cfg(not(target_os = "android"))]
use crate::core::setup;
#[cfg(not(target_os = "android"))]
use tauri_plugin_autostart::MacosLauncher;
use tauri::Manager;

/// `mobile_entry_point` is required by the Tauri Android/iOS runtime: the
/// native Activity loads the cdylib and calls this symbol instead of `main`.
#[cfg_attr(target_os = "android", tauri::mobile_entry_point)]
pub fn run() {
    // Register first so a second launch cannot start another timer or webview.
    #[cfg(not(target_os = "android"))]
    let mut builder = tauri::Builder::default().plugin(
        tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !startup::is_silent_launch(args) {
                if let Err(error) = startup::show_main_window(app) {
                    eprintln!("打开设置窗口失败: {error}");
                }
            }
        }),
    );

    #[cfg(target_os = "android")]
    let mut builder = tauri::Builder::default();

    // 桌面与移动端共用：数据存储、通知、对话框、外部打开、剪贴板、系统信息。
    builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(not(target_os = "android"))]
    {
        builder = builder
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                Some(vec![startup::SILENT_ARG]),
            ));
    }

    // Android 原生桥：AlarmManager 精确闹钟、通知 Action、SAF 导入、系统分享。
    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("shui-mobile")
                .setup(|app, api| {
                    let handle =
                        api.register_android_plugin("com.shui.app", "ReminderPlugin")?;
                    app.manage(mobile::MobileBridge(handle));
                    Ok(())
                })
                .build(),
        );
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init())
    }

    #[cfg(feature = "native-smoke")]
    {
        builder = builder.plugin(native_smoke::init());
    }

    let builder = builder
        .setup(|app| {
            let app_handle = app.app_handle();
            data_backup::init(&app_handle)?;
            reminder_history::init(&app_handle);

            #[cfg(not(target_os = "android"))]
            {
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
            }

            #[cfg(target_os = "android")]
            mobile::setup(&app_handle)?;

            Ok(())
        });

    #[cfg(not(target_os = "android"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
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
    ]);

    // 移动端只暴露平台真正支持的命令；导出/备份走 SAF + 系统分享，
    // 提醒调度走原生闹钟，统计仍复用同一套 Rust 业务代码。
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        crate::drink_recording::record_drink,
        crate::drink_recording::undo_drink,
        mobile::call_reminder,
        mobile::begin_mobile_reminder,
        mobile::finalize_mobile_reminder,
        commands::hide_reminder_windows,
        commands::hide_reminder_window,
        crate::reminder_session::get_reminder_session,
        crate::reminder_session::record_reminder_drink,
        mobile::reset_timer,
        mobile::pause_timer,
        mobile::start_timer,
        mobile::sync_reminder_schedule,
        mobile::send_mobile_notification,
        mobile::open_battery_settings,
        mobile::set_system_bar_theme,
        mobile::consume_pending_reminder,
        mobile::is_exact_alarm_granted,
        mobile::open_exact_alarm_settings,
        mobile::is_battery_optimization_ignored,
        mobile::open_notification_settings,
        mobile::export_drink_backup,
        mobile::preview_drink_import,
        crate::data_backup::confirm_drink_import,
        mobile::save_drink_history_csv,
        commands::get_app_runtime_info
    ]);

    builder
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
