//! ClickHouse Dictionary — re-exports from the infra-agnostic core module.
//!
//! All struct/enum definitions and their impl blocks live in
//! `framework::core::infrastructure::dictionary`. This shim re-exports everything
//! so that existing callers using the `infrastructure::olap::clickhouse::dictionary`
//! path continue to work without changes.

pub use crate::framework::core::infrastructure::dictionary::*;
