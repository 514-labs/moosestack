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
        infrastructure::materialized_view::MaterializedView,
        infrastructure::sql_resource::SqlResource,
        infrastructure::table::Table,
        infrastructure::view::CustomView,
        infrastructure_map::{Change, InfrastructureMap, OlapChange, TableChange},
    },
    infrastructure::olap::{
        clickhouse::sql_parser::{normalize_sql_for_comparison, parse_create_materialized_view},
        OlapChangesError, OlapOperations,
    },
    project::Project,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use tracing::{debug, warn};

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
    /// SQL resources (views/MVs) that exist in reality but are not in the map
    pub unmapped_sql_resources: Vec<SqlResource>,
    /// SQL resources that are in the map but don't exist in reality
    pub missing_sql_resources: Vec<String>,
    /// SQL resources that exist in both but have differences
    pub mismatched_sql_resources: Vec<OlapChange>,
    /// Materialized views that exist in reality but are not in the map
    pub unmapped_materialized_views: Vec<MaterializedView>,
    /// Materialized views that are in the map but don't exist in reality
    pub missing_materialized_views: Vec<String>,
    /// Materialized views that exist in both but have differences
    pub mismatched_materialized_views: Vec<OlapChange>,
    /// Custom views that exist in reality but are not in the map
    pub unmapped_custom_views: Vec<CustomView>,
    /// Custom views that are in the map but don't exist in reality
    pub missing_custom_views: Vec<String>,
    /// Custom views that exist in both but have differences
    pub mismatched_custom_views: Vec<OlapChange>,
}

impl InfraDiscrepancies {
    /// Returns true if there are no discrepancies between reality and the infrastructure map
    pub fn is_empty(&self) -> bool {
        self.unmapped_tables.is_empty()
            && self.missing_tables.is_empty()
            && self.mismatched_tables.is_empty()
            && self.unmapped_sql_resources.is_empty()
            && self.missing_sql_resources.is_empty()
            && self.mismatched_sql_resources.is_empty()
            && self.unmapped_materialized_views.is_empty()
            && self.missing_materialized_views.is_empty()
            && self.mismatched_materialized_views.is_empty()
            && self.unmapped_custom_views.is_empty()
            && self.missing_custom_views.is_empty()
            && self.mismatched_custom_views.is_empty()
    }
}

/// Checks if two SQL strings are semantically equivalent.
/// Uses AST-based normalization to handle:
/// - Whitespace differences (newlines, tabs, multiple spaces)
/// - Database prefix differences (e.g., `local.Table` vs `Table`)
/// - Identifier quoting differences (e.g., `` `column` `` vs `column`)
/// - Keyword casing differences
///
/// This is needed because ClickHouse reformats SQL when storing it
/// (e.g., puts everything on one line, adds database prefixes, adds backticks).
fn sql_is_equivalent(sql1: &str, sql2: &str, default_database: &str) -> bool {
    let normalized1 = normalize_sql_for_comparison(sql1, default_database);
    let normalized2 = normalize_sql_for_comparison(sql2, default_database);
    normalized1 == normalized2
}

/// Attempts to convert a SqlResource (from ClickHouse reality) into a MaterializedView.
/// Returns None if the SqlResource is not a moose-lib generated materialized view.
///
/// Only matches moose-lib generated MVs which use:
/// - Exactly one setup statement
/// - Exactly one teardown statement starting with "DROP VIEW IF EXISTS"
/// - Setup starts with "CREATE MATERIALIZED VIEW IF NOT EXISTS"
/// - Setup contains " TO " clause
///
/// NOTE: This uses the same conversion logic as InfrastructureMap::try_migrate_sql_resource_to_mv
/// to ensure consistency.
fn materialized_view_from_sql_resource(
    sql_resource: &SqlResource,
    default_database: &str,
) -> Option<MaterializedView> {
    // Must have exactly one setup and one teardown statement
    if sql_resource.setup.len() != 1 || sql_resource.teardown.len() != 1 {
        return None;
    }

    let setup_sql = sql_resource.setup.first()?;
    let teardown_sql = sql_resource.teardown.first()?;

    // Check teardown matches moose-lib pattern (exact prefix)
    if !teardown_sql.starts_with("DROP VIEW IF EXISTS") {
        return None;
    }

    // Check setup matches moose-lib pattern (exact prefix, with TO clause)
    if !setup_sql.starts_with("CREATE MATERIALIZED VIEW IF NOT EXISTS") {
        return None;
    }
    if !setup_sql.contains(" TO ") {
        return None;
    }

    // Parse the CREATE MATERIALIZED VIEW statement
    let parsed = parse_create_materialized_view(setup_sql).ok()?;

    // Convert source tables - use .table (not qualified_name) for consistency
    // with InfrastructureMap::try_migrate_sql_resource_to_mv
    let source_tables: Vec<String> = parsed
        .source_tables
        .iter()
        .map(|t| t.table.clone())
        .collect();

    Some(MaterializedView {
        name: sql_resource.name.clone(),
        database: Some(default_database.to_string()),
        select_sql: parsed.select_statement,
        source_tables,
        target_table: parsed.target_table,
        target_database: parsed.target_database,
        source_file: sql_resource.source_file.clone(),
    })
}

