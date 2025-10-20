use crate::framework::core::infrastructure::table::{
    ColumnType, DataEnum, EnumValue, FloatType, IntType, Nested, OrderBy, Table,
};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::utilities::identifiers as ident;
use convert_case::{Case, Casing};
use itertools::Itertools;
use regex::Regex;
use serde_json::json;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fmt::Write;
use std::sync::LazyLock;

/// Language-agnostic sanitization: replace common separators with spaces to create word boundaries.
pub use ident::sanitize_identifier;

/// Map a string to a valid Python snake_case identifier (for variables/constants).
pub fn map_to_python_snake_identifier(name: &str) -> String {
    let preprocessed = sanitize_identifier(name);
    let mut ident = preprocessed.to_case(Case::Snake);
    if ident.is_empty() {
        ident.insert(0, '_');
    } else {
        let first = ident.chars().next().unwrap();
        if !(first.is_ascii_alphabetic() || first == '_') {
            ident.insert(0, '_');
        }
    }
    ident
}

/// Converts an arbitrary string into a valid Python class name.
///
/// This performs sanitization (replace separators with spaces/underscores) and
/// applies case mapping to PascalCase, ensuring the resulting identifier starts
/// with an alphabetic character or underscore.
pub fn map_to_python_class_name(name: &str) -> String {
    let preprocessed = sanitize_identifier(name);
    let mut ident = preprocessed.to_case(Case::Pascal);
    if ident.is_empty() {
        ident.push('_');
    } else {
        let first = ident.chars().next().unwrap();
        if !(first.is_ascii_alphabetic() || first == '_') {
            ident.insert(0, '_');
        }
    }
    ident
}

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
            FloatType::Float32 => "Annotated[float, \"float32\"]".to_string(),
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
        ColumnType::Point => "Point".to_string(),
        ColumnType::Ring => "Ring".to_string(),
        ColumnType::LineString => "LineString".to_string(),
        ColumnType::MultiLineString => "MultiLineString".to_string(),
        ColumnType::Polygon => "Polygon".to_string(),
        ColumnType::MultiPolygon => "MultiPolygon".to_string(),
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

fn sanitize_name(name: &str, required: bool) -> (String, String) {
    // Valid Python identifier: ^[A-Za-z_][A-Za-z0-9_]*$
    // Alias anything that doesn't conform or collides with keywords/builtins
    let mut chars = name.chars();
    let first_ok = match chars.next() {
        Some(c) => c.is_ascii_alphabetic() || c == '_',
        None => false,
    };
    let rest_ok = first_ok
        && name
            .chars()
            .skip(1)
            .all(|c| c.is_ascii_alphanumeric() || c == '_');
    let needs_alias = !rest_ok || is_python_keyword(name) || name.starts_with('_');
    if needs_alias {
        let mapped = name
            .trim_start_matches('_')
            .replace([' ', '.', '-', '/', ':', ';', ',', '\\'], "_");
        let mapped = if mapped.is_empty() {
            "field".to_string()
        } else if is_python_keyword(&mapped) {
            format!("field_{}", mapped)
        } else {
            mapped
        };
        let default_suffix = if !required {
            format!(" = Field(default=None, alias=\"{name}\")")
        } else {
            format!(" = Field(alias=\"{name}\")")
        };
        (mapped, default_suffix)
    } else {
        (
            name.to_string(),
            (if required { "" } else { " = None" }).to_string(),
        )
    }
}

