//! Testable TUI abstraction for integration testing
//!
//! This module provides traits and mock implementations that allow
//! testing the full TUI event loop without a real terminal.

use super::app::DevTuiApp;
use super::event::Event;
use super::handler::handle_key_events;
use super::log_collector::LogReceiver;
use super::ui;
use super::DevTuiResult;
use async_trait::async_trait;
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::collections::VecDeque;

/// Trait for abstracting event sources
///
/// This allows injecting mock events during testing while using
/// real crossterm events in production.
#[async_trait]
pub trait EventSource: Send {
    /// Get the next event (blocking)
    async fn next(&mut self) -> DevTuiResult<Event>;
}

/// Trait for abstracting terminal rendering
///
/// This allows capturing rendered output during testing.
pub trait TerminalRenderer {
    /// Draw the current app state
    fn draw(&mut self, app: &mut DevTuiApp) -> DevTuiResult<()>;

    /// Get the rendered output as a string (for testing)
    fn get_output(&self) -> Option<String>;
}

/// Mock event source for testing
///
/// Allows injecting a predefined sequence of events.
#[allow(dead_code)]
pub struct MockEventSource {
    events: VecDeque<Event>,
    /// If true, returns error when events are exhausted
    /// If false, blocks forever (for testing "app keeps running")
    error_on_empty: bool,
}

#[allow(dead_code)]
impl MockEventSource {
    /// Create a new mock event source with predefined events
    pub fn new(events: Vec<Event>) -> Self {
        Self {
            events: events.into(),
            error_on_empty: true,
        }
    }

    /// Add more events to the queue
    pub fn push_event(&mut self, event: Event) {
        self.events.push_back(event);
    }

    /// Check if all events have been consumed
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

#[async_trait]
impl EventSource for MockEventSource {
    async fn next(&mut self) -> DevTuiResult<Event> {
        if let Some(event) = self.events.pop_front() {
            Ok(event)
        } else if self.error_on_empty {
            Err(Box::new(std::io::Error::other("No more mock events")))
        } else {
            // Block forever - useful for testing "app stays running"
            std::future::pending().await
        }
    }
}

/// Test terminal renderer that captures output
pub struct TestTerminalRenderer {
    terminal: Terminal<TestBackend>,
    last_output: Option<String>,
}

impl TestTerminalRenderer {
    /// Create a new test renderer with specified dimensions
    pub fn new(width: u16, height: u16) -> DevTuiResult<Self> {
        let backend = TestBackend::new(width, height);
        let terminal = Terminal::new(backend)?;
        Ok(Self {
            terminal,
            last_output: None,
        })
    }
}

impl TerminalRenderer for TestTerminalRenderer {
    fn draw(&mut self, app: &mut DevTuiApp) -> DevTuiResult<()> {
        self.terminal.draw(|frame| {
            app.viewport = frame.size();
            ui::render(app, frame);
        })?;
        self.last_output = Some(self.terminal.backend().to_string());
        Ok(())
    }

