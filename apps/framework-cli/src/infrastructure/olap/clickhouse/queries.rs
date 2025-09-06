use handlebars::{no_escape, Handlebars};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::framework::core::infrastructure::table::EnumValue;
use crate::infrastructure::olap::clickhouse::model::{
    wrap_and_join_column_names, AggregationFunction, ClickHouseColumnType, ClickHouseFloat,
    ClickHouseInt, ClickHouseTable,
};

use super::errors::ClickhouseError;
use super::model::ClickHouseColumn;

// Unclear if we need to add flatten_nested to the views setting as well
static CREATE_ALIAS_TEMPLATE: &str = r#"
CREATE VIEW IF NOT EXISTS `{{db_name}}`.`{{alias_name}}` AS SELECT * FROM `{{db_name}}`.`{{source_table_name}}`;
"#;

fn create_alias_query(
    db_name: &str,
    alias_name: &str,
    source_table_name: &str,
) -> Result<String, ClickhouseError> {
    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let context = json!({
        "db_name": db_name,
        "alias_name": alias_name,
        "source_table_name": source_table_name,
    });

    Ok(reg.render_template(CREATE_ALIAS_TEMPLATE, &context)?)
}

static CREATE_VIEW_TEMPLATE: &str = r#"
CREATE VIEW IF NOT EXISTS `{{db_name}}`.`{{view_name}}` AS {{view_query}};
"#;

pub fn create_view_query(
    db_name: &str,
    view_name: &str,
    view_query: &str,
) -> Result<String, ClickhouseError> {
    let reg = Handlebars::new();

    let context = json!({
        "db_name": db_name,
        "view_name": view_name,
        "view_query": view_query,
    });

    Ok(reg.render_template(CREATE_VIEW_TEMPLATE, &context)?)
}

static DROP_VIEW_TEMPLATE: &str = r#"
DROP VIEW `{{db_name}}`.`{{view_name}}`;
"#;

pub fn drop_view_query(db_name: &str, view_name: &str) -> Result<String, ClickhouseError> {
    let reg = Handlebars::new();

    let context = json!({
        "db_name": db_name,
        "view_name": view_name,
    });

    Ok(reg.render_template(DROP_VIEW_TEMPLATE, &context)?)
}

static UPDATE_VIEW_TEMPLATE: &str = r#"
CREATE OR REPLACE VIEW `{{db_name}}`.`{{view_name}}` AS {{view_query}};
"#;

pub fn update_view_query(
    db_name: &str,
    view_name: &str,
    view_query: &str,
) -> Result<String, ClickhouseError> {
    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let context = json!({
        "db_name": db_name,
        "view_name": view_name,
        "view_query": view_query,
    });

    Ok(reg.render_template(UPDATE_VIEW_TEMPLATE, &context)?)
}

pub fn create_alias_for_table(
    db_name: &str,
    alias_name: &str,
    latest_table: &ClickHouseTable,
) -> Result<String, ClickhouseError> {
    create_alias_query(db_name, alias_name, &latest_table.name)
}

