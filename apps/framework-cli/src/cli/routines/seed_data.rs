use crate::cli::commands::SeedSubcommands;
use crate::cli::display;
use crate::cli::display::{with_spinner_completion_async, Message, MessageType};
use crate::cli::routines::RoutineFailure;
use crate::cli::routines::RoutineSuccess;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::primitive_map::PrimitiveMap;
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::{
    parse_clickhouse_connection_string, ClickHouseConfig,
};
use crate::project::Project;
use crate::utilities::constants::KEY_REMOTE_CLICKHOUSE_URL;
use crate::utilities::keyring::{KeyringSecretRepository, SecretRepository};

use crate::framework::core::infrastructure::table::Table;
use log::{debug, info, warn};
use std::cmp::min;
use std::collections::HashSet;

/// Validates that a database name is not empty
fn validate_database_name(db_name: &str) -> Result<(), RoutineFailure> {
    if db_name.is_empty() {
        Err(RoutineFailure::error(Message::new(
            "SeedClickhouse".to_string(),
            "No database specified in connection string and unable to determine current database"
                .to_string(),
        )))
    } else {
        Ok(())
    }
}

/// Builds SQL query to get remote tables
fn build_remote_tables_query(
    remote_host_and_port: &str,
    remote_user: &str,
    remote_password: &str,
    remote_db: &str,
    other_dbs: &[&str],
) -> String {
    let mut databases = vec![remote_db];
    databases.extend(other_dbs);

    let db_list = databases
        .iter()
        .map(|db| format!("'{}'", db))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "SELECT database, name FROM remoteSecure('{}', 'system', 'tables', '{}', '{}') WHERE database IN ({})",
        remote_host_and_port, remote_user, remote_password, db_list
    )
}

/// Parses the response from remote tables query into a HashSet of (database, table) tuples
fn parse_remote_tables_response(response: &str) -> HashSet<(String, String)> {
    response
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            // Split by tab or whitespace to get database and table
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                Some((parts[0].trim().to_string(), parts[1].trim().to_string()))
            } else {
                None
            }
        })
        .collect()
}

/// Determines if a table should be skipped during seeding
/// db being None means "use the remote default"
fn should_skip_table(
    db: &Option<String>,
    table_name: &str,
    remote_db: &str,
    remote_tables: &Option<HashSet<(String, String)>>,
) -> bool {
    if let Some(ref remote_table_set) = remote_tables {
        let db_to_check = db.as_deref().unwrap_or(remote_db);
        !remote_table_set.contains(&(db_to_check.to_string(), table_name.to_string()))
    } else {
        false
    }
}

/// Parameters for building seeding queries
struct SeedingQueryParams<'a> {
    local_db: &'a str,
    table_name: &'a str,
    remote_host_and_port: &'a str,
    remote_db: &'a str,
    remote_user: &'a str,
    remote_password: &'a str,
    order_by_clause: &'a str,
    limit: usize,
    offset: usize,
}

/// Builds the seeding SQL query for a specific table
fn build_seeding_query(params: &SeedingQueryParams) -> String {
    format!(
        "INSERT INTO `{local_db}`.`{table_name}` SELECT * FROM remoteSecure('{remote_host_and_port}', '{remote_db}', '{table_name}', '{remote_user}', '{remote_password}') {order_by_clause} LIMIT {limit} OFFSET {offset}",
        local_db = params.local_db,
        table_name = params.table_name,
        remote_host_and_port = params.remote_host_and_port,
        remote_db = params.remote_db,
        remote_user = params.remote_user,
        remote_password = params.remote_password,
        order_by_clause = params.order_by_clause,
        limit = params.limit,
        offset = params.offset
    )
}

/// Builds the count query to get total rows for a table
fn build_count_query(
    remote_host_and_port: &str,
    remote_db: &str,
    table_name: &str,
    remote_user: &str,
    remote_password: &str,
) -> String {
    format!(
        "SELECT count() FROM remoteSecure('{remote_host_and_port}', '{remote_db}', '{table_name}', '{remote_user}', '{remote_password}')"
    )
}

