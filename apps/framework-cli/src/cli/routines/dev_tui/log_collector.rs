//! Log collection for Dev TUI
//!
//! This module provides a channel-based log collector that aggregates messages
//! from various sources (file watcher, web server, infrastructure changes, etc.)
//! for display in the TUI.

// TODO(PR5): Remove this allow once mod.rs uses these types
#![allow(dead_code)]

use super::app::{LogEntry, LogLevel, LogSource};
use tokio::sync::mpsc;

/// Sender handle for submitting log entries
pub type LogSender = mpsc::UnboundedSender<LogEntry>;

/// Receiver handle for consuming log entries
pub type LogReceiver = mpsc::UnboundedReceiver<LogEntry>;

/// Creates a new log collector channel pair
///
/// Returns a sender that can be cloned and distributed to various components,
/// and a receiver for the TUI to consume.
pub fn create_log_channel() -> (LogSender, LogReceiver) {
    mpsc::unbounded_channel()
}

/// A clonable handle for sending log entries from various sources
#[derive(Clone)]
pub struct LogCollectorHandle {
    sender: LogSender,
    source: LogSource,
}

impl LogCollectorHandle {
    /// Create a new handle for a specific log source
    pub fn new(sender: LogSender, source: LogSource) -> Self {
        Self { sender, source }
    }

    /// Send an info-level log message
    pub fn info(&self, message: impl Into<String>) {
        let _ = self
            .sender
            .send(LogEntry::new(self.source, LogLevel::Info, message.into()));
    }

    /// Send a warning-level log message
    #[allow(dead_code)]
    pub fn warn(&self, message: impl Into<String>) {
        let _ = self.sender.send(LogEntry::new(
            self.source,
            LogLevel::Warning,
            message.into(),
        ));
    }

    /// Send an error-level log message
    #[allow(dead_code)]
    pub fn error(&self, message: impl Into<String>) {
        let _ = self
            .sender
            .send(LogEntry::new(self.source, LogLevel::Error, message.into()));
    }

    /// Send a debug-level log message
    #[allow(dead_code)]
    pub fn debug(&self, message: impl Into<String>) {
        let _ = self
            .sender
            .send(LogEntry::new(self.source, LogLevel::Debug, message.into()));
    }
}

/// Log collector that aggregates messages from multiple sources
pub struct LogCollector {
    sender: LogSender,
}

impl LogCollector {
    /// Create a new log collector with its receiver
    pub fn new() -> (Self, LogReceiver) {
        let (sender, receiver) = create_log_channel();
        (Self { sender }, receiver)
    }

    /// Create a handle for the watcher source
    #[allow(dead_code)]
    pub fn watcher_handle(&self) -> LogCollectorHandle {
        LogCollectorHandle::new(self.sender.clone(), LogSource::Watcher)
    }

    /// Create a handle for the web server source
    #[allow(dead_code)]
    pub fn webserver_handle(&self) -> LogCollectorHandle {
        LogCollectorHandle::new(self.sender.clone(), LogSource::WebServer)
    }

    /// Create a handle for the infrastructure source
    #[allow(dead_code)]
    pub fn infra_handle(&self) -> LogCollectorHandle {
        LogCollectorHandle::new(self.sender.clone(), LogSource::Infrastructure)
    }

    /// Create a handle for the system source
    pub fn system_handle(&self) -> LogCollectorHandle {
        LogCollectorHandle::new(self.sender.clone(), LogSource::System)
    }

    /// Create a handle for the metrics source
    #[allow(dead_code)]
    pub fn metrics_handle(&self) -> LogCollectorHandle {
        LogCollectorHandle::new(self.sender.clone(), LogSource::Metrics)
    }