/// Attempts to convert a SqlResource (from ClickHouse reality) into a CustomView.
/// Returns None if the SqlResource is not a moose-lib generated custom view.
///
/// Only matches moose-lib generated views which use:
/// - Exactly one setup statement
/// - Exactly one teardown statement starting with "DROP VIEW IF EXISTS"
/// - Setup starts with "CREATE VIEW IF NOT EXISTS"
/// - Setup does not contain "MATERIALIZED"
/// - Setup contains " AS "
///
/// NOTE: This uses the same conversion logic as InfrastructureMap::try_migrate_sql_resource_to_custom_view
/// to ensure consistency.
fn custom_view_from_sql_resource(
    sql_resource: &SqlResource,
    default_database: &str,
) -> Option<CustomView> {
    use crate::infrastructure::olap::clickhouse::sql_parser::extract_source_tables_from_query_regex;

    // Must have exactly one setup and one teardown statement
    if sql_resource.setup.len() != 1 || sql_resource.teardown.len() != 1 {
        return None;
    }

    let setup_sql = sql_resource.setup.first()?;
    let teardown_sql = sql_resource.teardown.first()?;

    // Check teardown matches moose-lib pattern (exact prefix)
    if !teardown_sql.starts_with("DROP VIEW IF EXISTS") {
        return None;
    }

    // Check setup matches moose-lib pattern (exact prefix)
    if !setup_sql.starts_with("CREATE VIEW IF NOT EXISTS") {
        return None;
    }

    // Must not be a MATERIALIZED VIEW
    if setup_sql.contains("MATERIALIZED") {
        return None;
    }

    // Extract the SELECT part after AS
    let upper = setup_sql.to_uppercase();
    let as_pos = upper.find(" AS ")?;
    let select_sql = setup_sql[(as_pos + 4)..].trim().to_string();

    // Extract source tables - use .table (not qualified_name) for consistency
    // with InfrastructureMap::try_migrate_sql_resource_to_custom_view
    let source_tables: Vec<String> =
        match extract_source_tables_from_query_regex(&select_sql, default_database) {
            Ok(tables) => tables.iter().map(|t| t.table.clone()).collect(),
            Err(e) => {
                debug!(
                    "Failed to extract source tables from view '{}' SELECT query: {}. \
                     Source table dependency tracking may be incomplete.",
                    sql_resource.name, e
                );
                Vec::new()
            }
        };

    Some(CustomView {
        name: sql_resource.name.clone(),
        database: Some(default_database.to_string()),
        select_sql,
        source_tables,
        source_file: sql_resource.source_file.clone(),
    })
}

/// Normalizes a database reference for comparison.
/// Treats `None` as equivalent to `Some(default_database)`.
fn normalize_database(db: &Option<String>, default_database: &str) -> String {
    db.as_deref().unwrap_or(default_database).to_string()
}

/// Normalizes a table name by stripping the default database prefix if present.
/// e.g., "local.events" with default "local" becomes "events"
/// but "other_db.events" stays as "other_db.events"
fn normalize_table_name(table: &str, default_database: &str) -> String {
    let prefix = format!("{}.", default_database);
    if table.starts_with(&prefix) {
        table[prefix.len()..].to_string()
    } else {
        table.to_string()
    }
}

/// Normalizes source tables for comparison by:
/// - Stripping default database prefix from qualified names
/// - Sorting for order-independent comparison
fn normalize_source_tables(tables: &[String], default_database: &str) -> Vec<String> {
    let mut normalized: Vec<_> = tables
        .iter()
        .map(|t| normalize_table_name(t, default_database))
        .collect();
    normalized.sort();
    normalized
}

/// Checks if two MaterializedViews are semantically equivalent.
/// Compares target table, source tables (sorted), and normalized SELECT SQL.
/// Uses default_database to normalize `None` database references.
fn materialized_views_are_equivalent(
    mv1: &MaterializedView,
    mv2: &MaterializedView,
    default_database: &str,
) -> bool {
    // Compare names
    if mv1.name != mv2.name {
        return false;
    }

    // Compare target tables (just the name, database handled separately)
    if mv1.target_table != mv2.target_table {
        return false;
    }

    // Compare target databases (None is equivalent to default_database)
    if normalize_database(&mv1.target_database, default_database)
        != normalize_database(&mv2.target_database, default_database)
    {
        return false;
    }

    // Compare source tables (order-independent, normalized)
    let sources1 = normalize_source_tables(&mv1.source_tables, default_database);
    let sources2 = normalize_source_tables(&mv2.source_tables, default_database);
    if sources1 != sources2 {
        return false;
    }

    // Compare SELECT SQL (normalized)
    sql_is_equivalent(&mv1.select_sql, &mv2.select_sql, default_database)
}

