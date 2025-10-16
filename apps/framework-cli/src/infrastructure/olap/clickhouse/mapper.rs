use crate::framework::core::infrastructure::table::{
    Column, ColumnMetadata, ColumnType, DataEnum, EnumMemberMetadata, EnumMetadata, EnumValue,
    EnumValueMetadata, FloatType, IntType, Table, METADATA_PREFIX, METADATA_VERSION,
};
use serde_json::Value;

use crate::infrastructure::olap::clickhouse::model::{
    AggregationFunction, ClickHouseColumn, ClickHouseColumnType, ClickHouseFloat, ClickHouseInt,
    ClickHouseTable,
};

use super::errors::ClickhouseError;
use super::queries::ClickhouseEngine;

/// Generates a column comment, preserving any existing user comment and adding/updating metadata for enums
fn generate_column_comment(column: &Column) -> Result<Option<String>, ClickhouseError> {
    if let ColumnType::Enum(ref data_enum) = column.data_type {
        let metadata_comment = build_enum_metadata_comment(data_enum)?;

        // Extract user comment from existing comment (if any)
        // The existing comment might be:
        // 1. Just a user comment
        // 2. Just metadata (starts with METADATA_PREFIX)
        // 3. User comment + metadata
        let user_comment = match &column.comment {
            Some(existing) => {
                if let Some(metadata_pos) = existing.find(METADATA_PREFIX) {
                    // Has metadata - extract the user comment part before it
                    let user_part = existing[..metadata_pos].trim();
                    if !user_part.is_empty() {
                        Some(user_part.to_string())
                    } else {
                        None
                    }
                } else if !existing.is_empty() {
                    // No metadata, entire comment is user comment
                    Some(existing.clone())
                } else {
                    None
                }
            }
            None => None,
        };

        // Combine user comment with new metadata
        Ok(match user_comment {
            Some(user_text) => Some(format!("{user_text} {metadata_comment}")),
            None => Some(metadata_comment),
        })
    } else {
        Ok(column.comment.clone()) // Pass through any existing comment for non-enum types
    }
}

pub fn std_column_to_clickhouse_column(
    column: Column,
) -> Result<ClickHouseColumn, ClickhouseError> {
    let comment = generate_column_comment(&column)?;

    let mut column_type =
        std_field_type_to_clickhouse_type_mapper(column.data_type, &column.annotations)?;

    // Wrap non-required columns as Nullable for consistency across CREATE and ALTER TABLE operations
    // This logic belongs here rather than in std_field_type_to_clickhouse_type_mapper because:
    // 1. The type mapper only has access to the ColumnType, not the full Column with its `required` field
    // 2. This ensures ALL column conversions (single or batch) get consistent nullable handling
    // 3. ClickHouse requires explicit Nullable type for ALTER TABLE operations
    if !column.required {
        // Only wrap if not already Nullable and not an array/nested type (which can't be nullable)
        if !matches!(column_type, ClickHouseColumnType::Nullable(_))
            && !matches!(column_type, ClickHouseColumnType::Array(_))
            && !matches!(column_type, ClickHouseColumnType::Nested(_))
        {
            column_type = ClickHouseColumnType::Nullable(Box::new(column_type));
        }
    }

    let clickhouse_column = ClickHouseColumn {
        name: column.name,
        column_type,
        required: column.required,
        unique: column.unique,
        primary_key: column.primary_key,
        default: column.default.clone(),
        comment,
    };

    Ok(clickhouse_column)
}

pub fn build_enum_metadata_comment(data_enum: &DataEnum) -> Result<String, ClickhouseError> {
    let metadata = ColumnMetadata {
        version: METADATA_VERSION,
        enum_def: EnumMetadata {
            name: data_enum.name.clone(),
            members: data_enum
                .values
                .iter()
                .map(|m| EnumMemberMetadata {
                    name: m.name.clone(),
                    value: match &m.value {
                        EnumValue::String(s) => EnumValueMetadata::String(s.clone()),
                        EnumValue::Int(i) => EnumValueMetadata::Int(*i),
                    },
                })
                .collect(),
        },
    };

    let json =
        serde_json::to_string(&metadata).map_err(|e| ClickhouseError::InvalidParameters {
            message: format!("Failed to serialize enum metadata: {e}"),
        })?;
    Ok(format!("{METADATA_PREFIX}{json}"))
}

