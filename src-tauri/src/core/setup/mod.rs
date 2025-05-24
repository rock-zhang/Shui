use crate::commands::pause_timer;
// mod timer;
use crate::timer::IS_RUNNING;
use tauri::Manager;

use std::thread;
use std::time::Duration;

use std::sync::atomic::Ordering;

use crate::core::store::settings::AppSettings;
use crate::core::util::is_frontapp_in_whitelist;
use std::time::Instant;
use tauri::Emitter;

#[cfg(target_os = "macos")]
mod macos;


#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;


#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

struct TimerThreads {
    timer: thread::JoinHandle<()>,
    lock: thread::JoinHandle<()>,
}

pub fn default(app_handle: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }

    let is_running = IS_RUNNING.clone();

    // 启动计时器线程
    let timer_handle = app_handle.clone();
    let timer_thread = thread::Builder::new()
        .name("timer-thread".into())
        .spawn(move || loop {
            if !is_running.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            run_timer(&timer_handle, &is_running);
        })
        .expect("无法创建计时器线程");

    // 启动锁屏监听线程
    let lock_thread = thread::Builder::new()
        .name("lock-monitor-thread".into())
        .spawn(monitor_lock_screen)
        .expect("无法创建锁屏监听线程");

    // 保存线程句柄
    app_handle.manage(TimerThreads {
        timer: timer_thread,
        lock: lock_thread,
    });

    // 设置窗口行为
    let main_window = app_handle.get_webview_window("main").unwrap();
    let window_handle = main_window.clone();
    main_window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window_handle.hide();
                println!("窗口关闭请求被拦截");
            }
            // #[cfg(target_os = "windows")]
            // tauri::WindowEvent::Destroyed => {
            //     // Windows 下窗口最小化时隐藏窗口
            //     let _ = window_handle.hide();
            //     println!("窗口最小化，已隐藏");
            // }
            // #[cfg(target_os = "windows")]
            // tauri::WindowEvent::Focused(focused) => {
            //     if !focused {
            //         // Windows 下窗口失去焦点时保存当前状态
            //         let _ = window_handle.hide();
            //     }
            // }
            _ => {}
        }
    });
}

// 提取计时器逻辑
fn run_timer(app_handle: &tauri::AppHandle, is_running: &std::sync::atomic::AtomicBool) {
    let mut tray = app_handle.tray_by_id("main-tray");
    let mut timer = Instant::now();
    let mut elapsed_total = 0;

    while is_running.load(Ordering::SeqCst) {
        let app_settings = AppSettings::load_from_store::<tauri::Wry>(&app_handle);

        // 检查非工作状态
        if !app_settings.should_run_timer() {
            let (status, tooltip) = app_settings.get_status_message();
            update_tray_status(&mut tray, status, tooltip);
            thread::sleep(Duration::from_secs(1));
            continue;
        }

        let elapsed_secs = elapsed_total + timer.elapsed().as_secs();

        // 处理白名单应用
        if is_frontapp_in_whitelist(&app_settings.whitelist_apps) {
            elapsed_total = elapsed_secs;
            update_tray_status(&mut tray, "暂停", "白名单应用前台运行中");
            thread::sleep(Duration::from_secs(1));
            timer = Instant::now();
            continue;
        }

        let rest = app_settings.gap.saturating_sub(elapsed_secs);

        println!("rest {:?}", rest);

        // 更新托盘倒计时
        if app_settings.is_show_countdown {
            let countdown = format!("{}:{:02}", rest / 60, rest % 60);
            update_tray_status(&mut tray, &countdown, "");
        } else {
            update_tray_status(&mut tray, "", "");
        }

        if rest == 0 && app_settings.should_run_timer() {
            pause_timer();
            if let Err(e) = app_handle.emit_to("main", "timer-complete", {}) {
                eprintln!("发送提醒事件失败: {}", e);
            }
            break;
        }

        thread::sleep(Duration::from_secs(1));
    }
}

// 提取托盘状态更新逻辑
fn update_tray_status(tray: &mut Option<tauri::tray::TrayIcon>, status: &str, tooltip: &str) {
    if let Some(ref tray_handle) = tray {
        let formatted_status = if !status.is_empty() {
            // 使用等宽无衬线字体字符
            let status = status
                .replace("0", "𝟶")
                .replace("1", "𝟷")
                .replace("2", "𝟸")
                .replace("3", "𝟹")
                .replace("4", "𝟺")
                .replace("5", "𝟻")
                .replace("6", "𝟼")
                .replace("7", "𝟽")
                .replace("8", "𝟾")
                .replace("9", "𝟿")
                .replace(":", "∶");
            format!("{}", status)
        } else {
            String::new()
        };
        let _ = tray_handle.set_title(Some(&formatted_status));
        let _ = tray_handle.set_tooltip(Some(tooltip));
    }
}
