//! Hybrid execution engine for static+dynamic migrations.
//!
//! Combines auto-apply operations (computed from the live diff) with
//! plan-worthy operations (loaded from timestamped plan files in `migrations/`).
//!
//! This module is called by both `moose migrate` and `moose prod`.

// Called by `moose migrate` (Task 6) and will be called by `moose prod` (Task 7).

use std::collections::HashMap;
use std::path::Path;

use anyhow::Result;
use tracing::{debug, info, warn};

use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::{InfraChanges, InfrastructureMap};
use crate::framework::core::migration_plan::MigrationPlan;
use crate::framework::core::operation_class::{classify_serializable_op, OperationClass};
use crate::framework::core::plan::infra_changes_to_operations;
use crate::framework::core::state_storage::StateStorage;
use crate::infrastructure::olap::clickhouse::{
    check_ready, create_client, SerializableOlapOperation,
};
use crate::project::Project;
use crate::utilities::constants::MIGRATIONS_DIR;

use super::migrate::execute_operations;
use super::plan_files::{
    detect_scoped_drift, discover_plan_files, load_plan, load_state, ScopedDriftStatus,
};

/// Runs a hybrid migration: auto-apply safe operations from the live diff,
/// and merge in plan-worthy operations from reviewed plan files.
///
/// # Errors
///
/// Returns an error when:
/// - Plan-worthy operations are detected but no plan files exist and
///   `prod_auto_allow_destructive` is false.
/// - A plan file's scoped drift check reports `Drifted`.
/// - ClickHouse is unreachable or an operation fails to execute.
pub async fn execute_hybrid_migration(
    project: &Project,
    current_tables: &HashMap<String, Table>,
    target_infra_map: &InfrastructureMap,
    changes: &InfraChanges,
    state_storage: &dyn StateStorage,
    prod_auto_allow_destructive: bool,
) -> Result<()> {
    // 1. Convert high-level InfraChanges to ordered DDL operations.
    let all_ops = infra_changes_to_operations(changes, &project.clickhouse_config.db_name)?;

    if all_ops.is_empty() {
        info!("Hybrid migration: no operations to apply");
        state_storage
            .store_infrastructure_map(target_infra_map)
            .await?;
        return Ok(());
    }

    // 2. Classify each operation.
    let has_plan_worthy = all_ops
        .iter()
        .any(|op| classify_serializable_op(op) == OperationClass::PlanWorthy);

    // 3. Resolve plan-worthy operations.
    let planned_ops: Vec<SerializableOlapOperation> = if has_plan_worthy {
        let migrations_dir = Path::new(MIGRATIONS_DIR);
        let plan_files = discover_plan_files(migrations_dir);

        if plan_files.is_empty() {
            if prod_auto_allow_destructive {
                info!(
                    "Hybrid migration: no plan files found but prod_auto_allow_destructive is \
                     enabled; proceeding with computed operations"
                );
                // Return empty vec so the merge falls back to the computed ops.
                Vec::new()
            } else {
                let destructive_descriptions: Vec<String> = all_ops
                    .iter()
                    .filter(|op| classify_serializable_op(op) == OperationClass::PlanWorthy)
                    .map(describe_op)
                    .collect();

                let summary = destructive_descriptions
                    .iter()
                    .map(|d| format!("  - {d}"))
                    .collect::<Vec<_>>()
                    .join("\n");

                anyhow::bail!(
                    "Hybrid migration blocked: {} destructive operation(s) detected but no \
                     plan files found in {}/.\n\
                     {}\n\n\
                     To proceed, either:\n  \
                     1. Run `moose generate migration` to create reviewed plan files, or\n  \
                     2. Set `prod_auto_allow_destructive = true` under [migration_config] \
                     in moose.config.toml.",
                    destructive_descriptions.len(),
                    MIGRATIONS_DIR,
                    summary,
                );
            }
        } else {
            load_and_validate_plan_files(
                migrations_dir,
                current_tables,
                &project.clickhouse_config.db_name,
            )?
        }
    } else {
        Vec::new()
    };

    // 4. Merge: preserve original dependency ordering from infra_changes_to_operations,
    //    but substitute plan-file versions for any plan-worthy slot.
    let merged_ops: Vec<SerializableOlapOperation> = if planned_ops.is_empty() {
        all_ops
    } else {
        let mut merged = Vec::with_capacity(all_ops.len());
        for op in all_ops {
            if classify_serializable_op(&op) == OperationClass::PlanWorthy {
                match planned_ops.iter().find(|p| ops_match(&op, p)).cloned() {
                    Some(reviewed_op) => merged.push(reviewed_op),
                    None => {
                        if prod_auto_allow_destructive {
                            merged.push(op);
                        } else {
                            anyhow::bail!(
                                "Hybrid migration blocked: destructive operation {} is not \
                                 covered by any plan file. Re-run `moose generate migration` \
                                 to create an updated plan.",
                                describe_op(&op),
                            );
                        }
                    }
                }
            } else {
                merged.push(op);
            }
        }
        merged
    };

    // 5. Execute via the existing migration executor.
    let client = create_client(project.clickhouse_config.clone());
    check_ready(&client).await?;

    let plan = MigrationPlan {
        created_at: chrono::Utc::now(),
        operations: merged_ops,
    };
    execute_operations(project, &plan, &client).await?;

    // 6. Persist updated state.
    state_storage
        .store_infrastructure_map(target_infra_map)
        .await?;

    Ok(())
}

