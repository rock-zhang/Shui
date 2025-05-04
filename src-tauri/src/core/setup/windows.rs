use std::{io, ptr};
use winapi::{
    ctypes::c_void,
    shared::{
        guiddef::GUID,
        minwindef::{LPARAM, LRESULT, TRUE, UINT, WPARAM},
        windef::HWND,
    },
    um::{
        libloaderapi::GetModuleHandleW,
        winuser::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostQuitMessage,
            RegisterClassExW, RegisterPowerSettingNotification, TranslateMessage, CW_USEDEFAULT,
            MSG, PBT_POWERSETTINGCHANGE, POWERBROADCAST_SETTING, WM_DESTROY, WM_POWERBROADCAST,
            WM_WTSSESSION_CHANGE, WNDCLASSEXW, WS_EX_OVERLAPPEDWINDOW,
        },
        wtsapi32::*,
    },
};
// use windows::Win32::Foundation::HWND;
use chrono::{Datelike, Local, NaiveTime};
// use winapi::um::wtsapi32::{WTS_SESSION_LOCK, WTS_SESSION_UNLOCK};
use crate::timer::IS_RUNNING;
use std::sync::atomic::Ordering;
use windows::Win32::System::RemoteDesktop::WTSRegisterSessionNotification;
use windows::Win32::System::RemoteDesktop::NOTIFY_FOR_THIS_SESSION;

// 显示器状态 GUID
const GUID_CONSOLE_DISPLAY_STATE: GUID = GUID {
    Data1: 0x6fe69556,
    Data2: 0x704a,
    Data3: 0x47a0,
    Data4: [0x8f, 0x24, 0xc2, 0x8d, 0x93, 0x6f, 0xda, 0x47],
};

// 显示器状态枚举
#[derive(Debug)]
enum MonitorState {
    Off,
    On,
    Dim,
    Unknown(u32),
}

impl From<u32> for MonitorState {
    fn from(state: u32) -> Self {
        match state {
            0 => MonitorState::Off,
            1 => MonitorState::On,
            2 => MonitorState::Dim,
            x => MonitorState::Unknown(x),
        }
    }
}

fn reset_timer_running(lock_state: bool) {
    IS_RUNNING.store(lock_state, Ordering::SeqCst);
    let (status, action) = if lock_state {
        ("锁屏", "停止")
    } else {
        ("解锁", "开始")
    };
    println!("系统{}，{}计时", status, action);
}

// 窗口处理函数
extern "system" fn wnd_proc(hwnd: HWND, msg: UINT, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    println!("wparam: {:?}: {:?}", wparam, Local::now().time());
    match msg {
        WM_WTSSESSION_CHANGE => {
            match wparam as u32 {
                7 => {
                    println!("[事件] 系统已锁定");
                    reset_timer_running(false);
                }
                8 => {
                    println!("[事件] 系统已解锁");
                    reset_timer_running(true);
                }
                _ => {}
            }
            0
        }
        WM_POWERBROADCAST => {
            if wparam == PBT_POWERSETTINGCHANGE as WPARAM {
                println!(
                    "PBT_POWERSETTINGCHANGE: {:?}: {:?}",
                    wparam,
                    Local::now().time()
                );
                let setting = lparam as *const POWERBROADCAST_SETTING;
                println!("setting: {:?}: {:?}", setting, Local::now().time());
                unsafe {
                    if let Ok(state) = handle_power_setting(setting) {
                        println!(
                            "handle_power_setting: {:?}: {:?}",
                            state,
                            Local::now().time()
                        );
                        match state {
                            MonitorState::Off => {
                                println!("[事件] 显示器已关闭");
                                reset_timer_running(false);
                            }
                            MonitorState::On => {
                                println!("[事件] 显示器已打开");
                                reset_timer_running(true);
                            }
                            MonitorState::Dim => println!("[事件] 显示器变暗"),
                            MonitorState::Unknown(x) => println!("[事件] 未知状态: {}", x),
                        }
                    }
                }
            }
            TRUE.try_into().unwrap()
        }
        WM_DESTROY => {
            unsafe { PostQuitMessage(0) };
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

// 处理电源设置变化
unsafe fn handle_power_setting(setting: *const POWERBROADCAST_SETTING) -> io::Result<MonitorState> {
    // 使用 memcmp 比较 GUID
    let setting_guid = &(*setting).PowerSetting as *const GUID;
    let console_guid = &GUID_CONSOLE_DISPLAY_STATE as *const GUID;
    let guid_size = std::mem::size_of::<GUID>();

    if std::ptr::eq(setting_guid, console_guid)
        || std::slice::from_raw_parts(setting_guid as *const u8, guid_size)
            == std::slice::from_raw_parts(console_guid as *const u8, guid_size)
    {
        let data = (*setting).Data.as_ptr() as *const u32;
        Ok(MonitorState::from(*data))
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "非显示器状态事件",
        ))
    }
}

pub fn monitor_lock_screen() {
    let class_name = match widestring::U16CString::from_str("ScreenMonitorClass") {
        Ok(name) => name,
        Err(e) => {
            println!("创建窗口类名称失败: {}", e);
            return;
        }
    };

    let wnd_class = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: 0,
        lpfnWndProc: Some(wnd_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: unsafe { GetModuleHandleW(ptr::null()) },
        hIcon: ptr::null_mut(),
        hCursor: ptr::null_mut(),
        hbrBackground: ptr::null_mut(),
        lpszMenuName: ptr::null(),
        lpszClassName: class_name.as_ptr(),
        hIconSm: ptr::null_mut(),
    };

    unsafe {
        if RegisterClassExW(&wnd_class) == 0 {
            println!("注册窗口类失败");
            return;
        }

        let window_name = match widestring::U16CString::from_str("Screen Monitor") {
            Ok(name) => name,
            Err(e) => {
                println!("创建窗口名称失败: {}", e);
                return;
            }
        };

        let hwnd = CreateWindowExW(
            WS_EX_OVERLAPPEDWINDOW,
            class_name.as_ptr(),
            window_name.as_ptr(),
            0,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            ptr::null_mut(),
            ptr::null_mut(),
            wnd_class.hInstance,
            ptr::null_mut(),
        );

        if hwnd.is_null() {
            println!("创建窗口失败");
            return;
        }

        // 注册会话通知
        if unsafe {
            WTSRegisterSessionNotification(
                windows::Win32::Foundation::HWND(hwnd as isize),
                NOTIFY_FOR_THIS_SESSION,
            )
            .as_bool()
        } {
            println!("监听已启动，尝试息屏/锁屏测试...");
        } else {
            println!("注册会话通知失败");
            return;
        }

        // 注册电源通知
        let _notification =
            RegisterPowerSettingNotification(hwnd as *mut c_void, &GUID_CONSOLE_DISPLAY_STATE, 0);

        println!("监听已启动，尝试息屏/锁屏测试...");

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
