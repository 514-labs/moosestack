use crate::cli::commands::SeedSubcommands;
use crate::cli::display;
use crate::cli::display::{with_spinner_completion_async, Message, MessageType};
use crate::cli::routines::RoutineFailure;
use crate::cli::routines::RoutineSuccess;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::primitive_map::PrimitiveMap;
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::project::Project;
use crate::utilities::clickhouse_url::convert_http_to_clickhouse;
use crate::utilities::constants::KEY_REMOTE_CLICKHOUSE_URL;
use crate::utilities::keyring::{KeyringSecretRepository, SecretRepository};
use itertools::Itertools;
use log::{debug, info, warn};
use std::cmp::min;
use std::collections::HashSet;

/// Performs the complete ClickHouse seeding operation including infrastructure loading,
/// table validation, and data copying
async fn seed_clickhouse_operation(
    project: &Project,
    connection_string: &str,
    table: Option<String>,
    limit: Option<usize>,
    order_by: Option<&str>,
) -> Result<(String, String, Vec<String>), RoutineFailure> {
    let infra_map = if project.features.data_model_v2 {
        InfrastructureMap::load_from_user_code(project)
            .await
            .map_err(|e| {
                RoutineFailure::error(Message {
                    action: "SeedClickhouse".to_string(),
                    details: format!("Failed to load InfrastructureMap: {e:?}"),
                })
            })?
    } else {
        let primitive_map = PrimitiveMap::load(project).await.map_err(|e| {
            RoutineFailure::error(Message {
                action: "SeedClickhouse".to_string(),
                details: format!("Failed to load Primitives: {e:?}"),
            })
        })?;
        InfrastructureMap::new(project, primitive_map)
    };

    let (mut remote_config, db_name) = parse_clickhouse_connection_string(connection_string)
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "SeedClickhouse".to_string(),
                format!("Invalid connection string: {e}"),
            ))
        })?;

    if db_name.is_none() {
        let mut client = clickhouse::Client::default().with_url(connection_string);
        let url = convert_http_to_clickhouse(connection_string).map_err(|e| {
            RoutineFailure::error(Message::new(
                "SeedClickhouse".to_string(),
                format!("Failed to parse connection string: {e}"),
            ))
        })?;

        if !url.username().is_empty() {
            client = client.with_user(url.username());
        }
        if let Some(password) = url.password() {
            client = client.with_password(password);
        }

        let current_db = client
            .query("select database()")
            .fetch_one::<String>()
            .await
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "SeedClickhouse".to_string(),
                        "Failed to query remote database".to_string(),
                    ),
                    e,
                )
            })?;

        remote_config.db_name = current_db;
    }

    // Ensure we have a valid database name
    if remote_config.db_name.is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "SeedClickhouse".to_string(),
            "No database specified in connection string and unable to determine current database"
                .to_string(),
        )));
    }

    // Create local ClickHouseClient from local config
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
async fn get_remote_tables(
    local_clickhouse: &ClickHouseClient,
    remote_config: &ClickHouseConfig,
) -> Result<HashSet<String>, RoutineFailure> {
    let remote_host_and_port = format!("{}:{}", remote_config.host, remote_config.native_port);
    let remote_db = &remote_config.db_name;
    let remote_user = &remote_config.user;
    let remote_password = &remote_config.password;

    let sql = format!(
        "SELECT name FROM remoteSecure('{}', 'system', 'tables', '{}', '{}') WHERE database = '{}'",
        remote_host_and_port, remote_user, remote_password, remote_db
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

    let tables: HashSet<String> = result
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|table| !table.is_empty())
        .collect();

    debug!("Found {} remote tables: {:?}", tables.len(), tables);
    Ok(tables)
}

