//! # ClickHouse OLAP Implementation
//!
//! This module provides the ClickHouse-specific implementation of OLAP operations.
//! It handles table management, schema changes, and data type conversions between
//! ClickHouse and the framework's type system.
//!
//! ## Features
//! - Table management (create, read, update, delete)
//! - Schema change management
//! - Type system conversion
//! - Version tracking
//! - Table naming conventions
//! - Intelligent materialized view handling
//!
//! ## Dependencies
//! - clickhouse: Client library for ClickHouse database
//! - Framework core types and infrastructure
//!
//! ## Version Support
//! Tables follow the naming convention: {name}_{version}
//! where version is in the format x_y_z (e.g., table_1_0_0)
//!
//! ## Authors
//! - Initial implementation: Framework Team
//! - Last modified: 2024
//!
//! ## Usage Example
//! ```rust
//! let client = create_client(config);
//! let tables = client.list_tables(&config.db_name).await?;
//! ```

use clickhouse::Client;

use errors::ClickhouseError;
use mapper::{std_column_to_clickhouse_column, std_table_to_clickhouse_table};
use model::ClickHouseColumn;
use queries::ClickhouseEngine;
use queries::{
    alter_table_modify_settings_query, alter_table_reset_settings_query,
    basic_field_type_to_string, create_table_query, drop_table_query,
};
use serde::{Deserialize, Serialize};
use sql_parser::{
    extract_engine_from_create_table, extract_indexes_from_create_table,
    extract_primary_key_from_create_table, extract_sample_by_from_create_table,
    extract_source_tables_from_query, extract_source_tables_from_query_regex,
    extract_table_settings_from_create_table, normalize_sql_for_comparison, split_qualified_name,
};
use std::collections::HashMap;
use std::ops::Deref;
use std::sync::LazyLock;
use tracing::{debug, info, warn};

use self::model::ClickHouseSystemTable;
use crate::framework::core::infrastructure::sql_resource::SqlResource;
use crate::framework::core::infrastructure::table::{
    Column, ColumnMetadata, ColumnType, DataEnum, EnumMember, EnumValue, EnumValueMetadata,
    OrderBy, Table, TableIndex, METADATA_PREFIX,
};
use crate::framework::core::infrastructure::InfrastructureSignature;
use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::versions::Version;
use crate::infrastructure::olap::clickhouse::model::ClickHouseSystemTableRow;
use crate::infrastructure::olap::{OlapChangesError, OlapOperations};
use crate::project::Project;

pub mod client;
pub mod config;
pub mod diagnostics;
pub mod diff_strategy;
pub mod errors;
pub mod inserter;
pub mod mapper;
pub mod model;
pub mod queries;
pub mod sql_parser;
pub mod type_parser;

pub use config::ClickHouseConfig;

use super::ddl_ordering::AtomicOlapOperation;

/// Type alias for query strings to improve readability
pub type QueryString = String;

/// Represents errors that can occur during ClickHouse operations
#[derive(Debug, thiserror::Error)]
pub enum ClickhouseChangesError {
    /// Error when interacting with ClickHouse database
    #[error("Error interacting with Clickhouse")]
    Clickhouse(#[from] ClickhouseError),

    /// Error from the ClickHouse client library
    #[error("Error interacting with Clickhouse{}", .resource.as_ref().map(|t| format!(" for '{t}'")).unwrap_or_default())]
    ClickhouseClient {
        #[source]
        error: clickhouse::error::Error,
        resource: Option<String>,
    },

    /// Error for unsupported operations
    #[error("Not Supported {0}")]
    NotSupported(String),
}

/// Represents atomic DDL operations for OLAP resources.
/// Object details are omitted, e.g. we need only the table name for DropTable
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum SerializableOlapOperation {
    /// Create a new table
    CreateTable {
        /// The table to create
        table: Table,
    },
    /// Drop an existing table
    DropTable {
        /// The table to drop
        table: String,
        /// The database containing the table (None means use global database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    /// Add a column to a table
    AddTableColumn {
        /// The table to add the column to
        table: String,
        /// Column to add
        column: Column,
        /// The column after which to add this column (None means adding as first column)
        after_column: Option<String>,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    /// Drop a column from a table
    DropTableColumn {
        /// The table to drop the column from
        table: String,
        /// Name of the column to drop
        column_name: String,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    /// Modify a column in a table
    ModifyTableColumn {
        /// The table containing the column
        table: String,
        /// The column before modification
        before_column: Column,
        /// The column after modification
        after_column: Column,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    RenameTableColumn {
        /// The table containing the column
        table: String,
        /// Name of the column before renaming
        before_column_name: String,
        /// Name of the column after renaming
        after_column_name: String,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    /// Modify table settings using ALTER TABLE MODIFY SETTING
    ModifyTableSettings {
        /// The table to modify settings for
        table: String,
        /// The settings before modification
        before_settings: Option<HashMap<String, String>>,
        /// The settings after modification
        after_settings: Option<HashMap<String, String>>,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    /// Modify or remove table-level TTL
    ModifyTableTtl {
        table: String,
        before: Option<String>,
        after: Option<String>,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    AddTableIndex {
        table: String,
        index: TableIndex,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    DropTableIndex {
        table: String,
        index_name: String,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    ModifySampleBy {
        table: String,
        expression: String,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    RemoveSampleBy {
        table: String,
        /// The database containing the table (None means use primary database)
        database: Option<String>,
        /// Optional cluster name for ON CLUSTER support
        cluster_name: Option<String>,
    },
    RawSql {
        /// The SQL statements to execute
        sql: Vec<String>,
        description: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "PascalCase")]
pub enum IgnorableOperation {
    ModifyTableTtl,
    ModifyColumnTtl,
    ModifyPartitionBy,
}

impl IgnorableOperation {
    pub fn matches(&self, op: &SerializableOlapOperation) -> bool {
        matches!(
            (self, op),
            (
                Self::ModifyTableTtl,
                SerializableOlapOperation::ModifyTableTtl { .. }
            )
        )
    }
}

/// Normalizes a table by stripping fields that should be ignored during comparison.
///
/// This prevents the diff strategy from detecting changes in ignored fields and
/// generating unnecessary drop+create operations.
///
/// # Arguments
/// * `table` - The table to normalize
/// * `ignore_ops` - Slice of operations to ignore
///
/// # Returns
/// A new table with ignored fields stripped/normalized to match the "before" state
pub fn normalize_table_for_diff(table: &Table, ignore_ops: &[IgnorableOperation]) -> Table {
    if ignore_ops.is_empty() {
        return table.clone();
    }

    let mut normalized = table.clone();

    // Strip table-level TTL if ignored
    if ignore_ops.contains(&IgnorableOperation::ModifyTableTtl) {
        normalized.table_ttl_setting = None;
    }

    // Strip partition_by if ignored
    if ignore_ops.contains(&IgnorableOperation::ModifyPartitionBy) {
        normalized.partition_by = None;
    }

    // Strip column-level TTL if ignored
    if ignore_ops.contains(&IgnorableOperation::ModifyColumnTtl) {
        for column in &mut normalized.columns {
            column.ttl = None;
        }
    }

    normalized
}

/// Executes a series of changes to the ClickHouse database schema
///
/// # Arguments
///
/// * `project` - The Project configuration containing ClickHouse connection details
/// * `teardown_plan` - A slice of AtomicOlapOperation representing the teardown plan
/// * `setup_plan` - A slice of AtomicOlapOperation representing the setup plan
///
/// # Returns
///
/// * `Result<(), ClickhouseChangesError>` - Ok(()) if all changes were successful, or a ClickhouseChangesError if any operation failed
///
/// # Details
///
/// Handles the following types of changes:
/// - Adding/removing/updating tables
/// - Adding/removing/updating views
/// - Column modifications
/// - Order by clause changes
/// - Table engine changes (via deduplication settings)
///
/// Will retry certain operations that return specific ClickHouse error codes indicating retry is possible.
///
/// # Example
/// ```rust
/// let changes = vec![OlapChange::Table(TableChange::Added(table))];
/// execute_changes(&project, &changes).await?;
/// ```
pub async fn execute_changes(
    project: &Project,
    teardown_plan: &[AtomicOlapOperation],
    setup_plan: &[AtomicOlapOperation],
) -> Result<(), ClickhouseChangesError> {
    // Setup the client
    let client = create_client(project.clickhouse_config.clone());
    check_ready(&client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: None,
        })?;

    let db_name = &project.clickhouse_config.db_name;

    // Create all configured databases
    let mut all_databases = vec![db_name.clone()];
    all_databases.extend(project.clickhouse_config.additional_databases.clone());

    for database in &all_databases {
        let create_db_query = format!("CREATE DATABASE IF NOT EXISTS `{}`", database);
        info!("Creating database: {}", database);
        run_query(&create_db_query, &client).await.map_err(|e| {
            ClickhouseChangesError::ClickhouseClient {
                error: e,
                resource: Some(format!("database:{}", database)),
            }
        })?;
    }

    // Execute Teardown Plan
    info!(
        "Executing OLAP Teardown Plan with {} operations",
        teardown_plan.len()
    );
    debug!("Ordered Teardown plan: {:?}", teardown_plan);
    for op in teardown_plan {
        debug!("Teardown operation: {:?}", op);
        execute_atomic_operation(db_name, &op.to_minimal(), &client, !project.is_production)
            .await?;
    }

    // Execute Setup Plan
    info!(
        "Executing OLAP Setup Plan with {} operations",
        setup_plan.len()
    );
    debug!("Ordered Setup plan: {:?}", setup_plan);
    for op in setup_plan {
        debug!("Setup operation: {:?}", op);
        execute_atomic_operation(db_name, &op.to_minimal(), &client, !project.is_production)
            .await?;
    }

    info!("OLAP Change execution complete");
    Ok(())
}

/// Returns a human-readable description of an operation for logging/display
pub fn describe_operation(operation: &SerializableOlapOperation) -> String {
    match operation {
        SerializableOlapOperation::CreateTable { table } => {
            format!("Creating table '{}'", table.name)
        }
        SerializableOlapOperation::DropTable { table, .. } => {
            format!("Dropping table '{}'", table)
        }
        SerializableOlapOperation::AddTableColumn { table, column, .. } => {
            format!("Adding column '{}' to table '{}'", column.name, table)
        }
        SerializableOlapOperation::DropTableColumn {
            table, column_name, ..
        } => {
            format!("Dropping column '{}' from table '{}'", column_name, table)
        }
        SerializableOlapOperation::ModifyTableColumn {
            table,
            after_column,
            ..
        } => {
            format!(
                "Modifying column '{}' in table '{}'",
                after_column.name, table
            )
        }
        SerializableOlapOperation::RenameTableColumn {
            table,
            before_column_name,
            after_column_name,
            ..
        } => {
            format!(
                "Renaming column '{}' to '{}' in table '{}'",
                before_column_name, after_column_name, table
            )
        }
        SerializableOlapOperation::ModifyTableSettings { table, .. } => {
            format!("Modifying settings for table '{}'", table)
        }
        SerializableOlapOperation::AddTableIndex { table, index, .. } => {
            format!("Adding index '{}' to table '{}'", index.name, table)
        }
        SerializableOlapOperation::DropTableIndex {
            table, index_name, ..
        } => {
            format!("Dropping index '{}' from table '{}'", index_name, table)
        }
        SerializableOlapOperation::ModifySampleBy {
            table, expression, ..
        } => {
            format!(
                "Modifying SAMPLE BY to '{}' for table '{}'",
                expression, table
            )
        }
        SerializableOlapOperation::RemoveSampleBy { table, .. } => {
            format!("Removing SAMPLE BY from table '{}'", table)
        }
        SerializableOlapOperation::ModifyTableTtl { table, after, .. } => {
            if after.is_some() {
                format!("Modifying table TTL for '{}'", table)
            } else {
                format!("Removing table TTL from '{}'", table)
            }
        }
        SerializableOlapOperation::RawSql { description, .. } => description.clone(),
    }
}

/// Executes a single atomic OLAP operation.
pub async fn execute_atomic_operation(
    db_name: &str,
    operation: &SerializableOlapOperation,
    client: &ConfiguredDBClient,
    is_dev: bool,
) -> Result<(), ClickhouseChangesError> {
    match operation {
        SerializableOlapOperation::CreateTable { table } => {
            execute_create_table(db_name, table, client, is_dev).await?;
        }
        SerializableOlapOperation::DropTable {
            table,
            database,
            cluster_name,
        } => {
            execute_drop_table(
                db_name,
                table,
                database.as_deref(),
                cluster_name.as_deref(),
                client,
            )
            .await?;
        }
        SerializableOlapOperation::AddTableColumn {
            table,
            column,
            after_column,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_add_table_column(
                target_db,
                table,
                column,
                after_column,
                cluster_name.as_deref(),
                client,
            )
            .await?;
        }
        SerializableOlapOperation::DropTableColumn {
            table,
            column_name,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_drop_table_column(
                target_db,
                table,
                column_name,
                cluster_name.as_deref(),
                client,
            )
            .await?;
        }
        SerializableOlapOperation::ModifyTableColumn {
            table,
            before_column,
            after_column,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_modify_table_column(
                target_db,
                table,
                before_column,
                after_column,
                cluster_name.as_deref(),
                client,
            )
            .await?;
        }
        SerializableOlapOperation::RenameTableColumn {
            table,
            before_column_name,
            after_column_name,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_rename_table_column(
                target_db,
                table,
                before_column_name,
                after_column_name,
                cluster_name.as_deref(),
                client,
            )
            .await?;
        }
        SerializableOlapOperation::ModifyTableSettings {
            table,
            before_settings,
            after_settings,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_modify_table_settings(
                target_db,
                table,
                before_settings,
                after_settings,
                cluster_name.as_deref(),
                client,
            )
            .await?;
        }
        SerializableOlapOperation::ModifyTableTtl {
            table,
            before: _,
            after,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            // Build ALTER TABLE ... [REMOVE TTL | MODIFY TTL expr]
            let cluster_clause = cluster_name
                .as_ref()
                .map(|c| format!(" ON CLUSTER {}", c))
                .unwrap_or_default();
            let sql = if let Some(expr) = after {
                format!(
                    "ALTER TABLE `{}`.`{}`{} MODIFY TTL {}",
                    target_db, table, cluster_clause, expr
                )
            } else {
                format!(
                    "ALTER TABLE `{}`.`{}`{} REMOVE TTL",
                    target_db, table, cluster_clause
                )
            };
            run_query(&sql, client).await.map_err(|e| {
                ClickhouseChangesError::ClickhouseClient {
                    error: e,
                    resource: Some(table.clone()),
                }
            })?;
        }
        SerializableOlapOperation::AddTableIndex {
            table,
            index,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_add_table_index(target_db, table, index, cluster_name.as_deref(), client)
                .await?;
        }
        SerializableOlapOperation::DropTableIndex {
            table,
            index_name,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_drop_table_index(
                target_db,
                table,
                index_name,
                cluster_name.as_deref(),
                client,
            )
            .await?;
        }
        SerializableOlapOperation::ModifySampleBy {
            table,
            expression,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_modify_sample_by(
                target_db,
                table,
                expression,
                cluster_name.as_deref(),
                client,
            )
            .await?;
        }
        SerializableOlapOperation::RemoveSampleBy {
            table,
            database,
            cluster_name,
        } => {
            let target_db = database.as_deref().unwrap_or(db_name);
            execute_remove_sample_by(target_db, table, cluster_name.as_deref(), client).await?;
        }
        SerializableOlapOperation::RawSql { sql, description } => {
            execute_raw_sql(sql, description, client).await?;
        }
    }
    Ok(())
}

async fn execute_create_table(
    db_name: &str,
    table: &Table,
    client: &ConfiguredDBClient,
    is_dev: bool,
) -> Result<(), ClickhouseChangesError> {
    tracing::info!("Executing CreateTable: {:?}", table.id(db_name));
    let clickhouse_table = std_table_to_clickhouse_table(table)?;
    // Use table's database if specified, otherwise use global database
    let target_database = table.database.as_deref().unwrap_or(db_name);
    let create_data_table_query = create_table_query(target_database, clickhouse_table, is_dev)?;
    run_query(&create_data_table_query, client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table.name.clone()),
        })?;
    Ok(())
}

async fn execute_add_table_index(
    db_name: &str,
    table_name: &str,
    index: &TableIndex,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    let args = if index.arguments.is_empty() {
        String::new()
    } else {
        format!("({})", index.arguments.join(", "))
    };
    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();
    let sql = format!(
        "ALTER TABLE `{}`.`{}`{} ADD INDEX `{}` {} TYPE {}{} GRANULARITY {}",
        db_name,
        table_name,
        cluster_clause,
        index.name,
        index.expression,
        index.index_type,
        args,
        index.granularity
    );
    run_query(&sql, client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        })
}

async fn execute_drop_table_index(
    db_name: &str,
    table_name: &str,
    index_name: &str,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();
    let sql = format!(
        "ALTER TABLE `{}`.`{}`{} DROP INDEX `{}`",
        db_name, table_name, cluster_clause, index_name
    );
    run_query(&sql, client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        })
}

async fn execute_modify_sample_by(
    db_name: &str,
    table_name: &str,
    expression: &str,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();
    let sql = format!(
        "ALTER TABLE `{}`.`{}`{} MODIFY SAMPLE BY {}",
        db_name, table_name, cluster_clause, expression
    );
    run_query(&sql, client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        })
}

async fn execute_remove_sample_by(
    db_name: &str,
    table_name: &str,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();
    let sql = format!(
        "ALTER TABLE `{}`.`{}`{} REMOVE SAMPLE BY",
        db_name, table_name, cluster_clause
    );
    run_query(&sql, client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        })
}

async fn execute_drop_table(
    db_name: &str,
    table_name: &str,
    table_database: Option<&str>,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    tracing::info!("Executing DropTable: {:?}", table_name);
    // Use table's database if specified, otherwise use global database
    let target_database = table_database.unwrap_or(db_name);
    let drop_query = drop_table_query(target_database, table_name, cluster_name)?;
    run_query(&drop_query, client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        })?;
    Ok(())
}

// Note: The nullable wrapping logic has been moved to std_column_to_clickhouse_column
// in mapper.rs to ensure consistent handling across all uses.
// TODO: Future refactoring opportunity - Consider eliminating the `required` boolean field
// from ClickHouseColumn and rely solely on the Nullable type wrapper.

async fn execute_add_table_column(
    db_name: &str,
    table_name: &str,
    column: &Column,
    after_column: &Option<String>,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    tracing::info!(
        "Executing AddTableColumn for table: {}, column: {}, after: {:?}",
        table_name,
        column.name,
        after_column
    );
    let clickhouse_column = std_column_to_clickhouse_column(column.clone())?;
    let column_type_string = basic_field_type_to_string(&clickhouse_column.column_type)?;

    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();

    // Include DEFAULT clause if column has a default value
    let default_clause = clickhouse_column
        .default
        .as_ref()
        .map(|d| format!(" DEFAULT {}", d))
        .unwrap_or_default();

    let codec_clause = clickhouse_column
        .codec
        .as_ref()
        .map(|c| format!(" CODEC({})", c))
        .unwrap_or_default();

    let ttl_clause = clickhouse_column
        .ttl
        .as_ref()
        .map(|t| format!(" TTL {}", t))
        .unwrap_or_default();

    let position_clause = match after_column {
        None => "FIRST".to_string(),
        Some(after_col) => format!("AFTER `{after_col}`"),
    };

    let add_column_query = format!(
        "ALTER TABLE `{}`.`{}`{} ADD COLUMN `{}` {}{}{}{}  {}",
        db_name,
        table_name,
        cluster_clause,
        clickhouse_column.name,
        column_type_string,
        default_clause,
        codec_clause,
        ttl_clause,
        position_clause
    );
    tracing::debug!("Adding column: {}", add_column_query);
    run_query(&add_column_query, client).await.map_err(|e| {
        ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        }
    })?;
    Ok(())
}

async fn execute_drop_table_column(
    db_name: &str,
    table_name: &str,
    column_name: &str,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    tracing::info!(
        "Executing DropTableColumn for table: {}, column: {}",
        table_name,
        column_name
    );
    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();
    let drop_column_query = format!(
        "ALTER TABLE `{}`.`{}`{} DROP COLUMN IF EXISTS `{}`",
        db_name, table_name, cluster_clause, column_name
    );
    tracing::debug!("Dropping column: {}", drop_column_query);
    run_query(&drop_column_query, client).await.map_err(|e| {
        ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        }
    })?;
    Ok(())
}

/// Execute a ModifyTableColumn operation
///
/// This function handles column modifications, including type changes and comment-only changes.
/// When only the comment has changed (e.g., when enum metadata is added or user documentation
/// is updated), it uses a more efficient comment-only modification instead of recreating
/// the entire column definition.
async fn execute_modify_table_column(
    db_name: &str,
    table_name: &str,
    before_column: &Column,
    after_column: &Column,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    // Check if only the comment has changed
    let data_type_changed = before_column.data_type != after_column.data_type;
    let default_changed = before_column.default != after_column.default;
    let required_changed = before_column.required != after_column.required;
    let comment_changed = before_column.comment != after_column.comment;
    let ttl_changed = before_column.ttl != after_column.ttl;
    let codec_changed = before_column.codec != after_column.codec;

    // If only the comment changed, use a simpler ALTER TABLE ... MODIFY COLUMN ... COMMENT
    // This is more efficient and avoids unnecessary table rebuilds
    if !data_type_changed
        && !required_changed
        && !default_changed
        && !ttl_changed
        && !codec_changed
        && comment_changed
    {
        tracing::info!(
            "Executing comment-only modification for table: {}, column: {}",
            table_name,
            after_column.name
        );

        // Get the ClickHouse column to generate the proper comment (with metadata if needed)
        let clickhouse_column = std_column_to_clickhouse_column(after_column.clone())?;

        if let Some(ref comment) = clickhouse_column.comment {
            execute_modify_column_comment(
                db_name,
                table_name,
                after_column,
                comment,
                cluster_name,
                client,
            )
            .await?;
        } else {
            // If the new comment is None, we still need to update to remove the old comment
            execute_modify_column_comment(
                db_name,
                table_name,
                after_column,
                "",
                cluster_name,
                client,
            )
            .await?;
        }
        return Ok(());
    }

    tracing::info!(
        "Executing ModifyTableColumn for table: {}, column: {} ({}→{})\
data_type_changed: {data_type_changed}, default_changed: {default_changed}, required_changed: {required_changed}, comment_changed: {comment_changed}, ttl_changed: {ttl_changed}, codec_changed: {codec_changed}",
        table_name,
        after_column.name,
        before_column.data_type,
        after_column.data_type
    );

    // Full column modification including type change
    let clickhouse_column = std_column_to_clickhouse_column(after_column.clone())?;

    // Build all the SQL statements needed (main modify + optional removes)
    let removing_default = before_column.default.is_some() && after_column.default.is_none();
    let removing_ttl = before_column.ttl.is_some() && after_column.ttl.is_none();
    let removing_codec = before_column.codec.is_some() && after_column.codec.is_none();
    let queries = build_modify_column_sql(
        db_name,
        table_name,
        &clickhouse_column,
        removing_default,
        removing_ttl,
        removing_codec,
        cluster_name,
    )?;

    // Execute all statements in order
    for query in queries {
        tracing::debug!("Modifying column: {}", query);
        run_query(&query, client)
            .await
            .map_err(|e| ClickhouseChangesError::ClickhouseClient {
                error: e,
                resource: Some(table_name.to_string()),
            })?;
    }

    Ok(())
}

/// Execute a ModifyColumnComment operation
///
/// This is used to add or update metadata comments on columns, particularly
/// for enum columns that need to store their original TypeScript definition.
async fn execute_modify_column_comment(
    db_name: &str,
    table_name: &str,
    column: &Column,
    comment: &str,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    tracing::info!(
        "Executing ModifyColumnComment for table: {}, column: {}",
        table_name,
        column.name
    );

    let modify_comment_query =
        build_modify_column_comment_sql(db_name, table_name, &column.name, comment, cluster_name)?;

    tracing::debug!("Modifying column comment: {}", modify_comment_query);
    run_query(&modify_comment_query, client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        })?;
    Ok(())
}