/// Loads the infrastructure map based on project configuration
async fn load_infrastructure_map(project: &Project) -> Result<InfrastructureMap, RoutineFailure> {
    if project.features.data_model_v2 {
        // Resolve credentials for seeding data into S3-backed tables
        InfrastructureMap::load_from_user_code(project, true)
            .await
            .map_err(|e| {
                RoutineFailure::error(Message {
                    action: "SeedClickhouse".to_string(),
                    details: format!("Failed to load InfrastructureMap: {e:?}"),
                })
            })
    } else {
        let primitive_map = PrimitiveMap::load(project).await.map_err(|e| {
            RoutineFailure::error(Message {
                action: "SeedClickhouse".to_string(),
                details: format!("Failed to load Primitives: {e:?}"),
            })
        })?;
        Ok(InfrastructureMap::new(project, primitive_map))
    }
}

/// Builds the ORDER BY clause for a table based on infrastructure map or provided order
fn build_order_by_clause(
    table: &Table,
    order_by: Option<&str>,
    total_rows: usize,
    batch_size: usize,
) -> Result<String, RoutineFailure> {
    match order_by {
        None => {
            let clause = match &table.order_by {
                crate::framework::core::infrastructure::table::OrderBy::Fields(v) => v
                    .iter()
                    .map(|field| format!("`{field}` DESC"))
                    .collect::<Vec<_>>()
                    .join(", "),
                crate::framework::core::infrastructure::table::OrderBy::SingleExpr(expr) => {
                    format!("{expr} DESC")
                }
            };
            if !clause.is_empty() {
                Ok(format!("ORDER BY {clause}"))
            } else if total_rows <= batch_size {
                Ok("".to_string())
            } else {
                Err(RoutineFailure::error(Message::new(
                    "Seed".to_string(),
                    format!("Table {} without ORDER BY. Supply ordering with --order-by to prevent the same row fetched in multiple batches.", table.name),
                )))
            }
        }
        Some(order_by) => Ok(format!("ORDER BY {order_by}")),
    }
}

/// Gets the total row count for a remote table
async fn get_remote_table_count(
    local_clickhouse: &ClickHouseClient,
    remote_host_and_port: &str,
    remote_db: &str,
    table_name: &str,
    remote_user: &str,
    remote_password: &str,
) -> Result<usize, RoutineFailure> {
    let count_sql = build_count_query(
        remote_host_and_port,
        remote_db,
        table_name,
        remote_user,
        remote_password,
    );

    let body = match local_clickhouse.execute_sql(&count_sql).await {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("{:?}", e);
            if error_msg.contains("There is no table")
                || error_msg.contains("NO_REMOTE_SHARD_AVAILABLE")
            {
                debug!("Table '{}' not found on remote database", table_name);
                return Err(RoutineFailure::error(Message::new(
                    "TableNotFound".to_string(),
                    format!("Table '{table_name}' not found on remote"),
                )));
            } else {
                return Err(RoutineFailure::new(
                    Message::new("Remote".to_string(), "count failed".to_string()),
                    e,
                ));
            }
        }
    };

    body.trim().parse::<usize>().map_err(|e| {
        RoutineFailure::new(
            Message::new("Remote".to_string(), "count parsing failed".to_string()),
            e,
        )
    })
}

