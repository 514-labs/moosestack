//! # Logger Module
//!
//! This module provides logging functionality using `tracing-subscriber` with support for
//! dynamic log filtering via `RUST_LOG` and multiple output destinations.
//!
//! ## Architecture
//!
//! The logging system is built using `tracing-subscriber` layers:
//! - **EnvFilter Layer**: Provides `RUST_LOG` support for module-level filtering
//! - **Format Layer**: Uses tracing-subscriber's compact text formatting
//! - **OTLP Export**: Optional OpenTelemetry Protocol export with span field injection
//!
//! ## Components
//!
//! - `LoggerLevel`: An enumeration representing the different levels of logging: DEBUG, INFO, WARN, and ERROR.
//! - `LoggerSettings`: A struct that holds the settings for the logger, including level and output options.
//! - `setup_logging`: A function used to set up the logging system with the provided settings.
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
//! ### Output Options
//! - **File output** (default): Daily log files in `~/.moose/YYYY-MM-DD-cli.log`
//! - **Stdout output**: Set `MOOSE_LOGGER__STDOUT=true`
//! - **OTLP export**: Set `MOOSE_LOGGER__OTLP_ENDPOINT=http://localhost:4317`
//!
//! ### Additional Features
//! - **Date-based file rotation**: Daily log files in `~/.moose/YYYY-MM-DD-cli.log`
//! - **Automatic cleanup**: Deletes logs older than 7 days
//! - **Configurable outputs**: File and/or stdout
//!
//! ## Environment Variables
//!
//! - `RUST_LOG`: Standard Rust log filtering (e.g., `RUST_LOG=moose_cli::infrastructure=debug`)
//! - `MOOSE_LOGGER__LEVEL`: Log level (DEBUG, INFO, WARN, ERROR)
//! - `MOOSE_LOGGER__STDOUT`: Output to stdout vs file (default: `false`)
//! - `MOOSE_LOGGER__OTLP_ENDPOINT`: OTLP gRPC endpoint for log export (optional)
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

use serde::Deserialize;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};
use tracing::warn;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::logs::{BatchLogProcessor, SdkLoggerProvider};

use crate::utilities::constants::NO_ANSI;
use std::sync::atomic::Ordering;

use super::settings::user_directory;

/// Static storage for the OTLP log provider, used for shutdown.
static LOG_PROVIDER: OnceLock<SdkLoggerProvider> = OnceLock::new();

