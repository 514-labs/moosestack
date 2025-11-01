//! ClickHouse-specific table diffing strategy
//!
//! This module implements the TableDiffStrategy for ClickHouse, handling the database's
//! specific limitations around schema changes. ClickHouse has restrictions on certain
//! ALTER TABLE operations, particularly around ORDER BY and primary key changes.

use crate::framework::core::infrastructure::sql_resource::SqlResource;
use crate::framework::core::infrastructure::table::{
    Column, ColumnType, DataEnum, EnumValue, Table,
};
use crate::framework::core::infrastructure_map::{
    ColumnChange, OlapChange, OrderByChange, TableChange, TableDiffStrategy,
};
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
use std::collections::HashMap;

/// Generates a formatted error message for database field changes.
///
/// This function creates a user-friendly error message explaining that database field
/// changes require manual intervention to prevent data loss.
///
/// # Arguments
/// * `table_name` - The name of the table being changed
/// * `before_db` - The original database name (or "<default>" if None)
/// * `after_db` - The new database name (or "<default>" if None)
///
/// # Returns
/// A formatted string with migration instructions
fn format_database_change_error(table_name: &str, before_db: &str, after_db: &str) -> String {
    format!(
        "\n\n\
        ERROR: Database field change detected for table '{}'\n\
        \n\
        The database field changed from '{}' to '{}'\n\
        \n\
        Changing the database field is a destructive operation that requires\n\
        manual intervention to ensure data safety.\n\
        \n\
        To migrate this table to a new database:\n\
        \n\
        1. Create a new table definition with the target database\n\
        2. Migrate your data (if needed):\n\
           INSERT INTO {}.{} SELECT * FROM {}.{}\n\
        3. Update your application to use the new table\n\
        4. Delete the old table definition from your code\n\
        \n\
        This ensures you maintain control over data migration and prevents\n\
        accidental data loss.\n",
        table_name, before_db, after_db, after_db, table_name, before_db, table_name
    )
}

/// ClickHouse-specific table diff strategy
///
/// ClickHouse has several limitations that require drop+create operations instead of ALTER:
/// - Cannot change ORDER BY clause via ALTER TABLE
/// - Cannot change primary key structure via ALTER TABLE
/// - Some column type changes are not supported
///
/// This strategy identifies these cases and converts table updates into drop+create operations
/// so that users see the actual operations that will be performed.
pub struct ClickHouseTableDiffStrategy;

/// Checks if two enums are semantically equivalent.
///
/// This is important for ClickHouse because TypeScript string enums (e.g., TEXT = 'text')
/// are stored in ClickHouse as Enum8/Enum16 with integer mappings. When we read them back,
/// we get the string values as member names with integer values (e.g., 'text' = 1).
///
/// This function compares:
/// - For string enums: Checks if the TypeScript enum values match the ClickHouse member names
/// - For integer enums: Direct comparison of values
pub fn enums_are_equivalent(actual: &DataEnum, target: &DataEnum) -> bool {
    // First check if both enums have the same name and values - direct equality
    // This handles the case where metadata has been written and read back
    if actual == target {
        return true;
    }

    // Check if enums have the same number of members
    if actual.values.len() != target.values.len() {
        return false;
    }

    // Check if both enums have string values (both from TypeScript)
    // In this case, the names must match
    let actual_has_string_values = actual
        .values
        .iter()
        .any(|m| matches!(m.value, EnumValue::String(_)));
    let target_has_string_values = target
        .values
        .iter()
        .any(|m| matches!(m.value, EnumValue::String(_)));

    if actual_has_string_values && target_has_string_values && actual.name != target.name {
        // Both are TypeScript enums but with different names
        return false;
    }

    // Check each member
    for (idx, target_member) in target.values.iter().enumerate() {
        match &target_member.value {
            EnumValue::String(target_str) => {
                // For string enums, we have two cases:
                //
                // Case 1: Target is from TypeScript, Actual is from ClickHouse without metadata
                // - target has: name: "TEXT" (TypeScript member name), value: "text" (TypeScript string value)
                // - actual has: name: "text" (the string stored in ClickHouse), value: Int(1) (the integer mapping)
                //
                // Case 2: Both are from TypeScript (metadata has been written and read back)
                // - Both have the same structure with string values

                if let Some(actual_member) = actual.values.get(idx) {
                    match &actual_member.value {
                        EnumValue::String(actual_str) => {
                            // Both have string values - they should match exactly
                            if actual_member.name != target_member.name || actual_str != target_str
                            {
                                return false;
                            }
                        }
                        EnumValue::Int(_) => {
                            // Actual has int, target has string - check cross-mapping
                            // The actual member name should match the target string value
                            if actual_member.name != *target_str {
                                return false;
                            }
                        }
                    }
                } else {
                    return false;
                }
            }
            EnumValue::Int(target_int) => {
                // For integer enums, we need exact match
                if let Some(actual_member) = actual.values.get(idx) {
                    // Names should match
                    if actual_member.name != target_member.name {
                        return false;
                    }
                    // Values should match
                    if let EnumValue::Int(actual_int) = actual_member.value {
                        if actual_int != *target_int {
                            return false;
                        }
                    } else {
                        return false;
                    }
                } else {
                    return false;
                }
            }
        }
    }

    true
}

