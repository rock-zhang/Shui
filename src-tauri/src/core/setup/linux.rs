use crate::timer::IS_RUNNING;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use std::process::Command;

#[cfg(target_os = "linux")]
pub fn monitor_lock_screen() {
    // 开启一个线程来检测锁屏状态
    thread::spawn(|| {
        let mut previous_lock_state = false;
        
        // 尝试多种方法来检测锁屏状态
        loop {
            // 方法1: DBus方式检测GNOME/KDE等主流桌面环境
            let lock_state = check_dbus_lock_status().unwrap_or_else(|| {
                // 方法2: 使用命令行工具检测
                check_cmd_lock_status()
            });
            
            // 状态变化时更新计时器
            if previous_lock_state != lock_state {
                previous_lock_state = lock_state;
                IS_RUNNING.store(!lock_state, Ordering::SeqCst);
                
                let (status, action) = if lock_state {
                    ("锁屏", "停止")
                } else {
                    ("解锁", "开始")
                };
                println!("系统{}，{}计时", status, action);
            }
            
            thread::sleep(Duration::from_secs(1));
        }
    });
}

fn check_dbus_lock_status() -> Option<bool> {
    use dbus::blocking::Connection;
    
    // 尝试多种DBus接口，以适应不同的桌面环境
    let interfaces = [
        // GNOME ScreenSaver
        ("org.freedesktop.ScreenSaver", "/org/freedesktop/ScreenSaver", "org.freedesktop.ScreenSaver", "GetActive"),
        // KDE/Plasma
        ("org.freedesktop.ScreenSaver", "/ScreenSaver", "org.freedesktop.ScreenSaver", "GetActive"),
        // GNOME Shell
        ("org.gnome.SessionManager", "/org/gnome/SessionManager", "org.gnome.SessionManager", "IsScreenLocked"),
        // Unity/Cinnamon
        ("org.cinnamon.ScreenSaver", "/org/cinnamon/ScreenSaver", "org.cinnamon.ScreenSaver", "GetActive"),
    ];
    
    if let Ok(conn) = Connection::new_session() {
        for (service, path, interface, method) in interfaces {
            let proxy = conn.with_proxy(service, path, Duration::from_millis(1000));
            
            let result: Result<(bool,), _> = proxy.method_call(interface, method, ());
            
            if let Ok((is_locked,)) = result {
                return Some(is_locked);
            }
        }
    }
    
    None
}

fn check_cmd_lock_status() -> bool {
    // 检查是否有锁屏进程在运行
    let lock_processes = [
        "gnome-screensaver-dialog",
        "i3lock", 
        "slock",
        "swaylock",
        "xscreensaver"
    ];
    
    for process in lock_processes {
        if let Ok(output) = Command::new("pgrep")
            .arg(process)
            .output()
        {
            if !output.stdout.is_empty() {
                return true;
            }
        }
    }
    
    // 检查X11会话状态
    if let Ok(output) = Command::new("xscreensaver-command")
        .arg("-time")
        .output()
    {
        let output_str = String::from_utf8_lossy(&output.stdout);
        return output_str.contains("screen locked");
    }
    
    false
}

#[cfg(not(target_os = "linux"))]
pub fn monitor_lock_screen() {
    println!("当前系统不支持锁屏监控");
}
