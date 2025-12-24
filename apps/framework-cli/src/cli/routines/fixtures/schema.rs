//! Fixture file schema types for E2E test data loading.
//!
//! Fixtures are JSON files that define test data to be loaded into a Moose instance
//! via ingestion endpoints. They support optional verification to ensure data has
//! been properly processed.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A fixture file containing test data to load into Moose.
///
/// # Example JSON
/// ```json
/// {
///   "name": "basic-foo-bar",
///   "description": "Basic Foo records for ingestion testing",
///   "data": [
///     {
///       "target": "Foo",
///       "records": [
///         {"primaryKey": "test-1", "timestamp": "2024-01-01T00:00:00Z"},
///         {"primaryKey": "test-2", "timestamp": "2024-01-01T00:01:00Z"}
///       ]
///     }
///   ],
///   "verify": {
///     "table": "Bar",
///     "minRows": 2
///   }
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureFile {
    /// Name of the fixture for identification
    pub name: String,

    /// Optional description
    #[serde(default)]
    pub description: Option<String>,

    /// Data to load
    pub data: Vec<FixtureData>,

    /// Optional verification after load
    #[serde(default)]
    pub verify: Option<FixtureVerification>,
}

/// A single data set to load into a specific ingestion endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureData {
    /// Target ingestion endpoint (e.g., "Foo" or "ingest/Foo")
    pub target: String,

    /// Records to insert - each record is a JSON object matching the data model
    pub records: Vec<serde_json::Value>,
}

/// Verification configuration to ensure data was properly loaded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureVerification {
    /// Table to verify row count
    pub table: String,

    /// Minimum expected row count after loading
    #[serde(rename = "minRows")]
    pub min_rows: u64,
}

/// Errors that can occur when loading fixtures.
#[derive(Debug, thiserror::Error)]
pub enum FixtureError {
    #[error("failed to read fixture file `{path}`: {source}")]
    IoError {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to parse fixture file `{path}`: {source}")]
    ParseError {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("failed to load fixture data to `{target}`: {message}")]
    LoadError { target: String, message: String },

    #[error(
        "fixture verification failed: expected at least {expected} rows in `{table}`, found {actual}"
    )]
    #[allow(dead_code)] // Will be used when verification is fully implemented
    VerificationFailed {
        table: String,
        expected: u64,
        actual: u64,
    },

    #[error("HTTP request failed: {0}")]
    HttpError(String),
}

impl FixtureFile {
    /// Load a fixture from a JSON file.
    pub fn from_path(path: &std::path::Path) -> Result<Self, FixtureError> {
        let content = std::fs::read_to_string(path).map_err(|e| FixtureError::IoError {
            path: path.to_path_buf(),
            source: e,
        })?;

        serde_json::from_str(&content).map_err(|e| FixtureError::ParseError {
            path: path.to_path_buf(),
            source: e,
        })
    }

    /// Total number of records across all data sets.
    #[allow(dead_code)] // Will be used by tests and future features
    pub fn total_records(&self) -> usize {
        self.data.iter().map(|d| d.records.len()).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_fixture() {
        let json = r#"{
            "name": "test-fixture",
            "description": "A test fixture",
            "data": [
                {
                    "target": "Foo",
                    "records": [
                        {"id": "1", "value": "hello"},
                        {"id": "2", "value": "world"}
                    ]
                }
            ],
            "verify": {
                "table": "Foo",
                "minRows": 2
            }
        }"#;

        let fixture: FixtureFile = serde_json::from_str(json).unwrap();

        assert_eq!(fixture.name, "test-fixture");
        assert_eq!(fixture.description, Some("A test fixture".to_string()));
        assert_eq!(fixture.data.len(), 1);
        assert_eq!(fixture.data[0].target, "Foo");
        assert_eq!(fixture.data[0].records.len(), 2);
        assert_eq!(fixture.total_records(), 2);

        let verify = fixture.verify.unwrap();
        assert_eq!(verify.table, "Foo");
        assert_eq!(verify.min_rows, 2);
    }

    #[test]
    fn test_parse_fixture_minimal() {
        let json = r#"{
            "name": "minimal",
            "data": []
        }"#;

        let fixture: FixtureFile = serde_json::from_str(json).unwrap();

        assert_eq!(fixture.name, "minimal");
        assert!(fixture.description.is_none());
        assert!(fixture.data.is_empty());
        assert!(fixture.verify.is_none());
    }
}