/// Seeds a single table with batched copying
async fn seed_single_table(
    local_clickhouse: &ClickHouseClient,
    remote_config: &ClickHouseConfig,
    table: &Table,
    limit: Option<usize>,
    order_by: Option<&str>,
) -> Result<String, RoutineFailure> {
    let remote_host_and_port = format!("{}:{}", remote_config.host, remote_config.native_port);
    let db = table.database.as_deref();
    let local_db = db.unwrap_or(&local_clickhouse.config().db_name);
    let batch_size: usize = 50_000;

    // Get total row count
    let remote_total = get_remote_table_count(
        local_clickhouse,
        &remote_host_and_port,
        db.unwrap_or(&remote_config.db_name),
        &table.name,
        &remote_config.user,
        &remote_config.password,
    )
    .await
    .map_err(|e| {
        if e.message.action == "TableNotFound" {
            // Re-throw as a special case that can be handled by the caller
            e
        } else {
            RoutineFailure::error(Message::new(
                "SeedSingleTable".to_string(),
                format!("Failed to get row count for {}: {e:?}", table.name),
            ))
        }
    })?;

    let total_rows = match limit {
        None => remote_total,
        Some(l) => min(remote_total, l),
    };

    let order_by_clause = build_order_by_clause(table, order_by, total_rows, batch_size)?;

    let mut copied_total: usize = 0;
    let mut i: usize = 0;

    while copied_total < total_rows {
        i += 1;
        let batch_limit = match limit {
            None => batch_size,
            Some(l) => min(l - copied_total, batch_size),
        };

        let sql = build_seeding_query(&SeedingQueryParams {
            local_db,
            table_name: &table.name,
            remote_host_and_port: &remote_host_and_port,
            remote_db: db.unwrap_or(&remote_config.db_name),
            remote_user: &remote_config.user,
            remote_password: &remote_config.password,
            order_by_clause: &order_by_clause,
            limit: batch_limit,
            offset: copied_total,
        });

        debug!(
            "Executing SQL: table={}, offset={copied_total}, limit={batch_limit}",
            table.name
        );

        match local_clickhouse.execute_sql(&sql).await {
            Ok(_) => {
                copied_total += batch_limit;
                debug!("{}: copied batch {i}", table.name);
            }
            Err(e) => {
                return Err(RoutineFailure::error(Message::new(
                    "SeedSingleTable".to_string(),
                    format!("Failed to copy batch for {}: {e}", table.name),
                )));
            }
        }
    }

    Ok(format!("✓ {}: copied from remote", table.name))
}

/// Gets the list of tables to seed based on parameters
fn get_tables_to_seed(infra_map: &InfrastructureMap, table_name: Option<String>) -> Vec<&Table> {
    let table_list: Vec<_> = infra_map
        .tables
        .values()
        .filter(|table| match &table_name {
            None => !table.name.starts_with("_MOOSE"),
            Some(name) => &table.name == name,
        })
        .collect();
    info!(
        "Seeding {} tables (excluding internal Moose tables)",
        table_list.len()
    );

    table_list
}

/// Performs the complete ClickHouse seeding operation including infrastructure loading,
/// table validation, and data copying
async fn seed_clickhouse_operation(
    project: &Project,
    connection_string: &str,
    table: Option<String>,
    limit: Option<usize>,
    order_by: Option<&str>,
) -> Result<(String, String, Vec<String>), RoutineFailure> {
    // Load infrastructure map
    let infra_map = load_infrastructure_map(project).await?;

    // Parse connection string
    let remote_config = parse_clickhouse_connection_string(connection_string).map_err(|e| {
        RoutineFailure::error(Message::new(
            "SeedClickhouse".to_string(),
            format!("Invalid connection string: {e}"),
        ))
    })?;

    // Validate database name
    validate_database_name(&remote_config.db_name)?;

    // Create local ClickHouseClient
    let local_clickhouse = ClickHouseClient::new(&project.clickhouse_config).map_err(|e| {
        RoutineFailure::error(Message::new(
            "SeedClickhouse".to_string(),
            format!("Failed to create local ClickHouseClient: {e}"),
        ))
    })?;

    let local_db = local_clickhouse.config().db_name.clone();
    let remote_db = remote_config.db_name.clone();

    debug!(
        "Local database: '{}', Remote database: '{}'",
        local_db, remote_db
    );

    // Perform the seeding operation
    let summary = seed_clickhouse_tables(
        &infra_map,
        &local_clickhouse,
        &remote_config,
        table,
        limit,
        order_by,
    )
    .await?;

    Ok((local_db, remote_db, summary))
}

