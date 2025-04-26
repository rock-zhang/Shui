use tauri::{LogicalPosition, Manager};
use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

const NSWindowStyleMaskUtilityWindow: i32 = 1 << 7;

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
                    let position = monitor.position();
                    let _ = win.set_position(LogicalPosition::new(position.x, position.y));
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

            let size = monitor.size();
            let scale_factor = monitor.scale_factor();
            let position = monitor.position();

            // 根据缩放因子调整尺寸
            let scaled_width = size.width as f64 / scale_factor;
            let scaled_height = size.height as f64 / scale_factor;

            println!(
                "Monitor {}: size={:?}, position={:?}, scale_factor={:?}, scaled_size=({:?}, {:?})",
                index, size, position, scale_factor, scaled_width, scaled_height
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
            .focus()
            .inner_size(scaled_width as f64, scaled_height as f64)
            .position(position.x as f64, position.y as f64)
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
