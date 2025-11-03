use crate::{infrastructure::stream, project::Project};

use super::infrastructure_map::{OlapChange, TableChange};
use super::plan::InfraPlan;

#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("Some of the changes derived for the streaming engine are invalid")]
    StreamingChange(#[from] stream::StreamingChangesError),

    #[error("Table validation failed: {0}")]
    TableValidation(String),

    #[error("Cluster validation failed: {0}")]
    ClusterValidation(String),
}

/// Validates that all tables with cluster_name reference clusters defined in the config
fn validate_cluster_references(project: &Project, plan: &InfraPlan) -> Result<(), ValidationError> {
    let defined_clusters = project.clickhouse_config.clusters.as_ref();

    // Get all cluster names from the defined clusters
    let cluster_names: Option<Vec<String>> =
        defined_clusters.map(|clusters| clusters.iter().map(|c| c.name.clone()).collect());

    // Check all tables in the target infrastructure map
    for table in plan.target_infra_map.tables.values() {
        if let Some(cluster_name) = &table.cluster_name {
            // If table has a cluster_name, verify it's defined in the config
            match &cluster_names {
                None => {
                    // No clusters defined in config but table references one
                    return Err(ValidationError::ClusterValidation(format!(
                        "Table '{}' references cluster '{}', but no clusters are defined in moose.config.toml.\n\
                        \n\
                        To fix this, add the cluster definition to your config:\n\
                        \n\
                        [[clickhouse_config.clusters]]\n\
                        name = \"{}\"\n",
                        table.name, cluster_name, cluster_name
                    )));
                }
                Some(names) if !names.contains(cluster_name) => {
                    // Table references a cluster that's not defined
                    return Err(ValidationError::ClusterValidation(format!(
                        "Table '{}' references cluster '{}', which is not defined in moose.config.toml.\n\
                        \n\
                        Available clusters: {}\n\
                        \n\
                        To fix this, either:\n\
                        1. Add the cluster to your config:\n\
                           [[clickhouse_config.clusters]]\n\
                           name = \"{}\"\n\
                        \n\
                        2. Or change the table to use an existing cluster: {}\n",
                        table.name,
                        cluster_name,
                        names.join(", "),
                        cluster_name,
                        names.join(", ")
                    )));
                }
                _ => {
                    // Cluster is defined, continue validation
                }
            }
        }
    }

    Ok(())
}

pub fn validate(project: &Project, plan: &InfraPlan) -> Result<(), ValidationError> {
    stream::validate_changes(project, &plan.changes.streaming_engine_changes)?;

    // Validate cluster references
    validate_cluster_references(project, plan)?;

    // Check for validation errors in OLAP changes
    for change in &plan.changes.olap_changes {
        if let OlapChange::Table(TableChange::ValidationError { message, .. }) = change {
            return Err(ValidationError::TableValidation(message.clone()));
        }
    }

    Ok(())
}
