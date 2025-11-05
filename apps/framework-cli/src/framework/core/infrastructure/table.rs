use crate::framework::core::infrastructure_map::PrimitiveSignature;
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::versions::Version;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
use crate::proto::infrastructure_map;
use crate::proto::infrastructure_map::column_type::T;
use crate::proto::infrastructure_map::Decimal as ProtoDecimal;
use crate::proto::infrastructure_map::FloatType as ProtoFloatType;
use crate::proto::infrastructure_map::IntType as ProtoIntType;
use crate::proto::infrastructure_map::LifeCycle as ProtoLifeCycle;
use crate::proto::infrastructure_map::SimpleColumnType;
use crate::proto::infrastructure_map::Table as ProtoTable;
use crate::proto::infrastructure_map::{column_type, DateType};
use crate::proto::infrastructure_map::{ColumnType as ProtoColumnType, Map, Tuple};
use num_traits::ToPrimitive;
use protobuf::well_known_types::wrappers::StringValue;
use protobuf::MessageField;
use serde::de::{Error, IgnoredAny, MapAccess, Visitor};
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::borrow::Cow;
use std::fmt;
use std::fmt::Debug;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Eq, Hash)]
pub struct SourceLocation {
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Eq, Hash)]
pub struct Metadata {
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source: Option<SourceLocation>,
}

/// Prefix for Moose-managed metadata in column comments.
/// This prefix ensures users don't accidentally modify the metadata.
pub const METADATA_PREFIX: &str = "[MOOSE_METADATA:DO_NOT_MODIFY] ";

/// Version number for the metadata format.
/// This allows for future format changes while maintaining backward compatibility.
pub const METADATA_VERSION: u32 = 1;

/// Root structure for column metadata stored in ClickHouse column comments.
///
/// This metadata preserves the original TypeScript enum definitions to solve
/// the false positive diff issue where TypeScript string enums (e.g., `TEXT = 'text'`)
/// get converted to ClickHouse integer enums (e.g., `'text' = 1`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColumnMetadata {
    /// Version of the metadata format
    pub version: u32,
    /// Enum definition (currently the only supported metadata type)
    #[serde(rename = "enum")]
    pub enum_def: EnumMetadata,
    // Future fields can be added here with #[serde(skip_serializing_if = "Option::is_none")]
}

#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct JsonOptions<T = ColumnType> {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_dynamic_paths: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_dynamic_types: Option<u64>,
    #[serde(default)]
    pub typed_paths: Vec<(String, T)>,
    #[serde(default)]
    pub skip_paths: Vec<String>,
    #[serde(default)]
    pub skip_regexps: Vec<String>,
}

impl<T> Default for JsonOptions<T> {
    fn default() -> Self {
        JsonOptions {
            max_dynamic_paths: None,
            max_dynamic_types: None,
            typed_paths: Vec::new(),
            skip_paths: Vec::new(),
            skip_regexps: Vec::new(),
        }
    }
}

impl<T> JsonOptions<T> {
    pub fn is_empty(&self) -> bool {
        self.max_dynamic_paths.is_none()
            && self.max_dynamic_types.is_none()
            && self.typed_paths.is_empty()
            && self.skip_paths.is_empty()
            && self.skip_regexps.is_empty()
    }

    pub fn to_option_strings_with_type_convert<F, E>(
        &self,
        type_converter: F,
    ) -> Result<Vec<String>, E>
    where
        F: Fn(&T) -> Result<String, E>,
    {
        let mut parts: Vec<String> = Vec::new();
        if let Some(n) = self.max_dynamic_paths {
            parts.push(format!("max_dynamic_paths={}", n));
        }
        if let Some(n) = self.max_dynamic_types {
            parts.push(format!("max_dynamic_types={}", n));
        }
        for (path, ty) in &self.typed_paths {
            let ty_str = type_converter(ty)?;
            parts.push(format!("{} {}", path, ty_str));
        }
        for path in &self.skip_paths {
            parts.push(format!("SKIP {}", path));
        }
        for re in &self.skip_regexps {
            let escaped = format!("{:?}", re);
            assert!(escaped.starts_with('\"'));
            assert!(escaped.ends_with('\"'));
            parts.push(format!("SKIP REGEXP '{}'", &escaped[1..escaped.len() - 1]));
        }
        Ok(parts)
    }

    pub fn convert_inner_types<U, F>(self, mut f: F) -> JsonOptions<U>
    where
        F: FnMut(T) -> U,
    {
        JsonOptions {
            max_dynamic_paths: self.max_dynamic_paths,
            max_dynamic_types: self.max_dynamic_types,
            typed_paths: self
                .typed_paths
                .into_iter()
                .map(|(path, ty)| (path, f(ty)))
                .collect(),
            skip_paths: self.skip_paths,
            skip_regexps: self.skip_regexps,
        }
    }
}

impl<T: std::fmt::Display> JsonOptions<T> {
    pub fn to_option_strings(&self) -> Vec<String> {
        self.to_option_strings_with_type_convert::<_, std::convert::Infallible>(|ty| {
            Ok(ty.to_string())
        })
        .unwrap()
    }
}

/// Metadata for an enum type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnumMetadata {
    /// Original enum name from TypeScript
    pub name: String,
    /// List of enum members with their values
    pub members: Vec<EnumMemberMetadata>,
}

/// Metadata for a single enum member
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnumMemberMetadata {
    /// Member name (e.g., "TEXT")
    pub name: String,
    /// Member value (either integer or string)
    pub value: EnumValueMetadata,
}

/// Value of an enum member, supporting both integer and string values
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum EnumValueMetadata {
    /// Integer value for numeric enums
    Int(u8),
    /// String value for string enums
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OrderBy {
    Fields(Vec<String>),
    SingleExpr(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
pub struct TableIndex {
    pub name: String,
    pub expression: String,
    #[serde(rename = "type")]
    pub index_type: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub granularity: u64,
}

impl TableIndex {
    pub fn to_proto(&self) -> crate::proto::infrastructure_map::TableIndex {
        crate::proto::infrastructure_map::TableIndex {
            name: self.name.clone(),
            expression: self.expression.clone(),
            type_: self.index_type.clone(),
            arguments: self.arguments.clone(),
            granularity: self.granularity,
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: crate::proto::infrastructure_map::TableIndex) -> Self {
        TableIndex {
            name: proto.name,
            expression: proto.expression,
            index_type: proto.type_,
            arguments: proto.arguments,
            granularity: proto.granularity,
        }
    }
}

impl PartialEq for OrderBy {
    fn eq(&self, other: &Self) -> bool {
        self.to_expr() == other.to_expr()
    }
}

impl OrderBy {
    pub fn to_expr(&self) -> Cow<'_, str> {
        match self {
            OrderBy::Fields(v) if v.is_empty() => "tuple()".into(),
            OrderBy::Fields(v) if v.len() == 1 => (&v[0]).into(),
            OrderBy::Fields(v) => format!("({})", v.join(", ")).into(),
            OrderBy::SingleExpr(expr) => expr.as_str().into(),
        }
    }

    pub fn is_empty(&self) -> bool {
        matches!(self, OrderBy::Fields(v) if v.is_empty())
    }

    pub fn starts_with_fields(&self, field_names: &[String]) -> bool {
        match self {
            OrderBy::Fields(v) => v.starts_with(field_names),
            OrderBy::SingleExpr(expr) => expr
                .strip_prefix('(')
                .unwrap_or_else(|| expr)
                .starts_with(&field_names.join(", ")),
        }
    }
}

impl std::fmt::Display for OrderBy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrderBy::Fields(v) if v.is_empty() => write!(f, "tuple()"),
            OrderBy::Fields(v) => write!(f, "{}", v.join(", ")),
            OrderBy::SingleExpr(s) => write!(f, "{}", s),
        }
    }
}

