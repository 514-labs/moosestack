//! Migration execution logic for moose migrate command

use crate::cli::display::Message;
use crate::cli::routines::RoutineFailure;
use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::migration_plan::MigrationPlan;
use crate::framework::core::state_storage::{ClickHouseStateStorage, StateStorage};
use crate::infrastructure::olap::clickhouse::config::parse_clickhouse_connection_string;
use crate::infrastructure::olap::clickhouse::IgnorableOperation;
use crate::infrastructure::olap::clickhouse::{check_ready, create_client, ConfiguredDBClient};
use crate::project::Project;
use crate::utilities::constants::{
    MIGRATION_AFTER_STATE_FILE, MIGRATION_BEFORE_STATE_FILE, MIGRATION_FILE,
};
use anyhow::Result;
use std::collections::HashMap;

/// Migration files loaded from disk
struct MigrationFiles {
    plan: MigrationPlan,
    state_before: InfrastructureMap,
    state_after: InfrastructureMap,
}

/// Result of drift detection
enum DriftStatus {
    NoDrift,
    AlreadyAtTarget,
    DriftDetected {
        extra_tables: Vec<String>,
        missing_tables: Vec<String>,
        changed_tables: Vec<String>,
    },
}

/// Load and parse migration files from disk
fn load_migration_files() -> Result<MigrationFiles> {
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

    // Load and parse files
    let plan_content = std::fs::read_to_string(MIGRATION_FILE)?;
    let plan: MigrationPlan =
        serde_json::from_value(serde_yaml::from_str::<serde_json::Value>(&plan_content)?)?;

    let before_content = std::fs::read_to_string(MIGRATION_BEFORE_STATE_FILE)?;
    let state_before: InfrastructureMap = serde_json::from_str(&before_content)?;

    let after_content = std::fs::read_to_string(MIGRATION_AFTER_STATE_FILE)?;
    let state_after: InfrastructureMap = serde_json::from_str(&after_content)?;

    Ok(MigrationFiles {
        plan,
        state_before,
        state_after,
    })
}

/// Strips both metadata and ignored fields from tables
fn strip_metadata_and_ignored_fields(
    tables: &HashMap<String, Table>,
    ignore_ops: &[IgnorableOperation],
) -> HashMap<String, Table> {
    tables
        .iter()
        .map(|(name, table)| {
            let mut table = table.clone();
            table.metadata = None;
            // Also strip ignored fields
            let table =
                crate::framework::core::migration_plan::strip_ignored_fields(&table, ignore_ops);
            (name.clone(), table)
        })
        .collect()
}

/// Detects drift by comparing three snapshots of table state.
///
/// This function strips metadata (file paths) before comparison to avoid false positives
/// when code is reorganized without schema changes.
///
/// # Arguments
/// * `current_tables` - What's in the database right now (after reconciliation)
/// * `expected_tables` - What was in the database when the migration plan was generated
/// * `target_tables` - What the current code defines as the desired state
///
/// # Returns
/// * `DriftStatus::NoDrift` - Database matches expected state, safe to proceed
/// * `DriftStatus::AlreadyAtTarget` - Database already matches target, migration already applied
/// * `DriftStatus::DriftDetected` - Database has diverged, migration plan is stale
fn detect_drift(
    current_tables: &HashMap<String, Table>,
    expected_tables: &HashMap<String, Table>,
    target_tables: &HashMap<String, Table>,
    ignore_operations: &[IgnorableOperation],
) -> DriftStatus {
    // Strip metadata and ignored fields to avoid false drift
    let current_no_metadata = strip_metadata_and_ignored_fields(current_tables, ignore_operations);
    let expected_no_metadata =
        strip_metadata_and_ignored_fields(expected_tables, ignore_operations);
    let target_no_metadata = strip_metadata_and_ignored_fields(target_tables, ignore_operations);

    // Check 1: Did the DB change since the plan was generated?
    if current_no_metadata == expected_no_metadata {
        return DriftStatus::NoDrift;
    }

    // Check 2: Are we already at the desired end state?
    // (handles cases where changes were manually applied or migration ran twice)
    if current_no_metadata == target_no_metadata {
        return DriftStatus::AlreadyAtTarget;
    }

    // Calculate drift details for error reporting
    let extra_tables: Vec<String> = current_no_metadata
        .keys()
        .filter(|k| !expected_no_metadata.contains_key(*k))
        .cloned()
        .collect();

    let missing_tables: Vec<String> = expected_no_metadata
        .keys()
        .filter(|k| !current_no_metadata.contains_key(*k))
        .cloned()
        .collect();

    let changed_tables: Vec<String> = current_no_metadata
        .keys()
        .filter(|k| {
            expected_no_metadata.contains_key(*k)
                && current_no_metadata.get(*k) != expected_no_metadata.get(*k)
        })
        .cloned()
        .collect();

    DriftStatus::DriftDetected {
        extra_tables,
        missing_tables,
        changed_tables,
    }
}

