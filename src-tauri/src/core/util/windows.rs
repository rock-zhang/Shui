use scopeguard;
use std::path::Path;
use std::ptr;
use windows::{
    core::w,
    core::{HSTRING, PCWSTR, PWSTR},
    Win32::Foundation::{CloseHandle, ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_ITEMS, HANDLE},
    Win32::System::ProcessStatus::GetModuleFileNameExW,
    Win32::System::Registry::*,
    Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowThreadProcessId,
    },
};
use windows::{
    core::*, Win32::Foundation::*, Win32::System::Threading::*, Win32::UI::WindowsAndMessaging::*,
};

pub fn check_whitelist(whitelist_apps: &Vec<String>) -> bool {
    unsafe {
        // 获取前台窗口句柄
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 {
            println!("[check_whitelist] Failed to get foreground window");
            return false;
        }

        // 获取进程ID
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == 0 {
            println!("[check_whitelist] Failed to get process ID");
            return false;
        }

        // 打开进程
        let process_handle = OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
            false,
            process_id,
        );

        let process_handle = match process_handle {
            Ok(handle) => handle,
            Err(e) => {
                println!(
                    "[check_whitelist] Failed to open process {}: {}",
                    process_id, e
                );
                return false;
            }
        };

        if process_handle.is_invalid() {
            println!(
                "[check_whitelist] Invalid process handle for process: {}",
                process_id
            );
            return false;
        }

        // 使用 scopeguard 确保进程句柄被正确关闭
        let _guard = scopeguard::guard(process_handle, |handle| unsafe {
            CloseHandle(handle);
        });

        // 获取进程可执行文件路径
        let mut buffer = [0u16; 260];
        let len = GetModuleFileNameExW(process_handle, None, &mut buffer);

        if len == 0 {
            println!("[check_whitelist] Failed to get module filename");
            return false;
        }

        // 转换路径为字符串并获取文件名
        let path = String::from_utf16_lossy(&buffer[..len as usize]);
        println!("[check_whitelist] Process path: {}", path);

        // 从注册表中查找应用名称
        let app_name = get_app_name_from_path(&path);
        println!("[check_whitelist] app_name {:?}", app_name);
        match app_name {
            Some(name) => {
                let is_whitelisted = whitelist_apps
                    .iter()
                    .any(|app| app.to_lowercase() == name.to_lowercase());

                println!(
                    "[check_whitelist] App name: {}, Whitelisted: {}",
                    name, is_whitelisted
                );
                is_whitelisted
            }
            None => {
                println!("[check_whitelist] Failed to get app name from registry");
                false
            }
        }
    }
}