/// TODO: This struct is supposed to be a database agnostic abstraction but it is clearly not.
/// The inclusion of ClickHouse-specific engine types makes this leaky.
/// This needs to be fixed in a subsequent PR to properly separate database-specific
/// concerns from the core table abstraction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Table {
    pub name: String,
    pub columns: Vec<Column>,
    pub order_by: OrderBy,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub partition_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sample_by: Option<String>,
    #[serde(default)]
    pub engine: Option<ClickhouseEngine>,
    pub version: Option<Version>,
    pub source_primitive: PrimitiveSignature,
    pub metadata: Option<Metadata>,
    #[serde(default = "LifeCycle::default_for_deserialization")]
    pub life_cycle: LifeCycle,
    /// Hash of engine's non-alterable parameters (including credentials)
    /// Used for change detection without storing sensitive data
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub engine_params_hash: Option<String>,
    /// Table-level settings that can be modified with ALTER TABLE MODIFY SETTING
    /// These are separate from engine constructor parameters
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub table_settings: Option<std::collections::HashMap<String, String>>,
    /// Secondary indexes.
    #[serde(default)]
    pub indexes: Vec<TableIndex>,
    /// Optional database name for multi-database support
    /// When not specified, uses the global ClickHouse config database
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,
    /// Table-level TTL expression (without leading 'TTL')
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub table_ttl_setting: Option<String>,
    /// Optional cluster name for ON CLUSTER support in ClickHouse
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cluster_name: Option<String>,
}

impl Table {
    // This is only to be used in the context of the new core
    // currently name includes the version, here we are separating that out.
    pub fn id(&self, default_database: &str) -> String {
        // Table ID includes database, name, and version
        // - database: Use the configured default_database when None to match explicit database from ClickHouse
        // - This ensures tables with database: None and database: Some(configured_db) have the same ID
        // - Tables in different databases will have different IDs (preventing collisions)

        // Get the database, defaulting to the configured default_database if None
        let db = self.database.as_deref().unwrap_or(default_database);

        // Build base_id with name and optional version
        let base_id = self.version.as_ref().map_or(self.name.clone(), |v| {
            format!("{}_{}", self.name, v.as_suffix())
        });

        // Only include database prefix if name doesn't already contain a dot (fully qualified name)
        if self.name.contains('.') {
            base_id
        } else {
            format!("{}_{}", db, base_id)
        }
    }

    /// Computes a hash of non-alterable parameters including engine params and database
    /// This hash is used for change detection - if it changes, the table must be dropped and recreated
    pub fn compute_non_alterable_params_hash(&self) -> Option<String> {
        use sha2::{Digest, Sha256};

        // Combine engine hash and database into a single hash
        let engine_hash = self.engine.as_ref().map(|e| e.non_alterable_params_hash());

        // If we have neither engine hash nor database, return None
        if engine_hash.is_none() && self.database.is_none() {
            return None;
        }

        // Create a combined hash that includes both engine params and database
        let mut hasher = Sha256::new();

        // Include engine params hash if it exists
        if let Some(ref hash) = engine_hash {
            hasher.update(hash.as_bytes());
        }

        // Include database field
        if let Some(ref db) = self.database {
            hasher.update(b"database:");
            hasher.update(db.as_bytes());
        }

        // Convert to hex string
        Some(format!("{:x}", hasher.finalize()))
    }

    pub fn matches(&self, target_table_name: &str, target_table_version: Option<&Version>) -> bool {
        match target_table_version {
            None => self.name == target_table_name,
            Some(target_v) => {
                let expected_name = format!("{}_{}", target_table_name, target_v.as_suffix());
                self.name == expected_name
            }
        }
    }

    pub fn expanded_display(&self) -> String {
        let columns_str = self
            .columns
            .iter()
            .map(|c| format!("{}: {}", c.name, c.data_type))
            .collect::<Vec<String>>()
            .join(", ");
        let engine_str = self
            .engine
            .as_ref()
            .map(|e| format!(" - engine: {}", Into::<String>::into(e.clone())))
            .unwrap_or_default();
        format!(
            "Table: {} Version {:?} - {} - {}{}",
            self.name, self.version, columns_str, self.order_by, engine_str
        )
    }

    pub fn short_display(&self) -> String {
        format!(
            "Table: {name} Version {version:?}",
            name = self.name,
            version = self.version
        )
    }

    /// Returns the names of all primary key columns in this table
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

    pub fn order_by_equals(&self, target: &Table) -> bool {
        self.order_by == target.order_by
            // target may leave order_by unspecified,
            // but the implicit order_by from primary keys can be the same
            // ONLY for engines that support ORDER BY (MergeTree family and S3)
            // Buffer, S3Queue, and Distributed don't support ORDER BY
            // When engine is None, ClickHouse defaults to MergeTree
            || (target.order_by.is_empty()
                && target.engine.as_ref().is_none_or(|e| e.supports_order_by())
                && matches!(
                    &self.order_by,
                    OrderBy::Fields(v) if v.iter().map(String::as_str).collect::<Vec<_>>() == target.primary_key_columns()
                ))
    }

