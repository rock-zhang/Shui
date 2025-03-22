mod panel;
use tauri::Manager;

// use tauri_plugin_autostart::MacosLauncher;
// use tauri_plugin_eco_window::{show_main_window, MAIN_WINDOW_LABEL, PREFERENCE_WINDOW_LABEL};
// use tauri_plugin_log::{Target, TargetKind};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// #[cfg_attr(mobile, tauri::mobile_entry_point)]
// pub fn run() {
//     let app = Builder::default().setup(|app| {
//         let main_window = app.get_webview_window("main").unwrap();

//         panel::platform(app, main_window.clone());
//         // setup::default(app, main_window.clone(), preference_window.clone());

//         Ok(())
//     });
// }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