/// Checks if an enum needs metadata comment to be added.
///
/// Returns true if the enum appears to be from a TypeScript string enum
/// that was stored without metadata (i.e., has integer values but member names
/// look like they should be string values).
pub fn should_add_enum_metadata(actual_enum: &DataEnum) -> bool {
    // If the enum name is generic like "Enum8" or "Enum16", it probably needs metadata
    if actual_enum.name.starts_with("Enum") {
        // Check if all values are integers with string-like member names
        actual_enum.values.iter().all(|member| {
            matches!(member.value, EnumValue::Int(_))
                && member.name.chars().any(|c| c.is_lowercase())
            // Member names that look like values (lowercase, snake_case, etc.)
        })
    } else {
        false
    }
}

fn is_special_not_nullable_column_type(t: &ColumnType) -> bool {
    matches!(t, ColumnType::Array { .. } | ColumnType::Nested(_))
}

fn is_only_required_change_for_special_column_type(before: &Column, after: &Column) -> bool {
    // Only ignore if both sides are arrays and all other fields are equal
    if is_special_not_nullable_column_type(&before.data_type)
        && is_special_not_nullable_column_type(&after.data_type)
        && before.required != after.required
    {
        let mut after_cloned = after.clone();
        after_cloned.required = before.required;

        before == &after_cloned
    } else {
        false
    }
}

impl ClickHouseTableDiffStrategy {
    /// Check if a table uses the S3Queue engine
    pub fn is_s3queue_table(table: &Table) -> bool {
        matches!(&table.engine, Some(ClickhouseEngine::S3Queue { .. }))
    }

    /// Check if a SQL resource is a materialized view that needs population
    /// This is ClickHouse-specific logic for handling materialized view initialization
    pub fn check_materialized_view_population(
        sql_resource: &SqlResource,
        tables: &HashMap<String, Table>,
        is_new: bool,
        is_production: bool,
        olap_changes: &mut Vec<OlapChange>,
    ) {
        use crate::infrastructure::olap::clickhouse::sql_parser::parse_create_materialized_view;

        // Check if this is a CREATE MATERIALIZED VIEW statement
        for sql in &sql_resource.setup {
            if let Ok(mv_stmt) = parse_create_materialized_view(sql) {
                // Check if any source is an S3Queue table
                let has_s3queue_source = mv_stmt.source_tables.iter().any(|source| {
                    tables
                        .get(&source.qualified_name())
                        .is_some_and(Self::is_s3queue_table)
                });

                // Skip population in production (user must handle manually)
                // Only populate in dev for new MVs with non-S3Queue sources
                if is_new && !has_s3queue_source && !is_production {
                    log::info!(
                        "Adding population operation for materialized view '{}'",
                        sql_resource.name
                    );

                    olap_changes.push(OlapChange::PopulateMaterializedView {
                        view_name: mv_stmt.view_name,
                        target_table: mv_stmt.target_table,
                        target_database: mv_stmt.target_database,
                        select_statement: mv_stmt.select_statement,
                        source_tables: mv_stmt
                            .source_tables
                            .into_iter()
                            .map(|t| t.qualified_name())
                            .collect(),
                        should_truncate: true,
                    });
                }

                // Only check the first MV statement
                break;
            }
        }
    }
}

