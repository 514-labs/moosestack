/// # Infrastructure Planning Module
///
/// This module is responsible for planning infrastructure changes by comparing the current
/// infrastructure state with the target state. It generates a plan that describes the
/// changes needed to transition from the current state to the target state.
///
/// The planning process involves:
/// 1. Loading the current infrastructure map from Redis
/// 2. Reconciling the infrastructure map with the actual database state
/// 3. Building the target infrastructure map from the project configuration
/// 4. Computing the difference between the reconciled and target maps
/// 5. Creating a plan that describes the changes to be applied
///
/// The resulting plan is then used by the execution module to apply the changes.
use crate::framework::core::infra_reality_checker::{InfraRealityChecker, RealityCheckError};
use crate::framework::core::infrastructure_map::{
    InfraChanges, InfrastructureMap, OlapChange, TableChange,
};
use crate::framework::core::primitive_map::PrimitiveMap;
use crate::framework::core::state_storage::StateStorage;
use crate::infrastructure::olap::clickhouse;
#[cfg(test)]
use crate::infrastructure::olap::clickhouse::config::DEFAULT_DATABASE_NAME;
use crate::infrastructure::olap::clickhouse::diff_strategy::ClickHouseTableDiffStrategy;
use crate::infrastructure::olap::OlapOperations;
use crate::project::Project;
use log::{debug, error, info};
use rdkafka::error::KafkaError;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::mem;
use std::path::Path;

