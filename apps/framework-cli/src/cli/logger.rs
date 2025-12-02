//! # Logger Module
//!
//! This module provides logging functionality using `tracing-subscriber` with support for
//! dynamic log filtering via `RUST_LOG` and dual format support (legacy/modern).
//!
//! ## Architecture
//!
//! The logging system is built using `tracing-subscriber` layers:
//! - **EnvFilter Layer**: Provides `RUST_LOG` support for module-level filtering
//! - **Format Layer**: Either legacy (fern-compatible) or modern (tracing native) format
//!
//! ## Components
//!
//! - `LoggerLevel`: An enumeration representing the different levels of logging: DEBUG, INFO, WARN, and ERROR.
//! - `LogFormat`: Either Text or JSON output format.
//! - `LoggerSettings`: A struct that holds the settings for the logger, including format, level, and output options.
//! - `setup_logging`: A function used to set up the logging system with the provided settings.
//! - `LegacyFormatLayer`: Custom layer that matches the old fern format exactly (for backward compatibility).
//!
//! ## Features
//!
//! ### RUST_LOG Support
//! Use the standard Rust `RUST_LOG` environment variable for dynamic filtering:
//! ```bash
//! RUST_LOG=moose_cli::infrastructure=debug cargo run
//! RUST_LOG=debug cargo run  # Enable debug for all modules
//! ```
//!
//! ### Dual Format Support
//! - **Legacy Format** (default): Maintains exact compatibility with the old fern-based logging
//!   - Text: `[timestamp LEVEL - target] message`
//!   - JSON: `{"timestamp": "...", "severity": "INFO", "target": "...", "message": "..."}`
//! - **Modern Format** (opt-in): Uses tracing-subscriber's native formatting
//!   - Enable via `MOOSE_LOGGER__USE_TRACING_FORMAT=true`
//!
//! ### Additional Features
//! - **Date-based file rotation**: Daily log files in `~/.moose/YYYY-MM-DD-cli.log`
//! - **Automatic cleanup**: Deletes logs older than 7 days
//! - **Session ID tracking**: Optional per-session identifier in logs
//! - **Configurable outputs**: File and/or stdout
//!
//! ## Environment Variables
//!
//! - `RUST_LOG`: Standard Rust log filtering (e.g., `RUST_LOG=moose_cli::infrastructure=debug`)
//! - `MOOSE_LOGGER__USE_TRACING_FORMAT`: Opt-in to modern format (default: `false`)
//! - `MOOSE_LOGGER__LEVEL`: Log level (DEBUG, INFO, WARN, ERROR)
//! - `MOOSE_LOGGER__STDOUT`: Output to stdout vs file (default: `false`)
//! - `MOOSE_LOGGER__FORMAT`: Text or JSON (default: Text)
//! - `MOOSE_LOGGER__INCLUDE_SESSION_ID`: Include session ID in logs (default: `false`)
//!
//! ## Usage
//!
//! The logger is configured by creating a `LoggerSettings` instance and passing it to the `setup_logging` function.
//! Default values are provided for all settings. Use the `tracing::` macros to write logs.
//!
//! ### Log Levels
//!
//! - `DEBUG`: Use this level for detailed information typically of use only when diagnosing problems. You would usually only expect to see these logs in a development environment. For example, you might log method entry/exit points, variable values, query results, etc.
//! - `INFO`: Use this level to confirm that things are working as expected. This is the default log level and will give you general operational insights into the application behavior. For example, you might log start/stop of a process, configuration details, successful completion of significant transactions, etc.
//! - `WARN`: Use this level when something unexpected happened in the system, or there might be a problem in the near future (like 'disk space low'). The software is still working as expected, so it's not an error. For example, you might log deprecated API usage, poor performance issues, retrying an operation, etc.
//! - `ERROR`: Use this level when the system is in distress, customers are probably being affected but the program is not terminated. An operator should definitely look into it. For example, you might log exceptions, potential data inconsistency, or system overloads.
//!
//! ## Example
//!
//! ```rust
//! use tracing::{debug, info, warn, error};
//!
//! debug!("This is a DEBUG message. Typically used for detailed information useful in a development environment.");
//! info!("This is an INFO message. Used to confirm that things are working as expected.");
//! warn!("This is a WARN message. Indicates something unexpected happened or there might be a problem in the near future.");
//! error!("This is an ERROR message. Used when the system is in distress, customers are probably being affected but the program is not terminated.");
//! ```
//!
//! ## Backward Compatibility
//!
//! The legacy format layer ensures 100% backward compatibility with systems consuming the old
//! fern-based log format (e.g., Boreal/hosting_telemetry). The modern format can be enabled
//! via environment variable once downstream consumers are ready.

