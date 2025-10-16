//! Migration execution logic for moose migrate command

use crate::cli::display::Message;
use crate::cli::routines::RoutineFailure;
use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::migration_plan::MigrationPlan;
use crate::framework::core::state_storage::{ClickHouseStateStorage, StateStorage};
use crate::infrastructure::olap::clickhouse::config::parse_clickhouse_connection_string;
use crate::infrastructure::olap::clickhouse::{check_ready, create_client};
use crate::project::Project;
use crate::utilities::constants::{
    MIGRATION_AFTER_STATE_FILE, MIGRATION_BEFORE_STATE_FILE, MIGRATION_FILE,
};
use anyhow::Result;
use std::collections::HashMap;

/// Execute migration plan from CLI (moose migrate command)
pub async fn execute_migration(
    project: &Project,
    clickhouse_url: &str,
) -> Result<(), RoutineFailure> {
    // Validate that state storage is configured for ClickHouse
    if project.state_config.storage != "clickhouse" {
        return Err(RoutineFailure::error(Message {
            action: "Configuration".to_string(),
            details: format!(
                "moose migrate requires state_config.storage = \"clickhouse\"\n\
                 \n\
                 Current setting: state_config.storage = \"{}\"\n",
                project.state_config.storage
            ),
        }));
    }

    // Parse URL and create client
    let clickhouse_config = parse_clickhouse_connection_string(clickhouse_url).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "ClickHouse".to_string(),
                "Failed to parse connection URL".to_string(),
            ),
            e,
        )
    })?;
    let client = create_client(clickhouse_config.clone());
    check_ready(&client).await.map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "ClickHouse".to_string(),
                "Failed to connect to ClickHouse".to_string(),
            ),
            e,
        )
    })?;

    // Always use ClickHouse state storage for migrate command
    let state_storage = ClickHouseStateStorage::new(client, clickhouse_config.db_name.clone());

    // Load current state from ClickHouse state table and reconcile with reality
    let current_infra_map = state_storage
        .load_infrastructure_map()
        .await
        .map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "State".to_string(),
                    "Failed to load infrastructure state from ClickHouse".to_string(),
                ),
                e,
            )
        })?
        .unwrap_or_default();

    // Reconcile with actual database state (like /admin/inframap does)
    // This ensures we're comparing against what's REALLY in ClickHouse, not stale state
    let current_infra_map = if project.features.olap {
        use crate::framework::core::plan::reconcile_with_reality;
        use std::collections::HashSet;

        let target_table_names: HashSet<String> =
            current_infra_map.tables.keys().cloned().collect();

        // Create client for reconciliation (first client was moved into state_storage)
        let olap_client = create_client(clickhouse_config.clone());

        reconcile_with_reality(
            project,
            &current_infra_map,
            &target_table_names,
            olap_client,
        )
        .await
        .map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Reconciliation".to_string(),
                    "Failed to reconcile state with ClickHouse reality".to_string(),
                ),
                anyhow::anyhow!("{:?}", e),
            )
        })?
    } else {
        current_infra_map
    };

    let current_tables = &current_infra_map.tables;

    // Load target state from current code
    let target_infra_map = InfrastructureMap::load_from_user_code(project)
        .await
        .map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Code".to_string(),
                    "Failed to load infrastructure from code".to_string(),
                ),
                e,
            )
        })?;

    // Execute migration (moose migrate always uses ClickHouse state)
    execute_migration_plan(project, current_tables, &target_infra_map, &state_storage)
        .await
        .map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "\nMigration".to_string(),
                    "Failed to execute migration plan".to_string(),
                ),
                e,
            )
        })?;

    Ok(())
}

