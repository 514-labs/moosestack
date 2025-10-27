use clickhouse::ClickhouseChangesError;

use crate::infrastructure::olap::clickhouse::TableWithUnsupportedType;
use crate::{
    framework::core::infrastructure::table::Table, framework::core::infrastructure_map::OlapChange,
    project::Project,
};

pub mod clickhouse;
pub mod clickhouse_alt_client;
pub mod ddl_ordering;

#[derive(Debug, thiserror::Error)]
pub enum OlapChangesError {
    #[error("Failed to execute the changes on Clickhouse")]
    ClickhouseChanges(#[from] ClickhouseChangesError),
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Failed to order OLAP changes")]
    OrderingError(#[from] ddl_ordering::PlanOrderingError),

    #[error("Failed to parse ClickHouse type: {0}")]
    ClickhouseTypeParser(#[from] clickhouse::type_parser::ClickHouseTypeError),
    #[error("Failed to parse ClickHouse SQL: {0}")]
    ClickhouseSqlParse(#[from] clickhouse::sql_parser::SqlParseError),
}

/// Trait defining operations that can be performed on an OLAP database
#[async_trait::async_trait]
pub trait OlapOperations {
    /// Retrieves all tables from the database
    ///
    /// # Arguments
    ///
    /// * `db_name` - The name of the database to list tables from
    /// * `project` - The project configuration containing the current version
    ///
    /// # Returns
    ///
    /// * `Result<(Vec<Table>, Vec<TableWithUnsupportedType>), OlapChangesError>` -
    /// A list of Table objects and a list of TableWithUnsupportedType on success, or an error if the operation fails
    ///
    /// # Errors
    ///
    /// Returns `OlapChangesError` if:
    /// - The database connection fails
    /// - The database doesn't exist
    /// - The query execution fails
    /// - Table metadata cannot be retrieved
    async fn list_tables(
        &self,
        db_name: &str,
        project: &Project,
    ) -> Result<(Vec<Table>, Vec<TableWithUnsupportedType>), OlapChangesError>;
}

/// This method dispatches the execution of the changes to the right olap storage.
/// When we have multiple storages (DuckDB, ...) this is where it goes.
pub async fn execute_changes(
    project: &Project,
    changes: &[OlapChange],
) -> Result<(), OlapChangesError> {
    // Order changes based on dependencies, including database context for SQL resources
    let (teardown_plan, setup_plan) =
        ddl_ordering::order_olap_changes(changes, &project.clickhouse_config.db_name)?;

    // Execute the ordered changes
    clickhouse::execute_changes(project, &teardown_plan, &setup_plan).await?;
    Ok(())
}
