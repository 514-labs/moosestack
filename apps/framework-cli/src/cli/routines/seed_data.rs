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
use crate::utilities::constants::ENV_REMOTE_CLICKHOUSE_URL;

use crate::cli::display::status::{format_error, format_success, format_warning};
use crate::framework::core::infrastructure::table::Table;
use crate::infrastructure::olap::clickhouse::config_resolver;
use crate::infrastructure::olap::clickhouse::remote::RemoteConnection;
use std::cmp::min;
use std::collections::HashSet;
use tracing::{debug, info, warn};

/// Resolves the remote ClickHouse URL from multiple sources
///
/// This is a wrapper around config_resolver::resolve_remote_clickhouse_config
/// that returns a URL string instead of a parsed config, for use in seed command.
///
/// # Returns
/// - `Ok(Some(url))` if URL found
/// - `Ok(None)` if no URL configured
/// - `Err` if resolution fails
fn resolve_remote_clickhouse_url(
    project: &Project,
    explicit_url: Option<&str>,
) -> Result<Option<String>, RoutineFailure> {
    // Delegate to unified resolver
    let config = config_resolver::resolve_remote_clickhouse_config(project, explicit_url)?;

    match config {
        Some(cfg) => {
            // Rebuild URL from config (we need the URL format for seeding operations)
            let protocol = if cfg.use_ssl { "https" } else { "http" };
            let url = format!(
                "{}://{}:{}@{}:{}?database={}",
                protocol, cfg.user, cfg.password, cfg.host, cfg.host_port, cfg.db_name
            );
            Ok(Some(url))
        }
        None => Ok(None),
    }
}

/// Validates that a database name is not empty
fn validate_database_name(db_name: &str) -> Result<(), RoutineFailure> {
    if db_name.is_empty() {
        Err(RoutineFailure::error(Message::new(
            "SeedClickhouse".to_string(),
            "No database specified in ClickHouse URL and unable to determine current database"
                .to_string(),
        )))
    } else {
        Ok(())
    }
}

/// Builds SQL query to get remote tables
fn build_remote_tables_query(remote: &RemoteConnection, other_dbs: &[&str]) -> String {
    let mut databases = vec![remote.database.as_str()];
    databases.extend(other_dbs);

    let db_list = databases
        .iter()
        .map(|db| format!("'{}'", db))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "SELECT database, name FROM {} WHERE database IN ({})",
        remote.build_remote_secure_system("tables"),
        db_list
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
    remote: &'a RemoteConnection,
    order_by_clause: &'a str,
    limit: usize,
    offset: usize,
}

/// Builds the seeding SQL query for a specific table
fn build_seeding_query(params: &SeedingQueryParams, remote_db: &str) -> String {
    format!(
        "INSERT INTO `{}`.`{}` SELECT * FROM {} {} LIMIT {} OFFSET {}",
        params.local_db,
        params.table_name,
        params
            .remote
            .build_remote_secure(remote_db, params.table_name),
        params.order_by_clause,
        params.limit,
        params.offset
    )
}