use serde::Deserialize;
use std::env;
use std::fmt;
use std::io::Write;
use std::time::{Duration, SystemTime};
use tracing::field::{Field, Visit};
use tracing::{warn, Event, Level, Subscriber};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

use crate::utilities::constants::{CONTEXT, CTX_SESSION_ID, NO_ANSI};
use std::sync::atomic::Ordering;

use super::settings::user_directory;

/// Default date format for log file names: YYYY-MM-DD-cli.log
pub const DEFAULT_LOG_FILE_FORMAT: &str = "%Y-%m-%d-cli.log";

#[derive(Deserialize, Debug, Clone)]
pub enum LoggerLevel {
    #[serde(alias = "DEBUG", alias = "debug")]
    Debug,
    #[serde(alias = "INFO", alias = "info")]
    Info,
    #[serde(alias = "WARN", alias = "warn")]
    Warn,
    #[serde(alias = "ERROR", alias = "error")]
    Error,
}

impl LoggerLevel {
    pub fn to_tracing_level(&self) -> LevelFilter {
        match self {
            LoggerLevel::Debug => LevelFilter::DEBUG,
            LoggerLevel::Info => LevelFilter::INFO,
            LoggerLevel::Warn => LevelFilter::WARN,
            LoggerLevel::Error => LevelFilter::ERROR,
        }
    }
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub enum LogFormat {
    Json,
    Text,
}

#[derive(Deserialize, Debug, Clone)]
pub struct LoggerSettings {
    #[serde(default = "default_log_file")]
    pub log_file_date_format: String,
    #[serde(default = "default_log_level")]
    pub level: LoggerLevel,
    #[serde(default = "default_log_stdout")]
    pub stdout: bool,

    #[serde(default = "default_log_format")]
    pub format: LogFormat,

    #[serde(default = "default_include_session_id")]
    pub include_session_id: bool,

    #[serde(default = "default_use_tracing_format")]
    pub use_tracing_format: bool,

