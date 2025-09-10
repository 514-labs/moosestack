//! ClickHouse-specific table diffing strategy
//!
//! This module implements the TableDiffStrategy for ClickHouse, handling the database's
//! specific limitations around schema changes. ClickHouse has restrictions on certain
//! ALTER TABLE operations, particularly around ORDER BY and primary key changes.

use crate::framework::core::infrastructure::table::{
    Column, ColumnType, DataEnum, EnumValue, Table,
};
use crate::framework::core::infrastructure_map::{
    ColumnChange, OlapChange, OrderByChange, TableChange, TableDiffStrategy,
};
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

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
    ) -> Vec<OlapChange> {
        // Check if ORDER BY has changed
        let order_by_changed = order_by_change.before != order_by_change.after;
        if order_by_changed {
            log::debug!(
                "ClickHouse: ORDER BY changed for table '{}', requiring drop+create",
                before.name
            );
            return vec![
                OlapChange::Table(TableChange::Removed(before.clone())),
                OlapChange::Table(TableChange::Added(after.clone())),
            ];
        }

        // Check if primary key structure has changed
        let before_primary_keys = before.primary_key_columns();
        let after_primary_keys = after.primary_key_columns();
        if before_primary_keys != after_primary_keys {
            log::debug!(
                "ClickHouse: Primary key structure changed for table '{}', requiring drop+create",
                before.name
            );
            return vec![
                OlapChange::Table(TableChange::Removed(before.clone())),
                OlapChange::Table(TableChange::Added(after.clone())),
            ];
        }

        let before_engine = before
            .engine
            .as_deref()
            .and_then(|e| ClickhouseEngine::try_from(e).ok());
        // do NOT compare the strings directly because of the possible prefix "Shared"
        let engine_changed = match after.engine.as_deref() {
            // after.engine is unset -> before engine should be same as default
            None => before_engine.is_some_and(|e| e != ClickhouseEngine::MergeTree),
            // force recreate only if after.engine can be parsed and before.engine is not the same
            Some(e) => ClickhouseEngine::try_from(e).is_ok_and(|e| Some(e) != before_engine),
        };
        // Check if engine has changed
        if engine_changed {
            log::debug!(
                "ClickHouse: engine changed for table '{}', requiring drop+create",
                before.name
            );
            return vec![
                OlapChange::Table(TableChange::Removed(before.clone())),
                OlapChange::Table(TableChange::Added(after.clone())),
            ];
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
        // If there are no column changes, return an empty vector since
        // we've already handled all the cases that require drop+create.
        if column_changes.is_empty() {
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
    use crate::framework::core::infrastructure::table::{Column, ColumnType, EnumMember};
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::framework::versions::Version;

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
                },
            ],
            order_by,
            engine: deduplicate.then(|| "ReplacingMergeTree".to_string()),
            version: Some(Version::from_string("1.0.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
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
            before: vec!["id".to_string()],
            after: vec!["id".to_string(), "timestamp".to_string()],
        };

        let changes = strategy.diff_table_update(&before, &after, vec![], order_by_change);

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

        let changes = strategy.diff_table_update(&before, &after, vec![], order_by_change);

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
            },
            position_after: Some("timestamp".to_string()),
        }];

        let order_by_change = OrderByChange {
            before: before.order_by.clone(),
            after: after.order_by.clone(),
        };

        let changes = strategy.diff_table_update(&before, &after, column_changes, order_by_change);

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
            },
            position_after: Some("timestamp".to_string()),
        }];

        let order_by_change = OrderByChange {
            before: vec!["id".to_string(), "timestamp".to_string()],
            after: vec!["id".to_string(), "timestamp".to_string()],
        };

        let changes = strategy.diff_table_update(&before, &after, column_changes, order_by_change);

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
            before: vec!["id".to_string(), "timestamp".to_string()],
            after: vec!["id".to_string(), "timestamp".to_string()],
        };

        let changes = strategy.diff_table_update(&before, &after, column_changes, order_by_change);

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
            before: vec!["id".to_string()],
            after: vec!["timestamp".to_string()],
        };

        let changes = strategy.diff_table_update(&before, &after, column_changes, order_by_change);

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
}
