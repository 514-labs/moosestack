//! OTLP log export setup and lifecycle management.

use std::sync::OnceLock;

use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::logs::{BatchLogProcessor, SdkLoggerProvider};
use tracing::error;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

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
/// Uses the experimental_span_attributes feature to automatically capture
/// span fields and add them as attributes to log records.
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
        error!("OTLP log provider already initialized");
        return;
    }

    let otel_bridge = OpenTelemetryTracingBridge::new(&log_provider);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&settings.level_filter));

    // The OpenTelemetryTracingBridge with experimental_span_attributes enabled
    // automatically captures span fields and adds them as log record attributes.
    // Layer order: env_filter first to filter events before they reach the bridge.
    tracing_subscriber::registry()
        .with(env_filter)
        .with(otel_bridge)
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
    use tracing::instrument;

    /// Test that instrumented functions work with OTLP setup (compilation test).
    ///
    /// This verifies that the experimental_span_attributes feature doesn't break
    /// instrumented functions. Actual OTLP export with span attributes should be
    /// tested manually or via E2E tests with a real OTLP collector.
    #[test]
    fn test_instrumented_function_compiles() {
        // Just verify that instrumented functions compile and run
        instrumented_test_function("test_resource");
    }

    #[instrument(
        name = "test_operation",
        skip_all,
        fields(
            context = "runtime",
            resource_type = "test_api",
            resource_name = %resource,
        )
    )]
    fn instrumented_test_function(resource: &str) {
        // Function with span fields for testing instrumentation
        let _ = resource;
    }
}