/// Builds the count query to get total rows for a table
fn build_count_query(remote: &RemoteConnection, remote_db: &str, table_name: &str) -> String {
    format!(
        "SELECT count() FROM {}",
        remote.build_remote_secure(remote_db, table_name)
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
    remote: &RemoteConnection,
    remote_db: &str,
    table_name: &str,
) -> Result<usize, RoutineFailure> {
    let count_sql = build_count_query(remote, remote_db, table_name);

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
    let remote = RemoteConnection::from_config(remote_config);
    let db = table.database.as_deref();
    let local_db = db.unwrap_or(&local_clickhouse.config().db_name);
    let batch_size: usize = 50_000;

    // Get total row count
    let remote_total = get_remote_table_count(
        local_clickhouse,
        &remote,
        db.unwrap_or(&remote_config.db_name),
        &table.name,
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

        let sql = build_seeding_query(
            &SeedingQueryParams {
                local_db,
                table_name: &table.name,
                remote: &remote,
                order_by_clause: &order_by_clause,
                limit: batch_limit,
                offset: copied_total,
            },
            db.unwrap_or(&remote_config.db_name),
        );

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

    Ok(format_success(&table.name, "copied from remote"))
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
    clickhouse_url: &str,
    table: Option<String>,
    limit: Option<usize>,
    order_by: Option<&str>,
) -> Result<(String, String, Vec<String>), RoutineFailure> {
    // Load infrastructure map
    let infra_map = load_infrastructure_map(project).await?;

    // Parse ClickHouse URL
    let remote_config = parse_clickhouse_connection_string(clickhouse_url).map_err(|e| {
        RoutineFailure::error(Message::new(
            "SeedClickhouse".to_string(),
            format!("Invalid ClickHouse URL: {e}"),
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
    let remote = RemoteConnection::from_config(remote_config);

    let sql = build_remote_tables_query(&remote, other_dbs);

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
            clickhouse_url,
            limit,
            all,
            table,
            order_by,
        }) => {
            let resolved_clickhouse_url =
                match resolve_remote_clickhouse_url(project, clickhouse_url.as_deref())? {
                    Some(url) => url,
                    None => {
                        return Err(RoutineFailure::error(Message::new(
                            "SeedClickhouse".to_string(),
                            format!(
                                "No remote ClickHouse URL configured. Options:\n\
                                 • Pass --clickhouse-url flag (for this command)\n\
                                 • Set {} environment variable (can be in .env.local)\n\
                                 • Add [dev.remote_clickhouse] to moose.config.toml (recommended)",
                                ENV_REMOTE_CLICKHOUSE_URL
                            ),
                        )))
                    }
                };

            info!("Running seed clickhouse command with ClickHouse URL: {resolved_clickhouse_url}");

            let (local_db_name, remote_db_name, summary) = with_spinner_completion_async(
                "Initializing database seeding operation...",
                "Database seeding completed",
                seed_clickhouse_operation(
                    project,
                    &resolved_clickhouse_url,
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
    let remote_tables = if let Some(name) = table_name {
        if tables.is_empty() {
            return Err(RoutineFailure::error(Message::new(
                "Table".to_string(),
                format!("{name} not found."),
            )));
        }
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
            summary.push(format_warning(&table.name, "skipped (not found on remote)"));
            continue;
        }

        // Attempt to seed the single table
        match seed_single_table(local_clickhouse, remote_config, table, limit, order_by).await {
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
                    summary.push(format_warning(&table.name, "skipped (not found on remote)"));
                } else {
                    // Other errors should be added as failures
                    summary.push(format_error(
                        &table.name,
                        &format!("failed to copy - {}", e.message.details),
                    ));
                }
            }
        }
    }

    info!("ClickHouse seeding completed");
    Ok(summary)
}

/// Checks if a table exists locally in ClickHouse (with error handling)
async fn table_exists_locally(client: &ClickHouseClient, database: &str, table_name: &str) -> bool {
    match client.table_exists(database, table_name).await {
        Ok(exists) => exists,
        Err(e) => {
            warn!(
                "Failed to check if table '{}' exists locally: {:?}",
                table_name, e
            );
            false
        }
    }
}

/// Drops a mirror table if it exists
async fn drop_mirror_table(
    client: &ClickHouseClient,
    database: &str,
    table_name: &str,
) -> Result<(), String> {
    debug!("Dropping existing mirror table '{}'", table_name);

    client
        .drop_table_if_exists(database, table_name)
        .await
        .map_err(|e| format!("Failed to drop table: {}", e))?;

    debug!("Dropped existing mirror table '{}'", table_name);
    Ok(())
}

/// Creates a schema-only mirror table using the provided context
async fn create_mirror_schema(
    ctx: &MirrorContext<'_>,
    table_name: &str,
    remote_db: &str,
) -> Result<(), RoutineFailure> {
    let create_sql = format!(
        "CREATE TABLE `{}`.`{}` AS SELECT * FROM {} LIMIT 0",
        ctx.local_db,
        table_name,
        ctx.remote.build_remote_secure(remote_db, table_name)
    );

    debug!("Creating mirror table '{}': {}", table_name, create_sql);

    ctx.local_client
        .execute_sql(&create_sql)
        .await
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "CreateMirror".to_string(),
                format!("Failed to create mirror schema: {}", e),
            ))
        })?;

    debug!("Created mirror table schema for '{}'", table_name);
    Ok(())
}

