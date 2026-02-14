//! Application state for the Dev TUI
//!
//! This module contains the main application state struct and related types
//! for managing the TUI's data and behavior.

use crate::project::Project;
use chrono::{DateTime, Utc};
use ratatui::layout::Rect;
use std::collections::{HashSet, VecDeque};
use std::sync::Arc;

use super::alert::Alert;
use super::infra_status::{BootPhase, InfraStatusUpdate, InfrastructureStatus, ServiceStatus};
use super::resource_panel::{
    matches_resource, ChangeEntry, ResourceItem, ResourceList, ResourceType, ResourceUpdate,
    SelectedResource,
};

/// Maximum number of log entries to keep in the buffer
const MAX_LOG_ENTRIES: usize = 10_000;

/// Spinner animation frames for loading indicator
const SPINNER_FRAMES: &[char] = &['◐', '◓', '◑', '◒'];

/// Active panel in the TUI
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Panel {
    #[default]
    Logs,
    Infrastructure,
    Resources,
}

impl Panel {
    /// Returns the number key associated with this panel
    #[allow(dead_code)]
    pub fn number(&self) -> u8 {
        match self {
            Panel::Logs => 1,
            Panel::Infrastructure => 2,
            Panel::Resources => 3,
        }
    }

    /// Toggle to the next panel (cycles through all panels)
    pub fn toggle(&self) -> Panel {
        match self {
            Panel::Logs => Panel::Infrastructure,
            Panel::Infrastructure => Panel::Resources,
            Panel::Resources => Panel::Logs,
        }
    }
}

/// Log level for entries
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    #[allow(dead_code)]
    Debug,
    Info,
    #[allow(dead_code)]
    Warning,
    Error,
}

/// Source of a log entry
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogSource {
    Watcher,
    WebServer,
    Infrastructure,
    #[allow(dead_code)]
    Metrics,
    System,
}

impl LogSource {
    /// Returns a short display name for the source
    pub fn short_name(&self) -> &'static str {
        match self {
            LogSource::Watcher => "WATCH",
            LogSource::WebServer => "API",
            LogSource::Infrastructure => "INFRA",
            LogSource::Metrics => "METR",
            LogSource::System => "SYS",
        }
    }
}

/// A single log entry
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub source: LogSource,
    pub level: LogLevel,
    pub message: String,
}

impl LogEntry {
    pub fn new(source: LogSource, level: LogLevel, message: String) -> Self {
        Self {
            timestamp: Utc::now(),
            source,
            level,
            message,
        }
    }
}

/// Ring buffer for log entries
#[derive(Debug)]
pub struct LogBuffer {
    entries: VecDeque<LogEntry>,
    capacity: usize,
}

impl LogBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    pub fn push(&mut self, entry: LogEntry) {
        if self.entries.len() >= self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    pub fn iter(&self) -> impl Iterator<Item = &LogEntry> {
        self.entries.iter()
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Log filter options
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFilter {
    All,
    Source(LogSource),
    Level(LogLevel),
}

impl LogFilter {
    /// Returns a short display name for the filter
    #[allow(dead_code)]
    pub fn short_name(&self) -> &'static str {
        match self {
            LogFilter::All => "All",
            LogFilter::Source(LogSource::Watcher) => "Watch",
            LogFilter::Source(LogSource::WebServer) => "API",
            LogFilter::Source(LogSource::Infrastructure) => "Infra",
            LogFilter::Source(LogSource::Metrics) => "Metrics",
            LogFilter::Source(LogSource::System) => "System",
            LogFilter::Level(LogLevel::Error) => "Errors",
            LogFilter::Level(LogLevel::Warning) => "Warnings",
            LogFilter::Level(LogLevel::Info) => "Info",
            LogFilter::Level(LogLevel::Debug) => "Debug",
        }
    }
}

/// Scroll state for panels
#[derive(Debug, Default)]
pub struct ScrollState {
    pub offset: usize,
    pub auto_scroll: bool,
}

impl ScrollState {
    pub fn new() -> Self {
        Self {
            offset: 0,
            auto_scroll: true,
        }
    }
}

/// Main application state for the Dev TUI
pub struct DevTuiApp {
    /// Whether the application is running
    pub running: bool,
    /// Currently active panel
    pub active_panel: Panel,
    /// Log buffer
    pub logs: LogBuffer,
    /// Current log filter
    pub filter: LogFilter,
    /// Scroll state for logs panel
    pub log_scroll: ScrollState,
    /// Scroll state for infrastructure panel
    #[allow(dead_code)]
    pub infra_scroll: ScrollState,
    /// Current viewport size
    pub viewport: Rect,
    /// Project information
    pub project: Arc<Project>,
    /// Infrastructure boot status
    pub infra_status: InfrastructureStatus,
    /// Current alert modal (if any)
    pub alert: Option<Alert>,
    /// Whether infrastructure is ready
    pub infra_ready: bool,
    /// Whether the web server has been started
    pub web_server_started: bool,
    /// Whether to trigger a retry of infrastructure boot
    pub retry_infra: bool,

