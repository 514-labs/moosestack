//! SQL validation for Moose infrastructure.
//!
//! This module provides SQL syntax validation using sqlparser with ClickHouse dialect.
//! It's designed to be reusable by both the CLI and a future LSP.

pub mod sql_validation;
pub use sql_validation::*;