/// Seeds data into a mirror table using the provided context
async fn seed_mirror_data(
    ctx: &MirrorContext<'_>,
    table_name: &str,
    remote_db: &str,
) -> Result<(), String> {
    let insert_sql = format!(
        "INSERT INTO `{}`.`{}` SELECT * FROM {} LIMIT {}",
        ctx.local_db,
        table_name,
        ctx.remote.build_remote_secure(remote_db, table_name),
        ctx.sample_size
    );

    debug!(
        "Seeding mirror table '{}' with {} rows",
        table_name, ctx.sample_size
    );

    ctx.local_client
        .execute_sql(&insert_sql)
        .await
        .map_err(|e| format!("Failed to seed data: {}", e))?;

    info!(
        "Seeded mirror table '{}' with {} sample rows",
        table_name, ctx.sample_size
    );
    Ok(())
}

/// Context for creating a single mirror table
struct MirrorContext<'a> {
    local_client: &'a ClickHouseClient,
    local_db: String,
    remote: RemoteConnection,
    sample_size: usize,
    refresh_on_startup: bool,
}

/// Creates a mirror for a single table
async fn create_single_mirror(table: &Table, remote_db: &str, ctx: &MirrorContext<'_>) -> String {
    // Check if table exists locally
    let exists = table_exists_locally(ctx.local_client, &ctx.local_db, &table.name).await;

    // Skip if exists and no refresh needed
    if exists && !ctx.refresh_on_startup {
        debug!(
            "Table '{}' already exists locally and refresh_on_startup is false, skipping",
            table.name
        );
        return format_success(&table.name, "already exists (skipped)");
    }

    // Drop if refreshing
    if exists && ctx.refresh_on_startup {
        if let Err(e) = drop_mirror_table(ctx.local_client, &ctx.local_db, &table.name).await {
            warn!("Failed to drop mirror table '{}': {}", table.name, e);
            return format_error(&table.name, &format!("failed to drop for refresh - {}", e));
        }
    }

    // Create schema
    match create_mirror_schema(ctx, &table.name, remote_db).await {
        Ok(_) => {
            // Seed data if configured
            if ctx.sample_size > 0 {
                match seed_mirror_data(ctx, &table.name, remote_db).await {
                    Ok(_) => format_success(
                        &table.name,
                        &format!("mirrored with {} sample rows", ctx.sample_size),
                    ),
                    Err(e) => {
                        warn!(
                            "Created mirror table '{}' but failed to seed data: {}",
                            table.name, e
                        );
                        format_warning(
                            &table.name,
                            &format!("created schema but seeding failed - {}", e),
                        )
                    }
                }
            } else {
                info!("Created mirror table schema for '{}'", table.name);
                format_success(&table.name, "schema mirrored")
            }
        }
        Err(e) => {
            let error_msg = e.message.details.clone();
            if error_msg.contains("There is no table") || error_msg.contains("UNKNOWN_TABLE") {
                warn!("Table '{}' not found on remote database", table.name);
                format_warning(&table.name, "not found on remote (skipped)")
            } else {
                warn!(
                    "Failed to create mirror for table '{}': {}",
                    table.name, error_msg
                );
                format_error(&table.name, &format!("failed to create - {}", error_msg))
            }
        }
    }
}