    pub fn to_proto(&self) -> ProtoTable {
        let proto_order_by: Vec<String> = match &self.order_by {
            OrderBy::Fields(v) => v.clone(),
            OrderBy::SingleExpr(expr) => vec![expr.clone()],
        };

        // Build structured order_by2
        let proto_order_by2 = {
            let t = match &self.order_by {
                OrderBy::Fields(v) => {
                    let fields = crate::proto::infrastructure_map::OrderByFields {
                        field: v.clone(),
                        special_fields: Default::default(),
                    };
                    crate::proto::infrastructure_map::order_by::T::Fields(fields)
                }
                OrderBy::SingleExpr(expr) => {
                    crate::proto::infrastructure_map::order_by::T::Expression(expr.clone())
                }
            };
            crate::proto::infrastructure_map::OrderBy {
                t: Some(t),
                special_fields: Default::default(),
            }
        };

        ProtoTable {
            name: self.name.clone(),
            columns: self.columns.iter().map(|c| c.to_proto()).collect(),
            order_by: proto_order_by,
            partition_by: self.partition_by.clone(),
            sample_by_expression: self.sample_by.clone(),
            version: self.version.as_ref().map(|v| v.to_string()),
            source_primitive: MessageField::some(self.source_primitive.to_proto()),
            deduplicate: self
                .engine
                .as_ref()
                .is_some_and(|e| matches!(e, ClickhouseEngine::ReplacingMergeTree { .. })),
            engine: MessageField::from_option(self.engine.as_ref().map(|engine| StringValue {
                value: engine.clone().to_proto_string(),
                special_fields: Default::default(),
            })),
            order_by2: MessageField::some(proto_order_by2),
            // Store the hash for change detection, including database field
            engine_params_hash: self
                .engine_params_hash
                .clone()
                .or_else(|| self.compute_non_alterable_params_hash()),
            table_settings: self.table_settings.clone().unwrap_or_default(),
            table_ttl_setting: self.table_ttl_setting.clone(),
            cluster_name: self.cluster_name.clone(),
            metadata: MessageField::from_option(self.metadata.as_ref().map(|m| {
                infrastructure_map::Metadata {
                    description: m.description.clone().unwrap_or_default(),
                    source: MessageField::from_option(m.source.as_ref().map(|s| {
                        infrastructure_map::SourceLocation {
                            file: s.file.clone(),
                            special_fields: Default::default(),
                        }
                    })),
                    special_fields: Default::default(),
                }
            })),
            life_cycle: match self.life_cycle {
                LifeCycle::FullyManaged => ProtoLifeCycle::FULLY_MANAGED.into(),
                LifeCycle::DeletionProtected => ProtoLifeCycle::DELETION_PROTECTED.into(),
                LifeCycle::ExternallyManaged => ProtoLifeCycle::EXTERNALLY_MANAGED.into(),
            },
            indexes: self.indexes.iter().map(|i| i.to_proto()).collect(),
            database: self.database.clone(),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoTable) -> Self {
        // First, reconstruct the basic engine from the string representation
        // This gives us the engine type and non-alterable parameters (e.g., S3 path, format)
        let engine = proto
            .engine
            .into_option()
            .and_then(|wrapper| wrapper.value.as_str().try_into().ok())
            .or_else(|| {
                proto
                    .deduplicate
                    .then_some(ClickhouseEngine::ReplacingMergeTree {
                        ver: None,
                        is_deleted: None,
                    })
            });

        // Engine settings are now handled via table_settings field

        let fallback = || -> OrderBy {
            if proto.order_by.len() == 1 {
                let s = proto.order_by[0].clone();
                if s == "tuple()" {
                    OrderBy::SingleExpr(s)
                } else {
                    OrderBy::Fields(vec![s])
                }
            } else {
                OrderBy::Fields(proto.order_by.clone())
            }
        };
        let order_by = match proto.order_by2.into_option() {
            Some(ob2) => match ob2.t {
                Some(crate::proto::infrastructure_map::order_by::T::Fields(f)) => {
                    OrderBy::Fields(f.field)
                }
                Some(crate::proto::infrastructure_map::order_by::T::Expression(e)) => {
                    OrderBy::SingleExpr(e)
                }
                None => fallback(),
            },
            None => fallback(),
        };

        Table {
            name: proto.name,
            columns: proto.columns.into_iter().map(Column::from_proto).collect(),
            order_by,
            partition_by: proto.partition_by,
            sample_by: proto.sample_by_expression,
            version: proto.version.map(Version::from_string),
            source_primitive: PrimitiveSignature::from_proto(proto.source_primitive.unwrap()),
            engine,
            metadata: proto.metadata.into_option().map(|m| Metadata {
                description: if m.description.is_empty() {
                    None
                } else {
                    Some(m.description)
                },
                source: m
                    .source
                    .into_option()
                    .map(|s| SourceLocation { file: s.file }),
            }),
            life_cycle: match proto.life_cycle.enum_value_or_default() {
                ProtoLifeCycle::FULLY_MANAGED => LifeCycle::FullyManaged,
                ProtoLifeCycle::DELETION_PROTECTED => LifeCycle::DeletionProtected,
                ProtoLifeCycle::EXTERNALLY_MANAGED => LifeCycle::ExternallyManaged,
            },
            // Preserve the engine params hash for change detection
            engine_params_hash: proto.engine_params_hash,
            // Load table settings from proto
            table_settings: if !proto.table_settings.is_empty() {
                Some(proto.table_settings)
            } else {
                None
            },
            indexes: proto
                .indexes
                .into_iter()
                .map(TableIndex::from_proto)
                .collect(),
            database: proto.database,
            table_ttl_setting: proto.table_ttl_setting,
            cluster_name: proto.cluster_name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
pub struct Column {
    pub name: String,
    pub data_type: ColumnType,
    // TODO: move `required: false` to `data_type: Nullable(...)`
    pub required: bool,
    pub unique: bool,
    pub primary_key: bool,
    pub default: Option<String>,
    #[serde(default)]
    pub annotations: Vec<(String, Value)>, // workaround for needing to Hash
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub comment: Option<String>, // Column comment for metadata storage
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ttl: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub enum IntType {
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

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub enum FloatType {
    Float32,
    Float64,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub enum ColumnType {
    String,
    FixedString {
        length: u64,
    },
    Boolean,
    Int(IntType),
    BigInt,
    Float(FloatType),
    Decimal {
        precision: u8,
        scale: u8,
    },
    DateTime {
        precision: Option<u8>,
    },
    // Framework's standard date type - maps to ClickHouse `Date32` (4 bytes)
    // Most databases use 4+ bytes for dates, this provides full date range
    Date,
    // Memory-optimized date type - maps to ClickHouse `Date` (2 bytes)
    // Use when storage efficiency is critical and date range 1900-2299 is sufficient
    Date16,
    Enum(DataEnum),
    Array {
        element_type: Box<ColumnType>,
        element_nullable: bool,
    },
    Nullable(Box<ColumnType>),
    NamedTuple(Vec<(String, ColumnType)>),
    Map {
        key_type: Box<ColumnType>,
        value_type: Box<ColumnType>,
    },
    Nested(Nested),
    Json(JsonOptions), // TODO: Eventually support for only views and tables (not topics)
    Bytes,             // TODO: Explore if we ever need this type
    Uuid,
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

impl fmt::Display for ColumnType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ColumnType::String => write!(f, "String"),
            ColumnType::FixedString { length } => write!(f, "FixedString({length})"),
            ColumnType::Boolean => write!(f, "Boolean"),
            ColumnType::Int(int_type) => int_type.fmt(f),
            ColumnType::BigInt => write!(f, "BigInt"),
            ColumnType::Float(float_type) => float_type.fmt(f),
            ColumnType::Decimal { precision, scale } => {
                write!(f, "Decimal({precision}, {scale})")
            }
            ColumnType::DateTime { precision: None } => write!(f, "DateTime"),
            ColumnType::DateTime {
                precision: Some(precision),
            } => write!(f, "DateTime({precision})"),
            ColumnType::Enum(e) => write!(f, "Enum<{}>", e.name),
            ColumnType::Array {
                element_type: inner,
                element_nullable: _,
            } => write!(f, "Array<{inner}>"),
            ColumnType::Nested(n) => write!(f, "Nested<{}>", n.name),
            ColumnType::Json(opts) => {
                if opts.is_empty() {
                    write!(f, "Json")
                } else {
                    let parts = opts.to_option_strings();
                    write!(f, "Json({})", parts.join(", "))
                }
            }
            ColumnType::Bytes => write!(f, "Bytes"),
            ColumnType::Uuid => write!(f, "UUID"),
            ColumnType::Date => write!(f, "Date"),
            ColumnType::Date16 => write!(f, "Date16"),
            ColumnType::IpV4 => write!(f, "IPv4"),
            ColumnType::IpV6 => write!(f, "IPv6"),
            ColumnType::Nullable(inner) => write!(f, "Nullable<{inner}>"),
            ColumnType::NamedTuple(fields) => {
                write!(f, "NamedTuple<")?;
                fields
                    .iter()
                    .try_for_each(|(name, t)| write!(f, "{name}: {t}"))?;
                write!(f, ">")
            }
            ColumnType::Map {
                key_type,
                value_type,
            } => write!(f, "Map<{key_type}, {value_type}>"),
            ColumnType::Point => write!(f, "Point"),
            ColumnType::Ring => write!(f, "Ring"),
            ColumnType::LineString => write!(f, "LineString"),
            ColumnType::MultiLineString => write!(f, "MultiLineString"),
            ColumnType::Polygon => write!(f, "Polygon"),
            ColumnType::MultiPolygon => write!(f, "MultiPolygon"),
        }
    }
}

impl Serialize for ColumnType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            ColumnType::String => serializer.serialize_str("String"),
            ColumnType::FixedString { length } => {
                serializer.serialize_str(&format!("FixedString({length})"))
            }
            ColumnType::Boolean => serializer.serialize_str("Boolean"),
            ColumnType::Int(int_type) => serializer.serialize_str(&format!("{int_type:?}")),
            ColumnType::BigInt => serializer.serialize_str("BigInt"),
            ColumnType::Float(float_type) => serializer.serialize_str(&format!("{float_type:?}")),
            ColumnType::Decimal { precision, scale } => {
                serializer.serialize_str(&format!("Decimal({precision}, {scale})"))
            }
            ColumnType::DateTime { precision: None } => serializer.serialize_str("DateTime"),
            ColumnType::DateTime {
                precision: Some(precision),
            } => serializer.serialize_str(&format!("DateTime({precision})")),
            ColumnType::Enum(data_enum) => {
                let mut state = serializer.serialize_struct("Enum", 2)?;
                state.serialize_field("name", &data_enum.name)?;
                state.serialize_field("values", &data_enum.values)?;
                state.end()
            }
            ColumnType::Array {
                element_type,
                element_nullable,
            } => {
                let mut state = serializer.serialize_struct("Array", 2)?;
                state.serialize_field("elementType", element_type)?;
                state.serialize_field("elementNullable", element_nullable)?;
                state.end()
            }
            ColumnType::Nested(nested) => {
                let mut state = serializer.serialize_struct("Nested", 3)?;
                state.serialize_field("name", &nested.name)?;
                state.serialize_field("columns", &nested.columns)?;
                state.serialize_field("jwt", &nested.jwt)?;
                state.end()
            }
            ColumnType::Json(opts) => opts.serialize(serializer),
            ColumnType::Bytes => serializer.serialize_str("Bytes"),
            ColumnType::Uuid => serializer.serialize_str("UUID"),
            ColumnType::Date => serializer.serialize_str("Date"),
            ColumnType::Date16 => serializer.serialize_str("Date16"),
            ColumnType::IpV4 => serializer.serialize_str("IPv4"),
            ColumnType::IpV6 => serializer.serialize_str("IPv6"),
            ColumnType::NamedTuple(fields) => {
                let mut state = serializer.serialize_struct("NamedTuple", 1)?;
                state.serialize_field("fields", &fields)?;
                state.end()
            }
            ColumnType::Nullable(inner) => {
                let mut state = serializer.serialize_struct("Nullable", 1)?;
                state.serialize_field("nullable", inner)?;
                state.end()
            }
            ColumnType::Map {
                key_type,
                value_type,
            } => {
                let mut state = serializer.serialize_struct("Map", 2)?;
                state.serialize_field("keyType", key_type)?;
                state.serialize_field("valueType", value_type)?;
                state.end()
            }
            ColumnType::Point => serializer.serialize_str("Point"),
            ColumnType::Ring => serializer.serialize_str("Ring"),
            ColumnType::LineString => serializer.serialize_str("LineString"),
            ColumnType::MultiLineString => serializer.serialize_str("MultiLineString"),
            ColumnType::Polygon => serializer.serialize_str("Polygon"),
            ColumnType::MultiPolygon => serializer.serialize_str("MultiPolygon"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
/// An internal framework representation for an enum.
/// Avoiding the use of the `Enum` keyword to avoid conflicts with Prisma's Enum type
pub struct DataEnum {
    pub name: String,
    pub values: Vec<EnumMember>,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq, Hash)]
pub struct Nested {
    pub name: String,
    pub columns: Vec<Column>,
    #[serde(default)]
    pub jwt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
pub struct EnumMember {
    pub name: String,
    pub value: EnumValue,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
pub enum EnumValue {
    Int(u8),
    String(String),
}

struct ColumnTypeVisitor;

impl<'de> Visitor<'de> for ColumnTypeVisitor {
    type Value = ColumnType;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a string or an object for Enum/Array/Nested/Json")
    }

    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
    where
        E: Error,
    {
        let t = if v == "String" {
            ColumnType::String
        } else if v.starts_with("FixedString(") {
            let length = v
                .strip_prefix("FixedString(")
                .and_then(|s| s.strip_suffix(")"))
                .and_then(|s| s.trim().parse::<u64>().ok())
                .ok_or_else(|| E::custom(format!("Invalid FixedString length: {v}")))?;
            ColumnType::FixedString { length }
        } else if v == "Boolean" {
            ColumnType::Boolean
        } else if v == "Int" {
            ColumnType::Int(IntType::Int64)
        } else if v == "Int8" {
            ColumnType::Int(IntType::Int8)
        } else if v == "Int16" {
            ColumnType::Int(IntType::Int16)
        } else if v == "Int32" {
            ColumnType::Int(IntType::Int32)
        } else if v == "Int64" {
            ColumnType::Int(IntType::Int64)
        } else if v == "Int128" {
            ColumnType::Int(IntType::Int128)
        } else if v == "Int256" {
            ColumnType::Int(IntType::Int256)
        } else if v == "UInt8" {
            ColumnType::Int(IntType::UInt8)
        } else if v == "UInt16" {
            ColumnType::Int(IntType::UInt16)
        } else if v == "UInt32" {
            ColumnType::Int(IntType::UInt32)
        } else if v == "UInt64" {
            ColumnType::Int(IntType::UInt64)
        } else if v == "UInt128" {
            ColumnType::Int(IntType::UInt128)
        } else if v == "UInt256" {
            ColumnType::Int(IntType::UInt256)
        } else if v == "BigInt" {
            ColumnType::BigInt
        } else if v == "Float" {
            // usually "float" means single precision, but backwards compatibility
            ColumnType::Float(FloatType::Float64)
        } else if v == "Float32" {
            ColumnType::Float(FloatType::Float32)
        } else if v == "Float64" {
            ColumnType::Float(FloatType::Float64)
        } else if v.starts_with("Decimal") {
            let mut precision = 10;
            let mut scale = 0;

            if v.starts_with("Decimal(") {
                let params = v
                    .trim_start_matches("Decimal(")
                    .trim_end_matches(')')
                    .split(',')
                    .map(|s| s.trim().parse::<u8>())
                    .collect::<Vec<_>>();

                if let Some(Ok(p)) = params.first() {
                    precision = *p;
                }
                if let Some(Ok(s)) = params.get(1) {
                    scale = *s;
                }
            }
            ColumnType::Decimal { precision, scale }
        } else if v == "DateTime" {
            ColumnType::DateTime { precision: None }
        } else if v.starts_with("DateTime(") {
            let precision = v
                .strip_prefix("DateTime(")
                .unwrap()
                .strip_suffix(")")
                .and_then(|p| p.trim().parse::<u8>().ok())
                .ok_or_else(|| E::custom(format!("Invalid DateTime precision: {v}")))?;
            ColumnType::DateTime {
                precision: Some(precision),
            }
        } else if v == "Date" {
            ColumnType::Date
        } else if v == "Date16" {
            ColumnType::Date16
        } else if v == "Json" {
            ColumnType::Json(JsonOptions::default())
        } else if v == "Bytes" {
            ColumnType::Bytes
        } else if v == "UUID" {
            ColumnType::Uuid
        } else if v == "IPv4" {
            ColumnType::IpV4
        } else if v == "IPv6" {
            ColumnType::IpV6
        } else if v == "Point" {
            ColumnType::Point
        } else if v == "Ring" {
            ColumnType::Ring
        } else if v == "LineString" {
            ColumnType::LineString
        } else if v == "MultiLineString" {
            ColumnType::MultiLineString
        } else if v == "Polygon" {
            ColumnType::Polygon
        } else if v == "MultiPolygon" {
            ColumnType::MultiPolygon
        } else {
            return Err(E::custom(format!("Unknown column type {v}.")));
        };
        Ok(t)
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut name = None;
        let mut values = None;
        let mut columns = None;
        let mut fields = None;
        let mut jwt = None;
        let mut nullable_inner = None;

        let mut element_type = None;
        let mut element_nullable = None;
        let mut key_type = None;
        let mut value_type = None;
        // Json options support
        let mut json_max_dynamic_paths: Option<u64> = None;
        let mut json_max_dynamic_types: Option<u64> = None;
        let mut json_typed_paths: Option<Vec<(String, ColumnType)>> = None;
        let mut json_skip_paths: Option<Vec<String>> = None;
        let mut json_skip_regexps: Option<Vec<String>> = None;
        let mut seen_json_options = false;
        while let Some(key) = map.next_key::<String>()? {
            if key == "elementType" || key == "element_type" {
                element_type = Some(map.next_value::<ColumnType>().map_err(|e| {
                    A::Error::custom(format!("Array inner type deserialization error {e}."))
                })?)
            } else if key == "elementNullable" || key == "element_nullable" {
                element_nullable = Some(map.next_value::<bool>()?)
            } else if key == "name" {
                name = Some(map.next_value::<String>()?);
            } else if key == "values" {
                values = Some(map.next_value::<Vec<EnumMember>>()?)
            } else if key == "columns" {
                columns = Some(map.next_value::<Vec<Column>>()?)
            } else if key == "jwt" {
                jwt = Some(map.next_value::<bool>()?)
            } else if key == "fields" {
                fields = Some(map.next_value::<Vec<(String, ColumnType)>>()?)
            } else if key == "nullable" {
                nullable_inner = Some(map.next_value::<ColumnType>()?)
            } else if key == "keyType" || key == "key_type" {
                key_type = Some(map.next_value::<ColumnType>().map_err(|e| {
                    A::Error::custom(format!("Map key type deserialization error {e}."))
                })?)
            } else if key == "valueType" || key == "value_type" {
                value_type = Some(map.next_value::<ColumnType>().map_err(|e| {
                    A::Error::custom(format!("Map value type deserialization error {e}."))
                })?)
            } else if key == "max_dynamic_paths" || key == "maxDynamicPaths" {
                json_max_dynamic_paths = map.next_value::<Option<u64>>()?;
                seen_json_options = true;
            } else if key == "max_dynamic_types" || key == "maxDynamicTypes" {
                json_max_dynamic_types = map.next_value::<Option<u64>>()?;
                seen_json_options = true;
            } else if key == "typed_paths" || key == "typedPaths" {
                json_typed_paths = Some(map.next_value::<Vec<(String, ColumnType)>>()?);
                seen_json_options = true;
            } else if key == "skip_paths" || key == "skipPaths" {
                json_skip_paths = Some(map.next_value::<Vec<String>>()?);
                seen_json_options = true;
            } else if key == "skip_regexps" || key == "skipRegexps" {
                json_skip_regexps = Some(map.next_value::<Vec<String>>()?);
                seen_json_options = true;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        if let Some(inner) = nullable_inner {
            return Ok(ColumnType::Nullable(Box::new(inner)));
        }

        if let Some(fields) = fields {
            return Ok(ColumnType::NamedTuple(fields));
        }

        if let Some(element_type) = element_type {
            return Ok(ColumnType::Array {
                element_type: Box::new(element_type),
                element_nullable: element_nullable.unwrap_or(false),
            });
        }

        if let Some(key_type) = key_type {
            if let Some(value_type) = value_type {
                return Ok(ColumnType::Map {
                    key_type: Box::new(key_type),
                    value_type: Box::new(value_type),
                });
            } else {
                return Err(A::Error::custom("Map type missing valueType field"));
            }
        }

        if seen_json_options {
            return Ok(ColumnType::Json(JsonOptions {
                max_dynamic_paths: json_max_dynamic_paths,
                max_dynamic_types: json_max_dynamic_types,
                typed_paths: json_typed_paths.unwrap_or_default(),
                skip_paths: json_skip_paths.unwrap_or_default(),
                skip_regexps: json_skip_regexps.unwrap_or_default(),
            }));
        }

        let name = name.ok_or(A::Error::custom("Missing field: name."))?;

        // we should probably add a tag to distinguish the object types
        // because we can distinguish them from the field names
        match (values, columns) {
            (None, None) => Err(A::Error::custom("Missing field: values/columns.")),
            (Some(values), _) => Ok(ColumnType::Enum(DataEnum { name, values })),
            (_, Some(columns)) => Ok(ColumnType::Nested(Nested {
                name,
                columns,
                jwt: jwt.unwrap_or(false),
            })),
        }
    }
}

impl<'de> Deserialize<'de> for ColumnType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(ColumnTypeVisitor)
    }
}

pub fn is_enum_type(string_type: &str, enums: &[DataEnum]) -> bool {
    enums.iter().any(|e| e.name == string_type)
}

impl Column {
    pub fn to_proto(&self) -> crate::proto::infrastructure_map::Column {
        crate::proto::infrastructure_map::Column {
            name: self.name.clone(),
            data_type: MessageField::some(self.data_type.to_proto()),
            required: self.required,
            unique: self.unique,
            primary_key: self.primary_key,
            // The enum removed in favor of free-form default expression string,
            // ColumnDefaults::NONE was deserialized the same as 0
            default: 0,
            default_expr: MessageField::from_option(self.default.as_ref().map(|d| StringValue {
                value: d.clone(),
                special_fields: Default::default(),
            })),
            annotations: self
                .annotations
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            comment: self.comment.clone(),
            ttl: self.ttl.clone(),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: crate::proto::infrastructure_map::Column) -> Self {
        let mut annotations: Vec<(String, Value)> = proto
            .annotations
            .into_iter()
            .map(|(k, v)| (k, serde_json::from_str(&v).unwrap()))
            .collect();
        annotations.sort_by(|a, b| a.0.cmp(&b.0));

        Column {
            name: proto.name,
            data_type: ColumnType::from_proto(proto.data_type.unwrap()),
            required: proto.required,
            unique: proto.unique,
            primary_key: proto.primary_key,
            default: proto.default_expr.into_option().map(|w| w.value),
            annotations,
            comment: proto.comment,
            ttl: proto.ttl,
        }
    }
}

impl ColumnType {
    pub fn to_proto(&self) -> ProtoColumnType {
        let t = match self {
            ColumnType::String => column_type::T::Simple(SimpleColumnType::STRING.into()),
            ColumnType::FixedString { length } => column_type::T::FixedString(*length),
            ColumnType::Boolean => column_type::T::Simple(SimpleColumnType::BOOLEAN.into()),
            ColumnType::Int(int_type) => column_type::T::Int(
                (match int_type {
                    IntType::Int8 => ProtoIntType::INT8,
                    IntType::Int16 => ProtoIntType::INT16,
                    IntType::Int32 => ProtoIntType::INT32,
                    IntType::Int64 => ProtoIntType::INT64,
                    IntType::Int128 => ProtoIntType::INT128,
                    IntType::Int256 => ProtoIntType::INT256,
                    IntType::UInt8 => ProtoIntType::UINT8,
                    IntType::UInt16 => ProtoIntType::UINT16,
                    IntType::UInt32 => ProtoIntType::UINT32,
                    IntType::UInt64 => ProtoIntType::UINT64,
                    IntType::UInt128 => ProtoIntType::UINT128,
                    IntType::UInt256 => ProtoIntType::UINT256,
                })
                .into(),
            ),
            ColumnType::BigInt => column_type::T::Simple(SimpleColumnType::BIGINT.into()),
            ColumnType::Float(float_type) => column_type::T::Float(
                (match float_type {
                    FloatType::Float32 => ProtoFloatType::FLOAT32,
                    FloatType::Float64 => ProtoFloatType::FLOAT64,
                })
                .into(),
            ),
            ColumnType::Decimal { precision, scale } => column_type::T::Decimal(ProtoDecimal {
                precision: *precision as i32,
                scale: *scale as i32,
                special_fields: Default::default(),
            }),
            ColumnType::DateTime { precision: None } => {
                column_type::T::Simple(SimpleColumnType::DATETIME.into())
            }
            ColumnType::DateTime {
                precision: Some(precision),
            } => column_type::T::DateTime(DateType {
                precision: (*precision).into(),
                special_fields: Default::default(),
            }),
            ColumnType::Enum(data_enum) => column_type::T::Enum(data_enum.to_proto()),
            ColumnType::Array {
                element_type,
                element_nullable: false,
            } => column_type::T::Array(Box::new(element_type.to_proto())),
            ColumnType::Array {
                element_type,
                element_nullable: true,
            } => column_type::T::ArrayOfNullable(Box::new(element_type.to_proto())),
            ColumnType::Nested(nested) => column_type::T::Nested(nested.to_proto()),
            ColumnType::Json(opts) => {
                column_type::T::Json(crate::proto::infrastructure_map::Json {
                    max_dynamic_paths: opts.max_dynamic_paths,
                    max_dynamic_types: opts.max_dynamic_types,
                    typed_paths: opts
                        .typed_paths
                        .iter()
                        .map(
                            |(path, t)| crate::proto::infrastructure_map::JsonTypedPath {
                                path: path.clone(),
                                type_: MessageField::some(t.to_proto()),
                                special_fields: Default::default(),
                            },
                        )
                        .collect(),
                    skip_paths: opts.skip_paths.clone(),
                    skip_regexps: opts.skip_regexps.clone(),
                    special_fields: Default::default(),
                })
            }
            ColumnType::Bytes => column_type::T::Simple(SimpleColumnType::BYTES.into()),
            ColumnType::Uuid => column_type::T::Simple(SimpleColumnType::UUID_TYPE.into()),
            ColumnType::Date => T::Simple(SimpleColumnType::DATE.into()),
            ColumnType::Date16 => T::Simple(SimpleColumnType::DATE16.into()),
            ColumnType::IpV4 => T::Simple(SimpleColumnType::IPV4.into()),
            ColumnType::IpV6 => T::Simple(SimpleColumnType::IPV6.into()),
            ColumnType::NamedTuple(fields) => T::Tuple(Tuple {
                names: fields.iter().map(|(name, _)| name.clone()).collect(),
                types: fields.iter().map(|(_, t)| t.to_proto()).collect(),
                special_fields: Default::default(),
            }),
            ColumnType::Nullable(inner) => column_type::T::Nullable(Box::new(inner.to_proto())),
            ColumnType::Map {
                key_type,
                value_type,
            } => column_type::T::Map(Map {
                key_type: MessageField::some(key_type.to_proto()),
                value_type: MessageField::some(value_type.to_proto()),
                special_fields: Default::default(),
            }),
            ColumnType::Point => T::Simple(SimpleColumnType::POINT.into()),
            ColumnType::Ring => T::Simple(SimpleColumnType::RING.into()),
            ColumnType::LineString => T::Simple(SimpleColumnType::LINE_STRING.into()),
            ColumnType::MultiLineString => T::Simple(SimpleColumnType::MULTI_LINE_STRING.into()),
            ColumnType::Polygon => T::Simple(SimpleColumnType::POLYGON.into()),
            ColumnType::MultiPolygon => T::Simple(SimpleColumnType::MULTI_POLYGON.into()),
        };
        ProtoColumnType {
            t: Some(t),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoColumnType) -> Self {
        match proto.t.unwrap() {
            column_type::T::Simple(simple) => {
                match simple.enum_value().expect("Invalid simple type") {
                    SimpleColumnType::STRING => ColumnType::String,
                    SimpleColumnType::BOOLEAN => ColumnType::Boolean,
                    SimpleColumnType::INT => ColumnType::Int(IntType::Int64),
                    SimpleColumnType::BIGINT => ColumnType::BigInt,
                    SimpleColumnType::FLOAT => ColumnType::Float(FloatType::Float64),
                    SimpleColumnType::DECIMAL => ColumnType::Decimal {
                        precision: 10,
                        scale: 0,
                    },
                    SimpleColumnType::DATETIME => ColumnType::DateTime { precision: None },
                    SimpleColumnType::JSON_COLUMN => ColumnType::Json(Default::default()),
                    SimpleColumnType::BYTES => ColumnType::Bytes,
                    SimpleColumnType::UUID_TYPE => ColumnType::Uuid,
                    SimpleColumnType::DATE => ColumnType::Date,
                    SimpleColumnType::DATE16 => ColumnType::Date16,
                    SimpleColumnType::IPV4 => ColumnType::IpV4,
                    SimpleColumnType::IPV6 => ColumnType::IpV6,
                    SimpleColumnType::POINT => ColumnType::Point,
                    SimpleColumnType::RING => ColumnType::Ring,
                    SimpleColumnType::LINE_STRING => ColumnType::LineString,
                    SimpleColumnType::MULTI_LINE_STRING => ColumnType::MultiLineString,
                    SimpleColumnType::POLYGON => ColumnType::Polygon,
                    SimpleColumnType::MULTI_POLYGON => ColumnType::MultiPolygon,
                }
            }
            column_type::T::Enum(data_enum) => ColumnType::Enum(DataEnum::from_proto(data_enum)),
            column_type::T::Array(element_type) => ColumnType::Array {
                element_type: Box::new(ColumnType::from_proto(*element_type)),
                element_nullable: false,
            },
            column_type::T::ArrayOfNullable(element_type) => ColumnType::Array {
                element_type: Box::new(ColumnType::from_proto(*element_type)),
                element_nullable: true,
            },
            column_type::T::Nested(nested) => ColumnType::Nested(Nested::from_proto(nested)),
            T::Decimal(d) => ColumnType::Decimal {
                scale: d.scale.to_u8().unwrap(),
                precision: d.precision.to_u8().unwrap(),
            },
            T::Float(f) => ColumnType::Float(match f.enum_value_or(ProtoFloatType::FLOAT64) {
                ProtoFloatType::FLOAT64 => FloatType::Float64,
                ProtoFloatType::FLOAT32 => FloatType::Float32,
            }),
            T::Int(i) => ColumnType::Int(match i.enum_value_or(ProtoIntType::INT64) {
                ProtoIntType::INT64 => IntType::Int64,
                ProtoIntType::INT8 => IntType::Int8,
                ProtoIntType::INT16 => IntType::Int16,
                ProtoIntType::INT32 => IntType::Int32,
                ProtoIntType::INT128 => IntType::Int128,
                ProtoIntType::INT256 => IntType::Int256,
                ProtoIntType::UINT8 => IntType::UInt8,
                ProtoIntType::UINT16 => IntType::UInt16,
                ProtoIntType::UINT32 => IntType::UInt32,
                ProtoIntType::UINT64 => IntType::UInt64,
                ProtoIntType::UINT128 => IntType::UInt128,
                ProtoIntType::UINT256 => IntType::UInt256,
            }),
            T::DateTime(DateType { precision, .. }) => ColumnType::DateTime {
                precision: Some(precision.to_u8().unwrap()),
            },
            T::Tuple(t) if t.names.len() == t.types.len() => ColumnType::NamedTuple(
                t.names
                    .iter()
                    .zip(t.types.iter())
                    .map(|(name, t)| (name.clone(), Self::from_proto(t.clone())))
                    .collect(),
            ),
            T::Tuple(t) if t.names.is_empty() => {
                panic!("Unnamed tuples not supported yet.")
            }
            T::Tuple(_) => {
                panic!("Mismatched length between names and types.")
            }
            T::Nullable(inner) => ColumnType::Nullable(Box::new(Self::from_proto(*inner))),
            T::Map(map) => ColumnType::Map {
                key_type: Box::new(Self::from_proto(map.key_type.clone().unwrap())),
                value_type: Box::new(Self::from_proto(map.value_type.clone().unwrap())),
            },
            T::Json(json) => ColumnType::Json(JsonOptions {
                max_dynamic_paths: json.max_dynamic_paths,
                max_dynamic_types: json.max_dynamic_types,
                typed_paths: json
                    .typed_paths
                    .into_iter()
                    .map(|tp| (tp.path, Self::from_proto(tp.type_.unwrap())))
                    .collect(),
                skip_paths: json.skip_paths,
                skip_regexps: json.skip_regexps,
            }),
            T::FixedString(length) => ColumnType::FixedString { length },
        }
    }
}

impl DataEnum {
    pub fn to_proto(&self) -> crate::proto::infrastructure_map::DataEnum {
        crate::proto::infrastructure_map::DataEnum {
            name: self.name.clone(),
            values: self.values.iter().map(|v| v.to_proto()).collect(),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: crate::proto::infrastructure_map::DataEnum) -> Self {
        DataEnum {
            name: proto.name,
            values: proto
                .values
                .into_iter()
                .map(EnumMember::from_proto)
                .collect(),
        }
    }
}

impl Nested {
    pub fn to_proto(&self) -> crate::proto::infrastructure_map::Nested {
        crate::proto::infrastructure_map::Nested {
            name: self.name.clone(),
            columns: self.columns.iter().map(|c| c.to_proto()).collect(),
            jwt: self.jwt,
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: crate::proto::infrastructure_map::Nested) -> Self {
        Nested {
            name: proto.name,
            columns: proto.columns.into_iter().map(Column::from_proto).collect(),
            jwt: proto.jwt,
        }
    }
}

impl EnumMember {
    pub fn to_proto(&self) -> crate::proto::infrastructure_map::EnumMember {
        crate::proto::infrastructure_map::EnumMember {
            name: self.name.clone(),
            value: MessageField::some(self.value.to_proto()),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: crate::proto::infrastructure_map::EnumMember) -> Self {
        EnumMember {
            name: proto.name,
            value: EnumValue::from_proto(proto.value.unwrap()),
        }
    }
}

impl EnumValue {
    pub fn to_proto(&self) -> crate::proto::infrastructure_map::EnumValue {
        let value = match self {
            EnumValue::Int(i) => {
                crate::proto::infrastructure_map::enum_value::Value::IntValue(*i as i32)
            }
            EnumValue::String(s) => {
                crate::proto::infrastructure_map::enum_value::Value::StringValue(s.clone())
            }
        };
        crate::proto::infrastructure_map::EnumValue {
            value: Some(value),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: crate::proto::infrastructure_map::EnumValue) -> Self {
        match proto.value.unwrap() {
            crate::proto::infrastructure_map::enum_value::Value::IntValue(i) => {
                EnumValue::Int(i as u8)
            }
            crate::proto::infrastructure_map::enum_value::Value::StringValue(s) => {
                EnumValue::String(s)
            }
        }
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::infrastructure::olap::clickhouse::config::DEFAULT_DATABASE_NAME;

    fn serialize_and_deserialize(t: &ColumnType) {
        let json = serde_json::to_string(t).unwrap();
        println!("JSON for {t} is {json}");
        let read: ColumnType = serde_json::from_str(&json).unwrap();
        assert_eq!(&read, t);
    }

    fn test_t(t: ColumnType) {
        serialize_and_deserialize(&t);

        let array = ColumnType::Array {
            element_type: Box::new(t),
            element_nullable: false,
        };
        serialize_and_deserialize(&array);
        let nested_array = ColumnType::Array {
            element_type: Box::new(array),
            element_nullable: false,
        };
        serialize_and_deserialize(&nested_array);
    }

    #[test]
    fn test_column_type_serde() {
        test_t(ColumnType::Boolean);
        test_t(ColumnType::Enum(DataEnum {
            name: "with_string_values".to_string(),
            values: vec![
                EnumMember {
                    name: "up".to_string(),
                    value: EnumValue::String("UP".to_string()),
                },
                EnumMember {
                    name: "down".to_string(),
                    value: EnumValue::String("DOWN".to_string()),
                },
            ],
        }));
        test_t(ColumnType::Enum(DataEnum {
            name: "with_int_values".to_string(),
            values: vec![
                EnumMember {
                    name: "UP".to_string(),
                    value: EnumValue::Int(0),
                },
                EnumMember {
                    name: "DOWN".to_string(),
                    value: EnumValue::Int(1),
                },
            ],
        }));
    }

    #[test]
    fn test_column_with_nested_type() {
        let nested_column = Column {
            name: "nested_column".to_string(),
            data_type: ColumnType::Nested(Nested {
                name: "nested".to_string(),
                columns: vec![],
                jwt: true,
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        };

        let json = serde_json::to_string(&nested_column).unwrap();
        let deserialized: Column = serde_json::from_str(&json).unwrap();
        assert_eq!(nested_column, deserialized);
    }

    #[test]
    fn test_column_proto_with_comment() {
        // Test that comment field is properly serialized/deserialized through proto
        let column_with_comment = Column {
            name: "test_column".to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: Some("[MOOSE_METADATA:DO_NOT_MODIFY] {\"version\":1,\"enum\":{\"name\":\"TestEnum\",\"members\":[]}}".to_string()),
            ttl: None,
        };

        // Convert to proto and back
        let proto = column_with_comment.to_proto();
        let reconstructed = Column::from_proto(proto);

        assert_eq!(column_with_comment, reconstructed);
        assert_eq!(
            reconstructed.comment,
            Some("[MOOSE_METADATA:DO_NOT_MODIFY] {\"version\":1,\"enum\":{\"name\":\"TestEnum\",\"members\":[]}}".to_string())
        );

        // Test without comment
        let column_without_comment = Column {
            name: "test_column".to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        };

        let proto = column_without_comment.to_proto();
        let reconstructed = Column::from_proto(proto);

        assert_eq!(column_without_comment, reconstructed);
        assert_eq!(reconstructed.comment, None);
    }

    #[test]
    fn test_table_id_with_database_field() {
        use crate::framework::core::infrastructure_map::PrimitiveTypes;

        // Test 1: Simple table without database field - uses DEFAULT_DATABASE
        let table1 = Table {
            name: "users".to_string(),
            columns: vec![],
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            engine: None,
            version: None,
            source_primitive: PrimitiveSignature {
                name: "Users".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
        };
        assert_eq!(table1.id(DEFAULT_DATABASE_NAME), "local_users");

        // Test 2: Table with explicit "local" database - should match table1
        let table2 = Table {
            name: "users".to_string(),
            database: Some("local".to_string()),
            ..table1.clone()
        };
        assert_eq!(table2.id(DEFAULT_DATABASE_NAME), "local_users");
        assert_eq!(
            table1.id(DEFAULT_DATABASE_NAME),
            table2.id(DEFAULT_DATABASE_NAME),
            "database: None and database: Some('local') should produce same ID"
        );

        // Test 2b: Table with different database - should have different ID
        let table2b = Table {
            name: "users".to_string(),
            database: Some("analytics".to_string()),
            ..table1.clone()
        };
        assert_eq!(table2b.id(DEFAULT_DATABASE_NAME), "analytics_users");

        // Test 3: Legacy format - table name contains database prefix (backward compatibility)
        let table3 = Table {
            name: "analytics.users".to_string(),
            database: None,
            ..table1.clone()
        };
        assert_eq!(table3.id(DEFAULT_DATABASE_NAME), "analytics.users");

        // Test 4: CRITICAL - Adding database field to legacy format should NOT change ID
        let table4 = Table {
            name: "analytics.users".to_string(),
            database: Some("analytics".to_string()),
            ..table1.clone()
        };
        assert_eq!(
            table4.id(DEFAULT_DATABASE_NAME),
            "analytics.users",
            "ID should remain stable when database field is added to legacy table name format"
        );

        // Test 5: Even with mismatched database, ID should remain stable (name takes precedence)
        let table5 = Table {
            name: "analytics.users".to_string(),
            database: Some("other_db".to_string()),
            ..table1.clone()
        };
        assert_eq!(
            table5.id(DEFAULT_DATABASE_NAME),
            "analytics.users",
            "ID should use name (which contains dot) even if database field differs"
        );

        // Test 6: With version - database should be included
        let table6 = Table {
            name: "users".to_string(),
            version: Some(Version::from_string("1.0".to_string())),
            database: Some("analytics".to_string()),
            ..table1.clone()
        };
        assert_eq!(table6.id(DEFAULT_DATABASE_NAME), "analytics_users_1_0");

        // Test 7: With version and default database
        let table7 = Table {
            name: "users".to_string(),
            version: Some(Version::from_string("1.0".to_string())),
            database: None,
            ..table1.clone()
        };
        assert_eq!(table7.id(DEFAULT_DATABASE_NAME), "local_users_1_0");
    }
}
