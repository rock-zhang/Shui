use parking_lot::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

lazy_static::lazy_static! {
    pub static ref TIMER_STATE: Arc<Mutex<Instant>> = Arc::new(Mutex::new(Instant::now()));
    pub static ref IS_RUNNING: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));
}