    // Resource panel state
    /// List of infrastructure resources
    pub resource_list: ResourceList,
    /// Currently selected resource for filtering logs
    pub selected_resource: Option<SelectedResource>,
    /// Scroll state for resources panel
    #[allow(dead_code)]
    pub resource_scroll: ScrollState,
    /// Set of expanded resource groups in the panel
    pub expanded_groups: HashSet<ResourceType>,
    /// Current cursor position in the resource list
    pub resource_cursor: usize,
    /// Whether resources are being loaded/updated
    pub resources_loading: bool,
    /// Current frame of the loading spinner animation
    pub spinner_frame: usize,
    /// Recent changes from the last infrastructure update (for watcher integration)
    #[allow(dead_code)]
    pub recent_changes: Vec<ChangeEntry>,
    /// Whether log lines should wrap instead of being truncated
    pub log_wrap: bool,
    /// Hot reload status for the infrastructure panel
    pub hot_reload: HotReloadStatus,
}

/// Status of the hot reload / file watcher
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotReloadStatus {
    /// Idle - no changes being processed
    Idle,
    /// A file change was detected and is being applied
    Reloading,
    /// Last reload succeeded
    Success,
    /// Last reload failed with an error message
    Failed(String),
}

impl DevTuiApp {
    /// Create a new DevTuiApp instance
    pub fn new(project: Arc<Project>) -> Self {
        let infra_status = InfrastructureStatus::new(
            project.features.olap,
            project.features.streaming_engine,
            project.features.workflows,
        );
        Self {
            running: true,
            active_panel: Panel::Logs,
            logs: LogBuffer::new(MAX_LOG_ENTRIES),
            filter: LogFilter::All,
            log_scroll: ScrollState::new(),
            infra_scroll: ScrollState::new(),
            viewport: Rect::default(),
            project,
            infra_status,
            alert: None,
            infra_ready: false,
            web_server_started: false,
            retry_infra: false,
            // Resource panel state
            resource_list: ResourceList::new(),
            selected_resource: None,
            resource_scroll: ScrollState::new(),
            expanded_groups: HashSet::new(),
            resource_cursor: 0,
            resources_loading: false,
            spinner_frame: 0,
            recent_changes: Vec::new(),
            log_wrap: false,
            hot_reload: HotReloadStatus::Idle,
        }
    }

    /// Create a new DevTuiApp instance with infrastructure skipped (--no-infra)
    pub fn new_no_infra(project: Arc<Project>) -> Self {
        Self {
            running: true,
            active_panel: Panel::Logs,
            logs: LogBuffer::new(MAX_LOG_ENTRIES),
            filter: LogFilter::All,
            log_scroll: ScrollState::new(),
            infra_scroll: ScrollState::new(),
            viewport: Rect::default(),
            project,
            infra_status: InfrastructureStatus::skipped(),
            alert: None,
            infra_ready: true, // Ready immediately when skipping infra
            web_server_started: false,
            retry_infra: false,
            // Resource panel state
            resource_list: ResourceList::new(),
            selected_resource: None,
            resource_scroll: ScrollState::new(),
            expanded_groups: HashSet::new(),
            resource_cursor: 0,
            resources_loading: false,
            spinner_frame: 0,
            recent_changes: Vec::new(),
            log_wrap: false,
            hot_reload: HotReloadStatus::Idle,
        }
    }