    fn get_output(&self) -> Option<String> {
        self.last_output.clone()
    }
}

/// Result of running the testable TUI loop
pub struct TuiRunResult {
    /// Final app state
    pub app: DevTuiApp,
    /// Number of events processed
    pub events_processed: usize,
    /// Number of renders performed
    pub renders_performed: usize,
    /// All rendered frames (if capture_all_frames was enabled)
    pub frames: Vec<String>,
    /// Whether the loop exited normally (app.running = false)
    pub exited_normally: bool,
    /// Error message if loop exited due to error
    pub error: Option<String>,
}

/// Configuration for testable TUI run
pub struct TuiTestConfig {
    /// Maximum events to process before forcing exit
    pub max_events: usize,
    /// Whether to capture all frames
    pub capture_all_frames: bool,
    /// Terminal width
    pub width: u16,
    /// Terminal height
    pub height: u16,
}

impl Default for TuiTestConfig {
    fn default() -> Self {
        Self {
            max_events: 1000,
            capture_all_frames: false,
            width: 80,
            height: 24,
        }
    }
}

/// Run the TUI event loop with injectable dependencies
///
/// This is the testable version of the main event loop that allows
/// injecting mock events and capturing rendered output.
pub async fn run_testable_tui<E: EventSource>(
    mut app: DevTuiApp,
    mut event_source: E,
    mut log_receiver: LogReceiver,
    config: TuiTestConfig,
) -> TuiRunResult {
    let mut renderer = match TestTerminalRenderer::new(config.width, config.height) {
        Ok(r) => r,
        Err(e) => {
            return TuiRunResult {
                app,
                events_processed: 0,
                renders_performed: 0,
                frames: vec![],
                exited_normally: false,
                error: Some(format!("Failed to create renderer: {}", e)),
            };
        }
    };

    let mut events_processed = 0;
    let mut renders_performed = 0;
    let mut frames = Vec::new();
    let mut error = None;

    // Initial draw (this was the bug we fixed!)
    if let Err(e) = renderer.draw(&mut app) {
        return TuiRunResult {
            app,
            events_processed,
            renders_performed,
            frames,
            exited_normally: false,
            error: Some(format!("Initial draw failed: {}", e)),
        };
    }
    renders_performed += 1;
    if config.capture_all_frames {
        if let Some(output) = renderer.get_output() {
            frames.push(output);
        }
    }

    // Main event loop
    while app.running && events_processed < config.max_events {
        match event_source.next().await {
            Ok(Event::Tick) => {
                // Process pending logs
                while let Ok(log_entry) = log_receiver.try_recv() {
                    app.logs.push(log_entry);
                }
                app.tick();
            }
            Ok(Event::Key(key_event)) => {
                if let Err(e) = handle_key_events(key_event, &mut app) {
                    error = Some(format!("Key handler error: {}", e));
                    break;
                }
            }
            Ok(Event::MouseScroll(_)) => {}
            Err(e) => {
                error = Some(format!("Event source error: {}", e));
                break;
            }
        }

        events_processed += 1;

        // Render after each event
        if let Err(e) = renderer.draw(&mut app) {
            error = Some(format!("Draw failed: {}", e));
            break;
        }
        renders_performed += 1;

        if config.capture_all_frames {
            if let Some(output) = renderer.get_output() {
                frames.push(output);
            }
        }
    }

    TuiRunResult {
        exited_normally: !app.running && error.is_none(),
        app,
        events_processed,
        renders_performed,
        frames,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::routines::dev_tui::app::{LogEntry, LogLevel, LogSource, Panel};
    use crate::cli::routines::dev_tui::log_collector::LogCollector;
    use crate::cli::routines::dev_tui::test_utils::mock_project;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    fn key_event(code: KeyCode) -> Event {
        Event::Key(KeyEvent::new(code, KeyModifiers::empty()))
    }

    // ==========================================================================
    // Critical Integration Tests - These Would Have Caught the Bug!
    // ==========================================================================

    #[tokio::test]
    async fn tui_renders_immediately_on_startup() {
        // This test would have caught the original bug where
        // the TUI blocked waiting for events before drawing
        let app = DevTuiApp::new(mock_project());
        let events = MockEventSource::new(vec![
            Event::Tick, // First tick
        ]);
        let (_collector, receiver) = LogCollector::new();

        let result = run_testable_tui(
            app,
            events,
            receiver,
            TuiTestConfig {
                capture_all_frames: true,
                ..Default::default()
            },
        )
        .await;

        // CRITICAL: Should have rendered BEFORE processing first event
        // Initial draw + 1 event = at least 2 renders
        assert!(
            result.renders_performed >= 2,
            "Expected at least 2 renders (initial + event), got {}",
            result.renders_performed
        );

        // First frame should exist (initial render)
        assert!(
            !result.frames.is_empty(),
            "Should have captured at least one frame"
        );

        // First frame should show the TUI, not be empty
        let first_frame = &result.frames[0];
        assert!(
            first_frame.contains("MOOSE DEV"),
            "First frame should contain header"
        );
    }

    #[tokio::test]
    async fn tui_exits_on_q_key() {
        let app = DevTuiApp::new(mock_project());
        let events = MockEventSource::new(vec![Event::Tick, key_event(KeyCode::Char('q'))]);
        let (_collector, receiver) = LogCollector::new();

        let result = run_testable_tui(app, events, receiver, TuiTestConfig::default()).await;

        assert!(result.exited_normally, "Should exit normally on 'q'");
        assert!(!result.app.running, "App should not be running");
        assert_eq!(result.events_processed, 2);
    }

    #[tokio::test]
    async fn tui_exits_on_escape() {
        let app = DevTuiApp::new(mock_project());
        let events = MockEventSource::new(vec![key_event(KeyCode::Esc)]);
        let (_collector, receiver) = LogCollector::new();

        let result = run_testable_tui(app, events, receiver, TuiTestConfig::default()).await;

        assert!(result.exited_normally);
    }

    #[tokio::test]
    async fn tui_exits_on_ctrl_c() {
        let app = DevTuiApp::new(mock_project());
        let events = MockEventSource::new(vec![Event::Key(KeyEvent::new(
            KeyCode::Char('c'),
            KeyModifiers::CONTROL,
        ))]);
        let (_collector, receiver) = LogCollector::new();

        let result = run_testable_tui(app, events, receiver, TuiTestConfig::default()).await;

        assert!(result.exited_normally);
    }

    // ==========================================================================
    // Panel Navigation Integration Tests
    // ==========================================================================

    #[tokio::test]
    async fn tui_panel_switching_with_number_keys() {
        let app = DevTuiApp::new(mock_project());
        let events = MockEventSource::new(vec![
            key_event(KeyCode::Char('2')), // Switch to infrastructure
            key_event(KeyCode::Char('1')), // Switch back to logs
            key_event(KeyCode::Char('q')), // Quit
        ]);
        let (_collector, receiver) = LogCollector::new();

        let config = TuiTestConfig {
            capture_all_frames: true,
            ..Default::default()
        };

        let result = run_testable_tui(app, events, receiver, config).await;

        assert!(result.exited_normally);
        // Should have: initial + 3 events = 4 renders
        assert_eq!(result.renders_performed, 4);
    }

    #[tokio::test]
    async fn tui_tab_toggles_panels() {
        let app = DevTuiApp::new(mock_project());
        let events = MockEventSource::new(vec![
            key_event(KeyCode::Tab), // Logs -> Infrastructure
            key_event(KeyCode::Tab), // Infrastructure -> Resources
            key_event(KeyCode::Tab), // Resources -> Logs
            key_event(KeyCode::Char('q')),
        ]);
        let (_collector, receiver) = LogCollector::new();

        let result = run_testable_tui(app, events, receiver, TuiTestConfig::default()).await;

        assert!(result.exited_normally);
        assert_eq!(result.app.active_panel, Panel::Logs);
    }

    // ==========================================================================
    // Log Processing Integration Tests
    // ==========================================================================

    #[tokio::test]
    async fn tui_processes_logs_on_tick() {
        let app = DevTuiApp::new(mock_project());
        let initial_log_count = app.logs.len();

        let (collector, receiver) = LogCollector::new();

        // Send some log entries
        let handle = collector.system_handle();
        handle.info("Test log 1");
        handle.info("Test log 2");

        let events = MockEventSource::new(vec![
            Event::Tick, // Should process the logs
            key_event(KeyCode::Char('q')),
        ]);

        let result = run_testable_tui(app, events, receiver, TuiTestConfig::default()).await;

        // Initial logs + 2 we added
        assert!(
            result.app.logs.len() >= initial_log_count + 2,
            "Expected at least {} logs (initial {} + 2 added), got {}",
            initial_log_count + 2,
            initial_log_count,
            result.app.logs.len()
        );
    }

    // ==========================================================================
    // Scroll Integration Tests
    // ==========================================================================

    #[tokio::test]
    async fn tui_scroll_navigation_flow() {
        let mut app = DevTuiApp::new(mock_project());
        // Add many logs to enable scrolling
        for i in 0..50 {
            app.logs.push(LogEntry::new(
                LogSource::System,
                LogLevel::Info,
                format!("Log entry {}", i),
            ));
        }

        let events = MockEventSource::new(vec![
            key_event(KeyCode::Char('j')), // Down
            key_event(KeyCode::Char('j')), // Down
            key_event(KeyCode::Char('j')), // Down
            key_event(KeyCode::Char('k')), // Up
            key_event(KeyCode::Char('G')), // Bottom
            key_event(KeyCode::Char('g')), // Top
            key_event(KeyCode::Char('q')),
        ]);
        let (_collector, receiver) = LogCollector::new();

        let result = run_testable_tui(app, events, receiver, TuiTestConfig::default()).await;

        assert!(result.exited_normally);
        // After g (top), offset should be 0
        assert_eq!(result.app.log_scroll.offset, 0);
    }

    // ==========================================================================
    // Filter Integration Tests
    // ==========================================================================

    #[tokio::test]
    async fn tui_filter_changes_update_display() {
        let mut app = DevTuiApp::new(mock_project());
        app.logs.push(LogEntry::new(
            LogSource::Watcher,
            LogLevel::Info,
            "Watcher log".into(),
        ));
        app.logs.push(LogEntry::new(
            LogSource::System,
            LogLevel::Error,
            "Error log".into(),
        ));

        let events = MockEventSource::new(vec![
            key_event(KeyCode::Char('w')), // Filter to watcher
            key_event(KeyCode::Char('e')), // Filter to errors
            key_event(KeyCode::Char('a')), // Back to all
            key_event(KeyCode::Char('q')),
        ]);
        let (_collector, receiver) = LogCollector::new();

        let config = TuiTestConfig {
            capture_all_frames: true,
            ..Default::default()
        };

        let result = run_testable_tui(app, events, receiver, config).await;

        assert!(result.exited_normally);
        // Verify frames were captured for each state
        assert_eq!(result.frames.len(), 5); // initial + 4 events
    }

    // ==========================================================================
    // Error Handling Integration Tests
    // ==========================================================================

    #[tokio::test]
    async fn tui_handles_event_source_exhaustion() {
        let app = DevTuiApp::new(mock_project());
        let events = MockEventSource::new(vec![
            Event::Tick,
            // No quit event - source will be exhausted
        ]);
        let (_collector, receiver) = LogCollector::new();

        let result = run_testable_tui(app, events, receiver, TuiTestConfig::default()).await;

        // Should exit with error, not hang forever
        assert!(!result.exited_normally);
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("No more mock events"));
    }

    #[tokio::test]
    async fn tui_respects_max_events_limit() {
        let app = DevTuiApp::new(mock_project());
        // Create more events than the limit
        let events = MockEventSource::new(vec![Event::Tick; 100]);
        let (_collector, receiver) = LogCollector::new();

        let config = TuiTestConfig {
            max_events: 5,
            ..Default::default()
        };

        let result = run_testable_tui(app, events, receiver, config).await;

        // Should stop at max_events even though app.running is still true
        assert_eq!(result.events_processed, 5);
        assert!(result.app.running); // App didn't quit, we just hit the limit
    }

    // ==========================================================================
    // Snapshot Integration Test
    // ==========================================================================

    #[tokio::test]
    async fn tui_full_interaction_snapshot() {
        use insta::assert_snapshot;

        let app = DevTuiApp::new(mock_project());
        let events = MockEventSource::new(vec![
            Event::Tick,
            key_event(KeyCode::Char('2')), // Switch to infrastructure panel
        ]);
        let (_collector, receiver) = LogCollector::new();

        let config = TuiTestConfig {
            capture_all_frames: true,
            width: 80,
            height: 24,
            ..Default::default()
        };

        let result = run_testable_tui(app, events, receiver, config).await;

        // Snapshot the final frame (infrastructure panel active)
        if let Some(last_frame) = result.frames.last() {
            assert_snapshot!("tui_infrastructure_panel_after_switch", last_frame);
        }
    }
}