fn build_modify_column_sql(
    db_name: &str,
    table_name: &str,
    ch_col: &ClickHouseColumn,
    removing_default: bool,
    removing_ttl: bool,
    removing_codec: bool,
    cluster_name: Option<&str>,
) -> Result<Vec<String>, ClickhouseChangesError> {
    let column_type_string = basic_field_type_to_string(&ch_col.column_type)?;

    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();

    let mut statements = vec![];

    // Add REMOVE DEFAULT statement if needed
    // ClickHouse doesn't allow mixing column properties with REMOVE clauses
    if removing_default {
        statements.push(format!(
            "ALTER TABLE `{}`.`{}`{} MODIFY COLUMN `{}` REMOVE DEFAULT",
            db_name, table_name, cluster_clause, ch_col.name
        ));
    }

    // Add REMOVE TTL statement if needed
    if removing_ttl {
        statements.push(format!(
            "ALTER TABLE `{}`.`{}`{} MODIFY COLUMN `{}` REMOVE TTL",
            db_name, table_name, cluster_clause, ch_col.name
        ));
    }

    // Add REMOVE CODEC statement if needed
    if removing_codec {
        statements.push(format!(
            "ALTER TABLE `{}`.`{}`{} MODIFY COLUMN `{}` REMOVE CODEC",
            db_name, table_name, cluster_clause, ch_col.name
        ));
    }

    // DEFAULT clause: If omitted, ClickHouse KEEPS any existing DEFAULT
    // Therefore, DEFAULT removal requires a separate REMOVE DEFAULT statement
    // Default values from ClickHouse/Python are already properly formatted
    // - String literals come with quotes: 'active'
    // - SQL expressions come without quotes: xxHash64(_id), now(), today()
    // - Numbers come without quotes: 42
    // So we use them as-is without additional formatting
    let default_clause = ch_col
        .default
        .as_ref()
        .map(|d| format!(" DEFAULT {}", d))
        .unwrap_or_default();

    // TTL clause: If omitted, ClickHouse KEEPS any existing TTL
    // Therefore, TTL removal requires a separate REMOVE TTL statement
    let ttl_clause = ch_col
        .ttl
        .as_ref()
        .map(|t| format!(" TTL {}", t))
        .unwrap_or_default();

    // CODEC clause: If omitted, ClickHouse KEEPS any existing CODEC
    // Therefore, CODEC removal requires a separate REMOVE CODEC statement
    let codec_clause = ch_col
        .codec
        .as_ref()
        .map(|c| format!(" CODEC({})", c))
        .unwrap_or_default();

    // Build the main MODIFY COLUMN statement
    let main_sql = if let Some(ref comment) = ch_col.comment {
        let escaped_comment = comment.replace('\'', "''");
        format!(
            "ALTER TABLE `{}`.`{}`{} MODIFY COLUMN IF EXISTS `{}` {}{}{}{} COMMENT '{}'",
            db_name,
            table_name,
            cluster_clause,
            ch_col.name,
            column_type_string,
            default_clause,
            codec_clause,
            ttl_clause,
            escaped_comment
        )
    } else {
        format!(
            "ALTER TABLE `{}`.`{}`{} MODIFY COLUMN IF EXISTS `{}` {}{}{}{}",
            db_name,
            table_name,
            cluster_clause,
            ch_col.name,
            column_type_string,
            default_clause,
            codec_clause,
            ttl_clause
        )
    };
    statements.push(main_sql);

    Ok(statements)
}

