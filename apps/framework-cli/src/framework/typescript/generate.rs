use crate::framework::core::infrastructure::table::{
    ColumnType, DataEnum, EnumValue, FloatType, Nested, OrderBy, Table,
};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::utilities::identifiers as ident;
use convert_case::{Case, Casing};
use itertools::Itertools;
use serde_json::json;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fmt::Write;

// Use shared, language-agnostic sanitization (underscores) from utilities
pub use ident::sanitize_identifier;

/// Map a string to a valid TypeScript PascalCase identifier (for types/classes/consts).
pub fn sanitize_typescript_identifier(name: &str) -> String {
    let preprocessed = sanitize_identifier(name);
    let mut ident = preprocessed.to_case(Case::Pascal);
    if ident.is_empty() || {
        let first = ident.chars().next().unwrap();
        !(first.is_ascii_alphabetic() || first == '_' || first == '$')
    } {
        ident.insert(0, '_');
    }
    ident
}

fn map_column_type_to_typescript(
    column_type: &ColumnType,
    enums: &HashMap<&DataEnum, String>,
    nested: &HashMap<&Nested, String>,
) -> String {
    match column_type {
        ColumnType::String => "string".to_string(),
        ColumnType::Boolean => "boolean".to_string(),
        ColumnType::Int(int_type) => {
            let lowercase_int_type = format!("{int_type:?}").to_lowercase();
            format!("number & ClickHouseInt<\"{lowercase_int_type}\">")
        }
        ColumnType::BigInt => "bigint".to_string(),
        ColumnType::Float(FloatType::Float64) => "number".to_string(),
        ColumnType::Float(FloatType::Float32) => "number & typia.tags.Type<\"float\">".to_string(),
        ColumnType::Decimal { precision, scale } => {
            format!("string & ClickHouseDecimal<{precision}, {scale}>")
        }
        ColumnType::DateTime { precision: None } => "Date".to_string(),
        ColumnType::DateTime {
            precision: Some(precision),
        } => {
            format!("string & typia.tags.Format<\"date-time\"> & ClickHousePrecision<{precision}>")
        }
        // Framework Date (standard) -> ClickHouse Date32 (4 bytes)
        ColumnType::Date => "string & typia.tags.Format<\"date\">".to_string(),
        // Framework Date16 (memory-optimized) -> ClickHouse Date (2 bytes)
        ColumnType::Date16 => {
            "string & typia.tags.Format<\"date\"> & ClickHouseByteSize<2>".to_string()
        }
        ColumnType::Enum(data_enum) => enums.get(data_enum).unwrap().to_string(),
        ColumnType::Array {
            element_type,
            element_nullable,
        } => {
            let mut inner_type = map_column_type_to_typescript(element_type, enums, nested);
            if *element_nullable {
                inner_type = format!("({inner_type} | undefined)")
            };
            if inner_type.contains(' ') {
                inner_type = format!("({inner_type})")
            }
            format!("{inner_type}[]")
        }
        ColumnType::Nested(nested_type) => nested.get(nested_type).unwrap().to_string(),
        ColumnType::Json => "Record<string, any>".to_string(),
        ColumnType::Bytes => "Uint8Array".to_string(),
        ColumnType::Uuid => "string & typia.tags.Format<\"uuid\">".to_string(),
        ColumnType::IpV4 => "string & typia.tags.Format<\"ipv4\">".to_string(),
        ColumnType::IpV6 => "string & typia.tags.Format<\"ipv6\">".to_string(),
        ColumnType::Nullable(inner) => {
            let inner_type = map_column_type_to_typescript(inner, enums, nested);
            format!("{inner_type} | undefined")
        }
        ColumnType::NamedTuple(fields) => {
            let mut field_types = Vec::new();
            for (name, field_type) in fields {
                let type_str = map_column_type_to_typescript(field_type, enums, nested);
                field_types.push(format!("{name}: {type_str}"));
            }
            format!("{{ {} }} & ClickHouseNamedTuple", field_types.join("; "))
        }
        ColumnType::Point => "ClickHousePoint".to_string(),
        ColumnType::Ring => "ClickHouseRing".to_string(),
        ColumnType::LineString => "ClickHouseLineString".to_string(),
        ColumnType::MultiLineString => "ClickHouseMultiLineString".to_string(),
        ColumnType::Polygon => "ClickHousePolygon".to_string(),
        ColumnType::MultiPolygon => "ClickHouseMultiPolygon".to_string(),
        ColumnType::Map {
            key_type,
            value_type,
        } => {
            let key_type_str = map_column_type_to_typescript(key_type, enums, nested);
            let value_type_str = map_column_type_to_typescript(value_type, enums, nested);
            format!("Record<{key_type_str}, {value_type_str}>")
        }
    }
}

