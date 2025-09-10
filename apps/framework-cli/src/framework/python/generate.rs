use crate::framework::core::infrastructure::table::{
    ColumnType, DataEnum, EnumValue, FloatType, IntType, Nested, Table,
};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use convert_case::{Case, Casing};
use itertools::Itertools;
use regex::Regex;
use serde_json::json;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fmt::Write;
use std::sync::LazyLock;

fn map_column_type_to_python(
    column_type: &ColumnType,
    enums: &HashMap<&DataEnum, String>,
    nested: &HashMap<&Nested, String>,
    named_tuples: &HashMap<&Vec<(String, ColumnType)>, String>,
) -> String {
    match column_type {
        ColumnType::String => "str".to_string(),
        ColumnType::Boolean => "bool".to_string(),
        ColumnType::Int(int_type) => match int_type {
            IntType::Int8 => "Annotated[int, \"int8\"]".to_string(),
            IntType::Int16 => "Annotated[int, \"int16\"]".to_string(),
            IntType::Int32 => "Annotated[int, \"int32\"]".to_string(),
            IntType::Int64 => "Annotated[int, \"int64\"]".to_string(),
            IntType::Int128 => "Annotated[int, \"int128\"]".to_string(),
            IntType::Int256 => "Annotated[int, \"int256\"]".to_string(),
            IntType::UInt8 => "Annotated[int, \"uint8\"]".to_string(),
            IntType::UInt16 => "Annotated[int, \"uint16\"]".to_string(),
            IntType::UInt32 => "Annotated[int, \"uint32\"]".to_string(),
            IntType::UInt64 => "Annotated[int, \"uint64\"]".to_string(),
            IntType::UInt128 => "Annotated[int, \"uint128\"]".to_string(),
            IntType::UInt256 => "Annotated[int, \"uint256\"]".to_string(),
        },
        ColumnType::BigInt => "int".to_string(),
        ColumnType::Float(float_type) => match float_type {
            FloatType::Float32 => "Annotated[float, ClickhouseSize(4)]".to_string(),
            FloatType::Float64 => "float".to_string(),
        },
        ColumnType::Decimal { precision, scale } => {
            format!("clickhouse_decimal({precision}, {scale})")
        }
        ColumnType::DateTime { precision: None } => "datetime.datetime".to_string(),
        ColumnType::DateTime {
            precision: Some(precision),
        } => format!("clickhouse_datetime64({precision})"),
        ColumnType::Date => "datetime.date".to_string(),
        ColumnType::Date16 => "Annotated[datetime.date, ClickhouseSize(2)]".to_string(),
        ColumnType::Enum(data_enum) => enums.get(data_enum).unwrap().to_string(),
        ColumnType::Array {
            element_type,
            element_nullable,
        } => {
            let inner_type = map_column_type_to_python(element_type, enums, nested, named_tuples);
            let inner_type = if *element_nullable {
                format!("Optional[{inner_type}]")
            } else {
                inner_type
            };
            format!("list[{inner_type}]")
        }
        ColumnType::Nested(nested_type) => nested.get(nested_type).unwrap().to_string(),
        ColumnType::NamedTuple(fields) => {
            let class_name = named_tuples.get(fields).unwrap();
            format!("Annotated[{class_name}, \"ClickHouseNamedTuple\"]")
        }
        ColumnType::Json => "Any".to_string(),
        ColumnType::Bytes => "bytes".to_string(),
        ColumnType::Uuid => "UUID".to_string(),
        ColumnType::IpV4 => "ipaddress.IPv4Address".to_string(),
        ColumnType::IpV6 => "ipaddress.IPv6Address".to_string(),
        ColumnType::Nullable(inner) => {
            let inner_type = map_column_type_to_python(inner, enums, nested, named_tuples);
            format!("Optional[{inner_type}]")
        }
        ColumnType::Map {
            key_type,
            value_type,
        } => {
            let key_type_str = map_column_type_to_python(key_type, enums, nested, named_tuples);
            let value_type_str = map_column_type_to_python(value_type, enums, nested, named_tuples);
            format!("dict[{key_type_str}, {value_type_str}]")
        }
    }
}

