use super::*;
use windows::Win32::System::Power::{RegisterPowerSettingNotification, GUID_CONSOLE_DISPLAY_STATE};
use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG};

pub fn monitor_lock_screen() {
    loop {
        // Windows 平台下监听系统锁屏状态
        // 这里使用 Windows API 监听系统电源状态变化
        let mut msg = MSG::default();
        unsafe {
            if GetMessageW(&mut msg, None, 0, 0).as_bool() {
                if msg.message == WM_POWERBROADCAST {
                    let is_locked = match msg.wParam.0 as u32 {
                        PBT_APMRESUMEAUTOMATIC => false,
                        PBT_APMSUSPEND => true,
                        _ => continue,
                    };
                    IS_RUNNING.store(!is_locked, Ordering::SeqCst);
                    let (status, action) = if is_locked {
                        ("锁屏", "停止")
                    } else {
                        ("解锁", "开始")
                    };
                    println!("系统{}，{}计时", status, action);
                }
            }
        }
        thread::sleep(Duration::from_secs(1));
    }
}
