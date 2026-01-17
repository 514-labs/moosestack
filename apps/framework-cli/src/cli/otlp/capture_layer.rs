//! Span field capture layer.
//!
//! Captures span fields into thread-local storage on each event,
//! making them available to the LogProcessor.

use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::BTreeMap;

use opentelemetry::logs::AnyValue;
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::Layer;

use super::span_fields::SpanFields;

thread_local! {
    /// Thread-local storage for span fields captured during event processing.
    /// Read by SpanFieldInjectingProcessor to enrich LogRecords.
    ///
    /// Uses `Cow<'static, str>` keys for cheap cloning from SpanFields.
    pub(crate) static CURRENT_SPAN_FIELDS: RefCell<BTreeMap<Cow<'static, str>, AnyValue>> =
        const { RefCell::new(BTreeMap::new()) };
}

/// Layer that captures span fields into thread-local before events are processed.
///
/// Must be placed BEFORE OpenTelemetryTracingBridge in the layer stack so that
/// fields are available when the bridge creates the LogRecord.
pub struct SpanFieldCaptureLayer;

impl<S> Layer<S> for SpanFieldCaptureLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        CURRENT_SPAN_FIELDS.with(|f| {
            let mut fields = f.borrow_mut();
            fields.clear();

            // Walk scope from root to leaf, leaf wins on collision
            if let Some(scope) = ctx.event_scope(event) {
                for span in scope.from_root() {
                    if let Some(span_fields) = span.extensions().get::<SpanFields>() {
                        // Clone the SpanFields (cheap due to Cow keys)
                        // and merge into our map
                        for (k, v) in span_fields.iter() {
                            // Re-borrow as static since we know these are our static keys
                            let key = match k {
                                "context" => Cow::Borrowed("context"),
                                "resource_type" => Cow::Borrowed("resource_type"),
                                "resource_name" => Cow::Borrowed("resource_name"),
                                other => Cow::Owned(other.to_owned()),
                            };
                            fields.insert(key, v.clone());
                        }
                    }
                }
            }
        });
    }
}
