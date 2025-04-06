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
                let mut remind_gap = 1200;
                let app_handle = app.handle().clone();
                let app_handle2 = app.app_handle().clone();

                let store = app.store("config_store.json")?;
                let app_settings = AppSettings::load_from_store(&store);
                remind_gap = app_settings.gap;

                // 计时器线程
                thread::spawn(move || loop {
                    // TODO: 检查是否在工作日期、时间范围内
                    // TODO: 检查是否已经达到目标喝水次数
                    // TODO: 跨天逻辑检查
                    println!("计时器线程启动");

                    if is_running_clone.load(Ordering::SeqCst) {
                        // 计时开始，记录开始时间
                        let timer = Instant::now();
                        let app_settings = AppSettings::load_from_store(&store);
                        remind_gap = app_settings.gap;
                        println!("timer {:?}，remind_gap {:?}", timer, remind_gap);

                        while is_running_clone.load(Ordering::SeqCst) {
                            let elapsed = timer.elapsed();
                            let rest = remind_gap - elapsed.as_secs();
                            println!("计时：{:?}，剩余：{:?}", elapsed, rest);

                            let minutes = rest / 60;
                            let seconds = rest % 60;
                            let countdown = format!("{}:{:02}", minutes, seconds);
                            // 更新托盘菜单显示倒计时
                            let tray_text = if app_settings.is_show_countdown {
                                countdown
                            } else {
                                String::new()
                            };

                            if let Some(tray) = app_handle2.tray_by_id("main-tray") {
                                // 更新托盘文案
                                if let Err(e) = tray.set_title(Some(tray_text.as_str())) {
                                    println!("更新托盘标题失败: {:?}", e);
                                }
                            }

                            if rest <= 0 {
                                println!("倒计时结束, 拉起提醒页面");

                                // 暂停倒计时
                                IS_RUNNING.store(false, Ordering::SeqCst);

                                if app_settings.is_work_day
                                    && app_settings.is_in_time_range
                                    && app_settings.today_drink_amount < app_settings.gold
                                {
                                    // 发送事件到前端，包含计时相关数据
                                    app_handle
                                        .emit_to(
                                            "main", // 窗口名称
                                            "timer-complete",
                                            {},
                                        )
                                        .unwrap();
                                }

                                break;
                            }

                            thread::sleep(Duration::from_secs(1));
                        }
                    }
                    thread::sleep(Duration::from_millis(100));
                });

                // 锁屏监听线程
                thread::spawn(move || {
                    let mut flg = false;
                    let lock_key = CFString::new("CGSSessionScreenIsLocked");
                    loop {
                        unsafe {
                            let session_dictionary_ref = CGSessionCopyCurrentDictionary();
                            let session_dictionary: CFDictionary =
                                CFDictionary::wrap_under_create_rule(session_dictionary_ref);
                            let current_session_property =
                                session_dictionary.find(lock_key.to_void()).is_some();

                            if flg != current_session_property {
                                flg = current_session_property;
                                IS_RUNNING.store(!current_session_property, Ordering::SeqCst);
                                println!(
                                    "系统{}，{}计时",
                                    if current_session_property {
                                        "锁屏"
                                    } else {
                                        "解锁"
                                    },
                                    if current_session_property {
                                        "停止"
                                    } else {
                                        "开始"
                                    }
                                );
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
            commands::close_reminder_windows,
            commands::reset_timer,
            commands::quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
