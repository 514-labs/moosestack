//! # Doctor Routine
//!
//! Diagnostic routine for infrastructure health checking. This command surfaces
//! errors and issues in ClickHouse, Redis, and other infrastructure components.
//!
//! ## Features
//! - Proactive diagnostics using infrastructure map
//! - Configurable severity filtering (error, warning, info)
//! - Component filtering with glob patterns
//! - Time-based filtering (e.g., "6 hours", "1 day")
//! - Multiple output formats (human-readable, JSON)
//! - Verbosity control for detailed metadata

use std::collections::HashMap;
use std::sync::Arc;

use log::{debug, info};

use crate::cli::display::Message;
use crate::cli::routines::{setup_redis_client, RoutineFailure, RoutineSuccess};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::config::parse_clickhouse_connection_string;
use crate::infrastructure::olap::clickhouse::diagnostics::{
    Component, DiagnosticOptions, DiagnosticOutput, DiagnosticRequest, Severity,
};
use crate::project::Project;

/// Error types for doctor routine operations
#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum DoctorError {
    #[error("Failed to parse severity '{0}': must be one of: error, warning, info")]
    InvalidSeverity(String),

    #[error("Failed to parse time duration '{0}': {1}")]
    InvalidDuration(String, String),

    #[error("Failed to load infrastructure map: {0}")]
    InfraMapLoad(String),

    #[error("Failed to parse ClickHouse connection string: {0}")]
    ClickHouseConfig(String),

    #[error("Failed to setup Redis client: {0}")]
    RedisClient(String),

    #[error("Failed to run diagnostics: {0}")]
    DiagnosticFailed(String),

    #[error("Failed to compile glob pattern '{pattern}': {error}")]
    InvalidGlob { pattern: String, error: String },
}

/// Parse severity string into Severity enum
fn parse_severity(severity_str: &str) -> Result<Severity, DoctorError> {
    match severity_str.to_lowercase().as_str() {
        "error" => Ok(Severity::Error),
        "warning" => Ok(Severity::Warning),
        "info" => Ok(Severity::Info),
        _ => Err(DoctorError::InvalidSeverity(severity_str.to_string())),
    }
}

/// Parse humantime duration string into ClickHouse interval format
/// Examples: "6 hours" -> "-6h", "1 day" -> "-1d", "30m" -> "-30m"
fn parse_since(since_str: &str) -> Result<String, DoctorError> {
    // Try to parse with humantime crate
    let duration = humantime::parse_duration(since_str)
        .map_err(|e| DoctorError::InvalidDuration(since_str.to_string(), e.to_string()))?;

    // Convert to ClickHouse interval format (negative for relative to now)
    let total_seconds = duration.as_secs();

    // Choose appropriate unit for readability
    if total_seconds % 3600 == 0 {
        let hours = total_seconds / 3600;
        Ok(format!("-{}h", hours))
    } else if total_seconds % 60 == 0 {
        let minutes = total_seconds / 60;
        Ok(format!("-{}m", minutes))
    } else {
        Ok(format!("-{}s", total_seconds))
    }
}