    /// Handle an infrastructure status update
    pub fn handle_infra_update(&mut self, update: InfraStatusUpdate) {
        match update {
            InfraStatusUpdate::PhaseChanged(phase) => {
                self.infra_status.phase = phase;
                // Add log entry for phase changes
                let message = match phase {
                    BootPhase::Initializing => "Initializing infrastructure...",
                    BootPhase::CheckingDocker => "Checking Docker daemon...",
                    BootPhase::CreatingComposeFile => "Creating docker-compose file...",
                    BootPhase::StartingContainers => "Starting infrastructure containers...",
                    BootPhase::ValidatingServices => "Validating service health...",
                    BootPhase::Ready => "Infrastructure ready",
                    BootPhase::Failed => "Infrastructure startup failed",
                };
                self.logs.push(LogEntry::new(
                    LogSource::Infrastructure,
                    if phase == BootPhase::Failed {
                        LogLevel::Error
                    } else {
                        LogLevel::Info
                    },
                    message.to_string(),
                ));
            }
            InfraStatusUpdate::DockerStatus(status) => {
                if let ServiceStatus::Failed(ref msg) = status {
                    self.logs.push(LogEntry::new(
                        LogSource::Infrastructure,
                        LogLevel::Error,
                        format!("Docker: {}", msg),
                    ));
                }
                self.infra_status.docker = status;
            }
            InfraStatusUpdate::ClickHouseStatus(status) => {
                if let ServiceStatus::Healthy = status {
                    self.logs.push(LogEntry::new(
                        LogSource::Infrastructure,
                        LogLevel::Info,
                        "ClickHouse is healthy".to_string(),
                    ));
                }
                self.infra_status.clickhouse = Some(status);
            }
            InfraStatusUpdate::RedisStatus(status) => {
                if let ServiceStatus::Healthy = status {
                    self.logs.push(LogEntry::new(
                        LogSource::Infrastructure,
                        LogLevel::Info,
                        "Redis is healthy".to_string(),
                    ));
                }
                self.infra_status.redis = Some(status);
            }
            InfraStatusUpdate::TemporalStatus(status) => {
                if let ServiceStatus::Healthy = status {
                    self.logs.push(LogEntry::new(
                        LogSource::Infrastructure,
                        LogLevel::Info,
                        "Temporal is healthy".to_string(),
                    ));
                }
                self.infra_status.temporal = Some(status);
            }
            InfraStatusUpdate::RedpandaStatus(status) => {
                if let ServiceStatus::Healthy = status {
                    self.logs.push(LogEntry::new(
                        LogSource::Infrastructure,
                        LogLevel::Info,
                        "Redpanda is healthy".to_string(),
                    ));
                }
                self.infra_status.redpanda = Some(status);
            }
            InfraStatusUpdate::WebServerStatus(status) => {
                self.infra_status.web_server = status;
            }
            InfraStatusUpdate::BootCompleted => {
                self.infra_status.phase = BootPhase::Ready;
                self.infra_ready = true;
                self.logs.push(LogEntry::new(
                    LogSource::Infrastructure,
                    LogLevel::Info,
                    "Infrastructure boot completed successfully".to_string(),
                ));
            }
            InfraStatusUpdate::BootFailed(error) => {
                self.infra_status.phase = BootPhase::Failed;
                self.infra_status.error_message = Some(error.clone());
                self.logs.push(LogEntry::new(
                    LogSource::Infrastructure,
                    LogLevel::Error,
                    format!("Infrastructure boot failed: {}", error),
                ));
            }
        }
    }

    /// Show an alert modal
    pub fn show_alert(&mut self, alert: Alert) {
        self.alert = Some(alert);
    }

    /// Dismiss the current alert
    pub fn dismiss_alert(&mut self) {
        self.alert = None;
    }

    /// Check if an alert is currently shown
    pub fn has_alert(&self) -> bool {
        self.alert.is_some()
    }

    /// Called on each tick
    pub fn tick(&mut self) {
        // Animate spinner when loading
        if self.resources_loading {
            self.spinner_frame = (self.spinner_frame + 1) % SPINNER_FRAMES.len();
        }
    }

    /// Advance spinner animation (called on each tick)
    #[allow(dead_code)]
    pub fn tick_spinner(&mut self) {
        if self.resources_loading {
            self.spinner_frame = (self.spinner_frame + 1) % SPINNER_FRAMES.len();
        }
    }

    /// Get current spinner character
    pub fn spinner_char(&self) -> char {
        SPINNER_FRAMES[self.spinner_frame]
    }

    /// Toggle log line wrapping
    pub fn toggle_log_wrap(&mut self) {
        self.log_wrap = !self.log_wrap;
    }

    /// Quit the application
    pub fn quit(&mut self) {
        self.running = false;
    }

    /// Switch to a specific panel
    pub fn switch_panel(&mut self, panel: Panel) {
        self.active_panel = panel;
    }

    /// Toggle to the next panel
    pub fn toggle_panel(&mut self) {
        self.active_panel = self.active_panel.toggle();
    }

    /// Set the log filter
    pub fn set_filter(&mut self, filter: LogFilter) {
        self.filter = filter;
        // Reset scroll when filter changes
        self.log_scroll.offset = 0;
    }

    /// Scroll logs up
    pub fn scroll_up(&mut self) {
        if self.log_scroll.offset > 0 {
            self.log_scroll.offset -= 1;
            self.log_scroll.auto_scroll = false;
        }
    }

    /// Scroll logs down
    pub fn scroll_down(&mut self) {
        let max_offset = self.filtered_log_count().saturating_sub(1);
        if self.log_scroll.offset < max_offset {
            self.log_scroll.offset += 1;
        }
        // Re-enable auto-scroll if we're at the bottom
        if self.log_scroll.offset >= max_offset {
            self.log_scroll.auto_scroll = true;
        }
    }

