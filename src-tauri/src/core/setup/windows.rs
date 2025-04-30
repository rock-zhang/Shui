use crate::core::store::settings::AppSettings;
use std::sync::atomic::Ordering;
use std::thread::{self, sleep};
use std::time::Duration;
use std::time::Instant;
use tauri::Emitter;

// use super::*;
// use ::windows::Win32::System::SystemServices::{
//     RegisterPowerSettingNotification, GUID_CONSOLE_DISPLAY_STATE, PBT_APMRESUMEAUTOMATIC,
//     PBT_APMSUSPEND,
// };
// use ::windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_POWERBROADCAST};

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
    let timer = Instant::now();
    let elapsed_total = 0;

    while is_running.load(Ordering::SeqCst) {
        let app_settings = AppSettings::load_from_store::<tauri::Wry>(&app_handle);

        // println!("app_settings {:?}", app_settings);
        // 检查非工作状态
        if !app_settings.should_run_timer() {
            let (status, tooltip) = app_settings.get_status_message();
            update_tray_status(&mut tray, status, tooltip);
            sleep(Duration::from_secs(1));
            continue;
        }

        let elapsed_secs = elapsed_total + timer.elapsed().as_secs();

        // 处理白名单应用
        // if is_frontapp_in_whitelist(&app_settings.whitelist_apps) {
        //     elapsed_total = elapsed_secs;
        //     update_tray_status(&mut tray, "暂停", "白名单应用前台运行中");
        //     sleep(Duration::from_secs(1));
        //     timer = Instant::now();
        //     continue;
        // }

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
            println!("timer-complete");
            if let Err(e) = app_handle.emit_to("main", "timer-complete", {}) {
                eprintln!("发送提醒事件失败: {}", e);
            }
            break;
        }

        thread::sleep(Duration::from_secs(1));
    }
}

pub fn monitor_lock_screen() {
    // loop {
    //     // Windows 平台下监听系统锁屏状态
    //     // 这里使用 Windows API 监听系统电源状态变化
    //     let mut msg = MSG::default();
    //     unsafe {
    //         if GetMessageW(&mut msg, None, 0, 0).as_bool() {
    //             if msg.message == WM_POWERBROADCAST {
    //                 let is_locked = match msg.wParam.0 as u32 {
    //                     PBT_APMRESUMEAUTOMATIC => false,
    //                     PBT_APMSUSPEND => true,
    //                     _ => continue,
    //                 };
    //                 IS_RUNNING.store(!is_locked, Ordering::SeqCst);
    //                 let (status, action) = if is_locked {
    //                     ("锁屏", "停止")
    //                 } else {
    //                     ("解锁", "开始")
    //                 };
    //                 println!("系统{}，{}计时", status, action);
    //             }
    //         }
    //     }
    //     thread::sleep(Duration::from_secs(1));
    // }
}