fn generate_enum_class(data_enum: &DataEnum, name: &str) -> String {
    let mut enum_class = String::new();
    writeln!(
        enum_class,
        "class {}({}):",
        name,
        if data_enum
            .values
            .iter()
            .all(|v| matches!(v.value, EnumValue::Int(_)))
        {
            "StringToEnumMixin, IntEnum"
        } else {
            "Enum"
        }
    )
    .unwrap();
    for member in &data_enum.values {
        match &member.value {
            EnumValue::Int(i) => {
                if PYTHON_IDENTIFIER_PATTERN.is_match(&member.name) {
                    writeln!(enum_class, "    {} = {}", member.name, i).unwrap();
                } else {
                    // skip names that are not valid identifiers
                    writeln!(enum_class, "    # {} = \"{}\"", member.name, i).unwrap()
                }
            }
            EnumValue::String(s) => {
                writeln!(enum_class, "    {} = \"{}\"", member.name, s).unwrap()
            }
        }
    }
    writeln!(enum_class).unwrap();
    enum_class
}

const PYTHON_IDENTIFIER_REGEX: &str = r"^[^\d\W]\w*$";
pub static PYTHON_IDENTIFIER_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(PYTHON_IDENTIFIER_REGEX).unwrap());

// TODO: merge with table model generation logic
fn generate_nested_model(
    nested: &Nested,
    name: &str,
    enums: &HashMap<&DataEnum, String>,
    nested_models: &HashMap<&Nested, String>,
    named_tuples: &HashMap<&Vec<(String, ColumnType)>, String>,
) -> String {
    let mut model = String::new();
    writeln!(model, "class {name}(BaseModel):").unwrap();

    for column in &nested.columns {
        let type_str =
            map_column_type_to_python(&column.data_type, enums, nested_models, named_tuples);

        let (type_str, default) = if !column.required {
            (format!("Optional[{type_str}]"), " = None")
        } else {
            (type_str, "")
        };

        let (mapped_name, mapped_default) = if column.name.starts_with('_') {
            (
                format!("UNDERSCORE_PREFIXED{}", column.name),
                if default == " = None" {
                    format!(" = Field(default=None, alias=\"{}\")", column.name)
                } else {
                    format!(" = Field(alias=\"{}\")", column.name)
                },
            )
        } else {
            (column.name.clone(), default.to_string())
        };

        writeln!(model, "    {mapped_name}: {type_str}{mapped_default}").unwrap();
    }
    writeln!(model).unwrap();
    model
}

fn generate_named_tuple_model(
    fields: &Vec<(String, ColumnType)>,
    name: &str,
    enums: &HashMap<&DataEnum, String>,
    nested_models: &HashMap<&Nested, String>,
    named_tuples: &HashMap<&Vec<(String, ColumnType)>, String>,
) -> String {
    let mut model = String::new();
    writeln!(model, "class {name}(BaseModel):").unwrap();

    for (field_name, field_type) in fields {
        let type_str = map_column_type_to_python(field_type, enums, nested_models, named_tuples);
        writeln!(model, "    {field_name}: {type_str}").unwrap();
    }
    writeln!(model).unwrap();
    model
}