fn std_field_type_to_clickhouse_type_mapper(
    field_type: ColumnType,
    annotations: &[(String, Value)],
) -> Result<ClickHouseColumnType, ClickhouseError> {
    if let Some((_, agg_func)) = annotations.iter().find(|(k, _)| k == "aggregationFunction") {
        let clickhouse_type = std_field_type_to_clickhouse_type_mapper(field_type, &[])?;

        let agg_func =
            serde_json::from_value::<AggregationFunction<ColumnType>>(agg_func.clone()).unwrap();

        return Ok(ClickHouseColumnType::AggregateFunction(
            AggregationFunction {
                function_name: agg_func.function_name,
                argument_types: agg_func
                    .argument_types
                    .into_iter()
                    .map(|t| std_field_type_to_clickhouse_type_mapper(t, &[]))
                    .collect::<Result<Vec<_>, _>>()?,
            },
            Box::new(clickhouse_type),
        ));
    }

    if annotations
        .iter()
        .any(|(k, v)| k == "LowCardinality" && v == &serde_json::json!(true))
    {
        let clickhouse_type = std_field_type_to_clickhouse_type_mapper(field_type, &[])?;
        return Ok(ClickHouseColumnType::LowCardinality(Box::new(
            clickhouse_type,
        )));
    }

    match field_type {
        ColumnType::String => Ok(ClickHouseColumnType::String),
        ColumnType::Boolean => Ok(ClickHouseColumnType::Boolean),
        ColumnType::Int(IntType::Int8) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int8))
        }
        ColumnType::Int(IntType::Int16) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int16))
        }
        ColumnType::Int(IntType::Int32) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32))
        }
        ColumnType::Int(IntType::Int64) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int64))
        }
        ColumnType::Int(IntType::Int128) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int128))
        }
        ColumnType::Int(IntType::Int256) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int256))
        }
        ColumnType::Int(IntType::UInt8) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::UInt8))
        }
        ColumnType::Int(IntType::UInt16) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::UInt16))
        }
        ColumnType::Int(IntType::UInt32) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::UInt32))
        }
        ColumnType::Int(IntType::UInt64) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::UInt64))
        }
        ColumnType::Int(IntType::UInt128) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::UInt128))
        }
        ColumnType::Int(IntType::UInt256) => {
            Ok(ClickHouseColumnType::ClickhouseInt(ClickHouseInt::UInt256))
        }
        ColumnType::Float(FloatType::Float32) => Ok(ClickHouseColumnType::ClickhouseFloat(
            ClickHouseFloat::Float32,
        )),
        ColumnType::Float(FloatType::Float64) => Ok(ClickHouseColumnType::ClickhouseFloat(
            ClickHouseFloat::Float64,
        )),
        ColumnType::Decimal { precision, scale } => {
            Ok(ClickHouseColumnType::Decimal { precision, scale })
        }
        ColumnType::DateTime { precision: None } => Ok(ClickHouseColumnType::DateTime),
        ColumnType::DateTime {
            precision: Some(precision),
        } => Ok(ClickHouseColumnType::DateTime64 { precision }),
        ColumnType::Enum(x) => Ok(ClickHouseColumnType::Enum(x)),
        ColumnType::Array {
            element_type,
            element_nullable,
        } => {
            let inner_clickhouse_type =
                std_field_type_to_clickhouse_type_mapper(*element_type, &[])?;
            let with_nullable = if element_nullable {
                ClickHouseColumnType::Nullable(Box::new(inner_clickhouse_type))
            } else {
                inner_clickhouse_type
            };
            Ok(ClickHouseColumnType::Array(Box::new(with_nullable)))
        }
        ColumnType::Nested(inner_nested) => {
            let column_types = inner_nested
                .columns
                .iter()
                .map(|column| std_column_to_clickhouse_column(column.clone()))
                .collect::<Result<Vec<ClickHouseColumn>, ClickhouseError>>()?;

            Ok(ClickHouseColumnType::Nested(column_types))
        }
        ColumnType::BigInt => Err(ClickhouseError::UnsupportedDataType {
            type_name: "BigInt".to_string(),
        }),
        ColumnType::Json => Ok(ClickHouseColumnType::Json),
        ColumnType::Bytes => Err(ClickhouseError::UnsupportedDataType {
            type_name: "Bytes".to_string(),
        }),
        ColumnType::Uuid => Ok(ClickHouseColumnType::Uuid),
        // Framework Date (standard) -> ClickHouse Date32 (4 bytes, full range)
        ColumnType::Date => Ok(ClickHouseColumnType::Date32),
        // Framework Date16 (memory-optimized) -> ClickHouse Date (2 bytes, limited range)
        ColumnType::Date16 => Ok(ClickHouseColumnType::Date),
        ColumnType::IpV4 => Ok(ClickHouseColumnType::IpV4),
        ColumnType::IpV6 => Ok(ClickHouseColumnType::IpV6),
        ColumnType::Point => Ok(ClickHouseColumnType::Point),
        ColumnType::Ring => Ok(ClickHouseColumnType::Ring),
        ColumnType::LineString => Ok(ClickHouseColumnType::LineString),
        ColumnType::MultiLineString => Ok(ClickHouseColumnType::MultiLineString),
        ColumnType::Polygon => Ok(ClickHouseColumnType::Polygon),
        ColumnType::MultiPolygon => Ok(ClickHouseColumnType::MultiPolygon),
        ColumnType::Nullable(inner) => {
            let inner_type = std_field_type_to_clickhouse_type_mapper(*inner, &[])?;
            Ok(ClickHouseColumnType::Nullable(Box::new(inner_type)))
        }
        ColumnType::NamedTuple(fields) => Ok(ClickHouseColumnType::NamedTuple(
            fields
                .into_iter()
                .map(|(name, t)| {
                    Ok::<_, ClickhouseError>((
                        name,
                        std_field_type_to_clickhouse_type_mapper(t, &[])?,
                    ))
                })
                .collect::<Result<_, _>>()?,
        )),
        ColumnType::Map {
            key_type,
            value_type,
        } => {
            let clickhouse_key_type = std_field_type_to_clickhouse_type_mapper(*key_type, &[])?;
            let clickhouse_value_type = std_field_type_to_clickhouse_type_mapper(*value_type, &[])?;
            Ok(ClickHouseColumnType::Map(
                Box::new(clickhouse_key_type),
                Box::new(clickhouse_value_type),
            ))
        }
    }
}