/// Report drift details to the user
fn report_drift(drift: &DriftStatus) {
    if let DriftStatus::DriftDetected {
        extra_tables,
        missing_tables,
        changed_tables,
    } = drift
    {
        println!("\n❌ Migration validation failed - database state has changed since plan was generated\n");

        if !extra_tables.is_empty() {
            println!("  Tables added to database: {:?}", extra_tables);
        }
        if !missing_tables.is_empty() {
            println!("  Tables removed from database: {:?}", missing_tables);
        }
        if !changed_tables.is_empty() {
            println!("  Tables with schema changes: {:?}", changed_tables);
        }
    }
}

/// Execute migration operations with detailed error handling
async fn execute_operations(
    project: &Project,
    migration_plan: &MigrationPlan,
    client: &ConfiguredDBClient,
) -> Result<()> {
    if migration_plan.operations.is_empty() {
        println!("\n✓ No operations to apply - database is already up to date");
        return Ok(());
    } else if !project.features.olap {
        anyhow::bail!(
            "OLAP must be enabled to apply migrations\n\
             \n\
             Add to moose.config.toml:\n\
             [features]\n\
             olap = true"
        );
    }

    println!(
        "\n▶ Applying {} migration operation(s)...",
        migration_plan.operations.len()
    );

    let is_dev = !project.is_production;
    for (idx, operation) in migration_plan.operations.iter().enumerate() {
        let description = crate::infrastructure::olap::clickhouse::describe_operation(operation);
        println!(
            "  [{}/{}] {}",
            idx + 1,
            migration_plan.operations.len(),
            description
        );

        // Execute operation and provide detailed error context on failure
        if let Err(e) = crate::infrastructure::olap::clickhouse::execute_atomic_operation(
            &client.config.db_name,
            operation,
            client,
            is_dev,
        )
        .await
        {
            report_partial_failure(idx, migration_plan.operations.len());
            return Err(e.into());
        }
    }

    println!("\n✓ Migration completed successfully");
    Ok(())
}

