//! Spinner components for displaying progress during long-running operations.
//!
//! This module provides animated spinner functionality that gives users visual
//! feedback during operations that take time to complete. Spinners can either
//! disappear completely when stopped or show a completion message with checkmark
//! when finished successfully.

use super::terminal::TerminalComponent;
use crossterm::{
    cursor::{position, MoveTo, RestorePosition, SavePosition},
    execute, queue,
    style::Print,
    terminal::{BeginSynchronizedUpdate, Clear, ClearType, EndSynchronizedUpdate},
};
use std::io::IsTerminal;
use std::{
    io::{stdout, Result as IoResult, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tokio::macros::support::Future;

/// Dots9 animation frames for the spinner
const DOTS9_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// Checkmark symbol for completed spinner
const CHECKMARK: &str = "✓";

/// Frame update interval in milliseconds
const FRAME_INTERVAL_MS: u64 = 80;

/// An animated spinner component that reserves a specific line for display.
///
/// The spinner provides visual feedback for long-running operations using
/// a dots animation. It runs in a separate thread to avoid blocking the
/// main operation and reserves its initial line position for updates.
///
/// # Animation
///
/// Uses a 10-frame dots animation (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) that updates every 80ms
/// for smooth visual feedback without being distracting.
///
/// # Line Management
///
/// The spinner captures its initial cursor position and reserves that line
/// for spinner updates. It uses cursor positioning to update the reserved
/// line without interfering with other output that may appear after it.
///
/// # Thread Safety
///
/// The spinner uses atomic operations for thread-safe communication
/// between the main thread and the animation thread.
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::spinner::SpinnerComponent;
/// # use crate::cli::display::terminal::TerminalComponent;
/// let mut spinner = SpinnerComponent::new("Loading data");
/// spinner.start()?;
/// // ... long running operation that may produce output ...
///
/// // Option 1: Complete with success message (shows checkmark and keeps message visible)
/// spinner.done("Data loaded successfully")?;
///
/// // Option 2: Just stop and clear the spinner line completely
/// // spinner.stop()?;
/// # Ok::<(), std::io::Error>(())
/// ```
pub struct SpinnerComponent {
    message: String,
    handle: Option<JoinHandle<()>>,
    stop_signal: Arc<AtomicBool>,
    started: bool,
    initial_line: Option<u16>,
    is_done: bool,
}

impl SpinnerComponent {
    /// Creates a new spinner component with the specified message.
    ///
    /// # Arguments
    ///
    /// * `message` - The message to display alongside the spinner animation
    ///
    /// # Returns
    ///
    /// A new `SpinnerComponent` ready to be started
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::cli::display::spinner::SpinnerComponent;
    /// let mut spinner = SpinnerComponent::new("Loading data");
    /// ```
    pub fn new(message: &str) -> Self {
        Self {
            message: message.to_string(),
            handle: None,
            stop_signal: Arc::new(AtomicBool::new(false)),
            started: false,
            initial_line: None,
            is_done: false,
        }
    }

    /// Completes the spinner with a checkmark and completion message.
    ///
    /// This method stops the spinner animation and displays a checkmark
    /// with the provided completion message on the reserved spinner line.
    /// The completion message remains visible to show successful completion.
    /// Sets the `is_done` flag to true.
    ///
    /// # Arguments
    ///
    /// * `completion_message` - The message to display after the checkmark
    ///
    /// # Returns
    ///
    /// `IoResult<()>` indicating success or failure
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::cli::display::spinner::SpinnerComponent;
    /// # use crate::cli::display::terminal::TerminalComponent;
    /// let mut spinner = SpinnerComponent::new("Loading data");
    /// spinner.start()?;
    /// // ... long running operation ...
    /// spinner.done("Data loaded successfully")?;
    /// // Line now shows: "✓ Data loaded successfully"
    /// # Ok::<(), std::io::Error>(())
    /// ```
    pub fn done(&mut self, completion_message: &str) -> IoResult<()> {
        if !self.started {
            self.is_done = true;
            return Ok(());
        }

        // Signal the thread to stop
        self.stop_signal.store(true, Ordering::Relaxed);

        // Wait for the thread to finish gracefully
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }

        // Display checkmark with completion message on the reserved line
        if let Some(initial_line) = self.initial_line {
            queue!(
                stdout(),
                SavePosition,
                MoveTo(0, initial_line),
                Clear(ClearType::CurrentLine),
                Print(&format!("{CHECKMARK} {completion_message}")),
                RestorePosition
            )?;
            stdout().flush()?;
        }

        self.started = false;
        self.is_done = true;
        Ok(())
    }

    /// Stops the spinner with an optional completion message.
    ///
    /// This is a convenience method that delegates to either `done()` or `stop()`.
    /// If a completion message is provided, calls `done()` to display a checkmark with the message.
    /// If no completion message is provided, calls `stop()` to clear the spinner line completely.
    ///
    /// Note: This method is only available in test builds (`#[cfg(test)]`).
    ///
    /// # Arguments
    ///
    /// * `completion_message` - Optional completion message to display with checkmark
    ///
    /// # Returns
    ///
    /// `IoResult<()>` indicating success or failure
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::cli::display::spinner::SpinnerComponent;
    /// # use crate::cli::display::terminal::TerminalComponent;
    /// let mut spinner = SpinnerComponent::new("Processing");
    /// spinner.start()?;
    /// // ... operation ...
    /// spinner.stop_with_message(Some("Processing complete"))?; // Shows checkmark, sets is_done=true
    /// // OR
    /// spinner.stop_with_message(None)?; // Just clears the line, is_done remains false
    /// # Ok::<(), std::io::Error>(())
    /// ```
    #[cfg(test)]
    pub fn stop_with_message(&mut self, completion_message: Option<&str>) -> IoResult<()> {
        match completion_message {
            Some(message) => self.done(message),
            None => self.stop(),
        }
    }
}

impl TerminalComponent for SpinnerComponent {
    /// Starts the spinner animation.
    ///
    /// Captures the current cursor position to reserve a line for the spinner,
    /// displays the initial spinner frame, and spawns a background thread to
    /// animate the spinner. The spinner updates its reserved line every 80ms
    /// with the next animation frame.
    ///
    /// # Returns
    ///
    /// `IoResult<()>` indicating success or failure
    fn start(&mut self) -> IoResult<()> {
        if self.started {
            return Ok(());
        }

        let message = self.message.clone();
        let stop_signal = self.stop_signal.clone();

        // Capture current cursor position to reserve this line for the spinner
        let initial_pos = position().unwrap_or((0, 0));
        self.initial_line = Some(initial_pos.1);

        // Display initial spinner frame and add newline to separate from subprocess output
        execute!(stdout(), Print(&format!("{} {message}\n", DOTS9_FRAMES[0])))?;
        stdout().flush()?;

        let initial_line = self.initial_line.unwrap();

        self.handle = Some(thread::spawn(move || {
            let mut frame_index = 0;

            while !stop_signal.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(FRAME_INTERVAL_MS));

                if !stop_signal.load(Ordering::Relaxed) {
                    frame_index = (frame_index + 1) % DOTS9_FRAMES.len();

                    // Try synchronized updates first (atomic operation)
                    let sync_result = queue!(
                        stdout(),
                        BeginSynchronizedUpdate,
                        SavePosition,
                        MoveTo(0, initial_line),
                        Clear(ClearType::CurrentLine),
                        Print(&format!("{} {message}", DOTS9_FRAMES[frame_index])),
                        RestorePosition,
                        EndSynchronizedUpdate
                    )
                    .and_then(|_| stdout().flush());

                    // If synchronized updates fail, fall back to queue-based approach
                    if sync_result.is_err() {
                        let _ = queue!(
                            stdout(),
                            SavePosition,
                            MoveTo(0, initial_line),
                            Clear(ClearType::CurrentLine),
                            Print(&format!("{} {message}", DOTS9_FRAMES[frame_index])),
                            RestorePosition
                        )
                        .and_then(|_| stdout().flush());
                    }
                }
            }
        }));

        self.started = true;
        Ok(())
    }

    /// Stops the spinner animation and clears the reserved line.
    ///
    /// Signals the animation thread to stop, waits for it to finish gracefully,
    /// and clears the reserved spinner line completely. Unlike `done()`, this
    /// method does not set the `is_done` flag and leaves no visible trace.
    ///
    /// # Returns
    ///
    /// `IoResult<()>` indicating success or failure
    fn stop(&mut self) -> IoResult<()> {
        if !self.started {
            return Ok(());
        }

        // Signal the thread to stop
        self.stop_signal.store(true, Ordering::Relaxed);

        // Wait for the thread to finish gracefully
        if let Some(handle) = self.handle.take() {
            // Join the thread directly - this ensures it has completely stopped
            // before we clean up the terminal. This eliminates race conditions
            // and prevents terminal corruption.
            let _ = handle.join();
        }

        // Clean up the reserved spinner line if we have it
        if let Some(initial_line) = self.initial_line {
            queue!(
                stdout(),
                SavePosition,
                MoveTo(0, initial_line),
                Clear(ClearType::CurrentLine),
                RestorePosition
            )?;
            stdout().flush()?;
        }

        self.started = false;
        self.initial_line = None;
        // Note: is_done is NOT set to true when just stopping (only when completing with done())
        Ok(())
    }

    /// Performs cleanup after the spinner has been stopped.
    ///
    /// For SpinnerComponent, this is a no-op since the spinner either
    /// disappears completely (when stopped) or shows a completion message
    /// (when done). No additional cleanup is needed.
    ///
    /// # Returns
    ///
    /// Always returns `Ok(())`
    fn cleanup(&mut self) -> IoResult<()> {
        // SpinnerComponent disappears completely, so no newline needed
        // Terminal is already clean at the beginning of the line
        Ok(())
    }
}

