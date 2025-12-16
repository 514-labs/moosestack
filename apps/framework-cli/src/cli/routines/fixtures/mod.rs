//! Fixture loading for E2E tests.
//!
//! This module provides functionality to load test fixtures into a running Moose
//! instance via its ingestion endpoints.

pub mod schema;

// Re-exports for when the load command is implemented
#[allow(unused_imports)]
pub use schema::{FixtureData, FixtureError, FixtureFile, FixtureVerification};
