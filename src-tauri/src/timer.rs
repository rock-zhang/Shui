use parking_lot::Mutex;
use std::sync::atomic::AtomicBool;
#[cfg(not(target_os = "android"))]
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

lazy_static::lazy_static! {
    pub static ref TIMER_STATE: Arc<Mutex<Instant>> = Arc::new(Mutex::new(Instant::now()));
    pub static ref IS_RUNNING: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));
}

/// 用户在托盘里主动点的「暂停计时」。和锁屏是两条独立的暂停来源：
/// 锁屏只该临时停表，解锁要恢复；手动暂停必须一直保持到用户重新计时。
/// Android 的计时由原生闹钟驱动，用不上这套闸门。
#[cfg(not(target_os = "android"))]
static MANUAL_PAUSED: AtomicBool = AtomicBool::new(false);

/// 系统层面不可用（锁屏、显示器关闭、会话锁定）。
#[cfg(not(target_os = "android"))]
static SYSTEM_INACTIVE: AtomicBool = AtomicBool::new(false);

/// 根据两个独立来源重算最终闸门。
#[cfg(not(target_os = "android"))]
pub fn refresh_gate() {
    let paused = MANUAL_PAUSED.load(Ordering::SeqCst);
    let inactive = SYSTEM_INACTIVE.load(Ordering::SeqCst);
    IS_RUNNING.store(!paused && !inactive, Ordering::SeqCst);
}

/// 托盘「暂停计时」：手动暂停，直到用户点「重新计时」。
#[cfg(not(target_os = "android"))]
pub fn pause_manually() {
    MANUAL_PAUSED.store(true, Ordering::SeqCst);
    refresh_gate();
}

/// 托盘「重新计时」：解除手动暂停（锁屏期间仍然不跑）。
#[cfg(not(target_os = "android"))]
pub fn resume_manually() {
    MANUAL_PAUSED.store(false, Ordering::SeqCst);
    refresh_gate();
}

/// 锁屏 / 显示器关闭等系统状态变化。
#[cfg(not(target_os = "android"))]
pub fn set_system_inactive(inactive: bool) {
    SYSTEM_INACTIVE.store(inactive, Ordering::SeqCst);
    refresh_gate();
}

/// 到点弹提醒时停表。这不是用户意图的暂停，所以不写 `MANUAL_PAUSED`；
/// 提醒结束后的 `reset_timer` 会按两个来源重新放行。
#[cfg(not(target_os = "android"))]
pub fn suspend_for_reminder() {
    IS_RUNNING.store(false, Ordering::SeqCst);
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;

    /// 两个来源共用一个全局闸门，放在同一个测试里顺序验证，避免并行互相干扰。
    #[test]
    fn manual_pause_and_lock_are_independent() {
        resume_manually();
        set_system_inactive(false);
        assert!(IS_RUNNING.load(Ordering::SeqCst));

        // 手动暂停后锁屏、解锁，暂停不能被解锁顺手解除。
        pause_manually();
        set_system_inactive(true);
        set_system_inactive(false);
        assert!(!IS_RUNNING.load(Ordering::SeqCst), "手动暂停必须保持");

        // 锁屏期间点「重新计时」，要等解锁后才真正恢复。
        resume_manually();
        set_system_inactive(true);
        assert!(!IS_RUNNING.load(Ordering::SeqCst), "锁屏期间不能恢复计时");

        set_system_inactive(false);
        assert!(IS_RUNNING.load(Ordering::SeqCst));
    }
}