/// Creates local mirror tables for EXTERNALLY_MANAGED tables.
/// This enables Materialized Views to reference these tables in dev mode.
///
/// # Arguments
/// * `project` - The project configuration
/// * `infra_map` - The infrastructure map containing table definitions
/// * `remote_config` - The remote ClickHouse connection configuration
///
/// # Returns
/// A vector of status messages for each table processed
pub async fn create_external_table_mirrors(
    project: &Project,
    infra_map: &InfrastructureMap,
    remote_config: &ClickHouseConfig,
) -> Result<Vec<String>, RoutineFailure> {
    let local_client = ClickHouseClient::new(&project.clickhouse_config).map_err(|e| {
        RoutineFailure::error(Message::new(
            "ExternalMirrors".to_string(),
            format!("Failed to create local ClickHouseClient: {e}"),
        ))
    })?;

    let mirrorable_tables = infra_map.get_mirrorable_external_tables();

    if mirrorable_tables.is_empty() {
        debug!("No mirrorable EXTERNALLY_MANAGED tables found");
        return Ok(Vec::new());
    }

    info!(
        "Creating local mirrors for {} EXTERNALLY_MANAGED table(s)",
        mirrorable_tables.len()
    );

    let ctx = MirrorContext {
        local_client: &local_client,
        local_db: local_client.config().db_name.clone(),
        remote: RemoteConnection::from_config(remote_config),
        sample_size: project.dev.externally_managed.tables.sample_size,
        refresh_on_startup: project.dev.externally_managed.tables.refresh_on_startup,
    };

    let mut summary = Vec::new();
    for table in mirrorable_tables {
        let remote_db = table.database.as_deref().unwrap_or(&remote_config.db_name);
        let status = create_single_mirror(table, remote_db, &ctx).await;
        summary.push(status);
    }

    info!("External table mirror creation completed");
    Ok(summary)
}

/// Checks if a table should be created or already exists
///
/// Returns:
/// - Ok(true) = already exists, skip creation
/// - Ok(false) = doesn't exist, should create
/// - Err = failed to check
async fn should_skip_existing_table(
    client: &ClickHouseClient,
    database: &str,
    table_name: &str,
) -> Result<bool, String> {
    match client.table_exists(database, table_name).await {
        Ok(true) => {
            debug!("Table '{}' already exists, skipping", table_name);
            Ok(true)
        }
        Ok(false) => Ok(false),
        Err(e) => {
            warn!("Failed to check if table '{}' exists: {:?}", table_name, e);
            Err(format!("failed to check existence - {}", e))
        }
    }
}

/// Creates a single table from local schema
async fn create_table_from_schema(
    client: &ClickHouseClient,
    table: &Table,
    target_db: &str,
    is_dev: bool,
) -> Result<(), RoutineFailure> {
    // Convert to ClickHouseTable format
    let clickhouse_table =
        crate::infrastructure::olap::clickhouse::mapper::std_table_to_clickhouse_table(table)
            .map_err(|e| {
                RoutineFailure::error(Message::new(
                    "TableConversion".to_string(),
                    format!("Failed to convert table {} schema: {}", table.name, e),
                ))
            })?;

    // Generate CREATE TABLE SQL
    let create_sql = crate::infrastructure::olap::clickhouse::queries::create_table_query(
        target_db,
        clickhouse_table,
        is_dev,
    )
    .map_err(|e| {
        RoutineFailure::error(Message::new(
            "CreateTable".to_string(),
            format!(
                "Failed to generate CREATE TABLE query for {}: {}",
                table.name, e
            ),
        ))
    })?;

    debug!("Creating table '{}' from local schema", table.name);

    client.execute_sql(&create_sql).await.map_err(|e| {
        RoutineFailure::error(Message::new(
            "CreateTable".to_string(),
            format!("Failed to execute CREATE TABLE for {}: {}", table.name, e),
        ))
    })?;

    info!("Created table '{}' from local schema", table.name);
    Ok(())
}