    #[serde(default = "default_no_ansi")]
    pub no_ansi: bool,
}

fn default_log_file() -> String {
    DEFAULT_LOG_FILE_FORMAT.to_string()
}

fn default_log_level() -> LoggerLevel {
    LoggerLevel::Info
}

fn default_log_stdout() -> bool {
    false
}

fn default_log_format() -> LogFormat {
    LogFormat::Text
}

fn default_include_session_id() -> bool {
    false
}

fn default_use_tracing_format() -> bool {
    env::var("MOOSE_LOGGER__USE_TRACING_FORMAT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(false)
}

fn default_no_ansi() -> bool {
    false // ANSI colors enabled by default
}

impl Default for LoggerSettings {
    fn default() -> Self {
        LoggerSettings {
            log_file_date_format: default_log_file(),
            level: default_log_level(),
            stdout: default_log_stdout(),
            format: default_log_format(),
            include_session_id: default_include_session_id(),
            use_tracing_format: default_use_tracing_format(),
            no_ansi: default_no_ansi(),
        }
    }
}

// House-keeping: delete log files older than 7 days.
//
// Rationale for WARN vs INFO
// --------------------------------
// 1.  Any failure here (e.g. cannot read directory or metadata) prevents log-rotation
//     which can silently fill disks.
// 2.  According to our logging guidelines INFO is "things working as expected", while
//     WARN is for unexpected situations that *might* become a problem.
// 3.  Therefore we upgraded the two failure branches (`warn!`) below to highlight
//     these issues in production without terminating execution.
//
// Errors are still swallowed so that logging setup never aborts the CLI, but we emit
// WARN to make operators aware of the problem.
fn clean_old_logs() {
    let cut_off = SystemTime::now() - Duration::from_secs(7 * 24 * 60 * 60);

    if let Ok(dir) = user_directory().read_dir() {
        for entry in dir.flatten() {
            if entry.path().extension().is_some_and(|ext| ext == "log") {
                match entry.metadata().and_then(|md| md.modified()) {
                    // Smaller time means older than the cut_off
                    Ok(t) if t < cut_off => {
                        let _ = std::fs::remove_file(entry.path());
                    }
                    Ok(_) => {}
                    // Escalated to WARN to surface unexpected FS errors encountered
                    // during housekeeping.
                    Err(e) => {
                        // Escalated to warn! — inability to read file metadata may indicate FS issues
                        warn!(
                            "Failed to read modification time for {:?}. {}",
                            entry.path(),
                            e
                        )
                    }
                }
            }
        }
    } else {
        // Directory unreadable: surface as warn instead of info so users notice
        // Emitting WARN instead of INFO: inability to read the log directory means
        // housekeeping could not run at all, which can later cause disk-space issues.
        warn!("failed to read directory")
    }
}

/// Trait for formatting log events. Implementations are monomorphized,
/// allowing the compiler to inline the format logic directly into `on_event`.
///
/// Formatters write directly to the provided writer to avoid intermediate allocations.
trait LegacyFormatter {
    fn write_event<W: Write>(
        &self,
        writer: &mut W,
        level: &Level,
        target: &str,
        event: &Event<'_>,
    ) -> std::io::Result<()>;
}

/// Text formatter matching fern's text format exactly
#[derive(Clone)]
struct TextFormatter {
    include_session_id: bool,
    session_id: String,
}

impl TextFormatter {
    fn new(include_session_id: bool, session_id: String) -> Self {
        Self {
            include_session_id,
            session_id,
        }
    }
}

impl LegacyFormatter for TextFormatter {
    #[inline]
    fn write_event<W: Write>(
        &self,
        writer: &mut W,
        level: &Level,
        target: &str,
        event: &Event<'_>,
    ) -> std::io::Result<()> {
        // Write prefix: [timestamp LEVEL - target]
        write!(
            writer,
            "[{} {}",
            humantime::format_rfc3339_seconds(SystemTime::now()),
            level,
        )?;

        if self.include_session_id {
            write!(writer, " {}", self.session_id)?;
        }

        write!(writer, " - {}] ", target)?;

        // Write message directly without intermediate String
        let mut visitor = DirectWriteVisitor { writer };
        event.record(&mut visitor);

        writeln!(writer)
    }
}

/// JSON formatter matching fern's JSON format exactly
#[derive(Clone)]
struct JsonFormatter {
    include_session_id: bool,
    session_id: String,
}

impl JsonFormatter {
    fn new(include_session_id: bool, session_id: String) -> Self {
        Self {
            include_session_id,
            session_id,
        }
    }
}

impl LegacyFormatter for JsonFormatter {
    #[inline]
    fn write_event<W: Write>(
        &self,
        writer: &mut W,
        level: &Level,
        target: &str,
        event: &Event<'_>,
    ) -> std::io::Result<()> {
        // Extract message first since it appears in the middle of the JSON object
        let mut message_visitor = MessageVisitor::default();
        event.record(&mut message_visitor);

        // Build JSON object - serde_json handles escaping correctly
        let mut log_entry = serde_json::json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "severity": level.to_string(),
            "target": target,
            "message": message_visitor.message,
        });

        if self.include_session_id {
            log_entry["session_id"] = serde_json::Value::String(self.session_id.clone());
        }

        serde_json::to_writer(&mut *writer, &log_entry).map_err(std::io::Error::other)?;
        writeln!(writer)
    }
}

/// Layer that formats logs to match the legacy fern format exactly.
///
/// Generic over the formatter type `F`, enabling monomorphization so the
/// compiler can inline the format logic directly into `on_event`.
struct LegacyFormatLayer<W, F> {
    writer: W,
    formatter: F,
}

impl<W, F> LegacyFormatLayer<W, F> {
    fn new(writer: W, formatter: F) -> Self {
        Self { writer, formatter }
    }
}

impl<S, W, F> Layer<S> for LegacyFormatLayer<W, F>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    W: for<'writer> MakeWriter<'writer> + 'static,
    F: LegacyFormatter + 'static,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let mut writer = self.writer.make_writer();

        // Write directly to output, avoiding intermediate allocations
        let _ = self
            .formatter
            .write_event(&mut writer, metadata.level(), metadata.target(), event);
    }
}

/// Visitor that writes the message field directly to a writer, avoiding intermediate allocation.
///
/// For string messages (the common case), writes directly without any allocation.
/// For debug-formatted messages, uses a small stack buffer to strip surrounding quotes.
struct DirectWriteVisitor<'a, W> {
    writer: &'a mut W,
}

impl<W: Write> Visit for DirectWriteVisitor<'_, W> {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            let _ = write!(self.writer, "{:?}", value);
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            let _ = self.writer.write_all(value.as_bytes());
        }
    }
}

/// Visitor that extracts the message into a String (used for JSON where we need the value mid-output).
#[derive(Default)]
struct MessageVisitor {
    message: String,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        }
    }
}

