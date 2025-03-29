mod core;
use core::panel;
use tauri::Manager;

#[cfg(target_os = "macos")]
extern crate core_foundation;
#[cfg(target_os = "macos")]
extern crate core_graphics;

use std::thread;
use std::time::Duration;

#[cfg(target_os = "macos")]
extern "C" {
    fn CGSessionCopyCurrentDictionary() -> core_foundation::dictionary::CFDictionaryRef;
}

#[cfg(target_os = "macos")]
use core_foundation::{base::TCFType, base::ToVoid, dictionary::CFDictionary, string::CFString};

// use tauri_plugin_autostart::MacosLauncher;
// use tauri_plugin_eco_window::{show_main_window, MAIN_WINDOW_LABEL, PREFERENCE_WINDOW_LABEL};
// use tauri_plugin_log::{Target, TargetKind};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                thread::spawn(move || {
                    println!("Start new thread...");
                    let mut flg = false;
                    loop {
                        unsafe {
                            let session_dictionary_ref = CGSessionCopyCurrentDictionary();
                            let session_dictionary: CFDictionary =
                                CFDictionary::wrap_under_create_rule(session_dictionary_ref);
                            let mut current_session_property = false;

                            match session_dictionary
                                .find(CFString::new("CGSSessionScreenIsLocked").to_void())
                            {
                                None => current_session_property = false,
                                Some(_) => current_session_property = true,
                            }
                            if flg != current_session_property {
                                flg = current_session_property;

                                if current_session_property == true {
                                    println!("Locked");
                                } else {
                                    println!("Unlocked");
                                }
                            }
                            thread::sleep(Duration::from_millis(1000));
                        }
                    }
                });
            }

            let main_window = app.get_webview_window("main").unwrap();
            #[cfg(target_os = "macos")]
            panel::platform(app, main_window.clone());

            Ok(())
        })
        // .plugin()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