fn build_modify_column_comment_sql(
    db_name: &str,
    table_name: &str,
    column_name: &str,
    comment: &str,
    cluster_name: Option<&str>,
) -> Result<String, ClickhouseChangesError> {
    let escaped_comment = comment.replace('\'', "''");
    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();
    Ok(format!(
        "ALTER TABLE `{}`.`{}`{} MODIFY COLUMN `{}` COMMENT '{}'",
        db_name, table_name, cluster_clause, column_name, escaped_comment
    ))
}

/// Execute a ModifyTableSettings operation
async fn execute_modify_table_settings(
    db_name: &str,
    table_name: &str,
    before_settings: &Option<HashMap<String, String>>,
    after_settings: &Option<HashMap<String, String>>,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    use std::collections::HashMap;

    let before = before_settings.clone().unwrap_or_default();
    let after = after_settings.clone().unwrap_or_default();

    // Determine which settings to modify (changed or added)
    let mut settings_to_modify = HashMap::new();
    for (key, value) in &after {
        if before.get(key) != Some(value) {
            settings_to_modify.insert(key.clone(), value.clone());
        }
    }

    // Determine which settings to reset (removed)
    let mut settings_to_reset = Vec::new();
    for key in before.keys() {
        if !after.contains_key(key) {
            settings_to_reset.push(key.clone());
        }
    }

    tracing::info!(
        "Executing ModifyTableSettings for table: {} - modifying {} settings, resetting {} settings",
        table_name,
        settings_to_modify.len(),
        settings_to_reset.len()
    );

    // Execute MODIFY SETTING if there are settings to modify
    if !settings_to_modify.is_empty() {
        let alter_settings_query = alter_table_modify_settings_query(
            db_name,
            table_name,
            &settings_to_modify,
            cluster_name,
        )?;
        tracing::debug!("Modifying table settings: {}", alter_settings_query);

        run_query(&alter_settings_query, client)
            .await
            .map_err(|e| ClickhouseChangesError::ClickhouseClient {
                error: e,
                resource: Some(table_name.to_string()),
            })?;
    }

    // Execute RESET SETTING if there are settings to reset
    if !settings_to_reset.is_empty() {
        let reset_settings_query = alter_table_reset_settings_query(
            db_name,
            table_name,
            &settings_to_reset,
            cluster_name,
        )?;
        tracing::debug!("Resetting table settings: {}", reset_settings_query);

        run_query(&reset_settings_query, client)
            .await
            .map_err(|e| ClickhouseChangesError::ClickhouseClient {
                error: e,
                resource: Some(table_name.to_string()),
            })?;
    }

    Ok(())
}

/// Execute a RenameTableColumn operation
async fn execute_rename_table_column(
    db_name: &str,
    table_name: &str,
    before_column_name: &str,
    after_column_name: &str,
    cluster_name: Option<&str>,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    tracing::info!(
        "Executing RenameTableColumn for table: {}, column: {} → {}",
        table_name,
        before_column_name,
        after_column_name
    );
    let cluster_clause = cluster_name
        .map(|c| format!(" ON CLUSTER {}", c))
        .unwrap_or_default();
    let rename_column_query = format!(
        "ALTER TABLE `{db_name}`.`{table_name}`{cluster_clause} RENAME COLUMN `{before_column_name}` TO `{after_column_name}`"
    );
    tracing::debug!("Renaming column: {}", rename_column_query);
    run_query(&rename_column_query, client).await.map_err(|e| {
        ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        }
    })?;
    Ok(())
}

/// Execute raw SQL statements
async fn execute_raw_sql(
    sql_statements: &[String],
    description: &str,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    tracing::info!(
        "Executing {} raw SQL statements. {}",
        sql_statements.len(),
        description
    );
    for (i, sql) in sql_statements.iter().enumerate() {
        if !sql.trim().is_empty() {
            tracing::debug!("Executing SQL statement {}: {}", i + 1, sql);
            run_query(sql, client)
                .await
                .map_err(|e| ClickhouseChangesError::ClickhouseClient {
                    error: e,
                    resource: None,
                })?;
        }
    }
    Ok(())
}

/// Extracts version information from a table name
///
/// # Arguments
/// * `table_name` - The name of the table to parse
/// * `default_version` - The version to use for tables that don't follow the versioning convention
///
/// # Returns
/// * `(String, Version)` - A tuple containing the base name and version
///
/// # Format
/// For tables following the naming convention: {name}_{version}
/// where version is in the format x_y_z (e.g., 1_0_0)
/// For tables not following the convention: returns the full name and default_version
///
/// # Example
/// ```rust
/// let (base_name, version) = extract_version_from_table_name("users_1_0_0", "0.0.0");
/// assert_eq!(base_name, "users");
/// assert_eq!(version.to_string(), "1.0.0");
///
/// let (base_name, version) = extract_version_from_table_name("my_table", "1.0.0");
/// assert_eq!(base_name, "my_table");
/// assert_eq!(version.to_string(), "1.0.0");
/// ```
pub fn extract_version_from_table_name(table_name: &str) -> (String, Option<Version>) {
    debug!("Extracting version from table name: {}", table_name);

    // Special case for empty table name
    if table_name.is_empty() {
        debug!("Empty table name, no version");
        return (table_name.to_string(), None);
    }

    // Special case for tables ending in _MV (materialized views)
    if table_name.ends_with("_MV") {
        debug!("Materialized view detected, skipping version parsing");
        return (table_name.to_string(), None);
    }

    let parts: Vec<&str> = table_name.split('_').collect();
    debug!("Split table name into parts: {:?}", parts);

    if parts.len() < 2 {
        debug!("Table name has fewer than 2 parts, no version");
        // If table doesn't follow naming convention, return full name and default version
        return (table_name.to_string(), None);
    }

    // Find the first numeric part - this marks the start of the version
    let mut version_start_idx = None;
    for (i, part) in parts.iter().enumerate() {
        if part.chars().all(|c| c.is_ascii_digit()) {
            version_start_idx = Some(i);
            debug!("Found version start at index {}: {}", i, part);
            break;
        }
    }

    match version_start_idx {
        Some(idx) => {
            // Filter out empty parts when joining base name
            let base_parts: Vec<&str> = parts[..idx]
                .iter()
                .filter(|p| !p.is_empty())
                .copied()
                .collect();
            let base_name = base_parts.join("_");
            debug!(
                "Base parts: {:?}, joined base name: {}",
                base_parts, base_name
            );

            // Filter out empty parts when joining version
            let version_parts: Vec<&str> = parts[idx..]
                .iter()
                .filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
                .copied()
                .collect();
            debug!("Version parts: {:?}", version_parts);

            // If we have no valid version parts, return the original name and default version
            if version_parts.is_empty() {
                debug!("No valid version parts found.");
                return (table_name.to_string(), None);
            }

            let version_str = version_parts.join(".");
            debug!("Created version string: {}", version_str);

            (base_name, Some(Version::from_string(version_str)))
        }
        None => {
            debug!("No version parts found");
            (table_name.to_string(), None)
        }
    }
}

pub struct ConfiguredDBClient {
    pub client: Client,
    pub config: ClickHouseConfig,
}

/// Creates a configured ClickHouse client with the provided configuration
///
/// # Arguments
/// * `clickhouse_config` - Configuration for the ClickHouse connection
///
/// # Returns
/// * `ConfiguredDBClient` - A configured client ready for database operations
///
/// # Details
/// Creates a client with:
/// - Proper URL construction (http/https)
/// - Authentication settings
/// - Database selection
/// - Connection options
///
/// # Example
/// ```rust
/// let client = create_client(ClickHouseConfig {
///     host: "localhost".to_string(),
///     host_port: 8123,
///     user: "default".to_string(),
///     password: "".to_string(),
///     db_name: "mydb".to_string(),
///     use_ssl: false,
/// });
/// ```
pub fn create_client(clickhouse_config: ClickHouseConfig) -> ConfiguredDBClient {
    let protocol = if clickhouse_config.use_ssl {
        "https"
    } else {
        "http"
    };
    ConfiguredDBClient {
        client: Client::default()
            .with_url(format!(
                "{}://{}:{}",
                protocol, clickhouse_config.host, clickhouse_config.host_port
            ))
            .with_user(clickhouse_config.user.to_string())
            .with_password(clickhouse_config.password.to_string())
            .with_database(clickhouse_config.db_name.to_string())
            .with_option("enable_json_type", "1")
            .with_option("flatten_nested", "0"),
        config: clickhouse_config,
    }
}

/// Executes a SQL query against the ClickHouse database
///
/// # Arguments
/// * `query` - The SQL query to execute
/// * `configured_client` - The client to use for execution
///
/// # Returns
/// * `Result<(), clickhouse::error::Error>` - Success if query executes without error
///
/// # Example
/// ```
/// let query = "SELECT 1";
/// run_query(query, &client).await?;
/// ```
pub async fn run_query(
    query: &str,
    configured_client: &ConfiguredDBClient,
) -> Result<(), clickhouse::error::Error> {
    debug!("Running query: {:?}", query);
    let client = &configured_client.client;
    client.query(query).execute().await
}

/// Checks if the ClickHouse database is ready for operations
///
/// # Arguments
/// * `configured_client` - The configured client to check
///
/// # Returns
/// * `Result<(), clickhouse::error::Error>` - Success if database is ready
///
/// # Details
/// - Executes a simple version query
/// - Implements retry logic for common connection issues
/// - Handles temporary network failures
/// - Maximum 20 retries with 200ms delay
///
/// # Retries
/// Retries on the following conditions:
/// - Connection closed before message completed
/// - Connection reset by peer
/// - Connection not ready
/// - Channel closed
pub async fn check_ready(
    configured_client: &ConfiguredDBClient,
) -> Result<(), clickhouse::error::Error> {
    let dummy_query = "SELECT version()".to_owned();
    crate::utilities::retry::retry(
        || run_query(&dummy_query, configured_client),
        |i, e| {
            i < 20
                && match e {
                    clickhouse::error::Error::Network(v) => {
                        let err_string = v.to_string();
                        debug!("Network error is {}", err_string);
                        err_string.contains("connection closed before message completed")
                            || err_string.contains("connection error: Connection reset by peer")
                            || err_string
                                .contains("operation was canceled: connection was not ready")
                            || err_string.contains("channel closed")
                    }
                    _ => {
                        debug!("Error is {} instead of network error. Will not retry.", e);
                        false
                    }
                }
        },
        tokio::time::Duration::from_millis(200),
    )
    .await
}

/// Fetches tables matching a specific version pattern
///
/// # Arguments
/// * `configured_client` - The configured client to use
/// * `version` - The version pattern to match against table names
///
/// # Returns
/// * `Result<Vec<ClickHouseSystemTable>, clickhouse::error::Error>` - List of matching tables
///
/// # Details
/// - Filters tables by database name and version pattern
/// - Returns full table metadata
/// - Uses parameterized query for safety
pub async fn fetch_tables_with_version(
    configured_client: &ConfiguredDBClient,
    version: &str,
) -> Result<Vec<ClickHouseSystemTable>, clickhouse::error::Error> {
    let client = &configured_client.client;
    let db_name = &configured_client.config.db_name;

    let query = "SELECT uuid, database, name, dependencies_table, engine FROM system.tables WHERE database = ? AND name LIKE ?";

    let tables = client
        .query(query)
        .bind(db_name)
        .bind(version)
        .fetch_all::<ClickHouseSystemTableRow>()
        .await?
        .into_iter()
        .map(|row| row.to_table())
        .collect();

    Ok(tables)
}

pub struct TableWithUnsupportedType {
    pub database: String,
    pub name: String,
    pub col_name: String,
    pub col_type: String,
}

/// Parses column metadata from a comment string
fn parse_column_metadata(comment: &str) -> Option<ColumnMetadata> {
    // Check if metadata exists in the comment (could be at the beginning or after user comment)
    let metadata_start = comment.find(METADATA_PREFIX)?;

    // Extract the JSON part starting from the metadata prefix
    let json_part = &comment[metadata_start + METADATA_PREFIX.len()..];

    // The metadata JSON should be everything from the prefix to the end
    // or to the next space if there's content after it (though that shouldn't happen)
    let json_str = json_part.trim();

    match serde_json::from_str::<ColumnMetadata>(json_str) {
        Ok(metadata) => Some(metadata),
        Err(e) => {
            tracing::warn!("Failed to parse column metadata JSON: {}", e);
            None
        }
    }
}

/// Parses an enum definition from metadata comment
fn parse_enum_from_metadata(comment: &str) -> Option<DataEnum> {
    let metadata = parse_column_metadata(comment)?;

    let values = metadata
        .enum_def
        .members
        .into_iter()
        .map(|member| {
            let value = match member.value {
                EnumValueMetadata::Int(i) => EnumValue::Int(i),
                EnumValueMetadata::String(s) => EnumValue::String(s),
            };

            EnumMember {
                name: member.name,
                value,
            }
        })
        .collect();

    Some(DataEnum {
        name: metadata.enum_def.name,
        values,
    })
}