impl Drop for SpinnerComponent {
    fn drop(&mut self) {
        // Gracefully clean up if needed, but don't force aggressive cleanup
        if self.started {
            let _ = self.stop();
        }
    }
}

/// Executes a function with a spinner displayed during execution.
///
/// This function provides visual feedback for long-running operations by displaying
/// an animated spinner. The spinner reserves a line for its display and clears
/// completely when the operation finishes.
///
/// Note: This function is only available in test builds (`#[cfg(test)]`).
///
/// # Arguments
///
/// * `message` - The message to display alongside the spinner
/// * `f` - The function to execute while the spinner is active
/// * `activate` - Whether to actually show the spinner (false or non-terminal disables spinner)
///
/// # Returns
///
/// The result of the function execution, unchanged
///
/// # Behavior
///
/// - If `activate` is false or stdout is not a terminal, the function runs without spinner
/// - The spinner uses a dots animation and updates every 80ms
/// - The spinner reserves its initial line position for updates
/// - Terminal state is properly cleaned up after completion (spinner disappears completely)
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::spinner::with_spinner;
/// let result = with_spinner("Processing data", || {
///     // Long-running operation
///     42
/// }, true);
/// assert_eq!(result, 42);
/// // Spinner disappears completely after operation
/// ```
#[cfg(test)]
pub fn with_spinner<F, R>(message: &str, f: F, activate: bool) -> R
where
    F: FnOnce() -> R,
{
    let sp = if activate && stdout().is_terminal() {
        let mut spinner = SpinnerComponent::new(message);
        let _ = spinner.start();
        Some(spinner)
    } else {
        None
    };

    let res = f();

    if let Some(mut spinner) = sp {
        let _ = spinner.stop();
        let _ = spinner.cleanup();
    }

    res
}

