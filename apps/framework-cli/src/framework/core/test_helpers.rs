// Test utilities shared across framework::core test modules.
// Exposed via `#[cfg(test)] pub(crate) mod test_helpers;` in mod.rs so this
// file is only compiled during test builds.
use std::collections::HashMap;

use async_trait::async_trait;

use crate::framework::core::infrastructure::consumption_webserver::ConsumptionApiWebServer;
use crate::framework::core::infrastructure::dictionary::{
    DictionaryColumn, DictionaryLayout, DictionaryLifetime, DictionarySource,
    DictionaryTableSource, OlapDictionary,
};
use crate::framework::core::infrastructure::select_row_policy::SelectRowPolicy;
use crate::framework::core::infrastructure::sql_resource::SqlResource;
use crate::framework::core::infrastructure::table::{Column, ColumnType, IntType, OrderBy, Table};
use crate::framework::core::infrastructure_map::{
    InfrastructureMap, PrimitiveSignature, PrimitiveTypes,
};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::versions::Version;
use crate::infrastructure::olap::clickhouse::config::DEFAULT_DATABASE_NAME;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
use crate::infrastructure::olap::clickhouse::TableWithUnsupportedType;
use crate::infrastructure::olap::{OlapChangesError, OlapOperations};
use crate::project::Project;

// ─── Mock OLAP client ────────────────────────────────────────────────────────

#[derive(Default)]
pub struct MockOlapClient {
    pub tables: Vec<Table>,
    pub sql_resources: Vec<SqlResource>,
    pub row_policies: Vec<SelectRowPolicy>,
    pub dictionaries: Vec<String>,
    /// DDL returned by `show_create_dictionary`, keyed by `"db\x00name"`
    pub dictionary_ddls: HashMap<String, String>,
}

impl MockOlapClient {
    pub fn ddl_key(db: &str, name: &str) -> String {
        format!("{}\x00{}", db, name)
    }
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

    async fn list_sql_resources(
        &self,
        _db_name: &str,
        _default_database: &str,
    ) -> Result<Vec<SqlResource>, OlapChangesError> {
        Ok(self.sql_resources.clone())
    }

    async fn list_row_policies(
        &self,
        _db_name: &str,
    ) -> Result<Vec<SelectRowPolicy>, OlapChangesError> {
        Ok(self.row_policies.clone())
    }

    async fn list_dictionaries(&self, _db_name: &str) -> Result<Vec<String>, OlapChangesError> {
        Ok(self.dictionaries.clone())
    }

    async fn show_create_dictionary(
        &self,
        db_name: &str,
        dict_name: &str,
    ) -> Result<String, OlapChangesError> {
        let key = MockOlapClient::ddl_key(db_name, dict_name);
        Ok(self.dictionary_ddls.get(&key).cloned().unwrap_or_default())
    }
}

// ─── Project ─────────────────────────────────────────────────────────────────

pub fn create_test_project() -> Project {
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
            ..Default::default()
        },
        http_server_config: crate::cli::local_webserver::LocalWebserverConfig::default(),
        redis_config: crate::infrastructure::redis::redis_client::RedisConfig::default(),
        git_config: crate::utilities::git::GitConfig::default(),
        temporal_config: crate::infrastructure::orchestration::temporal::TemporalConfig::default(),
        state_config: crate::project::StateConfig::default(),
        migration_config: crate::project::MigrationConfig::default(),
        language_project_config: crate::project::LanguageProjectConfig::default(),
        project_location: std::path::PathBuf::new(),
        is_production: false,
        log_payloads: false,
        supported_old_versions: HashMap::new(),
        jwt: None,
        authentication: crate::project::AuthenticationConfig::default(),
        features: crate::project::ProjectFeatures::default(),
        load_infra: None,
        typescript_config: crate::project::TypescriptConfig::default(),
        source_dir: crate::project::default_source_dir(),
        docker_config: crate::project::DockerConfig::default(),
        watcher_config: crate::cli::watcher::WatcherConfig::default(),
        dev: crate::project::DevConfig::default(),
    }
}

// ─── Table ───────────────────────────────────────────────────────────────────

