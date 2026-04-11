use crate::framework::core::infrastructure::dictionary::{DictionaryLayout, DictionarySource};
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

    #[error("Row policy validation failed: {0}")]
    RowPolicyValidation(String),

    #[error("Dictionary validation failed: {0}")]
    DictionaryValidation(String),
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

/// Validates that row policies reference existing tables and columns,
/// and that no two policies map the same column to different JWT claims.
fn validate_row_policy_columns(plan: &InfraPlan) -> Result<(), ValidationError> {
    // Track column → (claim, policy_name) to detect conflicting claim mappings.
    // Two policies on the same column produce the same ClickHouse setting name,
    // so they must agree on which JWT claim provides the value.
    let mut column_claims: std::collections::HashMap<&str, (&str, &str)> =
        std::collections::HashMap::new();

    for policy in plan.target_infra_map.select_row_policies.values() {
        if policy.tables.is_empty() {
            return Err(ValidationError::RowPolicyValidation(format!(
                "Row policy '{}' has no tables. At least one table must be specified.",
                policy.name
            )));
        }

        // Validate the column name produces a legal ClickHouse custom setting name.
        // getSetting() requires alphanumeric + underscore after the 'SQL_moose_rls_' prefix.
        if policy.column.is_empty()
            || !policy
                .column
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err(ValidationError::RowPolicyValidation(format!(
                "Row policy '{}': column '{}' contains characters that are invalid in a \
                 ClickHouse custom setting name. Only ASCII alphanumeric characters and \
                 underscores are allowed.",
                policy.name, policy.column
            )));
        }

        if let Some(&(existing_claim, existing_policy)) = column_claims.get(policy.column.as_str())
        {
            if existing_claim != policy.claim {
                return Err(ValidationError::RowPolicyValidation(format!(
                    "Row policies '{}' and '{}' both filter on column '{}' but map to \
                     different JWT claims ('{}' vs '{}'). Policies on the same column \
                     must use the same claim.",
                    existing_policy, policy.name, policy.column, existing_claim, policy.claim
                )));
            }
        } else {
            column_claims.insert(&policy.column, (&policy.claim, &policy.name));
        }

        for table_ref in &policy.tables {
            let default_db = plan.target_infra_map.default_database.as_str();
            let table = plan.target_infra_map.tables.values().find(|t| {
                t.name == table_ref.name
                    && t.database.as_deref().unwrap_or(default_db)
                        == table_ref.database.as_deref().unwrap_or(default_db)
            });

            let table_display = match &table_ref.database {
                Some(db) => format!("{}.{}", db, table_ref.name),
                None => table_ref.name.clone(),
            };

            let Some(table) = table else {
                return Err(ValidationError::RowPolicyValidation(format!(
                    "Row policy '{}' references table '{}', which does not exist.",
                    policy.name, table_display
                )));
            };

            let has_column = table.columns.iter().any(|c| c.name == policy.column);
            if !has_column {
                let available = table
                    .columns
                    .iter()
                    .map(|c| c.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(ValidationError::RowPolicyValidation(format!(
                    "Row policy '{}' filters on column '{}', but table '{}' \
                     has no such column.\n\nAvailable columns: {}",
                    policy.name, policy.column, table_display, available
                )));
            }
        }
    }
    Ok(())
}

/// Returns `true` if `layout` supports multi-column primary keys.
///
/// Only COMPLEX_KEY_* layouts support multi-column keys; all other layouts require exactly one.
fn is_complex_key_layout(layout: &DictionaryLayout) -> bool {
    matches!(
        layout,
        DictionaryLayout::ComplexKeyHashed { .. }
            | DictionaryLayout::ComplexKeySparseHashed { .. }
            | DictionaryLayout::ComplexKeyHashedArray { .. }
            | DictionaryLayout::ComplexKeyCache { .. }
            | DictionaryLayout::ComplexKeySsdCache { .. }
            | DictionaryLayout::ComplexKeyDirect
    )
}