fn collect_types<'a>(
    column_type: &'a ColumnType,
    name: &str,
    enums: &mut HashMap<&'a DataEnum, String>,
    extra_class_names: &mut HashMap<String, usize>,
    nested_models: &mut HashMap<&'a Nested, String>,
    named_tuples: &mut HashMap<&'a Vec<(String, ColumnType)>, String>,
) {
    match column_type {
        ColumnType::Enum(data_enum) => {
            if !enums.contains_key(data_enum) {
                let name = name.to_case(Case::Pascal);
                let name = match extra_class_names.entry(name.clone()) {
                    Entry::Occupied(mut entry) => {
                        *entry.get_mut() = entry.get() + 1;
                        format!("{}{}", name, entry.get())
                    }
                    Entry::Vacant(entry) => {
                        entry.insert(0);
                        name
                    }
                };
                enums.insert(data_enum, name);
            }
        }
        ColumnType::Nested(nested) => {
            if !nested_models.contains_key(nested) {
                let name = name.to_case(Case::Pascal);
                let name = match extra_class_names.entry(name.clone()) {
                    Entry::Occupied(mut entry) => {
                        *entry.get_mut() = entry.get() + 1;
                        format!("{}{}", name, entry.get())
                    }
                    Entry::Vacant(entry) => {
                        entry.insert(0);
                        name
                    }
                };
                nested_models.insert(nested, name);
            }
        }
        ColumnType::NamedTuple(fields) => {
            if !named_tuples.contains_key(fields) {
                let name = format!("{}Tuple", name.to_case(Case::Pascal));
                let name = match extra_class_names.entry(name.clone()) {
                    Entry::Occupied(mut entry) => {
                        *entry.get_mut() = entry.get() + 1;
                        format!("{}{}", name, entry.get())
                    }
                    Entry::Vacant(entry) => {
                        entry.insert(0);
                        name
                    }
                };
                named_tuples.insert(fields, name);
            }
        }
        ColumnType::Array {
            element_type,
            element_nullable: _,
        } => collect_types(
            element_type,
            name,
            enums,
            extra_class_names,
            nested_models,
            named_tuples,
        ),
        _ => {}
    }
}