/// Report partial migration failure with recovery instructions
fn report_partial_failure(succeeded_count: usize, total_count: usize) {
    let remaining = total_count - succeeded_count - 1;

    println!(
        "\n❌ Migration failed at operation {}/{}",
        succeeded_count + 1,
        total_count
    );
    println!("\nPartial migration state:");
    println!(
        "  • {} operation(s) completed successfully",
        succeeded_count
    );
    println!("  • 1 operation failed (shown above)");
    println!("  • {} operation(s) not executed", remaining);

    println!("\n⚠️  Your database is now in a PARTIAL state:");
    if succeeded_count > 0 {
        println!(
            "  • The first {} operation(s) were applied to the database",
            succeeded_count
        );
    }
    println!("  • The failed operation was NOT applied");
    if remaining > 0 {
        println!(
            "  • The remaining {} operation(s) were NOT applied",
            remaining
        );
    }

    println!("\n📋 Next steps:");
    println!("  1. Fix the issue that caused the failure");
    println!("  2. Regenerate the migration plan:");
    println!("     moose generate migration --clickhouse-url <url> --save");
    println!("  3. Review the new plan");
    println!("  4. Run migrate again");
}

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

    // Create state storage directly from CLI-provided ClickHouse URL
    let state_storage = ClickHouseStateStorage::new(client, clickhouse_config.db_name.clone());

    // Acquire migration lock to prevent concurrent migrations
    state_storage.acquire_migration_lock().await.map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Lock".to_string(),
                "Failed to acquire migration lock".to_string(),
            ),
            e,
        )
    })?;

    // Wrap all operations to ensure lock cleanup on any error
    let result = async {
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

        let current_infra_map = if project.features.olap {
            use crate::framework::core::plan::reconcile_with_reality;
            use std::collections::HashSet;

            let target_table_names: HashSet<String> =
                current_infra_map.tables.keys().cloned().collect();

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
            })
    }
    .await;

    // Always release lock explicitly before returning
    // This ensures cleanup happens even if any operation above failed
    if let Err(e) = state_storage.release_migration_lock().await {
        log::warn!("Failed to release migration lock: {}", e);
    }

    result
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

    // Load migration files
    let files = load_migration_files()?;

    // Display plan info
    println!("✓ Loaded approved migration plan from {:?}", MIGRATION_FILE);
    println!("  Plan created: {}", files.plan.created_at);
    println!("  Total operations: {}", files.plan.total_operations());
    println!();
    println!("Safety checks:");
    println!("  • Expected = Database state when plan was generated");
    println!("  • Current  = Database state right now");
    println!("  • Target   = What your local code defines");
    println!();

    // Validate migration plan
    println!("Validating migration plan...");
    let drift = detect_drift(
        current_tables,
        &files.state_before.tables,
        &target_infra_map.tables,
        &project.migration_config.ignore_operations,
    );

    match drift {
        DriftStatus::NoDrift => {
            println!("  ✓ Current = Expected (no drift detected)");

            // Check target matches code
            if files.state_after.tables != target_infra_map.tables {
                anyhow::bail!(
                    "The desired state of the plan is different from the current code.\n\
                     The migration was perhaps generated before additional code changes.\n\
                     Please regenerate the migration plan:\n\
                     \n\
                     moose generate migration --clickhouse-url <url> --save\n"
                );
            }
            println!("  ✓ Target = Code (plan is still valid)");

            // Execute operations
            let client = create_client(project.clickhouse_config.clone());
            check_ready(&client).await?;
            execute_operations(project, &files.plan, &client).await?;
        }
        DriftStatus::AlreadyAtTarget => {
            println!("  ✓ Database already matches target state - skipping migration");
        }
        DriftStatus::DriftDetected { .. } => {
            report_drift(&drift);
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
    }

    // Save the complete infrastructure state
    state_storage
        .store_infrastructure_map(target_infra_map)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy};
    use crate::framework::core::infrastructure_map::PrimitiveSignature;
    use crate::framework::core::partial_infrastructure_map::LifeCycle;

    /// Helper to create a minimal test table
    fn create_test_table(name: &str) -> Table {
        Table {
            name: name.to_string(),
            database: Some("local".to_string()),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            indexes: vec![],
            version: None,
            source_primitive: PrimitiveSignature {
                name: name.to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            engine: None,
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            table_ttl_setting: None,
        }
    }

    /// Helper to create a table with a different column (for testing changes)
    fn create_modified_table(name: &str) -> Table {
        let mut table = create_test_table(name);
        table.columns.push(Column {
            name: "extra_column".to_string(),
            data_type: ColumnType::String,
            required: false,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        });
        table
    }

    #[test]
    fn test_detect_drift_no_drift() {
        let mut current = HashMap::new();
        current.insert("users".to_string(), create_test_table("users"));
        current.insert("posts".to_string(), create_test_table("posts"));

        let expected = current.clone();
        let mut target = HashMap::new();
        target.insert("users".to_string(), create_test_table("users"));
        target.insert("posts".to_string(), create_test_table("posts"));
        target.insert("comments".to_string(), create_test_table("comments"));

        let result = detect_drift(&current, &expected, &target, &[]);
        assert!(matches!(result, DriftStatus::NoDrift));
    }

    #[test]
    fn test_detect_drift_already_at_target() {
        let mut current = HashMap::new();
        current.insert("users".to_string(), create_test_table("users"));
        current.insert("posts".to_string(), create_test_table("posts"));

        let mut expected = HashMap::new();
        expected.insert("users".to_string(), create_test_table("users"));

        let target = current.clone();

        let result = detect_drift(&current, &expected, &target, &[]);
        assert!(matches!(result, DriftStatus::AlreadyAtTarget));
    }

    #[test]
    fn test_detect_drift_with_extra_tables() {
        let mut current = HashMap::new();
        current.insert("users".to_string(), create_test_table("users"));
        current.insert("posts".to_string(), create_test_table("posts"));
        current.insert("comments".to_string(), create_test_table("comments"));

        let mut expected = HashMap::new();
        expected.insert("users".to_string(), create_test_table("users"));
        expected.insert("posts".to_string(), create_test_table("posts"));

        let target = expected.clone();

        let result = detect_drift(&current, &expected, &target, &[]);
        match result {
            DriftStatus::DriftDetected {
                extra_tables,
                missing_tables,
                changed_tables,
            } => {
                assert_eq!(extra_tables, vec!["comments".to_string()]);
                assert!(missing_tables.is_empty());
                assert!(changed_tables.is_empty());
            }
            _ => panic!("Expected DriftDetected"),
        }
    }

    #[test]
    fn test_detect_drift_with_missing_tables() {
        let mut current = HashMap::new();
        current.insert("users".to_string(), create_test_table("users"));

        let mut expected = HashMap::new();
        expected.insert("users".to_string(), create_test_table("users"));
        expected.insert("posts".to_string(), create_test_table("posts"));
        expected.insert("comments".to_string(), create_test_table("comments"));

        let target = expected.clone();

        let result = detect_drift(&current, &expected, &target, &[]);
        match result {
            DriftStatus::DriftDetected {
                extra_tables,
                missing_tables,
                changed_tables,
            } => {
                assert!(extra_tables.is_empty());
                assert_eq!(missing_tables.len(), 2);
                assert!(missing_tables.contains(&"posts".to_string()));
                assert!(missing_tables.contains(&"comments".to_string()));
                assert!(changed_tables.is_empty());
            }
            _ => panic!("Expected DriftDetected"),
        }
    }

    #[test]
    fn test_detect_drift_with_changed_tables() {
        let mut current = HashMap::new();
        current.insert("users".to_string(), create_modified_table("users"));
        current.insert("posts".to_string(), create_test_table("posts"));

        let mut expected = HashMap::new();
        expected.insert("users".to_string(), create_test_table("users"));
        expected.insert("posts".to_string(), create_test_table("posts"));

        let target = expected.clone();

        let result = detect_drift(&current, &expected, &target, &[]);
        match result {
            DriftStatus::DriftDetected {
                extra_tables,
                missing_tables,
                changed_tables,
            } => {
                assert!(extra_tables.is_empty());
                assert!(missing_tables.is_empty());
                assert_eq!(changed_tables, vec!["users".to_string()]);
            }
            _ => panic!("Expected DriftDetected"),
        }
    }

    #[test]
    fn test_detect_drift_with_multiple_drift_types() {
        let mut current = HashMap::new();
        current.insert("users".to_string(), create_modified_table("users"));
        current.insert("analytics".to_string(), create_test_table("analytics"));

        let mut expected = HashMap::new();
        expected.insert("users".to_string(), create_test_table("users"));
        expected.insert("posts".to_string(), create_test_table("posts"));

        let target = expected.clone();

        let result = detect_drift(&current, &expected, &target, &[]);
        match result {
            DriftStatus::DriftDetected {
                extra_tables,
                missing_tables,
                changed_tables,
            } => {
                assert_eq!(extra_tables, vec!["analytics".to_string()]);
                assert_eq!(missing_tables, vec!["posts".to_string()]);
                assert_eq!(changed_tables, vec!["users".to_string()]);
            }
            _ => panic!("Expected DriftDetected"),
        }
    }

    #[test]
    fn test_detect_drift_empty_tables() {
        let current = HashMap::new();
        let expected = HashMap::new();
        let target = HashMap::new();

        let result = detect_drift(&current, &expected, &target, &[]);
        assert!(matches!(result, DriftStatus::NoDrift));
    }

    #[test]
    fn test_detect_drift_target_differs_from_current_and_expected() {
        let mut current = HashMap::new();
        current.insert("users".to_string(), create_test_table("users"));

        let expected = current.clone();

        let mut target = HashMap::new();
        target.insert("users".to_string(), create_test_table("users"));
        target.insert("posts".to_string(), create_test_table("posts"));

        // Current == Expected, but different from Target
        let result = detect_drift(&current, &expected, &target, &[]);
        assert!(matches!(result, DriftStatus::NoDrift));
    }

    #[test]
    fn test_ignore_table_ttl_differences() {
        let mut current_table = create_test_table("users");
        current_table.table_ttl_setting = Some("timestamp + INTERVAL 30 DAY".to_string());

        let mut expected_table = create_test_table("users");
        expected_table.table_ttl_setting = None;

        let mut target_table = create_test_table("users");
        target_table.table_ttl_setting = Some("timestamp + INTERVAL 90 DAY".to_string());

        let mut current = HashMap::new();
        current.insert("users".to_string(), current_table);
        let mut expected = HashMap::new();
        expected.insert("users".to_string(), expected_table);
        let mut target = HashMap::new();
        target.insert("users".to_string(), target_table);

        // Without ignoring TTL, drift is detected
        let result = detect_drift(&current, &expected, &target, &[]);
        match result {
            DriftStatus::DriftDetected { changed_tables, .. } => {
                assert_eq!(changed_tables, vec!["users".to_string()]);
            }
            _ => panic!("Expected drift to be detected"),
        }

        // With ignoring table TTL, no drift
        let result = detect_drift(
            &current,
            &expected,
            &target,
            &[IgnorableOperation::ModifyTableTtl],
        );
        assert!(matches!(result, DriftStatus::NoDrift));
    }

    #[test]
    fn test_ignore_column_ttl_differences() {
        let mut current_table = create_test_table("users");
        current_table.columns[0].ttl = Some("timestamp + INTERVAL 7 DAY".to_string());

        let expected_table = create_test_table("users");

        let mut target_table = create_test_table("users");
        target_table.columns[0].ttl = Some("timestamp + INTERVAL 14 DAY".to_string());

        let mut current = HashMap::new();
        current.insert("users".to_string(), current_table);
        let mut expected = HashMap::new();
        expected.insert("users".to_string(), expected_table);
        let mut target = HashMap::new();
        target.insert("users".to_string(), target_table);

        // Without ignoring column TTL, drift is detected
        let result = detect_drift(&current, &expected, &target, &[]);
        match result {
            DriftStatus::DriftDetected { changed_tables, .. } => {
                assert_eq!(changed_tables, vec!["users".to_string()]);
            }
            _ => panic!("Expected drift to be detected"),
        }

        // With ignoring column TTL, no drift
        let result = detect_drift(
            &current,
            &expected,
            &target,
            &[IgnorableOperation::ModifyColumnTtl],
        );
        assert!(matches!(result, DriftStatus::NoDrift));
    }

    #[test]
    fn test_non_ignored_changes_still_detected() {
        // Current DB has an extra column that wasn't expected (manual change)
        let mut current_table = create_modified_table("users");
        current_table.table_ttl_setting = Some("timestamp + INTERVAL 30 DAY".to_string());

        // Expected state was the base table
        let mut expected_table = create_test_table("users");
        expected_table.table_ttl_setting = None;

        // Target also wants the base table but with different TTL
        let mut target_table = create_test_table("users");
        target_table.table_ttl_setting = Some("timestamp + INTERVAL 90 DAY".to_string());

        let mut current = HashMap::new();
        current.insert("users".to_string(), current_table);
        let mut expected = HashMap::new();
        expected.insert("users".to_string(), expected_table);
        let mut target = HashMap::new();
        target.insert("users".to_string(), target_table);

        // Even with ignoring table TTL, structural changes (extra column) are still detected
        let result = detect_drift(
            &current,
            &expected,
            &target,
            &[IgnorableOperation::ModifyTableTtl],
        );
        match result {
            DriftStatus::DriftDetected { changed_tables, .. } => {
                assert_eq!(changed_tables, vec!["users".to_string()]);
            }
            _ => panic!("Expected drift to be detected due to structural change (extra column)"),
        }
    }
}
