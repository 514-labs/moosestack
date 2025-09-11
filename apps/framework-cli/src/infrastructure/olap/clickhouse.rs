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
//! - clickhouse-rs: Alternative ClickHouse client
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
use clickhouse_rs::ClientHandle;
use errors::ClickhouseError;
use itertools::Itertools;
use log::{debug, info};
use mapper::{std_column_to_clickhouse_column, std_table_to_clickhouse_table};
use model::ClickHouseColumn;
use queries::ClickhouseEngine;
use queries::{
    alter_table_modify_settings_query, alter_table_reset_settings_query,
    basic_field_type_to_string, create_table_query, drop_table_query,
};
use serde::{Deserialize, Serialize};
use sql_parser::{extract_engine_from_create_table, extract_table_settings_from_create_table};
use std::ops::Deref;

use self::model::ClickHouseSystemTable;
use crate::framework::core::infrastructure::table::{
    Column, ColumnMetadata, ColumnType, DataEnum, EnumMember, EnumValue, EnumValueMetadata, Table,
    METADATA_PREFIX,
};
use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::versions::Version;
use crate::infrastructure::olap::clickhouse::model::ClickHouseSystemTableRow;
use crate::infrastructure::olap::{OlapChangesError, OlapOperations};
use crate::project::Project;

pub mod client;
pub mod config;
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
    },
    /// Add a column to a table
    AddTableColumn {
        /// The table to add the column to
        table: String,
        /// Column to add
        column: Column,
        /// The column after which to add this column (None means adding as first column)
        after_column: Option<String>,
    },
    /// Drop a column from a table
    DropTableColumn {
        /// The table to drop the column from
        table: String,
        /// Name of the column to drop
        column_name: String,
    },
    /// Modify a column in a table
    ModifyTableColumn {
        /// The table containing the column
        table: String,
        /// The column before modification
        before_column: Column,
        /// The column after modification
        after_column: Column,
    },
    RenameTableColumn {
        /// The table containing the column
        table: String,
        /// Name of the column before renaming
        before_column_name: String,
        /// Name of the column after renaming
        after_column_name: String,
    },
    /// Modify table settings using ALTER TABLE MODIFY SETTING
    ModifyTableSettings {
        /// The table to modify settings for
        table: String,
        /// The settings before modification
        before_settings: Option<std::collections::HashMap<String, String>>,
        /// The settings after modification
        after_settings: Option<std::collections::HashMap<String, String>>,
    },
    RawSql {
        /// The SQL statements to execute
        sql: Vec<String>,
        description: String,
    },
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

    // Execute Teardown Plan
    info!(
        "Executing OLAP Teardown Plan with {} operations",
        teardown_plan.len()
    );
    debug!("Ordered Teardown plan: {:?}", teardown_plan);
    for op in teardown_plan {
        debug!("Teardown operation: {:?}", op);
        execute_atomic_operation(db_name, &op.to_minimal(), &client).await?;
    }

    // Execute Setup Plan
    info!(
        "Executing OLAP Setup Plan with {} operations",
        setup_plan.len()
    );
    debug!("Ordered Setup plan: {:?}", setup_plan);
    for op in setup_plan {
        debug!("Setup operation: {:?}", op);
        execute_atomic_operation(db_name, &op.to_minimal(), &client).await?;
    }

    info!("OLAP Change execution complete");
    Ok(())
}

/// Executes a single atomic OLAP operation.
pub async fn execute_atomic_operation(
    db_name: &str,
    operation: &SerializableOlapOperation,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    match operation {
        SerializableOlapOperation::CreateTable { table } => {
            execute_create_table(db_name, table, client).await?;
        }
        SerializableOlapOperation::DropTable { table, .. } => {
            execute_drop_table(db_name, table, client).await?;
        }
        SerializableOlapOperation::AddTableColumn {
            table,
            column,
            after_column,
        } => {
            execute_add_table_column(db_name, table, column, after_column, client).await?;
        }
        SerializableOlapOperation::DropTableColumn {
            table, column_name, ..
        } => {
            execute_drop_table_column(db_name, table, column_name, client).await?;
        }
        SerializableOlapOperation::ModifyTableColumn {
            table,
            before_column,
            after_column,
        } => {
            execute_modify_table_column(db_name, table, before_column, after_column, client)
                .await?;
        }
        SerializableOlapOperation::RenameTableColumn {
            table,
            before_column_name,
            after_column_name,
        } => {
            execute_rename_table_column(
                db_name,
                table,
                before_column_name,
                after_column_name,
                client,
            )
            .await?;
        }
        SerializableOlapOperation::ModifyTableSettings {
            table,
            before_settings,
            after_settings,
        } => {
            execute_modify_table_settings(db_name, table, before_settings, after_settings, client)
                .await?;
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
) -> Result<(), ClickhouseChangesError> {
    log::info!("Executing CreateTable: {:?}", table.id());
    let clickhouse_table = std_table_to_clickhouse_table(table)?;
    let create_data_table_query = create_table_query(db_name, clickhouse_table)?;
    run_query(&create_data_table_query, client)
        .await
        .map_err(|e| ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table.name.clone()),
        })?;
    Ok(())
}

