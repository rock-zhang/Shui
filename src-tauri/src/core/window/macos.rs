use tauri::{LogicalPosition, LogicalSize, Manager};
use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

const NSWindowStyleMaskUtilityWindow: i32 = 1 << 7;

// 窗口度量结构体
#[derive(Debug, Clone)]
struct WindowMetrics {
    scaled_width: f64,
    scaled_height: f64,
    scaled_position: LogicalPosition<f64>,
}

// 统一的窗口度量计算函数，提供精确的缩放和舍入
fn calculate_window_metrics(monitor: &tauri::Monitor) -> WindowMetrics {
    let size = monitor.size();
    let scale_factor = monitor.scale_factor();
    let position = monitor.position();

    // 添加舍入处理，确保像素对齐
    let scaled_width = (size.width as f64 / scale_factor).round();
    let scaled_height = (size.height as f64 / scale_factor).round();
    let scaled_position = LogicalPosition::new(
        (position.x as f64 / scale_factor).round(),
        (position.y as f64 / scale_factor).round(),
    );

    WindowMetrics {
        scaled_width,
        scaled_height,
        scaled_position,
    }
}

pub fn show_reminder(app_handle: &tauri::AppHandle) {
    println!("[macos] show_reminder");

    if let Ok(panel) = app_handle.get_webview_panel("reminder_0") {
        if let Ok(monitors) = app_handle.available_monitors() {
            for (index, monitor) in monitors.iter().enumerate() {
                let reminder_label = format!("reminder_{}", index);

                println!("[macos] show_reminder_windows: {}", reminder_label);

                // 检查是否已存在提醒窗口
                if let Ok(panel) = app_handle.get_webview_panel(&reminder_label) {
                    let win = app_handle.get_webview_window(&reminder_label).unwrap();

                    // 使用统一的计算函数
                    let metrics = calculate_window_metrics(monitor);

                    println!(
                        "更新窗口 {}: 新尺寸=({:.0}, {:.0}), 新位置={:?}",
                        reminder_label,
                        metrics.scaled_width,
                        metrics.scaled_height,
                        metrics.scaled_position
                    );

                    // 同时更新尺寸和位置，确保占满全屏
                    let _ = win.set_size(LogicalSize::new(
                        metrics.scaled_width,
                        metrics.scaled_height,
                    ));
                    let _ = win.set_position(metrics.scaled_position);
                    panel.show();
                } else {
                    // 接入新的外接屏幕，需要重新创建Window
                    show_or_create_reminder_window(&app_handle);
                }
            }
        }
    } else {
        show_or_create_reminder_window(&app_handle);
    }
}

fn show_or_create_reminder_window(app_handle: &tauri::AppHandle) {
    if let Ok(monitors) = app_handle.available_monitors() {
        for (index, monitor) in monitors.iter().enumerate() {
            let reminder_label = format!("reminder_{}", index);

            // 检查是否已存在提醒窗口
            if let Ok(panel) = app_handle.get_webview_panel(&reminder_label) {
                panel.show();
                continue;
            }

            // 使用统一的计算函数
            let metrics = calculate_window_metrics(monitor);

            println!(
                "创建窗口 {}: size={:?}, position={:?}, scale_factor={:.2}, scaled_size=({:.0}, {:.0})",
                index, monitor.size(), monitor.position(), monitor.scale_factor(), 
                metrics.scaled_width, metrics.scaled_height
            );

            let window = tauri::WebviewWindowBuilder::new(
                app_handle,
                format!("reminder_{}", index),
                tauri::WebviewUrl::App("reminder/".into()),
            )
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .inner_size(metrics.scaled_width, metrics.scaled_height)
            .position(metrics.scaled_position.x, metrics.scaled_position.y)
            .build()
            .expect(&format!("failed to create reminder window {}", index));

            let panel = window.to_panel().unwrap();
            panel.set_level(26);

            panel.set_style_mask(NSWindowStyleMaskUtilityWindow);

            // // 在各个桌面空间、全屏中共享窗口
            panel.set_collection_behaviour(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
            );
        }
    }
}

pub fn hide_reminder(app_handle: &tauri::AppHandle) {
    if let Ok(monitors) = app_handle.available_monitors() {
        for (index, monitor) in monitors.iter().enumerate() {
            let reminder_label = format!("reminder_{}", index);

            println!("hide_reminder_windows: {}", reminder_label); // 打印 reminder_label 的值，以检查是否正确获取了窗口标签

            // 检查是否已存在提醒窗口
            if let Ok(panel) = app_handle.get_webview_panel(&reminder_label) {
                panel.order_out(None);
            }
        }
    }
}

pub fn hide_reminder_single(app_handle: &tauri::AppHandle, label: &str) {
    if let Ok(panel) = app_handle.get_webview_panel(&label) {
        panel.order_out(None);
    }
}
