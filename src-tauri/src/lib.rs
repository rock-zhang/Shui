mod commands;
mod core;
use core::store::settings::AppSettings;
mod timer;
use tauri::{Emitter, Manager};
use timer::IS_RUNNING;

#[cfg(target_os = "macos")]
extern crate core_foundation;
#[cfg(target_os = "macos")]
extern crate core_graphics;

use std::thread::{self, sleep};
use std::time::Duration;

#[cfg(target_os = "macos")]
extern "C" {
    fn CGSessionCopyCurrentDictionary() -> core_foundation::dictionary::CFDictionaryRef;
}

#[cfg(target_os = "macos")]
use core_foundation::{base::TCFType, base::ToVoid, dictionary::CFDictionary, string::CFString};

use std::sync::atomic::Ordering;
use std::time::Instant;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--test_args=1"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_nspanel::init())
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg(target_os = "macos")]
            {
                let is_running_clone = IS_RUNNING.clone();
                let app_handle = app.app_handle().clone();

                // 计时器线程
                thread::spawn(move || {
                    let mut tray = app_handle.tray_by_id("main-tray");

                    loop {
                        if !is_running_clone.load(Ordering::SeqCst) {
                            thread::sleep(Duration::from_millis(100));
                            continue;
                        }

                        let app_settings = AppSettings::load_from_store::<tauri::Wry>(&app_handle);

                        // 更新托盘状态
                        fn update_tray_status(
                            tray: &mut Option<tauri::tray::TrayIcon>,
                            status: &str,
                            tooltip: &str,
                        ) {
                            if let Some(ref tray_handle) = tray {
                                let _ = tray_handle.set_title(Some(status));
                                let _ = tray_handle.set_tooltip(Some(tooltip));
                            }
                        }

                        // 检查工作状态
                        if !app_settings.is_work_day
                            || !app_settings.is_in_time_range
                            || app_settings.today_drink_amount >= app_settings.gold
                        {
                            let (status, tooltip) =
                                if app_settings.today_drink_amount >= app_settings.gold {
                                    ("已达标", "太棒啦，再接再厉")
                                } else {
                                    ("Shui", "非工作日或非工作时间")
                                };
                            update_tray_status(&mut tray, status, tooltip);
                            sleep(Duration::from_secs(1));
                            continue;
                        }

                        // 计时开始
                        let timer = Instant::now();
                        println!("开始计时，间隔：{} 秒", app_settings.gap);

                        while is_running_clone.load(Ordering::SeqCst) {
                            let elapsed_secs = timer.elapsed().as_secs();

                            // 检查是否需要重新加载设置
                            let app_settings =
                                AppSettings::load_from_store::<tauri::Wry>(&app_handle);

                            let rest = if elapsed_secs >= app_settings.gap {
                                0
                            } else {
                                app_settings.gap - elapsed_secs
                            };

                            // 更新托盘显示
                            if app_settings.is_show_countdown && rest >= 0 {
                                let countdown = format!("{}:{:02}", rest / 60, rest % 60);
                                update_tray_status(&mut tray, &countdown, "");
                            }

                            // 检查是否需要触发提醒
                            if rest == 0 {
                                println!("倒计时结束，准备提醒");
                                IS_RUNNING.store(false, Ordering::SeqCst);

                                if app_settings.is_work_day
                                    && app_settings.is_in_time_range
                                    && app_settings.today_drink_amount < app_settings.gold
                                {
                                    if let Err(e) = app_handle.emit_to("main", "timer-complete", {})
                                    {
                                        println!("发送提醒事件失败: {}", e);
                                    }
                                }
                                break;
                            }

                            thread::sleep(Duration::from_secs(1));
                        }
                    }
                });

                // 锁屏监听线程
                thread::spawn(move || {
                    let mut previous_lock_state = false;
                    let lock_key = CFString::new("CGSSessionScreenIsLocked");
                    loop {
                        unsafe {
                            let session_dictionary_ref = CGSessionCopyCurrentDictionary();
                            let session_dictionary: CFDictionary =
                                CFDictionary::wrap_under_create_rule(session_dictionary_ref);
                            let current_lock_state =
                                session_dictionary.find(lock_key.to_void()).is_some();

                            if previous_lock_state != current_lock_state {
                                previous_lock_state = current_lock_state;
                                IS_RUNNING.store(!current_lock_state, Ordering::SeqCst);
                                let (status, action) = if current_lock_state {
                                    ("锁屏", "停止")
                                } else {
                                    ("解锁", "开始")
                                };
                                println!("系统{}，{}计时", status, action);
                            }
                            thread::sleep(Duration::from_millis(1000));
                        }
                    }
                });
            }

            // panel::platform(app, app.get_webview_window("main").unwrap());

            let main_window = app.get_webview_window("main").unwrap();
            let window_handle = main_window.clone();
            // 监听窗口关闭请求事件
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    // 隐藏窗口而不是关闭
                    window_handle.hide().unwrap();
                    println!("窗口关闭请求被拦截");
                }
            });

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
            commands::quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