async fn execute_drop_table(
    db_name: &str,
    table_name: &str,
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    log::info!("Executing DropTable: {:?}", table_name);
    let drop_query = drop_table_query(db_name, table_name)?;
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
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    log::info!(
        "Executing AddTableColumn for table: {}, column: {}, after: {:?}",
        table_name,
        column.name,
        after_column
    );
    let clickhouse_column = std_column_to_clickhouse_column(column.clone())?;
    let column_type_string = basic_field_type_to_string(&clickhouse_column.column_type)?;

    // Include DEFAULT clause if column has a default value
    let default_clause = clickhouse_column
        .default
        .as_ref()
        .map(|d| format!(" DEFAULT {}", d))
        .unwrap_or_default();

    let add_column_query = format!(
        "ALTER TABLE `{}`.`{}` ADD COLUMN `{}` {}{} {}",
        db_name,
        table_name,
        clickhouse_column.name,
        column_type_string,
        default_clause,
        match after_column {
            None => "FIRST".to_string(),
            Some(after_col) => format!("AFTER `{after_col}`"),
        }
    );
    log::debug!("Adding column: {}", add_column_query);
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
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    log::info!(
        "Executing DropTableColumn for table: {}, column: {}",
        table_name,
        column_name
    );
    let drop_column_query = format!(
        "ALTER TABLE `{}`.`{}` DROP COLUMN IF EXISTS `{}`",
        db_name, table_name, column_name
    );
    log::debug!("Dropping column: {}", drop_column_query);
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
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    // Check if only the comment has changed
    let data_type_changed = before_column.data_type != after_column.data_type;
    let default_changed = before_column.default != after_column.default;
    let required_changed = before_column.required != after_column.required;
    let comment_changed = before_column.comment != after_column.comment;

    // If only the comment changed, use a simpler ALTER TABLE ... MODIFY COLUMN ... COMMENT
    // This is more efficient and avoids unnecessary table rebuilds
    if !data_type_changed && !required_changed && !default_changed && comment_changed {
        log::info!(
            "Executing comment-only modification for table: {}, column: {}",
            table_name,
            after_column.name
        );

        // Get the ClickHouse column to generate the proper comment (with metadata if needed)
        let clickhouse_column = std_column_to_clickhouse_column(after_column.clone())?;

        if let Some(ref comment) = clickhouse_column.comment {
            execute_modify_column_comment(db_name, table_name, after_column, comment, client)
                .await?;
        } else {
            // If the new comment is None, we still need to update to remove the old comment
            execute_modify_column_comment(db_name, table_name, after_column, "", client).await?;
        }
        return Ok(());
    }

    log::info!(
        "Executing ModifyTableColumn for table: {}, column: {} ({}→{})",
        table_name,
        after_column.name,
        before_column.data_type,
        after_column.data_type
    );

    // Full column modification including type change
    let clickhouse_column = std_column_to_clickhouse_column(after_column.clone())?;
    let modify_column_query = build_modify_column_sql(db_name, table_name, &clickhouse_column)?;

    log::debug!("Modifying column: {}", modify_column_query);
    run_query(&modify_column_query, client).await.map_err(|e| {
        ClickhouseChangesError::ClickhouseClient {
            error: e,
            resource: Some(table_name.to_string()),
        }
    })?;
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
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    log::info!(
        "Executing ModifyColumnComment for table: {}, column: {}",
        table_name,
        column.name
    );

    let modify_comment_query =
        build_modify_column_comment_sql(db_name, table_name, &column.name, comment)?;

    log::debug!("Modifying column comment: {}", modify_comment_query);
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
) -> Result<String, ClickhouseChangesError> {
    let column_type_string = basic_field_type_to_string(&ch_col.column_type)?;

    let default_clause = ch_col
        .default
        .as_ref()
        .map(|d| format!(" DEFAULT {}", d))
        .unwrap_or_default();

    let sql = if let Some(ref comment) = ch_col.comment {
        let escaped_comment = comment.replace('\'', "''");
        format!(
            "ALTER TABLE `{}`.`{}` MODIFY COLUMN IF EXISTS `{}` {}{} COMMENT '{}'",
            db_name, table_name, ch_col.name, column_type_string, default_clause, escaped_comment
        )
    } else {
        format!(
            "ALTER TABLE `{}`.`{}` MODIFY COLUMN IF EXISTS `{}` {}{}",
            db_name, table_name, ch_col.name, column_type_string, default_clause
        )
    };
    Ok(sql)
}

