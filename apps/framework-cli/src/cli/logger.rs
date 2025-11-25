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
//! - **OTEL Layer**: Optional OpenTelemetry export for observability platforms
//!
//! ## Components
//!
//! - `LoggerLevel`: An enumeration representing the different levels of logging: DEBUG, INFO, WARN, and ERROR.
//! - `LogFormat`: Either Text or JSON output format.
//! - `LoggerSettings`: A struct that holds the settings for the logger, including format, level, and export options.
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
//! - **Machine ID tracking**: Included in every log event
//! - **OpenTelemetry export**: Optional OTLP/HTTP JSON export to observability platforms
//! - **Configurable outputs**: File and/or stdout
//!
//! ## Environment Variables
//!
//! - `RUST_LOG`: Standard Rust log filtering (e.g., `RUST_LOG=moose_cli::infrastructure=debug`)
//! - `MOOSE_LOGGER__USE_TRACING_FORMAT`: Opt-in to modern format (default: `false`)
//! - `MOOSE_LOGGER__LEVEL`: Log level (DEBUG, INFO, WARN, ERROR)
//! - `MOOSE_LOGGER__STDOUT`: Output to stdout vs file (default: `false`)
//! - `MOOSE_LOGGER__FORMAT`: Text or JSON (default: Text)
//! - `MOOSE_LOGGER__EXPORT_TO`: OTEL endpoint URL
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

use hyper::Uri;
use opentelemetry::KeyValue;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{Protocol, WithExportConfig};
use opentelemetry_sdk::logs::{BatchLogProcessor, SdkLoggerProvider};
use opentelemetry_sdk::Resource;
use opentelemetry_semantic_conventions::resource::SERVICE_NAME;
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

use crate::utilities::constants::{CONTEXT, CTX_SESSION_ID};

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

    #[serde(deserialize_with = "parsing_url", default = "Option::default")]
    pub export_to: Option<Uri>,

    #[serde(default = "default_include_session_id")]
    pub include_session_id: bool,

    #[serde(default = "default_use_tracing_format")]
    pub use_tracing_format: bool,
}

fn parsing_url<'de, D>(deserializer: D) -> Result<Option<Uri>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(deserializer)?;
    Ok(s.and_then(|s| s.parse().ok()))
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

impl Default for LoggerSettings {
    fn default() -> Self {
        LoggerSettings {
            log_file_date_format: default_log_file(),
            level: default_log_level(),
            stdout: default_log_stdout(),
            format: default_log_format(),
            export_to: None,
            include_session_id: default_include_session_id(),
            use_tracing_format: default_use_tracing_format(),
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

// Error that rolls up all the possible errors that can occur during logging setup
#[derive(thiserror::Error, Debug)]
pub enum LoggerError {
    #[error("Error setting up OTEL logger: {0}")]
    OtelSetup(String),
}

/// Custom fields that get injected into every log event
#[derive(Clone)]
struct CustomFields {
    session_id: String,
    #[allow(dead_code)] // Will be used when OTEL support is re-enabled
    machine_id: String,
}

/// Layer that formats logs to match the legacy fern format exactly
struct LegacyFormatLayer<W> {
    writer: W,
    format: LogFormat,
    include_session_id: bool,
    custom_fields: CustomFields,
}

impl<W> LegacyFormatLayer<W> {
    fn new(
        writer: W,
        format: LogFormat,
        include_session_id: bool,
        custom_fields: CustomFields,
    ) -> Self {
        Self {
            writer,
            format,
            include_session_id,
            custom_fields,
        }
    }

    fn format_text(&self, level: &Level, target: &str, message: &str) -> String {
        // Match current fern text format exactly
        format!(
            "[{} {}{} - {}] {}",
            humantime::format_rfc3339_seconds(SystemTime::now()),
            level,
            if self.include_session_id {
                format!(" {}", self.custom_fields.session_id)
            } else {
                String::new()
            },
            target,
            message
        )
    }

    fn format_json(&self, level: &Level, target: &str, message: &str) -> String {
        // Match current fern JSON format exactly
        let mut log_json = serde_json::json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "severity": level.to_string(),
            "target": target,
            "message": message,
        });

        if self.include_session_id {
            log_json["session_id"] =
                serde_json::Value::String(self.custom_fields.session_id.clone());
        }

        serde_json::to_string(&log_json)
            .expect("formatting `serde_json::Value` with string keys never fails")
    }
}

impl<S, W> Layer<S> for LegacyFormatLayer<W>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    W: for<'writer> MakeWriter<'writer> + 'static,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        // Extract metadata
        let metadata = event.metadata();
        let level = metadata.level();
        let target = metadata.target();

        // Extract message using visitor
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let message = visitor.message;

        // Format based on LogFormat
        let output = if self.format == LogFormat::Text {
            self.format_text(level, target, &message)
        } else {
            self.format_json(level, target, &message)
        };

        // Write to output
        let mut writer = self.writer.make_writer();
        let _ = writer.write_all(output.as_bytes());
        let _ = writer.write_all(b"\n");
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: String,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
            // Remove surrounding quotes from debug format
            if self.message.starts_with('"') && self.message.ends_with('"') {
                self.message = self.message[1..self.message.len() - 1].to_string();
            }
        }
    }
}