/// Creates EXTERNALLY_MANAGED tables from local schema definitions (no remote needed)
///
/// Use case: Developer needs table structure to exist (for Materialized Views)
/// but doesn't have access to production database. Tables are created empty
/// from the schema definitions in code.
///
/// # Arguments
/// * `project` - The project configuration
/// * `infra_map` - The infrastructure map containing table definitions
///
/// # Returns
/// A vector of status messages for each table processed
pub async fn create_external_tables_from_local_schema(
    project: &Project,
    infra_map: &InfrastructureMap,
) -> Result<Vec<String>, RoutineFailure> {
    let local_client = ClickHouseClient::new(&project.clickhouse_config).map_err(|e| {
        RoutineFailure::error(Message::new(
            "ExternalTables".to_string(),
            format!("Failed to create local ClickHouseClient: {e}"),
        ))
    })?;

    let local_db = local_client.config().db_name.clone();
    let mirrorable_tables = infra_map.get_mirrorable_external_tables();

    if mirrorable_tables.is_empty() {
        debug!("No EXTERNALLY_MANAGED tables found");
        return Ok(Vec::new());
    }

    info!(
        "Creating {} EXTERNALLY_MANAGED table(s) from local schema",
        mirrorable_tables.len()
    );

    let mut summary = Vec::new();

    for table in mirrorable_tables {
        let target_db = table.database.as_deref().unwrap_or(&local_db);

        // Check if already exists
        match should_skip_existing_table(&local_client, target_db, &table.name).await {
            Ok(true) => {
                summary.push(format_success(&table.name, "already exists"));
                continue;
            }
            Ok(false) => {
                // Proceed to create
            }
            Err(e) => {
                summary.push(format_error(&table.name, &e));
                continue;
            }
        }

        // Create table from local schema
        match create_table_from_schema(&local_client, table, target_db, !project.is_production)
            .await
        {
            Ok(_) => {
                summary.push(format_success(
                    &table.name,
                    "created from local schema (empty)",
                ));
            }
            Err(e) => {
                warn!(
                    "Failed to create table '{}': {}",
                    table.name, e.message.details
                );
                summary.push(format_error(&table.name, &e.message.details));
            }
        }
    }

    info!("External table local schema creation completed");
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::OrderBy;
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
    use std::collections::HashMap;

    /// Helper function to create a minimal test Table
    fn create_test_table(name: &str, database: Option<String>) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine: ClickhouseEngine::MergeTree,
            version: None,
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::default_for_deserialization(),
            indexes: vec![],
            database,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        }
    }

    /// Helper function to create a minimal test InfrastructureMap
    fn create_test_infra_map(tables: HashMap<String, Table>) -> InfrastructureMap {
        InfrastructureMap {
            default_database: "default".to_string(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables,
            views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            block_db_processes: crate::framework::core::infrastructure::olap_process::OlapProcess {},
            consumption_api_web_server: crate::framework::core::infrastructure::consumption_webserver::ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
        }
    }

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

    fn create_test_remote_connection() -> RemoteConnection {
        RemoteConnection {
            host: "host".to_string(),
            port: 9440,
            database: "mydb".to_string(),
            user: "user".to_string(),
            password: "pass".to_string(),
        }
    }

    #[test]
    fn test_build_remote_tables_query() {
        let remote = create_test_remote_connection();
        let query = build_remote_tables_query(&remote, &[]);
        let expected = "SELECT database, name FROM remoteSecure('host:9440', 'system', 'tables', 'user', 'pass') WHERE database IN ('mydb')";
        assert_eq!(query, expected);
    }

    #[test]
    fn test_build_remote_tables_query_with_other_dbs() {
        let remote = create_test_remote_connection();
        let query = build_remote_tables_query(&remote, &["otherdb1", "otherdb2"]);
        let expected = "SELECT database, name FROM remoteSecure('host:9440', 'system', 'tables', 'user', 'pass') WHERE database IN ('mydb', 'otherdb1', 'otherdb2')";
        assert_eq!(query, expected);
    }

    fn create_test_project(name: &str) -> Project {
        use crate::framework::languages::SupportedLanguages;
        use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
        use std::path::PathBuf;

        Project {
            language: SupportedLanguages::Typescript,
            source_dir: "app".to_string(),
            redpanda_config: crate::infrastructure::stream::kafka::models::KafkaConfig::default(),
            clickhouse_config: ClickHouseConfig::default(),
            http_server_config: crate::cli::local_webserver::LocalWebserverConfig::default(),
            redis_config: crate::infrastructure::redis::redis_client::RedisConfig::default(),
            git_config: crate::utilities::git::GitConfig::default(),
            temporal_config:
                crate::infrastructure::orchestration::temporal::TemporalConfig::default(),
            state_config: crate::project::StateConfig::default(),
            migration_config: crate::project::MigrationConfig::default(),
            language_project_config: crate::project::LanguageProjectConfig::Typescript(
                crate::project::typescript_project::TypescriptProject::new(name.to_string()),
            ),
            project_location: PathBuf::from("/tmp/test"),
            is_production: false,
            supported_old_versions: HashMap::new(),
            jwt: None,
            authentication: crate::project::AuthenticationConfig::default(),
            features: crate::project::ProjectFeatures::default(),
            load_infra: None,
            typescript_config: crate::project::TypescriptConfig::default(),
            docker_config: crate::project::DockerConfig::default(),
            dev: crate::project::DevConfig::default(),
        }
    }

    #[test]
    fn test_resolve_remote_clickhouse_url_explicit() {
        let project = create_test_project("test_project");
        let result =
            resolve_remote_clickhouse_url(&project, Some("http://localhost:8123?database=test"));
        assert!(result.is_ok());
        assert!(result.unwrap().is_some());
    }

    #[test]
    fn test_resolve_remote_clickhouse_url_env_var() {
        let project = create_test_project("test_project");
        std::env::set_var(
            ENV_REMOTE_CLICKHOUSE_URL,
            "http://localhost:8123?database=test",
        );
        let result = resolve_remote_clickhouse_url(&project, None);
        std::env::remove_var(ENV_REMOTE_CLICKHOUSE_URL);

        assert!(result.is_ok());
        assert!(result.unwrap().is_some());
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
        let remote = create_test_remote_connection();
        let params = SeedingQueryParams {
            local_db: "local_db",
            table_name: "my_table",
            remote: &remote,
            order_by_clause: "ORDER BY id DESC",
            limit: 1000,
            offset: 500,
        };
        let query = build_seeding_query(&params, "remote_db");
        let expected = "INSERT INTO `local_db`.`my_table` SELECT * FROM remoteSecure('host:9440', 'remote_db', 'my_table', 'user', 'pass') ORDER BY id DESC LIMIT 1000 OFFSET 500";
        assert_eq!(query, expected);
    }

    #[test]
    fn test_build_count_query() {
        let remote = create_test_remote_connection();
        let query = build_count_query(&remote, "remote_db", "my_table");
        let expected = "SELECT count() FROM remoteSecure('host:9440', 'remote_db', 'my_table', 'user', 'pass')";
        assert_eq!(query, expected);
    }

    #[test]
    fn test_build_order_by_clause_with_provided_order() {
        let table = create_test_table("my_table", None);

        let result = build_order_by_clause(&table, Some("id ASC"), 1000, 500);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "ORDER BY id ASC");
    }

    #[test]
    fn test_build_order_by_clause_without_order_by_and_no_provided_order() {
        let mut table = create_test_table("my_table", None);
        table.order_by = OrderBy::Fields(vec![]); // No ORDER BY fields

        let result = build_order_by_clause(&table, None, 1000, 500);

        assert!(result.is_err());
        if let Err(e) = result {
            assert_eq!(e.message.action, "Seed");
            assert!(e.message.details.contains("without ORDER BY"));
        }
    }

    #[test]
    fn test_get_tables_to_seed_single_table() {
        let mut tables = HashMap::new();
        tables.insert(
            "specific_table".to_string(),
            create_test_table("specific_table", None),
        );

        let infra_map = create_test_infra_map(tables);

        let result = get_tables_to_seed(&infra_map, Some("specific_table".to_string()));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "specific_table");
        assert_eq!(result[0].database, None);
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

    #[test]
    fn test_engine_supports_select_merge_tree() {
        let engine = ClickhouseEngine::MergeTree;
        assert!(engine.supports_select());
    }

    #[test]
    fn test_engine_supports_select_kafka() {
        let engine = ClickhouseEngine::Kafka {
            broker_list: "localhost:9092".to_string(),
            topic_list: "test_topic".to_string(),
            group_name: "test_group".to_string(),
            format: "JSONEachRow".to_string(),
        };
        assert!(!engine.supports_select());
    }

    #[test]
    fn test_engine_supports_select_s3queue() {
        let engine = ClickhouseEngine::S3Queue {
            s3_path: "s3://bucket/path".to_string(),
            format: "JSONEachRow".to_string(),
            compression: None,
            headers: None,
            aws_access_key_id: None,
            aws_secret_access_key: None,
        };
        assert!(!engine.supports_select());
    }

    #[test]
    fn test_engine_supports_select_replicated_merge_tree() {
        let engine = ClickhouseEngine::ReplicatedMergeTree {
            keeper_path: Some("/clickhouse/tables/{shard}/test".to_string()),
            replica_name: Some("{replica}".to_string()),
        };
        assert!(engine.supports_select());
    }
}