/// Main doctor routine entry point
#[allow(clippy::too_many_arguments)]
pub async fn diagnose_infrastructure(
    project: Arc<Project>,
    severity_str: String,
    component_pattern: Option<String>,
    since_str: String,
    json_output: bool,
    verbosity: u8,
    clickhouse_url: Option<String>,
    redis_url: Option<String>,
) -> Result<RoutineSuccess, RoutineFailure> {
    info!("Starting infrastructure diagnostics");

    // Parse severity
    let severity = parse_severity(&severity_str).map_err(|e| {
        RoutineFailure::error(Message {
            action: "Doctor".to_string(),
            details: e.to_string(),
        })
    })?;

    // Parse since duration
    let since = parse_since(&since_str).map_err(|e| {
        RoutineFailure::error(Message {
            action: "Doctor".to_string(),
            details: e.to_string(),
        })
    })?;

    debug!("Parsed severity: {:?}, since: {}", severity, since);

    // Setup Redis client
    let redis_client = if let Some(ref url) = redis_url {
        // TODO: Create redis client from custom URL
        // For now, fall back to project config
        debug!("Custom Redis URL provided: {}", url);
        setup_redis_client(project.clone()).await.map_err(|e| {
            RoutineFailure::error(Message {
                action: "Doctor".to_string(),
                details: format!("Failed to setup redis client: {:?}", e),
            })
        })?
    } else {
        setup_redis_client(project.clone()).await.map_err(|e| {
            RoutineFailure::error(Message {
                action: "Doctor".to_string(),
                details: format!("Failed to setup redis client: {:?}", e),
            })
        })?
    };

    // Setup ClickHouse config
    let clickhouse_config = if let Some(ref url) = clickhouse_url {
        debug!("Using custom ClickHouse URL");
        parse_clickhouse_connection_string(url).map_err(|e| {
            RoutineFailure::error(Message {
                action: "Doctor".to_string(),
                details: format!("Failed to parse ClickHouse connection string: {:?}", e),
            })
        })?
    } else {
        debug!("Using project ClickHouse config");
        project.clickhouse_config.clone()
    };

    // Load infrastructure map
    debug!("Loading infrastructure map from Redis");
    let infra_map = InfrastructureMap::load_from_redis(&redis_client)
        .await
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Doctor".to_string(),
                details: format!("Failed to load infrastructure map: {:?}", e),
            })
        })?
        .ok_or_else(|| {
            RoutineFailure::error(Message {
                action: "Doctor".to_string(),
                details: "No infrastructure map found. The dev server may not be running."
                    .to_string(),
            })
        })?;

    // Filter tables based on component pattern
    let tables_to_check: Vec<_> = if let Some(ref pattern) = component_pattern {
        debug!("Filtering tables with pattern: {}", pattern);
        infra_map
            .tables
            .iter()
            .filter(|(_map_key, table)| {
                // Use glob matching
                let glob_pattern =
                    glob::Pattern::new(pattern).map_err(|e| DoctorError::InvalidGlob {
                        pattern: pattern.clone(),
                        error: e.to_string(),
                    });

                match glob_pattern {
                    Ok(glob) => glob.matches(&table.name),
                    Err(_) => false,
                }
            })
            .collect()
    } else {
        infra_map.tables.iter().collect()
    };

    info!("Checking {} tables for issues", tables_to_check.len());

    // Build diagnostic request with components from infrastructure map
    let components: Vec<_> = tables_to_check
        .iter()
        .map(|(_map_key, table)| {
            let mut metadata = HashMap::new();
            metadata.insert("database".to_string(), clickhouse_config.db_name.clone());

            let component = Component {
                component_type: "table".to_string(),
                name: table.name.clone(),
                metadata,
            };

            (component, table.engine.clone())
        })
        .collect();

    let request = DiagnosticRequest {
        components,
        options: DiagnosticOptions {
            diagnostic_names: Vec::new(), // Run all diagnostics
            min_severity: severity,
            since: Some(since),
        },
    };

    // Run diagnostics
    let output = crate::infrastructure::olap::clickhouse::diagnostics::run_diagnostics(
        request,
        &clickhouse_config,
    )
    .await
    .map_err(|e| {
        RoutineFailure::error(Message {
            action: "Doctor".to_string(),
            details: format!("Diagnostics failed: {}", e),
        })
    })?;

    info!(
        "Infrastructure diagnostics complete. Found {} issues.",
        output.issues.len()
    );

    // Format and display output
    if json_output {
        format_json_output(&output)
    } else {
        format_human_readable_output(&output, verbosity, &infra_map)
    }
}

/// Format output as JSON
fn format_json_output(output: &DiagnosticOutput) -> Result<RoutineSuccess, RoutineFailure> {
    let json_str = serde_json::to_string_pretty(output).map_err(|e| {
        RoutineFailure::error(Message {
            action: "Doctor".to_string(),
            details: format!("Failed to format output as JSON: {}", e),
        })
    })?;

    Ok(RoutineSuccess::highlight(Message {
        action: "Doctor".to_string(),
        details: json_str,
    }))
}

/// Format output as human-readable text
fn format_human_readable_output(
    output: &DiagnosticOutput,
    verbosity: u8,
    _infra_map: &InfrastructureMap,
) -> Result<RoutineSuccess, RoutineFailure> {
    let mut result = String::new();

    // Show each issue
    for issue in &output.issues {
        result.push_str("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        result.push_str(&format!("{:?}: {}\n", issue.severity, issue.source));
        result.push_str(&format!("Component: {}\n", issue.component.name));
        result.push_str(&format!("Message: {}\n", issue.message));

        if !issue.suggested_action.is_empty() {
            result.push_str(&format!("Suggested Action: {}\n", issue.suggested_action));
        }

        // Show details based on verbosity
        if verbosity >= 1 {
            // -v: Add component metadata
            if !issue.component.metadata.is_empty() {
                result.push_str("Metadata:\n");
                for (key, value) in &issue.component.metadata {
                    result.push_str(&format!("  {}: {}\n", key, value));
                }
            }
        }

        if verbosity >= 3 {
            // -vvv: Add all details
            if !issue.details.is_empty() {
                result.push_str("Details:\n");
                for (key, value) in &issue.details {
                    result.push_str(&format!("  {}: {}\n", key, value));
                }
            }
        }

        result.push_str("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");
    }

    // Show summary
    let error_count = output.summary.by_severity.get("Error").unwrap_or(&0);
    let warning_count = output.summary.by_severity.get("Warning").unwrap_or(&0);
    let info_count = output.summary.by_severity.get("Info").unwrap_or(&0);

    result.push_str(&format!(
        "Summary: {} errors, {} warnings, {} info messages\n",
        error_count, warning_count, info_count
    ));

    // Show breakdown by component (verbosity >= 2)
    if verbosity >= 2 && !output.summary.by_component.is_empty() {
        result.push_str("\nIssues by component:\n");
        for (component, count) in &output.summary.by_component {
            result.push_str(&format!("  - {}: {} issue(s)\n", component, count));
        }
    }

    Ok(RoutineSuccess::highlight(Message {
        action: "Doctor".to_string(),
        details: result,
    }))
}
