use tauri::{LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};
use gtk::prelude::*;
use crate::core::window::linux_utils::LinuxWindowExt;

pub fn show_reminder(app_handle: &tauri::AppHandle) {
    println!("[linux] show_reminder");

    // 检查合成器支持
    let has_compositing = LinuxWindowExt::has_compositing_support();
    if !has_compositing {
        println!("警告: 系统可能不支持窗口透明度，提醒窗口可能显示不正确");
    }

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
            let scale_factor = monitor.scale_factor();
            let scaled_position = LogicalPosition::new(
                position.x as f64 / scale_factor,
                position.y as f64 / scale_factor
            );
        
            println!("position {:?}, scale_factor {}, scaled_position {:?}", position, scale_factor, scaled_position);
            let _ = window.set_position(scaled_position);
            let _ = window.show();
            set_window_always_on_top(&window);
            
            // 尝试在所有工作区显示
            if let Ok(id) = window.title() {
                let _ = LinuxWindowExt::make_visible_on_all_workspaces(&id);
            }
        }
    }
}

fn show_or_create_reminder_window(app_handle: &tauri::AppHandle) {
    if let Ok(monitors) = app_handle.available_monitors() {
        // 检测桌面环境
        let desktop_env = LinuxWindowExt::detect_desktop_environment();
        println!("当前桌面环境: {}", desktop_env);
        
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
    let scaled_position = tauri::PhysicalPosition::new(
        (position.x as f64 / scale_factor) as i32,
        (position.y as f64 / scale_factor) as i32
    );

    (scaled_width, scaled_height, scaled_position)
}

fn create_reminder_window(
    app_handle: &tauri::AppHandle,
    label: &str,
    width: f64,
    height: f64,
    position: tauri::PhysicalPosition<i32>,
) {
    // 针对不同桌面环境调整窗口参数
    let desktop_env = LinuxWindowExt::detect_desktop_environment();
    let (use_decorations, use_transparency) = match desktop_env.as_str() {
        // GNOME和KDE通常有良好的透明度支持
        env if env.contains("GNOME") || env.contains("KDE") => (false, true),
        // 其他环境可能需要调整
        _ => {
            if LinuxWindowExt::has_compositing_support() {
                (false, true)
            } else {
                (false, false)
            }
        }
    };

    let mut builder = WebviewWindowBuilder::new(app_handle, label, WebviewUrl::App("reminder/".into()))
        .decorations(use_decorations)
        .transparent(use_transparency)
        .always_on_top(true)  // 确保窗口总是在顶层
        .skip_taskbar(true)   // 在任务栏中隐藏
        .inner_size(width, height)
        .position(position.x as f64, position.y as f64);

    let window = builder.build()
        .expect(&format!("failed to create reminder window {}", label));

    // 设置窗口属性以覆盖dock
    if let Ok(gtk_window) = window.gtk_window() {
        println!("设置窗口属性");
        
        // 设置为特殊的窗口类型
        gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Splashscreen);
        
        // 设置窗口为全屏
        gtk_window.fullscreen();
        
        // 确保窗口总是在顶层
        gtk_window.set_keep_above(true);
        
        // 禁用窗口装饰
        gtk_window.set_decorated(false);
        
        // 设置窗口为全局显示
        gtk_window.stick();
        
        // 禁用焦点
        gtk_window.set_accept_focus(false);
        gtk_window.set_can_focus(false);
        
        // 设置为跳过窗口管理器
        gtk_window.set_skip_taskbar_hint(true);
        gtk_window.set_skip_pager_hint(true);
        
        // 增强半透明效果 - 仅在支持合成的情况下
        if LinuxWindowExt::has_compositing_support() {
            // 设置窗口透明度
            gtk_window.set_opacity(0.95); // 95% 不透明度，类似 macOS 效果
            
            // 启用 RGBA 视觉效果
            let widget = gtk_window.upcast_ref::<gtk::Widget>();
            if let Some(screen) = widget.screen() {
                if let Some(rgba_visual) = screen.rgba_visual() {
                    gtk_window.set_visual(Some(&rgba_visual));
                }
            }
            
            // 设置 app_paintable 允许自定义绘制
            gtk_window.set_app_paintable(true);
        }
        
        println!("窗口属性设置完成");
    }

    set_window_always_on_top(&window);
    set_visible_on_all_workspaces(&window);
    
    // 尝试在所有工作区显示
    if let Ok(id) = window.title() {
        let _ = LinuxWindowExt::make_visible_on_all_workspaces(&id);
    }
}

fn set_window_always_on_top(window: &tauri::WebviewWindow) {
    if let Ok(gtk_window) = window.gtk_window() {
        // 确保窗口总是在顶层
        gtk_window.set_keep_above(true);
    }
}

fn set_visible_on_all_workspaces(window: &tauri::WebviewWindow) {
    if let Ok(gtk_window) = window.gtk_window() {
        // 使窗口在所有工作区可见
        gtk_window.stick();
        
        // 设置窗口类型为工具提示，这样可以在所有工作区上显示
        gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Utility);
        
        // 设置为非模态，允许其他窗口获得焦点
        gtk_window.set_modal(false);
        
        // 确保透明效果在所有工作区都有效
        if LinuxWindowExt::has_compositing_support() {
            gtk_window.set_opacity(0.95);
            
            let widget = gtk_window.upcast_ref::<gtk::Widget>();
            if let Some(screen) = widget.screen() {
                if let Some(rgba_visual) = screen.rgba_visual() {
                    gtk_window.set_visual(Some(&rgba_visual));
                }
            }
            
            gtk_window.set_app_paintable(true);
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