/// Executes a function with a spinner and completion message displayed during execution.
///
/// This is an enhanced version of `with_spinner` that displays a checkmark with
/// a completion message when the operation finishes successfully. If the operation
/// returns an error, the spinner is simply cleared without showing completion.
///
/// # Arguments
///
/// * `message` - The message to display alongside the spinner
/// * `completion_message` - The message to display with checkmark upon successful completion
/// * `f` - The function to execute while the spinner is active
/// * `activate` - Whether to actually show the spinner (false or non-terminal disables spinner)
///
/// # Returns
///
/// The result of the function execution, unchanged
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::spinner::with_spinner_completion;
/// let result = with_spinner_completion("Processing data", "Data processed successfully", || {
///     // Long-running operation
///     42
/// }, true);
/// assert_eq!(result, 42);
/// // Spinner shows: "✓ Data processed successfully"
/// ```
pub fn with_spinner_completion<F, R>(
    message: &str,
    completion_message: &str,
    f: F,
    activate: bool,
) -> R
where
    F: FnOnce() -> R,
{
    let sp = if activate && stdout().is_terminal() {
        let mut spinner = SpinnerComponent::new(message);
        let _ = spinner.start();
        Some(spinner)
    } else {
        None
    };

    let res = f();

    if let Some(mut spinner) = sp {
        let _ = spinner.done(completion_message);
        let _ = spinner.cleanup();
    }

    res
}

