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
    let cluster_names: Vec<String> = defined_clusters
        .map(|clusters| clusters.iter().map(|c| c.name.clone()).collect())
        .unwrap_or_default();

    // Check all tables in the target infrastructure map
    for table in plan.target_infra_map.tables.values() {
        if let Some(cluster_name) = &table.cluster_name {
            // If table has a cluster_name, verify it's defined in the config
            if cluster_names.is_empty() {
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
            } else if !cluster_names.contains(cluster_name) {
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
                    cluster_names.join(", "),
                    cluster_name,
                    cluster_names.join(", ")
                )));
            }
            // Cluster is defined, continue validation
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy, Table};
    use crate::framework::core::infrastructure_map::{
        InfrastructureMap, PrimitiveSignature, PrimitiveTypes,
    };
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::framework::core::plan::InfraPlan;
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::{
        config::{ClickHouseConfig, ClusterConfig},
        queries::ClickhouseEngine,
    };
    use crate::project::{Project, ProjectFeatures};
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn create_test_project(clusters: Option<Vec<ClusterConfig>>) -> Project {
        Project {
            language: crate::framework::languages::SupportedLanguages::Typescript,
            redpanda_config: crate::infrastructure::stream::kafka::models::KafkaConfig::default(),
            clickhouse_config: ClickHouseConfig {
                db_name: "local".to_string(),
                user: "default".to_string(),
                password: "".to_string(),
                use_ssl: false,
                host: "localhost".to_string(),
                host_port: 18123,
                native_port: 9000,
                host_data_path: None,
                additional_databases: vec![],
                clusters,
            },
            http_server_config: crate::cli::local_webserver::LocalWebserverConfig::default(),
            redis_config: crate::infrastructure::redis::redis_client::RedisConfig::default(),
            git_config: crate::utilities::git::GitConfig::default(),
            temporal_config:
                crate::infrastructure::orchestration::temporal::TemporalConfig::default(),
            state_config: crate::project::StateConfig::default(),
            migration_config: crate::project::MigrationConfig::default(),
            language_project_config: crate::project::LanguageProjectConfig::default(),
            project_location: PathBuf::from("/test"),
            is_production: false,
            supported_old_versions: HashMap::new(),
            jwt: None,
            authentication: crate::project::AuthenticationConfig::default(),
            features: ProjectFeatures::default(),
            load_infra: None,
            typescript_config: crate::project::TypescriptConfig::default(),
            source_dir: crate::project::default_source_dir(),
        }
    }

    fn create_test_table(name: &str, cluster_name: Option<String>) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine: ClickhouseEngine::default(),
            version: Some(Version::from_string("1.0.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: name.to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name,
            primary_key_expression: None,
        }
    }

    fn create_test_plan(tables: Vec<Table>) -> InfraPlan {
        let mut table_map = HashMap::new();
        for table in tables {
            table_map.insert(format!("local_{}", table.name), table);
        }

        InfraPlan {
            target_infra_map: InfrastructureMap {
                default_database: "local".to_string(),
                tables: table_map,
                topics: HashMap::new(),
                api_endpoints: HashMap::new(),
                views: HashMap::new(),
                topic_to_table_sync_processes: HashMap::new(),
                topic_to_topic_sync_processes: HashMap::new(),
                function_processes: HashMap::new(),
                block_db_processes: crate::framework::core::infrastructure::olap_process::OlapProcess {},
                consumption_api_web_server: crate::framework::core::infrastructure::consumption_webserver::ConsumptionApiWebServer {},
                orchestration_workers: HashMap::new(),
                sql_resources: HashMap::new(),
                workflows: HashMap::new(),
                web_apps: HashMap::new(),
            },
            changes: Default::default(),
        }
    }

    #[test]
    fn test_validate_no_clusters_defined_but_table_references_one() {
        let project = create_test_project(None);
        let table = create_test_table("test_table", Some("test_cluster".to_string()));
        let plan = create_test_plan(vec![table]);

        let result = validate(&project, &plan);

        assert!(result.is_err());
        match result {
            Err(ValidationError::ClusterValidation(msg)) => {
                assert!(msg.contains("test_table"));
                assert!(msg.contains("test_cluster"));
                assert!(msg.contains("no clusters are defined"));
            }
            _ => panic!("Expected ClusterValidation error"),
        }
    }

    #[test]
    fn test_validate_table_references_undefined_cluster() {
        let project = create_test_project(Some(vec![
            ClusterConfig {
                name: "cluster_a".to_string(),
            },
            ClusterConfig {
                name: "cluster_b".to_string(),
            },
        ]));
        let table = create_test_table("test_table", Some("cluster_c".to_string()));
        let plan = create_test_plan(vec![table]);

        let result = validate(&project, &plan);

        assert!(result.is_err());
        match result {
            Err(ValidationError::ClusterValidation(msg)) => {
                assert!(msg.contains("test_table"));
                assert!(msg.contains("cluster_c"));
                assert!(msg.contains("cluster_a"));
                assert!(msg.contains("cluster_b"));
            }
            _ => panic!("Expected ClusterValidation error"),
        }
    }

    #[test]
    fn test_validate_table_references_valid_cluster() {
        let project = create_test_project(Some(vec![ClusterConfig {
            name: "test_cluster".to_string(),
        }]));
        let table = create_test_table("test_table", Some("test_cluster".to_string()));
        let plan = create_test_plan(vec![table]);

        let result = validate(&project, &plan);

        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_table_with_no_cluster_is_allowed() {
        let project = create_test_project(Some(vec![ClusterConfig {
            name: "test_cluster".to_string(),
        }]));
        let table = create_test_table("test_table", None);
        let plan = create_test_plan(vec![table]);

        let result = validate(&project, &plan);

        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_multiple_tables_different_clusters() {
        let project = create_test_project(Some(vec![
            ClusterConfig {
                name: "cluster_a".to_string(),
            },
            ClusterConfig {
                name: "cluster_b".to_string(),
            },
        ]));
        let table1 = create_test_table("table1", Some("cluster_a".to_string()));
        let table2 = create_test_table("table2", Some("cluster_b".to_string()));
        let plan = create_test_plan(vec![table1, table2]);

        let result = validate(&project, &plan);

        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_empty_clusters_list() {
        let project = create_test_project(Some(vec![]));
        let table = create_test_table("test_table", Some("test_cluster".to_string()));
        let plan = create_test_plan(vec![table]);

        let result = validate(&project, &plan);

        assert!(result.is_err());
        match result {
            Err(ValidationError::ClusterValidation(msg)) => {
                assert!(msg.contains("test_table"));
                assert!(msg.contains("test_cluster"));
            }
            _ => panic!("Expected ClusterValidation error"),
        }
    }

    // Helper to create a table with a specific engine
    fn create_table_with_engine(
        name: &str,
        cluster_name: Option<String>,
        engine: crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine,
    ) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine,
            version: Some(Version::from_string("1.0.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: name.to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name,
            primary_key_expression: None,
        }
    }

    #[test]
    fn test_non_replicated_engine_without_cluster_succeeds() {
        let project = create_test_project(None);
        let table = create_table_with_engine("test_table", None, ClickhouseEngine::MergeTree);
        let plan = create_test_plan(vec![table]);

        let result = validate(&project, &plan);

        assert!(result.is_ok());
    }
}
