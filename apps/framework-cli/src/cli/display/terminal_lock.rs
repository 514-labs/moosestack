//! Global terminal output lock.
//!
//! Multiple components (spinner thread, pinned prompt, show_message) write
//! multi-command escape sequences to stdout. Without serialization, those
//! sequences can interleave and corrupt terminal state.
//!
//! Every block of escape sequences that must be atomic should be guarded
//! by [`acquire`]. The critical sections are microsecond-scale writes to
//! a pipe, so contention is negligible.

use std::sync::{Mutex, MutexGuard};

static LOCK: Mutex<()> = Mutex::new(());

/// Acquires the global terminal output lock.
///
/// All code that writes multi-command escape sequences to stdout should hold
/// this guard for the duration of the atomic write + flush.
pub fn acquire() -> MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}