/// Loads and validates all plan files from the migrations directory.
///
/// For each plan file found:
/// 1. Loads the plan YAML.
/// 2. Loads the associated `_state.json` (derived from the plan filename stem).
/// 3. Runs scoped drift detection against the current database tables.
/// 4. Returns applicable operations, skips already-applied plans, and errors on drift.
fn load_and_validate_plan_files(
    migrations_dir: &Path,
    current_tables: &HashMap<String, Table>,
    default_database: &str,
) -> Result<Vec<SerializableOlapOperation>> {
    let plan_files = discover_plan_files(migrations_dir);
    let mut all_ops = Vec::new();

    for plan_path in &plan_files {
        let plan = load_plan(plan_path)?;

        // Derive the state file path: same stem + `_state.json`
        let stem = plan_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let state_path = migrations_dir.join(format!("{stem}_state.json"));

        let expected_tables = if state_path.exists() {
            let state = load_state(&state_path)?;
            state.tables
        } else {
            warn!(
                "No state file found at {}; treating all tables as new (no drift check)",
                state_path.display()
            );
            HashMap::new()
        };

        let drift_status = detect_scoped_drift(
            current_tables,
            &expected_tables,
            &plan.operations,
            default_database,
        );

        match drift_status {
            ScopedDriftStatus::Applicable => {
                debug!(
                    "Plan file {} is applicable ({} ops)",
                    plan_path.display(),
                    plan.operations.len()
                );
                all_ops.extend(plan.operations);
            }
            ScopedDriftStatus::AlreadyApplied => {
                info!(
                    "Plan file {} already applied, skipping",
                    plan_path.display()
                );
            }
            ScopedDriftStatus::Drifted { changed_tables } => {
                anyhow::bail!(
                    "Plan file {} cannot be applied: database drift detected on table(s): {}\n\n\
                     The current database state does not match the expected state captured \
                     when this plan was generated. Either:\n  \
                     1. Re-generate the migration plan with `moose generate migration`, or\n  \
                     2. Investigate and resolve the drift manually.",
                    plan_path.display(),
                    changed_tables.join(", "),
                );
            }
        }
    }

    Ok(all_ops)
}

/// Checks whether two operations target the same object by comparing their
/// enum discriminant and target name.
fn ops_match(a: &SerializableOlapOperation, b: &SerializableOlapOperation) -> bool {
    std::mem::discriminant(a) == std::mem::discriminant(b) && op_target(a) == op_target(b)
}

/// Extracts the target table or view name from an operation, if available.
fn op_target(op: &SerializableOlapOperation) -> Option<&str> {
    match op {
        SerializableOlapOperation::CreateTable { table } => Some(&table.name),
        SerializableOlapOperation::DropTable { table, .. } => Some(table),
        SerializableOlapOperation::AddTableColumn { table, .. }
        | SerializableOlapOperation::DropTableColumn { table, .. }
        | SerializableOlapOperation::ModifyTableColumn { table, .. }
        | SerializableOlapOperation::RenameTableColumn { table, .. }
        | SerializableOlapOperation::ModifyTableSettings { table, .. }
        | SerializableOlapOperation::ModifyTableTtl { table, .. }
        | SerializableOlapOperation::AddTableIndex { table, .. }
        | SerializableOlapOperation::DropTableIndex { table, .. }
        | SerializableOlapOperation::AddTableProjection { table, .. }
        | SerializableOlapOperation::DropTableProjection { table, .. }
        | SerializableOlapOperation::ModifySampleBy { table, .. }
        | SerializableOlapOperation::RemoveSampleBy { table, .. } => Some(table),
        SerializableOlapOperation::CreateMaterializedView { name, .. }
        | SerializableOlapOperation::DropMaterializedView { name, .. }
        | SerializableOlapOperation::CreateView { name, .. }
        | SerializableOlapOperation::DropView { name, .. } => Some(name),
        SerializableOlapOperation::RawSql { .. } => None,
        SerializableOlapOperation::CreateRowPolicy { policy }
        | SerializableOlapOperation::DropRowPolicy { policy } => {
            policy.tables.first().map(|t| t.name.as_str())
        }
    }
}

/// Returns a brief human-readable description of an operation for error messages.
fn describe_op(op: &SerializableOlapOperation) -> String {
    match op {
        SerializableOlapOperation::DropTable { table, .. } => format!("DropTable({table})"),
        SerializableOlapOperation::DropTableColumn {
            table, column_name, ..
        } => format!("DropTableColumn({table}.{column_name})"),
        SerializableOlapOperation::DropMaterializedView { name, .. } => {
            format!("DropMaterializedView({name})")
        }
        SerializableOlapOperation::DropView { name, .. } => format!("DropView({name})"),
        SerializableOlapOperation::RawSql { description, .. } => {
            format!("RawSql({description})")
        }
        other => {
            let target = op_target(other)
                .map(|t| t.to_string())
                .unwrap_or_else(|| "?".to_string());
            format!("{:?}({target})", std::mem::discriminant(other))
        }
    }
}
