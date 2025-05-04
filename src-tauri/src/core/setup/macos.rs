use crate::core::store::settings::AppSettings;
use crate::core::util::is_frontapp_in_whitelist;
use crate::timer::IS_RUNNING;
use tauri::Emitter;

use std::thread::{self, sleep};
use std::time::Duration;

use std::sync::atomic::Ordering;
use std::time::Instant;

extern crate core_foundation;

use core_foundation::{base::TCFType, base::ToVoid, dictionary::CFDictionary, string::CFString};

extern "C" {
    fn CGSessionCopyCurrentDictionary() -> core_foundation::dictionary::CFDictionaryRef;
}

pub fn monitor_lock_screen() {
    let mut previous_lock_state = false;
    let lock_key = CFString::new("CGSSessionScreenIsLocked");

    loop {
        unsafe {
            let session_dictionary_ref = CGSessionCopyCurrentDictionary();
            let session_dictionary: CFDictionary =
                CFDictionary::wrap_under_create_rule(session_dictionary_ref);
            let current_lock_state = session_dictionary.find(lock_key.to_void()).is_some();

            if previous_lock_state != current_lock_state {
                previous_lock_state = current_lock_state;
                IS_RUNNING.store(!current_lock_state, Ordering::SeqCst);
                let (status, action) = if current_lock_state {
                    ("锁屏", "停止")
                } else {
                    ("解锁", "开始")
                };
                println!("系统{}，{}计时", status, action);
            }
        }
        thread::sleep(Duration::from_secs(1));
    }
}
