//! # ClickHouse Diagnostics Module
//!
//! This module provides reusable diagnostic capabilities for ClickHouse infrastructure.
//! It defines a provider-based architecture where each diagnostic check is implemented
//! as a separate provider that can be run independently or orchestrated together.
//!
//! ## Architecture
//!
//! Three-layer design:
//! 1. **Provider Layer** - Individual diagnostics with testable parsing logic
//! 2. **Orchestration Layer** - Running diagnostics with common request/filter structs
//! 3. **Consumer Layer** - Tools (MCP, CLI) that translate inputs to DiagnosticRequest
//!
//! ## Diagnostic Providers
//!
//! ### 1. MutationDiagnostic
//! Detects stuck or failing mutations (ALTER operations).
//! - **Source**: `system.mutations`
//! - **Thresholds**: Error (has failure reason), Warning (not done)
//!
//! ### 2. PartsDiagnostic
//! Identifies excessive data parts per partition.
//! - **Source**: `system.parts`
//! - **Thresholds**: Error (>300 parts), Warning (>100 parts)
//!
//! ### 3. MergeDiagnostic
//! Monitors long-running background merges.
//! - **Source**: `system.merges`
//! - **Thresholds**: Error (>1800s), Warning (>300s)
//!
//! ### 4. ErrorStatsDiagnostic
//! Aggregates errors from ClickHouse system.errors.
//! - **Source**: `system.errors`
//! - **Thresholds**: Error (>100), Warning (>10), Info (>0)
//!
//! ### 5. S3QueueDiagnostic (S3Queue tables only)
//! Detects S3Queue ingestion failures.
//! - **Source**: `system.s3queue_log`
//! - **Thresholds**: Error (any failed entries)
//!
//! ### 6. ReplicationDiagnostic (Replicated* tables only)
//! Monitors replication health and queue backlogs.
//! - **Sources**: `system.replication_queue`, `system.replicas`
//! - **Thresholds**: Error (queue>50, tries>10), Warning (queue>10, tries>3)
//!
//! ### 7. MergeFailureDiagnostic
//! Detects system-wide background merge failures.
//! - **Source**: `system.metrics`
//! - **Thresholds**: Error (>10 failures), Warning (>0 failures)
//!
//! ### 8. StoppedOperationsDiagnostic
//! Identifies manually stopped operations.
//! - **Sources**: `system.parts`, `system.merges`, `system.replicas`
//! - **Thresholds**: Error (stopped replication), Warning (stopped merges)

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

// Module declarations for diagnostic providers
mod errors;
mod merge_failures;
mod merges;
mod mutations;
mod parts;
mod replication;
mod s3queue;
mod stopped_operations;

// Re-export diagnostic providers
pub use errors::ErrorStatsDiagnostic;
pub use merge_failures::MergeFailureDiagnostic;
pub use merges::MergeDiagnostic;
pub use mutations::MutationDiagnostic;
pub use parts::PartsDiagnostic;
pub use replication::ReplicationDiagnostic;
pub use s3queue::S3QueueDiagnostic;
pub use stopped_operations::StoppedOperationsDiagnostic;

/// Error types for diagnostic operations
#[derive(Debug, thiserror::Error)]
pub enum DiagnosticError {
    #[error("Failed to connect to ClickHouse: {0}")]
    ConnectionFailed(String),

    #[error("Failed to execute diagnostic query: {0}")]
    QueryFailed(String),

    #[error("Query timeout after {0} seconds")]
    QueryTimeout(u64),

    #[error("Failed to parse query result: {0}")]
    ParseError(String),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

/// Severity level for issues
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

impl Severity {
    /// Check if this severity should include issues of the given level
    pub fn includes(&self, other: &Severity) -> bool {
        match self {
            Severity::Info => true, // Info includes all severities
            Severity::Warning => matches!(other, Severity::Warning | Severity::Error),
            Severity::Error => matches!(other, Severity::Error),
        }
    }
}

/// Component information for issue context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Component {
    pub component_type: String,
    pub name: String,
    /// Flexible metadata for component-specific context (e.g., database, namespace, cluster)
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, String>,
}

/// Detailed information about an infrastructure issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub severity: Severity,
    pub source: String,
    pub component: Component,
    pub error_type: String,
    pub message: String,
    pub details: Map<String, Value>,
    pub suggested_action: String,
    pub related_queries: Vec<String>,
}

/// Options for filtering and configuring diagnostic runs
#[derive(Debug, Clone)]
pub struct DiagnosticOptions {
    /// Specific diagnostic names to run (empty = run all applicable diagnostics)
    pub diagnostic_names: Vec<String>,
    /// Minimum severity level to report (filters results)
    pub min_severity: Severity,
    /// Optional time filter (e.g., "-1h" for last hour)
    pub since: Option<String>,
}

impl Default for DiagnosticOptions {
    fn default() -> Self {
        Self {
            diagnostic_names: Vec::new(),
            min_severity: Severity::Info,
            since: None,
        }
    }
}

/// Request to run diagnostics on components
#[derive(Debug, Clone)]
pub struct DiagnosticRequest {
    /// Components to diagnose (tables, views, etc.)
    pub components: Vec<(Component, Option<ClickhouseEngine>)>,
    /// Diagnostic options for filtering and configuration
    pub options: DiagnosticOptions,
}

/// Summary statistics for diagnostic results
#[derive(Debug, Serialize, Deserialize)]
pub struct IssueSummary {
    pub total_issues: usize,
    pub by_severity: HashMap<String, usize>,
    pub by_component: HashMap<String, usize>,
}

/// Infrastructure type for diagnostic context
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InfrastructureType {
    ClickHouse,
}