/// Creates an OpenTelemetry layer for log export
///
/// This function sets up OTLP log export using opentelemetry-appender-tracing.
/// It creates a LoggerProvider with a batch processor and OTLP exporter.
fn create_otel_layer(
    endpoint: &Uri,
    session_id: &str,
    machine_id: &str,
) -> Result<impl Layer<tracing_subscriber::Registry>, LoggerError> {
    // Create resource with service metadata
    let resource = Resource::builder()
        .with_attribute(KeyValue::new(SERVICE_NAME, "moose-cli"))
        .with_attribute(KeyValue::new("session_id", session_id.to_string()))
        .with_attribute(KeyValue::new("machine_id", machine_id.to_string()))
        .build();

    // Build OTLP log exporter
    let exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpJson)
        .with_endpoint(endpoint.to_string())
        .build()
        .map_err(|e| LoggerError::OtelSetup(format!("Failed to build OTLP exporter: {}", e)))?;

    // Create logger provider with batch processor
    let provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_log_processor(BatchLogProcessor::builder(exporter).build())
        .build();

    // Create the tracing bridge layer
    Ok(OpenTelemetryTracingBridge::new(&provider))
}

pub fn setup_logging(settings: &LoggerSettings, machine_id: &str) -> Result<(), LoggerError> {
    clean_old_logs();

    let session_id = CONTEXT.get(CTX_SESSION_ID).unwrap();

    // Create custom fields for use in formatters
    let custom_fields = CustomFields {
        session_id: session_id.to_string(),
        machine_id: machine_id.to_string(),
    };

    // Setup logging based on format type
    if settings.use_tracing_format {
        // Modern format using tracing built-ins
        setup_modern_format(settings, session_id, machine_id)
    } else {
        // Legacy format matching fern exactly
        setup_legacy_format(settings, session_id, machine_id, custom_fields)
    }
}

fn setup_modern_format(
    settings: &LoggerSettings,
    session_id: &str,
    machine_id: &str,
) -> Result<(), LoggerError> {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(settings.level.to_tracing_level().to_string()));

    // Setup with or without OTEL based on configuration
    if let Some(endpoint) = &settings.export_to {
        let otel_layer = create_otel_layer(endpoint, session_id, machine_id)?;

        if settings.stdout {
            let format_layer = tracing_subscriber::fmt::layer()
                .with_writer(std::io::stdout)
                .with_target(true)
                .with_level(true);

            if settings.format == LogFormat::Json {
                tracing_subscriber::registry()
                    .with(otel_layer)
                    .with(env_filter)
                    .with(format_layer.json())
                    .init();
            } else {
                tracing_subscriber::registry()
                    .with(otel_layer)
                    .with(env_filter)
                    .with(format_layer.compact())
                    .init();
            }
        } else {
            let file_appender = tracing_appender::rolling::daily(user_directory(), "cli.log");
            let format_layer = tracing_subscriber::fmt::layer()
                .with_writer(file_appender)
                .with_target(true)
                .with_level(true);

            if settings.format == LogFormat::Json {
                tracing_subscriber::registry()
                    .with(otel_layer)
                    .with(env_filter)
                    .with(format_layer.json())
                    .init();
            } else {
                tracing_subscriber::registry()
                    .with(otel_layer)
                    .with(env_filter)
                    .with(format_layer.compact())
                    .init();
            }
        }
    } else {
        // No OTEL export
        if settings.stdout {
            let format_layer = tracing_subscriber::fmt::layer()
                .with_writer(std::io::stdout)
                .with_target(true)
                .with_level(true);

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
            let file_appender = tracing_appender::rolling::daily(user_directory(), "cli.log");
            let format_layer = tracing_subscriber::fmt::layer()
                .with_writer(file_appender)
                .with_target(true)
                .with_level(true);

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

    Ok(())
}

fn setup_legacy_format(
    settings: &LoggerSettings,
    session_id: &str,
    machine_id: &str,
    custom_fields: CustomFields,
) -> Result<(), LoggerError> {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(settings.level.to_tracing_level().to_string()));

    // Setup with or without OTEL based on configuration
    if let Some(endpoint) = &settings.export_to {
        let otel_layer = create_otel_layer(endpoint, session_id, machine_id)?;

        if settings.stdout {
            let legacy_layer = LegacyFormatLayer::new(
                std::io::stdout,
                settings.format.clone(),
                settings.include_session_id,
                custom_fields,
            );

            tracing_subscriber::registry()
                .with(otel_layer)
                .with(env_filter)
                .with(legacy_layer)
                .init();
        } else {
            let file_appender = tracing_appender::rolling::daily(user_directory(), "cli.log");
            let legacy_layer = LegacyFormatLayer::new(
                file_appender,
                settings.format.clone(),
                settings.include_session_id,
                custom_fields,
            );

            tracing_subscriber::registry()
                .with(otel_layer)
                .with(env_filter)
                .with(legacy_layer)
                .init();
        }
    } else {
        // No OTEL export
        if settings.stdout {
            let legacy_layer = LegacyFormatLayer::new(
                std::io::stdout,
                settings.format.clone(),
                settings.include_session_id,
                custom_fields.clone(),
            );

            tracing_subscriber::registry()
                .with(env_filter)
                .with(legacy_layer)
                .init();
        } else {
            let file_appender = tracing_appender::rolling::daily(user_directory(), "cli.log");
            let legacy_layer = LegacyFormatLayer::new(
                file_appender,
                settings.format.clone(),
                settings.include_session_id,
                custom_fields,
            );

            tracing_subscriber::registry()
                .with(env_filter)
                .with(legacy_layer)
                .init();
        }
    }

    Ok(())
}
