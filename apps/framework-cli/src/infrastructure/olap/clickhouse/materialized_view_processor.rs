//! Materialized view processor for intelligent handling of SQL resources
//!
//! This module processes SQL resources to handle materialized views appropriately,
//! including determining when to populate tables and handling S3Queue sources.

use super::diff_strategy::ClickHouseTableDiffStrategy;
use super::sql_parser::parse_insert_select;
use crate::framework::core::infrastructure::sql_resource::SqlResource;
use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::{Change, OlapChange};
use std::collections::HashMap;

/// Processes materialized views to handle population logic
pub struct MaterializedViewProcessor;

/// Metadata about a processed SQL resource
#[derive(Debug, Clone)]
pub struct SqlResourceMetadata {
    pub is_materialized_view: bool,
    pub needs_population: bool,
    pub has_s3queue_source: bool,
}

/// A SQL resource that has been processed with metadata
#[derive(Debug, Clone)]
pub struct ProcessedSqlResource {
    pub resource: SqlResource,
    pub metadata: SqlResourceMetadata,
}

impl MaterializedViewProcessor {
    /// Process SQL resources from infrastructure changes to handle materialized views appropriately
    pub fn process_sql_resources(
        changes: &[OlapChange],
        tables: &HashMap<String, Table>,
    ) -> Vec<ProcessedSqlResource> {
        let mut processed = Vec::new();

        for change in changes {
            if let OlapChange::SqlResource(sql_change) = change {
                match sql_change {
                    Change::Added(resource) => {
                        processed.push(Self::process_new_resource(resource, tables));
                    }
                    Change::Updated { before, after } => {
                        processed.push(Self::process_updated_resource(before, after, tables));
                    }
                    Change::Removed(resource) => {
                        processed.push(Self::process_removed_resource(resource));
                    }
                }
            }
        }

        processed
    }

    /// Process a new SQL resource (being added)
    pub fn process_new_resource(
        resource: &SqlResource,
        tables: &HashMap<String, Table>,
    ) -> ProcessedSqlResource {
        Self::process_new_resource_with_db(resource, tables, None)
    }

    /// Process a new SQL resource with database context
    pub fn process_new_resource_with_db(
        resource: &SqlResource,
        tables: &HashMap<String, Table>,
        database: Option<&str>,
    ) -> ProcessedSqlResource {
        let mut processed = resource.clone();
        let mut metadata = SqlResourceMetadata {
            is_materialized_view: false,
            needs_population: false,
            has_s3queue_source: false,
        };

        if let Some(mut mv_context) =
            ClickHouseTableDiffStrategy::analyze_materialized_view(resource, tables)
        {
            metadata.is_materialized_view = true;
            mv_context.is_new = true;
            mv_context.is_replacement = false;

            // Use provided database if target_database is not already set
            if mv_context.target_database.is_none() {
                mv_context.target_database = database.map(|s| s.to_string());
            }

            // Check if any source is S3Queue
            metadata.has_s3queue_source = mv_context.source_tables.iter().any(|source| {
                tables
                    .get(source)
                    .is_some_and(ClickHouseTableDiffStrategy::is_s3queue_table)
            });

            if ClickHouseTableDiffStrategy::should_populate_materialized_view(&mv_context, tables) {
                // Add INSERT statement to populate the materialized view
                let insert_stmt =
                    ClickHouseTableDiffStrategy::generate_population_statement(&mv_context);

                log::info!(
                    "Adding population statement for new materialized view '{}': will insert into '{}'",
                    resource.name,
                    mv_context.target_table
                );

                // Add the INSERT statement after the CREATE MATERIALIZED VIEW
                processed.setup.push(insert_stmt);
                metadata.needs_population = true;
            } else {
                log::info!(
                    "Skipping population for materialized view '{}' (S3Queue source: {}, replacement: {})",
                    resource.name,
                    metadata.has_s3queue_source,
                    mv_context.is_replacement
                );
            }
        } else {
            // Not a materialized view, check if it contains INSERT statements that need filtering
            processed.setup = Self::filter_incompatible_statements(&resource.setup, tables);
        }

        ProcessedSqlResource {
            resource: processed,
            metadata,
        }
    }

    /// Process an updated SQL resource (being modified)
    pub fn process_updated_resource(
        _before: &SqlResource,
        after: &SqlResource,
        tables: &HashMap<String, Table>,
    ) -> ProcessedSqlResource {
        Self::process_updated_resource_with_db(_before, after, tables, None)
    }