/// Validates dictionary configurations in the plan.
///
/// Checks:
/// 1. Source table exists in the infra map (for Table source type).
/// 2. Primary key columns are present in the dictionary's column list.
/// 3. Layout-key compatibility: non-COMPLEX_KEY layouts require exactly one key column.
/// 4. Dict-to-dict source rejection: dictionaries cannot source from other dictionaries.
fn validate_dictionary_config(plan: &InfraPlan) -> Result<(), ValidationError> {
    let default_db = plan.target_infra_map.default_database.as_str();

    for dict in plan.target_infra_map.olap_dictionaries.values() {
        // Validate Table source type
        if let DictionarySource::Table(ref ts) = dict.source {
            // 1. Reject dict-to-dict: source must not be another dictionary.
            // Only reject if a dictionary with that name exists AND no table with
            // that name exists — a table and a dictionary may share a name in
            // ClickHouse, and the user might legitimately source from the table.
            let source_db_for_dict_check = ts.database.as_deref().unwrap_or(default_db);
            let shadowed_by_table = plan.target_infra_map.tables.values().any(|t| {
                t.name == ts.table
                    && t.database.as_deref().unwrap_or(default_db) == source_db_for_dict_check
            });
            // Compute the database of the dictionary being validated once, so we can
            // use both name AND database to identify "self" — two dictionaries in
            // different databases can share the same name.
            let dict_db = dict.database.as_deref().unwrap_or(default_db);
            let is_dict_source = !shadowed_by_table
                && plan.target_infra_map.olap_dictionaries.values().any(|d| {
                    // Exclude the dictionary being validated to avoid self-matching
                    // (e.g. dict "foo" with source table "foo" must not trigger
                    // dict-to-dict error against itself when no table "foo" exists).
                    // Both name AND database must match to identify "self"; using only
                    // name would incorrectly exclude a different dict with the same name
                    // but a different database.
                    let is_self = d.name == dict.name
                        && d.database.as_deref().unwrap_or(default_db) == dict_db;
                    !is_self
                        && d.name == ts.table
                        && d.database.as_deref().unwrap_or(default_db) == source_db_for_dict_check
                });
            if is_dict_source {
                return Err(ValidationError::DictionaryValidation(format!(
                    "Dictionary '{}' cannot use dictionary '{}' as a source table. \
                     Dictionary-to-dictionary chaining is not supported by ClickHouse.",
                    dict.name, ts.table
                )));
            }

            // 2. Source table must exist in the infra map
            let source_db = ts.database.as_deref().unwrap_or(default_db);
            let table_exists = plan.target_infra_map.tables.values().any(|t| {
                t.name == ts.table && t.database.as_deref().unwrap_or(default_db) == source_db
            });
            if !table_exists {
                return Err(ValidationError::DictionaryValidation(format!(
                    "Dictionary '{}' references source table '{}' which does not exist \
                     in the infrastructure map.",
                    dict.name, ts.table
                )));
            }
        }

        // 2. Primary key columns exist in the column list
        for pk_col in &dict.primary_key {
            if !dict.columns.iter().any(|c| &c.name == pk_col) {
                return Err(ValidationError::DictionaryValidation(format!(
                    "Dictionary '{}': primaryKey column '{}' is not listed in the \
                     dictionary's column definitions.",
                    dict.name, pk_col
                )));
            }
        }

        // 3. Layout-key compatibility
        if dict.primary_key.len() > 1 && !is_complex_key_layout(&dict.layout) {
            return Err(ValidationError::DictionaryValidation(format!(
                "Dictionary '{}' has {} primary key columns but uses a layout that only \
                 supports a single key column. Use a COMPLEX_KEY_* layout (e.g. \
                 COMPLEX_KEY_HASHED) for multi-column keys.",
                dict.name,
                dict.primary_key.len()
            )));
        }
    }

    Ok(())
}