    /// Jump to top of logs
    pub fn scroll_to_top(&mut self) {
        self.log_scroll.offset = 0;
        self.log_scroll.auto_scroll = false;
    }

    /// Jump to bottom of logs
    pub fn scroll_to_bottom(&mut self) {
        let max_offset = self.filtered_log_count().saturating_sub(1);
        self.log_scroll.offset = max_offset;
        self.log_scroll.auto_scroll = true;
    }

    /// Get the number of logs matching the current filter
    pub fn filtered_log_count(&self) -> usize {
        self.logs
            .iter()
            .filter(|entry| self.matches_filter(entry))
            .count()
    }

    /// Check if a log entry matches the current filter
    fn matches_filter(&self, entry: &LogEntry) -> bool {
        // First check the base source/level filter
        let base_match = match self.filter {
            LogFilter::All => true,
            LogFilter::Source(source) => entry.source == source,
            LogFilter::Level(level) => entry.level == level,
        };

        // If base filter doesn't match, no need to check resource filter
        if !base_match {
            return false;
        }

        // Apply resource filter if one is selected
        if let Some(ref resource) = self.selected_resource {
            matches_resource(&entry.message, &resource.name)
        } else {
            true
        }
    }

    /// Get filtered log entries
    pub fn filtered_logs(&self) -> Vec<&LogEntry> {
        self.logs
            .iter()
            .filter(|entry| self.matches_filter(entry))
            .collect()
    }

    // ========================================================================
    // Resource panel methods
    // ========================================================================

    /// Set the resource list (for watcher integration)
    #[allow(dead_code)]
    pub fn set_resource_list(&mut self, list: ResourceList) {
        self.resource_list = list;
        // Reset cursor if it's now out of bounds
        let items = self.get_resource_items();
        if self.resource_cursor >= items.len() && !items.is_empty() {
            self.resource_cursor = items.len() - 1;
        }
    }

    /// Select a resource for filtering logs
    pub fn select_resource(&mut self, resource: SelectedResource) {
        self.selected_resource = Some(resource);
        // Reset log scroll when filter changes
        self.log_scroll.offset = 0;
    }

    /// Clear the resource filter
    pub fn clear_resource_filter(&mut self) {
        self.selected_resource = None;
        // Reset log scroll when filter changes
        self.log_scroll.offset = 0;
    }

    /// Get the list of resource items (flattened with headers)
    pub fn get_resource_items(&self) -> Vec<ResourceItem> {
        self.resource_list.to_items(&self.expanded_groups)
    }

    /// Navigate up in the resource list
    pub fn resource_navigate_up(&mut self) {
        if self.resource_cursor > 0 {
            self.resource_cursor -= 1;
        }
    }

    /// Navigate down in the resource list
    pub fn resource_navigate_down(&mut self) {
        let items = self.get_resource_items();
        if self.resource_cursor < items.len().saturating_sub(1) {
            self.resource_cursor += 1;
        }
    }

    /// Toggle expand/collapse for the current resource group
    pub fn toggle_resource_group(&mut self) {
        let items = self.get_resource_items();
        if let Some(ResourceItem::GroupHeader { resource_type, .. }) =
            items.get(self.resource_cursor)
        {
            if self.expanded_groups.contains(resource_type) {
                self.expanded_groups.remove(resource_type);
            } else {
                self.expanded_groups.insert(*resource_type);
            }
        }
    }

    /// Select the current resource (if cursor is on a resource, not a header)
    pub fn select_current_resource(&mut self) {
        let items = self.get_resource_items();
        if let Some(item) = items.get(self.resource_cursor) {
            match item {
                ResourceItem::Resource {
                    resource_type,
                    name,
                } => {
                    self.select_resource(SelectedResource {
                        resource_type: *resource_type,
                        name: name.clone(),
                    });
                }
                ResourceItem::GroupHeader { .. } => {
                    // Toggle expand/collapse if on a header
                    self.toggle_resource_group();
                }
            }
        }
    }

    /// Get the currently selected resource item (if any)
    #[allow(dead_code)]
    pub fn get_current_resource_item(&self) -> Option<ResourceItem> {
        let items = self.get_resource_items();
        items.get(self.resource_cursor).cloned()
    }

    /// Jump to top of resource list
    pub fn resource_scroll_to_top(&mut self) {
        self.resource_cursor = 0;
    }

    /// Jump to bottom of resource list
    pub fn resource_scroll_to_bottom(&mut self) {
        let items = self.get_resource_items();
        if !items.is_empty() {
            self.resource_cursor = items.len() - 1;
        }
    }