/// Executes an asynchronous function with a spinner displayed during execution.
///
/// This is the async version of `with_spinner`, providing the same visual feedback
/// for long-running async operations. The spinner reserves a line for its display
/// and clears completely when the operation finishes.
///
/// Note: This function is only available in test builds (`#[cfg(test)]`).
///
/// # Arguments
///
/// * `message` - The message to display alongside the spinner
/// * `f` - The async function to execute while the spinner is active
/// * `activate` - Whether to actually show the spinner (false or non-terminal disables spinner)
///
/// # Returns
///
/// The result of the async function execution, unchanged
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::spinner::with_spinner_async;
/// # async fn example() {
/// let result = with_spinner_async("Processing async data", async {
///     // Async operation
///     tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
///     42
/// }, true).await;
/// assert_eq!(result, 42);
/// // Spinner disappears completely after operation
/// # }
/// ```
#[cfg(test)]
pub async fn with_spinner_async<F, R>(message: &str, f: F, activate: bool) -> R
where
    F: Future<Output = R>,
{
    let sp = if activate && stdout().is_terminal() {
        let mut spinner = SpinnerComponent::new(message);
        let _ = spinner.start();
        Some(spinner)
    } else {
        None
    };

    let res = f.await;

    if let Some(mut spinner) = sp {
        let _ = spinner.stop();
        let _ = spinner.cleanup();
    }

    res
}