    /// Process an updated SQL resource with database context
    pub fn process_updated_resource_with_db(
        _before: &SqlResource,
        after: &SqlResource,
        tables: &HashMap<String, Table>,
        database: Option<&str>,
    ) -> ProcessedSqlResource {
        let mut processed = after.clone();
        let mut metadata = SqlResourceMetadata {
            is_materialized_view: false,
            needs_population: false,
            has_s3queue_source: false,
        };

        if let Some(mut mv_context) =
            ClickHouseTableDiffStrategy::analyze_materialized_view(after, tables)
        {
            metadata.is_materialized_view = true;
            // This is a replacement, don't populate
            mv_context.is_new = false;
            mv_context.is_replacement = true;

            // Use provided database if target_database is not already set
            if mv_context.target_database.is_none() {
                mv_context.target_database = database.map(|s| s.to_string());
            }

            // Check if any source is S3Queue
            metadata.has_s3queue_source = mv_context.source_tables.iter().any(|source| {
                tables
                    .get(source)
                    .is_some_and(ClickHouseTableDiffStrategy::is_s3queue_table)
            });

            log::info!(
                "Processing materialized view replacement '{}' - no population needed",
                after.name
            );

            // Remove any INSERT statements that might have been included (backwards compatibility)
            processed.setup.retain(|sql| !Self::is_insert_select(sql));
        } else {
            // Not a materialized view, but still filter incompatible statements
            processed.setup = Self::filter_incompatible_statements(&after.setup, tables);
        }

        ProcessedSqlResource {
            resource: processed,
            metadata,
        }
    }

    /// Process a removed SQL resource
    pub fn process_removed_resource(resource: &SqlResource) -> ProcessedSqlResource {
        // No special processing needed for removal
        ProcessedSqlResource {
            resource: resource.clone(),
            metadata: SqlResourceMetadata {
                is_materialized_view: false,
                needs_population: false,
                has_s3queue_source: false,
            },
        }
    }

    /// Filter out SQL statements that are incompatible with S3Queue tables
    fn filter_incompatible_statements(
        statements: &[String],
        tables: &HashMap<String, Table>,
    ) -> Vec<String> {
        statements
            .iter()
            .filter(|sql| {
                if Self::is_insert_select(sql) {
                    // Check if this INSERT SELECT references an S3Queue table
                    if let Some(source_table) = Self::extract_select_source(sql) {
                        if let Some(table) = tables.get(&source_table) {
                            if ClickHouseTableDiffStrategy::is_s3queue_table(table) {
                                log::warn!(
                                    "Filtering out INSERT...SELECT from S3Queue table '{}': {}",
                                    source_table,
                                    sql.chars().take(100).collect::<String>()
                                );
                                return false;
                            }
                        }
                    }
                }
                true
            })
            .cloned()
            .collect()
    }

    /// Check if a SQL statement is an INSERT...SELECT statement
    fn is_insert_select(sql: &str) -> bool {
        super::sql_parser::is_insert_select(sql)
    }

    /// Extract the source table from an INSERT SELECT statement
    fn extract_select_source(sql: &str) -> Option<String> {
        // Use the SQL parser to extract source tables
        if let Ok(stmt) = parse_insert_select(sql) {
            // Return the first source table if any
            stmt.source_tables.first().map(|t| t.qualified_name())
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    fn create_mv_resource(name: &str, setup: Vec<String>) -> SqlResource {
        SqlResource {
            name: name.to_string(),
            setup,
            teardown: vec![format!("DROP VIEW IF EXISTS {}", name)],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        }
    }

    fn create_regular_table(name: &str) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![],
            order_by: vec![],
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: name.to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
        }
    }