// # STRUCTURED LOGGING INSTRUMENTATION GUIDE
//
// This section explains how to instrument code with structured logging using span fields.
// When enabled via `MOOSE_LOGGER__STRUCTURED_LOGS=true`, the logging system captures
// three key dimensions for filtering and analysis in the UI:
//
// - **context**: The phase of execution (runtime, boot, system)
// - **resource_type**: The type of resource being operated on (ingest_api, olap_table, etc.)
// - **resource_name**: The specific resource identifier (e.g., "UserEvents", "pageviews_v001")
//
// ## CONTEXTS
//
// ### `runtime` - User Data Processing
// Use for operations that process user data during normal application execution:
// - Processing ingest API requests
// - Running streaming functions/transforms
// - Executing consumption API queries
// - Running workflow tasks
//
// ### `boot` - Infrastructure Changes
// Use for operations that modify infrastructure state during deployment:
// - Creating/altering OLAP tables
// - Creating/updating views and materialized views
// - Applying schema migrations
// - Deploying new resources
//
// ### `system` - Health & Monitoring
// Use for operations that monitor system health and don't involve specific resources:
// - Health checks
// - Metrics collection
// - System diagnostics
// - Note: System context logs typically don't have resource_type or resource_name
//
// ## INSTRUMENTATION PATTERNS
//
// ### Pattern 1: Runtime Operations (with resource_type and resource_name)
//
// ```rust
// use tracing::instrument;
// use crate::cli::logger::{context, resource_type};
//
// #[instrument(
//     name = "ingest_request",
//     skip_all,
//     fields(
//         context = context::RUNTIME,
//         resource_type = resource_type::INGEST_API,
//         resource_name = %table_name,
//     )
// )]
// async fn handle_ingest_request(table_name: &str, body: Bytes) -> Result<Response, Error> {
//     // Function implementation
//     info!("Processing ingest request");
//     // All logs within this span inherit the fields
// }
// ```
//
// ### Pattern 2: Boot Operations (infrastructure changes)
//
// ```rust
// #[instrument(
//     name = "create_table",
//     skip_all,
//     fields(
//         context = context::BOOT,
//         resource_type = resource_type::OLAP_TABLE,
//         resource_name = %format!("{}_{}", database, table_name),
//     )
// )]
// async fn create_table(database: &str, table_name: &str) -> Result<(), Error> {
//     info!("Creating OLAP table");
//     // Implementation
// }
// ```
//
// ### Pattern 3: System Operations (no resource fields)
//
// ```rust
// #[instrument(
//     name = "health_check",
//     skip_all,
//     fields(
//         context = context::SYSTEM,
//     )
// )]
// async fn handle_health_check() -> Response {
//     debug!("Performing health check");
//     // System context doesn't use resource_type or resource_name
// }
// ```
//
// ## RESOURCE NAMING CONVENTIONS
//
// Resource names should be consistent and filterable:
//
// - **Tables**: `{database}_{table_name}` (e.g., "local_UserEvents_000")
// - **Views**: `{database}_{view_name}` (e.g., "local_active_users")
// - **Streams**: `{topic_name}` (e.g., "UserEvents")
// - **APIs**: `{model_name}` (e.g., "UserEvents", "/api/users")
// - **Workflows**: `{workflow_name}` (e.g., "daily_aggregation")
//
// Use the `%` format specifier for Display-formatted fields, or `?` for Debug formatting.
//
// ## ASYNC AND BLOCKING CODE
//
// ### Async Functions
// The `#[instrument]` macro works automatically with async functions:
//
// ```rust
// #[instrument(skip_all, fields(context = context::RUNTIME))]
// async fn process_data() -> Result<(), Error> {
//     // Span is automatically propagated through .await points
//     let result = async_operation().await?;
//     Ok(())
// }
// ```
//
// ### Blocking Code in Async Context
// For blocking operations spawned via `tokio::task::spawn_blocking`, manually propagate the span:
//
// ```rust
// async fn handler() {
//     let span = tracing::Span::current();
//     tokio::task::spawn_blocking(move || {
//         let _guard = span.enter();
//         // Blocking work here - logs will have correct span fields
//         info!("Processing in blocking thread");
//     }).await
// }
// ```
//
// ## FIELD REFERENCE
//
// ### Required for Runtime/Boot Contexts:
// - `context`: Always required (use constants from `context` module)
// - `resource_type`: Required for runtime/boot (use constants from `resource_type` module)
// - `resource_name`: Required for runtime/boot (use `%` formatter for the resource identifier)
//
// ### Optional for System Context:
// - `context`: Required (use `context::SYSTEM`)
// - `resource_type`: Not used
// - `resource_name`: Not used
//
// ## SKIP PARAMETERS
//
// Use `skip_all` to avoid logging function parameters (prevents PII leaks and reduces noise):
//
// ```rust
// #[instrument(skip_all, fields(...))]  // Skip all parameters
// #[instrument(skip(body, headers), fields(...))]  // Skip specific parameters
// ```
//
// ## TESTING
//
// See `apps/framework-cli-e2e/test/structured-logging.test.ts` for E2E tests that verify
// instrumentation coverage and correctness of span fields.
//
// ## CONSTANTS
//
// The constants below are organized into modules for easy import and type safety.
// Use these in your `#[instrument]` attributes to ensure consistency.

/// Structured logging context constants.
/// Used in #[instrument(fields(context = ...))]
pub mod context {
    pub const RUNTIME: &str = "runtime";
    pub const BOOT: &str = "boot";
    pub const SYSTEM: &str = "system";
}