fn parse_clickhouse_connection_string(
    conn_str: &str,
) -> anyhow::Result<(ClickHouseConfig, Option<String>)> {
    let url = convert_http_to_clickhouse(conn_str)?;

    let user = url.username().to_string();
    let password = url.password().unwrap_or("").to_string();
    let host = url.host_str().unwrap_or("localhost").to_string();

    // Determine SSL based on scheme and port
    let use_ssl = match url.scheme() {
        "https" => true,
        "clickhouse" => url.port().unwrap_or(9000) == 9440,
        _ => url.port().unwrap_or(9000) == 9440,
    };

    let port = url.port().unwrap_or(if use_ssl { 9440 } else { 9000 }) as i32;

    // Get database name from path or query parameter
    let db_name = if !url.path().is_empty() && url.path() != "/" {
        Some(url.path().trim_start_matches('/').to_string())
    } else {
        url.query_pairs()
            .find(|(k, _)| k == "database")
            .map(|(_, v)| v.to_string())
            .filter(|s| !s.is_empty())
    };

    let config = ClickHouseConfig {
        db_name: db_name.clone().unwrap_or_default(),
        user,
        password,
        use_ssl,
        host,
        host_port: port,
        native_port: port,
        host_data_path: None,
    };

    Ok((config, db_name))
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
                format!("Seeded '{}' from '{}'", local_db_name, remote_db_name),
                format!("\n{}", summary.join("\n")),
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
    let remote_host = &remote_config.host;
    let remote_db = &remote_config.db_name;
    let remote_port = &remote_config.native_port;
    let remote_user = &remote_config.user;
    let remote_password = &remote_config.password;
    let local_db = &local_clickhouse.config().db_name;

    let mut summary = Vec::new();
    let tables: Vec<String> = if let Some(ref t) = table_name {
        info!("Seeding single table: {}", t);
        vec![t.clone()]
    } else {
        let table_list: Vec<String> = infra_map
            .tables
            .keys()
            .filter(|table| !table.starts_with("_MOOSE"))
            .cloned()
            .collect();
        info!(
            "Seeding {} tables (excluding internal Moose tables)",
            table_list.len()
        );
        table_list
    };

    let remote_host_and_port = format!("{remote_host}:{remote_port}");

    // Get available remote tables for validation (unless specific table is requested)
    let remote_tables = if table_name.is_some() {
        // Skip validation if user specified a specific table
        None
    } else {
        match get_remote_tables(local_clickhouse, remote_config).await {
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

    for table_name in tables {
        // Validate table exists on remote (if validation was successful and no specific table requested)
        if let Some(ref remote_table_set) = remote_tables {
            if !remote_table_set.contains(&table_name) {
                debug!(
                    "Table '{}' exists locally but not on remote - skipping",
                    table_name
                );
                summary.push(format!("⚠️  {}: skipped (not found on remote)", table_name));
                continue;
            }
        }
        let batch_size: usize = 50_000;
        let mut copied_total: usize = 0;
        let remote_total = {
            let count_sql = format!(
                "SELECT count() FROM remoteSecure('{remote_host_and_port}', '{remote_db}', '{table_name}', '{remote_user}', '{remote_password}')"
            );
            let body = match local_clickhouse.execute_sql(&count_sql).await {
                Ok(result) => result,
                Err(e) => {
                    let error_msg = format!("{:?}", e);
                    if error_msg.contains("There is no table")
                        || error_msg.contains("NO_REMOTE_SHARD_AVAILABLE")
                    {
                        debug!(
                            "Table '{}' not found on remote database - skipping",
                            table_name
                        );
                        summary.push(format!("⚠️  {}: skipped (not found on remote)", table_name));
                        continue;
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
            })?
        };
        let total_rows = match limit {
            None => remote_total,
            Some(l) => min(remote_total, l),
        };
        let order_by_clause = match order_by {
            None => {
                let table = infra_map.tables.get(&table_name).ok_or_else(|| {
                    RoutineFailure::error(Message::new(
                        "Seed".to_string(),
                        format!("{table_name} not found."),
                    ))
                })?;
                let fields = table
                    .order_by
                    .iter()
                    .map(|field| format!("`{field}` DESC"))
                    .join(", ");
                if !fields.is_empty() {
                    format!("ORDER BY {fields}")
                } else if total_rows <= batch_size {
                    "".to_string()
                } else {
                    return Err(RoutineFailure::error(Message::new(
                        "Seed".to_string(),
                        format!("Table {table_name} without ORDER BY. Supply ordering with --order-by to prevent the same row fetched in multiple batches."),
                    )));
                }
            }
            Some(order_by) => format!("ORDER BY {order_by}"),
        };
        let mut i: usize = 0;
        let mut seeding_successful = true;
        'table_batches: while copied_total < total_rows {
            i += 1;
            let limit = match limit {
                None => batch_size,
                Some(l) => min(l - copied_total, batch_size),
            };

            let sql = format!(
                "INSERT INTO `{local_db}`.`{table_name}` SELECT * FROM remoteSecure('{remote_host_and_port}', '{remote_db}', '{table_name}', '{remote_user}', '{remote_password}') {order_by_clause} LIMIT {limit} OFFSET {copied_total}"
            );

            debug!("Executing SQL: table={table_name}, offset={copied_total}, limit={limit}");

            match local_clickhouse.execute_sql(&sql).await {
                Ok(_) => {
                    copied_total += batch_size;
                    debug!("{table_name}: copied batch {i}");
                }
                Err(e) => {
                    summary.push(format!("✗ {table_name}: failed to copy - {e}"));
                    seeding_successful = false;
                    break 'table_batches;
                }
            }
        }

        // Only add success message if seeding was actually successful
        if seeding_successful {
            summary.push(format!("✓ {table_name}: copied from remote"));
        }
    }

    info!("ClickHouse seeding completed");
    Ok(summary)
}