impl TableDiffStrategy for ClickHouseTableDiffStrategy {
    /// This function is only called when there are actual changes to the table
    /// (column changes, ORDER BY changes, or deduplication changes).
    /// It determines whether those changes can be handled via ALTER TABLE
    /// or require a drop+create operation.
    fn diff_table_update(
        &self,
        before: &Table,
        after: &Table,
        column_changes: Vec<ColumnChange>,
        order_by_change: OrderByChange,
        default_database: &str,
    ) -> Vec<OlapChange> {
        // Check if ORDER BY has changed
        let order_by_changed = order_by_change.before != order_by_change.after;
        if order_by_changed {
            log::warn!(
                "ClickHouse: ORDER BY changed for table '{}', requiring drop+create",
                before.name
            );
            return vec![
                OlapChange::Table(TableChange::Removed(before.clone())),
                OlapChange::Table(TableChange::Added(after.clone())),
            ];
        }

        // Check if database has changed
        // Note: database: None means "use default database" (from config)
        // Only treat it as a real change if both are Some() and different, OR
        // if one is None and the other is Some(non-default)
        let database_changed = match (&before.database, &after.database) {
            (Some(before_db), Some(after_db)) => before_db != after_db,
            (None, None) => false,
            // If one is None and one is Some(default_database), treat as equivalent
            (None, Some(db)) | (Some(db), None) => db != default_database,
        };

        if database_changed {
            let before_db = before.database.as_deref().unwrap_or(default_database);
            let after_db = after.database.as_deref().unwrap_or(default_database);

            let error_message = format_database_change_error(&before.name, before_db, after_db);

            log::error!("{}", error_message);

            return vec![OlapChange::Table(TableChange::ValidationError {
                table_name: before.name.clone(),
                message: error_message,
                before: Box::new(before.clone()),
                after: Box::new(after.clone()),
            })];
        }

        // Check if PARTITION BY has changed
        if before.partition_by != after.partition_by {
            log::warn!(
                "ClickHouse: PARTITION BY changed for table '{}', requiring drop+create",
                before.name
            );
            return vec![
                OlapChange::Table(TableChange::Removed(before.clone())),
                OlapChange::Table(TableChange::Added(after.clone())),
            ];
        }

        // SAMPLE BY can be modified via ALTER TABLE; do not force drop+create

        // Check if primary key structure has changed
        let before_primary_keys = before.primary_key_columns();
        let after_primary_keys = after.primary_key_columns();
        if before_primary_keys != after_primary_keys
            // S3 allows specifying PK, but that information is not in system.columns
            && after.engine.as_ref().is_none_or(|e| e.is_merge_tree_family())
        {
            log::warn!(
                "ClickHouse: Primary key structure changed for table '{}', requiring drop+create",
                before.name
            );
            return vec![
                OlapChange::Table(TableChange::Removed(before.clone())),
                OlapChange::Table(TableChange::Added(after.clone())),
            ];
        }

        // First check if we can use hash comparison for engine changes
        let engine_changed = if let (Some(before_hash), Some(after_hash)) =
            (&before.engine_params_hash, &after.engine_params_hash)
        {
            // If both tables have hashes, compare them for change detection
            // This includes credentials and other non-alterable parameters
            before_hash != after_hash
        } else {
            // Fallback to direct engine comparison if hashes are not available
            let before_engine = before.engine.as_ref();
            match after.engine.as_ref() {
                // after.engine is unset -> before engine should be same as default
                None => before_engine.is_some_and(|e| *e != ClickhouseEngine::MergeTree),
                // force recreate only if engines are different
                Some(e) => Some(e) != before_engine,
            }
        };

        // Check if engine has changed (using hash comparison when available)
        if engine_changed {
            log::warn!(
                "ClickHouse: engine changed for table '{}', requiring drop+create",
                before.name
            );
            return vec![
                OlapChange::Table(TableChange::Removed(before.clone())),
                OlapChange::Table(TableChange::Added(after.clone())),
            ];
        }

        // Check if only table settings have changed
        if before.table_settings != after.table_settings {
            // List of readonly settings that cannot be modified after table creation
            // Source: ClickHouse/src/Storages/MergeTree/MergeTreeSettings.cpp::isReadonlySetting
            const READONLY_SETTINGS: &[&str] = &[
                "index_granularity",
                "index_granularity_bytes",
                "enable_mixed_granularity_parts",
                "add_minmax_index_for_numeric_columns",
                "add_minmax_index_for_string_columns",
                "table_disk",
            ];

            // Check if any readonly settings have changed
            let empty_settings = HashMap::new();
            let before_settings = before.table_settings.as_ref().unwrap_or(&empty_settings);
            let after_settings = after.table_settings.as_ref().unwrap_or(&empty_settings);

            for readonly_setting in READONLY_SETTINGS {
                let before_value = before_settings.get(*readonly_setting);
                let after_value = after_settings.get(*readonly_setting);

                if before_value != after_value {
                    log::warn!(
                        "ClickHouse: Readonly setting '{}' changed for table '{}' (from {:?} to {:?}), requiring drop+create",
                        readonly_setting,
                        before.name,
                        before_value,
                        after_value
                    );
                    return vec![
                        OlapChange::Table(TableChange::Removed(before.clone())),
                        OlapChange::Table(TableChange::Added(after.clone())),
                    ];
                }
            }

            log::debug!(
                "ClickHouse: Only modifiable table settings changed for table '{}', can use ALTER TABLE MODIFY SETTING",
                before.name
            );
            // Return the explicit SettingsChanged variant for clarity
            return vec![OlapChange::Table(TableChange::SettingsChanged {
                name: before.name.clone(),
                before_settings: before.table_settings.clone(),
                after_settings: after.table_settings.clone(),
                table: after.clone(),
            })];
        }

        // Check if this is an S3Queue table with column changes
        // S3Queue only supports MODIFY/RESET SETTING, not column operations
        if !column_changes.is_empty() {
            if let Some(engine) = &before.engine {
                if matches!(engine, ClickhouseEngine::S3Queue { .. }) {
                    log::warn!(
                        "ClickHouse: S3Queue table '{}' has column changes, requiring drop+create (S3Queue doesn't support ALTER TABLE for columns)",
                        before.name
                    );
                    return vec![
                        OlapChange::Table(TableChange::Removed(before.clone())),
                        OlapChange::Table(TableChange::Added(after.clone())),
                    ];
                }
            }
        }

        // Filter out no-op changes for ClickHouse semantics:
        // Arrays are always NOT NULL in ClickHouse, so a change to `required`
        // on array columns does not reflect an actual DDL change.
        let column_changes: Vec<ColumnChange> = column_changes
            .into_iter()
            .filter(|change| match change {
                ColumnChange::Updated { before, after } => {
                    !is_only_required_change_for_special_column_type(before, after)
                }
                _ => true,
            })
            .collect();

        // For other changes, ClickHouse can handle them via ALTER TABLE.
        // If there are no column/index/sample_by changes, return an empty vector.
        let sample_by_changed = before.sample_by != after.sample_by;
        if column_changes.is_empty() && before.indexes == after.indexes && !sample_by_changed {
            vec![]
        } else {
            vec![OlapChange::Table(TableChange::Updated {
                name: before.name.clone(),
                column_changes,
                order_by_change,
                before: before.clone(),
                after: after.clone(),
            })]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, EnumMember, OrderBy};
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::sql_parser::parse_create_materialized_view;

    fn create_test_table(name: &str, order_by: Vec<String>, deduplicate: bool) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![
                Column {
                    name: "id".to_string(),
                    data_type: ColumnType::String,
                    required: true,
                    unique: false,
                    primary_key: true,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                },
                Column {
                    name: "timestamp".to_string(),
                    data_type: ColumnType::String,
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                },
            ],
            order_by: OrderBy::Fields(order_by),
            partition_by: None,
            sample_by: None,
            engine: deduplicate.then_some(ClickhouseEngine::ReplacingMergeTree {
                ver: None,
                is_deleted: None,
            }),
            version: Some(Version::from_string("1.0.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
        }
    }

    #[test]
    fn test_order_by_change_requires_drop_create() {
        let strategy = ClickHouseTableDiffStrategy;

        let before = create_test_table("test", vec!["id".to_string()], false);
        let after = create_test_table(
            "test",
            vec!["id".to_string(), "timestamp".to_string()],
            false,
        );

        let order_by_change = OrderByChange {
            before: OrderBy::Fields(vec!["id".to_string()]),
            after: OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string()]),
        };