    /// Handle a resource update from the file watcher
    pub fn handle_resource_update(&mut self, update: ResourceUpdate) {
        match update {
            ResourceUpdate::ApplyingChanges => {
                self.resources_loading = true;
                self.hot_reload = HotReloadStatus::Reloading;
            }
            ResourceUpdate::ChangesApplied {
                resource_list,
                changes,
            } => {
                self.resource_list = resource_list;
                self.resources_loading = false;
                self.recent_changes = changes.clone();
                self.hot_reload = HotReloadStatus::Success;

                // Log each change with appropriate formatting
                for change in &changes {
                    let prefix = change.change_type.prefix();
                    let type_name = change.resource_type.display_name();
                    let details = change
                        .details
                        .as_ref()
                        .map(|d| format!(" ({})", d))
                        .unwrap_or_default();
                    self.logs.push(LogEntry::new(
                        LogSource::Infrastructure,
                        LogLevel::Info,
                        format!("{} {}: {}{}", prefix, type_name, change.name, details),
                    ));
                }
            }
            ResourceUpdate::ChangeFailed(error) => {
                self.resources_loading = false;
                self.hot_reload = HotReloadStatus::Failed(error.clone());
                self.logs.push(LogEntry::new(
                    LogSource::System,
                    LogLevel::Error,
                    format!("Change failed: {}", error),
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::routines::dev_tui::test_utils::*;

    // ==========================================================================
    // LogBuffer Tests
    // ==========================================================================

    #[test]
    fn log_buffer_new_creates_empty_buffer() {
        let buf = LogBuffer::new(100);
        assert_eq!(buf.len(), 0);
        assert!(buf.is_empty());
    }

    #[test]
    fn log_buffer_push_adds_entry() {
        let mut buf = LogBuffer::new(100);
        buf.push(LogEntry::new(
            LogSource::System,
            LogLevel::Info,
            "test".into(),
        ));
        assert_eq!(buf.len(), 1);
        assert!(!buf.is_empty());
    }

    #[test]
    fn log_buffer_evicts_oldest_when_full() {
        let mut buf = LogBuffer::new(3);
        buf.push(LogEntry::new(
            LogSource::System,
            LogLevel::Info,
            "msg1".into(),
        ));
        buf.push(LogEntry::new(
            LogSource::System,
            LogLevel::Info,
            "msg2".into(),
        ));
        buf.push(LogEntry::new(
            LogSource::System,
            LogLevel::Info,
            "msg3".into(),
        ));
        buf.push(LogEntry::new(
            LogSource::System,
            LogLevel::Info,
            "msg4".into(),
        ));

        assert_eq!(buf.len(), 3);
        let messages: Vec<_> = buf.iter().map(|e| e.message.as_str()).collect();
        assert_eq!(messages, vec!["msg2", "msg3", "msg4"]);
    }

    #[test]
    fn log_buffer_iteration_preserves_order() {
        let mut buf = LogBuffer::new(10);
        for i in 0..5 {
            buf.push(LogEntry::new(
                LogSource::System,
                LogLevel::Info,
                format!("msg{}", i),
            ));
        }
        let messages: Vec<_> = buf.iter().map(|e| e.message.clone()).collect();
        assert_eq!(messages, vec!["msg0", "msg1", "msg2", "msg3", "msg4"]);
    }

    #[test]
    fn log_buffer_respects_capacity() {
        let mut buf = LogBuffer::new(2);
        for i in 0..10 {
            buf.push(LogEntry::new(
                LogSource::System,
                LogLevel::Info,
                format!("msg{}", i),
            ));
        }
        assert_eq!(buf.len(), 2);
        let messages: Vec<_> = buf.iter().map(|e| e.message.clone()).collect();
        assert_eq!(messages, vec!["msg8", "msg9"]);
    }

    // ==========================================================================
    // LogEntry Tests
    // ==========================================================================

    #[test]
    fn log_entry_new_sets_fields_correctly() {
        let entry = LogEntry::new(LogSource::Watcher, LogLevel::Error, "test message".into());
        assert_eq!(entry.source, LogSource::Watcher);
        assert_eq!(entry.level, LogLevel::Error);
        assert_eq!(entry.message, "test message");
    }

    #[test]
    fn log_entry_timestamp_is_recent() {
        let before = chrono::Utc::now();
        let entry = LogEntry::new(LogSource::System, LogLevel::Info, "test".into());
        let after = chrono::Utc::now();

        assert!(entry.timestamp >= before);
        assert!(entry.timestamp <= after);
    }

    // ==========================================================================
    // LogSource Tests
    // ==========================================================================

    #[test]
    fn log_source_short_name_returns_correct_values() {
        assert_eq!(LogSource::Watcher.short_name(), "WATCH");
        assert_eq!(LogSource::WebServer.short_name(), "API");
        assert_eq!(LogSource::Infrastructure.short_name(), "INFRA");
        assert_eq!(LogSource::Metrics.short_name(), "METR");
        assert_eq!(LogSource::System.short_name(), "SYS");
    }

    // ==========================================================================
    // Panel Tests
    // ==========================================================================

    #[test]
    fn panel_toggle_cycles_logs_to_infrastructure() {
        assert_eq!(Panel::Logs.toggle(), Panel::Infrastructure);
    }

    #[test]
    fn panel_toggle_cycles_infrastructure_to_resources() {
        assert_eq!(Panel::Infrastructure.toggle(), Panel::Resources);
    }

    #[test]
    fn panel_toggle_cycles_resources_to_logs() {
        assert_eq!(Panel::Resources.toggle(), Panel::Logs);
    }

    #[test]
    fn panel_number_returns_correct_values() {
        assert_eq!(Panel::Logs.number(), 1);
        assert_eq!(Panel::Infrastructure.number(), 2);
        assert_eq!(Panel::Resources.number(), 3);
    }

    // ==========================================================================
    // LogFilter Tests
    // ==========================================================================

    #[test]
    fn log_filter_short_name_returns_correct_values() {
        assert_eq!(LogFilter::All.short_name(), "All");
        assert_eq!(LogFilter::Source(LogSource::Watcher).short_name(), "Watch");
        assert_eq!(LogFilter::Source(LogSource::WebServer).short_name(), "API");
        assert_eq!(
            LogFilter::Source(LogSource::Infrastructure).short_name(),
            "Infra"
        );
        assert_eq!(LogFilter::Level(LogLevel::Error).short_name(), "Errors");
    }

    // ==========================================================================
    // ScrollState Tests
    // ==========================================================================

    #[test]
    fn scroll_state_new_has_correct_defaults() {
        let state = ScrollState::new();
        assert_eq!(state.offset, 0);
        assert!(state.auto_scroll);
    }

    #[test]
    fn scroll_state_default_has_correct_values() {
        // Note: Default derives auto_scroll as false (bool default)
        // Use ScrollState::new() for the intended default with auto_scroll: true
        let default_state = ScrollState::default();
        assert_eq!(default_state.offset, 0);
        assert!(!default_state.auto_scroll); // bool default is false
    }

    // ==========================================================================
    // DevTuiApp State Tests
    // ==========================================================================

    #[test]
    fn app_starts_running() {
        let app = test_app();
        assert!(app.running);
    }

    #[test]
    fn app_starts_with_logs_panel_active() {
        let app = test_app();
        assert_eq!(app.active_panel, Panel::Logs);
    }

    #[test]
    fn app_starts_with_filter_all() {
        let app = test_app();
        assert!(matches!(app.filter, LogFilter::All));
    }

    #[test]
    fn app_starts_with_auto_scroll_enabled() {
        let app = test_app();
        assert!(app.log_scroll.auto_scroll);
    }

    #[test]
    fn app_quit_sets_running_false() {
        let mut app = test_app();
        assert!(app.running);
        app.quit();
        assert!(!app.running);
    }

    #[test]
    fn app_switch_panel_updates_active() {
        let mut app = test_app();
        app.switch_panel(Panel::Infrastructure);
        assert_eq!(app.active_panel, Panel::Infrastructure);
    }

    #[test]
    fn app_switch_panel_to_logs() {
        let mut app = test_app();
        app.active_panel = Panel::Infrastructure;
        app.switch_panel(Panel::Logs);
        assert_eq!(app.active_panel, Panel::Logs);
    }

    #[test]
    fn app_toggle_panel_cycles() {
        let mut app = test_app();
        assert_eq!(app.active_panel, Panel::Logs);
        app.toggle_panel();
        assert_eq!(app.active_panel, Panel::Infrastructure);
        app.toggle_panel();
        assert_eq!(app.active_panel, Panel::Resources);
        app.toggle_panel();
        assert_eq!(app.active_panel, Panel::Logs);
    }

    // ==========================================================================
    // Scroll Tests
    // ==========================================================================

    #[test]
    fn app_scroll_down_increments_offset() {
        let mut app = test_app_with_logs(20);
        app.scroll_down();
        assert_eq!(app.log_scroll.offset, 1);
    }

    #[test]
    fn app_scroll_down_multiple_times() {
        let mut app = test_app_with_logs(20);
        for _ in 0..5 {
            app.scroll_down();
        }
        assert_eq!(app.log_scroll.offset, 5);
    }

    #[test]
    fn app_scroll_down_stops_at_max() {
        let mut app = test_app_with_logs(5);
        for _ in 0..10 {
            app.scroll_down();
        }
        // Max offset is (log_count - 1) = 4
        assert_eq!(app.log_scroll.offset, 4);
    }

    #[test]
    fn app_scroll_down_enables_auto_scroll_at_bottom() {
        let mut app = test_app_with_logs(5);
        app.log_scroll.auto_scroll = false;
        // Scroll to bottom
        for _ in 0..10 {
            app.scroll_down();
        }
        assert!(app.log_scroll.auto_scroll);
    }

    #[test]
    fn app_scroll_up_decrements_offset() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.offset = 5;
        app.scroll_up();
        assert_eq!(app.log_scroll.offset, 4);
    }

    #[test]
    fn app_scroll_up_stops_at_zero() {
        let mut app = test_app_with_logs(20);
        app.scroll_up();
        assert_eq!(app.log_scroll.offset, 0);
    }

    #[test]
    fn app_scroll_up_disables_auto_scroll() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.offset = 5;
        app.scroll_up();
        assert!(!app.log_scroll.auto_scroll);
    }

    #[test]
    fn app_scroll_up_at_zero_does_not_disable_auto_scroll() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.offset = 0;
        app.log_scroll.auto_scroll = true;
        app.scroll_up();
        // auto_scroll should remain unchanged since offset didn't change
        assert!(app.log_scroll.auto_scroll);
    }

    #[test]
    fn app_scroll_to_top_sets_offset_zero() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.offset = 10;
        app.scroll_to_top();
        assert_eq!(app.log_scroll.offset, 0);
    }

    #[test]
    fn app_scroll_to_top_disables_auto_scroll() {
        let mut app = test_app_with_logs(20);
        app.scroll_to_top();
        assert!(!app.log_scroll.auto_scroll);
    }

    #[test]
    fn app_scroll_to_bottom_enables_auto_scroll() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.auto_scroll = false;
        app.scroll_to_bottom();
        assert!(app.log_scroll.auto_scroll);
    }

