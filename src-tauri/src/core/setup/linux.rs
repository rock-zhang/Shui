use crate::timer::IS_RUNNING;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

#[cfg(target_os = "linux")]
pub fn monitor_lock_screen() {
    use dbus::blocking::Connection;
    use dbus::message::MatchRule;

    let mut previous_lock_state = false;

    // 连接到系统D-Bus
    let conn = Connection::new_session().expect("D-Bus连接失败");

    // 创建匹配规则来监听锁屏事件
    let mut rule = MatchRule::new();
    rule.interface = Some("org.freedesktop.ScreenSaver".into());
    rule.member = Some("ActiveChanged".into());

    let proxy = conn.with_proxy(
        "org.freedesktop.ScreenSaver",
        "/org/freedesktop/ScreenSaver",
        Duration::from_millis(1000),
    );

    // 添加匹配规则
    conn.add_match(rule).expect("无法添加D-Bus匹配规则");

    loop {
        // 检查当前锁屏状态
        let result: Result<(bool,), _> =
            proxy.method_call("org.freedesktop.ScreenSaver", "GetActive", ());

        if let Ok((current_lock_state,)) = result {
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

#[cfg(not(target_os = "linux"))]
pub fn monitor_lock_screen() {
    println!("当前系统不支持锁屏监控");
}
