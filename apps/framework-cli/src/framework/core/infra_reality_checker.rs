/// # Infrastructure Reality Checker Module
///
/// This module provides functionality for comparing the actual infrastructure state
/// with the documented infrastructure map. It helps identify discrepancies between
/// what exists in reality and what is documented in the infrastructure map.
///
/// The module includes:
/// - A reality checker that queries the actual infrastructure state
/// - Structures to represent discrepancies between reality and documentation
/// - Error types for reality checking operations
///
/// This is particularly useful for:
/// - Validating that the infrastructure matches the documentation
/// - Identifying tables that exist but are not documented
/// - Identifying tables that are documented but don't exist
/// - Identifying structural differences in tables
use crate::{
    framework::core::{
        infrastructure::table::Table,
        infrastructure_map::{InfrastructureMap, OlapChange, TableChange},
    },
    infrastructure::olap::{OlapChangesError, OlapOperations},
    project::Project,
};
use log::debug;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

/// Represents errors that can occur during infrastructure reality checking.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum RealityCheckError {
    /// Error occurred while checking OLAP infrastructure
    #[error("Failed to check OLAP infrastructure: {0}")]
    OlapCheck(#[from] OlapChangesError),

    /// Error occurred during database operations
    #[error("Database error: {0}")]
    DatabaseError(String),

    /// Error occurred while loading the infrastructure map
    #[error("Failed to load infrastructure map: {0}")]
    InfraMapLoad(#[from] anyhow::Error),
}

/// Represents discrepancies found between actual infrastructure and documented map.
/// This struct holds information about tables that exist in reality but not in the map,
/// tables that are in the map but don't exist in reality, and tables that exist in both
/// but have structural differences.
#[derive(Debug, Serialize, Deserialize)]
pub struct InfraDiscrepancies {
    /// Tables that exist in reality but are not in the map
    pub unmapped_tables: Vec<Table>,
    /// Tables that are in the map but don't exist in reality
    pub missing_tables: Vec<String>,
    /// Tables that exist in both but have structural differences
    pub mismatched_tables: Vec<OlapChange>,
}

impl InfraDiscrepancies {
    /// Returns true if there are no discrepancies between reality and the infrastructure map
    pub fn is_empty(&self) -> bool {
        self.unmapped_tables.is_empty()
            && self.missing_tables.is_empty()
            && self.mismatched_tables.is_empty()
    }
}

/// The Infrastructure Reality Checker compares actual infrastructure state with the infrastructure map.
/// It uses an OLAP client to query the actual state of the infrastructure and compares it with
/// the documented state in the infrastructure map.
pub struct InfraRealityChecker<T: OlapOperations> {
    olap_client: T,
}

impl<T: OlapOperations> InfraRealityChecker<T> {
    /// Creates a new InfraRealityChecker with the provided OLAP client.
    ///
    /// # Arguments
    /// * `olap_client` - OLAP client for querying the actual infrastructure state
    pub fn new(olap_client: T) -> Self {
        Self { olap_client }
    }

    /// Checks the actual infrastructure state against the provided infrastructure map
    ///
    /// This method queries the actual infrastructure state using the OLAP client and
    /// compares it with the provided infrastructure map. It identifies tables that
    /// exist in reality but not in the map, tables that are in the map but don't exist
    /// in reality, and tables that exist in both but have structural differences.
    ///
    /// # Arguments
    ///
    /// * `project` - The project configuration
    /// * `infra_map` - The infrastructure map to check against
    ///
    /// # Returns
    ///
    /// * `Result<InfraDiscrepancies, RealityCheckError>` - The discrepancies found or an error
    pub async fn check_reality(
        &self,
        project: &Project,
        infra_map: &InfrastructureMap,
    ) -> Result<InfraDiscrepancies, RealityCheckError> {
        debug!("Starting infrastructure reality check");
        debug!("Project version: {}", project.cur_version());
        debug!("Database: {}", project.clickhouse_config.db_name);

        // Get actual tables from all configured databases
        debug!("Fetching actual tables from OLAP databases");

        // Collect all databases from config
        let mut all_databases = vec![project.clickhouse_config.db_name.clone()];
        all_databases.extend(project.clickhouse_config.additional_databases.clone());

        let mut actual_tables = Vec::new();
        let mut tables_cannot_be_mapped_back = Vec::new();

        // Query each database and merge results
        for database in &all_databases {
            debug!("Fetching tables from database: {}", database);
            let (mut db_tables, mut db_unmappable) =
                self.olap_client.list_tables(database, project).await?;
            actual_tables.append(&mut db_tables);
            tables_cannot_be_mapped_back.append(&mut db_unmappable);
        }

        debug!("Found {} tables across all databases", actual_tables.len());

        // Filter out tables starting with "_moose" (case-insensitive)
        let actual_tables: Vec<_> = actual_tables
            .into_iter()
            .filter(|t| !t.name.to_lowercase().starts_with("_moose"))
            .collect();

        debug!(
            "{} tables remain after filtering _moose tables",
            actual_tables.len()
        );

        // Create maps for easier comparison
        let actual_table_map: HashMap<_, _> = actual_tables
            .into_iter()
            .map(|t| (t.name.clone(), t))
            .collect();

        debug!("Actual table names: {:?}", actual_table_map.keys());

        let mapped_table_map: HashMap<_, _> = infra_map
            .tables
            .values()
            .map(|t| (t.name.clone(), t.clone()))
            .collect();

        debug!(
            "Infrastructure map table names: {:?}",
            mapped_table_map.keys()
        );

        // Find unmapped tables (exist in reality but not in map)
        let unmapped_tables: Vec<Table> = actual_table_map
            .values()
            .filter(|table| !mapped_table_map.contains_key(&table.name))
            .cloned()
            .collect();

        debug!(
            "Found {} unmapped tables: {:?}",
            unmapped_tables.len(),
            unmapped_tables
        );

        // Find missing tables (in map but don't exist)
        let missing_tables: Vec<String> = mapped_table_map
            .keys()
            .filter(|name| {
                !actual_table_map.contains_key(*name)
                    && !tables_cannot_be_mapped_back
                        .iter()
                        .any(|t| &&t.name == name)
            })
            .cloned()
            .collect();
        debug!(
            "Found {} missing tables: {:?}",
            missing_tables.len(),
            missing_tables
        );

        // Find structural and TTL differences in tables that exist in both
        let mut mismatched_tables = Vec::new();
        for (name, mapped_table) in mapped_table_map {
            if let Some(actual_table) = actual_table_map.get(&name) {
                debug!("Comparing table structure for: {}", name);
                if actual_table != &mapped_table {
                    debug!("Found structural mismatch in table: {}", name);
                    debug!("Actual table: {:?}", actual_table);
                    debug!("Mapped table: {:?}", mapped_table);

                    // Use the existing diff_tables function to compute differences
                    // Note: We flip the order here to make infra_map the reference
                    let mut changes = Vec::new();
                    let mut actual_tables = HashMap::new();
                    actual_tables.insert(name.clone(), actual_table.clone());
                    let mut mapped_tables = HashMap::new();
                    mapped_tables.insert(name.clone(), mapped_table.clone());

                    // Flip the order of arguments to make infra_map the reference
                    InfrastructureMap::diff_tables(
                        &actual_tables,
                        &mapped_tables,
                        &mut changes,
                        // respect_life_cycle is false to not hide the difference
                        false,
                        &infra_map.default_database,
                    );
                    debug!(
                        "Found {} changes for table {}: {:?}",
                        changes.len(),
                        name,
                        changes
                    );
                    mismatched_tables.extend(changes);
                } else {
                    debug!("Table {} matches infrastructure map", name);
                }

                // TTL: table-level diff
                // Use normalized comparison to avoid false positives from ClickHouse's TTL normalization
                // ClickHouse converts "INTERVAL 30 DAY" to "toIntervalDay(30)"
                use crate::infrastructure::olap::clickhouse::normalize_ttl_expression;
                let actual_ttl_normalized = actual_table
                    .table_ttl_setting
                    .as_ref()
                    .map(|t| normalize_ttl_expression(t));
                let mapped_ttl_normalized = mapped_table
                    .table_ttl_setting
                    .as_ref()
                    .map(|t| normalize_ttl_expression(t));

                if actual_ttl_normalized != mapped_ttl_normalized {
                    mismatched_tables.push(OlapChange::Table(TableChange::TtlChanged {
                        name: name.clone(),
                        before: actual_table.table_ttl_setting.clone(),
                        after: mapped_table.table_ttl_setting.clone(),
                        table: mapped_table.clone(),
                    }));
                }

                // Column-level TTL changes are detected as part of normal column diffs
                // and handled via ModifyTableColumn operations
            }
        }

        let discrepancies = InfraDiscrepancies {
            unmapped_tables,
            missing_tables,
            mismatched_tables,
        };

        debug!(
            "Reality check complete. Found {} unmapped, {} missing, and {} mismatched tables",
            discrepancies.unmapped_tables.len(),
            discrepancies.missing_tables.len(),
            discrepancies.mismatched_tables.len()
        );

        if discrepancies.is_empty() {
            debug!("No discrepancies found between reality and infrastructure map");
        }

        Ok(discrepancies)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::local_webserver::LocalWebserverConfig;
    use crate::framework::core::infrastructure::consumption_webserver::ConsumptionApiWebServer;
    use crate::framework::core::infrastructure::olap_process::OlapProcess;
    use crate::framework::core::infrastructure::table::{
        Column, ColumnType, IntType, OrderBy, Table,
    };
    use crate::framework::core::infrastructure_map::{
        PrimitiveSignature, PrimitiveTypes, TableChange,
    };
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::config::DEFAULT_DATABASE_NAME;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
    use crate::infrastructure::olap::clickhouse::TableWithUnsupportedType;
    use async_trait::async_trait;

    // Mock OLAP client for testing
    struct MockOlapClient {
        tables: Vec<Table>,
    }

    #[async_trait]
    impl OlapOperations for MockOlapClient {
        async fn list_tables(
            &self,
            _db_name: &str,
            _project: &Project,
        ) -> Result<(Vec<Table>, Vec<TableWithUnsupportedType>), OlapChangesError> {
            Ok((self.tables.clone(), vec![]))
        }
    }

    // Helper function to create a test project
    fn create_test_project() -> Project {
        Project {
            language: crate::framework::languages::SupportedLanguages::Typescript,
            redpanda_config: crate::infrastructure::stream::kafka::models::KafkaConfig::default(),
            clickhouse_config: crate::infrastructure::olap::clickhouse::ClickHouseConfig {
                db_name: "test".to_string(),
                user: "test".to_string(),
                password: "test".to_string(),
                use_ssl: false,
                host: "localhost".to_string(),
                host_port: 18123,
                native_port: 9000,
                host_data_path: None,
                additional_databases: Vec::new(),
            },
            http_server_config: LocalWebserverConfig {
                proxy_port: crate::cli::local_webserver::default_proxy_port(),
                ..LocalWebserverConfig::default()
            },
            redis_config: crate::infrastructure::redis::redis_client::RedisConfig::default(),
            git_config: crate::utilities::git::GitConfig::default(),
            temporal_config:
                crate::infrastructure::orchestration::temporal::TemporalConfig::default(),
            state_config: crate::project::StateConfig::default(),
            migration_config: crate::project::MigrationConfig::default(),
            language_project_config: crate::project::LanguageProjectConfig::default(),
            project_location: std::path::PathBuf::new(),
            is_production: false,
            supported_old_versions: std::collections::HashMap::new(),
            jwt: None,
            authentication: crate::project::AuthenticationConfig::default(),

            features: crate::project::ProjectFeatures::default(),
            load_infra: None,

            typescript_config: crate::project::TypescriptConfig::default(),
            source_dir: crate::project::default_source_dir(),
        }
    }

    fn create_base_table(name: &str) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: true,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine: None,
            version: Some(Version::from_string("1.0.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
        }
    }

    #[tokio::test]
    async fn test_reality_checker_basic() {
        // Create a mock table
        let table = create_base_table("test_table");

        // Create mock OLAP client with one table
        let mock_client = MockOlapClient {
            tables: vec![table.clone()],
        };

        // Create empty infrastructure map
        let mut infra_map = InfrastructureMap {
            default_database: DEFAULT_DATABASE_NAME.to_string(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables: HashMap::new(),
            views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            block_db_processes: OlapProcess {},
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
        };

        // Create reality checker
        let checker = InfraRealityChecker::new(mock_client);

        // Create test project
        let project = create_test_project();

        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        // Should find one unmapped table
        assert_eq!(discrepancies.unmapped_tables.len(), 1);
        assert_eq!(discrepancies.unmapped_tables[0].name, "test_table");
        assert!(discrepancies.missing_tables.is_empty());
        assert!(discrepancies.mismatched_tables.is_empty());

        // Add table to infrastructure map
        infra_map.tables.insert(table.name.clone(), table);

        // Check again
        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        // Should find no discrepancies
        assert!(discrepancies.is_empty());
    }

    #[tokio::test]
    async fn test_reality_checker_structural_mismatch() {
        let mut actual_table = create_base_table("test_table");
        let infra_table = create_base_table("test_table");

        // Add an extra column to the actual table that's not in infra map
        actual_table.columns.push(Column {
            name: "extra_column".to_string(),
            data_type: ColumnType::String,
            required: false,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        });

        let mock_client = MockOlapClient {
            tables: vec![actual_table],
        };

        let mut infra_map = InfrastructureMap {
            default_database: DEFAULT_DATABASE_NAME.to_string(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables: HashMap::new(),
            views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            block_db_processes: OlapProcess {},
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.name.clone(), infra_table);

        let checker = InfraRealityChecker::new(mock_client);
        let project = create_test_project();

        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        assert!(discrepancies.unmapped_tables.is_empty());
        assert!(discrepancies.missing_tables.is_empty());
        assert_eq!(discrepancies.mismatched_tables.len(), 1);

        // Verify the change is from reality's perspective - we need to remove the extra column to match infra map
        match &discrepancies.mismatched_tables[0] {
            OlapChange::Table(TableChange::Updated { column_changes, .. }) => {
                assert_eq!(column_changes.len(), 1);
                assert!(matches!(
                    &column_changes[0],
                    crate::framework::core::infrastructure_map::ColumnChange::Removed(_)
                ));
            }
            _ => panic!("Expected TableChange::Updated variant"),
        }
    }

    #[tokio::test]
    async fn test_reality_checker_order_by_mismatch() {
        let mut actual_table = create_base_table("test_table");
        let mut infra_table = create_base_table("test_table");

        // Add timestamp column to both tables
        let timestamp_col = Column {
            name: "timestamp".to_string(),
            data_type: ColumnType::DateTime { precision: None },
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        };
        actual_table.columns.push(timestamp_col.clone());
        infra_table.columns.push(timestamp_col);

        // Set different order_by in actual vs infra
        actual_table.order_by = OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string()]);
        infra_table.order_by = OrderBy::Fields(vec!["id".to_string()]);

        let mock_client = MockOlapClient {
            tables: vec![actual_table],
        };

        let mut infra_map = InfrastructureMap {
            default_database: DEFAULT_DATABASE_NAME.to_string(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables: HashMap::new(),
            views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            block_db_processes: OlapProcess {},
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.name.clone(), infra_table);

        let checker = InfraRealityChecker::new(mock_client);
        let project = create_test_project();

        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        assert!(discrepancies.unmapped_tables.is_empty());
        assert!(discrepancies.missing_tables.is_empty());
        assert_eq!(discrepancies.mismatched_tables.len(), 1);

        // Verify the change is from reality's perspective - we need to change order_by to match infra map
        match &discrepancies.mismatched_tables[0] {
            OlapChange::Table(TableChange::Updated {
                order_by_change, ..
            }) => {
                assert_eq!(
                    order_by_change.before,
                    OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string(),])
                );
                assert_eq!(
                    order_by_change.after,
                    OrderBy::Fields(vec!["id".to_string(),])
                );
            }
            _ => panic!("Expected TableChange::Updated variant"),
        }
    }

    #[tokio::test]
    async fn test_reality_checker_engine_mismatch() {
        let mut actual_table = create_base_table("test_table");
        let mut infra_table = create_base_table("test_table");

        // Set different engine values
        actual_table.engine = Some(ClickhouseEngine::ReplacingMergeTree {
            ver: None,
            is_deleted: None,
        });
        infra_table.engine = None;

        let mock_client = MockOlapClient {
            tables: vec![actual_table],
        };

        let mut infra_map = InfrastructureMap {
            default_database: DEFAULT_DATABASE_NAME.to_string(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables: HashMap::new(),
            views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            block_db_processes: OlapProcess {},
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.name.clone(), infra_table);

        let checker = InfraRealityChecker::new(mock_client);
        let project = create_test_project();

        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        assert!(discrepancies.unmapped_tables.is_empty());
        assert!(discrepancies.missing_tables.is_empty());
        assert_eq!(discrepancies.mismatched_tables.len(), 1);

        // Verify the change is from reality's perspective - we need to change engine to match infra map
        match &discrepancies.mismatched_tables[0] {
            OlapChange::Table(TableChange::Updated { before, after, .. }) => {
                assert!(matches!(
                    before.engine.as_ref(),
                    Some(ClickhouseEngine::ReplacingMergeTree { .. })
                ));
                assert_eq!(after.engine.as_ref(), None);
            }
            _ => panic!("Expected TableChange::Updated variant"),
        }
    }
}
