//! Global terminal output lock and scroll-region awareness.
//!
//! Multiple components (spinner thread, pinned prompt, show_message) write
//! multi-command escape sequences to stdout. Without serialization, those
//! sequences can interleave and corrupt terminal state.
//!
//! Every block of escape sequences that must be atomic should be guarded
//! by [`acquire`]. The critical sections are microsecond-scale writes to
//! a pipe, so contention is negligible.
//!
//! When a pinned prompt is active, [`scroll_region_bottom`] returns the
//! row that log output should target so it scrolls inside the region
//! instead of overwriting the prompt area.

use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Mutex, MutexGuard};

static LOCK: Mutex<()> = Mutex::new(());

/// 0 = no active scroll region. Non-zero = the 1-based row number of the
/// scroll region bottom (i.e. the row where log output should be written).
static SCROLL_BOTTOM: AtomicU16 = AtomicU16::new(0);

/// Acquires the global terminal output lock.
///
/// All code that writes multi-command escape sequences to stdout should hold
/// this guard for the duration of the atomic write + flush.
pub fn acquire() -> MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Mark that a scroll region is active. Log output will be redirected to
/// `row` (the bottom of the scroll region) so it doesn't overwrite the
/// pinned prompt area below.
pub fn set_scroll_region_bottom(row: u16) {
    SCROLL_BOTTOM.store(row.saturating_add(1), Ordering::Relaxed);
}

/// Clear the scroll region marker (called when the pinned prompt exits).
pub fn clear_scroll_region_bottom() {
    SCROLL_BOTTOM.store(0, Ordering::Relaxed);
}

/// Returns the 0-based scroll-region bottom row, or `None` when no scroll
/// region is active.
pub fn scroll_region_bottom() -> Option<u16> {
    match SCROLL_BOTTOM.load(Ordering::Relaxed) {
        0 => None,
        v => Some(v - 1),
    }
}