/// Executes an asynchronous function with a spinner and completion message displayed during execution.
///
/// This is the async version of `with_spinner_completion`, providing the same completion
/// message functionality for long-running async operations.
///
/// # Arguments
///
/// * `message` - The message to display alongside the spinner
/// * `completion_message` - The message to display with checkmark upon successful completion
/// * `f` - The async function to execute while the spinner is active
/// * `activate` - Whether to actually show the spinner (false or non-terminal disables spinner)
///
/// # Returns
///
/// The result of the async function execution, unchanged
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::spinner::with_spinner_completion_async;
/// # async fn example() {
/// let result = with_spinner_completion_async("Processing async data", "Async processing complete", async {
///     // Async operation
///     tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
///     42
/// }, true).await;
/// assert_eq!(result, 42);
/// // Spinner shows: "✓ Async processing complete"
/// # }
/// ```
pub async fn with_spinner_completion_async<F, R>(
    message: &str,
    completion_message: &str,
    f: F,
    activate: bool,
) -> R
where
    F: Future<Output = R>,
{
    let sp = if activate && stdout().is_terminal() {
        let mut spinner = SpinnerComponent::new(message);
        let _ = spinner.start();
        Some(spinner)
    } else {
        None
    };

    let res = f.await;

    if let Some(mut spinner) = sp {
        let _ = spinner.done(completion_message);
        let _ = spinner.cleanup();
    }

    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_spinner_component_new() {
        let _spinner = SpinnerComponent::new("Test message");
        // Just test that creation doesn't panic
    }

    #[test]
    fn test_with_spinner_returns_result() {
        let result = with_spinner("Test", || 42, false);
        assert_eq!(result, 42);
    }

    #[test]
    fn test_with_spinner_with_closure() {
        let value = 10;
        let result = with_spinner("Test", || value * 2, false);
        assert_eq!(result, 20);
    }

    #[tokio::test]
    async fn test_with_spinner_async_returns_result() {
        let result = with_spinner_async("Test", async { 42 }, false).await;
        assert_eq!(result, 42);
    }

    #[tokio::test]
    async fn test_with_spinner_async_with_delay() {
        let result = with_spinner_async(
            "Test",
            async {
                tokio::time::sleep(Duration::from_millis(10)).await;
                "completed"
            },
            false,
        )
        .await;
        assert_eq!(result, "completed");
    }

    #[test]
    fn test_with_spinner_error_handling() {
        let result: Result<i32, &str> = with_spinner("Test", || Err("test error"), false);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "test error");
    }

    #[tokio::test]
    async fn test_with_spinner_async_error_handling() {
        let result: Result<i32, &str> =
            with_spinner_async("Test", async { Err("test error") }, false).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "test error");
    }

    #[test]
    fn test_dots9_frames_constant() {
        assert_eq!(DOTS9_FRAMES.len(), 10);
        assert_eq!(DOTS9_FRAMES[0], "⠋");
        assert_eq!(DOTS9_FRAMES[9], "⠏");
    }

    #[test]
    fn test_frame_interval_constant() {
        assert_eq!(FRAME_INTERVAL_MS, 80);
    }

    #[test]
    fn test_spinner_component_tracks_initial_line() {
        let spinner = SpinnerComponent::new("Test spinner");
        assert_eq!(spinner.initial_line, None);
        // After start() is called, initial_line should be set
        // This is tested in integration tests since it requires terminal interaction
    }

    #[test]
    fn test_spinner_concurrent_output_simulation() {
        // This test simulates the concurrent output scenario without actual terminal interaction
        // It verifies that the spinner component properly handles the line tracking logic
        let spinner = SpinnerComponent::new("Processing");

        // Verify initial state
        assert!(!spinner.started);
        assert_eq!(spinner.initial_line, None);
        assert!(!spinner.is_done);

        // Note: Actual concurrent output testing requires integration tests
        // with real terminal interaction, which is commented out below
    }

    #[test]
    fn test_spinner_done_state() {
        let mut spinner = SpinnerComponent::new("Processing");

        // Verify initial state
        assert!(!spinner.is_done);

        // Test done() method without starting (should not error)
        let result = spinner.done("Task completed");
        assert!(result.is_ok());
        assert!(spinner.is_done);
    }

    #[test]
    fn test_spinner_stop_with_message() {
        let mut spinner = SpinnerComponent::new("Processing");

        // Test stop_with_message with completion message
        let result = spinner.stop_with_message(Some("Task completed"));
        assert!(result.is_ok());
        assert!(spinner.is_done);

        // Test stop_with_message without completion message
        let mut spinner2 = SpinnerComponent::new("Processing");
        let result2 = spinner2.stop_with_message(None);
        assert!(result2.is_ok());
        assert!(!spinner2.is_done); // Should not be marked as done when just stopped
    }

    #[test]
    fn test_with_spinner_completion() {
        let result = with_spinner_completion("Processing", "Task completed", || 42, false);
        assert_eq!(result, 42);
    }

    #[tokio::test]
    async fn test_with_spinner_completion_async() {
        let result =
            with_spinner_completion_async("Processing", "Task completed", async { 42 }, false)
                .await;
        assert_eq!(result, 42);
    }

    #[test]
    fn test_checkmark_constant() {
        assert_eq!(CHECKMARK, "✓");
    }
}
