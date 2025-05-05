use tauri::{LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};
use x11_dl::xlib;

pub fn show_reminder(app_handle: &tauri::AppHandle) {
    println!("[linux] show_reminder");

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

fn update_existing_windows(app_handle: &tauri::AppHandle, monitors: &Vec<tauri::Monitor>) {
    for (index, monitor) in monitors.iter().enumerate() {
        let reminder_label = format!("reminder_{}", index);

        if let Some(window) = app_handle.get_webview_window(&reminder_label) {
            let position = monitor.position();
            let _ = window.set_position(LogicalPosition::new(position.x, position.y));
            let _ = window.show();
            set_window_always_on_top(&window);
        }
    }
}

fn show_or_create_reminder_window(app_handle: &tauri::AppHandle) {
    if let Ok(monitors) = app_handle.available_monitors() {
        for (index, monitor) in monitors.iter().enumerate() {
            let reminder_label = format!("reminder_{}", index);

            if let Some(window) = app_handle.get_webview_window(&reminder_label) {
                let _ = window.show();
                set_window_always_on_top(&window);
                continue;
            }

            let (scaled_width, scaled_height, position) = calculate_window_metrics(monitor);

            println!(
                "Monitor {}: position={:?}, scale_factor={:?}, scaled_size=({:?}, {:?})",
                index,
                position,
                monitor.scale_factor(),
                scaled_width,
                scaled_height
            );

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

fn calculate_window_metrics(monitor: &tauri::Monitor) -> (f64, f64, tauri::PhysicalPosition<i32>) {
    let size = monitor.size();
    let scale_factor = monitor.scale_factor();
    let position = monitor.position();

    let scaled_width = size.width as f64 / scale_factor;
    let scaled_height = size.height as f64 / scale_factor;

    (scaled_width, scaled_height, *position)
}

fn create_reminder_window(
    app_handle: &tauri::AppHandle,
    label: &str,
    width: f64,
    height: f64,
    position: tauri::PhysicalPosition<i32>,
) {
    let window = WebviewWindowBuilder::new(app_handle, label, WebviewUrl::App("reminder/".into()))
        .decorations(false)
        .transparent(true)
        .inner_size(width, height)
        .position(position.x as f64, position.y as f64)
        .build()
        .expect(&format!("failed to create reminder window {}", label));

    set_window_always_on_top(&window);
}

fn set_window_always_on_top(window: &tauri::Window) {
    if let Some(window_handle) = window.gtk_window() {
        unsafe {
            window_handle.set_keep_above(true);
        }
    }
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
