//! OTLP log export setup and lifecycle management.

use std::sync::OnceLock;

use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::logs::{BatchLogProcessor, SdkLoggerProvider};
use tracing::error;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

use super::capture_layer::SpanFieldCaptureLayer;
use super::log_processor::SpanFieldInjectingProcessor;
use super::span_fields::SpanFieldStorageLayer;

/// Static storage for the log provider, used for shutdown.
static LOG_PROVIDER: OnceLock<SdkLoggerProvider> = OnceLock::new();

/// Settings for OTLP log export.
pub struct OtlpLogSettings {
    /// OTLP gRPC endpoint (e.g., "http://localhost:4317")
    pub endpoint: String,
    /// Log level filter string (e.g., "info", "debug")
    pub level_filter: String,
}

/// Sets up OTLP log export with span field injection.
///
/// Creates the following layer stack:
/// 1. SpanFieldStorageLayer - captures span fields on span creation
/// 2. SpanFieldCaptureLayer - copies fields to thread-local on each event
/// 3. OpenTelemetryTracingBridge - converts events to OTLP LogRecords
/// 4. EnvFilter - filters by log level
///
/// The LoggerProvider uses SpanFieldInjectingProcessor to read from
/// thread-local and add attributes to LogRecords before export.
///
/// # Panics
///
/// Panics if OTLP initialization fails (misconfiguration should fail fast).
pub fn setup_otlp_logs(settings: OtlpLogSettings) {
    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(&settings.endpoint)
        .build()
        .expect("Failed to create OTLP log exporter");

    let batch_processor = BatchLogProcessor::builder(log_exporter).build();
    let enriching_processor = SpanFieldInjectingProcessor::new(batch_processor);

    let resource = opentelemetry_sdk::Resource::builder()
        .with_service_name("moose")
        .with_attributes([opentelemetry::KeyValue::new(
            "service.version",
            env!("CARGO_PKG_VERSION"),
        )])
        .build();

    let log_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_log_processor(enriching_processor)
        .build();

    // Store for shutdown
    if LOG_PROVIDER.set(log_provider.clone()).is_err() {
        error!("OTLP log provider already initialized");
        return;
    }

    let otel_bridge = OpenTelemetryTracingBridge::new(&log_provider);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&settings.level_filter));

    // Layer order matters:
    // 1. SpanFieldStorageLayer must run on_new_span before any events
    // 2. SpanFieldCaptureLayer must run on_event BEFORE the bridge
    // 3. The bridge creates LogRecords and sends to the provider
    tracing_subscriber::registry()
        .with(SpanFieldStorageLayer)
        .with(SpanFieldCaptureLayer)
        .with(otel_bridge)
        .with(env_filter)
        .init();
}

/// Shuts down the OTLP log provider, flushing any remaining logs.
///
/// Should be called before application exit to ensure all logs are exported.
pub fn shutdown_otlp() {
    if let Some(provider) = LOG_PROVIDER.get() {
        if let Err(e) = provider.shutdown() {
            eprintln!("Failed to shutdown OTLP log provider: {:?}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::otlp::capture_layer::CURRENT_SPAN_FIELDS;
    use opentelemetry::logs::AnyValue;
    use tracing::instrument;

    /// Verifies span fields flow through to thread-local storage.
    ///
    /// This test sets up SpanFieldStorageLayer + SpanFieldCaptureLayer,
    /// creates a span with fields, emits a log event, and verifies the
    /// fields are captured in CURRENT_SPAN_FIELDS (which the LogProcessor reads).
    #[test]
    fn test_span_fields_captured_for_otlp() {
        let subscriber = tracing_subscriber::registry()
            .with(SpanFieldStorageLayer)
            .with(SpanFieldCaptureLayer);

        tracing::subscriber::with_default(subscriber, || {
            instrumented_function("test_table");
        });

        // Verify fields were captured in thread-local
        CURRENT_SPAN_FIELDS.with(|fields| {
            let fields = fields.borrow();

            assert_eq!(
                fields.get("context").and_then(|v| match v {
                    AnyValue::String(s) => Some(s.as_str()),
                    _ => None,
                }),
                Some("runtime"),
                "context field should be 'runtime'"
            );

            assert_eq!(
                fields.get("resource_type").and_then(|v| match v {
                    AnyValue::String(s) => Some(s.as_str()),
                    _ => None,
                }),
                Some("ingest_api"),
                "resource_type field should be 'ingest_api'"
            );

            assert_eq!(
                fields.get("resource_name").and_then(|v| match v {
                    AnyValue::String(s) => Some(s.as_str()),
                    _ => None,
                }),
                Some("test_table"),
                "resource_name field should be 'test_table'"
            );
        });
    }

    #[instrument(
        name = "test_ingest",
        skip_all,
        fields(
            context = "runtime",
            resource_type = "ingest_api",
            resource_name = %table_name,
        )
    )]
    fn instrumented_function(table_name: &str) {
        tracing::info!("test log event");
    }
}