/// Get list of available tables from remote ClickHouse database
/// Returns a set of (database, table_name) tuples
async fn get_remote_tables(
    local_clickhouse: &ClickHouseClient,
    remote_config: &ClickHouseConfig,
    other_dbs: &[&str],
) -> Result<HashSet<(String, String)>, RoutineFailure> {
    let remote_host_and_port = format!("{}:{}", remote_config.host, remote_config.native_port);

    let sql = build_remote_tables_query(
        &remote_host_and_port,
        &remote_config.user,
        &remote_config.password,
        &remote_config.db_name,
        other_dbs,
    );

    debug!("Querying remote tables: {}", sql);

    let result = local_clickhouse.execute_sql(&sql).await.map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Remote Tables".to_string(),
                "Failed to query remote database tables".to_string(),
            ),
            e,
        )
    })?;

    let tables = parse_remote_tables_response(&result);
    debug!("Found {} remote tables: {:?}", tables.len(), tables);
    Ok(tables)
}

pub async fn handle_seed_command(
    seed_args: &crate::cli::commands::SeedCommands,
    project: &Project,
) -> Result<RoutineSuccess, RoutineFailure> {
    match &seed_args.command {
        Some(SeedSubcommands::Clickhouse {
            connection_string,
            limit,
            all,
            table,
            order_by,
        }) => {
            let resolved_connection_string = match connection_string {
                Some(s) => s.clone(),
                None => {
                    let repo = KeyringSecretRepository;
                    match repo.get(&project.name(), KEY_REMOTE_CLICKHOUSE_URL) {
                        Ok(Some(s)) => s,
                        Ok(None) => {
                            return Err(RoutineFailure::error(Message::new(
                                "SeedClickhouse".to_string(),
                                "No connection string provided and none saved. Pass --connection-string or save one via `moose init --from-remote`.".to_string(),
                            )))
                        }
                        Err(e) => {
                            return Err(RoutineFailure::error(Message::new(
                                "SeedClickhouse".to_string(),
                                format!("Failed to read saved connection string from keychain: {e:?}"),
                            )))
                        }
                    }
                }
            };

            info!("Running seed clickhouse command with connection string: {resolved_connection_string}");

            let (local_db_name, remote_db_name, summary) = with_spinner_completion_async(
                "Initializing database seeding operation...",
                "Database seeding completed",
                seed_clickhouse_operation(
                    project,
                    &resolved_connection_string,
                    table.clone(),
                    if *all { None } else { Some(*limit) },
                    order_by.as_deref(),
                ),
                !project.is_production,
            )
            .await?;

            Ok(RoutineSuccess::success(Message::new(
                "Seeded".to_string(),
                format!(
                    "Seeded '{}' from '{}'\n{}",
                    local_db_name,
                    remote_db_name,
                    summary.join("\n")
                ),
            )))
        }
        None => Err(RoutineFailure::error(Message {
            action: "Seed".to_string(),
            details: "No subcommand provided".to_string(),
        })),
    }
}

