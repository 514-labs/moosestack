//! Fixture loading functionality.

use super::schema::{FixtureError, FixtureFile};
use reqwest::Client;
use std::path::Path;
use std::time::Duration;

/// Load a fixture file into a running Moose instance.
///
/// # Arguments
/// * `fixture_path` - Path to the fixture JSON file
/// * `port` - Port of the Moose instance
/// * `wait` - Whether to wait for data to be queryable after loading
/// * `timeout_ms` - Timeout for wait mode in milliseconds
///
/// # Returns
/// * `Ok(())` on success
/// * `Err(FixtureError)` on failure
pub async fn load_fixture(
    fixture_path: &Path,
    port: u16,
    wait: bool,
    timeout_ms: u64,
) -> Result<LoadResult, FixtureError> {
    let fixture = FixtureFile::from_path(fixture_path)?;

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| FixtureError::HttpError(e.to_string()))?;

    let mut records_loaded = 0;

    // Load each data set
    for data in &fixture.data {
        let target = if data.target.starts_with("ingest/") {
            data.target.clone()
        } else {
            format!("ingest/{}", data.target)
        };

        let url = format!("http://localhost:{}/{}", port, target);

        for record in &data.records {
            let response = client.post(&url).json(record).send().await.map_err(|e| {
                FixtureError::LoadError {
                    target: target.clone(),
                    message: e.to_string(),
                }
            })?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(FixtureError::LoadError {
                    target: target.clone(),
                    message: format!("HTTP {}: {}", status, body),
                });
            }

            records_loaded += 1;
        }
    }

    // Wait for data to be queryable if requested
    if wait {
        let ready_url = format!(
            "http://localhost:{}/ready?detailed=true&wait=true&timeout={}",
            port, timeout_ms
        );

        let response = client
            .get(&ready_url)
            .send()
            .await
            .map_err(|e| FixtureError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(FixtureError::HttpError(format!(
                "Ready endpoint returned HTTP {}: {}",
                status, body
            )));
        }
    }

    // Verify if specified
    let verification_result = fixture.verify.as_ref().map(|verify| {
        // Query ClickHouse directly via Moose's consumption API or direct CH access
        // For now, we'll use a simple approach - the actual verification would
        // require knowing the ClickHouse port and database name
        VerificationPending {
            table: verify.table.clone(),
            expected_min_rows: verify.min_rows,
        }
    });

    Ok(LoadResult {
        fixture_name: fixture.name,
        records_loaded,
        verification: verification_result,
    })
}

/// Result of loading a fixture.
#[derive(Debug)]
pub struct LoadResult {
    /// Name of the fixture that was loaded
    pub fixture_name: String,
    /// Number of records loaded
    pub records_loaded: usize,
    /// Verification status (if verification was configured)
    pub verification: Option<VerificationPending>,
}

/// Indicates verification was requested but needs to be checked.
#[derive(Debug)]
pub struct VerificationPending {
    /// Table to verify
    pub table: String,
    /// Expected minimum row count
    pub expected_min_rows: u64,
}