/// Execute pre-planned migration
///
/// It validates the plan and executes it if valid. After successful execution,
/// it saves the new infrastructure state.
pub async fn execute_migration_plan(
    project: &Project,
    current_tables: &HashMap<String, Table>,
    target_infra_map: &InfrastructureMap,
    state_storage: &dyn StateStorage,
) -> Result<()> {
    println!("Executing migration plan...");

    // Check if all required migration files exist
    let missing_files: Vec<&str> = [
        MIGRATION_FILE,
        MIGRATION_BEFORE_STATE_FILE,
        MIGRATION_AFTER_STATE_FILE,
    ]
    .iter()
    .filter(|path| !std::path::Path::new(path).exists())
    .copied()
    .collect();

    if !missing_files.is_empty() {
        anyhow::bail!(
            "Missing migration file(s): {}\n\
             \n\
             You need to generate a migration plan first:\n\
             \n\
             moose generate migration --clickhouse-url <url> --save\n\
             \n\
             This will create:\n\
             - {} (the migration plan to execute)\n\
             - {} (snapshot of remote state)\n\
             - {} (snapshot of local code)\n\
             \n\
             After reviewing the plan, run:\n\
             moose migrate --clickhouse-url <url>\n",
            missing_files.join(", "),
            MIGRATION_FILE,
            MIGRATION_BEFORE_STATE_FILE,
            MIGRATION_AFTER_STATE_FILE
        );
    }

    // Load and validate the approved migration plan
    let plan_content = std::fs::read_to_string(MIGRATION_FILE)?;
    let migration_plan: MigrationPlan =
        // see MigrationPlan::to_yaml for the reason of this workaround
        serde_json::from_value(serde_yaml::from_str::<serde_json::Value>(&plan_content)?)?;

    println!("✓ Loaded approved migration plan from {:?}", MIGRATION_FILE);
    println!("  Plan created: {}", migration_plan.created_at);
    println!("  Total operations: {}", migration_plan.total_operations());
    println!();
    println!("Safety checks:");
    println!("  • Expected = Database state when plan was generated");
    println!("  • Current  = Database state right now");
    println!("  • Target   = What your local code defines");
    println!();

    let before_state = std::fs::read_to_string(MIGRATION_BEFORE_STATE_FILE)?;
    let state_when_planned: InfrastructureMap = serde_json::from_str(&before_state)?;

    println!("Validating migration plan...");

    if current_tables == &state_when_planned.tables {
        println!("  ✓ Current = Expected (no drift detected)");

        let after_state = std::fs::read_to_string(MIGRATION_AFTER_STATE_FILE)?;
        let desired_state: InfrastructureMap = serde_json::from_str(&after_state)?;

        if desired_state.tables == target_infra_map.tables {
            println!("  ✓ Target = Code (plan is still valid)");
        } else {
            anyhow::bail!(
                "The desired state of the plan is different from the current code.\n\
                 The migration was perhaps generated before additional code changes.\n\
                 Please regenerate the migration plan:\n\
                 \n\
                 moose generate migration --clickhouse-url <url> --save\n"
            );
        }

        // Execute the migration plan directly using OLAP operations
        if project.features.olap && !migration_plan.operations.is_empty() {
            println!(
                "\n▶ Applying {} migration operation(s)...",
                migration_plan.operations.len()
            );

            let client = create_client(project.clickhouse_config.clone());
            check_ready(&client).await?;
            let is_dev = !project.is_production;
            for (idx, operation) in migration_plan.operations.iter().enumerate() {
                let description =
                    crate::infrastructure::olap::clickhouse::describe_operation(operation);
                println!(
                    "  [{}/{}] {}",
                    idx + 1,
                    migration_plan.operations.len(),
                    description
                );
                crate::infrastructure::olap::clickhouse::execute_atomic_operation(
                    &client.config.db_name,
                    operation,
                    &client,
                    is_dev,
                )
                .await?;
            }
            println!("\n✓ Migration completed successfully");
        } else if migration_plan.operations.is_empty() {
            println!("\n✓ No operations to apply - database is already up to date");
        }
    } else if current_tables == &target_infra_map.tables {
        println!("  ✓ Database already matches target state - skipping migration");
    } else {
        // Show what's different for debugging
        println!("\n❌ Migration validation failed - database state has changed since plan was generated\n");

        // Tables in current but not in expected
        let extra_tables: Vec<_> = current_tables
            .keys()
            .filter(|k| !state_when_planned.tables.contains_key(*k))
            .collect();
        if !extra_tables.is_empty() {
            println!("  Tables added to database: {:?}", extra_tables);
        }

        // Tables in expected but not in current
        let missing_tables: Vec<_> = state_when_planned
            .tables
            .keys()
            .filter(|k| !current_tables.contains_key(*k))
            .collect();
        if !missing_tables.is_empty() {
            println!("  Tables removed from database: {:?}", missing_tables);
        }

        // Tables that exist in both but have different content
        let changed_tables: Vec<_> = current_tables
            .keys()
            .filter(|k| {
                state_when_planned.tables.contains_key(*k)
                    && state_when_planned.tables.get(*k) != current_tables.get(*k)
            })
            .collect();
        if !changed_tables.is_empty() {
            println!("  Tables with schema changes: {:?}", changed_tables);
        }

        anyhow::bail!(
            "\nThe database state has changed since the migration plan was generated.\n\
             This could happen if:\n\
             - Another developer applied changes\n\
             - Manual database modifications were made\n\
             - The plan is stale\n\
             \n\
             Please regenerate the migration plan:\n\
             \n\
             moose generate migration --clickhouse-url <url> --save\n"
        );
    }

    // Save the complete infrastructure state
    state_storage
        .store_infrastructure_map(target_infra_map)
        .await?;

    Ok(())
}