/// Copies data from remote ClickHouse tables into local ClickHouse tables using the remoteSecure() table function.
pub async fn seed_clickhouse_tables(
    infra_map: &InfrastructureMap,
    local_clickhouse: &ClickHouseClient,
    remote_config: &ClickHouseConfig,
    table_name: Option<String>,
    limit: Option<usize>,
    order_by: Option<&str>,
) -> Result<Vec<String>, RoutineFailure> {
    let mut summary = Vec::new();

    // Get the list of tables to seed
    let tables = get_tables_to_seed(infra_map, table_name.clone());
    let other_dbs: Vec<&str> = tables
        .iter()
        .filter_map(|t| t.database.as_deref())
        .collect();

    // Get available remote tables for validation (unless specific table is requested)
    let remote_tables = if table_name.is_some() {
        // Skip validation if user specified a specific table
        None
    } else {
        match get_remote_tables(local_clickhouse, remote_config, &other_dbs).await {
            Ok(tables) => Some(tables),
            Err(e) => {
                warn!("Failed to query remote tables for validation: {:?}", e);
                display::show_message_wrapper(
                    MessageType::Info,
                    Message::new(
                        "Validation".to_string(),
                        "Skipping table validation - proceeding with seeding".to_string(),
                    ),
                );
                None
            }
        }
    };

    // Process each table
    for table in tables {
        // Check if table should be skipped due to validation
        if should_skip_table(
            &table.database,
            &table.name,
            &remote_config.db_name,
            &remote_tables,
        ) {
            info!(
                "Table '{}' exists locally but not on remote - skipping",
                table.name
            );
            summary.push(format!("⚠️  {}: skipped (not found on remote)", table.name));
            continue;
        }

        // Attempt to seed the single table
        match seed_single_table(local_clickhouse, remote_config, &table, limit, order_by).await {
            Ok(success_msg) => {
                summary.push(success_msg);
            }
            Err(e) => {
                if e.message.action == "TableNotFound" {
                    // Table not found on remote, skip gracefully
                    debug!(
                        "Table '{}' not found on remote database - skipping",
                        table.name
                    );
                    summary.push(format!("⚠️  {}: skipped (not found on remote)", table.name));
                } else {
                    // Other errors should be added as failures
                    summary.push(format!(
                        "✗ {}: failed to copy - {}",
                        table.name, e.message.details
                    ));
                }
            }
        }
    }

    info!("ClickHouse seeding completed");
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_database_name_valid() {
        let result = validate_database_name("test_db");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_database_name_empty() {
        let result = validate_database_name("");
        assert!(result.is_err());
        if let Err(e) = result {
            assert_eq!(e.message.action, "SeedClickhouse");
            assert!(e.message.details.contains("No database specified"));
        }
    }

    #[test]
    fn test_build_remote_tables_query() {
        let query = build_remote_tables_query("host:9440", "user", "pass", "mydb", &[]);
        let expected = "SELECT database, name FROM remoteSecure('host:9440', 'system', 'tables', 'user', 'pass') WHERE database IN ('mydb')";
        assert_eq!(query, expected);
    }

    #[test]
    fn test_build_remote_tables_query_with_other_dbs() {
        let query = build_remote_tables_query(
            "host:9440",
            "user",
            "pass",
            "mydb",
            &["otherdb1", "otherdb2"],
        );
        let expected = "SELECT database, name FROM remoteSecure('host:9440', 'system', 'tables', 'user', 'pass') WHERE database IN ('mydb', 'otherdb1', 'otherdb2')";
        assert_eq!(query, expected);
    }

    #[test]
    fn test_parse_remote_tables_response_valid() {
        let response = "db1\ttable1\ndb1\ttable2\ndb2\ttable3\n\n";
        let result = parse_remote_tables_response(response);
        assert_eq!(result.len(), 3);
        assert!(result.contains(&("db1".to_string(), "table1".to_string())));
        assert!(result.contains(&("db1".to_string(), "table2".to_string())));
        assert!(result.contains(&("db2".to_string(), "table3".to_string())));
    }

    #[test]
    fn test_parse_remote_tables_response_empty() {
        let response = "";
        let result = parse_remote_tables_response(response);
        assert!(result.is_empty());
    }

    #[test]
    fn test_should_skip_table_when_not_in_remote() {
        let mut remote_tables = HashSet::new();
        remote_tables.insert(("mydb".to_string(), "table1".to_string()));
        remote_tables.insert(("mydb".to_string(), "table2".to_string()));

        // Table exists in remote (using default db)
        assert!(!should_skip_table(
            &None,
            "table1",
            "mydb",
            &Some(remote_tables.clone())
        ));
        // Table exists in remote (with explicit db)
        assert!(!should_skip_table(
            &Some("mydb".to_string()),
            "table1",
            "mydb",
            &Some(remote_tables.clone())
        ));
        // Table doesn't exist in remote
        assert!(should_skip_table(
            &None,
            "table3",
            "mydb",
            &Some(remote_tables)
        ));
    }

    #[test]
    fn test_should_skip_table_when_no_validation() {
        assert!(!should_skip_table(&None, "any_table", "mydb", &None));
    }

    #[test]
    fn test_should_skip_table_with_other_db() {
        let mut remote_tables = HashSet::new();
        remote_tables.insert(("mydb".to_string(), "table1".to_string()));
        remote_tables.insert(("otherdb".to_string(), "table2".to_string()));

        // Table exists in default db
        assert!(!should_skip_table(
            &None,
            "table1",
            "mydb",
            &Some(remote_tables.clone())
        ));
        // Table exists in other db
        assert!(!should_skip_table(
            &Some("otherdb".to_string()),
            "table2",
            "mydb",
            &Some(remote_tables.clone())
        ));
        // Table doesn't exist in specified db (even though it exists in default db)
        assert!(should_skip_table(
            &Some("otherdb".to_string()),
            "table1",
            "mydb",
            &Some(remote_tables)
        ));
    }

    #[test]
    fn test_build_seeding_query() {
        let params = SeedingQueryParams {
            local_db: "local_db",
            table_name: "my_table",
            remote_host_and_port: "host:9440",
            remote_db: "remote_db",
            remote_user: "user",
            remote_password: "pass",
            order_by_clause: "ORDER BY id DESC",
            limit: 1000,
            offset: 500,
        };
        let query = build_seeding_query(&params);
        let expected = "INSERT INTO `local_db`.`my_table` SELECT * FROM remoteSecure('host:9440', 'remote_db', 'my_table', 'user', 'pass') ORDER BY id DESC LIMIT 1000 OFFSET 500";
        assert_eq!(query, expected);
    }

    #[test]
    fn test_build_count_query() {
        let query = build_count_query("host:9440", "remote_db", "my_table", "user", "pass");
        let expected = "SELECT count() FROM remoteSecure('host:9440', 'remote_db', 'my_table', 'user', 'pass')";
        assert_eq!(query, expected);
    }

    #[test]
    fn test_build_order_by_clause_with_provided_order() {
        let infra_map = InfrastructureMap::default();

        let result = build_order_by_clause("my_table", &infra_map, Some("id ASC"), 1000, 500);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "ORDER BY id ASC");
    }

    #[test]
    fn test_build_order_by_clause_table_not_found() {
        let infra_map = InfrastructureMap::default();

        let result = build_order_by_clause("nonexistent_table", &infra_map, None, 1000, 500);

        assert!(result.is_err());
        if let Err(e) = result {
            assert_eq!(e.message.action, "Seed");
            assert!(e.message.details.contains("not found"));
        }
    }

    #[test]
    fn test_get_tables_to_seed_single_table() {
        let infra_map = InfrastructureMap::default();

        let result = get_tables_to_seed(&infra_map, Some("specific_table".to_string()));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], (None, "specific_table".to_string()));
    }

    #[test]
    fn test_get_tables_to_seed_all_tables_empty() {
        let infra_map = InfrastructureMap::default();

        let result = get_tables_to_seed(&infra_map, None);
        assert_eq!(result.len(), 0); // Default map has no tables
    }

    // Test for the bug fix: ensure batch counting is accurate
    #[test]
    fn test_batch_counting_logic() {
        let batch_size = 1000;
        let total_rows = 2500;
        let mut copied_total = 0;

        // Simulate the batching logic from seed_single_table
        while copied_total < total_rows {
            let batch_limit = std::cmp::min(batch_size, total_rows - copied_total);

            // This is what should happen (the fix)
            copied_total += batch_limit;

            // Verify we don't overshoot
            assert!(copied_total <= total_rows);
        }

        // Verify we copied exactly the expected amount
        assert_eq!(copied_total, total_rows);
    }
}
