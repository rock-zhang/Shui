use crate::core::store::settings::AppSettings;
use crate::core::util::whitelist::is_frontapp_in_whitelist;
use crate::timer::IS_RUNNING;
use tauri::Emitter;

use std::thread::{self, sleep};
use std::time::Duration;

use std::sync::atomic::Ordering;
use std::time::Instant;

// 提取托盘状态更新逻辑
fn update_tray_status(tray: &mut Option<tauri::tray::TrayIcon>, status: &str, tooltip: &str) {
    if let Some(ref tray_handle) = tray {
        let _ = tray_handle.set_title(Some(status));
        let _ = tray_handle.set_tooltip(Some(tooltip));
    }
}

// 提取计时器逻辑
pub fn run_timer(app_handle: &tauri::AppHandle, is_running: &std::sync::atomic::AtomicBool) {
    let mut tray = app_handle.tray_by_id("main-tray");
    let mut timer = Instant::now();
    let mut elapsed_total = 0;

    while is_running.load(Ordering::SeqCst) {
        let app_settings = AppSettings::load_from_store::<tauri::Wry>(&app_handle);

        // 检查非工作状态
        if !app_settings.should_run_timer() {
            let (status, tooltip) = app_settings.get_status_message();
            update_tray_status(&mut tray, status, tooltip);
            sleep(Duration::from_secs(1));
            continue;
        }

        let elapsed_secs = elapsed_total + timer.elapsed().as_secs();

        // 处理白名单应用
        if is_frontapp_in_whitelist(&app_settings.whitelist_apps) {
            elapsed_total = elapsed_secs;
            update_tray_status(&mut tray, "暂停", "白名单应用前台运行中");
            sleep(Duration::from_secs(1));
            timer = Instant::now();
            continue;
        }

        let rest = app_settings.gap.saturating_sub(elapsed_secs);

        // 更新托盘倒计时
        if app_settings.is_show_countdown {
            let countdown = format!("{}:{:02}", rest / 60, rest % 60);
            update_tray_status(&mut tray, &countdown, "");
        } else {
            update_tray_status(&mut tray, "", "");
        }

        if rest == 0 && app_settings.should_run_timer() {
            is_running.store(false, Ordering::SeqCst);
            if let Err(e) = app_handle.emit_to("main", "timer-complete", {}) {
                eprintln!("发送提醒事件失败: {}", e);
            }
            break;
        }

        thread::sleep(Duration::from_secs(1));
    }
}

extern crate core_foundation;
// #[cfg(target_os = "macos")]
// extern crate core_graphics;

// use super::*;
use core_foundation::{base::TCFType, base::ToVoid, dictionary::CFDictionary, string::CFString};

extern "C" {
    fn CGSessionCopyCurrentDictionary() -> core_foundation::dictionary::CFDictionaryRef;
}

pub fn monitor_lock_screen() {
    let mut previous_lock_state = false;
    let lock_key = CFString::new("CGSSessionScreenIsLocked");

    loop {
        unsafe {
            let session_dictionary_ref = CGSessionCopyCurrentDictionary();
            let session_dictionary: CFDictionary =
                CFDictionary::wrap_under_create_rule(session_dictionary_ref);
            let current_lock_state = session_dictionary.find(lock_key.to_void()).is_some();

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
        }
        thread::sleep(Duration::from_secs(1));
    }
}
