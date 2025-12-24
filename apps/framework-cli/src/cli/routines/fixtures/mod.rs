//! Fixture loading for E2E tests.
//!
//! This module provides functionality to load test fixtures into a running Moose
//! instance via its ingestion endpoints.

pub mod load;
pub mod schema;

pub use load::load_fixture;
// Re-export types for external use
#[allow(unused_imports)]
pub use load::LoadResult;
#[allow(unused_imports)]
pub use schema::{FixtureData, FixtureError, FixtureFile, FixtureVerification};