/// Custom MakeWriter that creates log files with user-specified date format
///
/// This maintains backward compatibility with fern's DateBased rotation by allowing
/// custom date format strings like "%Y-%m-%d-cli.log" to produce "2025-11-25-cli.log"
struct DateBasedWriter {
    date_format: String,
}

impl DateBasedWriter {
    fn new(date_format: String) -> Self {
        Self { date_format }
    }
}

impl<'a> MakeWriter<'a> for DateBasedWriter {
    type Writer = std::fs::File;

    fn make_writer(&'a self) -> Self::Writer {
        let formatted_name = chrono::Local::now().format(&self.date_format).to_string();
        let file_path = user_directory().join(&formatted_name);

        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(file_path)
            .expect("Failed to open log file")
    }
}

/// Creates a rolling file appender with custom date format
///
/// This function creates a file appender that respects the configured date format
/// for log file naming, maintaining backward compatibility with fern's DateBased rotation.
fn create_rolling_file_appender(date_format: &str) -> DateBasedWriter {
    DateBasedWriter::new(date_format.to_string())
}

pub fn setup_logging(settings: &LoggerSettings) {
    clean_old_logs();

    // Set global NO_ANSI flag for terminal display functions
    NO_ANSI.store(settings.no_ansi, Ordering::Relaxed);

    let session_id = CONTEXT.get(CTX_SESSION_ID).unwrap();

    // Setup logging based on format type
    if settings.use_tracing_format {
        // Modern format using tracing built-ins
        setup_modern_format(settings);
    } else {
        // Legacy format matching fern exactly
        setup_legacy_format(settings, session_id);
    }
}

fn setup_modern_format(settings: &LoggerSettings) {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(settings.level.to_tracing_level().to_string()));

    // When no_ansi is false, ANSI is enabled (true)
    // When no_ansi is true, ANSI is disabled (false)
    let ansi_enabled = !settings.no_ansi;

    if settings.stdout {
        let format_layer = tracing_subscriber::fmt::layer()
            .with_writer(std::io::stdout)
            .with_target(true)
            .with_level(true)
            .with_ansi(ansi_enabled);

        if settings.format == LogFormat::Json {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(format_layer.json())
                .init();
        } else {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(format_layer.compact())
                .init();
        }
    } else {
        // For file output, explicitly disable ANSI codes regardless of no_ansi setting.
        // Files are not terminals and don't render colors. tracing-subscriber defaults
        // to ANSI=true, so we must explicitly set it to false for file writers.
        let file_appender = create_rolling_file_appender(&settings.log_file_date_format);
        let format_layer = tracing_subscriber::fmt::layer()
            .with_writer(file_appender)
            .with_target(true)
            .with_level(true)
            .with_ansi(false);

        if settings.format == LogFormat::Json {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(format_layer.json())
                .init();
        } else {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(format_layer.compact())
                .init();
        }
    }
}

fn setup_legacy_format(settings: &LoggerSettings, session_id: &str) {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(settings.level.to_tracing_level().to_string()));

    // Branch on format type at setup time to get monomorphized Layer implementations.
    // Each branch creates a concrete formatter type, enabling the compiler to inline
    // the format logic directly into on_event.
    match (&settings.format, settings.stdout) {
        (LogFormat::Text, true) => {
            let formatter = TextFormatter::new(settings.include_session_id, session_id.to_string());
            let legacy_layer = LegacyFormatLayer::new(std::io::stdout, formatter);
            tracing_subscriber::registry()
                .with(env_filter)
                .with(legacy_layer)
                .init();
        }
        (LogFormat::Text, false) => {
            let formatter = TextFormatter::new(settings.include_session_id, session_id.to_string());
            let file_appender = create_rolling_file_appender(&settings.log_file_date_format);
            let legacy_layer = LegacyFormatLayer::new(file_appender, formatter);
            tracing_subscriber::registry()
                .with(env_filter)
                .with(legacy_layer)
                .init();
        }
        (LogFormat::Json, true) => {
            let formatter = JsonFormatter::new(settings.include_session_id, session_id.to_string());
            let legacy_layer = LegacyFormatLayer::new(std::io::stdout, formatter);
            tracing_subscriber::registry()
                .with(env_filter)
                .with(legacy_layer)
                .init();
        }
        (LogFormat::Json, false) => {
            let formatter = JsonFormatter::new(settings.include_session_id, session_id.to_string());
            let file_appender = create_rolling_file_appender(&settings.log_file_date_format);
            let legacy_layer = LegacyFormatLayer::new(file_appender, formatter);
            tracing_subscriber::registry()
                .with(env_filter)
                .with(legacy_layer)
                .init();
        }
    }
}
