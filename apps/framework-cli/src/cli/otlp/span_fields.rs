//! Span field storage layer.
//!
//! Captures span fields from `#[instrument(fields(...))]` and stores them
//! in span Extensions for later retrieval by the capture layer.
//!
//! Optimized for cheap cloning:
//! - Keys use `Cow<'static, str>` to avoid allocation for known field names
//! - Values use `StringValue::from(&'static str)` for static values (zero-copy clone)
//! - Dynamic values (e.g., resource_name) still allocate but are typically short

use std::borrow::Cow;
use std::collections::BTreeMap;

use opentelemetry::logs::AnyValue;
use opentelemetry::StringValue;
use tracing::field::{Field, Visit};
use tracing::span;
use tracing::Subscriber;
use tracing_subscriber::layer::Context;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::Layer;

/// Stores span fields for retrieval by the OTLP log layer.
///
/// Uses `Cow<'static, str>` keys for cheap cloning of known field names.
/// No Mutex needed - tracing's Extensions API handles synchronization internally.
#[derive(Clone, Default)]
pub struct SpanFields(BTreeMap<Cow<'static, str>, AnyValue>);

impl SpanFields {
    /// Insert a field with a static key (zero-copy on clone).
    pub(crate) fn insert_static(&mut self, key: &'static str, value: AnyValue) {
        self.0.insert(Cow::Borrowed(key), value);
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &AnyValue)> {
        self.0.iter().map(|(k, v)| (k.as_ref(), v))
    }
}

/// Layer that captures span fields and stores them in Extensions.
///
/// Must be added to the subscriber stack before any layer that needs
/// to read span fields (e.g., SpanFieldCaptureLayer).
pub struct SpanFieldStorageLayer;

impl<S> Layer<S> for SpanFieldStorageLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attrs: &span::Attributes<'_>, id: &span::Id, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id) {
            let mut fields = SpanFields::default();
            attrs.record(&mut SpanFieldVisitor(&mut fields));
            span.extensions_mut().insert(fields);
        }
    }

    fn on_record(&self, id: &span::Id, values: &span::Record<'_>, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id) {
            if let Some(fields) = span.extensions_mut().get_mut::<SpanFields>() {
                values.record(&mut SpanFieldVisitor(fields));
            }
        }
    }
}

/// Visitor that converts tracing fields to OTLP AnyValue.
///
/// Uses static field names where possible for cheap cloning.
struct SpanFieldVisitor<'a>(&'a mut SpanFields);

impl SpanFieldVisitor<'_> {
    /// Get static key reference for known field names, avoiding allocation.
    fn static_key(name: &str) -> Option<&'static str> {
        match name {
            "context" => Some("context"),
            "resource_type" => Some("resource_type"),
            "resource_name" => Some("resource_name"),
            _ => None,
        }
    }
}

impl Visit for SpanFieldVisitor<'_> {
    fn record_str(&mut self, field: &Field, value: &str) {
        // Use static key if available
        if let Some(key) = Self::static_key(field.name()) {
            let any_value = AnyValue::String(StringValue::from(value.to_owned()));
            self.0.insert_static(key, any_value);
        }
        // Ignore unknown fields - we only care about our structured logging fields
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        if let Some(key) = Self::static_key(field.name()) {
            self.0.insert_static(key, AnyValue::Int(value));
        }
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        if let Some(key) = Self::static_key(field.name()) {
            self.0.insert_static(key, AnyValue::Boolean(value));
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if let Some(key) = Self::static_key(field.name()) {
            self.0
                .insert_static(key, AnyValue::String(format!("{:?}", value).into()));
        }
    }
}