    /// Get the raw sender for custom integrations
    #[allow(dead_code)]
    pub fn sender(&self) -> LogSender {
        self.sender.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // LogCollector Creation Tests
    // ==========================================================================

    #[test]
    fn log_collector_creates_working_channel() {
        let (collector, _receiver) = LogCollector::new();
        let handle = collector.system_handle();
        // Should not panic
        handle.info("test message");
    }

    #[test]
    fn create_log_channel_returns_valid_pair() {
        let (sender, mut receiver) = create_log_channel();
        let entry = LogEntry::new(LogSource::System, LogLevel::Info, "test".into());
        sender.send(entry).unwrap();

        let received = receiver.try_recv().unwrap();
        assert_eq!(received.message, "test");
    }

    // ==========================================================================
    // LogCollectorHandle Source Tests
    // ==========================================================================

    #[test]
    fn handle_sends_correct_source_watcher() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.watcher_handle();
        handle.info("test");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.source, LogSource::Watcher);
    }

    #[test]
    fn handle_sends_correct_source_webserver() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.webserver_handle();
        handle.info("test");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.source, LogSource::WebServer);
    }

    #[test]
    fn handle_sends_correct_source_infrastructure() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.infra_handle();
        handle.info("test");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.source, LogSource::Infrastructure);
    }

    #[test]
    fn handle_sends_correct_source_system() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.system_handle();
        handle.info("test");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.source, LogSource::System);
    }

    #[test]
    fn handle_sends_correct_source_metrics() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.metrics_handle();
        handle.info("test");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.source, LogSource::Metrics);
    }

    // ==========================================================================
    // LogCollectorHandle Level Tests
    // ==========================================================================

    #[test]
    fn handle_info_sends_info_level() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.system_handle();
        handle.info("info msg");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.level, LogLevel::Info);
        assert_eq!(entry.message, "info msg");
    }

    #[test]
    fn handle_warn_sends_warning_level() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.system_handle();
        handle.warn("warning msg");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.level, LogLevel::Warning);
        assert_eq!(entry.message, "warning msg");
    }

    #[test]
    fn handle_error_sends_error_level() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.system_handle();
        handle.error("error msg");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.level, LogLevel::Error);
        assert_eq!(entry.message, "error msg");
    }

    #[test]
    fn handle_debug_sends_debug_level() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.system_handle();
        handle.debug("debug msg");

        let entry = receiver.try_recv().unwrap();
        assert_eq!(entry.level, LogLevel::Debug);
        assert_eq!(entry.message, "debug msg");
    }

    // ==========================================================================
    // Handle Cloning Tests
    // ==========================================================================

    #[test]
    fn handle_can_be_cloned() {
        let (collector, mut receiver) = LogCollector::new();
        let handle1 = collector.system_handle();
        let handle2 = handle1.clone();

        handle1.info("from handle1");
        handle2.info("from handle2");

        let entry1 = receiver.try_recv().unwrap();
        let entry2 = receiver.try_recv().unwrap();

        assert_eq!(entry1.message, "from handle1");
        assert_eq!(entry2.message, "from handle2");
    }

    // ==========================================================================
    // Multiple Handle Tests
    // ==========================================================================

    #[test]
    fn multiple_handles_share_channel() {
        let (collector, mut receiver) = LogCollector::new();
        let watcher = collector.watcher_handle();
        let system = collector.system_handle();
        let webserver = collector.webserver_handle();

        watcher.info("watcher msg");
        system.error("system msg");
        webserver.warn("webserver msg");

        let e1 = receiver.try_recv().unwrap();
        let e2 = receiver.try_recv().unwrap();
        let e3 = receiver.try_recv().unwrap();

        assert_eq!(e1.source, LogSource::Watcher);
        assert_eq!(e2.source, LogSource::System);
        assert_eq!(e3.source, LogSource::WebServer);
    }

    // ==========================================================================
    // Sender Tests
    // ==========================================================================

    #[test]
    fn raw_sender_can_send_entries() {
        let (collector, mut receiver) = LogCollector::new();
        let sender = collector.sender();

        let entry = LogEntry::new(LogSource::Metrics, LogLevel::Debug, "direct send".into());
        sender.send(entry).unwrap();

        let received = receiver.try_recv().unwrap();
        assert_eq!(received.message, "direct send");
        assert_eq!(received.source, LogSource::Metrics);
    }

    // ==========================================================================
    // Async Tests
    // ==========================================================================

    #[tokio::test]
    async fn receiver_gets_sent_messages_async() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.system_handle();

        handle.info("async test");

        let entry = receiver.recv().await.unwrap();
        assert_eq!(entry.message, "async test");
    }

    #[tokio::test]
    async fn multiple_messages_received_in_order() {
        let (collector, mut receiver) = LogCollector::new();
        let handle = collector.system_handle();

        handle.info("first");
        handle.info("second");
        handle.info("third");

        let e1 = receiver.recv().await.unwrap();
        let e2 = receiver.recv().await.unwrap();
        let e3 = receiver.recv().await.unwrap();

        assert_eq!(e1.message, "first");
        assert_eq!(e2.message, "second");
        assert_eq!(e3.message, "third");
    }
}