fn is_python_keyword(name: &str) -> bool {
    // conservative list
    const KEYWORDS: &[&str] = &[
        "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
        "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
        "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
        "try", "while", "with", "yield",
    ];
    KEYWORDS.binary_search_by(|k| k.cmp(&name)).is_ok()
}

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

        let type_str = if !column.required {
            format!("Optional[{type_str}]")
        } else {
            type_str
        };

        let (mapped_name, mapped_default) = sanitize_name(&column.name, column.required);

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
                let name = map_to_python_class_name(name);
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
                let name = map_to_python_class_name(name);
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
                let name = format!("{}Tuple", map_to_python_class_name(name));
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

    let uses_simple_aggregate = tables.iter().any(|table| {
        table.columns.iter().any(|column| {
            column
                .annotations
                .iter()
                .any(|(k, _)| k == "simpleAggregationFunction")
        })
    });

    // Add imports
    writeln!(output, "from pydantic import BaseModel, Field").unwrap();
    writeln!(output, "from typing import Optional, Any, Annotated").unwrap();
    writeln!(output, "import datetime").unwrap();
    writeln!(output, "import ipaddress").unwrap();
    writeln!(output, "from uuid import UUID").unwrap();
    writeln!(output, "from enum import IntEnum, Enum").unwrap();

    let mut moose_lib_imports = vec![
        "Key",
        "IngestPipeline",
        "IngestPipelineConfig",
        "OlapTable",
        "OlapConfig",
        "clickhouse_datetime64",
        "clickhouse_decimal",
        "ClickhouseSize",
        "StringToEnumMixin",
    ];

    if uses_simple_aggregate {
        moose_lib_imports.push("simple_aggregated");
    }

    writeln!(
        output,
        "from moose_lib import {}",
        moose_lib_imports.join(", ")
    )
    .unwrap();
    writeln!(
        output,
        "from moose_lib import Point, Ring, LineString, MultiLineString, Polygon, MultiPolygon"
    )
    .unwrap();
    writeln!(
        output,
        "from moose_lib import clickhouse_default, LifeCycle, ClickHouseTTL"
    )
    .unwrap();
    writeln!(
        output,
        "from moose_lib.blocks import MergeTreeEngine, ReplacingMergeTreeEngine, AggregatingMergeTreeEngine, SummingMergeTreeEngine, S3QueueEngine, ReplicatedMergeTreeEngine, ReplicatedReplacingMergeTreeEngine, ReplicatedAggregatingMergeTreeEngine, ReplicatedSummingMergeTreeEngine"
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
        let can_use_key_wrapping = table.order_by.starts_with_fields(&primary_key);

        for column in &table.columns {
            let type_str =
                map_column_type_to_python(&column.data_type, &enums, &nested_models, &named_tuples);

            let mut type_str = if !column.required {
                format!("Optional[{type_str}]")
            } else {
                type_str
            };

            if let Some((_, simple_agg_func)) = column
                .annotations
                .iter()
                .find(|(k, _)| k == "simpleAggregationFunction")
            {
                if let Some(function_name) =
                    simple_agg_func.get("functionName").and_then(|v| v.as_str())
                {
                    type_str = format!("simple_aggregated({:?}, {})", function_name, type_str);
                }
            }

            if let Some(ref ttl_expr) = column.ttl {
                type_str = format!("Annotated[{}, ClickHouseTTL({:?})]", type_str, ttl_expr);
            }
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

            let (mapped_name, mapped_default) = sanitize_name(&column.name, column.required);

            writeln!(output, "    {mapped_name}: {type_str}{mapped_default}").unwrap();
        }
        writeln!(output).unwrap();
    }

    // Generate pipeline configurations
    for table in tables {
        let order_by_spec = match &table.order_by {
            OrderBy::Fields(v) if v.is_empty() => "order_by_expression=\"tuple()\"".to_string(),
            OrderBy::Fields(v) => {
                format!(
                    "order_by_fields=[{}]",
                    v.iter().map(|name| format!("{:?}", name)).join(", ")
                )
            }
            OrderBy::SingleExpr(expr) => format!("order_by_expression={:?}", expr),
        };

        let var_name = map_to_python_snake_identifier(&table.name);
        writeln!(
            output,
            "{}_table = OlapTable[{}](\"{}\", OlapConfig(",
            var_name, table.name, table.name
        )
        .unwrap();
        writeln!(output, "    {order_by_spec},").unwrap();
        if let Some(partition_by) = &table.partition_by {
            writeln!(output, "    partition_by={:?},", partition_by).unwrap();
        }
        if let Some(sample_by) = &table.sample_by {
            writeln!(output, "    sample_by_expression={:?},", sample_by).unwrap();
        }
        if let Some(life_cycle) = life_cycle {
            writeln!(
                output,
                "    life_cycle=LifeCycle.{},",
                json!(life_cycle).as_str().unwrap(), // reuse SCREAMING_SNAKE_CASE of serde
            )
            .unwrap();
        };
        if let Some(ttl_expr) = &table.table_ttl_setting {
            writeln!(output, "    ttl={:?},", ttl_expr).unwrap();
        }
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
                    writeln!(output, "    engine=S3QueueEngine(").unwrap();
                    writeln!(output, "        s3_path={:?},", s3_path).unwrap();
                    writeln!(output, "        format={:?},", format).unwrap();
                    if let Some(compression) = compression {
                        writeln!(output, "        compression={:?},", compression).unwrap();
                    }
                    if let Some(key_id) = aws_access_key_id {
                        writeln!(output, "        aws_access_key_id={:?},", key_id).unwrap();
                    }
                    if let Some(secret) = aws_secret_access_key {
                        writeln!(output, "        aws_secret_access_key={:?},", secret).unwrap();
                    }
                    if let Some(headers) = headers {
                        write!(output, "        headers={{").unwrap();
                        for (i, (key, value)) in headers.iter().enumerate() {
                            if i > 0 { write!(output, ",").unwrap(); }
                            write!(output, " {:?}: {:?}", key, value).unwrap();
                        }
                        writeln!(output, " }},").unwrap();
                    }
                    writeln!(output, "    ),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::MergeTree => {
                    writeln!(output, "    engine=MergeTreeEngine(),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplacingMergeTree { ver, is_deleted } => {
                    // Emit ReplacingMergeTreeEngine with parameters if present
                    write!(output, "    engine=ReplacingMergeTreeEngine(").unwrap();
                    if let Some(ver_col) = ver {
                        write!(output, "ver=\"{}\"", ver_col).unwrap();
                        if is_deleted.is_some() {
                            write!(output, ", ").unwrap();
                        }
                    }
                    if let Some(is_deleted_col) = is_deleted {
                        write!(output, "is_deleted=\"{}\"", is_deleted_col).unwrap();
                    }
                    writeln!(output, "),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::AggregatingMergeTree => {
                    writeln!(output, "    engine=AggregatingMergeTreeEngine(),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::SummingMergeTree { columns } => {
                    write!(output, "    engine=SummingMergeTreeEngine(").unwrap();
                    if let Some(cols) = columns {
                        if !cols.is_empty() {
                            write!(output, "columns={:?}", cols).unwrap();
                        }
                    }
                    writeln!(output, "),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplicatedMergeTree {
                    keeper_path,
                    replica_name,
                } => {
                    write!(output, "    engine=ReplicatedMergeTreeEngine(").unwrap();
                    if let (Some(path), Some(name)) = (keeper_path, replica_name) {
                        write!(output, "keeper_path={:?}, replica_name={:?}", path, name).unwrap();
                    }
                    writeln!(output, "),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplicatedReplacingMergeTree {
                    keeper_path,
                    replica_name,
                    ver,
                    is_deleted,
                } => {
                    write!(output, "    engine=ReplicatedReplacingMergeTreeEngine(").unwrap();
                    let mut params = vec![];
                    if let (Some(path), Some(name)) = (keeper_path, replica_name) {
                        params.push(format!("keeper_path={:?}, replica_name={:?}", path, name));
                    }
                    if let Some(v) = ver {
                        params.push(format!("ver={:?}", v));
                    }
                    if let Some(d) = is_deleted {
                        params.push(format!("is_deleted={:?}", d));
                    }
                    write!(output, "{}", params.join(", ")).unwrap();
                    writeln!(output, "),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplicatedAggregatingMergeTree {
                    keeper_path,
                    replica_name,
                } => {
                    write!(output, "    engine=ReplicatedAggregatingMergeTreeEngine(").unwrap();
                    if let (Some(path), Some(name)) = (keeper_path, replica_name) {
                        write!(output, "keeper_path={:?}, replica_name={:?}", path, name).unwrap();
                    }
                    writeln!(output, "),").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplicatedSummingMergeTree {
                    keeper_path,
                    replica_name,
                    columns,
                } => {
                    write!(output, "    engine=ReplicatedSummingMergeTreeEngine(").unwrap();
                    let mut params = vec![];
                    if let (Some(path), Some(name)) = (keeper_path, replica_name) {
                        params.push(format!("keeper_path={:?}, replica_name={:?}", path, name));
                    }
                    if let Some(cols) = columns {
                        if !cols.is_empty() {
                            params.push(format!("columns={:?}", cols));
                        }
                    }
                    write!(output, "{}", params.join(", ")).unwrap();
                    writeln!(output, "),").unwrap();
                }
            }
        }
        // Add table settings if present (includes mode for S3Queue)
        if let Some(settings) = &table.table_settings {
            if !settings.is_empty() {
                write!(output, "    settings={{").unwrap();
                for (i, (key, value)) in settings.iter().enumerate() {
                    if i > 0 {
                        write!(output, ", ").unwrap();
                    }
                    write!(output, "{:?}: {:?}", key, value).unwrap();
                }
                writeln!(output, "}},").unwrap();
            }
        }

        if !table.indexes.is_empty() {
            writeln!(output, "    indexes=[").unwrap();
            for idx in &table.indexes {
                // arguments optional
                if idx.arguments.is_empty() {
                    writeln!(
                        output,
                        "        OlapConfig.TableIndex(name={:?}, expression={:?}, type={:?}, granularity={}),",
                        idx.name, idx.expression, idx.index_type, idx.granularity
                    )
                    .unwrap();
                } else {
                    write!(
                        output,
                        "        OlapConfig.TableIndex(name={:?}, expression={:?}, type={:?}, arguments=[",
                        idx.name, idx.expression, idx.index_type
                    )
                    .unwrap();
                    for (i, a) in idx.arguments.iter().enumerate() {
                        if i > 0 {
                            write!(output, ", ").unwrap();
                        }
                        write!(output, "{:?}", a).unwrap();
                    }
                    writeln!(output, "], granularity={}),", idx.granularity).unwrap();
                }
            }
            writeln!(output, "    ],").unwrap();
        }
        writeln!(output, "))").unwrap();
        writeln!(output).unwrap();
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, Nested, OrderBy};
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
                    ttl: None,
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
                    ttl: None,
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
                    ttl: None,
                },
            ],
            order_by: OrderBy::Fields(vec!["primary_key".to_string()]),
            partition_by: None,
            sample_by: None,
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
            indexes: vec![],
            table_ttl_setting: None,
        }];

        let result = tables_to_python(&tables, None);

        assert!(result.contains(
            r#"from pydantic import BaseModel, Field
from typing import Optional, Any, Annotated
import datetime
import ipaddress
from uuid import UUID
from enum import IntEnum, Enum
from moose_lib import Key, IngestPipeline, IngestPipelineConfig, OlapTable, OlapConfig, clickhouse_datetime64, clickhouse_decimal, ClickhouseSize, StringToEnumMixin
from moose_lib import Point, Ring, LineString, MultiLineString, Polygon, MultiPolygon
from moose_lib import clickhouse_default, LifeCycle, ClickHouseTTL
from moose_lib.blocks import MergeTreeEngine, ReplacingMergeTreeEngine, AggregatingMergeTreeEngine, SummingMergeTreeEngine, S3QueueEngine, ReplicatedMergeTreeEngine, ReplicatedReplacingMergeTreeEngine, ReplicatedAggregatingMergeTreeEngine, ReplicatedSummingMergeTreeEngine

class Foo(BaseModel):
    primary_key: Key[str]
    timestamp: float
    optional_text: Optional[str] = None

foo_table = OlapTable[Foo]("Foo", OlapConfig(
    order_by_fields=["primary_key"],
    engine=MergeTreeEngine(),
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
                    ttl: None,
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
                    ttl: None,
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
                    ttl: None,
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
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
            indexes: vec![],
            table_ttl_setting: None,
        }];

        let result = tables_to_python(&tables, None);
        let is_ok = result.contains(
            r#"class NestedArray(BaseModel):
    id: Key[str]
    numbers: list[Annotated[int, "int32"]]
    nested_numbers: list[list[Optional[Annotated[int, "int32"]]]]

nested_array_table = OlapTable[NestedArray]("NestedArray", OlapConfig(
    order_by_fields=["id"],
    engine=MergeTreeEngine(),
))"#,
        );
        if !is_ok {
            println!("{}", result);
        }
        assert!(is_ok);
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
                    ttl: None,
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
                    ttl: None,
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
                    ttl: None,
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
                    ttl: None,
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
                    ttl: None,
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
                    ttl: None,
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
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
            indexes: vec![],
            table_ttl_setting: None,
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

user_table = OlapTable[User]("User", OlapConfig(
    order_by_fields=["id"],
    engine=MergeTreeEngine(),
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
                    ttl: None,
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
                    ttl: None,
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
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
            indexes: vec![],
            table_ttl_setting: None,
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
                ttl: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine: Some(ClickhouseEngine::ReplacingMergeTree {
                ver: None,
                is_deleted: None,
            }),
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
            indexes: vec![],
            table_ttl_setting: None,
        }];

        let result = tables_to_python(&tables, None);

        // Settings should work for all engines, not just S3Queue
        assert!(result.contains("engine=ReplacingMergeTreeEngine(),"));
        assert!(result.contains("index_granularity"));
        assert!(result.contains("enable_mixed_granularity_parts"));
    }

    #[test]
    fn test_replacing_merge_tree_with_parameters() {
        let tables = vec![Table {
            name: "UserData".to_string(),
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
                    name: "version".to_string(),
                    data_type: ColumnType::DateTime { precision: None },
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                },
                Column {
                    name: "is_deleted".to_string(),
                    data_type: ColumnType::Int(IntType::UInt8),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine: Some(ClickhouseEngine::ReplacingMergeTree {
                ver: Some("version".to_string()),
                is_deleted: Some("is_deleted".to_string()),
            }),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "UserData".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            table_ttl_setting: None,
        }];

        let result = tables_to_python(&tables, None);

        // Check that ver and is_deleted parameters are correctly generated
        assert!(result.contains(
            "engine=ReplacingMergeTreeEngine(ver=\"version\", is_deleted=\"is_deleted\"),"
        ));
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
                    ttl: None,
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
                    ttl: None,
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
                    ttl: None,
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
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
            indexes: vec![],
            table_ttl_setting: None,
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

    #[test]
    fn test_ttl_generation_python() {
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
                    ttl: None,
                },
                Column {
                    name: "timestamp".to_string(),
                    data_type: ColumnType::DateTime { precision: None },
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                },
                Column {
                    name: "email".to_string(),
                    data_type: ColumnType::String,
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: Some("timestamp + INTERVAL 30 DAY".to_string()),
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string(), "timestamp".to_string()]),
            partition_by: None,
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Events".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            table_ttl_setting: Some("timestamp + INTERVAL 90 DAY DELETE".to_string()),
        }];

        let result = tables_to_python(&tables, None);

        // Import should include ClickHouseTTL
        assert!(result.contains("ClickHouseTTL"));
        // Column-level TTL should be applied via Annotated
        assert!(result
            .contains("email: Annotated[str, ClickHouseTTL(\"timestamp + INTERVAL 30 DAY\")]"));
        // Table-level TTL should be present in OlapConfig
        assert!(result.contains("ttl=\"timestamp + INTERVAL 90 DAY DELETE\","));
    }

    #[test]
    fn test_indexes_emission() {
        let tables = vec![Table {
            name: "IndexPy".to_string(),
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
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "IndexPy".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![
                crate::framework::core::infrastructure::table::TableIndex {
                    name: "idx1".to_string(),
                    expression: "id".to_string(),
                    index_type: "bloom_filter".to_string(),
                    arguments: vec![],
                    granularity: 3,
                },
                crate::framework::core::infrastructure::table::TableIndex {
                    name: "idx2".to_string(),
                    expression: "length(id)".to_string(),
                    index_type: "ngrambf_v1".to_string(),
                    arguments: vec![
                        "2".to_string(),
                        "256".to_string(),
                        "1".to_string(),
                        "123".to_string(),
                    ],
                    granularity: 1,
                },
            ],
        }];

        let result = tables_to_python(&tables, None);
        assert!(result.contains("indexes=["));
        assert!(result.contains("name=\"idx1\""));
        assert!(result.contains("type=\"bloom_filter\""));
        assert!(result.contains("granularity=3"));
        assert!(result.contains("name=\"idx2\""));
        assert!(result.contains("arguments=[\"2\", \"256\", \"1\", \"123\"]"));
    }
}