static CREATE_TABLE_TEMPLATE: &str = r#"
CREATE TABLE IF NOT EXISTS `{{db_name}}`.`{{table_name}}`
(
{{#each fields}} `{{field_name}}` {{{field_type}}} {{field_nullable}}{{#if field_default}} DEFAULT {{{field_default}}}{{/if}}{{#if field_comment}} COMMENT '{{{field_comment}}}'{{/if}}{{#unless @last}},{{/unless}}
{{/each}}
)
ENGINE = {{engine}}{{#if primary_key_string}}
PRIMARY KEY ({{primary_key_string}}){{/if}}{{#if order_by_string}}
ORDER BY ({{order_by_string}}){{/if}}{{#if settings}}
SETTINGS {{settings}}{{/if}}"#;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ClickhouseEngine {
    MergeTree,
    ReplacingMergeTree,
    AggregatingMergeTree,
    SummingMergeTree,
}

// The implementation is not symetric between TryFrom and Into so we
// need to allow this clippy warning
#[allow(clippy::from_over_into)]
impl Into<String> for ClickhouseEngine {
    fn into(self) -> String {
        match self {
            ClickhouseEngine::MergeTree => "MergeTree".to_string(),
            ClickhouseEngine::ReplacingMergeTree => "ReplacingMergeTree".to_string(),
            ClickhouseEngine::AggregatingMergeTree => "AggregatingMergeTree".to_string(),
            ClickhouseEngine::SummingMergeTree => "SummingMergeTree".to_string(),
        }
    }
}

impl<'a> TryFrom<&'a str> for ClickhouseEngine {
    type Error = &'a str;

    fn try_from(value: &'a str) -> Result<Self, &'a str> {
        // "There is a SharedMergeTree analog for every specific MergeTree engine type"
        match value
            .strip_prefix("Shared")
            // TODO: properly handle replicated
            .unwrap_or(value.strip_prefix("Replicated").unwrap_or(value))
        {
            "MergeTree" => Ok(ClickhouseEngine::MergeTree),
            "ReplacingMergeTree" => Ok(ClickhouseEngine::ReplacingMergeTree),
            "AggregatingMergeTree" => Ok(ClickhouseEngine::AggregatingMergeTree),
            "SummingMergeTree" => Ok(ClickhouseEngine::SummingMergeTree),
            _ => Err(value),
        }
    }
}

pub fn create_table_query(
    db_name: &str,
    table: ClickHouseTable,
) -> Result<String, ClickhouseError> {
    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let (engine, settings) = match &table.engine {
        ClickhouseEngine::MergeTree => ("MergeTree".to_string(), None),
        ClickhouseEngine::ReplacingMergeTree => {
            if table.order_by.is_empty() {
                return Err(ClickhouseError::InvalidParameters {
                    message: "ReplacingMergeTree requires an order by clause".to_string(),
                });
            }
            ("ReplacingMergeTree".to_string(), None)
        }
        ClickhouseEngine::AggregatingMergeTree => ("AggregatingMergeTree".to_string(), None),
        ClickhouseEngine::SummingMergeTree => ("SummingMergeTree".to_string(), None),
    };

    let primary_key = table
        .columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| column.name.clone())
        .collect::<Vec<String>>();

    let template_context = json!({
        "db_name": db_name,
        "table_name": table.name,
        "fields":  builds_field_context(&table.columns)?,
        "primary_key_string": if !primary_key.is_empty() {
            Some(wrap_and_join_column_names(&primary_key, ","))
        } else {
            None
        },
        "order_by_string": if table.order_by.len() == 1 && table.order_by[0] == "tuple()" {
            Some(table.order_by[0].to_string())
        } else if !table.order_by.is_empty() {
            Some(wrap_and_join_column_names(&table.order_by, ","))
        } else {
            None
        },
        "engine": engine,
        "settings": settings
    });

    Ok(reg.render_template(CREATE_TABLE_TEMPLATE, &template_context)?)
}

pub static DROP_TABLE_TEMPLATE: &str = r#"
DROP TABLE IF EXISTS `{{db_name}}`.`{{table_name}}`;
"#;

pub fn drop_table_query(db_name: &str, table_name: &str) -> Result<String, ClickhouseError> {
    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let context = json!({
        "db_name": db_name,
        "table_name": table_name,
    });

    Ok(reg.render_template(DROP_TABLE_TEMPLATE, &context)?)
}

pub fn basic_field_type_to_string(
    field_type: &ClickHouseColumnType,
) -> Result<String, ClickhouseError> {
    // Blowing out match statements here in case we need to customize the output string for some types.
    match field_type {
        ClickHouseColumnType::String => Ok(field_type.to_string()),
        ClickHouseColumnType::Boolean => Ok(field_type.to_string()),
        ClickHouseColumnType::ClickhouseInt(int) => match int {
            ClickHouseInt::Int8 => Ok(int.to_string()),
            ClickHouseInt::Int16 => Ok(int.to_string()),
            ClickHouseInt::Int32 => Ok(int.to_string()),
            ClickHouseInt::Int64 => Ok(int.to_string()),
            ClickHouseInt::Int128 => Ok(int.to_string()),
            ClickHouseInt::Int256 => Ok(int.to_string()),
            ClickHouseInt::UInt8 => Ok(int.to_string()),
            ClickHouseInt::UInt16 => Ok(int.to_string()),
            ClickHouseInt::UInt32 => Ok(int.to_string()),
            ClickHouseInt::UInt64 => Ok(int.to_string()),
            ClickHouseInt::UInt128 => Ok(int.to_string()),
            ClickHouseInt::UInt256 => Ok(int.to_string()),
        },
        ClickHouseColumnType::ClickhouseFloat(float) => match float {
            ClickHouseFloat::Float32 => Ok(float.to_string()),
            ClickHouseFloat::Float64 => Ok(float.to_string()),
        },
        ClickHouseColumnType::Decimal { precision, scale } => {
            Ok(format!("Decimal({precision}, {scale})"))
        }
        ClickHouseColumnType::DateTime => Ok("DateTime('UTC')".to_string()),
        ClickHouseColumnType::Enum(data_enum) => {
            let enum_statement = data_enum
                .values
                .iter()
                .map(|enum_member| match &enum_member.value {
                    EnumValue::Int(int) => format!("'{}' = {}", enum_member.name, int),
                    // "Numbers are assigned starting from 1 by default."
                    EnumValue::String(string) => format!("'{string}'"),
                })
                .collect::<Vec<String>>()
                .join(",");

            Ok(format!("Enum({enum_statement})"))
        }
        ClickHouseColumnType::Nested(cols) => {
            let nested_fields = cols
                .iter()
                .map(|col| {
                    let field_type_string = basic_field_type_to_string(&col.column_type)?;
                    match col.required {
                        true => Ok(format!("{} {}", col.name, field_type_string)),
                        false => Ok(format!("{} Nullable({})", col.name, field_type_string)),
                    }
                })
                .collect::<Result<Vec<String>, ClickhouseError>>()?
                .join(", ");

            Ok(format!("Nested({nested_fields})"))
        }
        ClickHouseColumnType::Json => Ok("JSON".to_string()),
        ClickHouseColumnType::Bytes => Err(ClickhouseError::UnsupportedDataType {
            type_name: "Bytes".to_string(),
        }),
        ClickHouseColumnType::Array(inner_type) => {
            let inner_type_string = basic_field_type_to_string(inner_type)?;
            Ok(format!("Array({inner_type_string})"))
        }
        ClickHouseColumnType::Nullable(inner_type) => {
            let inner_type_string = basic_field_type_to_string(inner_type)?;
            // <column_name> String NULL is equivalent to <column_name> Nullable(String)
            Ok(format!("Nullable({inner_type_string})"))
        }
        ClickHouseColumnType::AggregateFunction(
            AggregationFunction {
                function_name,
                argument_types,
            },
            _return_type,
        ) => {
            let inner_type_string = argument_types
                .iter()
                .map(basic_field_type_to_string)
                .collect::<Result<Vec<String>, _>>()?
                .join(", ");
            Ok(format!(
                "AggregateFunction({function_name}, {inner_type_string})"
            ))
        }
        ClickHouseColumnType::Uuid => Ok("UUID".to_string()),
        ClickHouseColumnType::Date32 => Ok("Date32".to_string()),
        ClickHouseColumnType::Date => Ok("Date".to_string()),
        ClickHouseColumnType::DateTime64 { precision } => Ok(format!("DateTime64({precision})")),
        ClickHouseColumnType::LowCardinality(inner_type) => Ok(format!(
            "LowCardinality({})",
            basic_field_type_to_string(inner_type)?
        )),
        ClickHouseColumnType::IpV4 => Ok("IPv4".to_string()),
        ClickHouseColumnType::IpV6 => Ok("IPv6".to_string()),
        ClickHouseColumnType::NamedTuple(fields) => {
            let pairs = fields
                .iter()
                .map(|(name, t)| {
                    Ok::<_, ClickhouseError>(format!("{name} {}", basic_field_type_to_string(t)?))
                })
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            Ok(format!("Tuple({pairs})"))
        }
        ClickHouseColumnType::Map(key_type, value_type) => Ok(format!(
            "Map({}, {})",
            basic_field_type_to_string(key_type)?,
            basic_field_type_to_string(value_type)?
        )),
    }
}

fn builds_field_context(columns: &[ClickHouseColumn]) -> Result<Vec<Value>, ClickhouseError> {
    columns
        .iter()
        .map(|column| {
            let field_type = basic_field_type_to_string(&column.column_type)?;

            // Escape single quotes in comments for SQL safety
            let escaped_comment = column.comment.as_ref().map(|c| c.replace('\'', "''"));

            Ok(json!({
                "field_name": column.name,
                "field_type": field_type,
                "field_default": column.default,
                "field_nullable": if let ClickHouseColumnType::Nullable(_) = column.column_type {
                    // if type is Nullable, do not add extra specifier
                    "".to_string()
                } else if column.required || column.is_array() || column.is_nested() {
                    // Clickhouse doesn't allow array/nested fields to be nullable
                    "NOT NULL".to_string()
                } else {
                    "NULL".to_string()
                },
                "field_comment": escaped_comment,
            }))
        })
        .collect::<Result<Vec<Value>, ClickhouseError>>()
}

// Tests
#[cfg(test)]
mod tests {
    use std::vec;

    use super::*;
    use crate::framework::core::infrastructure::table::{DataEnum, EnumMember};
    use crate::framework::versions::Version;

    #[test]
    fn test_nested_query_generator() {
        let complete_nest_type = ClickHouseColumnType::Nested(vec![
            ClickHouseColumn {
                name: "nested_field_1".to_string(),
                column_type: ClickHouseColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_2".to_string(),
                column_type: ClickHouseColumnType::Boolean,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_3".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_4".to_string(),
                column_type: ClickHouseColumnType::ClickhouseFloat(ClickHouseFloat::Float64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_5".to_string(),
                column_type: ClickHouseColumnType::DateTime,
                required: false,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_6".to_string(),
                column_type: ClickHouseColumnType::Enum(DataEnum {
                    name: "TestEnum".to_string(),
                    values: vec![
                        EnumMember {
                            name: "TestEnumValue1".to_string(),
                            value: EnumValue::Int(1),
                        },
                        EnumMember {
                            name: "TestEnumValue2".to_string(),
                            value: EnumValue::Int(2),
                        },
                    ],
                }),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_7".to_string(),
                column_type: ClickHouseColumnType::Array(Box::new(ClickHouseColumnType::String)),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
        ]);

        let expected_nested_query = "Nested(nested_field_1 String, nested_field_2 Boolean, nested_field_3 Int64, nested_field_4 Float64, nested_field_5 Nullable(DateTime('UTC')), nested_field_6 Enum('TestEnumValue1' = 1,'TestEnumValue2' = 2), nested_field_7 Array(String))";

        let nested_query = basic_field_type_to_string(&complete_nest_type).unwrap();

        assert_eq!(nested_query, expected_nested_query);
    }

    #[test]
    fn test_nested_nested_generator() {}

    #[test]
    fn test_create_table_query_basic() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![
                ClickHouseColumn {
                    name: "id".to_string(),
                    column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                    required: true,
                    primary_key: true,
                    unique: false,
                    default: None,
                    comment: None,
                },
                ClickHouseColumn {
                    name: "name".to_string(),
                    column_type: ClickHouseColumnType::String,
                    required: false,
                    primary_key: false,
                    unique: false,
                    default: None,
                    comment: None,
                },
            ],
            order_by: vec![],
            engine: ClickhouseEngine::MergeTree,
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `id` Int32 NOT NULL,
 `name` String NULL
)
ENGINE = MergeTree
PRIMARY KEY (`id`)
"#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_with_default_nullable_string() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "name".to_string(),
                column_type: ClickHouseColumnType::String,
                required: false,
                primary_key: false,
                unique: false,
                default: Some("'abc'".to_string()),
                comment: None,
            }],
            order_by: vec![],
            engine: ClickhouseEngine::MergeTree,
        };

        let query = create_table_query("test_db", table).unwrap();
        // DEFAULT should appear after nullable marker
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `name` String NULL DEFAULT 'abc'
)
ENGINE = MergeTree
"#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_with_default_not_null_int() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "count".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                required: true,
                primary_key: false,
                unique: false,
                default: Some("42".to_string()),
                comment: None,
            }],
            order_by: vec![],
            engine: ClickhouseEngine::MergeTree,
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `count` Int32 NOT NULL DEFAULT 42
)
ENGINE = MergeTree
"#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_replacing_merge_tree() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "id".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                required: true,
                primary_key: true,
                unique: false,
                default: None,
                comment: None,
            }],
            order_by: vec!["id".to_string()],
            engine: ClickhouseEngine::ReplacingMergeTree,
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `id` Int32 NOT NULL
)
ENGINE = ReplacingMergeTree
PRIMARY KEY (`id`)
ORDER BY (`id`) "#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_replacing_merge_tree_error() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "id".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                required: true,
                primary_key: true,
                unique: false,
                default: None,
                comment: None,
            }],
            engine: ClickhouseEngine::ReplacingMergeTree,
            order_by: vec![],
        };

        let result = create_table_query("test_db", table);
        assert!(matches!(
            result,
            Err(ClickhouseError::InvalidParameters { message }) if message == "ReplacingMergeTree requires an order by clause"
        ));
    }

    #[test]
    fn test_create_table_query_complex() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![
                ClickHouseColumn {
                    name: "id".to_string(),
                    column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                    required: true,
                    primary_key: true,
                    unique: false,
                    default: None,
                    comment: None,
                },
                ClickHouseColumn {
                    name: "nested_data".to_string(),
                    column_type: ClickHouseColumnType::Nested(vec![
                        ClickHouseColumn {
                            name: "field1".to_string(),
                            column_type: ClickHouseColumnType::String,
                            required: true,
                            primary_key: false,
                            unique: false,
                            default: None,
                            comment: None,
                        },
                        ClickHouseColumn {
                            name: "field2".to_string(),
                            column_type: ClickHouseColumnType::Boolean,
                            required: false,
                            primary_key: false,
                            unique: false,
                            default: None,
                            comment: None,
                        },
                    ]),
                    required: true,
                    primary_key: false,
                    unique: false,
                    default: None,
                    comment: None,
                },
                ClickHouseColumn {
                    name: "status".to_string(),
                    column_type: ClickHouseColumnType::Enum(DataEnum {
                        name: "Status".to_string(),
                        values: vec![
                            EnumMember {
                                name: "Active".to_string(),
                                value: EnumValue::Int(1),
                            },
                            EnumMember {
                                name: "Inactive".to_string(),
                                value: EnumValue::Int(2),
                            },
                        ],
                    }),
                    required: true,
                    primary_key: false,
                    unique: false,
                    default: None,
                    comment: None,
                },
            ],
            engine: ClickhouseEngine::MergeTree,
            order_by: vec!["id".to_string()],
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `id` Int32 NOT NULL,
 `nested_data` Nested(field1 String, field2 Nullable(Boolean)) NOT NULL,
 `status` Enum('Active' = 1,'Inactive' = 2) NOT NULL
)
ENGINE = MergeTree
PRIMARY KEY (`id`)
ORDER BY (`id`) "#;
        assert_eq!(query.trim(), expected.trim());
    }
}