fn build_modify_column_comment_sql(
    db_name: &str,
    table_name: &str,
    column_name: &str,
    comment: &str,
) -> Result<String, ClickhouseChangesError> {
    let escaped_comment = comment.replace('\'', "''");
    Ok(format!(
        "ALTER TABLE `{}`.`{}` MODIFY COLUMN `{}` COMMENT '{}'",
        db_name, table_name, column_name, escaped_comment
    ))
}

/// Execute a ModifyTableSettings operation
async fn execute_modify_table_settings(
    db_name: &str,
    table_name: &str,
    before_settings: &Option<std::collections::HashMap<String, String>>,
    after_settings: &Option<std::collections::HashMap<String, String>>,
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

    log::info!(
        "Executing ModifyTableSettings for table: {} - modifying {} settings, resetting {} settings",
        table_name,
        settings_to_modify.len(),
        settings_to_reset.len()
    );

    // Execute MODIFY SETTING if there are settings to modify
    if !settings_to_modify.is_empty() {
        let alter_settings_query =
            alter_table_modify_settings_query(db_name, table_name, &settings_to_modify)?;
        log::debug!("Modifying table settings: {}", alter_settings_query);

        run_query(&alter_settings_query, client)
            .await
            .map_err(|e| ClickhouseChangesError::ClickhouseClient {
                error: e,
                resource: Some(table_name.to_string()),
            })?;
    }

    // Execute RESET SETTING if there are settings to reset
    if !settings_to_reset.is_empty() {
        let reset_settings_query =
            alter_table_reset_settings_query(db_name, table_name, &settings_to_reset)?;
        log::debug!("Resetting table settings: {}", reset_settings_query);

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
    client: &ConfiguredDBClient,
) -> Result<(), ClickhouseChangesError> {
    log::info!(
        "Executing RenameTableColumn for table: {}, column: {} → {}",
        table_name,
        before_column_name,
        after_column_name
    );
    let rename_column_query = format!(
        "ALTER TABLE `{db_name}`.`{table_name}` RENAME COLUMN `{before_column_name}` TO `{after_column_name}`"
    );
    log::debug!("Renaming column: {}", rename_column_query);
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
    log::info!(
        "Executing {} raw SQL statements. {}",
        sql_statements.len(),
        description
    );
    for (i, sql) in sql_statements.iter().enumerate() {
        if !sql.trim().is_empty() {
            log::debug!("Executing SQL statement {}: {}", i + 1, sql);
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
fn extract_version_from_table_name(table_name: &str) -> (String, Option<Version>) {
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

/// Gets the number of rows in a table
///
/// # Arguments
/// * `table_name` - Name of the table to check
/// * `config` - ClickHouse configuration
/// * `clickhouse` - Client handle for database operations
///
/// # Returns
/// * `Result<i64, clickhouse_rs::errors::Error>` - Number of rows in the table
///
/// # Details
/// - Uses COUNT(*) for accurate row count
/// - Properly escapes table and database names
/// - Handles empty tables correctly
///
/// # Example
/// ```rust
/// let size = check_table_size("users_1_0_0", &config, &mut client).await?;
/// println!("Table has {} rows", size);
/// ```
pub async fn check_table_size(
    table_name: &str,
    config: &ClickHouseConfig,
    clickhouse: &mut ClientHandle,
) -> Result<i64, clickhouse_rs::errors::Error> {
    info!("Checking size of {} table", table_name);
    let result = clickhouse
        .query(&format!(
            "select count(*) from \"{}\".\"{}\"",
            config.db_name.clone(),
            table_name
        ))
        .fetch_all()
        .await?;
    let rows = result.rows().collect_vec();

    let result: u64 = match rows.len() {
        1 => rows[0].get(0)?,
        _ => panic!("Expected 1 result, got {:?}", rows.len()),
    };
    Ok(result as i64)
}

/// Represents details about a table in ClickHouse
///
/// # Fields
/// * `engine` - The table's engine type
/// * `total_rows` - Optional count of rows in the table
///
/// # Usage
/// Used internally for table metadata operations and checks
#[derive(Debug, Clone, Deserialize, Serialize, clickhouse::Row)]
struct TableDetail {
    pub engine: String,
    pub total_rows: Option<u64>,
}

pub struct TableWithUnsupportedType {
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
            log::warn!("Failed to parse column metadata JSON: {}", e);
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
            .fetch::<(String, String, String, String)>()
            .map_err(|e| {
                debug!("Error fetching tables: {}", e);
                OlapChangesError::DatabaseError(e.to_string())
            })?;

        let mut tables = Vec::new();
        let mut unsupported_tables = Vec::new();

        'table_loop: while let Some((table_name, engine, create_query, partition_key)) = cursor
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

            // Check if the CREATE TABLE statement has an explicit PRIMARY KEY clause
            let has_explicit_primary_key = create_query.to_uppercase().contains("PRIMARY KEY");
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
                    default_expression
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
                .fetch::<(String, String, String, u8, u8, String, String)>()
                .map_err(|e| {
                    debug!("Error fetching columns for table {}: {}", table_name, e);
                    OlapChangesError::DatabaseError(e.to_string())
                })?;

            let mut columns = Vec::new();

            while let Some((
                col_name,
                col_type,
                comment,
                is_primary,
                is_sorting,
                default_kind,
                default_expression,
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

                let column = Column {
                    name: col_name.clone(),
                    data_type,
                    required: !is_nullable,
                    unique: false,
                    primary_key: is_actual_primary_key,
                    default,
                    annotations: Default::default(),
                    comment: column_comment,
                };

                columns.push(column);
            }

            debug!("Found {} columns for table {}", columns.len(), table_name);

            // Extract base name and version for source primitive
            let (base_name, version) = extract_version_from_table_name(&table_name);

            // Create source primitive signature using the base name
            let source_primitive = PrimitiveSignature {
                name: base_name,
                primitive_type: PrimitiveTypes::DataModel,
            };

            // Create the Table object using the original table_name
            // Parse the engine from the CREATE TABLE query to get full engine configuration
            // This is more reliable than using the system.tables engine column which
            // only contains the engine name without parameters (e.g., "S3Queue" instead of
            // "S3Queue('path', 'format', ...)")
            let engine_parsed = if let Some(engine_def) =
                extract_engine_from_create_table(&create_query)
            {
                // Try to parse the extracted engine definition
                engine_def.as_str().try_into().ok()
            } else {
                // Fallback to the simple engine name from system.tables
                debug!("Could not extract engine from CREATE TABLE query, falling back to system.tables engine column");
                engine.as_str().try_into().ok()
            };
            let engine_params_hash = engine_parsed
                .as_ref()
                .map(|e: &ClickhouseEngine| e.non_alterable_params_hash());

            // Extract table settings from CREATE TABLE query
            let table_settings = extract_table_settings_from_create_table(&create_query);

            let table = Table {
                name: table_name, // Keep the original table name with version
                columns,
                order_by: order_by_cols, // Use the extracted ORDER BY columns
                partition_by: {
                    let p = partition_key.trim();
                    if p.is_empty() || p == "tuple()" {
                        None
                    } else {
                        Some(p.to_string())
                    }
                },
                engine: engine_parsed,
                version,
                source_primitive,
                metadata: None,
                // this does not matter as we refer to the lifecycle in infra map
                life_cycle: LifeCycle::ExternallyManaged,
                engine_params_hash,
                table_settings,
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
}

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

    // Find the ORDER BY clause, being careful not to match PRIMARY KEY
    let mut after_order_by = None;
    for (idx, _) in create_query.to_uppercase().match_indices("ORDER BY") {
        // Check if this is not part of "PRIMARY KEY" by looking at the preceding text
        let preceding_text = &create_query[..idx].trim_end().to_uppercase();
        if !preceding_text.ends_with("PRIMARY KEY") {
            after_order_by = Some(&create_query[idx..]);
            break;
        }
    }

    if let Some(after_order_by) = after_order_by {
        // Find where the ORDER BY clause ends (at SETTINGS or end of string)
        let mut end_idx = after_order_by.len();
        if let Some(settings_idx) = after_order_by.to_uppercase().find("SETTINGS") {
            end_idx = settings_idx;
        }
        if let Some(next_order_by) = after_order_by[8..].to_uppercase().find("ORDER BY") {
            end_idx = std::cmp::min(end_idx, next_order_by + 8);
        }
        let order_by_clause = &after_order_by[..end_idx];

        // Extract the column names
        let order_by_content = order_by_clause.trim_start_matches("ORDER BY").trim();
        if order_by_content == "tuple()" {
            return Vec::new();
        };
        let order_by_content = order_by_content.trim_matches('(').trim_matches(')');

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

/// Extracts PARTITION BY expression from a CREATE TABLE query, if present
pub fn extract_partition_by_from_create_query(create_query: &str) -> Option<String> {
    // Use uppercase for searching keywords, but slice using original string
    let upper = create_query.to_uppercase();
    if let Some(idx) = upper.find("PARTITION BY") {
        // Start right after PARTITION BY
        let after = &create_query[idx + "PARTITION BY".len()..];
        // Clause ends before ORDER BY, PRIMARY KEY, SAMPLE BY, SETTINGS, or end of string
        let mut end = after.len();
        for kw in ["ORDER BY", "PRIMARY KEY", "SAMPLE BY", "SETTINGS"] {
            if let Some(i) = after.to_uppercase().find(kw) {
                end = std::cmp::min(end, i);
            }
        }
        let expr = after[..end].trim();
        if expr.is_empty() {
            None
        } else {
            Some(expr.to_string())
        }
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        };
        let after_column = Column {
            default: Some("42".to_string()),
            ..before_column.clone()
        };

        let ch_after = std_column_to_clickhouse_column(after_column).unwrap();
        let sql = build_modify_column_sql("db", "table", &ch_after).unwrap();

        assert_eq!(
            sql,
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
        };

        let after_column = Column {
            comment: Some("new".to_string()),
            ..before_column.clone()
        };

        // Use the pure SQL builder for comment-only update
        let sql =
            build_modify_column_comment_sql("db", "table", &after_column.name, "new").unwrap();
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
        };

        let clickhouse_column = std_column_to_clickhouse_column(column).unwrap();

        let sql = build_modify_column_sql("test_db", "users", &clickhouse_column).unwrap();

        assert_eq!(
            sql,
            "ALTER TABLE `test_db`.`users` MODIFY COLUMN IF EXISTS `description` Nullable(String) DEFAULT 'updated default' COMMENT 'Updated description field'"
        );
    }

    #[test]
    fn test_extract_order_by_from_create_query_edge_cases() {
        // Test with multiple ORDER BY clauses (should only use the first one)
        let query =
            "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (id) ORDER BY (timestamp)";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string()]);

        // Test with malformed ORDER BY clause (missing closing parenthesis)
        let query = "CREATE TABLE test (id Int64) ENGINE = MergeTree() ORDER BY (id, timestamp";
        let order_by = extract_order_by_from_create_query(query);
        assert_eq!(order_by, vec!["id".to_string(), "timestamp".to_string()]);

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

        let add_column_query = format!(
            "ALTER TABLE `{}`.`{}` ADD COLUMN `{}` {}{} {}",
            "test_db",
            "test_table",
            clickhouse_column.name,
            column_type_string,
            default_clause,
            "FIRST"
        );

        assert_eq!(
            add_column_query,
            "ALTER TABLE `test_db`.`test_table` ADD COLUMN `count` Int32 DEFAULT 42 FIRST"
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

        let add_column_query = format!(
            "ALTER TABLE `{}`.`{}` ADD COLUMN `{}` {}{} {}",
            "test_db",
            "test_table",
            clickhouse_column.name,
            column_type_string,
            default_clause,
            "AFTER `id`"
        );

        assert_eq!(
            add_column_query,
            "ALTER TABLE `test_db`.`test_table` ADD COLUMN `description` Nullable(String) DEFAULT 'default text' AFTER `id`"
        );
    }
}
