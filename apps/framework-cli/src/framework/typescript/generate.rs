use crate::framework::core::infrastructure::table::{
    ColumnType, DataEnum, EnumValue, FloatType, Nested, Table,
};
use convert_case::{Case, Casing};
use itertools::Itertools;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fmt::Write;

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
        ColumnType::Date => "string & typia.tags.Format<\"date\">".to_string(),
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
        writeln!(interface, "    {}: {};", column.name, type_str).unwrap();
    }
    writeln!(interface, "}}").unwrap();
    writeln!(interface).unwrap();
    interface
}

pub fn tables_to_typescript(tables: &[Table]) -> String {
    let mut output = String::new();

    // Add imports
    writeln!(
        output,
        "import {{ IngestPipeline, Key, ClickHouseInt, ClickHouseDecimal, ClickHousePrecision, ClickHouseByteSize, ClickHouseNamedTuple, ClickHouseEngines, ClickHouseDefault, WithDefault }} from \"@514labs/moose-lib\";"
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
                        let name = column.name.to_case(Case::Pascal);
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
                        let name = column.name.to_case(Case::Pascal);
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
        let can_use_key_wrapping = table.order_by.starts_with(primary_key.as_slice());

        writeln!(output, "export interface {} {{", table.name).unwrap();

        for column in &table.columns {
            let type_str = map_column_type_to_typescript(&column.data_type, &enums, &nested_models);
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
            writeln!(output, "    {}: {};", column.name, type_str).unwrap();
        }
        writeln!(output, "}}").unwrap();
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
            "export const {}Pipeline = new IngestPipeline<{}>(\"{}\", {{",
            table.name.to_case(Case::Pascal),
            table.name,
            table.name
        )
        .unwrap();
        writeln!(output, "    table: {{").unwrap();
        writeln!(output, "        orderByFields: [{order_by_fields}],").unwrap();
        if let Some(engine) = &table.engine {
            writeln!(output, "        engine: ClickHouseEngines.{:?},", engine).unwrap();
        }
        writeln!(output, "    }}").unwrap();
        writeln!(output, "    stream: true,").unwrap();
        writeln!(output, "    ingest: true,").unwrap();
        writeln!(output, "}});").unwrap();
        writeln!(output).unwrap();
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, EnumMember, Nested};
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
            order_by: vec!["id".to_string()],
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "User".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
        }];

        let result = tables_to_typescript(&tables);
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

export const UserPipeline = new IngestPipeline<User>("User", {
    table: {
        orderByFields: ["id"],
        engine: ClickHouseEngines.MergeTree,
    }
    stream: true,
    ingest: true,
});"#
        ));
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
            order_by: vec!["id".to_string()],
            engine: Some(ClickhouseEngine::MergeTree),
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Task".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
        }];

        let result = tables_to_typescript(&tables);
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

export const TaskPipeline = new IngestPipeline<Task>("Task", {
    table: {
        orderByFields: ["id"],
        engine: ClickHouseEngines.MergeTree,
    }
    stream: true,
    ingest: true,
});"#
        ));
    }
}