/// Convert multiple standard columns to ClickHouse columns
/// This delegates to std_column_to_clickhouse_column to ensure consistent handling of:
/// - Nullable wrapping for non-required columns
/// - Default value mapping
/// - Column metadata/comments
pub fn std_columns_to_clickhouse_columns(
    columns: &[Column],
) -> Result<Vec<ClickHouseColumn>, ClickhouseError> {
    columns
        .iter()
        .map(|column| std_column_to_clickhouse_column(column.clone()))
        .collect()
}

pub fn std_table_to_clickhouse_table(table: &Table) -> Result<ClickHouseTable, ClickhouseError> {
    let columns = std_columns_to_clickhouse_columns(&table.columns)?;

    let clickhouse_engine = match &table.engine {
        Some(engine) => engine.clone(),
        None => ClickhouseEngine::MergeTree,
    };

    Ok(ClickHouseTable {
        name: table.name.clone(),
        version: table.version.clone(),
        columns,
        order_by: table.order_by.clone(),
        partition_by: table.partition_by.clone(),
        sample_by: table.sample_by.clone(),
        engine: clickhouse_engine,
        table_settings: table.table_settings.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{EnumMember, Nested};

    #[test]
    fn test_enum_metadata_roundtrip() {
        // Create a test enum
        let enum_def = DataEnum {
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

        // Generate metadata comment
        let comment = build_enum_metadata_comment(&enum_def).unwrap();

        // Verify it has the correct prefix
        assert!(comment.starts_with(METADATA_PREFIX));

        // Parse it back (we need to import the parsing functions from clickhouse.rs for full test)
        // For now, let's at least verify the JSON structure
        let json_str = comment.strip_prefix(METADATA_PREFIX).unwrap();
        let metadata: ColumnMetadata = serde_json::from_str(json_str).unwrap();

        // Verify the metadata
        assert_eq!(metadata.version, METADATA_VERSION);
        assert_eq!(metadata.enum_def.name, "RecordType");
        assert_eq!(metadata.enum_def.members.len(), 3);

        // Verify first member
        assert_eq!(metadata.enum_def.members[0].name, "TEXT");
        match &metadata.enum_def.members[0].value {
            EnumValueMetadata::String(s) => assert_eq!(s, "text"),
            _ => panic!("Expected string value"),
        }
    }

    #[test]
    fn test_comment_preservation_with_enum_metadata() {
        // Test that user comments are preserved when adding enum metadata
        let enum_def = DataEnum {
            name: "RecordType".to_string(),
            values: vec![EnumMember {
                name: "TEXT".to_string(),
                value: EnumValue::String("text".to_string()),
            }],
        };

        // Test 1: New user comment only
        let column_with_user_comment = Column {
            name: "record_type".to_string(),
            data_type: ColumnType::Enum(enum_def.clone()),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: Some("This is a user comment about the record type".to_string()),
        };

        let clickhouse_column = std_column_to_clickhouse_column(column_with_user_comment).unwrap();
        let comment = clickhouse_column.comment.unwrap();
        assert!(comment.starts_with("This is a user comment about the record type"));
        assert!(comment.contains(METADATA_PREFIX));

        // Test 2: Existing comment with both user text and old metadata
        let old_metadata = build_enum_metadata_comment(&DataEnum {
            name: "OldEnum".to_string(),
            values: vec![],
        })
        .unwrap();

        let column_with_both = Column {
            name: "record_type".to_string(),
            data_type: ColumnType::Enum(enum_def.clone()),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: Some(format!("Old user comment {}", old_metadata)),
        };

        let clickhouse_column = std_column_to_clickhouse_column(column_with_both).unwrap();
        let comment = clickhouse_column.comment.unwrap();

        // Should preserve the old user comment but update the metadata
        assert!(comment.starts_with("Old user comment"));
        assert!(comment.contains(METADATA_PREFIX));

        // Verify new metadata is present (not old)
        let metadata_start = comment.find(METADATA_PREFIX).unwrap();
        let json_str = &comment[metadata_start + METADATA_PREFIX.len()..];
        let metadata: ColumnMetadata = serde_json::from_str(json_str.trim()).unwrap();
        assert_eq!(metadata.enum_def.name, "RecordType"); // New enum name, not "OldEnum"

        // Test 3: Existing metadata only (no user comment)
        let column_metadata_only = Column {
            name: "record_type".to_string(),
            data_type: ColumnType::Enum(enum_def.clone()),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: Some(old_metadata),
        };

        let clickhouse_column = std_column_to_clickhouse_column(column_metadata_only).unwrap();
        let comment = clickhouse_column.comment.unwrap();

        // Should have only metadata, no user comment
        assert!(comment.starts_with(METADATA_PREFIX));
        let metadata: ColumnMetadata =
            serde_json::from_str(comment.strip_prefix(METADATA_PREFIX).unwrap().trim()).unwrap();
        assert_eq!(metadata.enum_def.name, "RecordType");
    }

    #[test]
    fn test_nested_column_with_enum() {
        // Test that nested columns with enum fields get metadata comments
        let enum_def = DataEnum {
            name: "Status".to_string(),
            values: vec![
                EnumMember {
                    name: "ACTIVE".to_string(),
                    value: EnumValue::String("active".to_string()),
                },
                EnumMember {
                    name: "INACTIVE".to_string(),
                    value: EnumValue::String("inactive".to_string()),
                },
            ],
        };

        let nested = Nested {
            name: "UserInfo".to_string(),
            columns: vec![
                Column {
                    name: "id".to_string(),
                    data_type: ColumnType::Int(IntType::Int32),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
                Column {
                    name: "status".to_string(),
                    data_type: ColumnType::Enum(enum_def.clone()),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: Some("User status field".to_string()), // User comment
                },
            ],
            jwt: false,
        };

        // Convert nested type to ClickHouse
        let clickhouse_type =
            std_field_type_to_clickhouse_type_mapper(ColumnType::Nested(nested.clone()), &[])
                .unwrap();

        // Verify it's a nested type
        if let ClickHouseColumnType::Nested(columns) = clickhouse_type {
            assert_eq!(columns.len(), 2);

            // Check the enum column has the metadata comment
            let status_col = columns.iter().find(|c| c.name == "status").unwrap();
            assert!(status_col.comment.is_some());
            let comment = status_col.comment.as_ref().unwrap();

            // Should have both user comment and metadata
            assert!(comment.starts_with("User status field"));
            assert!(comment.contains(METADATA_PREFIX));
        } else {
            panic!("Expected Nested type");
        }
    }

    #[test]
    fn test_enum_metadata_with_int_values() {
        // Create a test enum with integer values
        let enum_def = DataEnum {
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

        // Generate metadata comment
        let comment = build_enum_metadata_comment(&enum_def).unwrap();

        // Parse it back
        let json_str = comment.strip_prefix(METADATA_PREFIX).unwrap();
        let metadata: ColumnMetadata = serde_json::from_str(json_str).unwrap();

        // Verify the metadata
        assert_eq!(metadata.enum_def.name, "Status");
        assert_eq!(metadata.enum_def.members.len(), 2);

        // Verify integer values
        match &metadata.enum_def.members[0].value {
            EnumValueMetadata::Int(i) => assert_eq!(*i, 1),
            _ => panic!("Expected int value"),
        }
    }
}
