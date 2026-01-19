//! OTLP log export with span field injection.
//!
//! This module provides OTLP log export that enriches log records with
//! span fields (context, resource_type, resource_name) from the current
//! tracing span scope using the experimental_span_attributes feature.

mod setup;

pub use setup::{setup_otlp_logs, shutdown_otlp, OtlpLogSettings};
