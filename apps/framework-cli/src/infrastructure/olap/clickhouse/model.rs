use crate::framework::core::infrastructure::table::{DataEnum, JsonOptions, OrderBy};
use crate::framework::versions::Version;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
use chrono::{DateTime, FixedOffset};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone)]
pub enum ClickHouseTableType {
    Table,
    View,
    MaterializedView,
    Unsupported,
}

impl fmt::Display for ClickHouseTableType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

#[allow(unused)]
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ClickHouseNested {
    name: String,
    columns: Vec<ClickHouseColumn>,
}

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregationFunction<T> {
    pub function_name: String,
    pub argument_types: Vec<T>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ClickHouseColumnType {
    String,
    Boolean,
    ClickhouseInt(ClickHouseInt),
    ClickhouseFloat(ClickHouseFloat),
    Decimal {
        precision: u8,
        scale: u8,
    },
    DateTime,
    Json(JsonOptions<ClickHouseColumnType>),
    Bytes,
    Array(Box<ClickHouseColumnType>),
    Nullable(Box<ClickHouseColumnType>),
    Enum(DataEnum),
    NamedTuple(Vec<(String, ClickHouseColumnType)>),
    Nested(Vec<ClickHouseColumn>),
    AggregateFunction(
        AggregationFunction<ClickHouseColumnType>,
        // the return type of the aggregation function
        Box<ClickHouseColumnType>,
    ),
    SimpleAggregateFunction {
        function_name: String,
        argument_type: Box<ClickHouseColumnType>,
    },
    Map(Box<ClickHouseColumnType>, Box<ClickHouseColumnType>),
    Uuid,
    Date,
    Date32,
    DateTime64 {
        precision: u8,
    },
    LowCardinality(Box<ClickHouseColumnType>),
    IpV4,
    IpV6,
    // Geometry types
    Point,
    Ring,
    LineString,
    MultiLineString,
    Polygon,
    MultiPolygon,
}

impl fmt::Display for ClickHouseColumnType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

impl ClickHouseColumnType {
    pub fn from_type_str(type_str: &str) -> Option<Self> {
        // When we select from `system.columns`, the `Nested` columns are dotted names
        // so it's not handled here
        // unless we change the translation to `Tuple`
        let result = match type_str {
            "String" => Self::String,
            "Bool" | "Boolean" => Self::Boolean,
            // Integer types
            "Int8" => Self::ClickhouseInt(ClickHouseInt::Int8),
            "Int16" => Self::ClickhouseInt(ClickHouseInt::Int16),
            "Int32" => Self::ClickhouseInt(ClickHouseInt::Int32),
            "Int64" => Self::ClickhouseInt(ClickHouseInt::Int64),
            "Int128" => Self::ClickhouseInt(ClickHouseInt::Int128),
            "Int256" => Self::ClickhouseInt(ClickHouseInt::Int256),
            "UInt8" => Self::ClickhouseInt(ClickHouseInt::UInt8),
            "UInt16" => Self::ClickhouseInt(ClickHouseInt::UInt16),
            "UInt32" => Self::ClickhouseInt(ClickHouseInt::UInt32),
            "UInt64" => Self::ClickhouseInt(ClickHouseInt::UInt64),
            "UInt128" => Self::ClickhouseInt(ClickHouseInt::UInt128),
            "UInt256" => Self::ClickhouseInt(ClickHouseInt::UInt256),
            // Float types
            "Float32" => Self::ClickhouseFloat(ClickHouseFloat::Float32),
            "Float64" => Self::ClickhouseFloat(ClickHouseFloat::Float64),

            // Other types
            t if t.starts_with("Decimal(") => {
                let precision_and_scale = t
                    .trim_start_matches("Decimal(")
                    .trim_end_matches(')')
                    .split(',')
                    .map(|s| s.trim().parse::<u8>().ok())
                    .collect::<Vec<Option<u8>>>();

                let default_precision = Some(10);
                let default_scale = Some(0);

                // outer option is existence, inner option is parsing
                // if parsing failed, return None
                let precision = (*precision_and_scale.first().unwrap_or(&default_precision))?;
                let scale = (*precision_and_scale.get(1).unwrap_or(&default_scale))?;
                Self::Decimal { precision, scale }
            }

            t if t.starts_with("DateTime64(") => {
                let precision = t
                    .trim_start_matches("DateTime64(")
                    .trim_end_matches(')')
                    .trim()
                    .parse::<u8>()
                    .ok()?;

                Self::DateTime64 { precision }
            }
            "Date32" => Self::Date32,
            "Date" => Self::Date,
            "IPv4" => Self::IpV4,
            "IPv6" => Self::IpV6,
            // Geometry types
            "Point" => Self::Point,
            "Ring" => Self::Ring,
            "LineString" => Self::LineString,
            "MultiLineString" => Self::MultiLineString,
            "Polygon" => Self::Polygon,
            "MultiPolygon" => Self::MultiPolygon,
            "DateTime" | "DateTime('UTC')" => Self::DateTime,
            t if t.starts_with("JSON(") || t.starts_with("Json(") => {
                let inner = t
                    .trim_start_matches("JSON(")
                    .trim_start_matches("Json(")
                    .trim_end_matches(')');
                let opts = parse_json_options(inner)?;
                Self::Json(opts)
            }
            "JSON" => Self::Json(JsonOptions::default()),

            // recursively parsing Nullable and Array
            t if t.starts_with("Nullable(") => {
                let inner = t.trim_start_matches("Nullable(").trim_end_matches(')');
                match Self::from_type_str(inner) {
                    None => return None,
                    Some(inner_t) => Self::Nullable(Box::new(inner_t)),
                }
            }
            t if t.starts_with("Array(") => {
                let inner = t.trim_start_matches("Array(").trim_end_matches(')');
                match Self::from_type_str(inner) {
                    None => return None,
                    Some(inner_t) => Self::Array(Box::new(inner_t)),
                }
            }

            t if t.starts_with("Tuple(") => {
                let inner = t.trim_start_matches("Tuple(").trim_end_matches(')');
                // Simple parsing for now - assumes format like "name1 Type1, name2 Type2"
                let mut fields = Vec::new();
                for (i, part) in inner.split(',').enumerate() {
                    let part = part.trim();
                    if let Some(space_pos) = part.find(' ') {
                        // Named tuple element: "name Type"
                        let name = part[..space_pos].trim().to_string();
                        let type_str = part[space_pos + 1..].trim();
                        if let Some(field_type) = Self::from_type_str(type_str) {
                            fields.push((name, field_type));
                        } else {
                            return None;
                        }
                    } else {
                        // Unnamed tuple element, use index as name
                        if let Some(field_type) = Self::from_type_str(part) {
                            fields.push((format!("field_{i}"), field_type));
                        } else {
                            return None;
                        }
                    }
                }
                Self::NamedTuple(fields)
            }

            t if t.starts_with("Map(") => {
                let inner = t.trim_start_matches("Map(").trim_end_matches(')');
                let parts: Vec<&str> = inner.split(',').collect();
                if parts.len() == 2 {
                    let key_type_str = parts[0].trim();
                    let value_type_str = parts[1].trim();
                    if let (Some(key_type), Some(value_type)) = (
                        Self::from_type_str(key_type_str),
                        Self::from_type_str(value_type_str),
                    ) {
                        Self::Map(Box::new(key_type), Box::new(value_type))
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }

            t if t.starts_with("Enum8(") || t.starts_with("Enum16(") => {
                let enum_content = type_str
                    .trim_start_matches("Enum8(")
                    .trim_start_matches("Enum16(")
                    .trim_end_matches(')');

                // Use regex to match enum values, handling potential commas in the names
                let re = Regex::new(r"'([^']*)'\s*=\s*(\d+)").unwrap();
                let values = re
                    .captures_iter(enum_content)
                    .map(|cap| {
                        let name = cap[1].to_string();
                        let value = cap[2].parse::<u8>().unwrap_or(0);

                        crate::framework::core::infrastructure::table::EnumMember {
                            name: name.clone(),
                            value: crate::framework::core::infrastructure::table::EnumValue::Int(
                                value,
                            ),
                        }
                    })
                    .collect::<Vec<_>>();

                Self::Enum(DataEnum {
                    name: "Unknown".to_string(),
                    values,
                })
            }
            _ => return None,
        };
        Some(result)
    }
}

fn parse_json_options(inner: &str) -> Option<JsonOptions<ClickHouseColumnType>> {
    let mut opts = JsonOptions::default();
    for part in inner.split(',') {
        let item = part.trim();
        if item.is_empty() {
            continue;
        }
        if let Some(v) = item.strip_prefix("max_dynamic_types=") {
            let n = v.trim().parse::<u64>().ok()?;
            opts.max_dynamic_types = Some(n);
            continue;
        }
        if let Some(v) = item.strip_prefix("max_dynamic_paths=") {
            let n = v.trim().parse::<u64>().ok()?;
            opts.max_dynamic_paths = Some(n);
            continue;
        }
        if let Some(rest) = item.strip_prefix("SKIP REGEXP ") {
            // Extract regex pattern from quotes
            let rest = rest.trim();
            if let Some(pattern) = rest.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')) {
                opts.skip_regexps.push(pattern.to_string());
            } else {
                // Pattern not quoted, use as-is
                opts.skip_regexps.push(rest.to_string());
            }
            continue;
        }
        if let Some(rest) = item.strip_prefix("SKIP ") {
            opts.skip_paths.push(rest.trim().to_string());
            continue;
        }
        // typed path: path<space>Type
        if let Some(space_idx) = item.rfind(' ') {
            let (path, ty_str) = item.split_at(space_idx);
            let path = path.trim();
            let ty_str = ty_str.trim();
            if path.is_empty() || ty_str.is_empty() {
                return None;
            }
            if path.eq_ignore_ascii_case("SKIP") {
                continue;
            }
            if let Some(ty) = ClickHouseColumnType::from_type_str(ty_str) {
                opts.typed_paths.push((path.to_string(), ty));
                continue;
            } else {
                return None;
            }
        }
        return None;
    }
    Some(opts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_json_options_numbers() {
        let t = ClickHouseColumnType::from_type_str(
            "JSON(max_dynamic_types=16, max_dynamic_paths=256)",
        );
        match t {
            Some(ClickHouseColumnType::Json(opts)) => {
                assert_eq!(opts.max_dynamic_types, Some(16));
                assert_eq!(opts.max_dynamic_paths, Some(256));
            }
            _ => panic!("Failed to parse JSON options with numbers"),
        }
    }

    #[test]
    fn test_parse_json_options_typed_and_skip() {
        let t = ClickHouseColumnType::from_type_str("JSON(a.b UInt32, SKIP a.e)");
        match t {
            Some(ClickHouseColumnType::Json(opts)) => {
                assert_eq!(opts.typed_paths.len(), 1);
                assert_eq!(opts.typed_paths[0].0, "a.b");
                assert_eq!(opts.skip_paths, vec!["a.e".to_string()]);
                match &opts.typed_paths[0].1 {
                    ClickHouseColumnType::ClickhouseInt(ClickHouseInt::UInt32) => {}
                    other => panic!("Unexpected type parsed: {:?}", other),
                }
            }
            _ => panic!("Failed to parse JSON options with typed path and skip"),
        }
    }

    #[test]
    fn test_parse_json_options_skip_regexp() {
        let t = ClickHouseColumnType::from_type_str("JSON(SKIP REGEXP '^tmp\\\\.')");
        match t {
            Some(ClickHouseColumnType::Json(opts)) => {
                assert_eq!(opts.skip_regexps.len(), 1);
                assert_eq!(opts.skip_regexps[0], "^tmp\\\\.");
                assert_eq!(opts.skip_paths.len(), 0);
            }
            _ => panic!("Failed to parse JSON options with SKIP REGEXP"),
        }
    }

    #[test]
    fn test_parse_json_options_mixed() {
        let t = ClickHouseColumnType::from_type_str(
            "JSON(max_dynamic_types=16, a.b UInt32, SKIP a.e, SKIP REGEXP '^tmp\\\\.')",
        );
        match t {
            Some(ClickHouseColumnType::Json(opts)) => {
                assert_eq!(opts.max_dynamic_types, Some(16));
                assert_eq!(opts.typed_paths.len(), 1);
                assert_eq!(opts.typed_paths[0].0, "a.b");
                assert_eq!(opts.skip_paths, vec!["a.e".to_string()]);
                assert_eq!(opts.skip_regexps, vec!["^tmp\\\\.".to_string()]);
            }
            _ => panic!("Failed to parse JSON options with mixed configuration"),
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ClickHouseInt {
    Int8,
    Int16,
    Int32,
    Int64,
    Int128,
    Int256,
    UInt8,
    UInt16,
    UInt32,
    UInt64,
    UInt128,
    UInt256,
}

impl fmt::Display for ClickHouseInt {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ClickHouseFloat {
    Float32,
    Float64,
}

impl fmt::Display for ClickHouseFloat {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

// ClickHouse column defaults are expressed as raw SQL strings on the framework side

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ClickHouseColumn {
    pub name: String,
    pub column_type: ClickHouseColumnType,
    pub required: bool,
    pub unique: bool,
    pub primary_key: bool,
    pub default: Option<String>,
    pub comment: Option<String>, // Column comment for metadata storage
    pub ttl: Option<String>,
}

impl ClickHouseColumn {
    pub fn is_array(&self) -> bool {
        matches!(&self.column_type, ClickHouseColumnType::Array(_))
    }
    pub fn is_nested(&self) -> bool {
        matches!(&self.column_type, ClickHouseColumnType::Nested(_))
    }
}

pub enum ClickHouseRuntimeEnum {
    ClickHouseInt(u8),
    ClickHouseString(String),
}

#[derive(Debug, Clone)]
pub enum ClickHouseValue {
    String(String),
    Boolean(String),
    ClickhouseInt(String),
    ClickhouseFloat(String),
    Decimal,
    DateTime(String),
    Json(serde_json::Map<String, serde_json::Value>),
    Bytes,
    Array(Vec<ClickHouseValue>),
    Enum(String),
    Nested(Vec<ClickHouseValue>),
    NamedTuple(Vec<ClickHouseValue>),
    Map(Vec<(ClickHouseValue, ClickHouseValue)>),
    Null,
}

const NULL: &str = "NULL";

// TODO - add support for Decimal, Json, Bytes
impl ClickHouseValue {
    pub fn new_null() -> ClickHouseValue {
        ClickHouseValue::Null
    }

    pub fn new_string(value: String) -> ClickHouseValue {
        ClickHouseValue::String(value)
    }

    pub fn new_boolean(value: bool) -> ClickHouseValue {
        ClickHouseValue::Boolean(format!("{value}"))
    }

    pub fn new_int_64(value: i64) -> ClickHouseValue {
        ClickHouseValue::ClickhouseInt(format!("{value}"))
    }

    pub fn new_number(value: &serde_json::Number) -> ClickHouseValue {
        ClickHouseValue::ClickhouseInt(format!("{value}"))
    }

    pub fn new_float_64(value: f64) -> ClickHouseValue {
        ClickHouseValue::ClickhouseFloat(format!("{value}"))
    }

    pub fn new_date_time(value: DateTime<FixedOffset>) -> ClickHouseValue {
        ClickHouseValue::DateTime(value.to_utc().to_rfc3339().to_string())
    }

    pub fn new_array(value: Vec<ClickHouseValue>) -> ClickHouseValue {
        ClickHouseValue::Array(value)
    }

    pub fn new_enum(value: ClickHouseRuntimeEnum) -> ClickHouseValue {
        match value {
            ClickHouseRuntimeEnum::ClickHouseInt(v) => ClickHouseValue::Enum(format!("{v}")),
            ClickHouseRuntimeEnum::ClickHouseString(v) => ClickHouseValue::Enum(format!("'{v}'")),
        }
    }

    pub fn new_json(map: serde_json::Map<String, serde_json::Value>) -> ClickHouseValue {
        ClickHouseValue::Json(map)
    }

    pub fn new_tuple(members: Vec<ClickHouseValue>) -> ClickHouseValue {
        let vals: Vec<ClickHouseValue> = members;
        ClickHouseValue::NamedTuple(vals)
    }

    pub fn new_map(map: Vec<(ClickHouseValue, ClickHouseValue)>) -> ClickHouseValue {
        ClickHouseValue::Map(map)
    }

    pub fn clickhouse_to_string(&self) -> String {
        match &self {
            ClickHouseValue::String(v) => format!("\'{}\'", escape_ch_string(v)),
            ClickHouseValue::Boolean(v) => v.clone(),
            ClickHouseValue::ClickhouseInt(v) => v.clone(),
            ClickHouseValue::ClickhouseFloat(v) => v.clone(),
            ClickHouseValue::DateTime(v) => format!("'{v}'"),
            ClickHouseValue::Array(v) => format!(
                "[{}]",
                v.iter()
                    .map(|v| v.clickhouse_to_string())
                    .collect::<Vec<String>>()
                    .join(",")
            ),
            ClickHouseValue::Enum(v) => v.clone(),
            ClickHouseValue::Nested(v) => format!(
                "[({})]",
                v.iter()
                    .map(|v| v.clickhouse_to_string())
                    .collect::<Vec<String>>()
                    .join(",")
            ),
            ClickHouseValue::NamedTuple(v) => format!(
                "({})",
                v.iter()
                    .map(|v| v.clickhouse_to_string())
                    .collect::<Vec<String>>()
                    .join(",")
            ),
            ClickHouseValue::Map(v) => format!(
                "{{{}}}",
                v.iter()
                    .map(|(k, v)| format!(
                        "{}: {}",
                        k.clickhouse_to_string(),
                        v.clickhouse_to_string()
                    ))
                    .collect::<Vec<String>>()
                    .join(",")
            ),
            ClickHouseValue::Null => NULL.to_string(),
            ClickHouseValue::Json(v) => {
                format!("'{}'", escape_ch_string(&serde_json::to_string(v).unwrap()))
            }
            _ => String::from(""),
        }
    }
}

fn escape_ch_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\\'")
}

#[derive(Debug, Clone)]
pub struct ClickHouseRecord {
    values: HashMap<String, ClickHouseValue>,
}

impl Default for ClickHouseRecord {
    fn default() -> Self {
        Self::new()
    }
}

impl ClickHouseRecord {
    pub fn new() -> ClickHouseRecord {
        ClickHouseRecord {
            values: HashMap::new(),
        }
    }

    pub fn insert(&mut self, column: String, value: ClickHouseValue) {
        self.values.insert(column, value);
    }

    pub fn get(&self, column: &str) -> Option<&ClickHouseValue> {
        self.values.get(column)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, clickhouse::Row)]
pub struct ClickHouseSystemTableRow {
    #[serde(with = "clickhouse::serde::uuid")]
    pub uuid: uuid::Uuid,
    pub database: String,
    pub name: String,
    pub dependencies_table: Vec<String>,
    pub engine: String,
}

impl ClickHouseSystemTableRow {
    pub fn to_table(&self) -> ClickHouseSystemTable {
        ClickHouseSystemTable {
            uuid: self.uuid.to_string(),
            database: self.database.to_string(),
            name: self.name.to_string(),
            dependencies_table: self.dependencies_table.to_vec(),
            engine: self.engine.to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, clickhouse::Row)]
pub struct ClickHouseSystemTable {
    pub uuid: String,
    pub database: String,
    pub name: String,
    pub dependencies_table: Vec<String>,
    pub engine: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ClickHouseIndex {
    pub name: String,
    pub expression: String,
    pub index_type: String,
    pub arguments: Vec<String>,
    pub granularity: u64,
}

#[derive(Debug, Clone)]
pub struct ClickHouseTable {
    pub name: String,
    pub version: Option<Version>,
    pub columns: Vec<ClickHouseColumn>,
    pub order_by: OrderBy,
    pub partition_by: Option<String>,
    pub sample_by: Option<String>,
    pub engine: ClickhouseEngine,
    /// Table-level settings that can be modified with ALTER TABLE MODIFY SETTING
    pub table_settings: Option<std::collections::HashMap<String, String>>,
    /// Secondary data-skipping or specialized indexes
    pub indexes: Vec<ClickHouseIndex>,
    /// Optional TTL expression at table level (without leading 'TTL')
    pub table_ttl_setting: Option<String>,
}

impl ClickHouseTable {
    pub fn primary_key_columns(&self) -> Vec<&str> {
        self.columns
            .iter()
            .filter_map(|c| {
                if c.primary_key {
                    Some(c.name.as_str())
                } else {
                    None
                }
            })
            .collect()
    }
}

/// Wraps a column name in backticks for safe use in ClickHouse SQL queries
pub fn wrap_column_name(name: &str) -> String {
    format!("`{name}`")
}

/// Wraps multiple column names in backticks and joins them with the specified separator
pub fn wrap_and_join_column_names(names: &[String], separator: &str) -> String {
    names
        .iter()
        .map(|name| wrap_column_name(name))
        .collect::<Vec<String>>()
        .join(separator)
}
