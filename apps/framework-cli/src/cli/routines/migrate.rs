//! Migration execution logic for moose migrate command

use crate::cli::display::Message;
use crate::cli::routines::RoutineFailure;
use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::migration_file::MigrationFile;
use crate::framework::core::migration_plan::MigrationPlan;
use crate::framework::core::plan::{reconcile_with_reality, ReconciliationFilter};
use crate::framework::core::state_storage::{StateStorage, StateStorageBuilder};
use crate::infrastructure::olap::clickhouse::config::{ClickHouseConfig, ClusterConfig};
use crate::infrastructure::olap::clickhouse::dictionary::OlapDictionary;
use crate::infrastructure::olap::clickhouse::errors::macro_use_legal;
use crate::infrastructure::olap::clickhouse::{
    check_ready, create_client, ConfiguredDBClient, SerializableOlapOperation,
};
use crate::infrastructure::olap::clickhouse::{normalize_table_for_diff, IgnorableOperation};
use crate::project::Project;
use crate::utilities::constants::{
    CLICKHOUSE_MACRO_CLUSTER_NAME_RULES, MIGRATION_AFTER_STATE_FILE, MIGRATION_BEFORE_STATE_FILE,
    MIGRATION_FILE,
};
use anyhow::Result;
use itertools::Itertools;
use std::collections::HashMap;

/// Migration files loaded from disk
struct MigrationFiles {
    plan: MigrationPlan,
    state_before: InfrastructureMap,
    state_after: InfrastructureMap,
}

/// Result of drift detection
#[derive(Debug)]
enum DriftStatus {
    NoDrift,
    AlreadyAtTarget,
    DriftDetected {
        extra_tables: Vec<String>,
        missing_tables: Vec<String>,
        changed_tables: Vec<String>,
        extra_dicts: Vec<String>,
        missing_dicts: Vec<String>,
        changed_dicts: Vec<String>,
    },
}

/// Load and parse migration files from disk
fn load_migration_files(db_name: &str) -> Result<MigrationFiles> {
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
    let mut state_before: InfrastructureMap = serde_json::from_str(&before_content)?;

    let after_content = std::fs::read_to_string(MIGRATION_AFTER_STATE_FILE)?;
    let mut state_after: InfrastructureMap = serde_json::from_str(&after_content)?;

    // Re-key tables so the HashMap keys match the current project's db_name.
    // The saved files may have been generated against a different database name.
    state_before.fixup_default_db(db_name);
    state_after.fixup_default_db(db_name);

    Ok(MigrationFiles {
        plan,
        state_before,
        state_after,
    })
}

/// Normalizes dictionaries for drift comparison by stripping:
/// - `metadata` (source file paths, descriptions): avoids false drift when files are reorganized
/// - **password** fields only: avoids false drift because `state_before` JSON files store
///   passwords as `CREDENTIAL_PLACEHOLDER` (via `mask_credentials_for_json_export`), while the
///   live infra map has real passwords. Both sides are normalized to `CREDENTIAL_PLACEHOLDER`
///   so the comparison is password-agnostic.
///
/// Usernames are intentionally **not** normalized: `mask_credentials_for_json_export` leaves
/// them in plain-text in persisted JSON, so both sides already have the real username and a
/// username change produces visible drift.
fn strip_dict_metadata(dicts: &HashMap<String, OlapDictionary>) -> HashMap<String, OlapDictionary> {
    use crate::infrastructure::olap::clickhouse::dictionary::{
        DictionarySource, ExternalDictionarySource, ExternalDictionarySourceWrapper,
    };
    use crate::utilities::secrets::CREDENTIAL_PLACEHOLDER;

    dicts
        .iter()
        .map(|(name, dict)| {
            let mut dict = dict.clone();
            dict.metadata = None;
            // Normalize only passwords (not usernames) so that state_before JSON
            // (password = CREDENTIAL_PLACEHOLDER) compares equal to the live infra map
            // (password = real value). Usernames are stored in plain-text in the JSON
            // by mask_credentials_for_json_export, so they must not be normalized here —
            // a username change must surface as drift.
            if let DictionarySource::External(ExternalDictionarySourceWrapper {
                ref mut external_source,
            }) = dict.source
            {
                match external_source {
                    ExternalDictionarySource::ClickHouse(s) => {
                        s.password = CREDENTIAL_PLACEHOLDER.to_string();
                    }
                    ExternalDictionarySource::Mysql(s) => {
                        s.password = CREDENTIAL_PLACEHOLDER.to_string();
                    }
                    ExternalDictionarySource::Postgresql(s) => {
                        s.password = CREDENTIAL_PLACEHOLDER.to_string();
                    }
                    ExternalDictionarySource::Mongodb(s) => {
                        s.password = CREDENTIAL_PLACEHOLDER.to_string();
                    }
                    ExternalDictionarySource::Redis(s) => {
                        if s.password.is_some() {
                            s.password = Some(CREDENTIAL_PLACEHOLDER.to_string());
                        }
                    }
                    ExternalDictionarySource::S3(s) => {
                        if s.access_key_id.is_some() {
                            s.access_key_id = Some(CREDENTIAL_PLACEHOLDER.to_string());
                        }
                        if s.secret_access_key.is_some() {
                            s.secret_access_key = Some(CREDENTIAL_PLACEHOLDER.to_string());
                        }
                    }
                    ExternalDictionarySource::Http(_) | ExternalDictionarySource::Executable(_) => {
                    }
                }
            }
            (name.clone(), dict)
        })
        .collect()
}

/// Returns true when the plan's `state_after` (desired end state) still matches the
/// current code — i.e. the plan was not generated before additional code changes.
///
/// Metadata (source file paths, descriptions) is stripped before comparison so that
/// reorganising source files without changing the schema does not produce a false
/// "please regenerate" bail-out.
///
/// `ignore_ops` is forwarded to `strip_metadata_and_ignored_fields` so that operations
/// the project deliberately ignores (e.g. `ModifyPartitionBy`) are not treated as
/// differences between the plan target and the current code.
fn plan_target_matches_code(
    state_after_tables: &HashMap<String, Table>,
    code_tables: &HashMap<String, Table>,
    state_after_dicts: &HashMap<String, OlapDictionary>,
    code_dicts: &HashMap<String, OlapDictionary>,
    ignore_ops: &[IgnorableOperation],
) -> bool {
    let state_after_tables_stripped =
        strip_metadata_and_ignored_fields(state_after_tables, ignore_ops);
    let code_tables_stripped = strip_metadata_and_ignored_fields(code_tables, ignore_ops);
    let state_after_dicts_stripped = strip_dict_metadata(state_after_dicts);
    let code_dicts_stripped = strip_dict_metadata(code_dicts);
    state_after_tables_stripped == code_tables_stripped
        && state_after_dicts_stripped == code_dicts_stripped
}

/// Normalizes every table for drift detection.
///
/// Applies `normalize_table_for_diff` (same as the plan diff) plus additional
/// stripping of fields that the diff strategy handles specially but the raw
/// `==` comparison in `detect_drift` cannot:
///
/// - `engine_params_hash` / `table_settings_hash`: exist for secret-bearing
///   settings (e.g. Kafka credentials). The diff strategy compares hashes when
///   *both* sides have one and falls back to direct value comparison otherwise.
///   DB-introspected tables never have hashes, so one side is always `None`.
/// - `database`: `None` means "use default". DB-reconciled tables get
///   `Some(actual_db)`, which is semantically equal when it IS the default.
///   A real database change surfaces as a different `Table::id()` key.
fn strip_metadata_and_ignored_fields(
    tables: &HashMap<String, Table>,
    ignore_ops: &[IgnorableOperation],
) -> HashMap<String, Table> {
    tables
        .iter()
        .map(|(name, table)| {
            let mut table = normalize_table_for_diff(table, ignore_ops);
            table.engine_params_hash = None;
            table.table_settings_hash = None;
            table.database = None;
            (name.clone(), table)
        })
        .collect()
}