/// Structured logging resource type constants.
/// Used in #[instrument(fields(resource_type = ...))]
pub mod resource_type {
    pub(crate) const INGEST_API: &str = "ingest_api";
    pub(crate) const CONSUMPTION_API: &str = "consumption_api";
    pub(crate) const STREAM: &str = "stream";
    pub(crate) const OLAP_TABLE: &str = "olap_table";
    pub(crate) const VIEW: &str = "view";
    pub(crate) const MATERIALIZED_VIEW: &str = "materialized_view";
    pub(crate) const TRANSFORM: &str = "transform";
    pub(crate) const WORKFLOW: &str = "workflow";
    pub(crate) const TASK: &str = "task";
}

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

#[derive(Deserialize, Debug, Clone)]
pub struct LoggerSettings {
    #[serde(default = "default_log_file")]
    pub log_file_date_format: String,
    #[serde(default = "default_log_level")]
    pub level: LoggerLevel,
    #[serde(default = "default_log_stdout")]
    pub stdout: bool,
    #[serde(default = "default_no_ansi")]
    pub no_ansi: bool,
    /// OTLP gRPC endpoint for structured logs (e.g., "http://localhost:4317")
    /// When set, exports spans/logs to OTLP collector via gRPC with local logging
    #[serde(default)]
    pub otlp_endpoint: Option<String>,
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

fn default_no_ansi() -> bool {
    false // ANSI colors enabled by default
}

impl Default for LoggerSettings {
    fn default() -> Self {
        LoggerSettings {
            log_file_date_format: default_log_file(),
            level: default_log_level(),
            stdout: default_log_stdout(),
            no_ansi: default_no_ansi(),
            otlp_endpoint: None,
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

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(settings.level.to_tracing_level().to_string()));

    // When OTLP is enabled, set up both OTLP export AND local logging
    if let Some(endpoint) = &settings.otlp_endpoint {
        setup_otlp_with_local_logging(settings, endpoint, env_filter);
        return;
    }

    // Default: use fmt layer for file/stdout output
    setup_fmt_logging(settings, env_filter);
}

/// Sets up OTLP export with local logging (stdout or file).
///
/// Creates both an OTLP bridge layer for remote export and a fmt layer for local output.
fn setup_otlp_with_local_logging(settings: &LoggerSettings, endpoint: &str, env_filter: EnvFilter) {
    // Create OTLP exporter
    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .build()
        .expect("Failed to create OTLP log exporter");

    let batch_processor = BatchLogProcessor::builder(log_exporter).build();

    let resource = opentelemetry_sdk::Resource::builder()
        .with_service_name("moose")
        .with_attributes([opentelemetry::KeyValue::new(
            "service.version",
            env!("CARGO_PKG_VERSION"),
        )])
        .build();

    let log_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_log_processor(batch_processor)
        .build();

    // Store for shutdown
    if LOG_PROVIDER.set(log_provider.clone()).is_err() {
        tracing::error!("OTLP log provider already initialized");
        return;
    }

    let otel_bridge = OpenTelemetryTracingBridge::new(&log_provider);

    // Create local layer based on stdout setting
    if settings.stdout {
        let local_layer = tracing_subscriber::fmt::layer()
            .with_writer(std::io::stdout)
            .with_target(true)
            .with_level(true)
            .with_ansi(!settings.no_ansi)
            .compact();

        tracing_subscriber::registry()
            .with(env_filter)
            .with(otel_bridge)
            .with(local_layer)
            .init();
    } else {
        let file_appender = create_rolling_file_appender(&settings.log_file_date_format);
        let local_layer = tracing_subscriber::fmt::layer()
            .with_writer(file_appender)
            .with_target(true)
            .with_level(true)
            .with_ansi(false)
            .compact();

        tracing_subscriber::registry()
            .with(env_filter)
            .with(otel_bridge)
            .with(local_layer)
            .init();
    }

    tracing::info!(target: "moose_cli::otlp", "OTLP logging initialized with endpoint: {}", endpoint);
}

/// Sets up standard fmt logging (file or stdout).
fn setup_fmt_logging(settings: &LoggerSettings, env_filter: EnvFilter) {
    if settings.stdout {
        let layer = tracing_subscriber::fmt::layer()
            .with_writer(std::io::stdout)
            .with_target(true)
            .with_level(true)
            .with_ansi(!settings.no_ansi)
            .compact();

        tracing_subscriber::registry()
            .with(env_filter)
            .with(layer)
            .init();
    } else {
        // For file output, explicitly disable ANSI codes regardless of no_ansi setting.
        // Files are not terminals and don't render colors. tracing-subscriber defaults
        // to ANSI=true, so we must explicitly set it to false for file writers.
        let file_appender = create_rolling_file_appender(&settings.log_file_date_format);
        let layer = tracing_subscriber::fmt::layer()
            .with_writer(file_appender)
            .with_target(true)
            .with_level(true)
            .with_ansi(false)
            .compact();

        tracing_subscriber::registry()
            .with(env_filter)
            .with(layer)
            .init();
    }
}

/// Shuts down the OTLP log provider, flushing any remaining logs.
///
/// This should be called before the application exits to ensure all logs are exported.
pub fn shutdown_otlp() {
    if let Some(provider) = LOG_PROVIDER.get() {
        if let Err(e) = provider.shutdown() {
            eprintln!("Failed to shutdown OTLP log provider: {:?}", e);
        }
    }
}

/// Parsed structured log data from a child process.
#[derive(Debug, Clone)]
pub struct StructuredLogData {
    pub resource_name: String,
    pub message: String,
    pub level: String,
    pub cli_action: Option<String>, // Display label (e.g., "Received", "DeadLetter")
    pub cli_message_type: Option<String>, // "info" | "success" | "warning" | "error" | "highlight"
}

/// Parses a structured log from a child process (Node.js/Python).
///
/// This function handles the common pattern of parsing JSON logs emitted by user code
/// (streaming functions, consumption APIs, workflow tasks). The caller is responsible
/// for creating the span and emitting the log, since tracing macros require literal
/// span names.
///
/// ## Returns
///
/// Returns `Some(StructuredLogData)` if the line contains the
/// `__moose_structured_log__` marker, `None` otherwise.
///
/// The marker is required to distinguish structured logs from regular
/// JSON output that user code might emit. Without this marker, we would
/// incorrectly parse user's JSON logs as structured logs.
///
/// ## Parameters
///
/// - `line`: The log line to parse (expected to be JSON with `__moose_structured_log__` marker)
/// - `resource_name_field`: The JSON field name for the resource (e.g., "function_name", "api_name", "task_name")
///
/// ## Example
///
/// ```rust,ignore
/// use crate::cli::logger::{context, resource_type, parse_structured_log};
///
/// // In a stderr processing loop:
/// while let Ok(Some(line)) = stderr_reader.next_line().await {
///     if let Some(log_data) = parse_structured_log(&line, "function_name") {
///         let span = tracing::info_span!(
///             "streaming_function_log",
///             context = context::RUNTIME,
///             resource_type = resource_type::TRANSFORM,
///             resource_name = %log_data.resource_name,
///         );
///         let _guard = span.enter();
///         match log_data.level.as_str() {
///             "error" => tracing::error!("{}", log_data.message),
///             "warn" => tracing::warn!("{}", log_data.message),
///             "debug" => tracing::debug!("{}", log_data.message),
///             _ => tracing::info!("{}", log_data.message),
///         }
///         continue;
///     }
///     // Handle as regular log...
/// }
/// ```
pub fn parse_structured_log(line: &str, resource_name_field: &str) -> Option<StructuredLogData> {
    // Try to parse as structured log from child process
    let log_entry = serde_json::from_str::<serde_json::Value>(line).ok()?;

    if log_entry
        .get("__moose_structured_log__")
        .and_then(|v| v.as_bool())
        != Some(true)
    {
        return None;
    }

    let resource_name = log_entry
        .get(resource_name_field)
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let message = log_entry
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let level = log_entry
        .get("level")
        .and_then(|v| v.as_str())
        .unwrap_or("info")
        .to_ascii_lowercase();

    let cli_action = log_entry
        .get("cli_action")
        .and_then(|v| v.as_str())
        .map(String::from);

    let cli_message_type = log_entry
        .get("cli_message_type")
        .and_then(|v| v.as_str())
        .map(|s| s.to_ascii_lowercase());

    Some(StructuredLogData {
        resource_name,
        message,
        level,
        cli_action,
        cli_message_type,
    })
}

/// Processes stderr lines from a child process, parsing structured logs and emitting tracing events.
///
/// This is the core logic extracted from `spawn_stderr_structured_logger_with_ui` for testability.
/// It can be called with any `AsyncBufRead` source, allowing unit tests to use in-memory readers.
///
/// ## Parameters
///
/// - `reader`: Any async buffered reader (e.g., `BufReader<ChildStderr>` or `BufReader<Cursor<...>>`)
/// - `resource_name_field`: The JSON field name for the resource (e.g., "function_name", "api_name", "task_name")
/// - `resource_type`: The resource type constant (e.g., "transform", "consumption_api", "task")
/// - `ui_action`: Optional action name for UI display (e.g., "Streaming", "API"). When `Some`,
///   errors will be shown via the callback.
/// - `ui_callback`: A callback function invoked when errors should be displayed in the UI.
/// - `is_prod`: When true, suppresses terminal UI display (messages only go to tracing)
///
/// ## Example
///
/// ```rust,ignore
/// use tokio::io::BufReader;
/// use std::io::Cursor;
///
/// // For testing with in-memory input:
/// let input = r#"{"__moose_structured_log__":true,"function_name":"fn","level":"error","message":"oops"}"#;
/// let reader = BufReader::new(Cursor::new(input));
/// process_stderr_lines(reader, "function_name", "transform", Some("Test"), |_, _| {}, false).await;
/// ```
pub async fn process_stderr_lines<R, F>(
    reader: R,
    resource_name_field: &'static str,
    resource_type: &'static str,
    ui_action: Option<&'static str>,
    ui_callback: F,
    is_prod: bool,
) where
    R: tokio::io::AsyncBufRead + Unpin + Send,
    F: Fn(crate::cli::display::MessageType, crate::cli::display::Message) + Send + Sync,
{
    use tokio::io::AsyncBufReadExt;
    use tracing::{error, info, warn};

    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(log_data) = parse_structured_log(&line, resource_name_field) {
            // Check if this is a CLI log (has cli_action)
            if let Some(action) = &log_data.cli_action {
                // Parse message type for CLI display
                let msg_type_str = log_data.cli_message_type.as_deref().unwrap_or("Info");
                let msg_type = match msg_type_str {
                    "error" => crate::cli::display::MessageType::Error,
                    "warning" => crate::cli::display::MessageType::Warning,
                    "success" => crate::cli::display::MessageType::Success,
                    "highlight" => crate::cli::display::MessageType::Highlight,
                    _ => crate::cli::display::MessageType::Info,
                };

                // Dev mode: show in terminal (only if not in production mode)
                if !is_prod {
                    let message =
                        crate::cli::display::Message::new(action.clone(), log_data.message.clone());
                    show_message!(msg_type, message, true);
                }

                // Always route to tracing for observability
                match msg_type {
                    crate::cli::display::MessageType::Error => {
                        error!("{}: {}", action, log_data.message)
                    }
                    crate::cli::display::MessageType::Warning => {
                        warn!("{}: {}", action, log_data.message)
                    }
                    _ => info!("{}: {}", action, log_data.message),
                }
                continue;
            }

            // Regular structured log (not CLI log)
            let span = tracing::info_span!(
                "child_process_log",
                context = context::RUNTIME,
                resource_type = resource_type,
                resource_name = %log_data.resource_name,
            );
            let _guard = span.enter();
            match log_data.level.as_str() {
                "error" => {
                    tracing::error!("{}", log_data.message);
                    if let Some(action) = ui_action {
                        ui_callback(
                            crate::cli::display::MessageType::Error,
                            crate::cli::display::Message {
                                action: action.to_string(),
                                details: log_data.message.clone(),
                            },
                        );
                    }
                }
                "warn" => tracing::warn!("{}", log_data.message),
                "debug" => tracing::debug!("{}", log_data.message),
                _ => tracing::info!("{}", log_data.message),
            }
            continue;
        }
        // Fall back to regular error logging if not a structured log
        error!("{}", line);
        if let Some(action) = ui_action {
            ui_callback(
                crate::cli::display::MessageType::Error,
                crate::cli::display::Message {
                    action: action.to_string(),
                    details: line.to_string(),
                },
            );
        }
    }
}

/// Spawns an async task to read stderr and parse structured logs with optional UI display.
///
/// This helper consolidates the common pattern of reading stderr from child
/// processes and parsing structured logs with span context. It handles both
/// structured logs (JSON with `__moose_structured_log__` marker) and regular
/// stderr output, optionally displaying errors in the CLI UI.
///
/// ## Parameters
///
/// - `stderr`: The child process stderr stream to read from
/// - `resource_name_field`: The JSON field name for the resource (e.g., "function_name", "api_name", "task_name")
/// - `resource_type`: The resource type constant (e.g., "transform", "consumption_api", "task")
/// - `ui_action`: Optional action name for UI display (e.g., "Streaming", "API"). When `Some`,
///   errors will be shown in the CLI UI with this action label.
/// - `is_prod`: When true, suppresses terminal UI display (messages only go to tracing)
///
/// ## Returns
///
/// Returns a `JoinHandle` for the spawned task, which can be awaited to ensure
/// the stderr processing completes.
///
/// ## Example
///
/// ```rust,ignore
/// use crate::cli::logger;
///
/// if let Some(stderr) = child.stderr.take() {
///     // Show streaming function errors in CLI UI
///     logger::spawn_stderr_structured_logger_with_ui(
///         stderr,
///         "function_name",
///         logger::resource_type::TRANSFORM,
///         Some("Streaming"),
///         false,
///     );
/// }
/// ```
pub fn spawn_stderr_structured_logger_with_ui(
    stderr: tokio::process::ChildStderr,
    resource_name_field: &'static str,
    resource_type: &'static str,
    ui_action: Option<&'static str>,
    is_prod: bool,
) -> tokio::task::JoinHandle<()> {
    use crate::cli::display::show_message_wrapper;
    use tokio::io::BufReader;

    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        process_stderr_lines(
            reader,
            resource_name_field,
            resource_type,
            ui_action,
            show_message_wrapper,
            is_prod,
        )
        .await
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tracing::instrument;

    /// Mock writer that captures output to a shared buffer
    #[derive(Clone)]
    struct MockWriter {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl MockWriter {
        fn new() -> Self {
            Self {
                buffer: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn get_output(&self) -> String {
            let buffer = self.buffer.lock().unwrap();
            String::from_utf8(buffer.clone()).expect("Invalid UTF-8 in log output")
        }
    }

    impl std::io::Write for MockWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let mut buffer = self.buffer.lock().unwrap();
            buffer.extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for MockWriter {
        type Writer = Self;

        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    #[test]
    fn test_span_fields_in_json_output() {
        // Setup mock writer to capture output
        let mock_writer = MockWriter::new();

        // Create JSON layer with span support (matching setup_structured_logs)
        let json_layer = tracing_subscriber::fmt::layer()
            .json()
            .with_current_span(true)
            .with_span_list(false)
            .with_target(true)
            .with_file(false)
            .with_line_number(false)
            .with_writer(mock_writer.clone());

        // Initialize subscriber
        let subscriber = tracing_subscriber::registry().with(json_layer);

        tracing::subscriber::with_default(subscriber, || {
            test_function_with_span("UserEvent");
        });

        // Get captured output
        let output = mock_writer.get_output();

        // Parse JSON output
        let log_entry: serde_json::Value =
            serde_json::from_str(&output).expect("Failed to parse JSON log output");

        // Assert span fields are present
        assert_eq!(
            log_entry["span"]["context"].as_str(),
            Some("runtime"),
            "Expected context field in span"
        );
        assert_eq!(
            log_entry["span"]["resource_type"].as_str(),
            Some("stream"),
            "Expected resource_type field in span"
        );
        assert_eq!(
            log_entry["span"]["resource_name"].as_str(),
            Some("UserEvent"),
            "Expected resource_name field in span"
        );
        assert_eq!(
            log_entry["fields"]["message"].as_str(),
            Some("Processing request"),
            "Expected message in fields"
        );
    }

    #[instrument(
        name = "test_ingest",
        skip_all,
        fields(
            context = "runtime",
            resource_type = "stream",
            resource_name = %topic_name,
        )
    )]
    fn test_function_with_span(topic_name: &str) {
        tracing::info!("Processing request");
    }

    #[test]
    fn test_logs_without_spans_are_valid() {
        // Setup mock writer to capture output
        let mock_writer = MockWriter::new();

        // Create JSON layer with span support
        let json_layer = tracing_subscriber::fmt::layer()
            .json()
            .with_current_span(true)
            .with_span_list(false)
            .with_target(true)
            .with_file(false)
            .with_line_number(false)
            .with_writer(mock_writer.clone());

        // Initialize subscriber
        let subscriber = tracing_subscriber::registry().with(json_layer);

        tracing::subscriber::with_default(subscriber, || {
            // Emit log without any span
            tracing::info!("Log without span");
        });

        // Get captured output
        let output = mock_writer.get_output();

        // Parse JSON output - should still be valid even without span
        let log_entry: serde_json::Value =
            serde_json::from_str(&output).expect("Failed to parse JSON log output");

        // Assert basic fields are present
        assert_eq!(
            log_entry["fields"]["message"].as_str(),
            Some("Log without span"),
            "Expected message in fields"
        );

        // Span field may be null or absent when no span is active
        assert!(
            log_entry["span"].is_null() || log_entry.get("span").is_none(),
            "Expected no span field or null span when logging without span context"
        );
    }

    #[test]
    fn test_p0_constants_exported() {
        // Verify context constants are accessible
        assert_eq!(context::RUNTIME, "runtime");
        assert_eq!(context::BOOT, "boot");
        assert_eq!(context::SYSTEM, "system");

        // Verify resource_type constants are accessible
        assert_eq!(resource_type::INGEST_API, "ingest_api");
        assert_eq!(resource_type::CONSUMPTION_API, "consumption_api");
        assert_eq!(resource_type::STREAM, "stream");
        assert_eq!(resource_type::OLAP_TABLE, "olap_table");
        assert_eq!(resource_type::VIEW, "view");
        assert_eq!(resource_type::MATERIALIZED_VIEW, "materialized_view");
        assert_eq!(resource_type::TRANSFORM, "transform");
        assert_eq!(resource_type::WORKFLOW, "workflow");
        assert_eq!(resource_type::TASK, "task");
    }

    #[test]
    fn test_parse_structured_log_valid() {
        let line = r#"{"__moose_structured_log__":true,"function_name":"test_fn","message":"hello","level":"warn"}"#;
        let result = parse_structured_log(line, "function_name").unwrap();
        assert_eq!(result.resource_name, "test_fn");
        assert_eq!(result.message, "hello");
        assert_eq!(result.level, "warn");
    }

    #[test]
    fn test_parse_structured_log_not_json() {
        assert!(parse_structured_log("plain text", "function_name").is_none());
    }

    #[test]
    fn test_parse_structured_log_missing_marker() {
        let line = r#"{"function_name":"test_fn","message":"hello"}"#;
        assert!(parse_structured_log(line, "function_name").is_none());
    }

    #[test]
    fn test_parse_structured_log_defaults() {
        let line = r#"{"__moose_structured_log__":true}"#;
        let result = parse_structured_log(line, "function_name").unwrap();
        assert_eq!(result.resource_name, "unknown");
        assert_eq!(result.message, "");
        assert_eq!(result.level, "info");
    }

    // Tests for process_stderr_lines
    use crate::cli::display::{Message, MessageType};

    #[tokio::test]
    async fn test_process_stderr_lines_structured_error_log() {
        // Structured log with error level
        let input = r#"{"__moose_structured_log__":true,"function_name":"my_func","level":"error","message":"Something went wrong"}"#;
        let reader = tokio::io::BufReader::new(std::io::Cursor::new(input));

        let callbacks: Arc<Mutex<Vec<(MessageType, Message)>>> = Arc::new(Mutex::new(Vec::new()));
        let callbacks_clone = callbacks.clone();

        process_stderr_lines(
            reader,
            "function_name",
            resource_type::TRANSFORM,
            Some("Streaming"),
            move |msg_type, msg| {
                callbacks_clone.lock().unwrap().push((msg_type, msg));
            },
            false,
        )
        .await;

        let captured = callbacks.lock().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].0, MessageType::Error);
        assert_eq!(captured[0].1.action, "Streaming");
        assert_eq!(captured[0].1.details, "Something went wrong");
    }

    #[tokio::test]
    async fn test_process_stderr_lines_structured_info_log_no_ui_callback() {
        // Info-level structured log should not trigger ui_callback
        let input = r#"{"__moose_structured_log__":true,"function_name":"my_func","level":"info","message":"Just info"}"#;
        let reader = tokio::io::BufReader::new(std::io::Cursor::new(input));

        let callbacks: Arc<Mutex<Vec<(MessageType, Message)>>> = Arc::new(Mutex::new(Vec::new()));
        let callbacks_clone = callbacks.clone();

        process_stderr_lines(
            reader,
            "function_name",
            resource_type::TRANSFORM,
            Some("Streaming"),
            move |msg_type, msg| {
                callbacks_clone.lock().unwrap().push((msg_type, msg));
            },
            false,
        )
        .await;

        let captured = callbacks.lock().unwrap();
        assert!(
            captured.is_empty(),
            "Info logs should not trigger UI callback"
        );
    }

    #[tokio::test]
    async fn test_process_stderr_lines_non_structured_line() {
        // Non-structured line should trigger UI callback with Error
        let input = "Plain stderr output\n";
        let reader = tokio::io::BufReader::new(std::io::Cursor::new(input));

        let callbacks: Arc<Mutex<Vec<(MessageType, Message)>>> = Arc::new(Mutex::new(Vec::new()));
        let callbacks_clone = callbacks.clone();

        process_stderr_lines(
            reader,
            "function_name",
            resource_type::TRANSFORM,
            Some("Streaming"),
            move |msg_type, msg| {
                callbacks_clone.lock().unwrap().push((msg_type, msg));
            },
            false,
        )
        .await;

        let captured = callbacks.lock().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].0, MessageType::Error);
        assert_eq!(captured[0].1.details, "Plain stderr output");
    }

    #[tokio::test]
    async fn test_process_stderr_lines_ui_action_none_no_callback() {
        // When ui_action is None, callback should not be invoked
        let input = r#"{"__moose_structured_log__":true,"function_name":"my_func","level":"error","message":"Error"}"#;
        let reader = tokio::io::BufReader::new(std::io::Cursor::new(input));

        let callbacks: Arc<Mutex<Vec<(MessageType, Message)>>> = Arc::new(Mutex::new(Vec::new()));
        let callbacks_clone = callbacks.clone();

        process_stderr_lines(
            reader,
            "function_name",
            resource_type::TRANSFORM,
            None, // No UI action
            move |msg_type, msg| {
                callbacks_clone.lock().unwrap().push((msg_type, msg));
            },
            false,
        )
        .await;

        let captured = callbacks.lock().unwrap();
        assert!(captured.is_empty(), "No UI callback when ui_action is None");
    }

    #[tokio::test]
    async fn test_process_stderr_lines_multiple_lines() {
        // Multiple lines - one structured error, one plain
        let input = r#"{"__moose_structured_log__":true,"function_name":"my_func","level":"error","message":"Structured error"}
Plain error line"#;
        let reader = tokio::io::BufReader::new(std::io::Cursor::new(input));

        let callbacks: Arc<Mutex<Vec<(MessageType, Message)>>> = Arc::new(Mutex::new(Vec::new()));
        let callbacks_clone = callbacks.clone();

        process_stderr_lines(
            reader,
            "function_name",
            resource_type::TRANSFORM,
            Some("Streaming"),
            move |msg_type, msg| {
                callbacks_clone.lock().unwrap().push((msg_type, msg));
            },
            false,
        )
        .await;

        let captured = callbacks.lock().unwrap();
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].1.details, "Structured error");
        assert_eq!(captured[1].1.details, "Plain error line");
    }
}