/// Checks if two CustomViews are semantically equivalent.
/// Compares source tables (sorted) and normalized SELECT SQL.
/// Uses default_database to normalize table references.
fn custom_views_are_equivalent(v1: &CustomView, v2: &CustomView, default_database: &str) -> bool {
    // Compare names
    if v1.name != v2.name {
        return false;
    }

    // Compare source tables (order-independent, normalized)
    let sources1 = normalize_source_tables(&v1.source_tables, default_database);
    let sources2 = normalize_source_tables(&v2.source_tables, default_database);
    if sources1 != sources2 {
        return false;
    }

    // Compare SELECT SQL (normalized)
    sql_is_equivalent(&v1.select_sql, &v2.select_sql, default_database)
}

/// The Infrastructure Reality Checker compares actual infrastructure state with the infrastructure map.
/// It uses an OLAP client to query the actual state of the infrastructure and compares it with
/// the documented state in the infrastructure map.
pub struct InfraRealityChecker<T: OlapOperations> {
    olap_client: T,
}

pub fn find_table_from_infra_map(
    table: &Table,
    // the map may be from an old version where the key does not contain the DB name prefix
    infra_map_tables: &HashMap<String, Table>,
    default_database: &str,
) -> Option<String> {
    // Generate ID with local database prefix for comparison
    let table_id = table.id(default_database);

    debug!(
        "Looking for table '{}' (db: {:?}) with generated ID '{}' in infra map",
        table.name, table.database, table_id
    );

    // Try exact ID match first (fast path)
    if infra_map_tables.contains_key(&table_id) {
        debug!("Found exact ID match for table '{}'", table.name);
        return Some(table_id);
    }

    debug!(
        "No exact ID match for '{}'. Infra map keys: {:?}",
        table_id,
        infra_map_tables.keys().collect::<Vec<_>>()
    );

    // handles the case where `infra_map_tables` has keys with a different db prefix, or not at all
    // FIX for ENG-1689: Also match tables where database fields are equal
    let fallback_match = infra_map_tables.iter().find_map(|(infra_table_id, t)| {
        if t.name == table.name && t.version == table.version {
            // Match if:
            // 1. infra_map entry has no database (matches any), OR
            // 2. databases are equal
            let db_matches = match (&t.database, &table.database) {
                (None, _) => true, // infra_map has no DB, matches any
                (Some(t_db), Some(table_db)) => t_db == table_db,
                (Some(_), None) => false, // infra_map has DB but table doesn't
            };
            if db_matches {
                debug!(
                    "Fallback match found: table '{}' matched infra map entry with ID '{}' (database: {:?})",
                    table.name, infra_table_id, t.database
                );
                return Some(infra_table_id.clone());
            }
        }
        None
    });

    if fallback_match.is_none() && table.database.is_some() {
        // Log a warning for tables in custom databases that couldn't be matched
        warn!(
            "Table '{}' in database '{:?}' could not be matched to any entry in the infrastructure map. \
            Generated ID '{}' not found, and no fallback match available. \
            This may cause the table to appear as unmapped and use stale engine information.",
            table.name,
            table.database,
            table_id
        );
    }

    fallback_match
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
    /// TODO add support for kafka reality check
    /// TODO this is too big of a function, we should split it into smaller functions, there
    ///      some magic strings in the code that should be extracted to constants (like "_moose")
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
        debug!(
            "Database: {}. additional DBs: {}",
            project.clickhouse_config.db_name,
            project.clickhouse_config.additional_databases.join(", ")
        );

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
        //
        // KEY FORMAT for actual_table_map:
        // - Uses NEW format with database prefix: "local_db_tablename_1_0_0"
        // - Generated via table.id(&infra_map.default_database)
        let actual_table_map: HashMap<_, _> = actual_tables
            .into_iter()
            .map(|t| (t.id(&infra_map.default_database), t))
            .collect();

        debug!("Actual table names: {:?}", actual_table_map.keys());
        debug!(
            "Infrastructure map table ids: {:?}",
            infra_map.tables.keys()
        );

        // Find unmapped tables (exist in reality but not in map)
        let unmapped_tables: Vec<Table> = actual_table_map
            .values()
            .filter(|table| {
                find_table_from_infra_map(table, &infra_map.tables, &infra_map.default_database)
                    .is_none()
            })
            .cloned()
            .collect();

        debug!(
            "Found {} unmapped tables: {:?}",
            unmapped_tables.len(),
            unmapped_tables
        );

        let missing_tables: Vec<String> = infra_map
            .tables
            .values()
            .filter(|table| {
                !actual_table_map.contains_key(&table.id(&infra_map.default_database))
                    && !tables_cannot_be_mapped_back.iter().any(|t| {
                        t.name == table.name
                            && t.database
                                == table
                                    .database
                                    .as_deref()
                                    .unwrap_or(&infra_map.default_database)
                    })
            })
            .map(|table| table.name.clone())
            .collect();
        debug!(
            "Found {} missing tables: {:?}",
            missing_tables.len(),
            missing_tables
        );

        // Find structural and TTL differences in tables that exist in both
        let mut mismatched_tables = Vec::new();
        // the keys here are created in memory - they must be in the new format
        for (id, mapped_table) in &infra_map.tables {
            if let Some(actual_table) = actual_table_map.get(id) {
                // actual_table always have a database because it's mapped back by list_tables
                let table_with_db = {
                    let mut table = mapped_table.clone();
                    if table.database.is_none() {
                        table.database = Some(infra_map.default_database.clone());
                    }
                    table
                };

                debug!("Comparing table structure for: {}", id);
                if actual_table != &table_with_db {
                    debug!("Found structural mismatch in table: {}", id);
                    debug!("Actual table: {:?}", actual_table);
                    debug!("Mapped table: {:?}", table_with_db);

                    // Use the existing diff_tables function to compute differences
                    // Note: We flip the order here to make infra_map the reference
                    let mut changes = Vec::new();

                    // Flip the order of arguments to make infra_map the reference
                    InfrastructureMap::diff_tables(
                        &HashMap::from([(id.clone(), actual_table.clone())]),
                        &HashMap::from([(id.clone(), table_with_db.clone())]),
                        &mut changes,
                        // respect_life_cycle is false to not hide the difference
                        false,
                        &infra_map.default_database,
                    );
                    debug!(
                        "Found {} changes for table {}: {:?}",
                        changes.len(),
                        id,
                        changes
                    );
                    mismatched_tables.extend(changes);
                } else {
                    debug!("Table {} matches infrastructure map", id);
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
                        name: mapped_table.name.clone(),
                        before: actual_table.table_ttl_setting.clone(),
                        after: mapped_table.table_ttl_setting.clone(),
                        table: mapped_table.clone(),
                    }));
                }

                // Column-level TTL changes are detected as part of normal column diffs
                // and handled via ModifyTableColumn operations
            }
        }

        // Fetch and compare SQL resources (views and materialized views)
        debug!("Fetching actual SQL resources from OLAP databases");

        let mut actual_sql_resources = Vec::new();

        // Query each database and merge results
        for database in &all_databases {
            debug!("Fetching SQL resources from database: {}", database);
            let mut db_sql_resources = self
                .olap_client
                .list_sql_resources(database, &infra_map.default_database)
                .await?;
            actual_sql_resources.append(&mut db_sql_resources);
        }

        debug!(
            "Found {} SQL resources across all databases",
            actual_sql_resources.len()
        );

        // Convert SQL resources from reality to structured types (MVs and custom views)
        // This allows us to compare them with the infra_map's materialized_views and custom_views
        let mut actual_materialized_views: HashMap<String, MaterializedView> = HashMap::new();
        let mut actual_custom_views: HashMap<String, CustomView> = HashMap::new();
        let mut remaining_sql_resources: Vec<SqlResource> = Vec::new();

        for sql_resource in actual_sql_resources {
            // Try to convert to MaterializedView first
            if let Some(mv) =
                materialized_view_from_sql_resource(&sql_resource, &infra_map.default_database)
            {
                debug!(
                    "Converted SQL resource '{}' to MaterializedView",
                    sql_resource.name
                );
                actual_materialized_views.insert(mv.name.clone(), mv);
            }
            // Try to convert to CustomView
            else if let Some(view) =
                custom_view_from_sql_resource(&sql_resource, &infra_map.default_database)
            {
                debug!(
                    "Converted SQL resource '{}' to CustomView",
                    sql_resource.name
                );
                actual_custom_views.insert(view.name.clone(), view);
            }
            // Keep as SqlResource if it doesn't match MV or View patterns
            else {
                remaining_sql_resources.push(sql_resource);
            }
        }

        debug!(
            "Classified SQL resources: {} MVs, {} custom views, {} remaining sql_resources",
            actual_materialized_views.len(),
            actual_custom_views.len(),
            remaining_sql_resources.len()
        );

        // Create a map of actual SQL resources by name (only those that weren't converted)
        let actual_sql_resource_map: HashMap<String, _> = remaining_sql_resources
            .into_iter()
            .map(|r| (r.name.clone(), r))
            .collect();

        debug!(
            "Actual SQL resource IDs: {:?}",
            actual_sql_resource_map.keys()
        );
        debug!(
            "Infrastructure map SQL resource IDs: {:?}",
            infra_map.sql_resources.keys()
        );

        // Find unmapped SQL resources (exist in reality but not in map)
        let unmapped_sql_resources: Vec<_> = actual_sql_resource_map
            .values()
            .filter(|resource| !infra_map.sql_resources.contains_key(&resource.name))
            .cloned()
            .collect();

        debug!(
            "Found {} unmapped SQL resources: {:?}",
            unmapped_sql_resources.len(),
            unmapped_sql_resources
                .iter()
                .map(|r| &r.name)
                .collect::<Vec<_>>()
        );

        // Find missing SQL resources (in map but don't exist in reality)
        let missing_sql_resources: Vec<String> = infra_map
            .sql_resources
            .keys()
            .filter(|id| !actual_sql_resource_map.contains_key(*id))
            .cloned()
            .collect();

        debug!(
            "Found {} missing SQL resources: {:?}",
            missing_sql_resources.len(),
            missing_sql_resources
        );

        // Find mismatched SQL resources (exist in both but differ)
        let mut mismatched_sql_resources = Vec::new();
        for (id, desired) in &infra_map.sql_resources {
            if let Some(actual) = actual_sql_resource_map.get(id) {
                if actual != desired {
                    debug!("Found mismatch in SQL resource: {}", id);
                    mismatched_sql_resources.push(OlapChange::SqlResource(Change::Updated {
                        before: Box::new(actual.clone()),
                        after: Box::new(desired.clone()),
                    }));
                }
            }
        }

        debug!(
            "Found {} mismatched SQL resources",
            mismatched_sql_resources.len()
        );

        // Compare Materialized Views
        debug!("Comparing materialized views with infrastructure map");
        debug!(
            "Actual MV IDs: {:?}",
            actual_materialized_views.keys().collect::<Vec<_>>()
        );
        debug!(
            "Infrastructure map MV IDs: {:?}",
            infra_map.materialized_views.keys().collect::<Vec<_>>()
        );

        // Find unmapped MVs (exist in reality but not in map)
        let unmapped_materialized_views: Vec<_> = actual_materialized_views
            .values()
            .filter(|mv| !infra_map.materialized_views.contains_key(&mv.name))
            .cloned()
            .collect();

        debug!(
            "Found {} unmapped materialized views",
            unmapped_materialized_views.len()
        );

        // Find missing MVs (in map but don't exist in reality)
        let missing_materialized_views: Vec<String> = infra_map
            .materialized_views
            .keys()
            .filter(|id| !actual_materialized_views.contains_key(*id))
            .cloned()
            .collect();

        debug!(
            "Found {} missing materialized views: {:?}",
            missing_materialized_views.len(),
            missing_materialized_views
        );

        // Find mismatched MVs (exist in both but differ)
        let mut mismatched_materialized_views = Vec::new();
        for (id, desired) in &infra_map.materialized_views {
            if let Some(actual) = actual_materialized_views.get(id) {
                if !materialized_views_are_equivalent(actual, desired, &infra_map.default_database)
                {
                    debug!("Found mismatch in materialized view: {}", id);
                    mismatched_materialized_views.push(OlapChange::MaterializedView(
                        Change::Updated {
                            before: Box::new(actual.clone()),
                            after: Box::new(desired.clone()),
                        },
                    ));
                }
            }
        }

        debug!(
            "Found {} mismatched materialized views",
            mismatched_materialized_views.len()
        );

        // Compare Custom Views
        debug!("Comparing custom views with infrastructure map");
        debug!(
            "Actual custom view IDs: {:?}",
            actual_custom_views.keys().collect::<Vec<_>>()
        );
        debug!(
            "Infrastructure map custom view IDs: {:?}",
            infra_map.custom_views.keys().collect::<Vec<_>>()
        );

        // Find unmapped custom views (exist in reality but not in map)
        let unmapped_custom_views: Vec<_> = actual_custom_views
            .values()
            .filter(|view| !infra_map.custom_views.contains_key(&view.name))
            .cloned()
            .collect();

        debug!(
            "Found {} unmapped custom views",
            unmapped_custom_views.len()
        );

        // Find missing custom views (in map but don't exist in reality)
        let missing_custom_views: Vec<String> = infra_map
            .custom_views
            .keys()
            .filter(|id| !actual_custom_views.contains_key(*id))
            .cloned()
            .collect();

        debug!(
            "Found {} missing custom views: {:?}",
            missing_custom_views.len(),
            missing_custom_views
        );

        // Find mismatched custom views (exist in both but differ)
        let mut mismatched_custom_views = Vec::new();
        for (id, desired) in &infra_map.custom_views {
            if let Some(actual) = actual_custom_views.get(id) {
                if !custom_views_are_equivalent(actual, desired, &infra_map.default_database) {
                    debug!("Found mismatch in custom view: {}", id);
                    mismatched_custom_views.push(OlapChange::CustomView(Change::Updated {
                        before: Box::new(actual.clone()),
                        after: Box::new(desired.clone()),
                    }));
                }
            }
        }

        debug!(
            "Found {} mismatched custom views",
            mismatched_custom_views.len()
        );

        let discrepancies = InfraDiscrepancies {
            unmapped_tables,
            missing_tables,
            mismatched_tables,
            unmapped_sql_resources,
            missing_sql_resources,
            mismatched_sql_resources,
            unmapped_materialized_views,
            missing_materialized_views,
            mismatched_materialized_views,
            unmapped_custom_views,
            missing_custom_views,
            mismatched_custom_views,
        };

        debug!(
            "Reality check complete. Found {} unmapped, {} missing, and {} mismatched tables, \
            {} unmapped SQL resources, {} missing SQL resources, {} mismatched SQL resources, \
            {} unmapped MVs, {} missing MVs, {} mismatched MVs, \
            {} unmapped custom views, {} missing custom views, {} mismatched custom views",
            discrepancies.unmapped_tables.len(),
            discrepancies.missing_tables.len(),
            discrepancies.mismatched_tables.len(),
            discrepancies.unmapped_sql_resources.len(),
            discrepancies.missing_sql_resources.len(),
            discrepancies.mismatched_sql_resources.len(),
            discrepancies.unmapped_materialized_views.len(),
            discrepancies.missing_materialized_views.len(),
            discrepancies.mismatched_materialized_views.len(),
            discrepancies.unmapped_custom_views.len(),
            discrepancies.missing_custom_views.len(),
            discrepancies.mismatched_custom_views.len()
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
        sql_resources: Vec<SqlResource>,
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
        ) -> Result<
            Vec<crate::framework::core::infrastructure::sql_resource::SqlResource>,
            OlapChangesError,
        > {
            Ok(self.sql_resources.clone())
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
            docker_config: crate::project::DockerConfig::default(),
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
                codec: None,
                materialized: None,
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
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        }
    }

    #[tokio::test]
    async fn test_reality_checker_basic() {
        // Create a mock table
        let table = create_base_table("test_table");

        // Create mock OLAP client with one table
        let mock_client = MockOlapClient {
            tables: vec![Table {
                database: Some(DEFAULT_DATABASE_NAME.to_string()),
                ..table.clone()
            }],
            sql_resources: vec![],
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
            materialized_views: HashMap::new(),
            custom_views: HashMap::new(),
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
        infra_map
            .tables
            .insert(table.id(DEFAULT_DATABASE_NAME), table);

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
            codec: None,
            materialized: None,
        });

        let mock_client = MockOlapClient {
            tables: vec![Table {
                database: Some(DEFAULT_DATABASE_NAME.to_string()),
                ..actual_table.clone()
            }],
            sql_resources: vec![],
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
            materialized_views: HashMap::new(),
            custom_views: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.id(DEFAULT_DATABASE_NAME), infra_table);

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
            codec: None,
            materialized: None,
        };
        actual_table.columns.push(timestamp_col.clone());
        infra_table.columns.push(timestamp_col);

        // Set different order_by in actual vs infra
        actual_table.order_by = OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string()]);
        infra_table.order_by = OrderBy::Fields(vec!["id".to_string()]);

        let mock_client = MockOlapClient {
            tables: vec![Table {
                database: Some(DEFAULT_DATABASE_NAME.to_string()),
                ..actual_table.clone()
            }],
            sql_resources: vec![],
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
            materialized_views: HashMap::new(),
            custom_views: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.id(DEFAULT_DATABASE_NAME), infra_table);

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
        actual_table.engine = ClickhouseEngine::ReplacingMergeTree {
            ver: None,
            is_deleted: None,
        };
        infra_table.engine = ClickhouseEngine::MergeTree;

        let mock_client = MockOlapClient {
            tables: vec![Table {
                database: Some(DEFAULT_DATABASE_NAME.to_string()),
                ..actual_table.clone()
            }],
            sql_resources: vec![],
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
            materialized_views: HashMap::new(),
            custom_views: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.id(DEFAULT_DATABASE_NAME), infra_table);

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
                    &before.engine,
                    ClickhouseEngine::ReplacingMergeTree { .. }
                ));
                assert!(matches!(&after.engine, ClickhouseEngine::MergeTree));
            }
            _ => panic!("Expected TableChange::Updated variant"),
        }
    }

    #[tokio::test]
    async fn test_reality_checker_replicated_vs_mergetree_mismatch() {
        // This test simulates the user's bug report:
        // - ClickHouse actually has ReplicatedReplacingMergeTree
        // - Stored infra map has MergeTree
        // - We should detect a mismatch
        let mut actual_table = create_base_table("test_table");
        let mut infra_table = create_base_table("test_table");

        // ClickHouse has ReplicatedReplacingMergeTree (with empty params - cloud mode)
        actual_table.engine = ClickhouseEngine::ReplicatedReplacingMergeTree {
            keeper_path: None,
            replica_name: None,
            ver: None,
            is_deleted: None,
        };
        // Stored infra map has MergeTree (potentially from older deployment)
        infra_table.engine = ClickhouseEngine::MergeTree;

        let mock_client = MockOlapClient {
            tables: vec![Table {
                database: Some(DEFAULT_DATABASE_NAME.to_string()),
                ..actual_table.clone()
            }],
            sql_resources: vec![],
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
            materialized_views: HashMap::new(),
            custom_views: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.id(DEFAULT_DATABASE_NAME), infra_table);

        let checker = InfraRealityChecker::new(mock_client);
        let project = create_test_project();

        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        assert!(discrepancies.unmapped_tables.is_empty());
        assert!(discrepancies.missing_tables.is_empty());
        assert_eq!(
            discrepancies.mismatched_tables.len(),
            1,
            "Should detect engine mismatch between ReplicatedReplacingMergeTree and MergeTree"
        );

        // Verify the change shows reality has ReplicatedReplacingMergeTree
        match &discrepancies.mismatched_tables[0] {
            OlapChange::Table(TableChange::Updated { before, after, .. }) => {
                assert!(
                    matches!(
                        &before.engine,
                        ClickhouseEngine::ReplicatedReplacingMergeTree { .. }
                    ),
                    "before (reality) should have ReplicatedReplacingMergeTree, got {:?}",
                    before.engine
                );
                assert!(
                    matches!(&after.engine, ClickhouseEngine::MergeTree),
                    "after (infra map) should have MergeTree, got {:?}",
                    after.engine
                );
            }
            _ => panic!("Expected TableChange::Updated variant"),
        }
    }

    #[tokio::test]
    async fn test_reality_checker_sql_resource_mismatch() {
        let actual_resource = SqlResource {
            name: "test_view".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec!["CREATE VIEW test_view AS SELECT 1".to_string()],
            teardown: vec!["DROP VIEW test_view".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        let infra_resource = SqlResource {
            name: "test_view".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec!["CREATE VIEW test_view AS SELECT 2".to_string()], // Difference here
            teardown: vec!["DROP VIEW test_view".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        let mock_client = MockOlapClient {
            tables: vec![],
            sql_resources: vec![actual_resource.clone()],
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
            materialized_views: HashMap::new(),
            custom_views: HashMap::new(),
        };

        infra_map
            .sql_resources
            .insert(infra_resource.name.clone(), infra_resource.clone());

        let checker = InfraRealityChecker::new(mock_client);
        let project = create_test_project();

        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        assert!(discrepancies.unmapped_sql_resources.is_empty());
        assert!(discrepancies.missing_sql_resources.is_empty());
        assert_eq!(discrepancies.mismatched_sql_resources.len(), 1);

        match &discrepancies.mismatched_sql_resources[0] {
            OlapChange::SqlResource(Change::Updated { before, after }) => {
                assert_eq!(before.name, "test_view");
                assert_eq!(after.name, "test_view");
                assert_eq!(before.setup[0], "CREATE VIEW test_view AS SELECT 1");
                assert_eq!(after.setup[0], "CREATE VIEW test_view AS SELECT 2");
            }
            _ => panic!("Expected SqlResource Updated variant"),
        }
    }

    // Unit tests for find_table_from_infra_map function
    // These test the fix for ENG-1689: database matching in fallback path

    #[test]
    fn test_find_table_exact_id_match() {
        let table = Table {
            database: Some("custom_db".to_string()),
            ..create_base_table("test_table")
        };

        let mut infra_map_tables = HashMap::new();
        let infra_table = Table {
            database: Some("custom_db".to_string()),
            ..create_base_table("test_table")
        };
        let table_id = infra_table.id(DEFAULT_DATABASE_NAME);
        infra_map_tables.insert(table_id.clone(), infra_table);

        let result = find_table_from_infra_map(&table, &infra_map_tables, DEFAULT_DATABASE_NAME);
        assert_eq!(result, Some(table_id));
    }

    #[test]
    fn test_find_table_fallback_infra_map_no_database() {
        // When infra_map entry has no database, it should match any table
        let table = Table {
            database: Some("custom_db".to_string()),
            ..create_base_table("test_table")
        };

        let mut infra_map_tables = HashMap::new();
        let infra_table = Table {
            database: None, // No database in infra_map
            ..create_base_table("test_table")
        };
        let infra_table_id = infra_table.id(DEFAULT_DATABASE_NAME);
        infra_map_tables.insert(infra_table_id.clone(), infra_table);

        let result = find_table_from_infra_map(&table, &infra_map_tables, DEFAULT_DATABASE_NAME);
        assert_eq!(result, Some(infra_table_id));
    }

    #[test]
    fn test_find_table_fallback_matching_databases() {
        // FIX for ENG-1689: When both have matching databases, should match
        let table = Table {
            database: Some("custom_db".to_string()),
            ..create_base_table("test_table")
        };

        let mut infra_map_tables = HashMap::new();
        // Use a different key to force fallback path
        let infra_table = Table {
            database: Some("custom_db".to_string()),
            ..create_base_table("test_table")
        };
        let wrong_key = "wrong_key_custom_db_test_table_1_0_0".to_string();
        infra_map_tables.insert(wrong_key.clone(), infra_table);

        let result = find_table_from_infra_map(&table, &infra_map_tables, DEFAULT_DATABASE_NAME);
        assert_eq!(
            result,
            Some(wrong_key),
            "Should match via fallback when databases are equal"
        );
    }

    #[test]
    fn test_find_table_fallback_mismatching_databases() {
        // Tables in different databases should NOT match
        let table = Table {
            database: Some("custom_db".to_string()),
            ..create_base_table("test_table")
        };

        let mut infra_map_tables = HashMap::new();
        let infra_table = Table {
            database: Some("other_db".to_string()), // Different database
            ..create_base_table("test_table")
        };
        let wrong_key = "wrong_key_other_db_test_table_1_0_0".to_string();
        infra_map_tables.insert(wrong_key, infra_table);

        let result = find_table_from_infra_map(&table, &infra_map_tables, DEFAULT_DATABASE_NAME);
        assert_eq!(
            result, None,
            "Should NOT match when databases are different"
        );
    }

    #[test]
    fn test_find_table_fallback_infra_has_db_table_has_none() {
        // When infra_map has database but table doesn't, should NOT match
        let table = Table {
            database: None,
            ..create_base_table("test_table")
        };

        let mut infra_map_tables = HashMap::new();
        let infra_table = Table {
            database: Some("custom_db".to_string()),
            ..create_base_table("test_table")
        };
        let wrong_key = "wrong_key_custom_db_test_table_1_0_0".to_string();
        infra_map_tables.insert(wrong_key, infra_table);

        let result = find_table_from_infra_map(&table, &infra_map_tables, DEFAULT_DATABASE_NAME);
        assert_eq!(
            result, None,
            "Should NOT match when infra has DB but table doesn't"
        );
    }

    #[test]
    fn test_find_table_version_mismatch_no_match() {
        // Different versions should NOT match
        let mut table = create_base_table("test_table");
        table.database = Some("custom_db".to_string());
        table.version = Some(Version::from_string("2.0.0".to_string()));

        let mut infra_map_tables = HashMap::new();
        let mut infra_table = create_base_table("test_table");
        infra_table.database = Some("custom_db".to_string());
        infra_table.version = Some(Version::from_string("1.0.0".to_string()));
        let wrong_key = "wrong_key_custom_db_test_table_1_0_0".to_string();
        infra_map_tables.insert(wrong_key, infra_table);

        let result = find_table_from_infra_map(&table, &infra_map_tables, DEFAULT_DATABASE_NAME);
        assert_eq!(result, None, "Should NOT match when versions are different");
    }

    #[tokio::test]
    async fn test_reality_checker_custom_database_engine_mismatch() {
        // This test verifies the ENG-1689 fix:
        // Tables in custom databases should properly match and detect engine mismatches
        let mut actual_table = create_base_table("test_table");
        let mut infra_table = create_base_table("test_table");

        // Both tables are in a custom database
        actual_table.database = Some("custom_db".to_string());
        infra_table.database = Some("custom_db".to_string());

        // ClickHouse has ReplicatedReplacingMergeTree
        actual_table.engine = ClickhouseEngine::ReplicatedReplacingMergeTree {
            keeper_path: None,
            replica_name: None,
            ver: None,
            is_deleted: None,
        };
        // Infra map has the correct engine too
        infra_table.engine = ClickhouseEngine::ReplicatedReplacingMergeTree {
            keeper_path: None,
            replica_name: None,
            ver: None,
            is_deleted: None,
        };

        let mock_client = MockOlapClient {
            tables: vec![actual_table.clone()],
            sql_resources: vec![],
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
            materialized_views: HashMap::new(),
            custom_views: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.id(DEFAULT_DATABASE_NAME), infra_table);

        let checker = InfraRealityChecker::new(mock_client);
        let mut project = create_test_project();
        project.clickhouse_config.additional_databases = vec!["custom_db".to_string()];

        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        // Should find no discrepancies since engines match
        assert!(
            discrepancies.unmapped_tables.is_empty(),
            "Should not have unmapped tables - the fix should allow matching tables in custom databases"
        );
        assert!(discrepancies.missing_tables.is_empty());
        assert!(
            discrepancies.mismatched_tables.is_empty(),
            "Should not have mismatched tables since engines are the same"
        );
    }

    #[tokio::test]
    async fn test_reality_checker_custom_database_detects_engine_difference() {
        // This test verifies that after the ENG-1689 fix, we properly detect
        // engine differences in custom database tables
        let mut actual_table = create_base_table("test_table");
        let mut infra_table = create_base_table("test_table");

        // Both tables are in a custom database
        actual_table.database = Some("custom_db".to_string());
        infra_table.database = Some("custom_db".to_string());

        // ClickHouse has ReplicatedReplacingMergeTree
        actual_table.engine = ClickhouseEngine::ReplicatedReplacingMergeTree {
            keeper_path: None,
            replica_name: None,
            ver: None,
            is_deleted: None,
        };
        // Infra map incorrectly has MergeTree (the bug scenario)
        infra_table.engine = ClickhouseEngine::MergeTree;

        let mock_client = MockOlapClient {
            tables: vec![actual_table.clone()],
            sql_resources: vec![],
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
            materialized_views: HashMap::new(),
            custom_views: HashMap::new(),
        };

        infra_map
            .tables
            .insert(infra_table.id(DEFAULT_DATABASE_NAME), infra_table);

        let checker = InfraRealityChecker::new(mock_client);
        let mut project = create_test_project();
        project.clickhouse_config.additional_databases = vec!["custom_db".to_string()];

        let discrepancies = checker.check_reality(&project, &infra_map).await.unwrap();

        // Should properly match the table and detect the engine mismatch
        assert!(
            discrepancies.unmapped_tables.is_empty(),
            "Should not have unmapped tables - the fix allows matching"
        );
        assert!(discrepancies.missing_tables.is_empty());
        assert_eq!(
            discrepancies.mismatched_tables.len(),
            1,
            "Should detect the engine mismatch in custom database table"
        );

        // Verify the mismatch is about the engine
        match &discrepancies.mismatched_tables[0] {
            OlapChange::Table(TableChange::Updated { before, after, .. }) => {
                assert!(
                    matches!(
                        &before.engine,
                        ClickhouseEngine::ReplicatedReplacingMergeTree { .. }
                    ),
                    "before (reality) should have ReplicatedReplacingMergeTree"
                );
                assert!(
                    matches!(&after.engine, ClickhouseEngine::MergeTree),
                    "after (infra map) should have MergeTree"
                );
            }
            _ => panic!("Expected TableChange::Updated variant"),
        }
    }
}
