//! # Logger Module
//!
//! This module provides logging functionality for the application.
//!
//! ## Components
//!
//! - `LoggerLevel`: An enumeration representing the different levels of logging: DEBUG, INFO, WARN, and ERROR.
//! - `LoggerSettings`: A struct that holds the settings for the logger, including the log file's name and the logging level.
//! - `setup_logging`: A function used to set up the logging system with the provided settings.
//!
//! ## Usage
//!
//! The logger is configured by creating a `LoggerSettings` instance and passing it to the `setup_logging` function.
//! The `LoggerSettings` can be configured with a log file and a log level. If these are not provided, default values are used.
//! The default log file is "cli.log" in the user's directory, and the default log level is INFO.
//! Use the macros to write to the log file.
//!
//! The log levels have the following uses:
//! - `DEBUG`: Use this level for detailed information typically of use only when diagnosing problems. You would usually only expect to see these logs in a development environment. For example, you might log method entry/exit points, variable values, query results, etc.
//! - `INFO`: Use this level to confirm that things are working as expected. This is the default log level and will give you general operational insights into the application behavior. For example, you might log start/stop of a process, configuration details, successful completion of significant transactions, etc.
//! - `WARN`: Use this level when something unexpected happened in the system, or there might be a problem in the near future (like 'disk space low'). The software is still working as expected, so it's not an error. For example, you might log deprecated API usage, poor performance issues, retrying an operation, etc.
//! - `ERROR`: Use this level when the system is in distress, customers are probably being affected but the program is not terminated. An operator should definitely look into it. For example, you might log exceptions, potential data inconsistency, or system overloads.
//!
//! ## Example
//!
//! ```rust
//! debug!("This is a DEBUG message. Typically used for detailed information useful in a development environment.");
//! info!("This is an INFO message. Used to confirm that things are working as expected.");
//! warn!("This is a WARN message. Indicates something unexpected happened or there might be a problem in the near future.");
//! error!("This is an ERROR message. Used when the system is in distress, customers are probably being affected but the program is not terminated.");
//! ```
//!