// 新增函数：从可执行文件路径获取应用名称
fn get_app_name_from_path(path: &str) -> Option<String> {
    unsafe {
        // 遍历注册表路径
        let paths = [
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            "SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ];
        let roots = [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER];
        println!("[check_whitelist] roots {:?}", roots);

        for root in roots.iter() {
            for uninstall_path in paths.iter() {
                let mut hkey = *root;
                let uninstall_key = HSTRING::from(*uninstall_path);

                println!("[check_whitelist] uninstall_key {:?}", uninstall_key);
                if RegOpenKeyExW(
                    *root,
                    PCWSTR::from_raw(uninstall_key.as_ptr()),
                    0,
                    KEY_READ,
                    &mut hkey,
                )
                .is_ok()
                {
                    let _guard = scopeguard::guard(hkey, |h| unsafe {
                        let _ = RegCloseKey(h);
                    });

                    let mut index = 0;
                    let mut name_buf = [0u16; 256];

                    println!("[check_whitelist] index {:?}", index);
                    loop {
                        let mut name_size = name_buf.len() as u32;
                        match RegEnumKeyExW(
                            hkey,
                            index,
                            PWSTR::from_raw(name_buf.as_mut_ptr()),
                            &mut name_size,
                            None,
                            PWSTR::null(),
                            None,
                            None,
                        )
                        .ok()
                        {
                            Ok(_) => {
                                // 检查这个注册表项的 InstallLocation 是否匹配
                                let mut app_hkey = hkey;
                                let app_key =
                                    String::from_utf16_lossy(&name_buf[..name_size as usize]);
                                let full_key = format!("{}", app_key.trim_end_matches('\0'));
                                let full_key_hstring = HSTRING::from(full_key);
                                println!("[check_whitelist] app_hkey {:?}", app_hkey);

                                if RegOpenKeyExW(
                                    hkey,
                                    PCWSTR::from_raw(full_key_hstring.as_ptr()),
                                    0,
                                    KEY_READ,
                                    &mut app_hkey,
                                )
                                .is_ok()
                                {
                                    let _guard = scopeguard::guard(app_hkey, |h| unsafe {
                                        let _ = RegCloseKey(h);
                                    });

                                    // 读取 InstallLocation
                                    let mut buffer = [0u16; 260];
                                    let mut data_size = (buffer.len() * 2) as u32;
                                    let mut data_type = REG_SZ;
                                    let install_location = HSTRING::from("InstallLocation");
                                    println!("[check_whitelist] data_size {:?}", data_size);

                                    if RegQueryValueExW(
                                        app_hkey,
                                        PCWSTR::from_raw(install_location.as_ptr()),
                                        None,
                                        Some(&mut data_type),
                                        Some(buffer.as_mut_ptr() as *mut u8),
                                        Some(&mut data_size),
                                    )
                                    .is_ok()
                                    {
                                        let len = data_size as usize / 2;
                                        let location = String::from_utf16_lossy(&buffer[..len])
                                            .trim_matches('\0')
                                            .to_string();
                                        println!("[check_whitelist] len {:?}", len);
                                        println!("[check_whitelist] location {:?}", location);

                                        if !location.is_empty() && path.starts_with(&location) {
                                            // 找到匹配的应用，读取 DisplayName
                                            let mut display_name_buf = [0u16; 256];
                                            let mut data_size = (display_name_buf.len() * 2) as u32;
                                            let mut data_type = REG_SZ;
                                            let display_name = HSTRING::from("DisplayName");
                                            println!(
                                                "[check_whitelist] display_name {:?}",
                                                display_name
                                            );

                                            if RegQueryValueExW(
                                                app_hkey,
                                                PCWSTR::from_raw(display_name.as_ptr()),
                                                None,
                                                Some(&mut data_type),
                                                Some(display_name_buf.as_mut_ptr() as *mut u8),
                                                Some(&mut data_size),
                                            )
                                            .is_ok()
                                            {
                                                let len = data_size as usize / 2;
                                                let name = String::from_utf16_lossy(
                                                    &display_name_buf[..len],
                                                )
                                                .trim_matches('\0')
                                                .to_string();
                                                println!("[check_whitelist] name {:?}", name);
                                                if !name.is_empty() {
                                                    return Some(name);
                                                }
                                            }
                                        }
                                    }
                                }
                                index += 1;
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        }
        None
    }
}

pub fn get_local_installed_apps(app_handle: &tauri::AppHandle) -> Vec<String> {
    let self_name = app_handle.package_info().name.clone();
    let mut apps = Vec::new();

    // 定义要搜索的注册表路径
    const UNINSTALL_PATHS: [&str; 2] = [
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ];

    // 遍历不同的根键
    let roots = [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER];
    for root in roots.iter() {
        for uninstall_path in UNINSTALL_PATHS.iter() {
            if let Err(e) = scan_registry_key(*root, uninstall_path, &self_name, &mut apps) {
                println!("Failed to scan registry key: {} - {}", uninstall_path, e);
                continue;
            }
        }
    }

    println!("[apps] {:?}", apps);

    apps.sort();
    apps.dedup();
    apps
}

fn scan_registry_key(
    root: HKEY, // 添加根键参数
    path: &str,
    self_name: &str,
    apps: &mut Vec<String>,
) -> windows::core::Result<()> {
    unsafe {
        let uninstall_key = HSTRING::from(path);
        let mut hkey = root; // 使用传入的根键

        // 打开主注册表键
        RegOpenKeyExW(
            root, // 使用传入的根键
            PCWSTR::from_raw(uninstall_key.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
        .ok()?;

        let _guard = scopeguard::guard(hkey, |h| unsafe {
            let _ = RegCloseKey(h);
        });

        let mut index = 0;
        let mut name_buf = [0u16; 256];

        loop {
            let mut name_size = name_buf.len() as u32;
            match RegEnumKeyExW(
                hkey,
                index,
                PWSTR::from_raw(name_buf.as_mut_ptr()),
                &mut name_size,
                None,          // 改为 None 而不是 ptr::null_mut()
                PWSTR::null(), // 改为 None 而不是 ptr::null_mut()
                None,          // 改为 None 而不是 ptr::null_mut()
                None,          // 改为 None 而不是 ptr::null_mut()
            )
            .ok()
            {
                Ok(_) => {
                    if let Some(app_name) =
                        read_app_display_name(hkey, &name_buf[..name_size as usize])?
                    {
                        println!("[read_app_display_name] {:?}", app_name);

                        if !app_name.is_empty() && app_name != self_name {
                            apps.push(app_name);
                        }
                    }
                    index += 1;
                }
                // Err(e) if e.code() == ERROR_NO_MORE_ITEMS => break,
                Err(e) => return Err(e),
            }
        }

        Ok(())
    }
}

fn read_app_display_name(
    parent_key: HKEY,
    subkey_name: &[u16],
) -> windows::core::Result<Option<String>> {
    unsafe {
        let app_key = String::from_utf16_lossy(subkey_name);
        let full_key = format!("{}", app_key.trim_end_matches('\0'));
        let full_key_hstring = HSTRING::from(full_key);

        let mut app_hkey = parent_key;
        RegOpenKeyExW(
            parent_key,
            PCWSTR::from_raw(full_key_hstring.as_ptr()),
            0,
            KEY_READ,
            &mut app_hkey,
        )
        .ok()?;

        let _guard = scopeguard::guard(app_hkey, |h| unsafe {
            let _ = RegCloseKey(h);
        });

        // 检查 SystemComponent 值，如果为 1 则表示是系统组件
        let mut system_component: u32 = 0;
        let mut data_size = std::mem::size_of::<u32>() as u32;
        let mut data_type = REG_DWORD;
        let system_component_name = HSTRING::from("SystemComponent");

        let is_system = RegQueryValueExW(
            app_hkey,
            PCWSTR::from_raw(system_component_name.as_ptr()),
            None,
            Some(&mut data_type),
            Some(&mut system_component as *mut u32 as *mut u8),
            Some(&mut data_size),
        )
        .is_ok()
            && system_component == 1;

        if is_system {
            return Ok(None);
        }

        // 检查 ParentKeyName，如果存在则可能是系统组件或更新
        let parent_key_name = HSTRING::from("ParentKeyName");
        let mut buffer = [0u16; 256];
        let mut data_size = (buffer.len() * 2) as u32;
        let mut data_type = REG_SZ;

        let has_parent = RegQueryValueExW(
            app_hkey,
            PCWSTR::from_raw(parent_key_name.as_ptr()),
            None,
            Some(&mut data_type),
            Some(buffer.as_mut_ptr() as *mut u8),
            Some(&mut data_size),
        )
        .is_ok();

        if has_parent {
            return Ok(None);
        }

        // 检查 WindowsInstaller 值，如果为 1 则表示是通过 Windows Installer 安装的应用
        let mut windows_installer: u32 = 0;
        let mut data_size = std::mem::size_of::<u32>() as u32;
        let mut data_type = REG_DWORD;
        let windows_installer_name = HSTRING::from("WindowsInstaller");

        let is_msi = RegQueryValueExW(
            app_hkey,
            PCWSTR::from_raw(windows_installer_name.as_ptr()),
            None,
            Some(&mut data_type),
            Some(&mut windows_installer as *mut u32 as *mut u8),
            Some(&mut data_size),
        )
        .is_ok()
            && windows_installer == 1;

        // 检查 UninstallString，如果存在说明是可卸载的应用
        let uninstall_string = HSTRING::from("UninstallString");
        let mut buffer = [0u16; 256];
        let mut data_size = (buffer.len() * 2) as u32;
        let mut data_type = REG_SZ;

        let has_uninstall = RegQueryValueExW(
            app_hkey,
            PCWSTR::from_raw(uninstall_string.as_ptr()),
            None,
            Some(&mut data_type),
            Some(buffer.as_mut_ptr() as *mut u8),
            Some(&mut data_size),
        )
        .is_ok();

        // 如果没有卸载字符串，可能不是用户安装的应用
        if !has_uninstall {
            return Ok(None);
        }

        // 读取 DisplayName
        let mut display_name_buf = [0u16; 256];
        let mut data_type = REG_SZ;
        let mut data_size = (display_name_buf.len() * 2) as u32;
        let display_name = HSTRING::from("DisplayName");

        let result = RegQueryValueExW(
            app_hkey,
            PCWSTR::from_raw(display_name.as_ptr()),
            None,
            Some(&mut data_type),
            Some(display_name_buf.as_mut_ptr() as *mut u8),
            Some(&mut data_size),
        )
        .ok();

        if let Ok(_) = result {
            let len = data_size as usize / 2;
            let name = String::from_utf16_lossy(&display_name_buf[..len])
                .trim_matches('\0')
                .to_string();

            // 只过滤掉明确的系统组件
            if !name.is_empty()
                && !name.contains("Windows SDK")
                && !name.contains("Windows Kit")
                && !name.contains("Visual Studio")
                && !name.contains("Windows Software Development Kit")
                && !name.contains("Microsoft SDK")
                && !name.contains("Update for")
                && !name.contains("Security Update")
                && !name.contains("Hotfix")
                && !name.starts_with("KB")
            {
                // 添加调试输出
                println!("[Found app] {}", name);
                // println!("[Registry key] {}", full_key);
                return Ok(Some(name));
            }
        }

        Ok(None)
    }
}
