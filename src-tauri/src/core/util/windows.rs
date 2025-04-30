pub fn check_whitelist(whitelist_apps: &Vec<String>) -> bool {
    // unsafe {
    //     // 获取前台窗口句柄
    //     let hwnd = GetForegroundWindow();
    //     if hwnd.0 == 0 {
    //         return false;
    //     }

    //     // 获取进程ID
    //     let mut process_id: u32 = 0;
    //     GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    //     if process_id == 0 {
    //         return false;
    //     }

    //     // 打开进程
    //     let process_handle = OpenProcess(
    //         PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
    //         false,
    //         process_id,
    //     );
    //     if process_handle.is_invalid() {
    //         return false;
    //     }

    //     // 获取进程可执行文件路径
    //     let mut buffer = [0u16; 260];
    //     let len = GetModuleFileNameExW(process_handle, None, &mut buffer);

    //     if len == 0 {
    //         return false;
    //     }

    //     // 转换路径为字符串并获取文件名
    //     let path = String::from_utf16_lossy(&buffer[..len as usize]);
    //     if let Some(file_name) = Path::new(&path).file_stem().and_then(|s| s.to_str()) {
    //         // 检查应用名称是否在白名单中
    //         return whitelist_apps
    //             .iter()
    //             .any(|app| app.to_lowercase() == file_name.to_lowercase());
    //     }
    // }

    false
}

pub fn get_local_installed_apps(app_handle: &tauri::AppHandle) -> Vec<String> {
    let self_name = app_handle.package_info().name.clone();
    let mut apps = Vec::new();

    // 定义要搜索的注册表路径
    const UNINSTALL_PATHS: [&str; 2] = [
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ];

    for uninstall_path in UNINSTALL_PATHS.iter() {
        if let Err(_) = scan_registry_key(uninstall_path, &self_name, &mut apps) {
            continue;
        }
    }

    apps.sort();
    apps.dedup();
    apps
}

fn scan_registry_key(
    path: &str,
    self_name: &str,
    apps: &mut Vec<String>,
) -> windows::core::Result<()> {
    unsafe {
        let uninstall_key = HSTRING::from(path);
        let mut hkey = HKEY_LOCAL_MACHINE;

        // 打开主注册表键
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR::from_raw(uninstall_key.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )?;

        let _guard = scopeguard::guard(hkey, |h| {
            let _ = RegCloseKey(h);
        });

        let mut index = 0;
        loop {
            let mut name_buf = [0u16; 256];
            let mut name_size = name_buf.len() as u32;

            match RegEnumKeyExW(
                hkey,
                index,
                PWSTR::from_raw(name_buf.as_mut_ptr()),
                &mut name_size,
                None,
                None,
                None,
                None,
            ) {
                Ok(_) => {
                    if let Some(app_name) =
                        read_app_display_name(hkey, &name_buf[..name_size as usize])?
                    {
                        if !app_name.is_empty() && app_name != self_name {
                            apps.push(app_name);
                        }
                    }
                    index += 1;
                }
                Err(e) if e.code() == ERROR_NO_MORE_ITEMS => break,
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
        let full_key = format!("{}\\", app_key);
        let full_key_hstring = HSTRING::from(full_key);

        let mut app_hkey = HKEY_LOCAL_MACHINE;
        RegOpenKeyExW(
            parent_key,
            PCWSTR::from_raw(full_key_hstring.as_ptr()),
            0,
            KEY_READ,
            &mut app_hkey,
        )?;

        let _guard = scopeguard::guard(app_hkey, |h| {
            let _ = RegCloseKey(h);
        });

        let mut display_name_buf = [0u16; 256];
        let mut data_type = REG_SZ;
        let mut data_size = (display_name_buf.len() * 2) as u32;

        match RegQueryValueExW(
            app_hkey,
            w!("DisplayName"),
            None,
            Some(&mut data_type),
            Some(display_name_buf.as_mut_ptr() as *mut u8),
            Some(&mut data_size),
        ) {
            Ok(_) => Ok(Some(
                String::from_utf16_lossy(&display_name_buf[..data_size as usize / 2])
                    .trim_matches('\0')
                    .to_string(),
            )),
            Err(e) if e.code() == ERROR_FILE_NOT_FOUND => Ok(None),
            Err(e) => Err(e),
        }
    }
}
