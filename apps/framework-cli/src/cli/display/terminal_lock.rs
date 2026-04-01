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
//! When stdout is not a TTY (production, CI, piped output), no escape
//! sequences are emitted and spinners never start, so there is no
//! concurrent writer contention. In that case [`acquire`] returns `None`
//! and [`scroll_region_bottom`] always yields `None`.
//!
//! When a pinned prompt is active, [`scroll_region_bottom`] returns the
//! row that log output should target so it scrolls inside the region
//! instead of overwriting the prompt area.

use std::io::IsTerminal;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};

static LOCK: Mutex<()> = Mutex::new(());

/// Evaluated once on first access — `true` when stdout is a real terminal.
static IS_TTY: LazyLock<bool> = LazyLock::new(|| std::io::stdout().is_terminal());

/// 0 = no active scroll region. Non-zero = the 1-based row number of the
/// scroll region bottom (i.e. the row where log output should be written).
static SCROLL_BOTTOM: AtomicU16 = AtomicU16::new(0);

/// Acquires the global terminal output lock.
///
/// Returns `Some(guard)` when stdout is a TTY (escape sequences may
/// interleave), `None` otherwise. Callers simply bind
/// `let _guard = acquire();` — dropping `None` is free, dropping `Some`
/// releases the lock.
pub fn acquire() -> Option<MutexGuard<'static, ()>> {
    if *IS_TTY {
        Some(LOCK.lock().unwrap_or_else(|e| e.into_inner()))
    } else {
        None
    }
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
/// region is active or when stdout is not a TTY.
pub fn scroll_region_bottom() -> Option<u16> {
    if !*IS_TTY {
        return None;
    }
    match SCROLL_BOTTOM.load(Ordering::Relaxed) {
        0 => None,
        v => Some(v - 1),
    }
}
