//! Opt-in native test observer. Default/release builds do not include this module.
//! It refuses the production identifier and uses the normal app, WebView and IPC.
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{Listener, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

#[derive(Default)]
struct Probe {
    ready: AtomicBool,
    timer_listener: AtomicBool,
    tray_menu: AtomicBool,
    reminder_loaded: AtomicBool,
    interactive: AtomicBool,
    early_focus: AtomicBool,
    early_visible: AtomicBool,
    initial_window: Mutex<Option<Value>>,
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("native-smoke")
        .js_init_script(include_str!("native_smoke_init.js").into())
        .setup(|app, _| {
            if app.config().identifier != "com.shui.native-smoke"
                || app.package_info().name != "Shui Native Smoke"
            {
                return Err("native-smoke requires tauri.smoke.conf.json isolation".into());
            }
            let directory = PathBuf::from(
                std::env::var_os("SHUI_NATIVE_SMOKE_DIR").ok_or("missing SHUI_NATIVE_SMOKE_DIR")?,
            );
            fs::create_dir_all(&directory)?;
            let probe = Arc::new(Probe::default());
            app.manage(probe.clone());
            let events = probe.clone();
            app.listen("native-smoke-report", move |event| {
                let Ok(value) = serde_json::from_str::<Value>(event.payload()) else {
                    return;
                };
                match value["kind"].as_str() {
                    Some("timer-listener") => events.timer_listener.store(true, Ordering::SeqCst),
                    Some("tray-menu") => events.tray_menu.store(true, Ordering::SeqCst),
                    Some("reminder-loaded") => events.reminder_loaded.store(true, Ordering::SeqCst),
                    _ => {}
                }
            });
            let store = app.store("config_store.json")?;
            store.set(
                "general",
                json!({"isCountDown": true, "isFullScreen": true}),
            );
            store.set(
                "alert",
                json!({
                    "gap": "20", "gold": "1000", "weekdays": [0,1,2,3,4,5,6],
                    "timeStart": "00:00", "timeEnd": "00:00", "whitelist_apps": []
                }),
            );
            store.save()?;
            let handle = app.clone();
            thread::spawn(move || observe(handle, probe, directory));
            Ok(())
        })
        .on_window_ready(|window| {
            if window.label() != "main" {
                return;
            }
            let probe = window.state::<Arc<Probe>>().inner().clone();
            *probe.initial_window.lock().unwrap() = Some(json!({
                "visible": window.is_visible().unwrap(), "focused": window.is_focused().unwrap()
            }));
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Focused(true))
                    && !probe.interactive.load(Ordering::SeqCst)
                {
                    probe.early_focus.store(true, Ordering::SeqCst);
                }
            });
        })
        .on_event(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                app.state::<Arc<Probe>>()
                    .ready
                    .store(true, Ordering::SeqCst);
            }
        })
        .build()
}

fn observe(app: tauri::AppHandle, probe: Arc<Probe>, directory: PathBuf) {
    let mut acknowledged = 0;
    let mut error: Option<String> = None;
    loop {
        if !probe.ready.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(50));
            continue;
        }
        if let Ok(bytes) = fs::read(directory.join("command.json")) {
            if let Ok(command) = serde_json::from_slice::<Value>(&bytes) {
                let id = command["id"].as_u64().unwrap_or(0);
                if id > acknowledged {
                    error = perform(&app, &probe, command["action"].as_str().unwrap_or("")).err();
                    acknowledged = id;
                }
            }
        }
        if let Some(main) = app.get_webview_window("main") {
            let visible = main.is_visible().unwrap_or(false);
            if visible && !probe.interactive.load(Ordering::SeqCst) {
                probe.early_visible.store(true, Ordering::SeqCst);
            }
            let reminders: Vec<String> = app
                .webview_windows()
                .into_iter()
                .filter(|(label, w)| {
                    label.starts_with("reminder_") && w.is_visible().unwrap_or(false)
                })
                .map(|(label, _)| label)
                .collect();
            let state = json!({
                "pid": std::process::id(), "acknowledged": acknowledged, "error": error,
                "initial_window": *probe.initial_window.lock().unwrap(),
                "main": {"visible": visible, "focused": main.is_focused().unwrap_or(false),
                    "minimized": main.is_minimized().unwrap_or(false)},
                "early_focus": probe.early_focus.load(Ordering::SeqCst),
                "early_visible": probe.early_visible.load(Ordering::SeqCst),
                "timer_listener": probe.timer_listener.load(Ordering::SeqCst),
                "tray_menu": probe.tray_menu.load(Ordering::SeqCst),
                "tray": app.tray_by_id("main-tray").is_some(),
                "reminder_loaded": probe.reminder_loaded.load(Ordering::SeqCst),
                "visible_reminders": reminders,
                "session": crate::reminder_session::current_id(),
                "timer_running": crate::timer::IS_RUNNING.load(Ordering::SeqCst),
                "autostart": app.autolaunch().is_enabled().unwrap_or(false),
                "data_dir": app.path().app_data_dir().unwrap()
            });
            // Readers retry incomplete JSON. In-place writes also work on Windows,
            // where rename cannot replace a destination opened by another process.
            if fs::write(
                directory.join("state.json"),
                serde_json::to_vec(&state).unwrap(),
            )
            .is_err()
            {
                app.exit(1);
                break;
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn perform(app: &tauri::AppHandle, probe: &Probe, action: &str) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("main window missing")?;
    match action {
        "interactive" => probe.interactive.store(true, Ordering::SeqCst),
        "close" => main.close().map_err(|e| e.to_string())?,
        "minimize" => main.minimize().map_err(|e| e.to_string())?,
        "tray-settings" => main
            .eval("window.__SHUI_SMOKE_TRAY_SETTINGS__()")
            .map_err(|e| e.to_string())?,
        "remind" => {
            let store = app.store("config_store.json").map_err(|e| e.to_string())?;
            let mut alert = store.get("alert").ok_or("alert settings missing")?;
            alert["gap"] = json!("0");
            store.set("alert", alert);
            crate::commands::reset_timer();
        }
        "finish-reminder" => {
            let store = app.store("config_store.json").map_err(|e| e.to_string())?;
            let mut alert = store.get("alert").ok_or("alert settings missing")?;
            alert["gap"] = json!("20");
            store.set("alert", alert);
            crate::reminder_session::close(app, None, crate::reminder_session::Outcome::Skipped);
            crate::commands::reset_timer();
        }
        "enable-autostart" => crate::autostart::enable(app)?,
        "disable-autostart" => app.autolaunch().disable().map_err(|e| e.to_string())?,
        "exit" => {
            app.exit(0);
        }
        _ => return Err(format!("unknown native smoke action: {action}")),
    }
    Ok(())
}
