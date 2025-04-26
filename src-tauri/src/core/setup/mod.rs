// mod timer;
use crate::timer::IS_RUNNING;
use tauri::Manager;

use std::thread;
use std::time::Duration;

use std::sync::atomic::Ordering;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use windows::*;

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
    // let app_handle = app.app_handle();

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
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_handle.hide();
            println!("窗口关闭请求被拦截");
        }
    });
}