    fn create_s3queue_table(name: &str) -> Table {
        let mut settings = HashMap::new();
        settings.insert("mode".to_string(), "unordered".to_string());

        Table {
            name: name.to_string(),
            columns: vec![],
            order_by: vec![],
            engine: Some(ClickhouseEngine::S3Queue {
                s3_path: "s3://bucket/path".to_string(),
                format: "JSONEachRow".to_string(),
                aws_access_key_id: None,
                aws_secret_access_key: None,
                compression: None,
                headers: None,
                settings: Box::new(settings),
            }),
            version: None,
            source_primitive: PrimitiveSignature {
                name: name.to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
        }
    }

    #[test]
    fn test_new_mv_with_regular_table_gets_population() {
        let mut tables = HashMap::new();
        tables.insert(
            "source_table".to_string(),
            create_regular_table("source_table"),
        );

        let resource = create_mv_resource(
            "test_mv",
            vec![
                "CREATE MATERIALIZED VIEW test_mv TO target_table AS SELECT * FROM source_table"
                    .to_string(),
            ],
        );

        let processed = MaterializedViewProcessor::process_new_resource(&resource, &tables);

        assert!(processed.metadata.is_materialized_view);
        assert!(processed.metadata.needs_population);
        assert!(!processed.metadata.has_s3queue_source);

        // Should have added an INSERT statement
        assert_eq!(processed.resource.setup.len(), 2);
        assert!(processed.resource.setup[1].contains("INSERT INTO"));
    }

    #[test]
    fn test_new_mv_with_s3queue_no_population() {
        let mut tables = HashMap::new();
        tables.insert("s3_source".to_string(), create_s3queue_table("s3_source"));

        let resource = create_mv_resource(
            "test_mv",
            vec![
                "CREATE MATERIALIZED VIEW test_mv TO target_table AS SELECT * FROM s3_source"
                    .to_string(),
            ],
        );

        let processed = MaterializedViewProcessor::process_new_resource(&resource, &tables);

        assert!(processed.metadata.is_materialized_view);
        assert!(!processed.metadata.needs_population);
        assert!(processed.metadata.has_s3queue_source);

        // Should NOT have added an INSERT statement
        assert_eq!(processed.resource.setup.len(), 1);
        assert!(!processed.resource.setup[0].contains("INSERT INTO"));
    }

    #[test]
    fn test_updated_mv_no_population() {
        let mut tables = HashMap::new();
        tables.insert(
            "source_table".to_string(),
            create_regular_table("source_table"),
        );

        let before = create_mv_resource(
            "test_mv",
            vec![
                "CREATE MATERIALIZED VIEW test_mv TO target_table AS SELECT * FROM source_table"
                    .to_string(),
            ],
        );

        let after = create_mv_resource(
            "test_mv",
            vec![
                "CREATE MATERIALIZED VIEW test_mv TO target_table AS SELECT * FROM source_table"
                    .to_string(),
                "INSERT INTO target_table SELECT * FROM source_table".to_string(), // Old-style with INSERT
            ],
        );

        let processed =
            MaterializedViewProcessor::process_updated_resource(&before, &after, &tables);

        assert!(processed.metadata.is_materialized_view);
        assert!(!processed.metadata.needs_population);

        // Should have removed the INSERT statement
        assert_eq!(processed.resource.setup.len(), 1);
        assert!(!processed.resource.setup[0].contains("INSERT INTO"));
    }

    #[test]
    fn test_filter_s3queue_insert_statements() {
        let mut tables = HashMap::new();
        tables.insert("s3_table".to_string(), create_s3queue_table("s3_table"));
        tables.insert(
            "regular_table".to_string(),
            create_regular_table("regular_table"),
        );

        let statements = vec![
            "INSERT INTO target SELECT * FROM s3_table".to_string(),
            "INSERT INTO target SELECT * FROM regular_table".to_string(),
            "CREATE TABLE test (id Int32)".to_string(),
        ];

        let filtered =
            MaterializedViewProcessor::filter_incompatible_statements(&statements, &tables);

        // Should filter out the S3Queue INSERT but keep the others
        assert_eq!(filtered.len(), 2);
        assert!(filtered[0].contains("regular_table"));
        assert!(filtered[1].contains("CREATE TABLE"));
    }

    #[test]
    fn test_mv_with_database_context() {
        let mut tables = HashMap::new();
        tables.insert("events".to_string(), create_regular_table("events"));

        let resource = create_mv_resource(
            "events_mv",
            vec![
                "CREATE MATERIALIZED VIEW events_mv TO analytics.events_summary AS SELECT * FROM events"
                    .to_string(),
            ],
        );

        let processed = MaterializedViewProcessor::process_new_resource_with_db(
            &resource,
            &tables,
            Some("test_db"),
        );

        assert!(processed.metadata.is_materialized_view);
        assert!(processed.metadata.needs_population);

        // Should have added an INSERT statement with the database from the MV definition
        assert_eq!(processed.resource.setup.len(), 2);
        assert!(processed.resource.setup[1].contains("INSERT INTO `analytics`.`events_summary`"));
    }

    #[test]
    fn test_mv_database_override() {
        let mut tables = HashMap::new();
        tables.insert("events".to_string(), create_regular_table("events"));

        // MV without explicit database in TO clause
        let resource = create_mv_resource(
            "events_mv",
            vec![
                "CREATE MATERIALIZED VIEW events_mv TO events_summary AS SELECT * FROM events"
                    .to_string(),
            ],
        );

        let processed = MaterializedViewProcessor::process_new_resource_with_db(
            &resource,
            &tables,
            Some("prod_db"),
        );

        assert!(processed.metadata.is_materialized_view);
        assert!(processed.metadata.needs_population);

        // Should use the provided database since MV doesn't specify one
        assert_eq!(processed.resource.setup.len(), 2);
        assert!(processed.resource.setup[1].contains("INSERT INTO `prod_db`.`events_summary`"));
    }
}
