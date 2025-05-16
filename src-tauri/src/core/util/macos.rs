use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use objc_foundation::{INSString, NSString};

pub fn check_whitelist(whitelist_apps: &Vec<String>) -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
            if !workspace.is_null() {
                let app: *mut Object = msg_send![workspace, frontmostApplication];
                if !app.is_null() {
                    let url: *mut Object = msg_send![app, bundleURL];
                    let name = get_mditem_display_name_by_url(url);
                    if let Some(name) = name {
                        return whitelist_apps.contains(&name.trim_end_matches(".app").to_string());
                    }
                }
            }
        }
    }
    false
}

pub async fn get_local_installed_apps() -> Vec<String> {
    let mut files = tokio::fs::read_dir("/Applications")
        .await
        .expect("failed to read directory");

    let self_path = get_self_bundle_path();

    let mut display_names = vec![];
    while let Ok(Some(entry)) = files.next_entry().await {
        let path = entry.path();
        let app = path
            .file_name()
            .expect("failed to get file name")
            .to_string_lossy();
        if !app.ends_with(".app") {
            continue;
        }

        let path_str = path.to_string_lossy();
        if path_str == self_path {
            continue;
        }

        if let Some(display_name) = get_mditem_display_name_by_path(&path_str) {
            display_names.push(display_name.trim_end_matches(".app").to_string());
        } else {
            display_names.push(app.trim_end_matches(".app").to_string());
        }
    }

    display_names.sort();
    display_names
}

pub fn get_mditem_display_name_by_path(path: &str) -> Option<String> {
    unsafe {
        let path = NSString::from_str(path);
        let url: *mut Object = msg_send![class!(NSURL), fileURLWithPath: path];
        get_mditem_display_name_by_url(url)
    }
}

pub fn get_self_bundle_path() -> String {
    unsafe {
        let bundle: *mut Object = msg_send![class!(NSBundle), mainBundle];
        let url: *mut Object = msg_send![bundle, bundlePath];
        let ns_string: &NSString = &*(url as *const NSString);
        ns_string.as_str().to_string()
    }
}

pub unsafe fn get_mditem_display_name_by_url(url: *const Object) -> Option<String> {
    let cls = class!(NSMetadataItem);
    let alloc: *mut Object = msg_send![cls, alloc];
    let item: *mut Object = msg_send![alloc, initWithURL:url];
    let name: *mut Object =
        msg_send![item, valueForAttribute: NSString::from_str("kMDItemDisplayName")];

    if !name.is_null() {
        let ns_string: &NSString = &*(name as *const NSString);
        return Some(ns_string.as_str().to_string());
    }

    None
}