fn generate_enum(data_enum: &DataEnum, name: &str) -> String {
    let mut enum_def = String::new();
    writeln!(enum_def, "export enum {name} {{").unwrap();
    for member in &data_enum.values {
        match &member.value {
            EnumValue::Int(i) => {
                if member.name.chars().all(char::is_numeric) {
                    writeln!(enum_def, "    // \"{}\" = {},", member.name, i).unwrap()
                } else {
                    writeln!(enum_def, "    \"{}\" = {},", member.name, i).unwrap()
                }
            }
            EnumValue::String(s) => writeln!(enum_def, "    {} = \"{}\",", member.name, s).unwrap(),
        }
    }
    writeln!(enum_def, "}}").unwrap();
    writeln!(enum_def).unwrap();
    enum_def
}

fn quote_name_if_needed(column_name: &str) -> String {
    // Valid TS identifier: /^[A-Za-z_$][A-Za-z0-9_$]*$/ and not a TS keyword
    // We conservatively quote if it doesn't match identifier pattern or contains any non-identifier chars
    let mut chars = column_name.chars();
    let first_ok = match chars.next() {
        Some(c) => c.is_ascii_alphabetic() || c == '_' || c == '$',
        None => false,
    };
    let rest_ok = first_ok
        && column_name
            .chars()
            .skip(1)
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if !rest_ok || is_typescript_keyword(column_name) {
        format!("'{column_name}'")
    } else {
        column_name.to_string()
    }
}

fn is_typescript_keyword(name: &str) -> bool {
    // Minimal set to avoid false negatives; quoting keywords is always safe
    const KEYWORDS: &[&str] = &[
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "debugger",
        "default",
        "delete",
        "do",
        "else",
        "enum",
        "export",
        "extends",
        "false",
        "finally",
        "for",
        "function",
        "if",
        "import",
        "in",
        "instanceof",
        "new",
        "null",
        "return",
        "super",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "typeof",
        "var",
        "void",
        "while",
        "with",
        "as",
        "implements",
        "interface",
        "let",
        "package",
        "private",
        "protected",
        "public",
        "static",
        "yield",
        "any",
        "boolean",
        "constructor",
        "declare",
        "get",
        "module",
        "require",
        "number",
        "set",
        "string",
        "symbol",
        "type",
        "from",
        "of",
        "readonly",
        "unknown",
        "never",
    ];
    KEYWORDS.binary_search_by(|k| k.cmp(&name)).is_ok()
}

fn generate_interface(
    nested: &Nested,
    name: &str,
    enums: &HashMap<&DataEnum, String>,
    nested_models: &HashMap<&Nested, String>,
) -> String {
    let mut interface = String::new();
    writeln!(interface, "export interface {name} {{").unwrap();

    for column in &nested.columns {
        let type_str = map_column_type_to_typescript(&column.data_type, enums, nested_models);
        let type_str = if column.primary_key {
            format!("Key<{type_str}>")
        } else {
            type_str
        };
        let type_str = if !column.required {
            format!("{type_str} | undefined")
        } else {
            type_str
        };
        let name = quote_name_if_needed(&column.name);
        writeln!(interface, "    {name}: {type_str};").unwrap();
    }
    writeln!(interface, "}}").unwrap();
    writeln!(interface).unwrap();
    interface
}

