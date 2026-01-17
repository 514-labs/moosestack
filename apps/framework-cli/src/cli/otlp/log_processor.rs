//! Custom LogProcessor that injects span fields into LogRecords.

use opentelemetry::logs::LogRecord as _;
use opentelemetry::Key;
use opentelemetry_sdk::logs::{LogProcessor, SdkLogRecord};
use opentelemetry_sdk::Resource;

use super::capture_layer::CURRENT_SPAN_FIELDS;

/// LogProcessor that reads span fields from thread-local and injects them
/// into LogRecords as attributes.
///
/// Wraps an inner processor (typically BatchLogProcessor) and enriches
/// records before forwarding them.
#[derive(Debug)]
pub struct SpanFieldInjectingProcessor<P> {
    inner: P,
}

impl<P> SpanFieldInjectingProcessor<P> {
    pub fn new(inner: P) -> Self {
        Self { inner }
    }
}

impl<P: LogProcessor> LogProcessor for SpanFieldInjectingProcessor<P> {
    fn emit(&self, record: &mut SdkLogRecord, scope: &opentelemetry::InstrumentationScope) {
        // Read span fields from thread-local and add as attributes
        CURRENT_SPAN_FIELDS.with(|fields| {
            for (key, value) in fields.borrow().iter() {
                // Convert Cow key to Key (static keys avoid allocation)
                let otel_key = match key.as_ref() {
                    "context" => Key::from_static_str("context"),
                    "resource_type" => Key::from_static_str("resource_type"),
                    "resource_name" => Key::from_static_str("resource_name"),
                    other => {
                        // Fallback for unknown keys (allocates)
                        record.add_attribute(Key::new(other.to_owned()), value.clone());
                        continue;
                    }
                };
                record.add_attribute(otel_key, value.clone());
            }
        });

        self.inner.emit(record, scope);
    }

    fn force_flush(&self) -> opentelemetry_sdk::error::OTelSdkResult {
        self.inner.force_flush()
    }

    fn shutdown(&self) -> opentelemetry_sdk::error::OTelSdkResult {
        self.inner.shutdown()
    }

    fn set_resource(&mut self, resource: &Resource) {
        self.inner.set_resource(resource);
    }
}
