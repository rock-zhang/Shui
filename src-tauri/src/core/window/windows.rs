use tauri::{LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn show_reminder(app_handle: &tauri::AppHandle) {
    println!("[windows] show_reminder");

    // 优化检查逻辑，避免重复代码
    if let Ok(monitors) = app_handle.available_monitors() {
        let needs_create = !monitors.iter().enumerate().any(|(index, _)| {
            let reminder_label = format!("reminder_{}", index);
            app_handle.get_webview_window(&reminder_label).is_some()
        });

        if needs_create {
            show_or_create_reminder_window(app_handle);
        } else {
            update_existing_windows(app_handle, &monitors);
        }
    }
}

// 新增函数：更新现有窗口
fn update_existing_windows(app_handle: &tauri::AppHandle, monitors: &Vec<tauri::Monitor>) {
    for (index, monitor) in monitors.iter().enumerate() {
        let reminder_label = format!("reminder_{}", index);

        if let Some(window) = app_handle.get_webview_window(&reminder_label) {
            let position = monitor.position();
            let _ = window.set_position(LogicalPosition::new(position.x, position.y));
            let _ = window.show();
        }
    }
}

fn show_or_create_reminder_window(app_handle: &tauri::AppHandle) {
    if let Ok(monitors) = app_handle.available_monitors() {
        for (index, monitor) in monitors.iter().enumerate() {
            let reminder_label = format!("reminder_{}", index);

            // 如果窗口已存在则显示
            if let Some(window) = app_handle.get_webview_window(&reminder_label) {
                let _ = window.show();
                continue;
            }

            // 计算窗口尺寸和位置
            let (scaled_width, scaled_height, position) = calculate_window_metrics(monitor);

            println!(
                "Monitor {}: position={:?}, scale_factor={:?}, scaled_size=({:?}, {:?})",
                index,
                position,
                monitor.scale_factor(),
                scaled_width,
                scaled_height
            );

            // 创建新窗口
            create_reminder_window(
                app_handle,
                &reminder_label,
                scaled_width,
                scaled_height,
                position,
            );
        }
    }
}

// 新增函数：计算窗口度量
fn calculate_window_metrics(monitor: &tauri::Monitor) -> (f64, f64, tauri::PhysicalPosition<i32>) {
    let size = monitor.size();
    let scale_factor = monitor.scale_factor();
    let position = monitor.position();

    let scaled_width = size.width as f64 / scale_factor;
    let scaled_height = size.height as f64 / scale_factor;

    (scaled_width, scaled_height, *position)
}

// 新增函数：创建提醒窗口
fn create_reminder_window(
    app_handle: &tauri::AppHandle,
    label: &str,
    width: f64,
    height: f64,
    position: tauri::PhysicalPosition<i32>,
) {
    let _ = WebviewWindowBuilder::new(app_handle, label, WebviewUrl::App("reminder/".into()))
        // .decorations(false)
        // .transparent(true)
        // .always_on_top(true)
        .fullscreen(false)
        .inner_size(width, height)
        .position(position.x as f64, position.y as f64)
        .build()
        .expect(&format!("failed to create reminder window {}", label));
}

pub fn hide_reminder(app_handle: &tauri::AppHandle) {
    if let Ok(monitors) = app_handle.available_monitors() {
        for (index, _) in monitors.iter().enumerate() {
            let reminder_label = format!("reminder_{}", index);
            if let Some(window) = app_handle.get_webview_window(&reminder_label) {
                let _ = window.hide();
            }
        }
    }
}

pub fn hide_reminder_single(app_handle: &tauri::AppHandle, label: &str) {
    if let Some(window) = app_handle.get_webview_window(label) {
        let _ = window.hide();
    }
}