/// Detects drift by comparing three snapshots of table and dictionary state.
///
/// Uses `normalize_table_for_diff` — the same normalization the plan diff uses —
/// so that "empty olap_changes" ↔ NoDrift / AlreadyAtTarget.
///
/// # Arguments
/// * `current_tables` - What's in the database right now (after reconciliation)
/// * `expected_tables` - What was in the database when the migration plan was generated
/// * `target_tables` - What the current code defines as the desired state
/// * `current_dicts` - Dictionaries in the database right now
/// * `expected_dicts` - Dictionaries when the plan was generated
/// * `target_dicts` - Dictionaries defined by current code
///
/// # Returns
/// * `DriftStatus::NoDrift` - Database matches expected state, safe to proceed
/// * `DriftStatus::AlreadyAtTarget` - Database already matches target, migration already applied
/// * `DriftStatus::DriftDetected` - Database has diverged, migration plan is stale
fn detect_drift(
    current_tables: &HashMap<String, Table>,
    expected_tables: &HashMap<String, Table>,
    target_tables: &HashMap<String, Table>,
    current_dicts: &HashMap<String, OlapDictionary>,
    expected_dicts: &HashMap<String, OlapDictionary>,
    target_dicts: &HashMap<String, OlapDictionary>,
    ignore_operations: &[IgnorableOperation],
) -> DriftStatus {
    // Strip metadata and ignored fields to avoid false drift
    let current_no_metadata = strip_metadata_and_ignored_fields(current_tables, ignore_operations);
    let expected_no_metadata =
        strip_metadata_and_ignored_fields(expected_tables, ignore_operations);
    let target_no_metadata = strip_metadata_and_ignored_fields(target_tables, ignore_operations);
    let current_dicts_no_metadata = strip_dict_metadata(current_dicts);
    let expected_dicts_no_metadata = strip_dict_metadata(expected_dicts);
    let target_dicts_no_metadata = strip_dict_metadata(target_dicts);

    // Check 1: Did the DB change since the plan was generated?
    // Compare both tables and dictionaries with full content equality
    let tables_match = current_no_metadata == expected_no_metadata;
    let dicts_match = current_dicts_no_metadata == expected_dicts_no_metadata;

    if tables_match && dicts_match {
        return DriftStatus::NoDrift;
    }

    // Check 2: Are we already at the desired end state?
    // (handles cases where changes were manually applied or migration ran twice)
    let tables_at_target = current_no_metadata == target_no_metadata;
    let dicts_at_target = current_dicts_no_metadata == target_dicts_no_metadata;

    if tables_at_target && dicts_at_target {
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

    let changed_tables = changed_tables_between(&current_no_metadata, &expected_no_metadata);
    let changed_vs_target_tables =
        changed_tables_between(&current_no_metadata, &target_no_metadata);

    if tracing::enabled!(tracing::Level::DEBUG) {
        log_table_diff(
            &changed_tables,
            &current_no_metadata,
            &expected_no_metadata,
            "current (DB) vs expected (plan-before) — why not NoDrift",
        );
        log_table_diff(
            &changed_vs_target_tables,
            &current_no_metadata,
            &target_no_metadata,
            "current (DB) vs target (code) — why not AlreadyAtTarget",
        );
    }

    let extra_dicts: Vec<String> = current_dicts_no_metadata
        .keys()
        .filter(|k| !expected_dicts_no_metadata.contains_key(*k))
        .cloned()
        .collect();

    let missing_dicts: Vec<String> = expected_dicts_no_metadata
        .keys()
        .filter(|k| !current_dicts_no_metadata.contains_key(*k))
        .cloned()
        .collect();

    let changed_dicts: Vec<String> = current_dicts_no_metadata
        .keys()
        .filter(|k| {
            expected_dicts_no_metadata.contains_key(*k)
                && current_dicts_no_metadata.get(*k) != expected_dicts_no_metadata.get(*k)
        })
        .cloned()
        .collect();

    DriftStatus::DriftDetected {
        extra_tables,
        missing_tables,
        changed_tables,
        extra_dicts,
        missing_dicts,
        changed_dicts,
    }
}

fn changed_tables_between(
    left: &HashMap<String, Table>,
    right: &HashMap<String, Table>,
) -> Vec<String> {
    left.keys()
        .filter(|k| right.contains_key(*k) && left.get(*k) != right.get(*k))
        .cloned()
        .collect()
}

/// Logs per-field diffs between two table snapshots for a set of table names.
fn log_table_diff(
    table_names: &[String],
    left: &HashMap<String, Table>,
    right: &HashMap<String, Table>,
    label: &str,
) {
    for name in table_names {
        let (Some(l), Some(r)) = (left.get(name), right.get(name)) else {
            tracing::debug!(table = %name, "{label}: table missing from one side");
            continue;
        };
        if l == r {
            tracing::debug!(table = %name, "{label}: identical");
            continue;
        }
        let lj = serde_json::to_string_pretty(l).unwrap_or_default();
        let rj = serde_json::to_string_pretty(r).unwrap_or_default();
        tracing::debug!(table = %name, "{label}:");
        for (i, pair) in lj.lines().zip_longest(rj.lines()).enumerate() {
            match pair {
                itertools::EitherOrBoth::Both(a, b) if a != b => {
                    tracing::debug!("  line {i}: left:  {a}");
                    tracing::debug!("  line {i}: right: {b}");
                }
                itertools::EitherOrBoth::Left(a) => {
                    tracing::debug!("  line {i}: left:  {a}");
                }
                itertools::EitherOrBoth::Right(b) => {
                    tracing::debug!("  line {i}: right: {b}");
                }
                _ => {}
            }
        }
    }
}

/// Report drift details to the user
fn report_drift(drift: &DriftStatus) {
    if let DriftStatus::DriftDetected {
        extra_tables,
        missing_tables,
        changed_tables,
        extra_dicts,
        missing_dicts,
        changed_dicts,
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
        if !extra_dicts.is_empty() {
            println!("  Dictionaries added to database: {:?}", extra_dicts);
        }
        if !missing_dicts.is_empty() {
            println!("  Dictionaries removed from database: {:?}", missing_dicts);
        }
        if !changed_dicts.is_empty() {
            println!("  Dictionaries with content changes: {:?}", changed_dicts);
        }
    }
}

/// Validates that all table databases and clusters specified in operations are configured
fn validate_table_databases_and_clusters(
    operations: &[SerializableOlapOperation],
    primary_database: &str,
    additional_databases: &[String],
    clusters: &Option<Vec<ClusterConfig>>,
) -> Result<()> {
    let mut invalid_resources = Vec::new();
    let mut invalid_resource_clusters = Vec::new();
    let mut malformed_cluster_macros = Vec::new();

    // Get configured cluster names
    let cluster_names: Vec<String> = clusters
        .as_ref()
        .map(|cs| cs.iter().map(|c| c.name.clone()).collect())
        .unwrap_or_default();

    tracing::info!("Configured cluster names: {:?}", cluster_names);

    // Helper to validate database and cluster options for any resource (table, dictionary, etc.)
    let mut validate = |db_opt: &Option<String>,
                        cluster_opt: &Option<String>,
                        resource_name: &str| {
        tracing::info!(
            "Validating resource '{}' with cluster: {:?}",
            resource_name,
            cluster_opt
        );
        // Validate database
        if let Some(db) = db_opt {
            if db != primary_database && !additional_databases.contains(db) {
                invalid_resources.push((resource_name.to_string(), db.clone()));
            }
        }
        // Validate cluster
        if let Some(cluster) = cluster_opt {
            tracing::info!(
                "Checking if cluster '{}' is in {:?}",
                cluster,
                cluster_names
            );
            match macro_use_legal(cluster) {
                Some(true) => {
                    // Valid ClickHouse macro (e.g. `{cluster}`) — skip list check
                }
                Some(false) => {
                    // Malformed macro syntax
                    tracing::info!(
                        "Cluster '{}' uses malformed macro syntax for '{}'",
                        cluster,
                        resource_name
                    );
                    malformed_cluster_macros.push((resource_name.to_string(), cluster.clone()));
                }
                None => {
                    // Plain cluster name — must appear in the configured list
                    if cluster_names.is_empty() || !cluster_names.contains(cluster) {
                        tracing::info!("Cluster '{}' not found in configured clusters!", cluster);
                        invalid_resource_clusters
                            .push((resource_name.to_string(), cluster.clone()));
                    }
                }
            }
        }
    };

    for operation in operations {
        match operation {
            SerializableOlapOperation::CreateTable { table } => {
                validate(&table.database, &table.cluster_name, &table.name);
            }
            SerializableOlapOperation::DropTable {
                table,
                database,
                cluster_name,
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::AddTableColumn {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::DropTableColumn {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::ModifyTableColumn {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::RenameTableColumn {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::ModifyTableSettings {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::ModifyTableTtl {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::AddTableIndex {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::DropTableIndex {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::AddTableProjection {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::DropTableProjection {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::AddTableConstraint {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::DropTableConstraint {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::ModifySampleBy {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::RemoveSampleBy {
                table,
                database,
                cluster_name,
                ..
            } => {
                validate(database, cluster_name, table);
            }
            SerializableOlapOperation::RawSql { .. } => {
                // RawSql doesn't reference specific tables/databases/clusters, skip validation
            }
            SerializableOlapOperation::CreateMaterializedView { .. }
            | SerializableOlapOperation::DropMaterializedView { .. }
            | SerializableOlapOperation::CreateView { .. }
            | SerializableOlapOperation::DropView { .. } => {
                // Moose does not have cluster support for MV/View, skip validation
            }
            SerializableOlapOperation::CreateRowPolicy { .. }
            | SerializableOlapOperation::DropRowPolicy { .. } => {
                // Row policies reference tables but don't need cluster validation
            }
            SerializableOlapOperation::CreateDictionary { dict }
            | SerializableOlapOperation::ReplaceDictionary { dict }
            | SerializableOlapOperation::DropDictionary { dict } => {
                validate(&dict.database, &dict.cluster_name, &dict.name);
            }
        }
    }

    // Build error message if we found any issues
    let has_errors = !invalid_resources.is_empty()
        || !invalid_resource_clusters.is_empty()
        || !malformed_cluster_macros.is_empty();
    if has_errors {
        let mut error_message = String::new();

        // Report malformed macro errors first (actionable: fix the syntax, not the config)
        if !malformed_cluster_macros.is_empty() {
            error_message.push_str(
                "One or more resources specify cluster names with invalid ClickHouse macro syntax:\n\n",
            );

            for (resource_name, cluster) in &malformed_cluster_macros {
                error_message.push_str(&format!(
                    "  • Resource '{}' specifies cluster '{}'\n",
                    resource_name, cluster
                ));
            }

            error_message.push('\n');
            error_message.push_str(CLICKHOUSE_MACRO_CLUSTER_NAME_RULES);
            error_message.push('\n');
        }

        // Report database errors
        if !invalid_resources.is_empty() {
            if !malformed_cluster_macros.is_empty() {
                error_message.push('\n');
            }

            error_message.push_str(
                "One or more resources specify databases that are not configured in moose.config.toml:\n\n",
            );

            for (resource_name, database) in &invalid_resources {
                error_message.push_str(&format!(
                    "  • Resource '{}' specifies database '{}'\n",
                    resource_name, database
                ));
            }

            error_message.push_str(
                "\nTo fix this, add the missing database(s) to your moose.config.toml:\n\n",
            );
            error_message.push_str("[clickhouse_config]\n");
            error_message.push_str(&format!("db_name = \"{}\"\n", primary_database));
            error_message.push_str("additional_databases = [");

            let mut all_databases: Vec<String> = additional_databases.to_vec();
            for (_, db) in &invalid_resources {
                if !all_databases.contains(db) {
                    all_databases.push(db.clone());
                }
            }
            all_databases.sort();

            let db_list = all_databases
                .iter()
                .map(|db| format!("\"{}\"", db))
                .collect::<Vec<_>>()
                .join(", ");
            error_message.push_str(&db_list);
            error_message.push_str("]\n");
        }

        // Report cluster errors
        if !invalid_resource_clusters.is_empty() {
            if !malformed_cluster_macros.is_empty() || !invalid_resources.is_empty() {
                error_message.push('\n');
            }

            error_message.push_str(
                "One or more resources specify clusters that are not configured in moose.config.toml:\n\n",
            );

            for (resource_name, cluster) in &invalid_resource_clusters {
                error_message.push_str(&format!(
                    "  • Resource '{}' specifies cluster '{}'\n",
                    resource_name, cluster
                ));
            }

            error_message.push_str(
                "\nTo fix this, add the missing cluster(s) to your moose.config.toml:\n\n",
            );

            // Only show the missing clusters in the error message, not the already configured ones
            let mut missing_clusters: Vec<String> = invalid_resource_clusters
                .iter()
                .map(|(_, cluster)| cluster.clone())
                .collect();
            missing_clusters.sort();
            missing_clusters.dedup();

            for cluster in &missing_clusters {
                error_message.push_str("[[clickhouse_config.clusters]]\n");
                error_message.push_str(&format!("name = \"{}\"\n\n", cluster));
            }
        }

        anyhow::bail!(error_message);
    }

    Ok(())
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

    // Validate that all table databases and clusters are configured
    tracing::info!(
        "Validating operations against config. Clusters: {:?}",
        project.clickhouse_config.clusters
    );
    validate_table_databases_and_clusters(
        &migration_plan.operations,
        &project.clickhouse_config.db_name,
        &project.clickhouse_config.additional_databases,
        &project.clickhouse_config.clusters,
    )?;

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

/// Format a detailed partial-failure report when a migration file's DDL
/// execution fails partway through its deltas.
///
/// Unlike the legacy plan.yaml path (single flat list of ops), delta files
/// are structured: file → ordered deltas → atomic DDL ops. When a delta fails
/// partway through a file, the database is in an intermediate state the
/// migration log does not reflect. ClickHouse DDL has no transactional
/// rollback, so naively re-running `moose migrate` will usually fail on the
/// already-succeeded deltas ("table already exists", etc.) — the user has to
/// recover deliberately.
///
/// Returns a multi-line string (the caller prints). Output lists:
///   - which migration + delta position failed
///   - the deltas in this file that succeeded (DDL executed)
///   - the failed delta
///   - the deltas that were not attempted
///   - a warning against a naive re-run
///   - recovery options
fn format_partial_delta_failure(file: &MigrationFile, failed_delta_idx: usize) -> String {
    use std::fmt::Write;
    let mut out = String::new();

    let total = file.deltas.len();
    let failed_position = failed_delta_idx + 1;

    writeln!(
        out,
        "\n❌ Migration '{}' failed at delta {}/{}",
        file.id, failed_position, total
    )
    .unwrap();

    writeln!(out, "\nPartial state of this migration:").unwrap();

    if failed_delta_idx > 0 {
        writeln!(
            out,
            "\n  Succeeded (DDL executed, fold applied to in-memory map):"
        )
        .unwrap();
        for (i, delta) in file.deltas[..failed_delta_idx].iter().enumerate() {
            writeln!(out, "    ✓ [{}/{}] {}", i + 1, total, delta.summary()).unwrap();
        }
    } else {
        writeln!(out, "\n  No deltas completed before the failure.").unwrap();
    }

    writeln!(out, "\n  Failed:").unwrap();
    writeln!(
        out,
        "    ✗ [{}/{}] {}",
        failed_position,
        total,
        file.deltas[failed_delta_idx].summary()
    )
    .unwrap();

    let remaining = total - failed_delta_idx - 1;
    if remaining > 0 {
        writeln!(out, "\n  Not attempted:").unwrap();
        for (offset, delta) in file.deltas[failed_delta_idx + 1..].iter().enumerate() {
            writeln!(
                out,
                "    · [{}/{}] {}",
                failed_delta_idx + offset + 2,
                total,
                delta.summary()
            )
            .unwrap();
        }
    }

    if failed_delta_idx > 0 {
        writeln!(
            out,
            "\n⚠️  '{}' is NOT recorded as applied, but its first {} delta(s) have already\n\
             been executed against the database. Re-running `moose migrate` as-is will try\n\
             to re-apply them, which typically fails with errors like \"table already exists\"\n\
             or \"column already exists\". ClickHouse DDL has no transactional rollback —\n\
             partial failures require deliberate recovery.",
            file.id, failed_delta_idx
        )
        .unwrap();
    } else {
        writeln!(
            out,
            "\n⚠️  '{}' is NOT recorded as applied. The very first delta failed, so no\n\
             DDL was executed. Fix the underlying issue and re-run `moose migrate`.",
            file.id
        )
        .unwrap();
    }

    writeln!(out, "\n📋 Recovery options:").unwrap();
    writeln!(
        out,
        "\n  1. Revert the succeeded deltas manually in ClickHouse (bringing the database\n\
         back to the state before '{}'), fix the cause of the failure, then re-run\n\
         `moose migrate`.",
        file.id
    )
    .unwrap();
    writeln!(
        out,
        "\n  2. Fix the underlying issue, manually apply the remaining deltas in ClickHouse\n\
         to complete the migration, then mark '{}' as applied in state storage so future\n\
         runs skip it. (Advanced; use only if you can't cleanly revert.)",
        file.id
    )
    .unwrap();

    out
}

/// Execute migration from delta files (MigrationHistory).
///
/// Loads MigrationHistory from the migrations directory, filters to unapplied
/// migrations, applies each delta by lowering to AtomicOlapOperations and
/// executing against ClickHouse, then updates the infrastructure map via fold.
pub async fn execute_migration_deltas(
    project: &Project,
    clickhouse_config: &ClickHouseConfig,
    current_map: &InfrastructureMap,
    state_storage: &dyn StateStorage,
) -> Result<()> {
    use crate::framework::core::migration_file::MigrationHistory;
    use std::path::Path;

    let migrations_dir = Path::new("./migrations");
    if !migrations_dir.exists() {
        println!("No migrations directory found — nothing to apply");
        return Ok(());
    }

    let history = MigrationHistory::load_from_dir(migrations_dir)
        .map_err(|e| anyhow::anyhow!("Failed to load migration files: {}", e))?;

    if history.is_empty() {
        println!("No migration files found in ./migrations/");
        return Ok(());
    }

    // Filter to unapplied migrations only
    // `applied` is kept in sync as we record each successful file, so drift
    // forensics on a later hash-mismatch include all prior successes from this run.
    let mut applied = state_storage.load_applied_migrations().await?;
    let unapplied: Vec<_> = history
        .files
        .iter()
        .filter(|f| !applied.contains(&f.id))
        .collect();

    if unapplied.is_empty() {
        println!(
            "All {} migration delta file(s) already applied",
            history.files.len()
        );
        return Ok(());
    }

    println!(
        "Found {} migration delta file(s) ({} unapplied)",
        history.files.len(),
        unapplied.len()
    );

    if !project.features.olap {
        anyhow::bail!(
            "OLAP must be enabled to apply migrations\n\
             \n\
             Add to moose.config.toml:\n\
             [features]\n\
             olap = true"
        );
    }

    let client = create_client(clickhouse_config.clone());
    check_ready(&client).await?;

    let mut map = current_map.clone();
    let default_database = &clickhouse_config.db_name;
    let is_dev = !project.is_production;

    for file in &unapplied {
        // Validate parent state hash before applying — fail rather than apply
        // against stale state, which could silently corrupt the database.
        if let Err(e) = file.validate_parent_hash(&map.olap_hash()) {
            println!(
                "\n❌ Migration '{}' cannot be applied: database state has diverged from\n\
                 what this migration was generated against.\n",
                file.id
            );

            // Best-effort forensics: diff the fold of applied migrations (what the
            // log says should be in the DB) against the live map (what is in the DB).
            // If reconstruction fails we swallow the error — the hash mismatch is
            // still the authoritative failure; drift is just explanatory.
            match history.reconstruct_olap_map_for_applied(default_database, &applied) {
                Ok(expected_map) => {
                    let drift =
                        crate::framework::core::migration_file::compute_drift(&expected_map, &map);
                    if !drift.is_empty() {
                        println!("Detected drift between migration log and database:");
                        println!();
                        print!("{}", drift);
                        println!();
                    }
                }
                Err(reconstruct_err) => {
                    tracing::debug!(
                        "Could not reconstruct expected state for drift analysis: {}",
                        reconstruct_err
                    );
                }
            }

            println!("This could happen if:");
            println!("  • Another developer applied migrations to this database");
            println!("  • Manual DDL was run against the database");
            println!("  • This migration is stale\n");
            println!("To resolve, regenerate the migration against the current database state:");
            println!("  moose generate migration --clickhouse-url <url>\n");
            return Err(e.into());
        }

        println!(
            "\n▶ Applying migration '{}' ({} delta(s))...",
            file.id,
            file.deltas.len()
        );

        for (idx, delta) in file.deltas.iter().enumerate() {
            println!("  [{}/{}] {}", idx + 1, file.deltas.len(), delta.summary());

            // Lower delta to atomic operations using current map state
            let ops = delta.to_atomic_operations(&map, default_database);
            for op in &ops {
                let serializable = op.to_minimal();
                if let Err(e) = crate::infrastructure::olap::clickhouse::execute_atomic_operation(
                    default_database,
                    &serializable,
                    &client,
                    is_dev,
                )
                .await
                {
                    print!("{}", format_partial_delta_failure(file, idx));
                    return Err(e.into());
                }
            }

            // Apply delta to map (fold step)
            delta
                .apply(&mut map, default_database)
                .map_err(|e| anyhow::anyhow!("Failed to apply delta to map: {}", e))?;
        }

        // Record this migration as applied (both in remote storage and local list
        // so drift forensics for a later hash-mismatch include this file's changes).
        state_storage.store_applied_migration(&file.id).await?;
        applied.push(file.id.clone());
        println!("  ✓ Migration '{}' applied successfully", file.id);
    }

    // Store the final map state
    state_storage.store_infrastructure_map(&map).await?;

    println!("\n✓ All migration deltas applied successfully");
    Ok(())
}

/// Execute migration plan from CLI (moose migrate command)
pub async fn execute_migration(
    project: &Project,
    redis_url: Option<&str>,
) -> Result<(), RoutineFailure> {
    let clickhouse_config = &project.clickhouse_config;

    // Build state storage based on config
    let state_storage = StateStorageBuilder::from_config(project)
        .clickhouse_config(Some(clickhouse_config.clone()))
        .redis_url(redis_url.map(String::from))
        .build()
        .await
        .map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "State Storage".to_string(),
                    "Failed to build state storage".to_string(),
                ),
                e,
            )
        })?;

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
        // Load target state from current code first—we need its resource IDs to
        // correctly filter which unmapped ClickHouse objects to adopt during
        // reconciliation.  Without this, a fresh Redis (no stored state) would
        // produce an empty filter, causing reconciliation to ignore every
        // pre-existing table and the drift check to report them all as "removed".
        let target_infra_map = InfrastructureMap::load_from_user_code(project, true)
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

        // Load current state from state storage and reconcile with reality
        let current_infra_map = state_storage
            .load_infrastructure_map()
            .await
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "State".to_string(),
                        "Failed to load infrastructure state".to_string(),
                    ),
                    e,
                )
            })?
            .unwrap_or_else(|| InfrastructureMap::empty_from_project(project));

        let current_infra_map = if project.features.olap {
            let filter = ReconciliationFilter::from_infra_map(&target_infra_map);
            let olap_client = create_client(clickhouse_config.clone());

            reconcile_with_reality(project, &current_infra_map, &filter, olap_client)
                .await
                .map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Reconciliation".to_string(),
                            "Failed to reconcile state with ClickHouse reality".to_string(),
                        ),
                        e,
                    )
                })?
        } else {
            current_infra_map
        };

        if project.features.migrate_with_deltas {
            // Delta-based migration path
            execute_migration_deltas(
                project,
                clickhouse_config,
                &current_infra_map,
                state_storage.as_ref(),
            )
            .await
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "\nMigration".to_string(),
                        "Failed to execute migration deltas".to_string(),
                    ),
                    e,
                )
            })?;
        } else {
            // Legacy plan.yaml migration path
            execute_migration_plan(
                project,
                clickhouse_config,
                &current_infra_map,
                &target_infra_map,
                state_storage.as_ref(),
            )
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
        }

        Ok(())
    }
    .await;

    // Always release lock explicitly before returning
    // This ensures cleanup happens even if any operation above failed
    if let Err(e) = state_storage.release_migration_lock().await {
        tracing::warn!("Failed to release migration lock: {}", e);
    }

    result
}