pub fn create_test_table(name: &str) -> Table {
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
            codec: None,
            materialized: None,
            alias: None,
        }],
        order_by: OrderBy::Fields(vec!["id".to_string()]),
        partition_by: None,
        sample_by: None,
        engine: ClickhouseEngine::MergeTree,
        version: Some(Version::from_string("1.0.0".to_string())),
        source_primitive: PrimitiveSignature {
            name: "test".to_string(),
            primitive_type: PrimitiveTypes::DataModel,
        },
        metadata: None,
        life_cycle: LifeCycle::FullyManaged,
        engine_params_hash: None,
        table_settings_hash: None,
        table_settings: None,
        indexes: vec![],
        projections: vec![],
        constraints: vec![],
        database: None,
        table_ttl_setting: None,
        cluster_name: None,
        primary_key_expression: None,
        seed_filter: Default::default(),
    }
}

// ─── InfrastructureMap ───────────────────────────────────────────────────────

/// Empty map with `default_database = DEFAULT_DATABASE_NAME ("local")`.
/// Used for reality-checker tests where the project DB doesn't need to match.
pub fn make_empty_infra_map() -> InfrastructureMap {
    InfrastructureMap {
        default_database: DEFAULT_DATABASE_NAME.to_string(),
        topics: HashMap::new(),
        api_endpoints: HashMap::new(),
        tables: HashMap::new(),
        dmv1_views: HashMap::new(),
        topic_to_table_sync_processes: HashMap::new(),
        topic_to_topic_sync_processes: HashMap::new(),
        function_processes: HashMap::new(),
        consumption_api_web_server: ConsumptionApiWebServer {},
        orchestration_workers: HashMap::new(),
        sql_resources: HashMap::new(),
        workflows: HashMap::new(),
        web_apps: HashMap::new(),
        materialized_views: HashMap::new(),
        views: HashMap::new(),
        select_row_policies: HashMap::new(),
        moose_version: None,
        olap_dictionaries: Default::default(),
    }
}

/// Map pre-populated with one dictionary, keyed as `"{DEFAULT_DATABASE_NAME}_{dict_name}"`.
/// After `reconcile_with_reality` calls `fixup_default_db`, the key is updated to use
/// the project's actual DB name.
pub fn make_infra_map_with_dict(dict_name: &str) -> InfrastructureMap {
    let mut map = InfrastructureMap::empty_from_project(&create_test_project());
    let dict = make_test_dict(dict_name);
    let key = format!("{}_{}", DEFAULT_DATABASE_NAME, dict_name);
    map.olap_dictionaries.insert(key, dict);
    map
}

// ─── MockOlapClient factories ────────────────────────────────────────────────

pub fn make_simple_mock(dictionaries: Vec<String>) -> MockOlapClient {
    MockOlapClient {
        dictionaries,
        ..Default::default()
    }
}

pub fn make_mock_with_ddls(
    dictionaries: Vec<String>,
    dictionary_ddls: HashMap<String, String>,
) -> MockOlapClient {
    MockOlapClient {
        dictionaries,
        dictionary_ddls,
        ..Default::default()
    }
}

// ─── OlapDictionary ──────────────────────────────────────────────────────────

pub fn make_test_dict(name: &str) -> OlapDictionary {
    OlapDictionary {
        name: name.to_string(),
        database: None,
        cluster_name: None,
        source: DictionarySource::Table(DictionaryTableSource {
            table: "src".to_string(),
            database: None,
            where_clause: None,
            invalidate_query: None,
        }),
        primary_key: vec!["id".to_string()],
        columns: vec![DictionaryColumn {
            name: "id".to_string(),
            type_string: "UInt64".to_string(),
            default_value: None,
            expression: None,
            is_injective: None,
            is_hierarchical: None,
            is_object_id: None,
            comment: None,
        }],
        layout: DictionaryLayout::Hashed {
            initial_array_size: None,
            max_load_factor: None,
        },
        lifetime: DictionaryLifetime::Single { seconds: 300 },
        invalidate_query: None,
        settings: HashMap::new(),
        comment: None,
        life_cycle: LifeCycle::FullyManaged,
        version: None,
        metadata: None,
    }
}