pub fn validate(project: &Project, plan: &InfraPlan) -> Result<(), ValidationError> {
    stream::validate_changes(project, &plan.changes.streaming_engine_changes)?;

    // Validate cluster references
    validate_cluster_references(project, plan)?;

    // Validate row policy table/column references
    validate_row_policy_columns(plan)?;

    // Validate dictionary source and key configuration
    validate_dictionary_config(plan)?;

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
                additional_databases: vec![],
                clusters,
                ..Default::default()
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
            log_payloads: false,
            supported_old_versions: HashMap::new(),
            jwt: None,
            authentication: crate::project::AuthenticationConfig::default(),
            features: ProjectFeatures::default(),
            load_infra: None,
            typescript_config: crate::project::TypescriptConfig::default(),
            source_dir: crate::project::default_source_dir(),
            docker_config: crate::project::DockerConfig::default(),
            watcher_config: crate::cli::watcher::WatcherConfig::default(),
            dev: crate::project::DevConfig::default(),
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
                materialized: None,
                alias: None,
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
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            projections: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name,
            primary_key_expression: None,
            seed_filter: Default::default(),
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
                dmv1_views: HashMap::new(),
                topic_to_table_sync_processes: HashMap::new(),
                topic_to_topic_sync_processes: HashMap::new(),
                function_processes: HashMap::new(),
                consumption_api_web_server: crate::framework::core::infrastructure::consumption_webserver::ConsumptionApiWebServer {},
                orchestration_workers: HashMap::new(),
                sql_resources: HashMap::new(),
                workflows: HashMap::new(),
                web_apps: HashMap::new(),
                materialized_views: HashMap::new(),
                views: HashMap::new(),
                select_row_policies: HashMap::new(),
                moose_version: None,
                olap_dictionaries: Default::default(),
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
                materialized: None,
                alias: None,
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
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            projections: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name,
            primary_key_expression: None,
            seed_filter: Default::default(),
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

    fn create_test_table_with_columns(name: &str, columns: Vec<Column>) -> Table {
        Table {
            name: name.to_string(),
            columns,
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
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            projections: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
            seed_filter: Default::default(),
        }
    }

    fn make_column(name: &str) -> Column {
        Column {
            name: name.to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
            alias: None,
        }
    }

    #[test]
    fn test_row_policy_column_with_invalid_setting_chars_rejected() {
        use crate::framework::core::infrastructure::select_row_policy::{
            SelectRowPolicy, TableReference,
        };

        let table = create_test_table_with_columns(
            "events_1_0_0",
            vec![make_column("id"), make_column("org-id")],
        );
        let mut plan = create_test_plan(vec![table]);
        plan.target_infra_map.select_row_policies.insert(
            "tenant_isolation".to_string(),
            SelectRowPolicy {
                name: "tenant_isolation".to_string(),
                tables: vec![TableReference {
                    name: "events_1_0_0".to_string(),
                    database: None,
                }],
                column: "org-id".to_string(),
                claim: "org_id".to_string(),
            },
        );

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(result.is_err());
        match result {
            Err(ValidationError::RowPolicyValidation(msg)) => {
                assert!(msg.contains("org-id"));
                assert!(msg.contains("invalid"));
            }
            _ => panic!("Expected RowPolicyValidation error"),
        }
    }

    #[test]
    fn test_row_policy_column_with_valid_chars_accepted() {
        use crate::framework::core::infrastructure::select_row_policy::{
            SelectRowPolicy, TableReference,
        };

        let table = create_test_table_with_columns(
            "events_1_0_0",
            vec![make_column("id"), make_column("org_id")],
        );
        let mut plan = create_test_plan(vec![table]);
        plan.target_infra_map.select_row_policies.insert(
            "tenant_isolation".to_string(),
            SelectRowPolicy {
                name: "tenant_isolation".to_string(),
                tables: vec![TableReference {
                    name: "events_1_0_0".to_string(),
                    database: None,
                }],
                column: "org_id".to_string(),
                claim: "org_id".to_string(),
            },
        );

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(result.is_ok());
    }

    // ─── Dictionary validation tests ────────────────────────────────────────

    use crate::framework::core::infrastructure::dictionary::{
        DictionaryColumn, DictionaryLayout, DictionaryLifetime, DictionaryQuerySource,
        DictionarySource, DictionaryTableSource, OlapDictionary,
    };

    fn make_dict(
        name: &str,
        source: DictionarySource,
        primary_key: Vec<String>,
        columns: Vec<DictionaryColumn>,
        layout: DictionaryLayout,
    ) -> OlapDictionary {
        OlapDictionary {
            name: name.to_string(),
            database: None,
            cluster_name: None,
            source,
            primary_key,
            columns,
            layout,
            lifetime: DictionaryLifetime::Single { seconds: 300 },
            invalidate_query: None,
            settings: HashMap::new(),
            comment: None,
            life_cycle: LifeCycle::FullyManaged,
            metadata: None,
        }
    }

    fn make_dict_column(name: &str) -> DictionaryColumn {
        DictionaryColumn {
            name: name.to_string(),
            type_string: "String".to_string(),
            default_value: None,
            expression: None,
            is_injective: None,
            is_hierarchical: None,
            is_object_id: None,
            comment: None,
        }
    }

    fn table_source(table: &str) -> DictionarySource {
        DictionarySource::Table(DictionaryTableSource {
            table: table.to_string(),
            database: None,
            where_clause: None,
            invalidate_query: None,
        })
    }

    fn query_source() -> DictionarySource {
        DictionarySource::Query(DictionaryQuerySource {
            query: "SELECT id, val FROM src".to_string(),
            invalidate_query: None,
        })
    }

    #[test]
    fn test_dictionary_source_table_missing_error() {
        // Dictionary references a source table that's not in the infra map
        let dict = make_dict(
            "dict_x",
            table_source("nonexistent_table"),
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let mut plan = create_test_plan(vec![]);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_dict_x".to_string(), dict);

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(matches!(
            result,
            Err(ValidationError::DictionaryValidation(msg))
                if msg.contains("nonexistent_table")
        ));
    }

    #[test]
    fn test_dictionary_invalid_primary_key_column_error() {
        // Primary key column not listed in columns
        let dict = make_dict(
            "dict_x",
            query_source(),
            vec!["bad_key".to_string()],
            vec![make_dict_column("id")],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let mut plan = create_test_plan(vec![]);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_dict_x".to_string(), dict);

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(matches!(
            result,
            Err(ValidationError::DictionaryValidation(msg))
                if msg.contains("bad_key")
        ));
    }

    #[test]
    fn test_dictionary_hashed_with_multi_key_error() {
        // HASHED layout does not support multi-column keys
        let dict = make_dict(
            "dict_x",
            query_source(),
            vec!["k1".to_string(), "k2".to_string()],
            vec![
                make_dict_column("k1"),
                make_dict_column("k2"),
                make_dict_column("val"),
            ],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let mut plan = create_test_plan(vec![]);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_dict_x".to_string(), dict);

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(matches!(
            result,
            Err(ValidationError::DictionaryValidation(msg))
                if msg.contains("COMPLEX_KEY")
        ));
    }

    #[test]
    fn test_dictionary_complex_key_hashed_with_multi_key_ok() {
        // COMPLEX_KEY_HASHED layout supports multi-column keys
        let dict = make_dict(
            "dict_x",
            query_source(),
            vec!["k1".to_string(), "k2".to_string()],
            vec![
                make_dict_column("k1"),
                make_dict_column("k2"),
                make_dict_column("val"),
            ],
            DictionaryLayout::ComplexKeyHashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let mut plan = create_test_plan(vec![]);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_dict_x".to_string(), dict);

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(result.is_ok());
    }

    #[test]
    fn test_dictionary_dict_to_dict_source_error() {
        // Dictionary that sources from another dictionary — not allowed
        let src_dict = make_dict(
            "dict_src",
            query_source(),
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let consumer_dict = make_dict(
            "dict_consumer",
            table_source("dict_src"), // references the other dictionary by name
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let mut plan = create_test_plan(vec![]);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_dict_src".to_string(), src_dict);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_dict_consumer".to_string(), consumer_dict);

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(matches!(
            result,
            Err(ValidationError::DictionaryValidation(msg))
                if msg.contains("dict_src") && msg.contains("chaining")
        ));
    }

    #[test]
    fn test_dictionary_table_and_dict_share_name_allows_table_source() {
        // Regression test for false-positive dict-to-dict rejection:
        // When both a table "products" and a dictionary "products" exist,
        // a new dictionary sourcing from the TABLE "products" must be allowed.
        let source_table = create_test_table("products", None);
        let existing_dict = make_dict(
            "products", // dictionary with same name as the table
            query_source(),
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let consumer_dict = make_dict(
            "dict_consumer",
            table_source("products"), // intends to source from the TABLE, not the dict
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let mut plan = create_test_plan(vec![source_table]);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_products".to_string(), existing_dict);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_dict_consumer".to_string(), consumer_dict);

        let project = create_test_project(None);
        // Should succeed: "products" resolves to a table, not a dict-to-dict chain
        assert!(validate(&project, &plan).is_ok());
    }

    #[test]
    fn test_dictionary_valid_config_succeeds() {
        // A well-formed dictionary with a valid source table
        let source_table = create_test_table("products", None);
        let dict = make_dict(
            "dict_products",
            table_source("products"),
            vec!["id".to_string()],
            vec![make_dict_column("id"), make_dict_column("name")],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let mut plan = create_test_plan(vec![source_table]);
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_dict_products".to_string(), dict);

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(result.is_ok());
    }

    #[test]
    fn test_dictionary_self_name_source_table_missing_not_dict_to_dict() {
        // Regression test: a dict named "foo" using DictionarySource::Table("foo")
        // when no table "foo" exists must produce "source table does not exist",
        // NOT a spurious "dict-to-dict chaining" error caused by the inner any()
        // matching the dictionary against itself.
        let dict = make_dict(
            "foo",
            table_source("foo"), // same name as the dictionary itself, no matching table
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
        );
        let mut plan = create_test_plan(vec![]); // no tables
        plan.target_infra_map
            .olap_dictionaries
            .insert("local_foo".to_string(), dict);

        let project = create_test_project(None);
        let result = validate(&project, &plan);

        assert!(matches!(
            result,
            Err(ValidationError::DictionaryValidation(msg))
                if msg.contains("does not exist") && !msg.contains("chaining")
        ));
    }

    // Helper: table_source with an explicit database override.
    fn table_source_with_db(table: &str, database: &str) -> DictionarySource {
        DictionarySource::Table(DictionaryTableSource {
            table: table.to_string(),
            database: Some(database.to_string()),
            where_clause: None,
            invalidate_query: None,
        })
    }

    // Helper: make_dict with an explicit database field set.
    fn make_dict_with_db(
        name: &str,
        database: &str,
        source: DictionarySource,
        primary_key: Vec<String>,
        columns: Vec<DictionaryColumn>,
        layout: DictionaryLayout,
    ) -> OlapDictionary {
        OlapDictionary {
            database: Some(database.to_string()),
            ..make_dict(name, source, primary_key, columns, layout)
        }
    }

    #[test]
    fn test_dictionary_dict_to_dict_self_exclusion_requires_name_and_db() {
        // Scenario A — cross-database same-name dicts must NOT trigger dict-to-dict error.
        //
        // Dict A  (name="foo", database="db1") sources from table "foo" in "db1".
        // Dict B  (name="foo", database="db2") is an unrelated dictionary.
        // A real table "foo" exists in "db1" so dict A's source table is legitimate.
        //
        // Before the fix the self-exclusion guard `d.name != dict.name` would allow
        // Dict B (same name "foo") to pass the filter when validating Dict A, making
        // it look like dict A chains off a dictionary — a false positive.
        // With the fix the guard compares name+database, so Dict B (different database)
        // is correctly treated as a different dictionary and does NOT trigger the error.

        let hashed_layout = || DictionaryLayout::Hashed {
            initial_array_size: None,
            max_load_factor: None,
        };

        // Table "foo" in "db1" — the legitimate source for dict A.
        let mut source_table = create_test_table("foo", None);
        source_table.database = Some("db1".to_string());

        // Dict A: name="foo", database="db1", sources from table "foo" in "db1".
        let dict_a = make_dict_with_db(
            "foo",
            "db1",
            table_source_with_db("foo", "db1"),
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            hashed_layout(),
        );

        // Dict B: name="foo", database="db2", uses a query source (not relevant here).
        let dict_b = make_dict_with_db(
            "foo",
            "db2",
            query_source(),
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            hashed_layout(),
        );

        let mut plan = create_test_plan(vec![source_table]);
        plan.target_infra_map
            .olap_dictionaries
            .insert("db1_foo".to_string(), dict_a);
        plan.target_infra_map
            .olap_dictionaries
            .insert("db2_foo".to_string(), dict_b);

        let project = create_test_project(None);
        // Must succeed: dict A sources from a real table, not from dict B.
        assert!(
            validate(&project, &plan).is_ok(),
            "Expected Ok — Dict A sources from a table, not from Dict B (different database)"
        );

        // Scenario B — a dict sourcing from another dict in the SAME database must still error.
        //
        // Dict C (name="bar", database="db1") sources from table "baz_dict" in "db1".
        // Dict D (name="baz_dict", database="db1") exists.  No table named "baz_dict".
        // This is genuine dict-to-dict chaining and must be rejected.

        let dict_c = make_dict_with_db(
            "bar",
            "db1",
            table_source_with_db("baz_dict", "db1"),
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            hashed_layout(),
        );

        let dict_d = make_dict_with_db(
            "baz_dict",
            "db1",
            query_source(),
            vec!["id".to_string()],
            vec![make_dict_column("id")],
            hashed_layout(),
        );

        let mut plan2 = create_test_plan(vec![]); // no tables
        plan2
            .target_infra_map
            .olap_dictionaries
            .insert("db1_bar".to_string(), dict_c);
        plan2
            .target_infra_map
            .olap_dictionaries
            .insert("db1_baz_dict".to_string(), dict_d);

        let project2 = create_test_project(None);
        assert!(
            matches!(
                validate(&project2, &plan2),
                Err(ValidationError::DictionaryValidation(msg))
                    if msg.contains("chaining")
            ),
            "Expected dict-to-dict chaining error when source dict is in the same database"
        );
    }
}