/// Execute pre-planned migration
///
/// It validates the plan and executes it if valid. After successful execution,
/// it saves the new infrastructure state.
pub async fn execute_migration_plan(
    project: &Project,
    clickhouse_config: &ClickHouseConfig,
    current_infra_map: &InfrastructureMap,
    target_infra_map: &InfrastructureMap,
    state_storage: &dyn StateStorage,
) -> Result<()> {
    println!("Executing migration plan...");

    // Load migration files, re-keying tables to the current project's db_name
    let files = load_migration_files(&clickhouse_config.db_name)?;

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
        &current_infra_map.tables,
        &files.state_before.tables,
        &target_infra_map.tables,
        &current_infra_map.olap_dictionaries,
        &files.state_before.olap_dictionaries,
        &target_infra_map.olap_dictionaries,
        &project.migration_config.ignore_operations,
    );

    match drift {
        DriftStatus::NoDrift => {
            println!("  ✓ Current = Expected (no drift detected)");

            // Check target matches code (tables and dictionaries).
            // Uses plan_target_matches_code() which strips metadata before comparing,
            // so reorganising source files without schema changes won't false-bail.
            // Forwards ignore_operations so fields the project deliberately ignores
            // (e.g. ModifyPartitionBy) do not cause a spurious "regenerate" bail-out.
            if !plan_target_matches_code(
                &files.state_after.tables,
                &target_infra_map.tables,
                &files.state_after.olap_dictionaries,
                &target_infra_map.olap_dictionaries,
                &project.migration_config.ignore_operations,
            ) {
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
            let client = create_client(clickhouse_config.clone());
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
    use crate::framework::core::infrastructure::table::{
        Column, ColumnType, OrderBy, TableProjection,
    };
    use crate::framework::core::infrastructure_map::PrimitiveSignature;
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    /// Fake credential used in tests to simulate a real password stored in live infra.
    /// Named explicitly so CodeQL does not flag it as a hard-coded secret.
    const TEST_DICT_PW: &str = "test-credential";

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
                codec: None,
                materialized: None,
                alias: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            indexes: vec![],
            projections: vec![],
            constraints: vec![],
            version: None,
            source_primitive: PrimitiveSignature {
                name: name.to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            engine: ClickhouseEngine::MergeTree,
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
            seed_filter: Default::default(),
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
            codec: None,
            materialized: None,
            alias: None,
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

        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
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

        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
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

        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
        match result {
            DriftStatus::DriftDetected {
                extra_tables,
                missing_tables,
                changed_tables,
                ..
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

        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
        match result {
            DriftStatus::DriftDetected {
                extra_tables,
                missing_tables,
                changed_tables,
                ..
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

        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
        match result {
            DriftStatus::DriftDetected {
                extra_tables,
                missing_tables,
                changed_tables,
                ..
            } => {
                assert!(extra_tables.is_empty());
                assert!(missing_tables.is_empty());
                assert_eq!(changed_tables, vec!["users".to_string()]);
            }
            _ => panic!("Expected DriftDetected"),
        }
    }

    #[test]
    fn test_changed_tables_between_uses_specified_pair() {
        let mut current = HashMap::new();
        current.insert("users".to_string(), create_modified_table("users"));
        current.insert("posts".to_string(), create_test_table("posts"));

        let mut expected = HashMap::new();
        expected.insert("users".to_string(), create_test_table("users"));
        expected.insert("posts".to_string(), create_test_table("posts"));

        let mut target = HashMap::new();
        target.insert("users".to_string(), create_modified_table("users"));
        target.insert("posts".to_string(), create_modified_table("posts"));

        let changed_vs_expected = changed_tables_between(&current, &expected);
        let changed_vs_target = changed_tables_between(&current, &target);

        assert_eq!(changed_vs_expected, vec!["users".to_string()]);
        assert_eq!(changed_vs_target, vec!["posts".to_string()]);
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

        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
        match result {
            DriftStatus::DriftDetected {
                extra_tables,
                missing_tables,
                changed_tables,
                ..
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

        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
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
        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
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
        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
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
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
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
        let result = detect_drift(
            &current,
            &expected,
            &target,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[],
        );
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
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
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
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &[IgnorableOperation::ModifyTableTtl],
        );
        match result {
            DriftStatus::DriftDetected { changed_tables, .. } => {
                assert_eq!(changed_tables, vec!["users".to_string()]);
            }
            _ => panic!("Expected drift to be detected due to structural change (extra column)"),
        }
    }

    #[test]
    fn test_validate_table_databases_valid() {
        let table = create_test_table("users");
        let operations = vec![SerializableOlapOperation::CreateTable {
            table: table.clone(),
        }];

        // Primary database matches - should pass
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);
        assert!(result.is_ok());

        // Database in additional_databases - should pass
        let mut table_analytics = table.clone();
        table_analytics.database = Some("analytics".to_string());
        let operations = vec![SerializableOlapOperation::CreateTable {
            table: table_analytics,
        }];
        let result = validate_table_databases_and_clusters(
            &operations,
            "local",
            &["analytics".to_string()],
            &None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_table_databases_invalid() {
        let mut table = create_test_table("users");
        table.database = Some("unconfigured_db".to_string());

        let operations = vec![SerializableOlapOperation::CreateTable { table }];

        // Database not in config - should fail
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("unconfigured_db"));
        assert!(err.contains("moose.config.toml"));
    }

    #[test]
    fn test_validate_table_databases_all_operation_types() {
        // Test that all operation types with database fields are validated
        let operations = vec![
            SerializableOlapOperation::DropTable {
                table: "test".to_string(),
                database: Some("bad_db".to_string()),
                cluster_name: None,
            },
            SerializableOlapOperation::AddTableColumn {
                table: "test".to_string(),
                column: Column {
                    name: "new_col".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                    alias: None,
                },
                after_column: None,
                database: Some("bad_db".to_string()),
                cluster_name: None,
            },
            SerializableOlapOperation::ModifyTableColumn {
                table: "test".to_string(),
                before_column: Column {
                    name: "col".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                    alias: None,
                },
                after_column: Column {
                    name: "col".to_string(),
                    data_type: ColumnType::BigInt,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                    alias: None,
                },
                database: Some("another_bad_db".to_string()),
                cluster_name: None,
            },
            SerializableOlapOperation::AddTableProjection {
                table: "test".to_string(),
                projection: TableProjection {
                    name: "proj_by_user".to_string(),
                    body: "SELECT * ORDER BY user_id".to_string(),
                },
                database: Some("proj_bad_db".to_string()),
                cluster_name: None,
            },
            SerializableOlapOperation::DropTableProjection {
                table: "test".to_string(),
                projection_name: "proj_by_user".to_string(),
                database: Some("proj_drop_bad_db".to_string()),
                cluster_name: None,
            },
        ];

        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        // Should report all bad databases
        assert!(err.contains("bad_db"));
        assert!(err.contains("another_bad_db"));
        assert!(err.contains("proj_bad_db"));
        assert!(err.contains("proj_drop_bad_db"));
    }

    #[test]
    fn test_validate_table_databases_raw_sql_ignored() {
        // RawSql operations should not be validated
        let operations = vec![SerializableOlapOperation::RawSql {
            sql: vec!["SELECT 1".to_string()],
            description: "test".to_string(),
        }];

        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_cluster_valid() {
        let mut table = create_test_table("users");
        table.cluster_name = Some("my_cluster".to_string());

        let operations = vec![SerializableOlapOperation::CreateTable {
            table: table.clone(),
        }];

        let clusters = Some(vec![ClusterConfig {
            name: "my_cluster".to_string(),
        }]);

        // Cluster is configured - should pass
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &clusters);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_cluster_invalid() {
        let mut table = create_test_table("users");
        table.cluster_name = Some("unconfigured_cluster".to_string());

        let operations = vec![SerializableOlapOperation::CreateTable { table }];

        let clusters = Some(vec![
            ClusterConfig {
                name: "my_cluster".to_string(),
            },
            ClusterConfig {
                name: "another_cluster".to_string(),
            },
        ]);

        // Cluster not in config - should fail and show available clusters
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &clusters);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("unconfigured_cluster"),
            "Error should mention the invalid cluster"
        );
        assert!(
            err.contains("moose.config.toml"),
            "Error should reference config file"
        );
    }

    #[test]
    fn test_validate_cluster_no_clusters_configured() {
        let mut table = create_test_table("users");
        table.cluster_name = Some("some_cluster".to_string());

        let operations = vec![SerializableOlapOperation::CreateTable { table }];

        // No clusters configured but table references one - should fail
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("some_cluster"));
    }

    #[test]
    fn test_validate_both_database_and_cluster_invalid() {
        let mut table = create_test_table("users");
        table.database = Some("bad_db".to_string());
        table.cluster_name = Some("bad_cluster".to_string());

        let operations = vec![SerializableOlapOperation::CreateTable { table }];

        let clusters = Some(vec![ClusterConfig {
            name: "good_cluster".to_string(),
        }]);

        // Both database and cluster invalid - should report both errors
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &clusters);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("bad_db"));
        assert!(err.contains("bad_cluster"));
    }

    #[test]
    fn test_validate_cluster_in_drop_table_operation() {
        let operations = vec![SerializableOlapOperation::DropTable {
            table: "users".to_string(),
            database: None,
            cluster_name: Some("unconfigured_cluster".to_string()),
        }];

        let clusters = Some(vec![ClusterConfig {
            name: "my_cluster".to_string(),
        }]);

        // DropTable with invalid cluster - should fail
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &clusters);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("unconfigured_cluster"));
    }

    #[test]
    fn test_validate_cluster_macro_syntax_passes_without_config() {
        // ClickHouse macro cluster names like `{cluster}` must be allowed
        // even when no clusters are configured in moose.config.toml, because
        // they are resolved by ClickHouse at runtime.
        let mut table = create_test_table("users");
        table.cluster_name = Some("{cluster}".to_string());

        let operations = vec![SerializableOlapOperation::CreateTable { table }];

        // No clusters configured — {cluster} macro should still pass
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);
        assert!(result.is_ok(), "ClickHouse macro cluster name should pass");
    }

    #[test]
    fn test_validate_cluster_malformed_macro_rejected() {
        let mut table = create_test_table("users");
        table.cluster_name = Some("}{".to_string()); // malformed macro

        let operations = vec![SerializableOlapOperation::CreateTable { table }];

        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);
        assert!(result.is_err(), "Malformed macro cluster name should fail");
    }

    #[test]
    fn test_validate_projection_cluster_invalid() {
        let clusters = Some(vec![ClusterConfig {
            name: "my_cluster".to_string(),
        }]);

        // AddTableProjection with invalid cluster
        let operations = vec![SerializableOlapOperation::AddTableProjection {
            table: "events".to_string(),
            projection: TableProjection {
                name: "proj_by_user".to_string(),
                body: "SELECT * ORDER BY user_id".to_string(),
            },
            database: None,
            cluster_name: Some("bad_cluster".to_string()),
        }];

        let result = validate_table_databases_and_clusters(&operations, "local", &[], &clusters);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("bad_cluster"),
            "Error should mention the invalid cluster: {err}"
        );

        // DropTableProjection with invalid cluster
        let operations = vec![SerializableOlapOperation::DropTableProjection {
            table: "events".to_string(),
            projection_name: "proj_by_user".to_string(),
            database: None,
            cluster_name: Some("another_bad_cluster".to_string()),
        }];

        let result = validate_table_databases_and_clusters(&operations, "local", &[], &clusters);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("another_bad_cluster"),
            "Error should mention the invalid cluster: {err}"
        );
    }

    #[test]
    fn test_format_partial_delta_failure_shows_applied_failed_and_remaining() {
        use crate::framework::core::infra_delta::InfraDelta;
        use crate::framework::core::migration_file::MigrationFile;

        let t1 = create_test_table("tbl_one");
        let t2 = create_test_table("tbl_two");
        let t3 = create_test_table("tbl_three");

        let file = MigrationFile {
            id: "20260406_150000_multi_delta".to_string(),
            description: "multi-delta migration".to_string(),
            parent_state_hash: "abc".to_string(),
            deltas: vec![
                InfraDelta::CreateTable { table: t1 },
                InfraDelta::CreateTable { table: t2 },
                InfraDelta::CreateTable { table: t3 },
            ],
            created_at: chrono::Utc::now(),
        };

        // Middle delta failed (index 1 = "delta 2 of 3")
        let output = format_partial_delta_failure(&file, 1);

        // Identifies the failing migration and position
        assert!(
            output.contains("20260406_150000_multi_delta"),
            "output should include migration ID:\n{output}"
        );
        assert!(
            output.contains("2/3"),
            "output should show failed delta position (2/3):\n{output}"
        );

        // Summarizes what was executed before the failure (tbl_one, delta 1)
        assert!(
            output.contains("tbl_one"),
            "output should include the succeeded delta's table:\n{output}"
        );
        // Summarizes the failed delta (tbl_two)
        assert!(
            output.contains("tbl_two"),
            "output should include the failed delta's table:\n{output}"
        );
        // Summarizes the not-attempted delta (tbl_three)
        assert!(
            output.contains("tbl_three"),
            "output should include the not-attempted delta's table:\n{output}"
        );

        // Warns about re-running (so users don't naively retry)
        let lower = output.to_lowercase();
        assert!(
            lower.contains("re-run")
                || lower.contains("rerun")
                || lower.contains("retry")
                || lower.contains("re-apply"),
            "output should warn about the dangers of naive re-run:\n{output}"
        );

        // Provides recovery guidance
        assert!(
            lower.contains("recovery") || lower.contains("next steps"),
            "output should include recovery guidance:\n{output}"
        );
    }

    // ─── T1a: dictionary drift detection ──────────────────────────────────────

    /// Build an OlapDictionary with an external ClickHouse source using the given credentials.
    fn make_external_ch_dict(name: &str, user: &str, password: &str) -> OlapDictionary {
        use crate::infrastructure::olap::clickhouse::dictionary::{
            DictionaryClickHouseSource, DictionarySource, ExternalDictionarySource,
        };
        let mut dict = create_test_dict(name);
        dict.source = DictionarySource::External(ExternalDictionarySource::ClickHouse(
            DictionaryClickHouseSource {
                host: "remotehost".to_string(),
                port: 9000,
                user: user.to_string(),
                password: password.to_string(),
                db: "remote_db".to_string(),
                table: "remote_table".to_string(),
                query: None,
                where_clause: None,
                invalidate_query: None,
            },
        ));
        dict
    }

    // Regression: when state_before was saved with masked credentials (CREDENTIAL_PLACEHOLDER)
    // but the live infra map has real credentials, detect_drift must return NoDrift — not
    // DriftDetected — because credentials should be normalized out before comparison.
    #[test]
    fn test_detect_drift_no_false_drift_when_expected_has_masked_credentials() {
        use crate::utilities::secrets::CREDENTIAL_PLACEHOLDER;

        let tables: HashMap<String, Table> = HashMap::new();

        // expected_dicts = loaded from state_before JSON.
        // mask_credentials_for_json_export masks only passwords, NOT usernames.
        // So the realistic state_before JSON has: user = "admin" (plain-text), password = PLACEHOLDER.
        let mut expected_dicts = HashMap::new();
        expected_dicts.insert(
            "ext_dict".to_string(),
            make_external_ch_dict("ext_dict", "admin", CREDENTIAL_PLACEHOLDER),
        );

        // current_dicts = from current infra map with real credentials
        let mut current_dicts = HashMap::new();
        current_dicts.insert(
            "ext_dict".to_string(),
            make_external_ch_dict("ext_dict", "admin", TEST_DICT_PW),
        );

        // target_dicts = also from code with real credentials
        let target_dicts = current_dicts.clone();

        let result = detect_drift(
            &tables,
            &tables,
            &tables,
            &current_dicts,
            &expected_dicts,
            &target_dicts,
            &[],
        );
        assert!(
            matches!(result, DriftStatus::NoDrift),
            "Password-only differences between state_before and live state must not cause false drift"
        );
    }

    // When the DB was externally changed (schema AND credentials differ from expected),
    // drift must still be detected even though credentials are normalized away.
    //
    // Scenario: plan was created with DB in Hashed layout (expected has PLACEHOLDER creds + Hashed).
    // The DB was externally switched to Flat (current has real creds + Flat).
    // Target (code) still wants Hashed. → DriftDetected.
    #[test]
    fn test_detect_drift_still_detected_when_db_schema_changed_externally() {
        use crate::infrastructure::olap::clickhouse::dictionary::DictionaryLayout;
        use crate::utilities::secrets::CREDENTIAL_PLACEHOLDER;

        let tables: HashMap<String, Table> = HashMap::new();

        // expected = state_before snapshot: DB had Hashed layout, credentials masked.
        // mask_credentials_for_json_export only masks passwords, NOT usernames —
        // usernames are stored in plain-text in the persisted JSON.
        let mut expected_dicts = HashMap::new();
        expected_dicts.insert(
            "ext_dict".to_string(),
            make_external_ch_dict("ext_dict", "admin", CREDENTIAL_PLACEHOLDER),
        );
        // (expected layout stays Hashed from create_test_dict default)

        // current = DB was externally changed to Flat (schema changed — true drift)
        let mut current_dict = make_external_ch_dict("ext_dict", "admin", TEST_DICT_PW);
        current_dict.layout = DictionaryLayout::Flat;
        let mut current_dicts = HashMap::new();
        current_dicts.insert("ext_dict".to_string(), current_dict);

        // target = code still wants Hashed (same as what the plan targeted)
        let target_dicts = expected_dicts.clone(); // same layout as expected (Hashed)

        let result = detect_drift(
            &tables,
            &tables,
            &tables,
            &current_dicts,
            &expected_dicts,
            &target_dicts,
            &[],
        );
        assert!(
            matches!(result, DriftStatus::DriftDetected { .. }),
            "Schema drift (Flat vs Hashed) must still be detected even when credentials are normalized"
        );
    }

    fn create_test_dict(name: &str) -> OlapDictionary {
        use crate::infrastructure::olap::clickhouse::dictionary::{
            DictionaryColumn, DictionaryLayout, DictionaryLifetime, DictionarySource,
            DictionaryTableSource,
        };
        OlapDictionary {
            name: name.to_string(),
            database: None,
            cluster_name: None,
            source: DictionarySource::Table(DictionaryTableSource {
                table: "src".to_string(),
                database: None,
                where_clause: None,
                invalidate_query: None,
            }),
            primary_key: vec!["id".to_string()],
            columns: vec![DictionaryColumn {
                name: "id".to_string(),
                type_string: "UInt64".to_string(),
                default_value: None,
                expression: None,
                is_injective: None,
                is_hierarchical: None,
                is_object_id: None,
                comment: None,
            }],
            layout: DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
            lifetime: DictionaryLifetime::Single { seconds: 3600 },
            invalidate_query: None,
            settings: HashMap::new(),
            comment: None,
            life_cycle: LifeCycle::FullyManaged,
            version: None,
            metadata: None,
        }
    }

    #[test]
    fn test_detect_drift_extra_dict_in_current() {
        // current has an extra dictionary not in expected → DriftDetected
        let tables: HashMap<String, Table> = HashMap::new();
        let mut current_dicts = HashMap::new();
        current_dicts.insert("dict_a".to_string(), create_test_dict("dict_a"));
        let expected_dicts: HashMap<String, OlapDictionary> = HashMap::new();
        let target_dicts: HashMap<String, OlapDictionary> = HashMap::new();

        let result = detect_drift(
            &tables,
            &tables,
            &tables,
            &current_dicts,
            &expected_dicts,
            &target_dicts,
            &[],
        );
        match result {
            DriftStatus::DriftDetected {
                extra_dicts,
                missing_dicts,
                ..
            } => {
                assert_eq!(extra_dicts, vec!["dict_a".to_string()]);
                assert!(missing_dicts.is_empty());
            }
            _ => panic!("Expected DriftDetected"),
        }
    }

    #[test]
    fn test_detect_drift_missing_dict_in_current() {
        // expected has a dictionary that is absent in current → DriftDetected
        // (target also has it, so current != target → not AlreadyAtTarget)
        let tables: HashMap<String, Table> = HashMap::new();
        let current_dicts: HashMap<String, OlapDictionary> = HashMap::new();
        let mut expected_dicts = HashMap::new();
        expected_dicts.insert("dict_b".to_string(), create_test_dict("dict_b"));
        let target_dicts = expected_dicts.clone();

        let result = detect_drift(
            &tables,
            &tables,
            &tables,
            &current_dicts,
            &expected_dicts,
            &target_dicts,
            &[],
        );
        match result {
            DriftStatus::DriftDetected {
                extra_dicts,
                missing_dicts,
                ..
            } => {
                assert!(extra_dicts.is_empty());
                assert_eq!(missing_dicts, vec!["dict_b".to_string()]);
            }
            _ => panic!("Expected DriftDetected"),
        }
    }

    #[test]
    fn test_detect_drift_no_dict_drift_when_dicts_match() {
        // current and expected have the same dictionaries → NoDrift (tables also match)
        let tables: HashMap<String, Table> = HashMap::new();
        let mut dicts = HashMap::new();
        dicts.insert("dict_c".to_string(), create_test_dict("dict_c"));
        let mut target_dicts = dicts.clone();
        target_dicts.insert("dict_d".to_string(), create_test_dict("dict_d"));

        let result = detect_drift(
            &tables,
            &tables,
            &tables,
            &dicts,
            &dicts,
            &target_dicts,
            &[],
        );
        assert!(
            matches!(result, DriftStatus::NoDrift),
            "Expected NoDrift when current == expected dicts"
        );
    }

    /// `detect_drift` must populate `changed_dicts` when a dictionary's content
    /// differs between current and expected (e.g. different layout). Previously
    /// only NoDrift / DriftDetected were asserted; the `changed_dicts` field was
    /// never validated.
    #[test]
    fn test_detect_drift_changed_dict_populates_changed_dicts() {
        use crate::infrastructure::olap::clickhouse::dictionary::DictionaryLayout;
        let tables: HashMap<String, Table> = HashMap::new();

        // expected has Hashed layout
        let mut expected_dict = create_test_dict("dict_x");
        expected_dict.layout = DictionaryLayout::Hashed {
            initial_array_size: None,
            max_load_factor: None,
        };
        let mut expected_dicts = HashMap::new();
        expected_dicts.insert("local_dict_x".to_string(), expected_dict.clone());

        // current has Flat layout (simulating external drift)
        let mut current_dict = create_test_dict("dict_x");
        current_dict.layout = DictionaryLayout::Flat;
        let mut current_dicts = HashMap::new();
        current_dicts.insert("local_dict_x".to_string(), current_dict);

        // target == expected (no changes planned)
        let result = detect_drift(
            &tables,
            &tables,
            &tables,
            &current_dicts,
            &expected_dicts,
            &expected_dicts,
            &[],
        );

        match result {
            DriftStatus::DriftDetected {
                changed_dicts,
                extra_dicts,
                missing_dicts,
                ..
            } => {
                assert_eq!(
                    changed_dicts,
                    vec!["local_dict_x".to_string()],
                    "changed_dicts must contain the modified dictionary key"
                );
                assert!(extra_dicts.is_empty(), "no extra dicts expected");
                assert!(missing_dicts.is_empty(), "no missing dicts expected");
            }
            other => panic!("Expected DriftDetected, got {other:?}"),
        }
    }

    // ─── T1b: validate_table_databases_and_clusters covers dict ops ───────────

    #[test]
    fn test_validate_dict_cluster_invalid() {
        // CreateDictionary with an unconfigured cluster → error
        let clusters = Some(vec![ClusterConfig {
            name: "prod_cluster".to_string(),
        }]);
        let mut dict = create_test_dict("my_dict");
        dict.cluster_name = Some("unknown_cluster".to_string());

        let operations = vec![SerializableOlapOperation::CreateDictionary { dict }];
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &clusters);
        assert!(result.is_err(), "Expected error for invalid cluster");
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("unknown_cluster"),
            "Error should mention the invalid cluster: {err}"
        );
    }

    #[test]
    fn test_format_partial_delta_failure_first_delta_no_succeeded_section() {
        use crate::framework::core::infra_delta::InfraDelta;
        use crate::framework::core::migration_file::MigrationFile;

        let file = MigrationFile {
            id: "20260406_160000_first_fails".to_string(),
            description: "first delta fails".to_string(),
            parent_state_hash: "abc".to_string(),
            deltas: vec![
                InfraDelta::CreateTable {
                    table: create_test_table("only_one"),
                },
                InfraDelta::CreateTable {
                    table: create_test_table("only_two"),
                },
            ],
            created_at: chrono::Utc::now(),
        };

        // First delta (index 0) failed — nothing succeeded
        let output = format_partial_delta_failure(&file, 0);

        assert!(output.contains("1/2"), "should show 1/2:\n{output}");
        // The failed delta's table is present
        assert!(output.contains("only_one"));
        // The not-attempted delta's table is present
        assert!(output.contains("only_two"));

        // When first delta fails, message should say safe to re-run (no DDL executed)
        let lower = output.to_lowercase();
        assert!(
            lower.contains("no") && lower.contains("first delta failed"),
            "first-delta failure should say no DDL was executed:\n{output}"
        );
        // Should NOT mention "0 delta(s)"
        assert!(
            !output.contains("0 delta(s)"),
            "should not say '0 delta(s)' when first delta fails:\n{output}"
        );
    }

    #[test]
    fn test_validate_dict_database_invalid() {
        // ReplaceDictionary with an unconfigured database → error
        let mut dict = create_test_dict("my_dict");
        dict.database = Some("unconfigured_db".to_string());

        let operations = vec![SerializableOlapOperation::ReplaceDictionary { dict }];
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);
        assert!(result.is_err(), "Expected error for invalid database");
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("unconfigured_db"),
            "Error should mention the invalid database: {err}"
        );
    }

    #[test]
    fn test_validate_dict_valid_cluster_passes() {
        // DropDictionary with a configured cluster → ok
        let clusters = Some(vec![ClusterConfig {
            name: "my_cluster".to_string(),
        }]);
        let mut dict = create_test_dict("my_dict");
        dict.cluster_name = Some("my_cluster".to_string());

        let operations = vec![SerializableOlapOperation::DropDictionary { dict }];
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &clusters);
        assert!(result.is_ok(), "Expected Ok for valid cluster");
    }

    // ── plan_target_matches_code ───────────────────────────────────────────────

    /// Regression test: metadata-only difference must NOT trigger a "regenerate plan" bail.
    ///
    /// Before the fix, `files.state_after.olap_dictionaries` was compared directly
    /// against `target_infra_map.olap_dictionaries` without stripping metadata.
    /// A source-file reorganisation (same schema, different `metadata.source.file`)
    /// would produce a false mismatch, incorrectly telling the user to regenerate.
    #[test]
    fn test_plan_target_matches_code_metadata_only_diff_is_ignored() {
        use crate::framework::core::infrastructure::table::{Metadata, SourceLocation};

        let tables: HashMap<String, Table> = HashMap::new();

        let dict_without_metadata = create_test_dict("my_dict");

        let mut dict_with_metadata = create_test_dict("my_dict");
        dict_with_metadata.metadata = Some(Metadata {
            description: Some("some description".to_string()),
            source: Some(SourceLocation {
                file: "/old/path/to/source.ts".to_string(),
            }),
        });

        let mut state_after_dicts = HashMap::new();
        state_after_dicts.insert("my_dict".to_string(), dict_with_metadata);

        let mut code_dicts = HashMap::new();
        code_dicts.insert("my_dict".to_string(), dict_without_metadata);

        // Same schema, different metadata → must match (no false bail-out)
        assert!(
            plan_target_matches_code(&tables, &tables, &state_after_dicts, &code_dicts, &[]),
            "Metadata-only difference should not be treated as a plan/code mismatch"
        );
    }

    #[test]
    fn test_plan_target_matches_code_schema_diff_is_detected() {
        use crate::infrastructure::olap::clickhouse::dictionary::DictionaryLayout;

        let tables: HashMap<String, Table> = HashMap::new();

        let dict_v1 = create_test_dict("my_dict");

        // dict_v2 has a different layout — genuine schema change
        let mut dict_v2 = create_test_dict("my_dict");
        dict_v2.layout = DictionaryLayout::Flat;

        let mut state_after_dicts = HashMap::new();
        state_after_dicts.insert("my_dict".to_string(), dict_v1);

        let mut code_dicts = HashMap::new();
        code_dicts.insert("my_dict".to_string(), dict_v2);

        // Schema changed → must be detected as a mismatch
        assert!(
            !plan_target_matches_code(&tables, &tables, &state_after_dicts, &code_dicts, &[]),
            "Schema difference should be detected as a plan/code mismatch"
        );
    }

    #[test]
    fn test_plan_target_matches_code_identical_is_match() {
        let tables: HashMap<String, Table> = HashMap::new();
        let mut dicts = HashMap::new();
        dicts.insert("my_dict".to_string(), create_test_dict("my_dict"));

        assert!(
            plan_target_matches_code(&tables, &tables, &dicts, &dicts.clone(), &[]),
            "Identical state_after and code should match"
        );
    }

    // ─── strip_dict_metadata: username drift visibility ───────────────────────

    /// Username changes must surface as drift (i.e., not return NoDrift).
    ///
    /// `mask_credentials_for_json_export` leaves usernames in plain-text in the
    /// persisted JSON, so `strip_dict_metadata` must NOT normalise them to
    /// CREDENTIAL_PLACEHOLDER — otherwise a username change is invisible.
    ///
    /// When the DB already reflects the new username (user changed in code AND in DB),
    /// the result is `AlreadyAtTarget` (plan is stale, DB is already correct).
    /// When the plan was generated with the old username but the DB still has the
    /// old username, the result is `DriftDetected`. Either way it must not be `NoDrift`.
    #[test]
    fn test_detect_drift_username_change_is_not_invisible() {
        use crate::utilities::secrets::CREDENTIAL_PLACEHOLDER;

        let tables: HashMap<String, Table> = HashMap::new();

        // expected = state_before: original user "alice", password masked (realistic state_before)
        let mut expected_dicts = HashMap::new();
        expected_dicts.insert(
            "ext_dict".to_string(),
            make_external_ch_dict("ext_dict", "alice", CREDENTIAL_PLACEHOLDER),
        );

        // current = live infra: user changed to "bob", real password
        let mut current_dicts = HashMap::new();
        current_dicts.insert(
            "ext_dict".to_string(),
            make_external_ch_dict("ext_dict", "bob", TEST_DICT_PW),
        );

        // target = code now uses "bob" (username updated in code too)
        let target_dicts = current_dicts.clone();

        let result = detect_drift(
            &tables,
            &tables,
            &tables,
            &current_dicts,
            &expected_dicts,
            &target_dicts,
            &[],
        );
        // AlreadyAtTarget is also acceptable — plan is stale but DB is already correct.
        // The key invariant is that it must NOT be NoDrift (which would silently ignore
        // a username change and proceed with a stale migration plan).
        assert!(
            !matches!(result, DriftStatus::NoDrift),
            "Username change (alice → bob) must not produce NoDrift — got {:?}",
            result
        );
    }

    // ─── validate_table_databases_and_clusters: malformed macro error message ─

    /// A malformed macro cluster name must produce an error that mentions the
    /// macro syntax rules, not a generic "cluster not configured" message.
    #[test]
    fn test_validate_cluster_malformed_macro_error_message_mentions_rules() {
        use crate::utilities::constants::CLICKHOUSE_MACRO_CLUSTER_NAME_RULES;

        let mut table = create_test_table("events");
        table.cluster_name = Some("}{".to_string()); // malformed macro

        let operations = vec![SerializableOlapOperation::CreateTable { table }];
        let result = validate_table_databases_and_clusters(&operations, "local", &[], &None);

        assert!(result.is_err(), "Malformed macro should produce an error");
        let err = result.unwrap_err().to_string();
        // Error must mention the resource and the bad cluster value
        assert!(
            err.contains("}{"),
            "Error should include the malformed cluster name: {err}"
        );
        // Error must contain rule guidance, not "not configured in moose.config.toml"
        let rules_excerpt = &CLICKHOUSE_MACRO_CLUSTER_NAME_RULES[..40]; // first 40 chars
        assert!(
            err.contains(rules_excerpt),
            "Error should include CLICKHOUSE_MACRO_CLUSTER_NAME_RULES guidance: {err}"
        );
        assert!(
            !err.contains("not configured in moose.config.toml"),
            "Malformed macro error should not say 'not configured in moose.config.toml': {err}"
        );
    }
}
