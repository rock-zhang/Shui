#[cfg(target_os = "macos")]
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use objc_foundation::{INSString, NSString};

pub fn is_frontapp_in_whitelist(whitelist_apps: &Vec<String>) -> bool {
    println!("whitelist_apps: {:?}", whitelist_apps);
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
            if !workspace.is_null() {
                let app: *mut Object = msg_send![workspace, frontmostApplication];
                if !app.is_null() {
                    let name: *mut Object = msg_send![app, localizedName];
                    if !name.is_null() {
                        let ns_string: &NSString = unsafe { &*(name as *const NSString) };
                        let app_name = ns_string.as_str().to_string();
                        println!("app_name: {}", app_name);
                        println!(
                            "whitelist_apps.contains(&app_name): {:?}",
                            whitelist_apps.contains(&app_name)
                        );
                        return whitelist_apps.contains(&app_name);
                    }
                }
            }
        }
    }
    false
}