    #[test]
    fn app_scroll_to_bottom_sets_offset_to_max() {
        let mut app = test_app_with_logs(20);
        app.scroll_to_bottom();
        assert_eq!(app.log_scroll.offset, 19); // 20 - 1
    }

    // ==========================================================================
    // Filter Tests
    // ==========================================================================

    #[test]
    fn filter_all_matches_any_source() {
        let mut app = test_app();
        app.logs.push(LogEntry::new(
            LogSource::Watcher,
            LogLevel::Info,
            "w".into(),
        ));
        app.logs
            .push(LogEntry::new(LogSource::System, LogLevel::Info, "s".into()));
        app.set_filter(LogFilter::All);
        assert_eq!(app.filtered_log_count(), 2);
    }

    #[test]
    fn filter_by_source_matches_only_that_source() {
        let mut app = test_app();
        app.logs.push(LogEntry::new(
            LogSource::Watcher,
            LogLevel::Info,
            "w".into(),
        ));
        app.logs
            .push(LogEntry::new(LogSource::System, LogLevel::Info, "s".into()));
        app.set_filter(LogFilter::Source(LogSource::Watcher));
        assert_eq!(app.filtered_log_count(), 1);
    }

    #[test]
    fn filter_by_level_matches_only_that_level() {
        let mut app = test_app();
        app.logs
            .push(LogEntry::new(LogSource::System, LogLevel::Info, "i".into()));
        app.logs.push(LogEntry::new(
            LogSource::System,
            LogLevel::Error,
            "e".into(),
        ));
        app.set_filter(LogFilter::Level(LogLevel::Error));
        assert_eq!(app.filtered_log_count(), 1);
    }