pub fn tables_to_python(tables: &[Table], life_cycle: Option<LifeCycle>) -> String {
    let mut output = String::new();

    // Add imports
    writeln!(output, "from pydantic import BaseModel, Field").unwrap();
    writeln!(output, "from typing import Optional, Any, Annotated").unwrap();
    writeln!(output, "import datetime").unwrap();
    writeln!(output, "import ipaddress").unwrap();
    writeln!(output, "from uuid import UUID").unwrap();
    writeln!(output, "from enum import IntEnum, Enum").unwrap();
    writeln!(
        output,
        "from moose_lib import Key, IngestPipeline, IngestPipelineConfig, OlapConfig, clickhouse_datetime64, clickhouse_decimal, ClickhouseSize, StringToEnumMixin"
    )
    .unwrap();
    writeln!(
        output,
        "from moose_lib import clickhouse_default, LifeCycle"
    )
    .unwrap();
    writeln!(
        output,
        "from moose_lib.blocks import MergeTreeEngine, ReplacingMergeTreeEngine, AggregatingMergeTreeEngine, SummingMergeTreeEngine, S3QueueEngine"
    )
    .unwrap();
    writeln!(output).unwrap();

    // Collect all enums, nested types, and named tuples
    let mut enums: HashMap<&DataEnum, String> = HashMap::new();
    let mut extra_class_names: HashMap<String, usize> = HashMap::new();
    let mut nested_models: HashMap<&Nested, String> = HashMap::new();
    let mut named_tuples: HashMap<&Vec<(String, ColumnType)>, String> = HashMap::new();

    // First pass: collect all nested types, enums, and named tuples
    for table in tables {
        for column in &table.columns {
            collect_types(
                &column.data_type,
                &column.name,
                &mut enums,
                &mut extra_class_names,
                &mut nested_models,
                &mut named_tuples,
            );
        }
    }

    // Generate enum classes
    for (data_enum, name) in enums.iter() {
        output.push_str(&generate_enum_class(data_enum, name));
    }

    // Generate named tuple model classes
    for (fields, name) in named_tuples.iter() {
        output.push_str(&generate_named_tuple_model(
            fields,
            name,
            &enums,
            &nested_models,
            &named_tuples,
        ));
    }

    // Generate nested model classes
    for (nested, name) in nested_models.iter() {
        output.push_str(&generate_nested_model(
            nested,
            name,
            &enums,
            &nested_models,
            &named_tuples,
        ));
    }

    // Generate model classes
    for table in tables {
        writeln!(output, "class {}(BaseModel):", table.name).unwrap();

        let primary_key = table
            .columns
            .iter()
            .filter_map(|column| {
                if column.primary_key {
                    Some(column.name.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let can_use_key_wrapping = table.order_by.starts_with(primary_key.as_slice());

        for column in &table.columns {
            let type_str =
                map_column_type_to_python(&column.data_type, &enums, &nested_models, &named_tuples);

            let (mut type_str, default) = if !column.required {
                (format!("Optional[{type_str}]"), " = None")
            } else {
                (type_str, "")
            };

            if let Some(ref default_expr) = column.default {
                type_str = format!(
                    "Annotated[{}, clickhouse_default({:?})]",
                    type_str, default_expr
                );
            }

            let type_str = if can_use_key_wrapping && column.primary_key {
                format!("Key[{type_str}]")
            } else {
                type_str
            };

            let (mapped_name, mapped_default) = if column.name.starts_with('_') {
                (
                    format!("UNDERSCORE_PREFIXED{}", column.name),
                    if default == " = None" {
                        format!(" = Field(default=None, alias=\"{}\")", column.name)
                    } else {
                        format!(" = Field(alias=\"{}\")", column.name)
                    },
                )
            } else {
                (column.name.clone(), default.to_string())
            };

            writeln!(output, "    {mapped_name}: {type_str}{mapped_default}").unwrap();
        }
        writeln!(output).unwrap();
    }

    // Generate pipeline configurations
    for table in tables {
        let order_by_fields = if table.order_by.is_empty() {
            "\"tuple()\"".to_string()
        } else {
            table
                .order_by
                .iter()
                .map(|name| format!("{:?}", name))
                .join(", ")
        };

        writeln!(
            output,
            "{}_model = IngestPipeline[{}](\"{}\", IngestPipelineConfig(",
            table.name.to_case(Case::Snake),
            table.name,
            table.name
        )
        .unwrap();
        writeln!(output, "    ingest=True,").unwrap();
        writeln!(output, "    stream=True,").unwrap();
        writeln!(output, "    table=OlapConfig(").unwrap();
        writeln!(output, "        order_by_fields=[{order_by_fields}],").unwrap();
        if let Some(life_cycle) = life_cycle {
            writeln!(
                output,
                "        life_cycle=LifeCycle.{},",
                json!(life_cycle).as_str().unwrap(), // reuse SCREAMING_SNAKE_CASE of serde
            )
            .unwrap();
        };
        if let Some(engine) = &table.engine {
            match engine {
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::S3Queue {
                    s3_path,
                    format,
                    compression,
                    headers,
                    aws_access_key_id,
                    aws_secret_access_key,
                } => {
                    // Generate S3Queue configuration object
                    writeln!(output, "        engine=S3QueueEngine(").unwrap();
                    writeln!(output, "            s3_path={:?},", s3_path).unwrap();
                    writeln!(output, "            format={:?},", format).unwrap();
                    if let Some(compression) = compression {
                        writeln!(output, "            compression={:?},", compression).unwrap();
                    }
                    if let Some(key_id) = aws_access_key_id {
                        writeln!(output, "            aws_access_key_id={:?},", key_id).unwrap();
                    }
                    if let Some(secret) = aws_secret_access_key {
                        writeln!(output, "            aws_secret_access_key={:?},", secret).unwrap();
                    }
                    if let Some(headers) = headers {
                        write!(output, "            headers={{").unwrap();
                        for (i, (key, value)) in headers.iter().enumerate() {
                            if i > 0 { write!(output, ",").unwrap(); }
                            write!(output, " {:?}: {:?}", key, value).unwrap();
                        }
                        writeln!(output, " }},").unwrap();
                    }
                    writeln!(output, "        ),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::MergeTree => {
                    writeln!(output, "        engine=MergeTreeEngine(),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplacingMergeTree => {
                    writeln!(output, "        engine=ReplacingMergeTreeEngine(),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::AggregatingMergeTree => {
                    writeln!(output, "        engine=AggregatingMergeTreeEngine(),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::SummingMergeTree => {
                    writeln!(output, "        engine=SummingMergeTreeEngine(),").unwrap();
                }
            }
        }
        // Add table settings if present (includes mode for S3Queue)
        if let Some(settings) = &table.table_settings {
            if !settings.is_empty() {
                write!(output, "        settings={{").unwrap();
                for (i, (key, value)) in settings.iter().enumerate() {
                    if i > 0 {
                        write!(output, ", ").unwrap();
                    }
                    write!(output, "{:?}: {:?}", key, value).unwrap();
                }
                writeln!(output, "}},").unwrap();
            }
        }
        writeln!(output, "    )").unwrap();
        writeln!(output, "))").unwrap();
        writeln!(output).unwrap();
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, Nested};
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    #[test]
    fn test_tables_to_python() {
        let tables = vec![Table {
            name: "Foo".to_string(),
            columns: vec![
                Column {
                    name: "primary_key".to_string(),
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
                    data_type: ColumnType::Float(FloatType::Float64),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
                Column {
                    name: "optional_text".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
            ],
            order_by: vec!["primary_key".to_string()],
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Foo".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
        }];

        let result = tables_to_python(&tables, None);

        assert!(result.contains(
            r#"from pydantic import BaseModel, Field
from typing import Optional, Any, Annotated
import datetime
import ipaddress
from uuid import UUID
from enum import IntEnum, Enum
from moose_lib import Key, IngestPipeline, IngestPipelineConfig, OlapConfig, clickhouse_datetime64, clickhouse_decimal, ClickhouseSize, StringToEnumMixin
from moose_lib import clickhouse_default, LifeCycle
from moose_lib.blocks import MergeTreeEngine, ReplacingMergeTreeEngine, AggregatingMergeTreeEngine, SummingMergeTreeEngine, S3QueueEngine

class Foo(BaseModel):
    primary_key: Key[str]
    timestamp: float
    optional_text: Optional[str] = None

foo_model = IngestPipeline[Foo]("Foo", IngestPipelineConfig(
    ingest=True,
    stream=True,
    table=OlapConfig(
        order_by_fields=["primary_key"],
        engine=MergeTreeEngine(),
    )
))"#
        ));
    }

    #[test]
    fn test_nested_array_types() {
        let tables = vec![Table {
            name: "NestedArray".to_string(),
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
                    name: "numbers".to_string(),
                    data_type: ColumnType::Array {
                        element_type: Box::new(ColumnType::Int(IntType::Int32)),
                        element_nullable: false,
                    },
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
                Column {
                    name: "nested_numbers".to_string(),
                    data_type: ColumnType::Array {
                        element_type: Box::new(ColumnType::Array {
                            element_type: Box::new(ColumnType::Int(IntType::Int32)),
                            element_nullable: true,
                        }),
                        element_nullable: false,
                    },
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
            ],
            order_by: vec!["id".to_string()],
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "NestedArray".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
        }];

        let result = tables_to_python(&tables, None);
        assert!(result.contains(
            r#"class NestedArray(BaseModel):
    id: Key[str]
    numbers: list[Annotated[int, "int32"]]
    nested_numbers: list[list[Optional[Annotated[int, "int32"]]]]

nested_array_model = IngestPipeline[NestedArray]("NestedArray", IngestPipelineConfig(
    ingest=True,
    stream=True,
    table=OlapConfig(
        order_by_fields=["id"],
        engine=MergeTreeEngine(),
    )
))"#
        ));
    }

    #[test]
    fn test_nested_types() {
        let address_nested = Nested {
            name: "Address".to_string(),
            columns: vec![
                Column {
                    name: "street".to_string(),
                    data_type: ColumnType::String,
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
                Column {
                    name: "city".to_string(),
                    data_type: ColumnType::String,
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
                Column {
                    name: "zipCode".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
            ],
            jwt: false,
        };

        let tables = vec![Table {
            name: "User".to_string(),
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
                    name: "address".to_string(),
                    data_type: ColumnType::Nested(address_nested.clone()),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
                Column {
                    name: "addresses".to_string(),
                    data_type: ColumnType::Array {
                        element_type: Box::new(ColumnType::Nested(address_nested)),
                        element_nullable: false,
                    },
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
            ],
            order_by: vec!["id".to_string()],
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "User".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
        }];

        let result = tables_to_python(&tables, None);
        assert!(result.contains(
            r#"class Address(BaseModel):
    street: str
    city: str
    zipCode: Optional[str] = None

class User(BaseModel):
    id: Key[str]
    address: Address
    addresses: Optional[list[Address]] = None

user_model = IngestPipeline[User]("User", IngestPipelineConfig(
    ingest=True,
    stream=True,
    table=OlapConfig(
        order_by_fields=["id"],
        engine=MergeTreeEngine(),
    )
))"#
        ));
    }

    #[test]
    fn test_s3queue_engine() {
        use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

        let tables = vec![Table {
            name: "Events".to_string(),
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
                    name: "data".to_string(),
                    data_type: ColumnType::String,
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
            ],
            order_by: vec!["id".to_string()],
            engine: Some(ClickhouseEngine::S3Queue {
                s3_path: "s3://bucket/path".to_string(),
                format: "JSONEachRow".to_string(),
                compression: Some("gzip".to_string()),
                headers: None,
                aws_access_key_id: None,
                aws_secret_access_key: None,
            }),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Events".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: Some(
                vec![("mode".to_string(), "unordered".to_string())]
                    .into_iter()
                    .collect(),
            ),
        }];

        let result = tables_to_python(&tables, None);

        // The generated code should have the new engine configuration format
        assert!(result.contains("engine=S3QueueEngine("));
        assert!(result.contains("s3_path=\"s3://bucket/path\""));
        assert!(result.contains("format=\"JSONEachRow\""));
        assert!(result.contains("compression=\"gzip\""));
        assert!(result.contains("settings={\"mode\": \"unordered\"}"));
        assert!(!result.contains("ClickHouseEngines.S3Queue"));
    }

    #[test]
    fn test_table_settings_all_engines() {
        let tables = vec![Table {
            name: "UserData".to_string(),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
            }],
            order_by: vec!["id".to_string()],
            engine: Some(ClickhouseEngine::ReplacingMergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "UserData".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: Some(
                vec![
                    ("index_granularity".to_string(), "4096".to_string()),
                    (
                        "enable_mixed_granularity_parts".to_string(),
                        "1".to_string(),
                    ),
                ]
                .into_iter()
                .collect(),
            ),
        }];

        let result = tables_to_python(&tables, None);

        // Settings should work for all engines, not just S3Queue
        assert!(result.contains("engine=ReplacingMergeTreeEngine(),"));
        assert!(result.contains("index_granularity"));
        assert!(result.contains("enable_mixed_granularity_parts"));
    }

    #[test]
    fn test_named_tuple_types() {
        let tables = vec![Table {
            name: "Location".to_string(),
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
                    name: "coordinates".to_string(),
                    data_type: ColumnType::NamedTuple(vec![
                        ("lat".to_string(), ColumnType::Float(FloatType::Float64)),
                        ("lng".to_string(), ColumnType::Float(FloatType::Float64)),
                    ]),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
                Column {
                    name: "metadata".to_string(),
                    data_type: ColumnType::NamedTuple(vec![
                        ("name".to_string(), ColumnType::String),
                        ("value".to_string(), ColumnType::Int(IntType::Int32)),
                    ]),
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
            ],
            order_by: vec!["id".to_string()],
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Location".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
        }];

        let result = tables_to_python(&tables, None);
        println!("{result}");

        // Check that TypedDict is not in the imports
        assert!(!result.contains("TypedDict"));

        // Check that NamedTuple classes are generated as BaseModel
        assert!(result.contains("class CoordinatesTuple(BaseModel):"));
        assert!(result.contains("class MetadataTuple(BaseModel):"));

        // Check that the main model uses Annotated with ClickHouseNamedTuple
        assert!(
            result.contains("coordinates: Annotated[CoordinatesTuple, \"ClickHouseNamedTuple\"]")
        );
        assert!(result.contains(
            "metadata: Optional[Annotated[MetadataTuple, \"ClickHouseNamedTuple\"]] = None"
        ));

        // Check that tuple fields are properly typed
        assert!(result.contains("    lat: float"));
        assert!(result.contains("    lng: float"));
        assert!(result.contains("    name: str"));
        assert!(result.contains("    value: Annotated[int, \"int32\"]"));
    }
}