pub fn tables_to_typescript(tables: &[Table], life_cycle: Option<LifeCycle>) -> String {
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
    let mut base_imports = vec![
        "IngestPipeline",
        "OlapTable",
        "Key",
        "ClickHouseInt",
        "ClickHouseDecimal",
        "ClickHousePrecision",
        "ClickHouseByteSize",
        "ClickHouseNamedTuple",
        "ClickHouseEngines",
        "ClickHouseDefault",
        "WithDefault",
        "LifeCycle",
    ];

    if uses_simple_aggregate {
        base_imports.push("SimpleAggregated");
    }

    writeln!(
        output,
        "import {{ {} }} from \"@514labs/moose-lib\";",
        base_imports.join(", ")
    )
    .unwrap();

    writeln!(
        output,
        "import {{ ClickHousePoint, ClickHouseRing, ClickHouseLineString, ClickHouseMultiLineString, ClickHousePolygon, ClickHouseMultiPolygon }} from \"@514labs/moose-lib\";"
    )
        .unwrap();
    writeln!(output, "import typia from \"typia\";").unwrap();
    writeln!(output).unwrap();

    // Collect all enums and nested types
    let mut enums: HashMap<&DataEnum, String> = HashMap::new();
    let mut extra_type_names: HashMap<String, usize> = HashMap::new();
    let mut nested_models: HashMap<&Nested, String> = HashMap::new();

    // First pass: collect all nested types and enums
    for table in tables {
        for column in &table.columns {
            match &column.data_type {
                ColumnType::Enum(data_enum) => {
                    if !enums.contains_key(data_enum) {
                        let name = sanitize_typescript_identifier(&column.name);
                        let name = match extra_type_names.entry(name.clone()) {
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
                        let name = sanitize_typescript_identifier(&column.name);
                        let name = match extra_type_names.entry(name.clone()) {
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
                _ => {}
            }
        }
    }

    // Generate enum definitions
    for (data_enum, name) in enums.iter() {
        output.push_str(&generate_enum(data_enum, name));
    }

    // Generate nested interface definitions
    for (nested, name) in nested_models.iter() {
        output.push_str(&generate_interface(nested, name, &enums, &nested_models));
    }

    // Generate model interfaces
    for table in tables {
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

        writeln!(output, "export interface {} {{", table.name).unwrap();

        for column in &table.columns {
            let mut type_str =
                map_column_type_to_typescript(&column.data_type, &enums, &nested_models);

            if let Some((_, simple_agg_func)) = column
                .annotations
                .iter()
                .find(|(k, _)| k == "simpleAggregationFunction")
            {
                if let Some(function_name) =
                    simple_agg_func.get("functionName").and_then(|v| v.as_str())
                {
                    type_str = format!(
                        "{} & SimpleAggregated<{:?}, {}>",
                        type_str, function_name, type_str
                    );
                }
            }

            let type_str = match column.default {
                None => type_str,
                Some(ref default) if type_str == "Date" => {
                    // https://github.com/samchon/typia/issues/1658
                    format!("WithDefault<{type_str}, {:?}>", default)
                }
                Some(ref default) => {
                    format!("{type_str} & ClickHouseDefault<{:?}>", default)
                }
            };
            let type_str = if can_use_key_wrapping && column.primary_key {
                format!("Key<{type_str}>")
            } else {
                type_str
            };
            let type_str = if !column.required {
                format!("{type_str} | undefined")
            } else {
                type_str
            };
            let name = quote_name_if_needed(&column.name);
            writeln!(output, "    {name}: {type_str};").unwrap();
        }
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    // Generate table configurations
    for table in tables {
        let order_by_spec = match &table.order_by {
            OrderBy::Fields(v) if v.is_empty() => "orderByExpression: \"tuple()\"".to_string(),
            OrderBy::Fields(v) => {
                format!(
                    "orderByFields: [{}]",
                    v.iter().map(|name| format!("{:?}", name)).join(", ")
                )
            }
            OrderBy::SingleExpr(expr) => format!("orderByExpression: {:?}", expr),
        };
        let var_name = sanitize_typescript_identifier(&table.name);
        writeln!(
            output,
            "export const {}Table = new OlapTable<{}>(\"{}\", {{",
            var_name, table.name, table.name
        )
        .unwrap();
        writeln!(output, "    {order_by_spec},").unwrap();
        if let Some(partition_by) = &table.partition_by {
            writeln!(output, "    partitionBy: {:?},", partition_by).unwrap();
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
                    // For S3Queue, properties are at the same level as orderByFields
                    writeln!(output, "    engine: ClickHouseEngines.S3Queue,").unwrap();
                    writeln!(output, "    s3Path: {:?},", s3_path).unwrap();
                    writeln!(output, "    format: {:?},", format).unwrap();
                    if let Some(compression) = compression {
                        writeln!(output, "    compression: {:?},", compression).unwrap();
                    }
                    if let Some(key_id) = aws_access_key_id {
                        writeln!(output, "    awsAccessKeyId: {:?},", key_id).unwrap();
                    }
                    if let Some(secret) = aws_secret_access_key {
                        writeln!(output, "    awsSecretAccessKey: {:?},", secret).unwrap();
                    }
                    if let Some(headers) = headers {
                        write!(output, "    headers: {{").unwrap();
                        for (i, (key, value)) in headers.iter().enumerate() {
                            if i > 0 { write!(output, ",").unwrap(); }
                            write!(output, " {:?}: {:?}", key, value).unwrap();
                        }
                        writeln!(output, " }},").unwrap();
                    }
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::MergeTree => {
                    writeln!(output, "    engine: ClickHouseEngines.MergeTree,").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplacingMergeTree { ver, is_deleted } => {
                    // Emit ReplacingMergeTree engine configuration
                    writeln!(output, "    engine: ClickHouseEngines.ReplacingMergeTree,").unwrap();
                    if let Some(ver_col) = ver {
                        writeln!(output, "    ver: \"{}\",", ver_col).unwrap();
                    }
                    if let Some(is_deleted_col) = is_deleted {
                        writeln!(output, "    isDeleted: \"{}\",", is_deleted_col).unwrap();
                    }
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::AggregatingMergeTree => {
                    writeln!(output, "    engine: ClickHouseEngines.AggregatingMergeTree,").unwrap();
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::SummingMergeTree { columns } => {
                    writeln!(output, "    engine: ClickHouseEngines.SummingMergeTree,").unwrap();
                    if let Some(cols) = columns {
                        if !cols.is_empty() {
                            let col_list = cols.iter().map(|c| format!("{:?}", c)).collect::<Vec<_>>().join(", ");
                            writeln!(output, "    columns: [{}],", col_list).unwrap();
                        }
                    }
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplicatedMergeTree { keeper_path, replica_name } => {
                    writeln!(output, "    engine: ClickHouseEngines.ReplicatedMergeTree,").unwrap();
                    if let (Some(path), Some(name)) = (keeper_path, replica_name) {
                        writeln!(output, "    keeperPath: {:?},", path).unwrap();
                        writeln!(output, "    replicaName: {:?},", name).unwrap();
                    }
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplicatedReplacingMergeTree { keeper_path, replica_name, ver, is_deleted } => {
                    writeln!(output, "    engine: ClickHouseEngines.ReplicatedReplacingMergeTree,").unwrap();
                    if let (Some(path), Some(name)) = (keeper_path, replica_name) {
                        writeln!(output, "    keeperPath: {:?},", path).unwrap();
                        writeln!(output, "    replicaName: {:?},", name).unwrap();
                    }
                    if let Some(ver_col) = ver {
                        writeln!(output, "    ver: {:?},", ver_col).unwrap();
                    }
                    if let Some(is_deleted_col) = is_deleted {
                        writeln!(output, "    isDeleted: {:?},", is_deleted_col).unwrap();
                    }
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplicatedAggregatingMergeTree { keeper_path, replica_name } => {
                    writeln!(output, "    engine: ClickHouseEngines.ReplicatedAggregatingMergeTree,").unwrap();
                    if let (Some(path), Some(name)) = (keeper_path, replica_name) {
                        writeln!(output, "    keeperPath: {:?},", path).unwrap();
                        writeln!(output, "    replicaName: {:?},", name).unwrap();
                    }
                }
                crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine::ReplicatedSummingMergeTree { keeper_path, replica_name, columns } => {
                    writeln!(output, "    engine: ClickHouseEngines.ReplicatedSummingMergeTree,").unwrap();
                    if let (Some(path), Some(name)) = (keeper_path, replica_name) {
                        writeln!(output, "    keeperPath: {:?},", path).unwrap();
                        writeln!(output, "    replicaName: {:?},", name).unwrap();
                    }
                    if let Some(cols) = columns {
                        if !cols.is_empty() {
                            let col_list = cols.iter().map(|c| format!("{:?}", c)).collect::<Vec<_>>().join(", ");
                            writeln!(output, "    columns: [{}],", col_list).unwrap();
                        }
                    }
                }
            }
        }
        // Add table settings if present (works for all engines)
        if let Some(settings) = &table.table_settings {
            if !settings.is_empty() {
                write!(output, "    settings: {{").unwrap();
                for (i, (key, value)) in settings.iter().enumerate() {
                    if i > 0 {
                        write!(output, ",").unwrap();
                    }
                    write!(output, " {}: {:?}", key, value).unwrap();
                }
                writeln!(output, " }},").unwrap();
            }
        }
        if let Some(life_cycle) = life_cycle {
            writeln!(
                output,
                "    lifeCycle: LifeCycle.{},",
                json!(life_cycle).as_str().unwrap() // reuse SCREAMING_SNAKE_CASE of serde
            )
            .unwrap();
        };
        writeln!(output, "}});").unwrap();
        writeln!(output).unwrap();
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{
        Column, ColumnType, EnumMember, Nested, OrderBy,
    };
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

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
                    name: "zip_code".to_string(),
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
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
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

        let result = tables_to_typescript(&tables, None);
        println!("{result}");
        assert!(result.contains(
            r#"export interface Address {
    street: string;
    city: string;
    zip_code: string | undefined;
}

export interface User {
    id: Key<string>;
    address: Address;
    addresses: Address[] | undefined;
}

export const UserTable = new OlapTable<User>("User", {
    orderByFields: ["id"],
    engine: ClickHouseEngines.MergeTree,
});"#
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
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
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

        let result = tables_to_typescript(&tables, None);

        // The generated code should have S3Queue properties at the same level as orderByFields
        assert!(result.contains("engine: ClickHouseEngines.S3Queue,"));
        assert!(result.contains("s3Path: \"s3://bucket/path\""));
        assert!(result.contains("format: \"JSONEachRow\""));
        assert!(result.contains("compression: \"gzip\""));
        assert!(result.contains("settings: { mode: \"unordered\" }"));
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
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            engine: Some(ClickhouseEngine::MergeTree),
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
                    ("index_granularity".to_string(), "8192".to_string()),
                    ("merge_with_ttl_timeout".to_string(), "3600".to_string()),
                ]
                .into_iter()
                .collect(),
            ),
        }];

        let result = tables_to_typescript(&tables, None);

        // Settings should work for all engines, not just S3Queue
        assert!(result.contains("engine: ClickHouseEngines.MergeTree,"));
        assert!(result.contains("index_granularity"));
        assert!(result.contains("merge_with_ttl_timeout"));
    }

    #[test]
    fn test_replacing_merge_tree_with_parameters() {
        use crate::framework::core::infrastructure::table::IntType;
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
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
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
        }];

        let result = tables_to_typescript(&tables, None);

        // Check that ver and isDeleted parameters are correctly generated
        assert!(result.contains("engine: ClickHouseEngines.ReplacingMergeTree,"));
        assert!(result.contains("ver: \"version\","));
        assert!(result.contains("isDeleted: \"is_deleted\","));
    }

    #[test]
    fn test_replicated_merge_tree_flat_structure() {
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
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            engine: Some(ClickhouseEngine::ReplicatedMergeTree {
                keeper_path: Some("/clickhouse/tables/{shard}/user_data".to_string()),
                replica_name: Some("{replica}".to_string()),
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
        }];

        let result = tables_to_typescript(&tables, None);
        println!("{result}");

        // Ensure flat structure is generated (NOT nested engine: { engine: ... })
        assert!(result.contains("engine: ClickHouseEngines.ReplicatedMergeTree,"));
        assert!(result.contains("keeperPath: \"/clickhouse/tables/{shard}/user_data\","));
        assert!(result.contains("replicaName: \"{replica}\","));

        // Ensure it doesn't contain the incorrect nested structure
        assert!(!result.contains("engine: {"));
        assert!(!result.contains("engine: ClickHouseEngines.ReplicatedMergeTree,\n    }"));
    }

    #[test]
    fn test_replicated_replacing_merge_tree_flat_structure() {
        use crate::framework::core::infrastructure::table::IntType;
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
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            engine: Some(ClickhouseEngine::ReplicatedReplacingMergeTree {
                keeper_path: Some("/clickhouse/tables/{shard}/user_data".to_string()),
                replica_name: Some("{replica}".to_string()),
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
        }];

        let result = tables_to_typescript(&tables, None);
        println!("{result}");

        // Ensure flat structure with all parameters
        assert!(result.contains("engine: ClickHouseEngines.ReplicatedReplacingMergeTree,"));
        assert!(result.contains("keeperPath: \"/clickhouse/tables/{shard}/user_data\","));
        assert!(result.contains("replicaName: \"{replica}\","));
        assert!(result.contains("ver: \"version\","));
        assert!(result.contains("isDeleted: \"is_deleted\","));

        // Ensure it doesn't contain the incorrect nested structure
        assert!(!result.contains("engine: {"));
    }

    #[test]
    fn test_enum_types() {
        let status_enum = DataEnum {
            name: "Status".to_string(),
            values: vec![
                EnumMember {
                    name: "OK".to_string(),
                    value: EnumValue::String("ok".to_string()),
                },
                EnumMember {
                    name: "ERROR".to_string(),
                    value: EnumValue::String("error".to_string()),
                },
            ],
        };

        let tables = vec![Table {
            name: "Task".to_string(),
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
                    name: "status".to_string(),
                    data_type: ColumnType::Enum(status_enum),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Task".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
        }];

        let result = tables_to_typescript(&tables, None);
        println!("{result}");
        assert!(result.contains(
            r#"export enum Status {
    OK = "ok",
    ERROR = "error",
}

export interface Task {
    id: Key<string>;
    status: Status;
}

export const TaskTable = new OlapTable<Task>("Task", {
    orderByFields: ["id"],
    engine: ClickHouseEngines.MergeTree,
});"#
        ));
    }
}
