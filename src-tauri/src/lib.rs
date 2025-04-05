mod commands;
mod core;
mod timer;
use tauri::{Emitter, Manager};
use timer::{IS_RUNNING, TIMER_STATE};

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

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use std::sync::atomic::Ordering;

use std::time::Instant;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_nspanel::init())
        // .tray(tauri::Tray::new().with_menu(tauri::Menu::new()))
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg(target_os = "macos")]
            {
                let is_running_clone = IS_RUNNING.clone();
                let app_handle = app.handle().clone();
                let app_handle2 = app.app_handle().clone();
                let app_handle3 = app.app_handle().clone();

                // 计时器线程
                thread::spawn(move || loop {
                    println!("计时器线程启动, 外层循环");
                    let remind_gap = 120; // TODO: 提醒间隔由用户设置
                    if is_running_clone.load(Ordering::SeqCst) {
                        // let mut timer = TIMER_STATE.lock();
                        // *timer = Instant::now();
                        println!("开始计时");
                        // 计时开始，记录开始时间
                        let timer = Instant::now();
                        println!("{:?}", timer);

                        while is_running_clone.load(Ordering::SeqCst) {
                            println!("is_running_clone, 里层循环");
                            let elapsed = timer.elapsed();
                            let rest = remind_gap - elapsed.as_secs();
                            println!("计时：{:?}", elapsed);
                            println!("剩余：{:?}", rest);

                            // // 更新托盘菜单显示倒计时
                            // 更新托盘文案
                            let minutes = rest / 60;
                            let seconds = rest % 60;
                            let countdown = format!("剩余 {}:{:02}", minutes, seconds);
                            if let Some(tray) = app_handle2.tray_by_id("main-tray") {
                                if let Err(e) = tray.set_title(Some(countdown.as_str())) {
                                    println!("更新托盘标题失败: {:?}", e);
                                }
                            }

                            if rest <= 0 {
                                println!("计时结束, 满足15秒，拉起提醒页面");

                                // 暂停倒计时
                                IS_RUNNING.store(false, Ordering::SeqCst);
                                // let main_window = app_handle.get_webview_window("main").unwrap();
                                // main_window.show().unwrap();

                                // thread::sleep(Duration::from_secs(4));

                                // 发送事件到前端，包含计时相关数据
                                app_handle
                                    .emit_to(
                                        "main", // 窗口名称
                                        "timer-complete",
                                        {},
                                    )
                                    .unwrap();

                                // commands::show_reminder_page(&app_handle);
                                break;
                            }

                            // if elapsed.as_secs() >= 5 {
                            //     // println!("计时结束, 满足12秒，退出程序");
                            //     // break;

                            //     unsafe {
                            //         TIMER_STATE.force_unlock();

                            //         // 这里拉起喝水提醒页面
                            //     }
                            // }

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
            greet,
            commands::call_reminder,
            commands::setting,
            commands::close_window, // TODO: del
            commands::hide_reminder_windows,
            commands::close_reminder_windows,
            commands::reset_timer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
