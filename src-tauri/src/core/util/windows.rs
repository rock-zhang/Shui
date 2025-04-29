

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
    return vec!["腾讯会议".to_string()];
    // let self_name = app_handle.package_info().name.clone();
    // let mut apps = Vec::new();

    // unsafe {
    //     // 使用 HSTRING 创建注册表路径
    //     let uninstall_key =
    //         HSTRING::from("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall");
    //     let mut hkey = HKEY_LOCAL_MACHINE;

    //     // 打开主注册表键
    //     if RegOpenKeyExW(
    //         HKEY_LOCAL_MACHINE,
    //         PCWSTR::from_raw(uninstall_key.as_ptr()),
    //         0,
    //         KEY_READ,
    //         &mut hkey,
    //     )
    //     .is_ok()
    //     {
    //         let mut index = 0;
    //         let mut name_buf = [0u16; 256];
    //         let mut name_size = name_buf.len() as u32;

    //         // 枚举所有子键
    //         while RegEnumKeyExW(
    //             hkey,
    //             index,
    //             PWSTR::from_raw(name_buf.as_mut_ptr()),
    //             &mut name_size,
    //             None,
    //             None,
    //             None,
    //             None,
    //         )
    //         .is_ok()
    //         {
    //             // 构建完整的子键路径
    //             let app_key = String::from_utf16_lossy(&name_buf[..name_size as usize]);
    //             let full_key = format!("{}\\{}", uninstall_key.to_string_lossy(), app_key);
    //             let full_key_hstring = HSTRING::from(full_key);

    //             // 打开子键
    //             let mut app_hkey = HKEY_LOCAL_MACHINE;
    //             if RegOpenKeyExW(
    //                 HKEY_LOCAL_MACHINE,
    //                 PCWSTR::from_raw(full_key_hstring.as_ptr()),
    //                 0,
    //                 KEY_READ,
    //                 &mut app_hkey,
    //             )
    //             .is_ok()
    //             {
    //                 // 读取显示名称
    //                 let mut display_name_buf = [0u16; 256];
    //                 let mut data_type = REG_SZ;
    //                 let mut data_size = (display_name_buf.len() * 2) as u32;

    //                 if RegQueryValueExW(
    //                     app_hkey,
    //                     w!("DisplayName"),
    //                     None,
    //                     Some(&mut data_type),
    //                     Some(display_name_buf.as_mut_ptr() as *mut u8),
    //                     Some(&mut data_size),
    //                 )
    //                 .is_ok()
    //                 {
    //                     let display_name =
    //                         String::from_utf16_lossy(&display_name_buf[..data_size as usize / 2])
    //                             .trim_matches('\0')
    //                             .to_string();

    //                     if !display_name.is_empty() && display_name != self_name {
    //                         apps.push(display_name);
    //                     }
    //                 }

    //                 RegCloseKey(app_hkey);
    //             }

    //             index += 1;
    //             name_size = name_buf.len() as u32;
    //         }

    //         RegCloseKey(hkey);
    //     }
    // }

    // apps.sort();
    // apps.dedup();
    // apps
}