use hyper::Uri;
use log::{error, warn};
use log::{LevelFilter, Metadata, Record};
use opentelemetry::logs::Logger;
use opentelemetry::KeyValue;
use opentelemetry_appender_log::OpenTelemetryLogBridge;
use opentelemetry_otlp::{Protocol, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::Resource;
use opentelemetry_semantic_conventions::resource::SERVICE_NAME;
use serde::Deserialize;
use serde_json::Value;
use std::env;
use std::env::VarError;
use std::time::{Duration, SystemTime};

use crate::utilities::constants::{CONTEXT, CTX_SESSION_ID};
use crate::utilities::decode_object;

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
    pub fn to_log_level(&self) -> log::LevelFilter {
        match self {
            LoggerLevel::Debug => log::LevelFilter::Debug,
            LoggerLevel::Info => log::LevelFilter::Info,
            LoggerLevel::Warn => log::LevelFilter::Warn,
            LoggerLevel::Error => log::LevelFilter::Error,
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

impl Default for LoggerSettings {
    fn default() -> Self {
        LoggerSettings {
            log_file_date_format: default_log_file(),
            level: default_log_level(),
            stdout: default_log_stdout(),
            format: default_log_format(),
            export_to: None,
            include_session_id: default_include_session_id(),
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
    #[error("Error Initializing fern logger")]
    Init(#[from] fern::InitError),
    #[error("Error setting up otel logger")]
    Exporter(#[from] opentelemetry_sdk::error::OTelSdkError),
    #[error("Error building the exporter")]
    ExporterBuild(#[from] opentelemetry_otlp::ExporterBuildError),
    #[error("Error setting up default logger")]
    LogSetup(#[from] log::SetLoggerError),
}

pub fn setup_logging(settings: &LoggerSettings, machine_id: &str) -> Result<(), LoggerError> {
    clean_old_logs();

    let session_id = CONTEXT.get(CTX_SESSION_ID).unwrap();
    let include_session_id = settings.include_session_id;

    let base_config = fern::Dispatch::new().level(settings.level.to_log_level());

    let format_config = if settings.format == LogFormat::Text {
        fern::Dispatch::new().format(move |out, message, record| {
            out.finish(format_args!(
                "[{} {}{} - {}] {}",
                humantime::format_rfc3339_seconds(SystemTime::now()),
                record.level(),
                if include_session_id {
                    format!(" {}", &session_id)
                } else {
                    String::new()
                },
                record.target(),
                message
            ))
        })
    } else {
        fern::Dispatch::new().format(move |out, message, record| {
            let mut log_json = serde_json::json!({
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "severity": record.level().to_string(),
                "target": record.target(),
                "message": message,
            });

            if include_session_id {
                log_json["session_id"] = serde_json::Value::String(session_id.to_string());
            }

            out.finish(format_args!(
                "{}",
                serde_json::to_string(&log_json)
                    .expect("formatting `serde_json::Value` with string keys never fails")
            ))
        })
    };

    let output_config = if settings.stdout {
        format_config.chain(std::io::stdout())
    } else {
        format_config.chain(fern::DateBased::new(
            // `.join("")` is an idempotent way to ensure the path ends with '/'
            user_directory().join("").to_str().unwrap(),
            settings.log_file_date_format.clone(),
        ))
    };

    let output_config = match &settings.export_to {
        None => output_config,
        Some(otel_endpoint) => {
            let string_uri = otel_endpoint.to_string();
            let reqwest_client = reqwest::blocking::Client::new();

            let open_telemetry_exporter = opentelemetry_otlp::LogExporter::builder()
                .with_http()
                .with_http_client(reqwest_client)
                .with_endpoint(string_uri)
                .with_protocol(Protocol::HttpJson)
                .with_timeout(Duration::from_millis(5000))
                .build()?;

            let mut resource_attributes = vec![
                KeyValue::new(SERVICE_NAME, "moose-cli"),
                KeyValue::new("session_id", session_id.as_str()),
                KeyValue::new("machine_id", String::from(machine_id)),
            ];
            match env::var("MOOSE_METRIC__LABELS") {
                Ok(base64) => match decode_object::decode_base64_to_json(&base64) {
                    Ok(Value::Object(labels)) => {
                        for (key, value) in labels {
                            if let Some(value_str) = value.as_str() {
                                resource_attributes.push(KeyValue::new(key, value_str.to_string()));
                            }
                        }
                    }
                    Ok(_) => warn!("Unexpected value for MOOSE_METRIC_LABELS"),
                    Err(e) => error!("Error decoding MOOSE_METRIC_LABELS: {}", e),
                },
                Err(VarError::NotPresent) => {}
                Err(VarError::NotUnicode(e)) => {
                    error!("MOOSE_METRIC__LABELS is not unicode: {:?}", e);
                }
            }

            let resource = Resource::builder()
                .with_attributes(resource_attributes)
                .build();
            let logger_provider = SdkLoggerProvider::builder()
                .with_resource(resource)
                .with_batch_exporter(open_telemetry_exporter)
                .build();

            let logger: Box<dyn log::Log> = Box::new(TargetToKvLogger {
                inner: OpenTelemetryLogBridge::new(&logger_provider),
            });

            fern::Dispatch::new().chain(output_config).chain(
                fern::Dispatch::new()
                    // to prevent exporter recursively calls logging and thus itself
                    .level(LevelFilter::Off)
                    .level_for("moose_cli", settings.level.to_log_level())
                    .chain(logger),
            )
        }
    };
    base_config.chain(output_config).apply()?;

    Ok(())
}

struct TargetToKvLogger<P, L>
where
    P: opentelemetry::logs::LoggerProvider<Logger = L> + Send + Sync,
    L: Logger + Send + Sync,
{
    inner: OpenTelemetryLogBridge<P, L>,
}

impl<P, L> log::Log for TargetToKvLogger<P, L>
where
    P: opentelemetry::logs::LoggerProvider<Logger = L> + Send + Sync,
    L: Logger + Send + Sync,
{
    fn enabled(&self, metadata: &Metadata) -> bool {
        self.inner.enabled(metadata)
    }

    fn log(&self, record: &Record) {
        let mut with_target = record.to_builder();
        let kvs: &dyn log::kv::Source = &("target", record.target());
        with_target.key_values(kvs);
        self.inner.log(&with_target.build());
    }

    fn flush(&self) {
        self.inner.flush()
    }
}