    #[test]
    fn filter_returns_zero_when_no_matches() {
        let mut app = test_app();
        app.logs.push(LogEntry::new(
            LogSource::System,
            LogLevel::Info,
            "msg".into(),
        ));
        app.set_filter(LogFilter::Source(LogSource::Watcher));
        assert_eq!(app.filtered_log_count(), 0);
    }

    #[test]
    fn set_filter_resets_scroll_offset() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.offset = 10;
        app.set_filter(LogFilter::Source(LogSource::Watcher));
        assert_eq!(app.log_scroll.offset, 0);
    }

    #[test]
    fn filtered_logs_returns_correct_entries() {
        let mut app = test_app();
        app.logs.push(LogEntry::new(
            LogSource::Watcher,
            LogLevel::Info,
            "watcher msg".into(),
        ));
        app.logs.push(LogEntry::new(
            LogSource::System,
            LogLevel::Info,
            "system msg".into(),
        ));
        app.logs.push(LogEntry::new(
            LogSource::Watcher,
            LogLevel::Error,
            "watcher error".into(),
        ));

        app.set_filter(LogFilter::Source(LogSource::Watcher));
        let filtered = app.filtered_logs();

        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].message, "watcher msg");
        assert_eq!(filtered[1].message, "watcher error");
    }

    #[test]
    fn filter_by_multiple_sources_with_different_levels() {
        let mut app = test_app();
        app.logs.push(LogEntry::new(
            LogSource::Watcher,
            LogLevel::Info,
            "w-info".into(),
        ));
        app.logs.push(LogEntry::new(
            LogSource::Watcher,
            LogLevel::Error,
            "w-error".into(),
        ));
        app.logs.push(LogEntry::new(
            LogSource::System,
            LogLevel::Error,
            "s-error".into(),
        ));

        // Filter by error level should get both sources
        app.set_filter(LogFilter::Level(LogLevel::Error));
        assert_eq!(app.filtered_log_count(), 2);
    }

    // ==========================================================================
    // Infrastructure Status Tests
    // ==========================================================================

    #[test]
    fn app_new_initializes_infra_status() {
        let app = test_app();
        assert_eq!(app.infra_status.phase, BootPhase::Initializing);
        assert!(!app.infra_ready);
        assert!(!app.web_server_started);
        assert!(!app.retry_infra);
    }

    #[test]
    fn app_new_no_infra_sets_infra_ready() {
        let project = mock_project();
        let app = DevTuiApp::new_no_infra(project);
        assert!(app.infra_ready);
        assert!(!app.web_server_started);
        assert_eq!(app.infra_status.phase, BootPhase::Ready);
    }

    #[test]
    fn handle_infra_update_phase_changed() {
        let mut app = test_app();
        app.handle_infra_update(InfraStatusUpdate::PhaseChanged(BootPhase::CheckingDocker));
        assert_eq!(app.infra_status.phase, BootPhase::CheckingDocker);
        // Should also add a log entry
        assert!(app.filtered_log_count() > 0);
    }

    #[test]
    fn handle_infra_update_docker_status() {
        let mut app = test_app();
        app.handle_infra_update(InfraStatusUpdate::DockerStatus(ServiceStatus::Healthy));
        assert_eq!(app.infra_status.docker, ServiceStatus::Healthy);
    }

    #[test]
    fn handle_infra_update_docker_failed_logs_error() {
        let mut app = test_app();
        app.handle_infra_update(InfraStatusUpdate::DockerStatus(ServiceStatus::Failed(
            "test error".to_string(),
        )));
        // Should log the error
        let logs = app.filtered_logs();
        assert!(logs.iter().any(|l| l.message.contains("Docker")));
    }

    #[test]
    fn handle_infra_update_clickhouse_status() {
        let mut app = test_app();
        app.handle_infra_update(InfraStatusUpdate::ClickHouseStatus(ServiceStatus::Healthy));
        assert_eq!(app.infra_status.clickhouse, Some(ServiceStatus::Healthy));
    }

    #[test]
    fn handle_infra_update_boot_completed() {
        let mut app = test_app();
        assert!(!app.infra_ready);
        app.handle_infra_update(InfraStatusUpdate::BootCompleted);
        assert!(app.infra_ready);
        assert_eq!(app.infra_status.phase, BootPhase::Ready);
    }

    #[test]
    fn handle_infra_update_boot_failed() {
        let mut app = test_app();
        app.handle_infra_update(InfraStatusUpdate::BootFailed("test failure".to_string()));
        assert_eq!(app.infra_status.phase, BootPhase::Failed);
        assert_eq!(
            app.infra_status.error_message,
            Some("test failure".to_string())
        );
    }

    // ==========================================================================
    // Alert Tests
    // ==========================================================================

    #[test]
    fn app_starts_without_alert() {
        let app = test_app();
        assert!(!app.has_alert());
        assert!(app.alert.is_none());
    }

    #[test]
    fn app_show_alert_sets_alert() {
        let mut app = test_app();
        let alert = super::super::alert::Alert::docker_not_running();
        app.show_alert(alert);
        assert!(app.has_alert());
        assert!(app.alert.is_some());
    }

    #[test]
    fn app_dismiss_alert_clears_alert() {
        let mut app = test_app();
        let alert = super::super::alert::Alert::docker_not_running();
        app.show_alert(alert);
        assert!(app.has_alert());
        app.dismiss_alert();
        assert!(!app.has_alert());
        assert!(app.alert.is_none());
    }

    #[test]
    fn app_has_alert_returns_correct_value() {
        let mut app = test_app();
        assert!(!app.has_alert());
        app.show_alert(super::super::alert::Alert::docker_not_running());
        assert!(app.has_alert());
    }
}