/// Errors that can occur during the planning process.
#[derive(Debug, thiserror::Error)]
pub enum PlanningError {
    /// Error occurred while loading the primitive map
    #[error("Failed to load primitive map")]
    PrimitiveMapLoading(#[from] crate::framework::core::primitive_map::PrimitiveMapLoadingError),

    /// Error occurred while connecting to the Clickhouse database
    #[error("Failed to connect to state storage")]
    Clickhouse(#[from] clickhouse_rs::errors::Error),

    /// Error occurred while connecting to Kafka
    #[error("Failed to connect to streaming engine")]
    Kafka(#[from] KafkaError),

    /// Error occurred during reality check
    #[error("Failed during reality check")]
    RealityCheck(#[from] RealityCheckError),

    /// OLAP is disabled but OLAP changes are required
    #[error("OLAP feature is disabled, but your project requires database operations. Please enable OLAP in your project configuration by setting 'olap = true' in your project features.")]
    OlapDisabledButRequired,

    /// Error occurred while loading data model v2 infrastructure
    #[error(transparent)]
    DmV2Loading(#[from] crate::framework::core::partial_infrastructure_map::DmV2LoadingError),

    /// Other unspecified errors
    #[error("Unknown error")]
    Other(#[from] anyhow::Error),
}
/// Reconciles an infrastructure map with the actual state from the database.
///
/// This function uses the InfraRealityChecker to determine the actual state of the database
/// and updates the provided infrastructure map to match reality. This ensures that any
/// external changes made to the database are properly reflected in the infrastructure map
/// before planning and applying new changes.
///
/// We only want to look at differences for tables that are already in the infrastructure map.
/// This is because if new external tables appear, they might not be in the code, yet. As such
/// we don't want those to be deleted as a consequence of the diff
///
/// # Arguments
/// * `project` - The project configuration
/// * `infra_map` - The infrastructure map to update
/// * `target_table_names` - Names of tables to include from unmapped tables (tables in DB but not in current inframap). Only unmapped tables with names in this set will be added to the reconciled inframap.
/// * `olap_client` - The OLAP client to use for checking reality
///
/// # Returns
/// * `Result<InfrastructureMap, PlanningError>` - The reconciled infrastructure map or an error
pub async fn reconcile_with_reality<T: OlapOperations>(
    project: &Project,
    current_infra_map: &InfrastructureMap,
    target_table_ids: &HashSet<String>,
    olap_client: T,
) -> Result<InfrastructureMap, PlanningError> {
    info!("Reconciling infrastructure map with actual database state");

    // Clone the map so we can modify it
    let mut reconciled_map = current_infra_map.clone();
    reconciled_map.default_database = project.clickhouse_config.db_name.clone();

    if current_infra_map
        .tables
        .iter()
        .any(|(id, t)| id != &t.id(&project.clickhouse_config.db_name))
    {
        // fix up IDs where in the old version it does not contain the DB name
        let existing_tables = mem::take(&mut reconciled_map.tables);
        for (_, t) in existing_tables {
            reconciled_map
                .tables
                .insert(t.id(&project.clickhouse_config.db_name), t);
        }
    }

    // Create the reality checker with the provided client
    let reality_checker = InfraRealityChecker::new(olap_client);

    // Get the discrepancies between the infra map and the actual database
    let discrepancies = reality_checker
        .check_reality(project, &reconciled_map)
        .await?;

    // If there are no discrepancies, return the original map
    if discrepancies.is_empty() {
        debug!("No discrepancies found between infrastructure map and actual database state");
        return Ok(reconciled_map.clone());
    }

    debug!(
        "Reconciling {} missing tables and {} mismatched tables",
        discrepancies.missing_tables.len(),
        discrepancies.mismatched_tables.len(),
    );

    // Remove missing tables from the map so that they can be re-created
    // if they are added to the codebase
    for table_name in &discrepancies.missing_tables {
        debug!(
            "Removing missing table {} from infrastructure map",
            table_name
        );
        // Find the table by name and remove it by ID
        if let Some((id, _)) = reconciled_map
            .tables
            .iter()
            .find(|(_, table)| &table.name == table_name)
            .map(|(id, _)| (id.clone(), ()))
        {
            reconciled_map.tables.remove(&id);
        }
    }

    // Update mismatched tables
    for change in &discrepancies.mismatched_tables {
        match change {
            OlapChange::Table(table_change) => {
                match table_change {
                    TableChange::Updated {
                        before: reality_table,
                        after: infra_map_table,
                        ..
                    } => {
                        debug!(
                            "Updating table {} in infrastructure map to match reality",
                            reality_table.name
                        );
                        let mut table = reality_table.clone();
                        // we refer to the life cycle value in the target infra map
                        // if missing, we then refer to the old infra map
                        // but never `reality_table.life_cycle` which is reconstructed in list_tables
                        table.life_cycle = infra_map_table.life_cycle;

                        // Keep the engine_params_hash from the infra map for ALL engines
                        // because ClickHouse returns [HIDDEN] for any credentials in CREATE TABLE
                        // statements, which produces a different hash than the actual credentials.
                        // This applies to S3Queue, HDFS, MySQL, PostgreSQL, and any other engine
                        // that might have authentication parameters.
                        table.engine_params_hash = infra_map_table.engine_params_hash.clone();

                        reconciled_map
                            .tables
                            .insert(reality_table.id(&reconciled_map.default_database), table);
                    }
                    TableChange::TtlChanged {
                        name,
                        before: reality_ttl,
                        table,
                        ..
                    } => {
                        debug!(
                            "Updating table {} TTL in infrastructure map to match reality: {:?}",
                            name, reality_ttl
                        );
                        // Update the table in the reconciled map with the actual TTL from reality
                        if let Some(existing_table) = reconciled_map
                            .tables
                            .get_mut(&table.id(&reconciled_map.default_database))
                        {
                            existing_table.table_ttl_setting = reality_ttl.clone();
                        }
                    }
                    TableChange::SettingsChanged {
                        name,
                        before_settings: reality_settings,
                        table,
                        ..
                    } => {
                        debug!(
                            "Updating table {} settings in infrastructure map to match reality: {:?}",
                            name, reality_settings
                        );

                        // Update the table in the reconciled map with the actual settings from reality
                        if let Some(existing_table) = reconciled_map
                            .tables
                            .get_mut(&table.id(&reconciled_map.default_database))
                        {
                            existing_table.table_settings = reality_settings.clone();
                        }
                    }

                    TableChange::Added(_) | TableChange::Removed(_) => {
                        // Add/Remove are already handled by unmapped/missing
                        debug!("Skipping table change: {:?}", table_change);
                    }

                    TableChange::ValidationError { .. } => {
                        // Validation errors should be caught by plan validator
                        // Skip during reconciliation
                        debug!("Skipping validation error during reconciliation");
                    }
                }
            }
            _ => {
                // We only handle table changes for now
                debug!("Skipping non-table change: {:?}", change);
            }
        }
    }
    // Add unmapped tables
    for unmapped_table in discrepancies.unmapped_tables {
        let id = unmapped_table.id(&reconciled_map.default_database);
        let id = match id.strip_prefix(&current_infra_map.default_database) {
            None => id,
            Some(table_name_version) => {
                format!("{}{}", reconciled_map.default_database, table_name_version)
            }
        };
        if target_table_ids.contains(&id) {
            reconciled_map.tables.insert(
                unmapped_table.id(&reconciled_map.default_database),
                unmapped_table,
            );
        }
    }

    info!("Infrastructure map successfully reconciled with actual database state");
    Ok(reconciled_map)
}

/// Represents a plan for infrastructure changes.
///
/// This struct contains the target infrastructure map and the changes needed
/// to transition from the current state to the target state.
#[derive(Debug, Serialize, Deserialize)]
pub struct InfraPlan {
    /// The target infrastructure map that we want to achieve
    pub target_infra_map: InfrastructureMap,

    /// The changes needed to transition from the current state to the target state
    pub changes: InfraChanges,
}

/// Plans infrastructure changes by comparing the current state with the target state.
///
/// This function loads the current infrastructure map from state storage,
/// reconciles it with the actual database state, and compares it with the target infrastructure map derived
/// from the project configuration. It then generates a plan that describes the changes
/// needed to transition from the current state to the target state.
///
/// # Arguments
/// * `state_storage` - State storage implementation for loading the current infrastructure map
/// * `project` - Project configuration for building the target infrastructure map
///
/// # Returns
/// * `Result<(InfrastructureMap, InfraPlan), PlanningError>` - The current state and infrastructure plan, or an error
pub async fn plan_changes(
    state_storage: &dyn StateStorage,
    project: &Project,
) -> Result<(InfrastructureMap, InfraPlan), PlanningError> {
    let json_path = Path::new(".moose/infrastructure_map.json");
    let mut target_infra_map = if project.is_production && json_path.exists() {
        // Load from prebuilt JSON (created by moose check without credentials)
        InfrastructureMap::load_from_json(json_path).map_err(|e| PlanningError::Other(e.into()))?
    } else {
        if project.is_production && project.is_docker_image() {
            error!("Docker Build images should have the infrastructure map already created and embedded");
        }

        if project.features.data_model_v2 {
            // Resolve credentials at runtime for dev/prod mode
            InfrastructureMap::load_from_user_code(project, true).await?
        } else {
            let primitive_map = PrimitiveMap::load(project).await?;
            InfrastructureMap::new(project, primitive_map)
        }
    };

    // ALWAYS resolve S3 credentials at runtime in prod mode
    // The JSON was created by moose check without credentials to avoid baking them into Docker
    target_infra_map
        .resolve_s3_credentials_from_env()
        .map_err(|e| {
            PlanningError::Other(anyhow::anyhow!("Failed to resolve S3 credentials: {}", e))
        })?;

    let current_infra_map = state_storage.load_infrastructure_map().await?;

    debug!(
        "Current infrastructure map: {}",
        serde_json::to_string(&current_infra_map)
            .unwrap_or("Could not serialize current infrastructure map".to_string())
    );

    let current_map_or_empty =
        current_infra_map.unwrap_or_else(|| InfrastructureMap::empty_from_project(project));

    // Reconcile the current map with reality before diffing, but only if OLAP is enabled
    let reconciled_map = if project.features.olap {
        // Plan changes, reconciling with reality
        let olap_client = clickhouse::create_client(project.clickhouse_config.clone());

        reconcile_with_reality(
            project,
            &current_map_or_empty,
            &target_infra_map
                .tables
                .values()
                .map(|t| t.id(&target_infra_map.default_database))
                .collect(),
            olap_client,
        )
        .await?
    } else {
        debug!("OLAP disabled, skipping reality check reconciliation");
        current_map_or_empty
    };

    debug!(
        "Reconciled infrastructure map: {}",
        serde_json::to_string(&reconciled_map)
            .unwrap_or("Could not serialize reconciled infrastructure map".to_string())
    );

    // Use the reconciled map for diffing with ClickHouse-specific strategy
    // Pass ignore_ops so the diff can normalize tables internally for comparison
    // while using original tables for the actual change operations
    let clickhouse_strategy = ClickHouseTableDiffStrategy;
    let ignore_ops: &[clickhouse::IgnorableOperation] = if project.is_production {
        &project.migration_config.ignore_operations
    } else {
        &[]
    };

    let changes = reconciled_map.diff_with_table_strategy(
        &target_infra_map,
        &clickhouse_strategy,
        true,
        project.is_production,
        ignore_ops,
    );

    let plan = InfraPlan {
        target_infra_map: target_infra_map.clone(),
        changes,
    };

    // Validate that OLAP is enabled if OLAP changes are required
    if !project.features.olap
        && !plan.changes.olap_changes.is_empty()
        && plan.target_infra_map.uses_olap()
    {
        error!(
            "OLAP is disabled but {} OLAP changes are required. Enable OLAP in project configuration.",
            plan.changes.olap_changes.len()
        );
        return Err(PlanningError::OlapDisabledButRequired);
    }

    debug!(
        "Plan Changes: {}",
        serde_json::to_string(&plan.changes)
            .unwrap_or("Could not serialize plan changes".to_string())
    );

    Ok((reconciled_map, plan))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{
        Column, ColumnType, IntType, OrderBy, Table,
    };
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::TableWithUnsupportedType;
    use crate::infrastructure::olap::OlapChangesError;
    use crate::infrastructure::olap::OlapOperations;
    use async_trait::async_trait;
    use protobuf::Message;

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

    // Helper function to create a test table
    fn create_test_table(name: &str) -> Table {
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
                clusters: None,
            },
            http_server_config: crate::cli::local_webserver::LocalWebserverConfig::default(),
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

    #[tokio::test]
    async fn test_reconcile_with_reality_unmapped_table() {
        // Create a test table that exists in the database but not in the infra map
        let table = create_test_table("unmapped_table");

        // Create mock OLAP client with one table
        let mock_client = MockOlapClient {
            tables: vec![table.clone()],
        };

        // Create empty infrastructure map (no tables)
        let infra_map = InfrastructureMap::default();

        // Replace the normal check_reality function with our mock
        let reality_checker = InfraRealityChecker::new(mock_client);

        // Create test project
        let project = create_test_project();

        // Get the discrepancies
        let discrepancies = reality_checker
            .check_reality(&project, &infra_map)
            .await
            .unwrap();

        // There should be one unmapped table
        assert_eq!(discrepancies.unmapped_tables.len(), 1);
        assert_eq!(discrepancies.unmapped_tables[0].name, "unmapped_table");

        let mut target_ids = HashSet::new();

        // Reconcile the infrastructure map
        let reconciled = reconcile_with_reality(
            &project,
            &infra_map,
            &target_ids,
            MockOlapClient {
                tables: vec![table.clone()],
            },
        )
        .await
        .unwrap();

        // The reconciled map should not contain the unmapped table (ignoring unmapped tables)
        assert_eq!(reconciled.tables.len(), 0);

        target_ids.insert("unmapped_table".to_string());

        // Reconcile the infrastructure map
        let reconciled = reconcile_with_reality(
            &project,
            &infra_map,
            &target_ids,
            MockOlapClient {
                tables: vec![table.clone()],
            },
        )
        .await
        .unwrap();

        // The reconciled map should not contain the unmapped table (ignoring unmapped tables)
        assert_eq!(reconciled.tables.len(), 1);
    }

    #[tokio::test]
    async fn test_reconcile_with_reality_missing_table() {
        // Create a test table that exists in the infra map but not in the database
        let table = create_test_table("missing_table");

        // Create mock OLAP client with no tables
        let mock_client = MockOlapClient { tables: vec![] };

        // Create infrastructure map with one table
        let mut infra_map = InfrastructureMap::default();
        infra_map
            .tables
            .insert(table.id(DEFAULT_DATABASE_NAME), table.clone());

        // Replace the normal check_reality function with our mock
        let reality_checker = InfraRealityChecker::new(mock_client);

        // Create test project
        let project = create_test_project();

        // Get the discrepancies
        let discrepancies = reality_checker
            .check_reality(&project, &infra_map)
            .await
            .unwrap();

        // There should be one missing table
        assert_eq!(discrepancies.missing_tables.len(), 1);
        assert_eq!(discrepancies.missing_tables[0], "missing_table");

        // Create another mock client for the reconciliation
        let reconcile_mock_client = MockOlapClient { tables: vec![] };

        let target_table_ids = HashSet::new();

        // Reconcile the infrastructure map
        let reconciled = reconcile_with_reality(
            &project,
            &infra_map,
            &target_table_ids,
            reconcile_mock_client,
        )
        .await
        .unwrap();

        // The reconciled map should have no tables
        assert_eq!(reconciled.tables.len(), 0);
    }

    #[tokio::test]
    async fn test_reconcile_with_reality_mismatched_table() {
        // Create two versions of the same table with different columns
        let infra_table = create_test_table("mismatched_table");
        let mut actual_table = create_test_table("mismatched_table");

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

        // Create test project first to get the database name
        let project = create_test_project();
        let db_name = &project.clickhouse_config.db_name;

        // Create mock OLAP client with the actual table
        let mock_client = MockOlapClient {
            tables: vec![Table {
                database: Some(db_name.clone()),
                ..actual_table.clone()
            }],
        };

        // Create infrastructure map with the infra table (no extra column)
        let mut infra_map = InfrastructureMap {
            default_database: db_name.clone(),
            ..InfrastructureMap::default()
        };
        infra_map.tables.insert(
            infra_table.id(&infra_map.default_database),
            infra_table.clone(),
        );

        // Replace the normal check_reality function with our mock
        let reality_checker = InfraRealityChecker::new(mock_client);

        // Get the discrepancies
        let discrepancies = reality_checker
            .check_reality(&project, &infra_map)
            .await
            .unwrap();

        // There should be one mismatched table
        assert_eq!(discrepancies.mismatched_tables.len(), 1);

        // Create another mock client for reconciliation
        let reconcile_mock_client = MockOlapClient {
            tables: vec![Table {
                database: Some(db_name.clone()),
                ..actual_table.clone()
            }],
        };

        let target_table_ids = HashSet::new();
        // Reconcile the infrastructure map
        let reconciled = reconcile_with_reality(
            &project,
            &infra_map,
            &target_table_ids,
            reconcile_mock_client,
        )
        .await
        .unwrap();

        // The reconciled map should have one table with the extra column
        assert_eq!(reconciled.tables.len(), 1);
        let reconciled_table = reconciled.tables.values().next().unwrap();
        assert_eq!(reconciled_table.columns.len(), 2); // id + extra_column
        assert!(reconciled_table
            .columns
            .iter()
            .any(|c| c.name == "extra_column"));
    }

    #[tokio::test]
    async fn test_reconcile_with_reality_no_changes() {
        // Create a test table that exists in both the infra map and the database
        let table = create_test_table("unchanged_table");

        // Create mock OLAP client with the table
        let mock_client = MockOlapClient {
            tables: vec![table.clone()],
        };

        // Create infrastructure map with the same table
        let mut infra_map = InfrastructureMap::default();
        infra_map
            .tables
            .insert(table.id(DEFAULT_DATABASE_NAME), table.clone());

        // Replace the normal check_reality function with our mock
        let reality_checker = InfraRealityChecker::new(mock_client);

        // Create test project
        let project = create_test_project();

        // Get the discrepancies
        let discrepancies = reality_checker
            .check_reality(&project, &infra_map)
            .await
            .unwrap();

        // There should be no discrepancies
        assert!(discrepancies.is_empty());

        // Create another mock client for reconciliation
        let reconcile_mock_client = MockOlapClient {
            tables: vec![table.clone()],
        };

        let target_table_ids = HashSet::new();
        // Reconcile the infrastructure map
        let reconciled = reconcile_with_reality(
            &project,
            &infra_map,
            &target_table_ids,
            reconcile_mock_client,
        )
        .await
        .unwrap();

        // The reconciled map should be unchanged
        assert_eq!(reconciled.tables.len(), 1);
        assert!(reconciled
            .tables
            .values()
            .any(|t| t.name == "unchanged_table"));
        // Compare the tables to ensure they are identical
        assert_eq!(reconciled.tables.values().next().unwrap(), &table);
    }

    #[tokio::test]
    async fn test_custom_database_name_preserved_on_first_migration() {
        // This test reproduces ENG-1160: custom database name should be preserved
        // on first migration when no prior state exists

        const CUSTOM_DB_NAME: &str = "my_custom_database";

        // Create a project with a CUSTOM database name (not "local")
        let mut project = create_test_project();
        project.clickhouse_config.db_name = CUSTOM_DB_NAME.to_string();

        // Create an infrastructure map as if it's the target map
        // (this simulates what InfrastructureMap::new would create)
        let mut target_map = InfrastructureMap {
            default_database: CUSTOM_DB_NAME.to_string(),
            ..Default::default()
        };

        // Add a test table to make it realistic
        let table = create_test_table("test_table");
        target_map.tables.insert(table.id(CUSTOM_DB_NAME), table);

        // Simulate storing to Redis (serialize to protobuf)
        let proto_bytes = target_map.to_proto().write_to_bytes().unwrap();

        // Simulate loading from Redis (deserialize from protobuf)
        let loaded_map = InfrastructureMap::from_proto(proto_bytes).unwrap();

        // ASSERTION: The custom database name should be preserved after round-trip
        assert_eq!(
            loaded_map.default_database, CUSTOM_DB_NAME,
            "Custom database name '{}' was not preserved after serialization round-trip. Got: '{}'",
            CUSTOM_DB_NAME, loaded_map.default_database
        );

        // Also verify that reconciliation preserves the database name
        let mock_client = MockOlapClient { tables: vec![] };

        let target_table_ids = HashSet::new();
        let reconciled =
            reconcile_with_reality(&project, &loaded_map, &target_table_ids, mock_client)
                .await
                .unwrap();

        assert_eq!(
            reconciled.default_database, CUSTOM_DB_NAME,
            "Custom database name '{}' was not preserved after reconciliation. Got: '{}'",
            CUSTOM_DB_NAME, reconciled.default_database
        );
    }

    #[tokio::test]
    async fn test_loading_old_proto_without_default_database_field() {
        // This test simulates loading an infrastructure map from an old proto
        // that was serialized before the default_database field was added (field #15)

        const CUSTOM_DB_NAME: &str = "my_custom_database";

        // Create a project with a CUSTOM database name
        let mut project = create_test_project();
        project.clickhouse_config.db_name = CUSTOM_DB_NAME.to_string();

        // Manually create a proto WITHOUT the default_database field
        // by creating an empty proto (which won't have default_database set)
        use crate::proto::infrastructure_map::InfrastructureMap as ProtoInfrastructureMap;
        let old_proto = ProtoInfrastructureMap::new();
        // Note: NOT setting old_proto.default_database - simulates old proto

        let proto_bytes = old_proto.write_to_bytes().unwrap();

        // Load it back
        let loaded_map = InfrastructureMap::from_proto(proto_bytes).unwrap();

        // BUG: When loading an old proto, the default_database will be empty string ""
        // This should fail if the bug exists
        println!(
            "Loaded map default_database: '{}'",
            loaded_map.default_database
        );

        // The bug manifests here: loading an old proto results in empty string for default_database
        // which might get replaced with DEFAULT_DATABASE_NAME ("local") somewhere
        assert_eq!(
            loaded_map.default_database, "",
            "Old proto should have empty default_database, got: '{}'",
            loaded_map.default_database
        );

        // Now test reconciliation - this is where the fix should be applied
        let mock_client = MockOlapClient { tables: vec![] };

        let target_table_ids = HashSet::new();
        let reconciled =
            reconcile_with_reality(&project, &loaded_map, &target_table_ids, mock_client)
                .await
                .unwrap();

        // After reconciliation, the database name should be set from the project config
        assert_eq!(
            reconciled.default_database, CUSTOM_DB_NAME,
            "After reconciliation, custom database name should be set from project. Got: '{}'",
            reconciled.default_database
        );
    }

    #[tokio::test]
    #[allow(clippy::unnecessary_literal_unwrap)] // Test intentionally demonstrates buggy pattern
    async fn test_bug_eng_1160_default_overwrites_custom_db_name() {
        // This test demonstrates the actual bug pattern found in local_webserver.rs
        // where `Ok(None) => InfrastructureMap::default()` is used instead of
        // creating an InfrastructureMap with the project's db_name.

        const CUSTOM_DB_NAME: &str = "my_custom_database";
        let mut project = create_test_project();
        project.clickhouse_config.db_name = CUSTOM_DB_NAME.to_string();

        // Simulate the buggy pattern: when no state exists, use default()
        let loaded_map_buggy: Option<InfrastructureMap> = None;
        let buggy_map = loaded_map_buggy.unwrap_or_default();

        // BUG: This will use "local" instead of "my_custom_database"
        assert_eq!(
            buggy_map.default_database, "local",
            "BUG REPRODUCED: default() returns 'local' instead of project's db_name"
        );
        assert_ne!(
            buggy_map.default_database, CUSTOM_DB_NAME,
            "Bug confirmed: custom database name is lost"
        );

        // CORRECT PATTERN: Create InfrastructureMap with project's config
        let loaded_map_correct: Option<InfrastructureMap> = None;
        let correct_map =
            loaded_map_correct.unwrap_or_else(|| InfrastructureMap::empty_from_project(&project));

        assert_eq!(
            correct_map.default_database, CUSTOM_DB_NAME,
            "Correct pattern: InfrastructureMap uses project's db_name"
        );
    }

    #[test]
    fn test_only_default_database_field_is_config_driven() {
        // Verify that default_database is the ONLY field in InfrastructureMap
        // that comes directly from project clickhouse_config.db_name.
        // This is the critical field for ENG-1160: when InfrastructureMap::default()
        // is used instead of InfrastructureMap::new(), default_database gets "local"
        // instead of the project's configured database name.

        const CUSTOM_DB_NAME: &str = "custom_db";
        let mut project = create_test_project();
        project.clickhouse_config.db_name = CUSTOM_DB_NAME.to_string();

        let primitive_map = PrimitiveMap::default();
        let infra_map = InfrastructureMap::new(&project, primitive_map);

        // Critical: default_database must be set from project config
        assert_eq!(
            infra_map.default_database, CUSTOM_DB_NAME,
            "default_database must use project's clickhouse_config.db_name, not hardcoded 'local'"
        );

        // Note: Other fields may be populated based on project properties
        // (e.g., orchestration_workers is created based on project.language)
        // but they don't directly use clickhouse_config.db_name.
        // The bug in ENG-1160 is specifically about default_database being hardcoded to "local".
    }
}