/// Complete diagnostic output
#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticOutput {
    pub infrastructure_type: InfrastructureType,
    pub issues: Vec<Issue>,
    pub summary: IssueSummary,
}

impl DiagnosticOutput {
    /// Create a new diagnostic output and compute summary statistics
    pub fn new(infrastructure_type: InfrastructureType, issues: Vec<Issue>) -> Self {
        let mut by_severity = HashMap::new();
        let mut by_component = HashMap::new();

        for issue in &issues {
            let severity_key = format!("{:?}", issue.severity).to_lowercase();
            *by_severity.entry(severity_key).or_insert(0) += 1;

            let component_key = issue.component.name.clone();
            *by_component.entry(component_key).or_insert(0) += 1;
        }

        let summary = IssueSummary {
            total_issues: issues.len(),
            by_severity,
            by_component,
        };

        Self {
            infrastructure_type,
            issues,
            summary,
        }
    }
}

/// Trait for ClickHouse diagnostic providers
///
/// Each provider implements checks for a specific aspect of ClickHouse infrastructure health.
/// Providers can be system-wide (run once) or component-specific (run per table/component).
#[async_trait::async_trait]
pub trait DiagnosticProvider: Send + Sync {
    /// Name of this diagnostic provider
    fn name(&self) -> &str;

    /// Check if this provider is applicable to the given component
    fn applicable_to(&self, component: &Component, engine: Option<&ClickhouseEngine>) -> bool;

    /// Check if this provider is system-wide (not component-specific)
    /// System-wide providers are run once, not per-component
    fn is_system_wide(&self) -> bool {
        false
    }

    /// Run diagnostics and return list of issues found
    async fn diagnose(
        &self,
        component: &Component,
        engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnosticError>;
}

/// Create all available diagnostic providers
///
/// Returns a vector containing instances of all diagnostic providers.
/// These can be filtered by name or applicability before running.
pub fn create_all_providers() -> Vec<Box<dyn DiagnosticProvider>> {
    vec![
        Box::new(MutationDiagnostic),
        Box::new(PartsDiagnostic),
        Box::new(MergeDiagnostic),
        Box::new(ErrorStatsDiagnostic),
        Box::new(S3QueueDiagnostic),
        Box::new(ReplicationDiagnostic),
        Box::new(MergeFailureDiagnostic),
        Box::new(StoppedOperationsDiagnostic),
    ]
}

/// Get a specific diagnostic provider by name
///
/// # Arguments
/// * `name` - The name of the provider to retrieve
///
/// # Returns
/// Some(provider) if found, None otherwise
pub fn get_provider(name: &str) -> Option<Box<dyn DiagnosticProvider>> {
    create_all_providers()
        .into_iter()
        .find(|p| p.name() == name)
}

/// Run diagnostics on the provided components
///
/// This is the main orchestration function that:
/// 1. Filters providers by diagnostic_names (empty = run all applicable)
/// 2. Separates system-wide vs component-specific providers
/// 3. Runs system-wide providers once
/// 4. Runs component-specific providers for each applicable component
/// 5. Filters results by minimum severity
/// 6. Returns aggregated results
///
/// # Arguments
/// * `request` - The diagnostic request containing components and options
/// * `config` - ClickHouse configuration for database connection
///
/// # Returns
/// DiagnosticOutput with all issues found, filtered by severity
pub async fn run_diagnostics(
    request: DiagnosticRequest,
    config: &ClickHouseConfig,
) -> Result<DiagnosticOutput, DiagnosticError> {
    let all_providers = create_all_providers();

    // Filter providers by requested diagnostic names (empty = all)
    let providers: Vec<Box<dyn DiagnosticProvider>> = if request.options.diagnostic_names.is_empty()
    {
        all_providers
    } else {
        all_providers
            .into_iter()
            .filter(|p| {
                request
                    .options
                    .diagnostic_names
                    .contains(&p.name().to_string())
            })
            .collect()
    };

    // Separate system-wide from component-specific providers
    let (system_wide, component_specific): (Vec<_>, Vec<_>) =
        providers.into_iter().partition(|p| p.is_system_wide());

    let mut all_issues = Vec::new();

    // Run system-wide providers once (use first component for context)
    if let Some((first_component, _)) = request.components.first() {
        for provider in system_wide {
            match provider
                .diagnose(
                    first_component,
                    None,
                    config,
                    request.options.since.as_deref(),
                )
                .await
            {
                Ok(issues) => all_issues.extend(issues),
                Err(e) => {
                    // Log error but continue with other providers
                    log::warn!("System-wide provider {} failed: {}", provider.name(), e);
                }
            }
        }
    }

    // Run component-specific providers for each component
    for (component, engine) in &request.components {
        for provider in &component_specific {
            // Check if provider is applicable to this component
            if !provider.applicable_to(component, engine.as_ref()) {
                continue;
            }

            match provider
                .diagnose(
                    component,
                    engine.as_ref(),
                    config,
                    request.options.since.as_deref(),
                )
                .await
            {
                Ok(issues) => all_issues.extend(issues),
                Err(e) => {
                    // Log error but continue with other providers
                    log::warn!(
                        "Provider {} failed for component {}: {}",
                        provider.name(),
                        component.name,
                        e
                    );
                }
            }
        }
    }

    // Filter issues by minimum severity
    let filtered_issues: Vec<Issue> = all_issues
        .into_iter()
        .filter(|issue| request.options.min_severity.includes(&issue.severity))
        .collect();

    Ok(DiagnosticOutput::new(
        InfrastructureType::ClickHouse,
        filtered_issues,
    ))
}
