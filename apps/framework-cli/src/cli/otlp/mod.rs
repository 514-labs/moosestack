//! OTLP log export with span field injection.
//!
//! This module provides OTLP log export that enriches log records with
//! span fields (context, resource_type, resource_name) from the current
//! tracing span scope.

mod capture_layer;
mod log_processor;
mod setup;
mod span_fields;

pub use setup::{setup_otlp_logs, shutdown_otlp, OtlpLogSettings};