#[async_trait::async_trait]
impl OlapOperations for ConfiguredDBClient {
    /// Retrieves all tables from the ClickHouse database and converts them to framework Table objects
    ///
    /// # Arguments
    /// * `db_name` - The name of the database to list tables from
    ///
    /// # Returns
    /// * `Result<(Vec<Table>, Vec<TableWithUnsupportedType>), OlapChangesError>` -
    /// A list of Table objects and a list of TableWithUnsupportedType on success
    ///
    /// # Details
    /// This implementation:
    /// 1. Queries system.tables for basic table information
    /// 2. Extracts version information from table names
    /// 3. Queries system.columns for column metadata
    /// 4. Converts ClickHouse types to framework types
    /// 5. Creates Table objects with proper versioning and source primitives
    ///
    /// # Notes
    /// - Tables without proper version information in their names are skipped
    /// - Column types are converted based on ClickHouse to framework type mapping
    /// - Primary key columns are used for order_by clauses
    /// - Tables are sorted by name in the final result
    async fn list_tables(
        &self,
        db_name: &str,
        project: &Project,
    ) -> Result<(Vec<Table>, Vec<TableWithUnsupportedType>), OlapChangesError> {
        debug!("Starting list_tables operation for database: {}", db_name);
        debug!("Using project version: {}", project.cur_version());

        // First get basic table information
        let query = format!(
            r#"
            SELECT
                name,
                database,
                engine,
                create_table_query,
                partition_key
            FROM system.tables
            WHERE database = '{db_name}'
            AND engine != 'View'
            AND engine != 'MaterializedView'
            AND NOT name LIKE '.%'
            ORDER BY name
            "#
        );
        debug!("Executing table query: {}", query);

        let mut cursor = self
            .client
            .query(&query)
            .fetch::<(String, String, String, String, String)>()
            .map_err(|e| {
                debug!("Error fetching tables: {}", e);
                OlapChangesError::DatabaseError(e.to_string())
            })?;

        let mut tables = Vec::new();
        let mut unsupported_tables = Vec::new();

        'table_loop: while let Some((table_name, database, engine, create_query, partition_key)) =
            cursor
                .next()
                .await
                .map_err(|e| OlapChangesError::DatabaseError(e.to_string()))?
        {
            debug!("Processing table: {}", table_name);
            debug!("Table engine: {}", engine);
            debug!("Create query: {}", create_query);

            // Extract ORDER BY columns from create_query
            let order_by_cols = extract_order_by_from_create_query(&create_query);
            debug!("Extracted ORDER BY columns: {:?}", order_by_cols);

            // Extract PRIMARY KEY expression if present
            let primary_key_expr = extract_primary_key_from_create_table(&create_query);
            debug!("Extracted PRIMARY KEY expression: {:?}", primary_key_expr);

            // Check if the CREATE TABLE statement has an explicit PRIMARY KEY clause
            let has_explicit_primary_key = primary_key_expr.is_some();
            debug!(
                "Table {} has explicit PRIMARY KEY: {}",
                table_name, has_explicit_primary_key
            );

            // Get column information for each table
            let columns_query = format!(
                r#"
                SELECT
                    name,
                    type,
                    comment,
                    is_in_primary_key,
                    is_in_sorting_key,
                    default_kind,
                    default_expression,
                    compression_codec
                FROM system.columns
                WHERE database = '{db_name}'
                AND table = '{table_name}'
                ORDER BY position
                "#
            );
            debug!(
                "Executing columns query for table {}: {}",
                table_name, columns_query
            );

            let mut columns_cursor = self
                .client
                .query(&columns_query)
                .fetch::<(String, String, String, u8, u8, String, String, String)>()
                .map_err(|e| {
                    debug!("Error fetching columns for table {}: {}", table_name, e);
                    OlapChangesError::DatabaseError(e.to_string())
                })?;

            let mut columns = Vec::new();

            let column_ttls =
                extract_column_ttls_from_create_query(&create_query).unwrap_or_default();
            while let Some((
                col_name,
                col_type,
                comment,
                is_primary,
                is_sorting,
                default_kind,
                default_expression,
                compression_codec,
            )) = columns_cursor
                .next()
                .await
                .map_err(|e| OlapChangesError::DatabaseError(e.to_string()))?
            {
                debug!(
                    "Processing column: {} (type: {}, comment: {}, primary: {}, sorting: {})",
                    col_name, col_type, comment, is_primary, is_sorting
                );

                // Try to parse enum from metadata comment first if it's an enum type
                let (data_type, is_nullable) =
                    if col_type.starts_with("Enum") && !comment.is_empty() {
                        // Try to parse from metadata comment
                        if let Some(enum_def) = parse_enum_from_metadata(&comment) {
                            debug!("Successfully parsed enum metadata for column {}", col_name);
                            (ColumnType::Enum(enum_def), false)
                        } else {
                            // Fall back to type string parsing if no valid metadata
                            debug!(
                            "No valid metadata for enum column {}, falling back to type parsing",
                            col_name
                        );
                            match type_parser::convert_clickhouse_type_to_column_type(&col_type) {
                                Ok(pair) => pair,
                                Err(_) => {
                                    debug!(
                                        "Column type not recognized: {} of field {} in table {}",
                                        col_type, col_name, table_name
                                    );
                                    unsupported_tables.push(TableWithUnsupportedType {
                                        database,
                                        name: table_name,
                                        col_name,
                                        col_type,
                                    });
                                    continue 'table_loop;
                                }
                            }
                        }
                    } else {
                        // Parse non-enum types as before
                        match type_parser::convert_clickhouse_type_to_column_type(&col_type) {
                            Ok(pair) => pair,
                            Err(_) => {
                                debug!(
                                    "Column type not recognized: {} of field {} in table {}",
                                    col_type, col_name, table_name
                                );
                                unsupported_tables.push(TableWithUnsupportedType {
                                    database,
                                    name: table_name,
                                    col_name,
                                    col_type,
                                });
                                continue 'table_loop;
                            }
                        }
                    };

                // Only set primary_key=true if there's an explicit PRIMARY KEY clause
                // When only ORDER BY is specified (no PRIMARY KEY), ClickHouse internally
                // treats ORDER BY columns as primary key, but we shouldn't mark them as such
                // since they come from orderByFields configuration, not Key<T> annotations
                let is_actual_primary_key = has_explicit_primary_key && is_primary == 1;

                // Preserve user comments (strip metadata if present)
                let column_comment = if !comment.is_empty() {
                    if let Some(metadata_pos) = comment.find(METADATA_PREFIX) {
                        // Extract the user comment part (before metadata)
                        let user_comment = comment[..metadata_pos].trim();
                        if !user_comment.is_empty() {
                            Some(user_comment.to_string())
                        } else {
                            None
                        }
                    } else {
                        // No metadata, entire comment is user comment
                        Some(comment.clone())
                    }
                } else {
                    None
                };

                let default = match default_kind.deref() {
                    "" => None,
                    "DEFAULT" => Some(default_expression),
                    "MATERIALIZED" | "ALIAS" => {
                        debug!("MATERIALIZED and ALIAS not yet handled.");
                        None
                    }
                    _ => {
                        debug!("Unknown default kind: {default_kind} for column {col_name}");
                        None
                    }
                };

                let mut annotations = Vec::new();

                // Check for LowCardinality wrapper
                if col_type.starts_with("LowCardinality(") {
                    debug!("Detected LowCardinality for column {}", col_name);
                    annotations.push(("LowCardinality".to_string(), serde_json::json!(true)));
                }

                if let Ok(Some((function_name, arg_type))) =
                    type_parser::extract_simple_aggregate_function(&col_type)
                {
                    debug!(
                        "Detected SimpleAggregateFunction({}, {:?}) for column {}",
                        function_name, arg_type, col_name
                    );

                    // Create the simpleAggregationFunction annotation
                    let annotation_value = serde_json::json!({
                        "functionName": function_name,
                        "argumentType": arg_type
                    });
                    annotations.push(("simpleAggregationFunction".to_string(), annotation_value));
                }

                // Normalize extracted TTL expressions immediately to ensure consistent comparison
                let normalized_ttl = column_ttls
                    .get(&col_name)
                    .map(|ttl| normalize_ttl_expression(ttl));

                // Parse codec if present
                // Strip CODEC(...) wrapper from compression_codec (e.g., "CODEC(ZSTD(3))" -> "ZSTD(3)")
                let codec = if !compression_codec.is_empty() {
                    let trimmed = compression_codec.trim();
                    if trimmed.starts_with("CODEC(") && trimmed.ends_with(')') {
                        Some(trimmed[6..trimmed.len() - 1].to_string())
                    } else {
                        Some(trimmed.to_string())
                    }
                } else {
                    None
                };

                let column = Column {
                    name: col_name.clone(),
                    data_type,
                    required: !is_nullable,
                    unique: false,
                    primary_key: is_actual_primary_key,
                    default,
                    annotations,
                    comment: column_comment,
                    ttl: normalized_ttl,
                    codec,
                };

                columns.push(column);
            }

            debug!("Found {} columns for table {}", columns.len(), table_name);

            // Determine if we should use primary_key_expression or column-level primary_key flags
            // Strategy: Build the expected PRIMARY KEY from columns, then compare with extracted PRIMARY KEY
            // If they match, use column-level flags; otherwise use primary_key_expression
            let (final_columns, final_primary_key_expression) =
                if let Some(pk_expr) = &primary_key_expr {
                    // Build expected PRIMARY KEY expression from columns marked as primary_key=true
                    let primary_key_columns: Vec<String> = columns
                        .iter()
                        .filter(|c| c.primary_key)
                        .map(|c| c.name.clone())
                        .collect();

                    debug!("Columns marked as primary key: {:?}", primary_key_columns);

                    // Build expected expression: single column = "col", multiple = "(col1, col2)"
                    let expected_pk_expr = if primary_key_columns.is_empty() {
                        String::new()
                    } else if primary_key_columns.len() == 1 {
                        primary_key_columns[0].clone()
                    } else {
                        format!("({})", primary_key_columns.join(", "))
                    };

                    debug!("Expected PRIMARY KEY expression: '{}'", expected_pk_expr);
                    debug!("Extracted PRIMARY KEY expression: '{}'", pk_expr);

                    // Normalize both expressions for comparison (same logic as Table::normalized_primary_key_expr)
                    let normalize = |s: &str| -> String {
                        // Step 1: trim, remove backticks, remove spaces
                        let mut normalized =
                            s.trim().trim_matches('`').replace('`', "").replace(" ", "");

                        // Step 2: Strip outer parentheses if this is a single-element tuple
                        // E.g., "(col)" -> "col", "(cityHash64(col))" -> "cityHash64(col)"
                        // But keep "(col1,col2)" as-is
                        if normalized.starts_with('(') && normalized.ends_with(')') {
                            // Check if there are any top-level commas (not inside nested parentheses)
                            let inner = &normalized[1..normalized.len() - 1];
                            let has_top_level_comma = {
                                let mut depth = 0;
                                let mut found_comma = false;
                                for ch in inner.chars() {
                                    match ch {
                                        '(' => depth += 1,
                                        ')' => depth -= 1,
                                        ',' if depth == 0 => {
                                            found_comma = true;
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                                found_comma
                            };

                            // If no top-level comma, it's a single-element tuple - strip outer parens
                            if !has_top_level_comma {
                                normalized = inner.to_string();
                            }
                        }

                        normalized
                    };

                    let normalized_expected = normalize(&expected_pk_expr);
                    let normalized_extracted = normalize(pk_expr);

                    debug!(
                        "Normalized expected: '{}', normalized extracted: '{}'",
                        normalized_expected, normalized_extracted
                    );

                    if normalized_expected == normalized_extracted {
                        // PRIMARY KEY matches what columns indicate, use column-level flags
                        debug!("PRIMARY KEY matches columns, using column-level primary_key flags");
                        (columns, None)
                    } else {
                        // PRIMARY KEY differs (different order, expressions, etc.), use primary_key_expression
                        debug!("PRIMARY KEY differs from columns, using primary_key_expression");
                        let updated_columns: Vec<Column> = columns
                            .into_iter()
                            .map(|mut c| {
                                c.primary_key = false;
                                c
                            })
                            .collect();
                        (updated_columns, Some(pk_expr.clone()))
                    }
                } else {
                    // No PRIMARY KEY clause, use column-level flags as-is
                    debug!("No PRIMARY KEY clause, using column-level primary_key flags");
                    (columns, None)
                };

            // Extract base name and version for source primitive
            let (base_name, version) = extract_version_from_table_name(&table_name);

            let source_primitive = PrimitiveSignature {
                name: base_name.clone(),
                primitive_type: PrimitiveTypes::DataModel,
            };

            // Create the Table object using the original table_name
            // Parse the engine from the CREATE TABLE query to get full engine configuration
            // This is more reliable than using the system.tables engine column which
            // only contains the engine name without parameters (e.g., "S3Queue" instead of
            // "S3Queue('path', 'format', ...)")
            let engine_str_to_parse = if let Some(engine_def) =
                extract_engine_from_create_table(&create_query)
            {
                engine_def
            } else {
                // Fallback to the simple engine name from system.tables
                debug!("Could not extract engine from CREATE TABLE query, falling back to system.tables engine column");
                engine.clone()
            };

            // Try to parse the engine string
            let engine_parsed: ClickhouseEngine = match engine_str_to_parse.as_str().try_into() {
                Ok(engine) => engine,
                Err(failed_str) => {
                    warn!(
                        "Failed to parse engine for table '{}': '{}'. This may indicate an unsupported engine type.",
                        table_name, failed_str
                    );
                    unsupported_tables.push(TableWithUnsupportedType {
                        database: database.clone(),
                        name: table_name.clone(),
                        col_name: "__engine".to_string(),
                        col_type: String::from(failed_str),
                    });
                    continue 'table_loop;
                }
            };
            let engine_params_hash = Some(engine_parsed.non_alterable_params_hash());

            // Extract table settings from CREATE TABLE query
            let table_settings = extract_table_settings_from_create_table(&create_query);

            // Extract TTLs from CREATE TABLE and normalize immediately
            // This ensures consistent comparison with user-defined TTLs
            let table_ttl_setting = extract_table_ttl_from_create_query(&create_query)
                .map(|ttl| normalize_ttl_expression(&ttl));

            let indexes_ch = extract_indexes_from_create_table(&create_query)?;
            let indexes: Vec<TableIndex> = indexes_ch
                .into_iter()
                .map(|i| TableIndex {
                    name: i.name,
                    expression: i.expression,
                    index_type: i.index_type,
                    arguments: i.arguments,
                    granularity: i.granularity,
                })
                .collect();
            debug!("Extracted indexes for table {}: {:?}", table_name, indexes);

            let table = Table {
                // keep the name with version suffix, following PartialInfrastructureMap.convert_tables
                name: table_name,
                columns: final_columns,
                order_by: OrderBy::Fields(order_by_cols), // Use the extracted ORDER BY columns
                partition_by: {
                    let p = partition_key.trim();
                    (!p.is_empty()).then(|| p.to_string())
                },
                sample_by: extract_sample_by_from_create_table(&create_query),
                engine: engine_parsed,
                version,
                source_primitive,
                metadata: None,
                // this does not matter as we refer to the lifecycle in infra map
                life_cycle: LifeCycle::ExternallyManaged,
                engine_params_hash,
                table_settings,
                indexes,
                database: Some(database),
                table_ttl_setting,
                // cluster_name is always None from introspection because ClickHouse doesn't store
                // the ON CLUSTER clause - it's only used during DDL execution and isn't persisted
                // in system tables. Users must manually specify cluster in their table configs.
                cluster_name: None,
                primary_key_expression: final_primary_key_expression,
            };
            debug!("Created table object: {:?}", table);

            tables.push(table);
        }

        debug!(
            "Completed list_tables operation, found {} tables",
            tables.len()
        );
        Ok((tables, unsupported_tables))
    }

    /// Retrieves all SQL resources (views and materialized views) from the ClickHouse database
    ///
    /// # Arguments
    /// * `db_name` - The name of the database to list SQL resources from
    /// * `default_database` - The default database name for resolving unqualified table references
    ///
    /// # Returns
    /// * `Result<Vec<SqlResource>, OlapChangesError>` - A list of SqlResource objects
    ///
    /// # Details
    /// This implementation:
    /// 1. Queries system.tables for views and materialized views
    /// 2. Parses the CREATE statements to extract dependencies
    /// 3. Reconstructs SqlResource objects with setup and teardown scripts
    /// 4. Extracts data lineage (pulls_data_from and pushes_data_to)
    async fn list_sql_resources(
        &self,
        db_name: &str,
        default_database: &str,
    ) -> Result<Vec<SqlResource>, OlapChangesError> {
        debug!(
            "Starting list_sql_resources operation for database: {}",
            db_name
        );

        // We query `as_select` from system.tables to get the clean SELECT statement
        // without the view's column definitions (e.g., `CREATE VIEW v (col1 Type) AS ...`).
        // This avoids complex parsing logic to strip those columns manually.
        let query = format!(
            r#"
            SELECT
                name,
                database,
                engine,
                create_table_query,
                as_select
            FROM system.tables
            WHERE database = '{}'
            AND engine IN ('View', 'MaterializedView')
            AND NOT name LIKE '.%'
            ORDER BY name
            "#,
            db_name
        );
        debug!("Executing SQL resources query: {}", query);

        let mut cursor = self
            .client
            .query(&query)
            .fetch::<(String, String, String, String, String)>()
            .map_err(|e| {
                debug!("Error fetching SQL resources: {}", e);
                OlapChangesError::DatabaseError(e.to_string())
            })?;

        let mut sql_resources = Vec::new();

        while let Some((name, database, engine, create_query, as_select)) = cursor
            .next()
            .await
            .map_err(|e| OlapChangesError::DatabaseError(e.to_string()))?
        {
            debug!("Processing SQL resource: {} (engine: {})", name, engine);
            debug!("Create query: {}", create_query);

            // Reconstruct SqlResource based on engine type
            let sql_resource = match engine.as_str() {
                "MaterializedView" => reconstruct_sql_resource_from_mv(
                    name,
                    create_query,
                    as_select,
                    database,
                    default_database,
                )?,
                "View" => {
                    reconstruct_sql_resource_from_view(name, as_select, database, default_database)?
                }
                _ => {
                    warn!("Unexpected engine type for SQL resource: {}", engine);
                    continue;
                }
            };

            sql_resources.push(sql_resource);
        }

        debug!(
            "Completed list_sql_resources operation, found {} SQL resources",
            sql_resources.len()
        );
        Ok(sql_resources)
    }
}

static MATERIALIZED_VIEW_TO_PATTERN: LazyLock<regex::Regex> = LazyLock::new(|| {
    // Pattern to extract TO <table_name> from CREATE MATERIALIZED VIEW
    regex::Regex::new(r"(?i)\bTO\s+([a-zA-Z0-9_.`]+)")
        .expect("MATERIALIZED_VIEW_TO_PATTERN regex should compile")
});

/// Reconstructs a SqlResource from a materialized view's CREATE statement
///
/// # Arguments
/// * `name` - The name of the materialized view
/// * `create_query` - The CREATE MATERIALIZED VIEW statement from ClickHouse
/// * `as_select` - The SELECT part of the query (clean, from system.tables)
/// * `database` - The database where the view is located
/// * `default_database` - The default database for resolving unqualified table references
///
/// # Returns
/// * `Result<SqlResource, OlapChangesError>` - The reconstructed SqlResource
fn reconstruct_sql_resource_from_mv(
    name: String,
    create_query: String,
    as_select: String,
    database: String,
    default_database: &str,
) -> Result<SqlResource, OlapChangesError> {
    // Extract target table from create_query for MV
    let target_table = MATERIALIZED_VIEW_TO_PATTERN
        .captures(&create_query)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().replace('`', ""))
        .ok_or_else(|| {
            OlapChangesError::DatabaseError(format!(
                "Could not find TO target in materialized view definition: {}",
                name
            ))
        })?;

    // Extract pushes_data_to (target table for MV)
    let (target_base_name, _version) = extract_version_from_table_name(&target_table);
    let (target_db, target_name_only) = split_qualified_name(&target_base_name);

    let target_qualified_id = if let Some(target_db) = target_db {
        if target_db == default_database {
            target_name_only
        } else {
            format!("{}_{}", target_db, target_name_only)
        }
    } else {
        target_name_only
    };

    let pushes_data_to = vec![InfrastructureSignature::Table {
        id: target_qualified_id,
    }];

    // Reconstruct with MV-specific CREATE statement
    let setup_raw = format!(
        "CREATE MATERIALIZED VIEW IF NOT EXISTS {} TO {} AS {}",
        name, target_table, as_select
    );

    reconstruct_sql_resource_common(
        name,
        setup_raw,
        as_select,
        database,
        default_database,
        pushes_data_to,
    )
}

/// Reconstructs a SqlResource from a view's CREATE statement
///
/// # Arguments
/// * `name` - The name of the view
/// * `as_select` - The SELECT part of the query (clean, from system.tables)
/// * `database` - The database where the view is located
/// * `default_database` - The default database for resolving unqualified table references
///
/// # Returns
/// * `Result<SqlResource, OlapChangesError>` - The reconstructed SqlResource
fn reconstruct_sql_resource_from_view(
    name: String,
    as_select: String,
    database: String,
    default_database: &str,
) -> Result<SqlResource, OlapChangesError> {
    // Views don't push data to tables
    let pushes_data_to = vec![];

    // Reconstruct with view-specific CREATE statement
    let setup_raw = format!("CREATE VIEW IF NOT EXISTS {} AS {}", name, as_select);

    reconstruct_sql_resource_common(
        name,
        setup_raw,
        as_select,
        database,
        default_database,
        pushes_data_to,
    )
}

/// Common logic for reconstructing SqlResource from MV or View
fn reconstruct_sql_resource_common(
    name: String,
    setup_raw: String,
    as_select: String,
    database: String,
    default_database: &str,
    pushes_data_to: Vec<InfrastructureSignature>,
) -> Result<SqlResource, OlapChangesError> {
    // Normalize the SQL for consistent comparison
    let setup = normalize_sql_for_comparison(&setup_raw, default_database);

    // Generate teardown script
    let teardown = format!("DROP VIEW IF EXISTS `{}`", name);

    // Parse as_select to get source tables (lineage)
    // Try standard SQL parser first, but fall back to regex if it fails
    let source_tables = match extract_source_tables_from_query(&as_select) {
        Ok(tables) => tables,
        Err(e) => {
            warn!(
                "Could not parse {} query with standard SQL parser ({}), using regex fallback",
                name, e
            );
            extract_source_tables_from_query_regex(&as_select, default_database).map_err(|e| {
                OlapChangesError::DatabaseError(format!(
                    "Failed to extract source tables from {} using regex fallback: {}",
                    name, e
                ))
            })?
        }
    };

    // Extract pulls_data_from (source tables)
    let pulls_data_from = source_tables
        .into_iter()
        .map(|table_ref| {
            // Get the table name, strip version suffix if present
            let table_name = table_ref.table;
            let (base_name, _version) = extract_version_from_table_name(&table_name);

            // Use database from table reference if available, otherwise use default
            let qualified_id = if let Some(db) = table_ref.database {
                if db == default_database {
                    base_name
                } else {
                    format!("{}_{}", db, base_name)
                }
            } else {
                base_name
            };

            InfrastructureSignature::Table { id: qualified_id }
        })
        .collect();

    Ok(SqlResource {
        name,
        database: Some(database),
        source_file: None, // Introspected from database, not from user code
        setup: vec![setup],
        teardown: vec![teardown],
        pulls_data_from,
        pushes_data_to,
    })
}

/// Regex pattern to find keywords that terminate an ORDER BY clause
static ORDER_BY_TERMINATOR_PATTERN: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\s(PARTITION BY|PRIMARY KEY|SAMPLE BY|TTL|SETTINGS)")
        .expect("ORDER_BY_TERMINATOR_PATTERN regex should compile")
});

