use crate::cli::display::Message;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::infrastructure::olap::clickhouse::{
    check_ready, create_client, extract_order_by_from_create_query, run_query,
};
use crate::project::Project;
use tracing::{info, warn};

fn escape_ident(ident: &str) -> String {
    ident.replace('`', "``")
}

async fn list_all_tables(project: &Project) -> Result<Vec<String>, RoutineFailure> {
    let client = create_client(project.clickhouse_config.clone());
    check_ready(&client).await.map_err(|e| {
        RoutineFailure::error(Message::new(
            "ClickHouse".to_string(),
            format!("Failed to connect: {e}"),
        ))
    })?;

    let db_name = &client.config.db_name;
    let query = format!(
        "SELECT name FROM system.tables WHERE database = '{}' AND engine NOT IN ('View','MaterializedView') AND NOT name LIKE '.%' ORDER BY name",
        db_name
    );

    let rows = client
        .client
        .query(&query)
        .fetch_all::<String>()
        .await
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "ClickHouse".to_string(),
                format!("Failed to list tables: {e}"),
            ))
        })?;

    Ok(rows)
}

async fn truncate_all_rows(project: &Project, tables: &[String]) -> Result<(), RoutineFailure> {
    let client = create_client(project.clickhouse_config.clone());
    check_ready(&client).await.map_err(|e| {
        RoutineFailure::error(Message::new(
            "ClickHouse".to_string(),
            format!("Failed to connect: {e}"),
        ))
    })?;

    let db_name = &client.config.db_name;
    for t in tables {
        let table = escape_ident(t);
        let sql = format!("TRUNCATE TABLE `{}`.`{}`", db_name, table);
        info!("Truncating table {}.{}", db_name, t);
        run_query(&sql, &client).await.map_err(|e| {
            RoutineFailure::error(Message::new(
                "Truncate".to_string(),
                format!("Failed on {}: {e}", t),
            ))
        })?;
    }
    Ok(())
}

async fn delete_last_n_rows(
    project: &Project,
    tables: &[String],
    n: u64,
) -> Result<(), RoutineFailure> {
    let client = create_client(project.clickhouse_config.clone());
    check_ready(&client).await.map_err(|e| {
        RoutineFailure::error(Message::new(
            "ClickHouse".to_string(),
            format!("Failed to connect: {e}"),
        ))
    })?;

    let db_name = &client.config.db_name;

    for t in tables {
        // Discover ORDER BY columns for stable recency semantics
        let create_stmt_query = format!(
            "SELECT create_table_query FROM system.tables WHERE database = '{}' AND name = '{}'",
            db_name, t
        );
        let create_stmt = client
            .client
            .query(&create_stmt_query)
            .fetch_one::<String>()
            .await
            .unwrap_or_else(|_| "".to_string());

        let order_by = extract_order_by_from_create_query(&create_stmt);

        // Build ORDER BY clause and projection for IN subquery
        let proj = if order_by.len() == 1 {
            format!("`{}`", escape_ident(&order_by[0]))
        } else if order_by.is_empty() {
            return Err(RoutineFailure::error(Message::new(
                "Ordering".to_string(),
                format!("missing for table {t}"),
            )));
        } else {
            let cols = order_by
                .iter()
                .map(|c| format!("`{}`", escape_ident(c)))
                .collect::<Vec<_>>()
                .join(", ");
            format!("({})", cols)
        };
        let ord = order_by
            .iter()
            .map(|c| format!("`{}` DESC", escape_ident(c)))
            .collect::<Vec<_>>()
            .join(", ");

        let table = escape_ident(t);
        let sql = format!(
            "ALTER TABLE `{db_name}`.`{table}` DELETE WHERE {proj} > (\
            SELECT {proj} FROM `{db_name}`.`{table}` ORDER BY {ord} LIMIT 1 OFFSET {n}\
            ) SETTINGS mutations_sync=1"
        );
        warn!(
            "Deleting last {} rows from {}.{} using ORDER BY: {:?}",
            n, db_name, t, order_by
        );
        run_query(&sql, &client).await.map_err(|e| {
            RoutineFailure::error(Message::new(
                "Truncate".to_string(),
                format!("Failed on {t}: {e}"),
            ))
        })?;
    }

    Ok(())
}

pub async fn truncate_tables(
    project: &Project,
    tables: Vec<String>,
    all: bool,
    rows: Option<u64>,
) -> Result<RoutineSuccess, RoutineFailure> {
    let target_tables = if all {
        list_all_tables(project).await?
    } else if tables.is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "Truncate".to_string(),
            "Provide table names or use --all".to_string(),
        )));
    } else {
        tables
    };

    if target_tables.is_empty() {
        return Ok(RoutineSuccess::success(Message::new(
            "Truncate".to_string(),
            "No tables matched".to_string(),
        )));
    }

    match rows {
        None => truncate_all_rows(project, &target_tables).await?,
        Some(n) => delete_last_n_rows(project, &target_tables, n).await?,
    }

    Ok(RoutineSuccess::success(Message::new(
        "Truncate".to_string(),
        match rows {
            None => format!("Truncated {} table(s)", target_tables.len()),
            Some(n) => format!(
                "Deleted last {n} rows from {} table(s)",
                target_tables.len()
            ),
        },
    )))
}