        let changes = strategy.diff_table_update(&before, &after, vec![], order_by_change, "local");

        assert_eq!(changes.len(), 2);
        assert!(matches!(
            changes[0],
            OlapChange::Table(TableChange::Removed(_))
        ));
        assert!(matches!(
            changes[1],
            OlapChange::Table(TableChange::Added(_))
        ));
    }

    #[test]
    fn test_deduplication_change_requires_drop_create() {
        let strategy = ClickHouseTableDiffStrategy;

        let before = create_test_table("test", vec!["id".to_string()], false);
        let after = create_test_table("test", vec!["id".to_string()], true);

        let order_by_change = OrderByChange {
            before: before.order_by.clone(),
            after: after.order_by.clone(),
        };

        let changes = strategy.diff_table_update(&before, &after, vec![], order_by_change, "local");

        assert_eq!(changes.len(), 2);
        assert!(matches!(
            changes[0],
            OlapChange::Table(TableChange::Removed(_))
        ));
        assert!(matches!(
            changes[1],
            OlapChange::Table(TableChange::Added(_))
        ));
    }

    #[test]
    fn test_column_only_changes_use_alter() {
        let strategy = ClickHouseTableDiffStrategy;

        let before = create_test_table("test", vec!["id".to_string()], false);
        let after = create_test_table("test", vec!["id".to_string()], false);

        let column_changes = vec![ColumnChange::Added {
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
            },
            position_after: Some("timestamp".to_string()),
        }];

        let order_by_change = OrderByChange {
            before: before.order_by.clone(),
            after: after.order_by.clone(),
        };

        let changes =
            strategy.diff_table_update(&before, &after, column_changes, order_by_change, "local");

        assert_eq!(changes.len(), 1);
        assert!(matches!(
            changes[0],
            OlapChange::Table(TableChange::Updated { .. })
        ));
    }

    #[test]
    fn test_identical_order_by_with_column_change_uses_alter() {
        let strategy = ClickHouseTableDiffStrategy;

        let before = create_test_table(
            "test",
            vec!["id".to_string(), "timestamp".to_string()],
            false,
        );
        let after = create_test_table(
            "test",
            vec!["id".to_string(), "timestamp".to_string()],
            false,
        );

        // Add a column change to make this a realistic scenario
        let column_changes = vec![ColumnChange::Added {
            column: Column {
                name: "status".to_string(),
                data_type: ColumnType::String,
                required: false,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            position_after: Some("timestamp".to_string()),
        }];

        let order_by_change = OrderByChange {
            before: OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string()]),
            after: OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string()]),
        };

        let changes =
            strategy.diff_table_update(&before, &after, column_changes, order_by_change, "local");

        // With identical ORDER BY but column changes, should use ALTER (not drop+create)
        assert_eq!(changes.len(), 1);
        assert!(matches!(
            changes[0],
            OlapChange::Table(TableChange::Updated { .. })
        ));
    }

    #[test]
    fn test_no_changes_returns_empty_vector() {
        let strategy = ClickHouseTableDiffStrategy;

        let before = create_test_table(
            "test",
            vec!["id".to_string(), "timestamp".to_string()],
            false,
        );
        let after = create_test_table(
            "test",
            vec!["id".to_string(), "timestamp".to_string()],
            false,
        );

        // No column changes
        let column_changes = vec![];

        let order_by_change = OrderByChange {
            before: OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string()]),
            after: OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string()]),
        };

        let changes =
            strategy.diff_table_update(&before, &after, column_changes, order_by_change, "local");

        // With no actual changes, should return empty vector
        assert_eq!(changes.len(), 0);
    }

    #[test]
    fn test_order_by_change_with_no_column_changes_requires_drop_create() {
        let strategy = ClickHouseTableDiffStrategy;

        let before = create_test_table("test", vec!["id".to_string()], false);
        let after = create_test_table("test", vec!["timestamp".to_string()], false);

        // No column changes, but ORDER BY changes
        let column_changes = vec![];
        let order_by_change = OrderByChange {
            before: OrderBy::Fields(vec!["id".to_string()]),
            after: OrderBy::Fields(vec!["timestamp".to_string()]),
        };

        let changes =
            strategy.diff_table_update(&before, &after, column_changes, order_by_change, "local");

        // Should still require drop+create even with no column changes
        assert_eq!(changes.len(), 2);
        assert!(matches!(
            changes[0],
            OlapChange::Table(TableChange::Removed(_))
        ));
        assert!(matches!(
            changes[1],
            OlapChange::Table(TableChange::Added(_))
        ));
    }

    #[test]
    fn test_sample_by_change_requires_drop_create() {
        let strategy = ClickHouseTableDiffStrategy;

        let mut before = create_test_table("test", vec!["id".to_string()], false);
        let mut after = create_test_table("test", vec!["id".to_string()], false);

        // Set different SAMPLE BY values
        before.sample_by = None;
        after.sample_by = Some("id".to_string());

        let order_by_change = OrderByChange {
            before: before.order_by.clone(),
            after: after.order_by.clone(),
        };

        let changes = strategy.diff_table_update(&before, &after, vec![], order_by_change, "local");

        // SAMPLE BY change is handled via ALTER TABLE, expect an Updated change
        assert!(changes
            .iter()
            .any(|c| matches!(c, OlapChange::Table(TableChange::Updated { .. }))));
    }

    #[test]
    fn test_sample_by_modification_requires_drop_create() {
        let strategy = ClickHouseTableDiffStrategy;

        let mut before = create_test_table("test", vec!["id".to_string()], false);
        let mut after = create_test_table("test", vec!["id".to_string()], false);

        // Change SAMPLE BY from one column to another
        before.sample_by = Some("id".to_string());
        after.sample_by = Some("timestamp".to_string());

        let order_by_change = OrderByChange {
            before: before.order_by.clone(),
            after: after.order_by.clone(),
        };

        let changes = strategy.diff_table_update(&before, &after, vec![], order_by_change, "local");

        // SAMPLE BY modification is handled via ALTER TABLE, expect an Updated change
        assert!(changes
            .iter()
            .any(|c| matches!(c, OlapChange::Table(TableChange::Updated { .. }))));
    }

    #[test]
    fn test_database_change_triggers_validation_error() {
        let strategy = ClickHouseTableDiffStrategy;

        let mut before = create_test_table("test", vec!["id".to_string()], false);
        let mut after = create_test_table("test", vec!["id".to_string()], false);

        // Change the database field
        before.database = Some("old_db".to_string());
        after.database = Some("new_db".to_string());

        let order_by_change = OrderByChange {
            before: before.order_by.clone(),
            after: after.order_by.clone(),
        };

        let changes = strategy.diff_table_update(&before, &after, vec![], order_by_change, "local");

        // Should return exactly one ValidationError
        assert_eq!(changes.len(), 1);
        assert!(matches!(
            changes[0],
            OlapChange::Table(TableChange::ValidationError { .. })
        ));

        // Check the error message contains expected information
        if let OlapChange::Table(TableChange::ValidationError {
            table_name,
            message,
            ..
        }) = &changes[0]
        {
            assert_eq!(table_name, "test");
            assert!(message.contains("old_db"));
            assert!(message.contains("new_db"));
            assert!(message.contains("manual intervention"));
        } else {
            panic!("Expected ValidationError variant");
        }
    }

    #[test]
    fn test_database_change_from_none_to_some_triggers_validation_error() {
        let strategy = ClickHouseTableDiffStrategy;

        let mut before = create_test_table("test", vec!["id".to_string()], false);
        let mut after = create_test_table("test", vec!["id".to_string()], false);

        // Change database from None (default) to Some
        before.database = None;
        after.database = Some("new_db".to_string());

        let order_by_change = OrderByChange {
            before: before.order_by.clone(),
            after: after.order_by.clone(),
        };

        let changes = strategy.diff_table_update(&before, &after, vec![], order_by_change, "local");

        // Should return exactly one ValidationError
        assert_eq!(changes.len(), 1);
        assert!(matches!(
            changes[0],
            OlapChange::Table(TableChange::ValidationError { .. })
        ));

        // Check the error message contains expected information
        if let OlapChange::Table(TableChange::ValidationError { message, .. }) = &changes[0] {
            assert!(message.contains("local")); // DEFAULT_DATABASE = "local"
            assert!(message.contains("new_db"));
            assert!(message.contains("manual intervention"));
        } else {
            panic!("Expected ValidationError variant");
        }
    }

    #[test]
    fn test_enums_are_equivalent_string_enum() {
        // TypeScript enum: enum RecordType { TEXT = 'text', EMAIL = 'email', CALL = 'call' }
        let target_enum = DataEnum {
            name: "RecordType".to_string(),
            values: vec![
                EnumMember {
                    name: "TEXT".to_string(),
                    value: EnumValue::String("text".to_string()),
                },
                EnumMember {
                    name: "EMAIL".to_string(),
                    value: EnumValue::String("email".to_string()),
                },
                EnumMember {
                    name: "CALL".to_string(),
                    value: EnumValue::String("call".to_string()),
                },
            ],
        };

        // ClickHouse representation: Enum8('text' = 1, 'email' = 2, 'call' = 3)
        let actual_enum = DataEnum {
            name: "Enum8".to_string(),
            values: vec![
                EnumMember {
                    name: "text".to_string(),
                    value: EnumValue::Int(1),
                },
                EnumMember {
                    name: "email".to_string(),
                    value: EnumValue::Int(2),
                },
                EnumMember {
                    name: "call".to_string(),
                    value: EnumValue::Int(3),
                },
            ],
        };

        assert!(enums_are_equivalent(&actual_enum, &target_enum));
    }

    #[test]
    fn test_enums_are_equivalent_int_enum() {
        // TypeScript enum: enum Status { ACTIVE = 1, INACTIVE = 2 }
        let target_enum = DataEnum {
            name: "Status".to_string(),
            values: vec![
                EnumMember {
                    name: "ACTIVE".to_string(),
                    value: EnumValue::Int(1),
                },
                EnumMember {
                    name: "INACTIVE".to_string(),
                    value: EnumValue::Int(2),
                },
            ],
        };

        // ClickHouse representation with proper metadata
        let actual_enum = DataEnum {
            name: "Status".to_string(),
            values: vec![
                EnumMember {
                    name: "ACTIVE".to_string(),
                    value: EnumValue::Int(1),
                },
                EnumMember {
                    name: "INACTIVE".to_string(),
                    value: EnumValue::Int(2),
                },
            ],
        };

        assert!(enums_are_equivalent(&actual_enum, &target_enum));
    }

    #[test]
    fn test_enums_are_equivalent_both_string() {
        // Test when both enums have string values (metadata has been written and read back)
        let enum1 = DataEnum {
            name: "RecordType".to_string(),
            values: vec![
                EnumMember {
                    name: "TEXT".to_string(),
                    value: EnumValue::String("text".to_string()),
                },
                EnumMember {
                    name: "EMAIL".to_string(),
                    value: EnumValue::String("email".to_string()),
                },
                EnumMember {
                    name: "CALL".to_string(),
                    value: EnumValue::String("call".to_string()),
                },
            ],
        };

        let enum2 = enum1.clone();

        assert!(enums_are_equivalent(&enum1, &enum2));
    }

    #[test]
    fn test_enums_not_equivalent_different_values() {
        let enum1 = DataEnum {
            name: "RecordType".to_string(),
            values: vec![EnumMember {
                name: "TEXT".to_string(),
                value: EnumValue::String("text".to_string()),
            }],
        };

        let enum2 = DataEnum {
            name: "RecordType".to_string(),
            values: vec![EnumMember {
                name: "TEXT".to_string(),
                value: EnumValue::String("different".to_string()),
            }],
        };

        assert!(!enums_are_equivalent(&enum1, &enum2));
    }

    #[test]
    fn test_should_add_enum_metadata() {
        // Enum from ClickHouse without metadata
        let enum_without_metadata = DataEnum {
            name: "Enum8".to_string(),
            values: vec![
                EnumMember {
                    name: "text".to_string(),
                    value: EnumValue::Int(1),
                },
                EnumMember {
                    name: "email".to_string(),
                    value: EnumValue::Int(2),
                },
            ],
        };

        assert!(should_add_enum_metadata(&enum_without_metadata));

        // Enum with proper name (has metadata)
        let enum_with_metadata = DataEnum {
            name: "RecordType".to_string(),
            values: vec![EnumMember {
                name: "TEXT".to_string(),
                value: EnumValue::String("text".to_string()),
            }],
        };

        assert!(!should_add_enum_metadata(&enum_with_metadata));
    }

    #[test]
    fn test_enums_not_equivalent_different_names() {
        // Test that enums with different names are not equivalent
        let enum1 = DataEnum {
            name: "RecordType".to_string(),
            values: vec![EnumMember {
                name: "TEXT".to_string(),
                value: EnumValue::String("text".to_string()),
            }],
        };

        let enum2 = DataEnum {
            name: "DifferentType".to_string(),
            values: vec![EnumMember {
                name: "TEXT".to_string(),
                value: EnumValue::String("text".to_string()),
            }],
        };

        // Even though values match, different names should mean not equivalent
        assert!(!enums_are_equivalent(&enum1, &enum2));
    }

    #[test]
    fn test_enums_not_equivalent_different_member_count() {
        // Test that enums with different member counts are not equivalent
        let enum1 = DataEnum {
            name: "RecordType".to_string(),
            values: vec![EnumMember {
                name: "TEXT".to_string(),
                value: EnumValue::String("text".to_string()),
            }],
        };

        let enum2 = DataEnum {
            name: "RecordType".to_string(),
            values: vec![
                EnumMember {
                    name: "TEXT".to_string(),
                    value: EnumValue::String("text".to_string()),
                },
                EnumMember {
                    name: "EMAIL".to_string(),
                    value: EnumValue::String("email".to_string()),
                },
            ],
        };

        assert!(!enums_are_equivalent(&enum1, &enum2));
    }

    #[test]
    fn test_enums_equivalent_mixed_cases() {
        // Test Case: TypeScript string enum vs ClickHouse after metadata applied
        let typescript_enum = DataEnum {
            name: "RecordType".to_string(),
            values: vec![
                EnumMember {
                    name: "TEXT".to_string(),
                    value: EnumValue::String("text".to_string()),
                },
                EnumMember {
                    name: "EMAIL".to_string(),
                    value: EnumValue::String("email".to_string()),
                },
            ],
        };

        // After metadata is applied and read back
        let metadata_enum = typescript_enum.clone();
        assert!(enums_are_equivalent(&metadata_enum, &typescript_enum));

        // ClickHouse representation without metadata
        let clickhouse_enum = DataEnum {
            name: "Enum8".to_string(),
            values: vec![
                EnumMember {
                    name: "text".to_string(),
                    value: EnumValue::Int(1),
                },
                EnumMember {
                    name: "email".to_string(),
                    value: EnumValue::Int(2),
                },
            ],
        };

        // This is the core fix - TypeScript enum should be equivalent to ClickHouse representation
        assert!(enums_are_equivalent(&clickhouse_enum, &typescript_enum));
    }

    #[test]
    fn test_is_s3queue_table() {
        use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
        use crate::framework::core::partial_infrastructure_map::LifeCycle;
        use std::collections::HashMap;

        let mut table_settings = HashMap::new();
        table_settings.insert("mode".to_string(), "unordered".to_string());

        let s3_table = Table {
            name: "test_s3".to_string(),
            columns: vec![],
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            engine: Some(ClickhouseEngine::S3Queue {
                s3_path: "s3://bucket/path".to_string(),
                format: "JSONEachRow".to_string(),
                compression: None,
                headers: None,
                aws_access_key_id: None,
                aws_secret_access_key: None,
            }),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "test_s3".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: Some(table_settings),
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
        };

        assert!(ClickHouseTableDiffStrategy::is_s3queue_table(&s3_table));

        let regular_table = create_test_table("regular", vec![], false);
        assert!(!ClickHouseTableDiffStrategy::is_s3queue_table(
            &regular_table
        ));
    }

    #[test]
    fn test_parse_materialized_view() {
        let sql = "CREATE MATERIALIZED VIEW test_mv TO target_table AS SELECT * FROM source_table";
        let result = parse_create_materialized_view(sql);

        assert!(result.is_ok());
        let mv_stmt = result.unwrap();
        assert_eq!(mv_stmt.view_name, "test_mv");
        assert_eq!(mv_stmt.target_table, "target_table");
        assert_eq!(mv_stmt.target_database, None);
        assert_eq!(mv_stmt.source_tables.len(), 1);
        assert_eq!(mv_stmt.source_tables[0].table, "source_table");
        assert!(mv_stmt.select_statement.contains("SELECT"));
    }

    #[test]
    fn test_parse_materialized_view_with_backticks() {
        let sql =
            "CREATE MATERIALIZED VIEW `test_mv` TO `target_table` AS SELECT * FROM `source_table`";
        let result = parse_create_materialized_view(sql);

        assert!(result.is_ok());
        let mv_stmt = result.unwrap();
        assert_eq!(mv_stmt.view_name, "test_mv");
        assert_eq!(mv_stmt.target_table, "target_table");
        assert_eq!(mv_stmt.target_database, None);
        assert_eq!(mv_stmt.source_tables.len(), 1);
        assert_eq!(mv_stmt.source_tables[0].table, "source_table");
    }

    #[test]
    fn test_parse_materialized_view_with_database() {
        let sql =
            "CREATE MATERIALIZED VIEW test_mv TO mydb.target_table AS SELECT * FROM source_table";
        let result = parse_create_materialized_view(sql);

        assert!(result.is_ok());
        let mv_stmt = result.unwrap();
        assert_eq!(mv_stmt.view_name, "test_mv");
        assert_eq!(mv_stmt.target_table, "target_table");
        assert_eq!(mv_stmt.target_database, Some("mydb".to_string()));
        assert_eq!(mv_stmt.source_tables.len(), 1);
        assert_eq!(mv_stmt.source_tables[0].table, "source_table");
    }

    #[test]
    fn test_parse_materialized_view_with_database_backticks() {
        let sql = "CREATE MATERIALIZED VIEW `test_mv` TO `mydb`.`target_table` AS SELECT * FROM `source_table`";
        let result = parse_create_materialized_view(sql);

        assert!(result.is_ok());
        let mv_stmt = result.unwrap();
        assert_eq!(mv_stmt.view_name, "test_mv");
        assert_eq!(mv_stmt.target_table, "target_table");
        assert_eq!(mv_stmt.target_database, Some("mydb".to_string()));
        assert_eq!(mv_stmt.source_tables.len(), 1);
        assert_eq!(mv_stmt.source_tables[0].table, "source_table");
    }

    #[test]
    fn test_format_database_change_error_basic() {
        let error_msg = format_database_change_error("users", "local", "analytics");

        // Check that all the expected components are present
        assert!(error_msg.contains("ERROR: Database field change detected for table 'users'"));
        assert!(error_msg.contains("The database field changed from 'local' to 'analytics'"));
        assert!(error_msg.contains("INSERT INTO analytics.users SELECT * FROM local.users"));
    }

    #[test]
    fn test_format_database_change_error_with_default() {
        let error_msg = format_database_change_error("events", "<default>", "archive");

        // Check handling of default database
        assert!(error_msg.contains("ERROR: Database field change detected for table 'events'"));
        assert!(error_msg.contains("The database field changed from '<default>' to 'archive'"));
        assert!(error_msg.contains("INSERT INTO archive.events SELECT * FROM <default>.events"));
    }

    #[test]
    fn test_format_database_change_error_formatting() {
        let error_msg = format_database_change_error("test_table", "db1", "db2");

        // Verify the INSERT statement has correct database.table format
        assert!(error_msg.contains("INSERT INTO db2.test_table SELECT * FROM db1.test_table"));

        // Verify migration instructions are present
        assert!(error_msg.contains("1. Create a new table definition with the target database"));
        assert!(error_msg.contains("2. Migrate your data (if needed):"));
        assert!(error_msg.contains("3. Update your application to use the new table"));
        assert!(error_msg.contains("4. Delete the old table definition from your code"));
    }

    #[test]
    fn test_format_database_change_error_no_placeholder_leakage() {
        // Test that there are no unresolved {} placeholders in the output
        let error_msg = format_database_change_error("my_table", "source_db", "target_db");

        // Count the number of curly braces - should all be matched or properly formatted
        // The only {} should be in the formatted database.table references
        let open_braces = error_msg.matches('{').count();
        let close_braces = error_msg.matches('}').count();

        // Should have no unmatched braces (all format placeholders resolved)
        assert_eq!(
            open_braces, 0,
            "Found unresolved open braces in error message"
        );
        assert_eq!(
            close_braces, 0,
            "Found unresolved close braces in error message"
        );

        // Verify the actual formatted content
        assert!(
            error_msg.contains("INSERT INTO target_db.my_table SELECT * FROM source_db.my_table")
        );
    }
}