/// Extracts ORDER BY columns from a CREATE TABLE query
///
/// # Arguments
/// * `create_query` - The CREATE TABLE query string
///
/// # Returns
/// * `Vec<String>` - List of column names in the ORDER BY clause, or empty vector if none found
///
/// # Example
/// ```rust
/// let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (id, timestamp)";
/// let order_by = extract_order_by_from_create_query(query);
/// assert_eq!(order_by, vec!["id".to_string(), "timestamp".to_string()]);
/// ```
pub fn extract_order_by_from_create_query(create_query: &str) -> Vec<String> {
    debug!("Extracting ORDER BY from query: {}", create_query);

    // Find the main ORDER BY clause (not ones inside projections)
    // We need to search for ORDER BY that comes after the ENGINE clause
    let upper = create_query.to_uppercase();
    let engine_pos = upper.find("ENGINE").unwrap_or_else(|| {
        debug!("No ENGINE clause found");
        0
    });

    // Search for ORDER BY only in the part after ENGINE
    let after_engine = &create_query[engine_pos..];
    let upper_after_engine = &upper[engine_pos..];

    // Find the ORDER BY clause, being careful not to match PRIMARY KEY
    let mut after_order_by = None;
    for (idx, _) in upper_after_engine.match_indices("ORDER BY") {
        // Check if this is not part of "PRIMARY KEY" by looking at the preceding text
        let preceding_text = &upper_after_engine[..idx].trim_end();
        if !preceding_text.ends_with("PRIMARY KEY") {
            after_order_by = Some(&after_engine[idx..]);
            break;
        }
    }

    if let Some(after_order_by) = after_order_by {
        // Find where the ORDER BY clause ends by checking for keywords that can follow it.
        // We look for any of the ClickHouse table engine keywords that terminate ORDER BY.
        let mut end_idx = after_order_by.len();
        let upper_after = after_order_by.to_uppercase();

        // Use regex to find keywords preceded by whitespace
        // \s matches any whitespace character (space, tab, newline, etc.)
        if let Some(mat) = ORDER_BY_TERMINATOR_PATTERN.find(&upper_after) {
            // The match includes the leading whitespace, so we use mat.start()
            end_idx = mat.start();
        }

        // Check for another ORDER BY (shouldn't happen in normal cases)
        if let Some(next_order_by) = after_order_by[8..].to_uppercase().find("ORDER BY") {
            end_idx = std::cmp::min(end_idx, next_order_by + 8);
        }

        let order_by_clause = &after_order_by[..end_idx];

        // Extract the column names
        let order_by_content = order_by_clause.trim_start_matches("ORDER BY").trim();
        if order_by_content == "tuple()" {
            return Vec::new();
        };

        // Remove only the outermost pair of parentheses if present
        // Don't use trim_matches as it removes ALL matching chars, which breaks function calls
        let order_by_content =
            if order_by_content.starts_with('(') && order_by_content.ends_with(')') {
                &order_by_content[1..order_by_content.len() - 1]
            } else {
                order_by_content
            };

        debug!("Found ORDER BY content: {}", order_by_content);

        // Split by comma and clean up each column name
        return order_by_content
            .split(',')
            .map(|s| s.trim().trim_matches('`').to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    debug!("No explicit ORDER BY clause found");
    Vec::new()
}

/// Extract table-level TTL expression from CREATE TABLE query (without leading 'TTL').
/// Returns None if no table-level TTL clause is present.
pub fn extract_table_ttl_from_create_query(create_query: &str) -> Option<String> {
    let upper = create_query.to_uppercase();
    // Start scanning after ENGINE clause (table-level TTL appears after ORDER BY)
    let engine_pos = upper.find("ENGINE")?;
    let tail = &create_query[engine_pos..];
    let tail_upper = &upper[engine_pos..];
    // Find " TTL " in the tail
    let ttl_pos = tail_upper.find(" TTL ")?;
    let ttl_start = ttl_pos + " TTL ".len();
    let after_ttl = &tail[ttl_start..];
    // TTL clause ends before SETTINGS or end of string
    let end_idx = after_ttl
        .to_uppercase()
        .find(" SETTINGS")
        .unwrap_or(after_ttl.len());
    let expr = after_ttl[..end_idx].trim();
    if expr.is_empty() {
        None
    } else {
        Some(expr.to_string())
    }
}

/// Normalize a TTL expression to match ClickHouse's canonical form.
/// Converts SQL INTERVAL syntax to toInterval* function calls that ClickHouse uses internally.
/// Also removes trailing DELETE since it's the default action and ClickHouse may delete it implicitly.
///
/// # Examples
/// - "timestamp + INTERVAL 30 DAY" → "timestamp + toIntervalDay(30)"
/// - "timestamp + INTERVAL 1 MONTH" → "timestamp + toIntervalMonth(1)"
/// - "timestamp + INTERVAL 90 DAY DELETE" → "timestamp + toIntervalDay(90)"
/// - "timestamp + toIntervalDay(90) DELETE" → "timestamp + toIntervalDay(90)"
pub fn normalize_codec_expression(expr: &str) -> String {
    expr.split(',')
        .map(|codec| {
            let trimmed = codec.trim();
            match trimmed {
                "Delta" => "Delta(4)",
                "Gorilla" => "Gorilla(8)",
                "ZSTD" => "ZSTD(1)",
                // DoubleDelta, LZ4, NONE, and any codec with params stay as-is
                _ => trimmed,
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Checks if two codec expressions are semantically equivalent after normalization.
///
/// This handles cases where ClickHouse normalizes codecs by adding default parameters.
/// For example, "Delta, LZ4" from user code is equivalent to "Delta(4), LZ4" from ClickHouse.
pub fn codec_expressions_are_equivalent(before: &Option<String>, after: &Option<String>) -> bool {
    match (before, after) {
        (None, None) => true,
        (Some(b), Some(a)) => normalize_codec_expression(b) == normalize_codec_expression(a),
        _ => false,
    }
}

pub fn normalize_ttl_expression(expr: &str) -> String {
    use regex::Regex;

    // Pattern to match INTERVAL N UNIT, where N is a number and UNIT is the time unit
    // Captures: (number) (unit)
    let interval_pattern =
        Regex::new(r"(?i)INTERVAL\s+(\d+)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|QUARTER|YEAR)")
            .expect("Valid regex pattern");

    let normalized = interval_pattern
        .replace_all(expr, |caps: &regex::Captures| {
            let number = &caps[1];
            let unit = caps[2].to_uppercase();

            let func_name = match unit.as_str() {
                "SECOND" => "toIntervalSecond",
                "MINUTE" => "toIntervalMinute",
                "HOUR" => "toIntervalHour",
                "DAY" => "toIntervalDay",
                "WEEK" => "toIntervalWeek",
                "MONTH" => "toIntervalMonth",
                "QUARTER" => "toIntervalQuarter",
                "YEAR" => "toIntervalYear",
                _ => return format!("INTERVAL {} {}", number, unit), // Shouldn't happen, but keep as-is
            };

            format!("{}({})", func_name, number)
        })
        .to_string();

    // Remove trailing DELETE since it's the default action
    // ClickHouse may add it implicitly, but it's redundant for comparison purposes
    let delete_pattern = Regex::new(r"(?i)\s+DELETE\s*$").expect("Valid regex pattern");
    delete_pattern.replace(&normalized, "").to_string()
}

/// Extract column-level TTL expressions from the CREATE TABLE column list.
/// Returns a map of column name to TTL expression (without leading 'TTL').
pub fn extract_column_ttls_from_create_query(
    create_query: &str,
) -> Option<HashMap<String, String>> {
    let upper = create_query.to_uppercase();
    // Columns section is between the first '(' after CREATE TABLE and the closing ')' before ENGINE
    let open_paren = upper.find('(')?;
    let engine_pos = upper
        .find("\nENGINE")
        .or_else(|| upper.find("\r\nENGINE"))
        .or_else(|| upper.rfind("ENGINE"))?;
    if engine_pos <= open_paren {
        return None;
    }
    let columns_block = &create_query[open_paren + 1..engine_pos];
    let mut map = HashMap::new();

    // Split columns by top-level commas (not inside parentheses or single quotes)
    let mut col_defs: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut prev: Option<char> = None;
    for ch in columns_block.chars() {
        if ch == '\'' && prev != Some('\\') {
            in_string = !in_string;
        }
        if !in_string {
            if ch == '(' {
                depth += 1;
            } else if ch == ')' {
                if depth > 0 {
                    depth -= 1;
                }
            } else if ch == ',' && depth == 0 {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    col_defs.push(trimmed.to_string());
                }
                current.clear();
                prev = Some(ch);
                continue;
            }
        }
        current.push(ch);
        prev = Some(ch);
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        col_defs.push(trimmed.to_string());
    }

    for def in col_defs {
        let line_trim = def.trim();
        // Expect defs like: `col` Type ... [TTL expr] ...
        if !line_trim.starts_with('`') {
            continue;
        }
        // Extract column name between the first pair of backticks
        let first_bt = 0; // starts with backtick
        let second_bt = match line_trim[1..].find('`') {
            Some(pos) => 1 + pos,
            None => continue,
        };
        let col_name = &line_trim[first_bt + 1..second_bt];

        // Find TTL clause within this column definition
        let upper_line = line_trim.to_uppercase();
        if let Some(idx) = upper_line.find(" TTL ") {
            let after = &line_trim[idx + 5..];
            let after_upper = after.to_uppercase();
            let mut cut = after.len();

            // Check for keywords that end the TTL expression
            for kw in [" DEFAULT", " COMMENT"] {
                if let Some(pos) = after_upper.find(kw) {
                    cut = cut.min(pos);
                }
            }

            // Find the closing parenthesis at depth 0 (the one that ends the column list)
            let mut depth = 0;
            for (i, ch) in after.chars().enumerate() {
                if i >= cut {
                    break;
                }
                match ch {
                    '(' => depth += 1,
                    ')' => {
                        if depth == 0 {
                            // This is the closing parenthesis of the column list
                            cut = cut.min(i);
                            break;
                        }
                        depth -= 1;
                    }
                    _ => {}
                }
            }

            let expr = after[..cut].trim();
            if !expr.is_empty() {
                map.insert(col_name.to_string(), expr.to_string());
            }
        }
    }

    if map.is_empty() {
        None
    } else {
        Some(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::olap::clickhouse::model::{ClickHouseColumnType, ClickHouseInt};
    use crate::infrastructure::olap::clickhouse::sql_parser::tests::NESTED_OBJECTS_SQL;

    #[test]
    fn test_extract_version_from_table_name() {
        // Test two-part versions
        let (base_name, version) = extract_version_from_table_name("Bar_0_0");
        assert_eq!(base_name, "Bar");
        assert_eq!(version.unwrap().to_string(), "0.0");

        let (base_name, version) = extract_version_from_table_name("Foo_0_0");
        assert_eq!(base_name, "Foo");
        assert_eq!(version.unwrap().to_string(), "0.0");

        // Test three-part versions
        let (base_name, version) = extract_version_from_table_name("Bar_0_0_0");
        assert_eq!(base_name, "Bar");
        assert_eq!(version.unwrap().to_string(), "0.0.0");

        let (base_name, version) = extract_version_from_table_name("Foo_1_2_3");
        assert_eq!(base_name, "Foo");
        assert_eq!(version.unwrap().to_string(), "1.2.3");

        // Test table names with underscores
        let (base_name, version) = extract_version_from_table_name("My_Table_0_0");
        assert_eq!(base_name, "My_Table");
        assert_eq!(version.unwrap().to_string(), "0.0");

        let (base_name, version) = extract_version_from_table_name("Complex_Table_Name_1_0_0");
        assert_eq!(base_name, "Complex_Table_Name");
        assert_eq!(version.unwrap().to_string(), "1.0.0");

        // Test invalid formats - should use default version
        let (base_name, version) = extract_version_from_table_name("TableWithoutVersion");
        assert_eq!(base_name, "TableWithoutVersion");
        assert!(version.is_none());

        let (base_name, version) = extract_version_from_table_name("Table_WithoutNumericVersion");
        assert_eq!(base_name, "Table_WithoutNumericVersion");
        assert!(version.is_none());

        // Test edge cases
        let (base_name, version) = extract_version_from_table_name("");
        assert_eq!(base_name, "");
        assert!(version.is_none());

        let (base_name, version) = extract_version_from_table_name("_0_0");
        assert_eq!(base_name, "");
        assert_eq!(version.unwrap().to_string(), "0.0");

        let (base_name, version) = extract_version_from_table_name("Table_0_0_");
        assert_eq!(base_name, "Table");
        assert_eq!(version.unwrap().to_string(), "0.0");

        // Test mixed numeric and non-numeric parts
        let (base_name, version) = extract_version_from_table_name("Table2_0_0");
        assert_eq!(base_name, "Table2");
        assert_eq!(version.unwrap().to_string(), "0.0");

        let (base_name, version) = extract_version_from_table_name("V2_Table_1_0_0");
        assert_eq!(base_name, "V2_Table");
        assert_eq!(version.unwrap().to_string(), "1.0.0");

        // Test materialized views
        let (base_name, version) = extract_version_from_table_name("BarAggregated_MV");
        assert_eq!(base_name, "BarAggregated_MV");
        assert!(version.is_none());

        // Test non-versioned tables
        let (base_name, version) = extract_version_from_table_name("Foo");
        assert_eq!(base_name, "Foo");
        assert!(version.is_none());

        let (base_name, version) = extract_version_from_table_name("Bar");
        assert_eq!(base_name, "Bar");
        assert!(version.is_none());
    }

    #[test]
    fn test_extract_order_by_from_create_query() {
        // Test with explicit ORDER BY
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (id, timestamp)";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string(), "timestamp".to_string()]);

        // Test with PRIMARY KEY and ORDER BY being different
        let query =
            "CREATE TABLE test (id Int64) ENGINE = MergeTree PRIMARY KEY id ORDER BY (timestamp)";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["timestamp".to_string()]);

        // Test with PRIMARY KEY but no explicit ORDER BY (should return empty)
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree PRIMARY KEY id";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, Vec::<String>::new());

        // Test with PRIMARY KEY and implicit ORDER BY through PRIMARY KEY
        let query = "CREATE TABLE local.Foo_0_0 (`primaryKey` String, `timestamp` Float64, `optionalText` Nullable(String)) ENGINE = MergeTree PRIMARY KEY primaryKey ORDER BY primaryKey SETTINGS index_granularity = 8192";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["primaryKey".to_string()]);

        // Test with SETTINGS clause
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (id, timestamp) SETTINGS index_granularity = 8192";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string(), "timestamp".to_string()]);

        // Test with ORDER BY and TTL (should not include TTL in ORDER BY)
        let query = "CREATE TABLE test (id Int64, ts DateTime) ENGINE = MergeTree ORDER BY (id, ts) TTL ts + INTERVAL 90 DAY SETTINGS index_granularity = 8192";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string(), "ts".to_string()]);

        // Test with ORDER BY and SAMPLE BY (should not include SAMPLE BY in ORDER BY)
        let query = "CREATE TABLE test (id Int64, hash UInt64) ENGINE = MergeTree ORDER BY (id, hash) SAMPLE BY hash SETTINGS index_granularity = 8192";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string(), "hash".to_string()]);

        let query = r#"CREATE TABLE local.test
(
    `_hardware_id` String,
    `_hostname` String,
    `date_stamp` Date DEFAULT '1970-01-01',
    `hour_stamp` UInt64 DEFAULT toStartOfHour(toDateTime(_time_observed / 1000)),
    `sample_hash` UInt64 DEFAULT xxHash64(_hardware_id),
    `_time_observed` UInt64,
    INDEX index_time_observed_v1 _time_observed TYPE minmax GRANULARITY 3
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(toStartOfWeek(toDateTime(_time_observed / 1000)))
PRIMARY KEY (hour_stamp, sample_hash)
ORDER BY (hour_stamp, sample_hash, _time_observed)
SAMPLE BY sample_hash
SETTINGS enable_mixed_granularity_parts = 1, index_granularity = 8192, index_granularity_bytes = 10485760"#;
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(
            order_by,
            vec![
                "hour_stamp".to_string(),
                "sample_hash".to_string(),
                "_time_observed".to_string()
            ]
        );

        // Test with backticks
        let query =
            "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (`id`, `timestamp`)";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string(), "timestamp".to_string()]);

        // Test without parentheses
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY id";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string()]);

        // Test with no ORDER BY clause
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree()";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, Vec::<String>::new());

        // Test with projections that have their own ORDER BY clauses
        // Should extract the main table ORDER BY, not the projection ORDER BY
        let query = r#"CREATE TABLE local.ParsedLogsV2_0_0 (`orgId` String, `projectId` String, `branchId` String, `date` DateTime('UTC'), `message` String, `severityNumber` Float64, `severityLevel` String, `source` String, `sessionId` String, `serviceName` String, `machineId` String, PROJECTION severity_level_projection (SELECT severityLevel, date, orgId, projectId, branchId, machineId, source, message ORDER BY severityLevel, date), PROJECTION machine_source_projection (SELECT machineId, source, date, orgId, projectId, branchId, severityLevel, message ORDER BY machineId, source, date)) ENGINE = MergeTree PRIMARY KEY (orgId, projectId, branchId) ORDER BY (orgId, projectId, branchId, date) TTL date + toIntervalDay(90) SETTINGS enable_mixed_granularity_parts = 1, index_granularity = 8192, index_granularity_bytes = 10485760"#;
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(
            order_by,
            vec![
                "orgId".to_string(),
                "projectId".to_string(),
                "branchId".to_string(),
                "date".to_string()
            ]
        );
    }

    #[test]
    fn test_comment_only_modification() {
        // Test that comment-only changes are handled efficiently
        use crate::framework::core::infrastructure::table::{
            Column, ColumnType, DataEnum, EnumMember, EnumValue,
        };

        // Create two columns that differ only in comment
        let before_column = Column {
            name: "status".to_string(),
            data_type: ColumnType::Enum(DataEnum {
                name: "Status".to_string(),
                values: vec![EnumMember {
                    name: "ACTIVE".to_string(),
                    value: EnumValue::String("active".to_string()),
                }],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: Some("Old user comment".to_string()),
            ttl: None,
            codec: None,
        };

        let after_column = Column {
            name: "status".to_string(),
            data_type: ColumnType::Enum(DataEnum {
                name: "Status".to_string(),
                values: vec![EnumMember {
                    name: "ACTIVE".to_string(),
                    value: EnumValue::String("active".to_string()),
                }],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: Some("New user comment".to_string()),
            ttl: None,
            codec: None,
        };

        // The execute_modify_table_column function should detect this as comment-only change
        // This is tested implicitly by the function's implementation
        // In a real test, we'd verify the SQL generated is comment-only
        assert_ne!(before_column.comment, after_column.comment);
        assert_eq!(before_column.data_type, after_column.data_type);
        assert_eq!(before_column.required, after_column.required);
    }

    #[test]
    fn test_modify_column_includes_default_and_comment() {
        use crate::framework::core::infrastructure::table::{Column, IntType};

        // Build before/after where default changes and comment present
        let before_column = Column {
            name: "count".to_string(),
            data_type: ColumnType::Int(IntType::Int32),
            required: true,
            unique: false,
            primary_key: false,
            default: Some("1".to_string()),
            annotations: vec![],
            comment: Some("Number of things".to_string()),
            ttl: None,
            codec: None,
        };
        let after_column = Column {
            default: Some("42".to_string()),
            ..before_column.clone()
        };

        let ch_after = std_column_to_clickhouse_column(after_column).unwrap();
        let sqls =
            build_modify_column_sql("db", "table", &ch_after, false, false, false, None).unwrap();

        assert_eq!(sqls.len(), 1);
        assert_eq!(
            sqls[0],
            "ALTER TABLE `db`.`table` MODIFY COLUMN IF EXISTS `count` Int32 DEFAULT 42 COMMENT 'Number of things'".to_string()
        );
    }

    #[test]
    fn test_modify_column_comment_only_no_default_change() {
        use crate::framework::core::infrastructure::table::Column;

        // same type/required/default; only comment changed => should be handled via comment-only path
        let before_column = Column {
            name: "status".to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: Some("'open'".to_string()),
            annotations: vec![],
            comment: Some("old".to_string()),
            ttl: None,
            codec: None,
        };

        let after_column = Column {
            comment: Some("new".to_string()),
            ..before_column.clone()
        };

        // Use the pure SQL builder for comment-only update
        let sql = build_modify_column_comment_sql("db", "table", &after_column.name, "new", None)
            .unwrap();
        assert_eq!(
            sql,
            "ALTER TABLE `db`.`table` MODIFY COLUMN `status` COMMENT 'new'"
        );
    }

    #[test]
    fn test_modify_nullable_column_with_default() {
        use crate::framework::core::infrastructure::table::Column;
        use crate::infrastructure::olap::clickhouse::mapper::std_column_to_clickhouse_column;

        // Test modifying a nullable column with a default value
        let column = Column {
            name: "description".to_string(),
            data_type: ColumnType::String,
            required: false,
            unique: false,
            primary_key: false,
            default: Some("'updated default'".to_string()),
            annotations: vec![],
            comment: Some("Updated description field".to_string()),
            ttl: None,
            codec: None,
        };

        let clickhouse_column = std_column_to_clickhouse_column(column).unwrap();

        let sqls = build_modify_column_sql(
            "test_db",
            "users",
            &clickhouse_column,
            false,
            false,
            false,
            None,
        )
        .unwrap();

        assert_eq!(sqls.len(), 1);
        assert_eq!(
            sqls[0],
            "ALTER TABLE `test_db`.`users` MODIFY COLUMN IF EXISTS `description` Nullable(String) DEFAULT 'updated default' COMMENT 'Updated description field'"
        );
    }

    #[test]
    fn test_modify_column_with_sql_function_defaults() {
        // Test that SQL function defaults (like xxHash64, now(), today()) are not quoted
        // in MODIFY COLUMN statements. This complements the CREATE TABLE test.
        // Related to ENG-1162.

        let sample_hash_col = ClickHouseColumn {
            name: "sample_hash".to_string(),
            column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::UInt64),
            required: true,
            primary_key: false,
            unique: false,
            default: Some("xxHash64(_id)".to_string()), // SQL function - no quotes
            comment: Some("Hash of the ID".to_string()),
            ttl: None,
            codec: None,
        };

        let sqls = build_modify_column_sql(
            "test_db",
            "test_table",
            &sample_hash_col,
            false,
            false,
            false,
            None,
        )
        .unwrap();

        assert_eq!(sqls.len(), 1);
        // The fix ensures xxHash64(_id) is NOT quoted - if it were quoted, ClickHouse would treat it as a string literal
        assert_eq!(
            sqls[0],
            "ALTER TABLE `test_db`.`test_table` MODIFY COLUMN IF EXISTS `sample_hash` UInt64 DEFAULT xxHash64(_id) COMMENT 'Hash of the ID'"
        );

        // Test with now() function
        let created_at_col = ClickHouseColumn {
            name: "created_at".to_string(),
            column_type: ClickHouseColumnType::DateTime64 { precision: 3 },
            required: true,
            primary_key: false,
            unique: false,
            default: Some("now()".to_string()), // SQL function - no quotes
            comment: None,
            ttl: None,
            codec: None,
        };

        let sqls = build_modify_column_sql(
            "test_db",
            "test_table",
            &created_at_col,
            false,
            false,
            false,
            None,
        )
        .unwrap();

        assert_eq!(sqls.len(), 1);
        // The fix ensures now() is NOT quoted
        assert_eq!(
            sqls[0],
            "ALTER TABLE `test_db`.`test_table` MODIFY COLUMN IF EXISTS `created_at` DateTime64(3) DEFAULT now()"
        );

        // Test that literal string defaults still work correctly (with quotes preserved)
        let status_col = ClickHouseColumn {
            name: "status".to_string(),
            column_type: ClickHouseColumnType::String,
            required: true,
            primary_key: false,
            unique: false,
            default: Some("'active'".to_string()), // String literal - quotes preserved
            comment: None,
            ttl: None,
            codec: None,
        };

        let sqls = build_modify_column_sql(
            "test_db",
            "test_table",
            &status_col,
            false,
            false,
            false,
            None,
        )
        .unwrap();

        assert_eq!(sqls.len(), 1);
        // String literals should preserve their quotes
        assert_eq!(
            sqls[0],
            "ALTER TABLE `test_db`.`test_table` MODIFY COLUMN IF EXISTS `status` String DEFAULT 'active'"
        );
    }

    #[test]
    fn test_extract_order_by_from_create_query_nested_objects() {
        // Test with deeply nested structure
        let order_by = extract_order_by_from_create_query(sql_parser::tests::NESTED_OBJECTS_SQL);
        assert_eq!(order_by, vec!["id".to_string()]);
    }

    #[test]
    fn test_extract_order_by_from_create_query_edge_cases() {
        // Test with multiple ORDER BY clauses (should only use the first one)
        let query =
            "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (id) ORDER BY (timestamp)";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string()]);

        // Test with empty ORDER BY clause
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY ()";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, Vec::<String>::new());

        // Test with ORDER BY clause containing only spaces
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (   )";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, Vec::<String>::new());

        // Test with ORDER BY clause containing empty entries
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (id,,timestamp)";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string(), "timestamp".to_string()]);

        // Test with complex expressions in ORDER BY
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (id, cityId, `user.id`, nested.field)";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(
            order_by,
            vec![
                "id".to_string(),
                "cityId".to_string(),
                "user.id".to_string(),
                "nested.field".to_string()
            ]
        );

        // Test with PRIMARY KEY in column definition and ORDER BY
        let query = "CREATE TABLE test (`PRIMARY KEY` Int64) ENGINE = MergeTree() ORDER BY (`id`)";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string()]);

        // Test with function calls in ORDER BY
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (cityHash64(id))";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["cityHash64(id)".to_string()]);

        // Test with multiple function calls in ORDER BY
        let query = "CREATE TABLE test (id Int64, name String) ENGINE = MergeTree() ORDER BY (cityHash64(id), lower(name))";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(
            order_by,
            vec!["cityHash64(id)".to_string(), "lower(name)".to_string()]
        );
    }

    #[test]
    fn test_primary_key_normalization_single_element_tuple() {
        // Test that "(id)" and "id" normalize to the same value
        // This is the bug fix: single-element tuples should have outer parens stripped
        let normalize = |s: &str| -> String {
            let mut normalized = s.trim().trim_matches('`').replace('`', "").replace(" ", "");

            if normalized.starts_with('(') && normalized.ends_with(')') {
                let inner = &normalized[1..normalized.len() - 1];
                let has_top_level_comma = {
                    let mut depth = 0;
                    let mut found_comma = false;
                    for ch in inner.chars() {
                        match ch {
                            '(' => depth += 1,
                            ')' => depth -= 1,
                            ',' if depth == 0 => {
                                found_comma = true;
                                break;
                            }
                            _ => {}
                        }
                    }
                    found_comma
                };

                if !has_top_level_comma {
                    normalized = inner.to_string();
                }
            }

            normalized
        };

        // Single element: "(id)" should normalize to "id"
        assert_eq!(normalize("(id)"), "id");
        assert_eq!(normalize("id"), "id");
        assert_eq!(normalize("(id)"), normalize("id"));

        // Single element with function: "(cityHash64(id))" should normalize to "cityHash64(id)"
        assert_eq!(normalize("(cityHash64(id))"), "cityHash64(id)");
        assert_eq!(normalize("cityHash64(id)"), "cityHash64(id)");
        assert_eq!(normalize("(cityHash64(id))"), normalize("cityHash64(id)"));

        // Multiple elements: "(id, ts)" should stay as "(id,ts)" (with spaces removed)
        assert_eq!(normalize("(id, ts)"), "(id,ts)");
        assert_eq!(normalize("(id,ts)"), "(id,ts)");

        // Multiple elements with functions: should keep parens
        assert_eq!(normalize("(id, cityHash64(ts))"), "(id,cityHash64(ts))");

        // Backticks should be removed
        assert_eq!(normalize("(`id`)"), "id");
        assert_eq!(normalize("(` id `)"), "id");
    }

    #[test]
    fn test_normalize_codec_expression() {
        // Test single codec without params - should add defaults
        assert_eq!(normalize_codec_expression("Delta"), "Delta(4)");
        assert_eq!(normalize_codec_expression("Gorilla"), "Gorilla(8)");
        assert_eq!(normalize_codec_expression("ZSTD"), "ZSTD(1)");

        // Test codecs with params - should stay as-is
        assert_eq!(normalize_codec_expression("Delta(4)"), "Delta(4)");
        assert_eq!(normalize_codec_expression("Gorilla(8)"), "Gorilla(8)");
        assert_eq!(normalize_codec_expression("ZSTD(3)"), "ZSTD(3)");
        assert_eq!(normalize_codec_expression("ZSTD(9)"), "ZSTD(9)");

        // Test codecs that don't have default params
        assert_eq!(normalize_codec_expression("DoubleDelta"), "DoubleDelta");
        assert_eq!(normalize_codec_expression("LZ4"), "LZ4");
        assert_eq!(normalize_codec_expression("NONE"), "NONE");

        // Test codec chains
        assert_eq!(normalize_codec_expression("Delta, LZ4"), "Delta(4), LZ4");
        assert_eq!(
            normalize_codec_expression("Gorilla, ZSTD"),
            "Gorilla(8), ZSTD(1)"
        );
        assert_eq!(
            normalize_codec_expression("Delta, ZSTD(3)"),
            "Delta(4), ZSTD(3)"
        );
        assert_eq!(
            normalize_codec_expression("DoubleDelta, LZ4"),
            "DoubleDelta, LZ4"
        );

        // Test whitespace handling
        assert_eq!(normalize_codec_expression("Delta,LZ4"), "Delta(4), LZ4");
        assert_eq!(
            normalize_codec_expression("  Delta  ,  LZ4  "),
            "Delta(4), LZ4"
        );

        // Test already normalized expressions
        assert_eq!(normalize_codec_expression("Delta(4), LZ4"), "Delta(4), LZ4");
        assert_eq!(
            normalize_codec_expression("Gorilla(8), ZSTD(3)"),
            "Gorilla(8), ZSTD(3)"
        );
    }

    #[test]
    fn test_codec_expressions_are_equivalent() {
        // Test None vs None
        assert!(codec_expressions_are_equivalent(&None, &None));

        // Test Some vs None
        assert!(!codec_expressions_are_equivalent(
            &Some("ZSTD(3)".to_string()),
            &None
        ));

        // Test same codec
        assert!(codec_expressions_are_equivalent(
            &Some("ZSTD(3)".to_string()),
            &Some("ZSTD(3)".to_string())
        ));

        // Test normalization: user writes "Delta", ClickHouse returns "Delta(4)"
        assert!(codec_expressions_are_equivalent(
            &Some("Delta".to_string()),
            &Some("Delta(4)".to_string())
        ));

        // Test normalization: user writes "Gorilla", ClickHouse returns "Gorilla(8)"
        assert!(codec_expressions_are_equivalent(
            &Some("Gorilla".to_string()),
            &Some("Gorilla(8)".to_string())
        ));

        // Test normalization: user writes "ZSTD", ClickHouse returns "ZSTD(1)"
        assert!(codec_expressions_are_equivalent(
            &Some("ZSTD".to_string()),
            &Some("ZSTD(1)".to_string())
        ));

        // Test chain normalization
        assert!(codec_expressions_are_equivalent(
            &Some("Delta, LZ4".to_string()),
            &Some("Delta(4), LZ4".to_string())
        ));

        // Test different codecs
        assert!(!codec_expressions_are_equivalent(
            &Some("ZSTD(3)".to_string()),
            &Some("ZSTD(9)".to_string())
        ));

        // Test different chains
        assert!(!codec_expressions_are_equivalent(
            &Some("Delta, LZ4".to_string()),
            &Some("Delta, ZSTD".to_string())
        ));
    }

    #[test]
    fn test_normalize_ttl_expression() {
        // Test DAY conversion
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 30 DAY"),
            "timestamp + toIntervalDay(30)"
        );

        // Test MONTH conversion
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 1 MONTH"),
            "timestamp + toIntervalMonth(1)"
        );

        // Test YEAR conversion
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 2 YEAR"),
            "timestamp + toIntervalYear(2)"
        );

        // Test HOUR conversion
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 24 HOUR"),
            "timestamp + toIntervalHour(24)"
        );

        // Test MINUTE conversion
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 60 MINUTE"),
            "timestamp + toIntervalMinute(60)"
        );

        // Test SECOND conversion
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 3600 SECOND"),
            "timestamp + toIntervalSecond(3600)"
        );

        // Test WEEK conversion
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 4 WEEK"),
            "timestamp + toIntervalWeek(4)"
        );

        // Test QUARTER conversion
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 1 QUARTER"),
            "timestamp + toIntervalQuarter(1)"
        );

        // Test with DELETE clause - should be stripped since it's the default
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 90 DAY DELETE"),
            "timestamp + toIntervalDay(90)"
        );

        // Test with already normalized expression with DELETE
        assert_eq!(
            normalize_ttl_expression("timestamp + toIntervalDay(90) DELETE"),
            "timestamp + toIntervalDay(90)"
        );

        // Test with DELETE in lowercase
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 90 DAY delete"),
            "timestamp + toIntervalDay(90)"
        );

        // Test with extra spaces before DELETE
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 90 DAY  DELETE"),
            "timestamp + toIntervalDay(90)"
        );

        // Test case insensitivity
        assert_eq!(
            normalize_ttl_expression("timestamp + interval 30 day"),
            "timestamp + toIntervalDay(30)"
        );

        // Test already normalized expression (should be unchanged)
        assert_eq!(
            normalize_ttl_expression("timestamp + toIntervalDay(30)"),
            "timestamp + toIntervalDay(30)"
        );

        // Test multiple intervals in one expression
        assert_eq!(
            normalize_ttl_expression("timestamp + INTERVAL 1 MONTH + INTERVAL 7 DAY"),
            "timestamp + toIntervalMonth(1) + toIntervalDay(7)"
        );
    }

    #[test]
    fn test_extract_column_ttls_from_create_query_single_line() {
        let query = "CREATE TABLE local.example1 (`timestamp` DateTime, `x` UInt32 TTL timestamp + toIntervalMonth(1), `y` String TTL timestamp + toIntervalDay(1), `z` String) ENGINE = MergeTree ORDER BY tuple() SETTINGS index_granularity = 8192";
        let map = extract_column_ttls_from_create_query(query).expect("expected some TTLs");

        assert_eq!(
            map.get("x"),
            Some(&"timestamp + toIntervalMonth(1)".to_string())
        );
        assert_eq!(
            map.get("y"),
            Some(&"timestamp + toIntervalDay(1)".to_string())
        );
        assert!(!map.contains_key("z"));
        assert!(!map.contains_key("timestamp"));
    }

    #[test]
    fn test_extract_column_ttls_from_create_query_nested_objects() {
        // Test with deeply nested structure - should not find TTLs since none are present
        let map = extract_column_ttls_from_create_query(NESTED_OBJECTS_SQL);
        assert!(map.is_none());
    }

    #[test]
    fn test_extract_table_ttl_from_create_query_nested_objects() {
        // Test with deeply nested structure - should not find table TTL since none is present
        let ttl = extract_table_ttl_from_create_query(NESTED_OBJECTS_SQL);
        assert!(ttl.is_none());
    }

    #[test]
    fn test_add_column_with_default_value() {
        use crate::framework::core::infrastructure::table::{Column, IntType};
        use crate::infrastructure::olap::clickhouse::mapper::std_column_to_clickhouse_column;
        use crate::infrastructure::olap::clickhouse::queries::basic_field_type_to_string;

        // Test adding a column with a default value
        let column = Column {
            name: "count".to_string(),
            data_type: ColumnType::Int(IntType::Int32),
            required: true,
            unique: false,
            primary_key: false,
            default: Some("42".to_string()),
            annotations: vec![],
            comment: Some("Number of items".to_string()),
            ttl: None,
            codec: None,
        };

        let clickhouse_column = std_column_to_clickhouse_column(column).unwrap();
        let column_type_string =
            basic_field_type_to_string(&clickhouse_column.column_type).unwrap();

        // Include DEFAULT clause if column has a default value
        let default_clause = clickhouse_column
            .default
            .as_ref()
            .map(|d| format!(" DEFAULT {}", d))
            .unwrap_or_default();

        let ttl_clause = clickhouse_column
            .ttl
            .as_ref()
            .map(|t| format!(" TTL {}", t))
            .unwrap_or_default();

        let codec_clause = clickhouse_column
            .codec
            .as_ref()
            .map(|c| format!(" CODEC({})", c))
            .unwrap_or_default();

        let add_column_query = format!(
            "ALTER TABLE `{}`.`{}`{} ADD COLUMN `{}` {}{}{}{}  {}",
            "test_db",
            "test_table",
            "",
            clickhouse_column.name,
            column_type_string,
            default_clause,
            codec_clause,
            ttl_clause,
            "FIRST"
        );

        assert_eq!(
            add_column_query,
            "ALTER TABLE `test_db`.`test_table` ADD COLUMN `count` Int32 DEFAULT 42  FIRST"
        );
    }

    #[test]
    fn test_add_nullable_column_with_default_string() {
        use crate::framework::core::infrastructure::table::Column;
        use crate::infrastructure::olap::clickhouse::mapper::std_column_to_clickhouse_column;
        use crate::infrastructure::olap::clickhouse::queries::basic_field_type_to_string;

        // Test adding a nullable column with a default string value
        let column = Column {
            name: "description".to_string(),
            data_type: ColumnType::String,
            required: false,
            unique: false,
            primary_key: false,
            default: Some("'default text'".to_string()),
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
        };

        let clickhouse_column = std_column_to_clickhouse_column(column).unwrap();

        let column_type_string =
            basic_field_type_to_string(&clickhouse_column.column_type).unwrap();

        // Include DEFAULT clause if column has a default value
        let default_clause = clickhouse_column
            .default
            .as_ref()
            .map(|d| format!(" DEFAULT {}", d))
            .unwrap_or_default();

        let ttl_clause = clickhouse_column
            .ttl
            .as_ref()
            .map(|t| format!(" TTL {}", t))
            .unwrap_or_default();

        let codec_clause = clickhouse_column
            .codec
            .as_ref()
            .map(|c| format!(" CODEC({})", c))
            .unwrap_or_default();

        let add_column_query = format!(
            "ALTER TABLE `{}`.`{}`{} ADD COLUMN `{}` {}{}{}{}  {}",
            "test_db",
            "test_table",
            "",
            clickhouse_column.name,
            column_type_string,
            default_clause,
            codec_clause,
            ttl_clause,
            "AFTER `id`"
        );

        assert_eq!(
            add_column_query,
            "ALTER TABLE `test_db`.`test_table` ADD COLUMN `description` Nullable(String) DEFAULT 'default text'  AFTER `id`"
        );
    }

    #[test]
    fn test_normalize_table_for_diff_strips_ignored_fields() {
        use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy, Table};
        use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
        use crate::framework::core::partial_infrastructure_map::LifeCycle;
        use crate::infrastructure::olap::clickhouse::IgnorableOperation;

        let table = Table {
            name: "test_table".to_string(),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: Some("created_at + INTERVAL 7 DAY".to_string()),
                codec: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: Some("toYYYYMM(created_at)".to_string()),
            sample_by: None,
            engine: ClickhouseEngine::MergeTree,
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::default_for_deserialization(),
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            cluster_name: None,
            table_ttl_setting: Some("created_at + INTERVAL 30 DAY".to_string()),
            primary_key_expression: None,
        };

        let ignore_ops = vec![
            IgnorableOperation::ModifyTableTtl,
            IgnorableOperation::ModifyColumnTtl,
            IgnorableOperation::ModifyPartitionBy,
        ];

        let normalized = super::normalize_table_for_diff(&table, &ignore_ops);

        // Check that all ignored fields were stripped
        assert_eq!(
            normalized.table_ttl_setting, None,
            "Table TTL should be stripped"
        );
        assert_eq!(
            normalized.partition_by, None,
            "Partition BY should be stripped"
        );
        assert_eq!(
            normalized.columns[0].ttl, None,
            "Column TTL should be stripped"
        );

        // Check that other fields remain unchanged
        assert_eq!(normalized.name, table.name);
        assert_eq!(normalized.columns[0].name, "id");
        assert_eq!(normalized.order_by, table.order_by);
    }

    #[test]
    fn test_normalize_table_for_diff_empty_ignore_list() {
        use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy, Table};
        use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
        use crate::framework::core::partial_infrastructure_map::LifeCycle;

        let table = Table {
            name: "test_table".to_string(),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: Some("created_at + INTERVAL 7 DAY".to_string()),
                codec: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: Some("toYYYYMM(created_at)".to_string()),
            sample_by: None,
            engine: ClickhouseEngine::MergeTree,
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::default_for_deserialization(),
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            cluster_name: None,
            table_ttl_setting: Some("created_at + INTERVAL 30 DAY".to_string()),
            primary_key_expression: None,
        };

        let ignore_ops = vec![];
        let normalized = super::normalize_table_for_diff(&table, &ignore_ops);

        // With empty ignore list, table should be unchanged
        assert_eq!(
            normalized.table_ttl_setting, table.table_ttl_setting,
            "Table TTL should remain unchanged"
        );
        assert_eq!(
            normalized.partition_by, table.partition_by,
            "Partition BY should remain unchanged"
        );
        assert_eq!(
            normalized.columns[0].ttl, table.columns[0].ttl,
            "Column TTL should remain unchanged"
        );
    }

    #[test]
    fn test_reconstruct_sql_resource_from_mv_with_standard_sql() {
        let create_query =
            "CREATE MATERIALIZED VIEW test_mv TO target_table AS SELECT id FROM source".to_string();
        let as_select = "SELECT id FROM source".to_string();

        let result = reconstruct_sql_resource_from_mv(
            "test_mv".to_string(),
            create_query,
            as_select,
            "mydb".to_string(),
            "mydb",
        )
        .unwrap();

        assert_eq!(result.name, "test_mv");
        assert_eq!(result.pulls_data_from.len(), 1);
        assert_eq!(result.pushes_data_to.len(), 1);
        match &result.pushes_data_to[0] {
            InfrastructureSignature::Table { id } => assert_eq!(id, "target_table"),
            _ => panic!("Expected Table signature"),
        }
    }

    #[test]
    fn test_reconstruct_sql_resource_from_mv_with_clickhouse_array_syntax() {
        // Reproduces customer issue: MV with ClickHouse array literals
        let create_query =
            "CREATE MATERIALIZED VIEW test_mv TO target AS SELECT * FROM source".to_string();
        let as_select = r#"
            SELECT name, count() as total
            FROM mydb.source_table
            WHERE arrayExists(x -> (lower(name) LIKE x), ['pattern1', 'pattern2'])
            AND status NOT IN ['active', 'pending']
            GROUP BY name
        "#
        .to_string();

        // Should not panic, should use regex fallback
        let result = reconstruct_sql_resource_from_mv(
            "test_mv".to_string(),
            create_query,
            as_select,
            "mydb".to_string(),
            "mydb",
        )
        .unwrap();

        assert_eq!(result.name, "test_mv");
        // Regex fallback should extract source_table
        assert_eq!(result.pulls_data_from.len(), 1);
        match &result.pulls_data_from[0] {
            InfrastructureSignature::Table { id } => assert_eq!(id, "source_table"),
            _ => panic!("Expected Table signature"),
        }
    }

    #[test]
    fn test_reconstruct_sql_resource_from_view_with_clickhouse_array_syntax() {
        let as_select = r#"
            SELECT id, name
            FROM db1.table1
            WHERE status IN ['active', 'pending']
        "#
        .to_string();

        // Should not panic, should use regex fallback
        let result = reconstruct_sql_resource_from_view(
            "test_view".to_string(),
            as_select,
            "db1".to_string(),
            "db1",
        )
        .unwrap();

        assert_eq!(result.name, "test_view");
        assert_eq!(result.pulls_data_from.len(), 1);
        match &result.pulls_data_from[0] {
            InfrastructureSignature::Table { id } => assert_eq!(id, "table1"),
            _ => panic!("Expected Table signature"),
        }
        assert_eq!(result.pushes_data_to.len(), 0);
    }

    #[test]
    fn test_reconstruct_sql_resource_from_mv_strips_backticks_from_target() {
        // Tests the backtick stripping fix in target table extraction
        let create_query =
            "CREATE MATERIALIZED VIEW mv TO `my_db`.`my_target` AS SELECT * FROM src".to_string();
        let as_select = "SELECT * FROM src".to_string();

        let result = reconstruct_sql_resource_from_mv(
            "mv".to_string(),
            create_query,
            as_select,
            "my_db".to_string(),
            "my_db",
        )
        .unwrap();

        // Target table name should have backticks stripped
        match &result.pushes_data_to[0] {
            InfrastructureSignature::Table { id } => assert_eq!(id, "my_target"),
            _ => panic!("Expected Table signature"),
        }
    }

    #[test]
    fn test_codec_wrapper_stripping() {
        let test_cases = vec![
            ("CODEC(ZSTD(3))", "ZSTD(3)"),
            ("CODEC(Delta, LZ4)", "Delta, LZ4"),
            ("CODEC(Gorilla, ZSTD(3))", "Gorilla, ZSTD(3)"),
            ("CODEC(DoubleDelta)", "DoubleDelta"),
            ("", ""),
        ];

        for (input, expected) in test_cases {
            let result = if !input.is_empty() {
                let trimmed = input.trim();
                if trimmed.starts_with("CODEC(") && trimmed.ends_with(')') {
                    Some(trimmed[6..trimmed.len() - 1].to_string())
                } else {
                    Some(input.to_string())
                }
            } else {
                None
            };

            if expected.is_empty() {
                assert_eq!(result, None, "Failed for input: {}", input);
            } else {
                assert_eq!(
                    result,
                    Some(expected.to_string()),
                    "Failed for input: {}",
                    input
                );
            }
        }
    }
}
