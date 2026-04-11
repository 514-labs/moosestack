//! ClickHouse Dictionary infrastructure component.
//!
//! This module provides a structured representation of ClickHouse Dictionaries,
//! which are in-memory key-value stores for fast lookups backed by various data sources.
//!
//! A Dictionary consists of:
//! - A data source (local ClickHouse table/query or external system)
//! - A primary key (single-column for simple layouts, multi-column for COMPLEX_KEY_* layouts)
//! - A set of attribute columns with optional DEFAULT/EXPRESSION/INJECTIVE/HIERARCHICAL attributes
//! - A layout type (FLAT, HASHED, CACHE, etc.) controlling memory structure
//! - A lifetime policy controlling refresh frequency
//!
//! This structured representation allows for:
//! - Zero-downtime updates via `CREATE OR REPLACE DICTIONARY`
//! - Accurate dependency tracking (dictionaries that depend on tables)
//! - Lifecycle-aware change management

use protobuf::MessageField;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::proto::infrastructure_map::LifeCycle as ProtoLifeCycle;
use crate::proto::infrastructure_map::{
    dictionary_external_source, dictionary_layout, dictionary_lifetime, olap_dictionary,
    DictionaryClickHouseSource as ProtoDictionaryClickHouseSource,
    DictionaryColumn as ProtoDictionaryColumn,
    DictionaryExecutableSource as ProtoDictionaryExecutableSource,
    DictionaryExternalSource as ProtoDictionaryExternalSource,
    DictionaryHttpSource as ProtoDictionaryHttpSource, DictionaryLayout as ProtoDictionaryLayout,
    DictionaryLifetime as ProtoDictionaryLifetime,
    DictionaryMongoDbSource as ProtoDictionaryMongoDbSource,
    DictionaryMysqlSource as ProtoDictionaryMysqlSource,
    DictionaryPostgresqlSource as ProtoDictionaryPostgresqlSource,
    DictionaryQuerySource as ProtoDictionaryQuerySource,
    DictionaryRangeLifetime as ProtoDictionaryRangeLifetime,
    DictionaryRedisSource as ProtoDictionaryRedisSource,
    DictionaryS3Source as ProtoDictionaryS3Source,
    DictionaryTableSource as ProtoDictionaryTableSource, OlapDictionary as ProtoOlapDictionary,
};

use crate::framework::core::infrastructure::table::{deserialize_nullable_as_default, Metadata};
use crate::framework::core::infrastructure::{DataLineage, InfrastructureSignature};
use crate::framework::versions::Version;

// ─── Column attributes ────────────────────────────────────────────────────────

/// A single attribute column in a ClickHouse dictionary.
///
/// Dictionary columns differ from table columns: they hold lookup values
/// rather than primary-key fields. Each column can carry special ClickHouse
/// attributes: DEFAULT, EXPRESSION, IS_INJECTIVE, IS_HIERARCHICAL, IS_OBJECT_ID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryColumn {
    /// Column name
    pub name: String,

    /// ClickHouse type string, e.g. "UInt64", "String", "Nullable(String)"
    pub type_string: String,

    /// DEFAULT expression — fallback value when key is not found
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub default_value: Option<String>,

    /// EXPRESSION attribute — computed from other columns
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub expression: Option<String>,

    /// IS_INJECTIVE — enables GROUP BY optimization (one-to-one key→value mapping)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub is_injective: Option<bool>,

    /// IS_HIERARCHICAL — enables hierarchical parent-child lookups
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub is_hierarchical: Option<bool>,

    /// IS_OBJECT_ID — MongoDB-specific attribute
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub is_object_id: Option<bool>,

    /// Optional column comment
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub comment: Option<String>,
}

impl DictionaryColumn {
    /// Generate the DDL fragment for this column inside the `(...)` column list
    pub fn to_ddl(&self) -> String {
        let mut parts = vec![format!("`{}` {}", self.name, self.type_string)];

        if let Some(ref default) = self.default_value {
            parts.push(format!("DEFAULT {}", default));
        }
        if let Some(ref expr) = self.expression {
            parts.push(format!("EXPRESSION {}", expr));
        }
        if self.is_injective == Some(true) {
            parts.push("IS_INJECTIVE 1".to_string());
        }
        if self.is_hierarchical == Some(true) {
            parts.push("IS_HIERARCHICAL 1".to_string());
        }
        if self.is_object_id == Some(true) {
            parts.push("IS_OBJECT_ID 1".to_string());
        }
        if let Some(ref c) = self.comment {
            parts.push(format!("COMMENT '{}'", escape_clickhouse_string(c)));
        }

        parts.join(" ")
    }

    pub fn to_proto(&self) -> ProtoDictionaryColumn {
        ProtoDictionaryColumn {
            name: self.name.clone(),
            type_string: self.type_string.clone(),
            default_value: self.default_value.clone(),
            expression: self.expression.clone(),
            is_injective: self.is_injective,
            is_hierarchical: self.is_hierarchical,
            is_object_id: self.is_object_id,
            comment: self.comment.clone(),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoDictionaryColumn) -> Self {
        Self {
            name: proto.name,
            type_string: proto.type_string,
            default_value: proto.default_value,
            expression: proto.expression,
            is_injective: proto.is_injective,
            is_hierarchical: proto.is_hierarchical,
            is_object_id: proto.is_object_id,
            comment: proto.comment,
        }
    }
}

// ─── Data sources ─────────────────────────────────────────────────────────────

/// Read from a local ClickHouse table on the same server.
///
/// Translates to: `SOURCE(CLICKHOUSE(TABLE 'name' DB 'db' [WHERE '...'] [INVALIDATE_QUERY '...']))`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryTableSource {
    /// Source table name
    pub table: String,
    /// Source database (None = default database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,
    /// Optional WHERE clause for row filtering
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub where_clause: Option<String>,
    /// Optional invalidation query (if result unchanged, skip reload)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub invalidate_query: Option<String>,
}

/// Read from an arbitrary SQL query on the same ClickHouse server.
///
/// Translates to: `SOURCE(CLICKHOUSE(QUERY 'SELECT ...' [INVALIDATE_QUERY '...']))`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryQuerySource {
    /// The SELECT query
    pub query: String,
    /// Optional invalidation query
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub invalidate_query: Option<String>,
}

/// Remote ClickHouse server as dictionary source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryClickHouseSource {
    pub host: String,
    pub port: u32,
    pub user: String,
    pub password: String,
    pub db: String,
    pub table: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub where_clause: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub invalidate_query: Option<String>,
}

/// MySQL database as dictionary source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryMysqlSource {
    pub host: String,
    pub port: u32,
    pub user: String,
    pub password: String,
    pub db: String,
    pub table: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub where_clause: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub invalidate_query: Option<String>,
}

/// PostgreSQL database as dictionary source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryPostgresqlSource {
    pub host: String,
    pub port: u32,
    pub user: String,
    pub password: String,
    pub db: String,
    pub table: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub where_clause: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub invalidate_query: Option<String>,
}

/// Redis as dictionary source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryRedisSource {
    pub host: String,
    pub port: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub db_index: Option<u32>,
    /// Storage type: "simple", "hash", "range_hashed", etc.
    pub storage_type: String,
}

/// MongoDB collection as dictionary source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryMongoDbSource {
    pub host: String,
    pub port: u32,
    pub user: String,
    pub password: String,
    pub db: String,
    pub collection: String,
}

/// External executable process as dictionary source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryExecutableSource {
    pub command: String,
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub implicit_key: Option<bool>,
}

/// S3 object storage as dictionary source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryS3Source {
    pub url: String,
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub access_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub secret_access_key: Option<String>,
}

/// HTTP endpoint as dictionary source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryHttpSource {
    pub url: String,
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub where_clause: Option<String>,
}

/// External dictionary source — discriminated union of supported source types.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source_type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExternalDictionarySource {
    Http(DictionaryHttpSource),
    ClickHouse(DictionaryClickHouseSource),
    Mysql(DictionaryMysqlSource),
    Postgresql(DictionaryPostgresqlSource),
    Redis(DictionaryRedisSource),
    Mongodb(DictionaryMongoDbSource),
    Executable(DictionaryExecutableSource),
    S3(DictionaryS3Source),
}

/// Wrapper that adds one nesting level around `ExternalDictionarySource` to
/// avoid a conflict: `DictionarySource` uses `#[serde(tag = "type")]` while
/// `ExternalDictionarySource` uses `#[serde(tag = "source_type")]`, so they
/// each emit their discriminant key at their own JSON level without collision.
///
/// JSON shape: `{ "type": "EXTERNAL", "externalSource": { "source_type": "HTTP", … } }`
///
/// The TypeScript SDK's `serializeExternalSource` produces exactly this shape.
/// See: <https://github.com/serde-rs/serde/issues/1799>
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDictionarySourceWrapper {
    pub external_source: ExternalDictionarySource,
}

/// Dictionary data source — exactly one must be set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DictionarySource {
    /// Read from a local ClickHouse table
    Table(DictionaryTableSource),
    /// Read from an arbitrary SQL query on the local ClickHouse
    Query(DictionaryQuerySource),
    /// Read from an external system
    External(ExternalDictionarySourceWrapper),
}

impl DictionarySource {
    /// Human-readable lowercase label for the source type, used by CLI display commands.
    ///
    /// Co-located with the enum so that any variant shape change (e.g. tuple → struct)
    /// causes a compile error here, caught immediately by `cargo test`.
    pub fn source_type_label(&self) -> &'static str {
        match self {
            DictionarySource::Table(_) => "table",
            DictionarySource::Query(_) => "query",
            DictionarySource::External(_) => "external",
        }
    }
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/// ClickHouse dictionary layout type and its configuration parameters.
///
/// Layouts control the in-memory data structure. COMPLEX_KEY_* layouts support
/// multi-column primary keys.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DictionaryLayout {
    /// Simple array layout — fastest, only for small dictionaries with sequential integer keys.
    Flat,

    /// Hash table layout — good general-purpose choice for arbitrary integer keys.
    Hashed {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        initial_array_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        max_load_factor: Option<f64>,
    },

    /// Space-optimized hash table (uses ~3x less memory, slightly slower).
    SparseHashed {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        initial_array_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        max_load_factor: Option<f64>,
    },

    /// Array of small hashed dictionaries — best performance for multi-threaded reads.
    HashedArray {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        shards: Option<u32>,
    },

    /// Hash table with range-based lookups (requires range_min/range_max columns).
    RangeHashed {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        range_lookup_strategy: Option<String>,
    },

    /// Fixed-size LRU cache, loaded on demand. Good for very large dictionaries.
    Cache {
        size_in_cells: u64,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        max_threads_for_updates: Option<u32>,
    },

    /// SSD-based cache — larger than Cache but backed by SSD storage.
    SsdCache {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        block_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        file_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        read_buffer_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        write_buffer_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        max_stored_keys: Option<u64>,
    },

    /// Reads from source on every lookup — no caching. For rarely accessed dictionaries.
    Direct,

    /// Longest-prefix match for IPv4/IPv6 addresses.
    IpTrie {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        access_to_key_from_attributes: Option<bool>,
    },

    // ─── COMPLEX_KEY_* variants (multi-column primary key) ─────────────────
    /// Multi-column key hash table.
    ComplexKeyHashed {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        initial_array_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        max_load_factor: Option<f64>,
    },

    /// Multi-column key sparse hash table.
    ComplexKeySparseHashed {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        initial_array_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        max_load_factor: Option<f64>,
    },

    /// Multi-column key hashed array.
    ComplexKeyHashedArray {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        shards: Option<u32>,
    },

    /// Multi-column key LRU cache.
    ComplexKeyCache {
        size_in_cells: u64,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        max_threads_for_updates: Option<u32>,
    },

    /// Multi-column key SSD cache.
    ComplexKeySsdCache {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        block_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        file_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        read_buffer_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        write_buffer_size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        max_stored_keys: Option<u64>,
    },

    /// Multi-column key direct (no caching).
    ComplexKeyDirect,
}

impl DictionaryLayout {
    /// Human-readable label for the layout variant, used by CLI display and risk reporting.
    ///
    /// Co-located with the enum so any new variant addition causes a compile error here,
    /// caught immediately by `cargo test`.
    pub fn layout_type_label(&self) -> &'static str {
        match self {
            DictionaryLayout::Flat => "Flat",
            DictionaryLayout::Hashed { .. } => "Hashed",
            DictionaryLayout::SparseHashed { .. } => "SparseHashed",
            DictionaryLayout::HashedArray { .. } => "HashedArray",
            DictionaryLayout::RangeHashed { .. } => "RangeHashed",
            DictionaryLayout::Cache { .. } => "Cache",
            DictionaryLayout::SsdCache { .. } => "SsdCache",
            DictionaryLayout::Direct => "Direct",
            DictionaryLayout::IpTrie { .. } => "IpTrie",
            DictionaryLayout::ComplexKeyHashed { .. } => "ComplexKeyHashed",
            DictionaryLayout::ComplexKeySparseHashed { .. } => "ComplexKeySparseHashed",
            DictionaryLayout::ComplexKeyHashedArray { .. } => "ComplexKeyHashedArray",
            DictionaryLayout::ComplexKeyCache { .. } => "ComplexKeyCache",
            DictionaryLayout::ComplexKeySsdCache { .. } => "ComplexKeySsdCache",
            DictionaryLayout::ComplexKeyDirect => "ComplexKeyDirect",
        }
    }

    /// Returns the ClickHouse LAYOUT(...) clause string
    pub fn to_ddl(&self) -> String {
        match self {
            DictionaryLayout::Flat => "LAYOUT(FLAT())".to_string(),
            DictionaryLayout::Hashed {
                initial_array_size,
                max_load_factor,
            } => {
                let mut params = vec![];
                if let Some(v) = initial_array_size {
                    params.push(format!("INITIAL_ARRAY_SIZE {}", v));
                }
                if let Some(v) = max_load_factor {
                    params.push(format!("MAX_LOAD_FACTOR {}", v));
                }
                format!("LAYOUT(HASHED({}))", params.join(" "))
            }
            DictionaryLayout::SparseHashed {
                initial_array_size,
                max_load_factor,
            } => {
                let mut params = vec![];
                if let Some(v) = initial_array_size {
                    params.push(format!("INITIAL_ARRAY_SIZE {}", v));
                }
                if let Some(v) = max_load_factor {
                    params.push(format!("MAX_LOAD_FACTOR {}", v));
                }
                format!("LAYOUT(SPARSE_HASHED({}))", params.join(" "))
            }
            DictionaryLayout::HashedArray { shards } => {
                if let Some(v) = shards {
                    format!("LAYOUT(HASHED_ARRAY(SHARDS {}))", v)
                } else {
                    "LAYOUT(HASHED_ARRAY())".to_string()
                }
            }
            DictionaryLayout::RangeHashed {
                range_lookup_strategy,
            } => {
                if let Some(v) = range_lookup_strategy {
                    format!(
                        "LAYOUT(RANGE_HASHED(RANGE_LOOKUP_STRATEGY '{}'))",
                        escape_clickhouse_string(v)
                    )
                } else {
                    "LAYOUT(RANGE_HASHED())".to_string()
                }
            }
            DictionaryLayout::Cache {
                size_in_cells,
                max_threads_for_updates,
            } => {
                let mut params = vec![format!("SIZE_IN_CELLS {}", size_in_cells)];
                if let Some(v) = max_threads_for_updates {
                    params.push(format!("MAX_THREADS_FOR_UPDATES {}", v));
                }
                format!("LAYOUT(CACHE({}))", params.join(" "))
            }
            DictionaryLayout::SsdCache {
                path,
                block_size,
                file_size,
                read_buffer_size,
                write_buffer_size,
                max_stored_keys,
            } => {
                let mut params = vec![format!("PATH '{}'", escape_clickhouse_string(path))];
                if let Some(v) = block_size {
                    params.push(format!("BLOCK_SIZE {}", v));
                }
                if let Some(v) = file_size {
                    params.push(format!("FILE_SIZE {}", v));
                }
                if let Some(v) = read_buffer_size {
                    params.push(format!("READ_BUFFER_SIZE {}", v));
                }
                if let Some(v) = write_buffer_size {
                    params.push(format!("WRITE_BUFFER_SIZE {}", v));
                }
                if let Some(v) = max_stored_keys {
                    params.push(format!("MAX_STORED_KEYS {}", v));
                }
                format!("LAYOUT(SSD_CACHE({}))", params.join(" "))
            }
            DictionaryLayout::Direct => "LAYOUT(DIRECT())".to_string(),
            DictionaryLayout::IpTrie {
                access_to_key_from_attributes,
            } => {
                if access_to_key_from_attributes == &Some(true) {
                    "LAYOUT(IP_TRIE(ACCESS_TO_KEY_FROM_ATTRIBUTES 1))".to_string()
                } else {
                    "LAYOUT(IP_TRIE())".to_string()
                }
            }
            DictionaryLayout::ComplexKeyHashed {
                initial_array_size,
                max_load_factor,
            } => {
                let mut params = vec![];
                if let Some(v) = initial_array_size {
                    params.push(format!("INITIAL_ARRAY_SIZE {}", v));
                }
                if let Some(v) = max_load_factor {
                    params.push(format!("MAX_LOAD_FACTOR {}", v));
                }
                format!("LAYOUT(COMPLEX_KEY_HASHED({}))", params.join(" "))
            }
            DictionaryLayout::ComplexKeySparseHashed {
                initial_array_size,
                max_load_factor,
            } => {
                let mut params = vec![];
                if let Some(v) = initial_array_size {
                    params.push(format!("INITIAL_ARRAY_SIZE {}", v));
                }
                if let Some(v) = max_load_factor {
                    params.push(format!("MAX_LOAD_FACTOR {}", v));
                }
                format!("LAYOUT(COMPLEX_KEY_SPARSE_HASHED({}))", params.join(" "))
            }
            DictionaryLayout::ComplexKeyHashedArray { shards } => {
                if let Some(v) = shards {
                    format!("LAYOUT(COMPLEX_KEY_HASHED_ARRAY(SHARDS {}))", v)
                } else {
                    "LAYOUT(COMPLEX_KEY_HASHED_ARRAY())".to_string()
                }
            }
            DictionaryLayout::ComplexKeyCache {
                size_in_cells,
                max_threads_for_updates,
            } => {
                let mut params = vec![format!("SIZE_IN_CELLS {}", size_in_cells)];
                if let Some(v) = max_threads_for_updates {
                    params.push(format!("MAX_THREADS_FOR_UPDATES {}", v));
                }
                format!("LAYOUT(COMPLEX_KEY_CACHE({}))", params.join(" "))
            }
            DictionaryLayout::ComplexKeySsdCache {
                path,
                block_size,
                file_size,
                read_buffer_size,
                write_buffer_size,
                max_stored_keys,
            } => {
                let mut params = vec![format!("PATH '{}'", escape_clickhouse_string(path))];
                if let Some(v) = block_size {
                    params.push(format!("BLOCK_SIZE {}", v));
                }
                if let Some(v) = file_size {
                    params.push(format!("FILE_SIZE {}", v));
                }
                if let Some(v) = read_buffer_size {
                    params.push(format!("READ_BUFFER_SIZE {}", v));
                }
                if let Some(v) = write_buffer_size {
                    params.push(format!("WRITE_BUFFER_SIZE {}", v));
                }
                if let Some(v) = max_stored_keys {
                    params.push(format!("MAX_STORED_KEYS {}", v));
                }
                format!("LAYOUT(COMPLEX_KEY_SSD_CACHE({}))", params.join(" "))
            }
            DictionaryLayout::ComplexKeyDirect => "LAYOUT(COMPLEX_KEY_DIRECT())".to_string(),
        }
    }

    pub fn to_proto(&self) -> ProtoDictionaryLayout {
        let mut proto = ProtoDictionaryLayout::new();
        match self {
            DictionaryLayout::Flat => {
                proto.type_ = dictionary_layout::Type::FLAT.into();
            }
            DictionaryLayout::Hashed {
                initial_array_size,
                max_load_factor,
            } => {
                proto.type_ = dictionary_layout::Type::HASHED.into();
                proto.initial_array_size = *initial_array_size;
                proto.max_load_factor = *max_load_factor;
            }
            DictionaryLayout::SparseHashed {
                initial_array_size,
                max_load_factor,
            } => {
                proto.type_ = dictionary_layout::Type::SPARSE_HASHED.into();
                proto.initial_array_size = *initial_array_size;
                proto.max_load_factor = *max_load_factor;
            }
            DictionaryLayout::HashedArray { shards } => {
                proto.type_ = dictionary_layout::Type::HASHED_ARRAY.into();
                proto.shards = *shards;
            }
            DictionaryLayout::RangeHashed {
                range_lookup_strategy,
            } => {
                proto.type_ = dictionary_layout::Type::RANGE_HASHED.into();
                proto.range_lookup_strategy = range_lookup_strategy.clone();
            }
            DictionaryLayout::Cache {
                size_in_cells,
                max_threads_for_updates,
            } => {
                proto.type_ = dictionary_layout::Type::CACHE.into();
                proto.size_in_cells = Some(*size_in_cells);
                proto.max_threads_for_updates = *max_threads_for_updates;
            }
            DictionaryLayout::SsdCache {
                path,
                block_size,
                file_size,
                read_buffer_size,
                write_buffer_size,
                max_stored_keys,
            } => {
                proto.type_ = dictionary_layout::Type::SSD_CACHE.into();
                proto.ssd_path = Some(path.clone());
                proto.block_size = *block_size;
                proto.file_size = *file_size;
                proto.read_buffer_size = *read_buffer_size;
                proto.write_buffer_size = *write_buffer_size;
                proto.max_stored_keys = *max_stored_keys;
            }
            DictionaryLayout::Direct => {
                proto.type_ = dictionary_layout::Type::DIRECT.into();
            }
            DictionaryLayout::IpTrie {
                access_to_key_from_attributes,
            } => {
                proto.type_ = dictionary_layout::Type::IP_TRIE.into();
                proto.access_to_key_from_attributes = *access_to_key_from_attributes;
            }
            DictionaryLayout::ComplexKeyHashed {
                initial_array_size,
                max_load_factor,
            } => {
                proto.type_ = dictionary_layout::Type::COMPLEX_KEY_HASHED.into();
                proto.initial_array_size = *initial_array_size;
                proto.max_load_factor = *max_load_factor;
            }
            DictionaryLayout::ComplexKeySparseHashed {
                initial_array_size,
                max_load_factor,
            } => {
                proto.type_ = dictionary_layout::Type::COMPLEX_KEY_SPARSE_HASHED.into();
                proto.initial_array_size = *initial_array_size;
                proto.max_load_factor = *max_load_factor;
            }
            DictionaryLayout::ComplexKeyHashedArray { shards } => {
                proto.type_ = dictionary_layout::Type::COMPLEX_KEY_HASHED_ARRAY.into();
                proto.shards = *shards;
            }
            DictionaryLayout::ComplexKeyCache {
                size_in_cells,
                max_threads_for_updates,
            } => {
                proto.type_ = dictionary_layout::Type::COMPLEX_KEY_CACHE.into();
                proto.size_in_cells = Some(*size_in_cells);
                proto.max_threads_for_updates = *max_threads_for_updates;
            }
            DictionaryLayout::ComplexKeySsdCache {
                path,
                block_size,
                file_size,
                read_buffer_size,
                write_buffer_size,
                max_stored_keys,
            } => {
                proto.type_ = dictionary_layout::Type::COMPLEX_KEY_SSD_CACHE.into();
                proto.ssd_path = Some(path.clone());
                proto.block_size = *block_size;
                proto.file_size = *file_size;
                proto.read_buffer_size = *read_buffer_size;
                proto.write_buffer_size = *write_buffer_size;
                proto.max_stored_keys = *max_stored_keys;
            }
            DictionaryLayout::ComplexKeyDirect => {
                proto.type_ = dictionary_layout::Type::COMPLEX_KEY_DIRECT.into();
            }
        }
        proto
    }

    pub fn from_proto(proto: ProtoDictionaryLayout) -> Self {
        match proto.type_.enum_value_or_default() {
            dictionary_layout::Type::FLAT => DictionaryLayout::Flat,
            dictionary_layout::Type::HASHED => DictionaryLayout::Hashed {
                initial_array_size: proto.initial_array_size,
                max_load_factor: proto.max_load_factor,
            },
            dictionary_layout::Type::SPARSE_HASHED => DictionaryLayout::SparseHashed {
                initial_array_size: proto.initial_array_size,
                max_load_factor: proto.max_load_factor,
            },
            dictionary_layout::Type::HASHED_ARRAY => DictionaryLayout::HashedArray {
                shards: proto.shards,
            },
            dictionary_layout::Type::RANGE_HASHED => DictionaryLayout::RangeHashed {
                range_lookup_strategy: proto.range_lookup_strategy,
            },
            dictionary_layout::Type::CACHE => DictionaryLayout::Cache {
                size_in_cells: proto.size_in_cells.unwrap_or(1000),
                max_threads_for_updates: proto.max_threads_for_updates,
            },
            dictionary_layout::Type::SSD_CACHE => DictionaryLayout::SsdCache {
                path: proto.ssd_path.unwrap_or_default(),
                block_size: proto.block_size,
                file_size: proto.file_size,
                read_buffer_size: proto.read_buffer_size,
                write_buffer_size: proto.write_buffer_size,
                max_stored_keys: proto.max_stored_keys,
            },
            dictionary_layout::Type::DIRECT => DictionaryLayout::Direct,
            dictionary_layout::Type::IP_TRIE => DictionaryLayout::IpTrie {
                access_to_key_from_attributes: proto.access_to_key_from_attributes,
            },
            dictionary_layout::Type::COMPLEX_KEY_HASHED => DictionaryLayout::ComplexKeyHashed {
                initial_array_size: proto.initial_array_size,
                max_load_factor: proto.max_load_factor,
            },
            dictionary_layout::Type::COMPLEX_KEY_SPARSE_HASHED => {
                DictionaryLayout::ComplexKeySparseHashed {
                    initial_array_size: proto.initial_array_size,
                    max_load_factor: proto.max_load_factor,
                }
            }
            dictionary_layout::Type::COMPLEX_KEY_HASHED_ARRAY => {
                DictionaryLayout::ComplexKeyHashedArray {
                    shards: proto.shards,
                }
            }
            dictionary_layout::Type::COMPLEX_KEY_CACHE => DictionaryLayout::ComplexKeyCache {
                size_in_cells: proto.size_in_cells.unwrap_or(1000),
                max_threads_for_updates: proto.max_threads_for_updates,
            },
            dictionary_layout::Type::COMPLEX_KEY_SSD_CACHE => {
                DictionaryLayout::ComplexKeySsdCache {
                    path: proto.ssd_path.unwrap_or_default(),
                    block_size: proto.block_size,
                    file_size: proto.file_size,
                    read_buffer_size: proto.read_buffer_size,
                    write_buffer_size: proto.write_buffer_size,
                    max_stored_keys: proto.max_stored_keys,
                }
            }
            dictionary_layout::Type::COMPLEX_KEY_DIRECT => DictionaryLayout::ComplexKeyDirect,
        }
    }
}

// ─── Lifetime ─────────────────────────────────────────────────────────────────

/// Range lifetime — refresh between min and max seconds (chosen randomly to avoid stampedes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryRangeLifetime {
    pub min: u64,
    pub max: u64,
}

/// Dictionary refresh policy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DictionaryLifetime {
    /// Never refresh automatically (`LIFETIME(0)`)
    Static,
    /// Refresh every N seconds (`LIFETIME(N)`)
    Single { seconds: u64 },
    /// Refresh between min and max seconds (`LIFETIME(MIN min MAX max)`)
    Range(DictionaryRangeLifetime),
}

impl DictionaryLifetime {
    /// Generate the ClickHouse LIFETIME clause
    pub fn to_ddl(&self) -> String {
        match self {
            DictionaryLifetime::Static => "LIFETIME(0)".to_string(),
            DictionaryLifetime::Single { seconds } => format!("LIFETIME({})", seconds),
            DictionaryLifetime::Range(r) => {
                format!("LIFETIME(MIN {} MAX {})", r.min, r.max)
            }
        }
    }

    pub fn to_proto(&self) -> ProtoDictionaryLifetime {
        let mut proto = ProtoDictionaryLifetime::new();
        match self {
            DictionaryLifetime::Static => {
                proto.set_static_lifetime(true);
            }
            DictionaryLifetime::Single { seconds } => {
                proto.set_single(*seconds);
            }
            DictionaryLifetime::Range(r) => {
                proto.set_range(ProtoDictionaryRangeLifetime {
                    min: r.min,
                    max: r.max,
                    special_fields: Default::default(),
                });
            }
        }
        proto
    }

    pub fn from_proto(proto: ProtoDictionaryLifetime) -> Self {
        match proto.t {
            Some(dictionary_lifetime::T::StaticLifetime(_)) => DictionaryLifetime::Static,
            Some(dictionary_lifetime::T::Single(s)) => DictionaryLifetime::Single { seconds: s },
            Some(dictionary_lifetime::T::Range(r)) => {
                DictionaryLifetime::Range(DictionaryRangeLifetime {
                    min: r.min,
                    max: r.max,
                })
            }
            None => DictionaryLifetime::Single { seconds: 3600 },
        }
    }
}

// ─── OlapDictionary ───────────────────────────────────────────────────────────

/// Represents a ClickHouse Dictionary definition.
///
/// Dictionaries are in-memory key-value stores optimized for fast lookups.
/// They can be backed by local ClickHouse tables/queries or external systems.
///
/// ## Key design decisions
///
/// - `CREATE OR REPLACE DICTIONARY` is used for updates (zero-downtime)
/// - `CREATE DICTIONARY IF NOT EXISTS` is used for initial bootstrap
/// - `DROP DICTIONARY IF EXISTS` is used for removal
///
/// The structure is flat to match JSON output from TypeScript/Python moose-lib.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OlapDictionary {
    /// Dictionary name
    pub name: String,

    /// Database where the dictionary is created (None = default database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,

    /// Optional ON CLUSTER name for distributed ClickHouse deployments
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cluster_name: Option<String>,

    /// Data source — exactly one of table, query, or external must be set
    pub source: DictionarySource,

    /// Primary key column names.
    /// Single column → simple key (FLAT/HASHED/CACHE/DIRECT/IP_TRIE/RANGE_HASHED).
    /// Multiple columns → complex key (COMPLEX_KEY_* layouts).
    pub primary_key: Vec<String>,

    /// Attribute columns (lookup values, not the key)
    pub columns: Vec<DictionaryColumn>,

    /// Memory layout / storage model
    pub layout: DictionaryLayout,

    /// Refresh policy
    pub lifetime: DictionaryLifetime,

    /// Optional top-level invalidation query.
    /// If the query result is unchanged, the dictionary is not reloaded.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub invalidate_query: Option<String>,

    /// Dictionary-level settings
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    pub settings: HashMap<String, String>,

    /// Optional COMMENT
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub comment: Option<String>,

    /// Lifecycle management policy
    #[serde(default, deserialize_with = "deserialize_nullable_as_default")]
    pub life_cycle: LifeCycle,

    /// Optional version string (e.g. "0.1"). When set, the version suffix is baked
    /// into `name` (e.g. "my_dict_0_1") so versioned dictionaries are distinct objects.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub version: Option<Version>,

    /// Optional metadata (description, source file)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub metadata: Option<Metadata>,
}

/// Escapes a string for use inside single-quoted ClickHouse string literals.
///
/// Backslashes must be escaped first (before single quotes) to avoid double-escaping:
/// `test\'s` → `test\\'s` (wrong) vs `test\\'s` via this helper (correct).
fn escape_clickhouse_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

impl OlapDictionary {
    /// Returns a unique identifier for this dictionary.
    ///
    /// Format: `{database}_{name}` (or `{database}_{name}_{version_suffix}` when versioned).
    pub fn id(&self, default_database: &str) -> String {
        let db = self.database.as_deref().unwrap_or(default_database);
        let base_id = self.version.as_ref().map_or(self.name.clone(), |v| {
            format!("{}_{}", self.name, v.as_suffix())
        });
        format!("{}_{}", db, base_id)
    }

    /// Returns the quoted dictionary name for SQL
    pub fn quoted_name(&self) -> String {
        match &self.database {
            Some(db) => format!("`{}`.`{}`", db, self.name),
            None => format!("`{}`", self.name),
        }
    }

    /// Optional ON CLUSTER clause
    fn cluster_clause(&self) -> String {
        match &self.cluster_name {
            Some(c) => format!(" ON CLUSTER `{}`", c),
            None => String::new(),
        }
    }

    /// Builds the column list DDL fragment.
    ///
    /// All columns — including primary keys — must appear in the ClickHouse column list.
    /// Primary key columns are sorted to appear first (ClickHouse convention), followed
    /// by attribute columns in the order they were declared.
    ///
    /// Primary key columns must be present in `self.columns` with their type defined.
    fn columns_ddl(&self) -> String {
        let pk_set: std::collections::HashSet<&str> =
            self.primary_key.iter().map(|k| k.as_str()).collect();

        // Collect non-PK attribute columns
        let mut attr_lines: Vec<String> = Vec::new();

        for col in &self.columns {
            if !pk_set.contains(col.name.as_str()) {
                attr_lines.push(col.to_ddl());
            }
        }

        // Preserve declared order of primary key columns
        let mut ordered_pks: Vec<String> = Vec::with_capacity(self.primary_key.len());
        for key in &self.primary_key {
            if let Some(col) = self.columns.iter().find(|c| &c.name == key) {
                ordered_pks.push(col.to_ddl());
            }
        }

        let mut col_lines = ordered_pks;
        col_lines.extend(attr_lines);

        if col_lines.is_empty() {
            col_lines.push("`id` UInt64".to_string());
        }

        col_lines.join(",\n    ")
    }

    /// Builds the PRIMARY KEY clause
    fn primary_key_clause(&self) -> String {
        if self.primary_key.is_empty() {
            if self.columns.is_empty() {
                // columns_ddl() synthesizes an `id UInt64` column in this case
                "PRIMARY KEY id".to_string()
            } else {
                panic!(
                    "OlapDictionary '{}' has columns defined but no primary_key set; \
                     primary_key must not be empty when columns are provided",
                    self.name
                );
            }
        } else {
            let keys = self
                .primary_key
                .iter()
                .map(|k| format!("`{}`", k))
                .collect::<Vec<_>>()
                .join(", ");
            format!("PRIMARY KEY {}", keys)
        }
    }

    /// Builds the SOURCE(...) clause
    fn source_ddl(&self) -> String {
        match &self.source {
            DictionarySource::Table(t) => {
                let mut params = vec![];
                if let Some(ref db) = t.database {
                    params.push(format!("DB '{}'", escape_clickhouse_string(db)));
                }
                params.push(format!("TABLE '{}'", escape_clickhouse_string(&t.table)));
                if let Some(ref w) = t.where_clause {
                    params.push(format!("WHERE '{}'", escape_clickhouse_string(w)));
                }
                if let Some(ref iq) = t.invalidate_query {
                    params.push(format!(
                        "INVALIDATE_QUERY '{}'",
                        escape_clickhouse_string(iq)
                    ));
                }
                format!("SOURCE(CLICKHOUSE({}))", params.join(" "))
            }
            DictionarySource::Query(q) => {
                let mut params = vec![format!("QUERY '{}'", escape_clickhouse_string(&q.query))];
                if let Some(ref iq) = q.invalidate_query {
                    params.push(format!(
                        "INVALIDATE_QUERY '{}'",
                        escape_clickhouse_string(iq)
                    ));
                }
                format!("SOURCE(CLICKHOUSE({}))", params.join(" "))
            }
            DictionarySource::External(wrapper) => match wrapper.external_source {
                ExternalDictionarySource::Http(h) => {
                    let mut params = vec![
                        format!("URL '{}'", escape_clickhouse_string(&h.url)),
                        format!("FORMAT '{}'", escape_clickhouse_string(&h.format)),
                    ];
                    if let Some(ref m) = h.method {
                        params.push(format!("METHOD '{}'", escape_clickhouse_string(m)));
                    }
                    if let Some(ref w) = h.where_clause {
                        params.push(format!("WHERE '{}'", escape_clickhouse_string(w)));
                    }
                    format!("SOURCE(HTTP({}))", params.join(" "))
                }
                ExternalDictionarySource::ClickHouse(c) => {
                    let mut params = vec![
                        format!("HOST '{}'", escape_clickhouse_string(&c.host)),
                        format!("PORT {}", c.port),
                        format!("USER '{}'", escape_clickhouse_string(&c.user)),
                        format!("PASSWORD '{}'", escape_clickhouse_string(&c.password)),
                        format!("DB '{}'", escape_clickhouse_string(&c.db)),
                    ];
                    if let Some(ref q) = c.query {
                        params.push(format!("QUERY '{}'", escape_clickhouse_string(q)));
                    } else {
                        params.push(format!("TABLE '{}'", escape_clickhouse_string(&c.table)));
                    }
                    if let Some(ref w) = c.where_clause {
                        params.push(format!("WHERE '{}'", escape_clickhouse_string(w)));
                    }
                    if let Some(ref iq) = c.invalidate_query {
                        params.push(format!(
                            "INVALIDATE_QUERY '{}'",
                            escape_clickhouse_string(iq)
                        ));
                    }
                    format!("SOURCE(CLICKHOUSE({}))", params.join(" "))
                }
                ExternalDictionarySource::Mysql(m) => {
                    let mut params = vec![
                        format!("HOST '{}'", escape_clickhouse_string(&m.host)),
                        format!("PORT {}", m.port),
                        format!("USER '{}'", escape_clickhouse_string(&m.user)),
                        format!("PASSWORD '{}'", escape_clickhouse_string(&m.password)),
                        format!("DB '{}'", escape_clickhouse_string(&m.db)),
                    ];
                    if let Some(ref q) = m.query {
                        params.push(format!("QUERY '{}'", escape_clickhouse_string(q)));
                    } else {
                        params.push(format!("TABLE '{}'", escape_clickhouse_string(&m.table)));
                    }
                    if let Some(ref w) = m.where_clause {
                        params.push(format!("WHERE '{}'", escape_clickhouse_string(w)));
                    }
                    if let Some(ref iq) = m.invalidate_query {
                        params.push(format!(
                            "INVALIDATE_QUERY '{}'",
                            escape_clickhouse_string(iq)
                        ));
                    }
                    format!("SOURCE(MYSQL({}))", params.join(" "))
                }
                ExternalDictionarySource::Postgresql(p) => {
                    let mut params = vec![
                        format!("HOST '{}'", escape_clickhouse_string(&p.host)),
                        format!("PORT {}", p.port),
                        format!("USER '{}'", escape_clickhouse_string(&p.user)),
                        format!("PASSWORD '{}'", escape_clickhouse_string(&p.password)),
                        format!("DB '{}'", escape_clickhouse_string(&p.db)),
                    ];
                    if let Some(ref q) = p.query {
                        params.push(format!("QUERY '{}'", escape_clickhouse_string(q)));
                    } else {
                        params.push(format!("TABLE '{}'", escape_clickhouse_string(&p.table)));
                    }
                    if let Some(ref w) = p.where_clause {
                        params.push(format!("WHERE '{}'", escape_clickhouse_string(w)));
                    }
                    if let Some(ref iq) = p.invalidate_query {
                        params.push(format!(
                            "INVALIDATE_QUERY '{}'",
                            escape_clickhouse_string(iq)
                        ));
                    }
                    format!("SOURCE(POSTGRESQL({}))", params.join(" "))
                }
                ExternalDictionarySource::Redis(r) => {
                    let mut params = vec![
                        format!("HOST '{}'", escape_clickhouse_string(&r.host)),
                        format!("PORT {}", r.port),
                        format!(
                            "STORAGE_TYPE '{}'",
                            escape_clickhouse_string(&r.storage_type)
                        ),
                    ];
                    if let Some(ref pw) = r.password {
                        params.push(format!("PASSWORD '{}'", escape_clickhouse_string(pw)));
                    }
                    if let Some(db) = r.db_index {
                        params.push(format!("DB_INDEX {}", db));
                    }
                    format!("SOURCE(REDIS({}))", params.join(" "))
                }
                ExternalDictionarySource::Mongodb(m) => {
                    let params = [
                        format!("HOST '{}'", escape_clickhouse_string(&m.host)),
                        format!("PORT {}", m.port),
                        format!("USER '{}'", escape_clickhouse_string(&m.user)),
                        format!("PASSWORD '{}'", escape_clickhouse_string(&m.password)),
                        format!("DB '{}'", escape_clickhouse_string(&m.db)),
                        format!("COLLECTION '{}'", escape_clickhouse_string(&m.collection)),
                    ];
                    format!("SOURCE(MONGODB({}))", params.join(" "))
                }
                ExternalDictionarySource::Executable(e) => {
                    let mut params = vec![
                        format!("COMMAND '{}'", escape_clickhouse_string(&e.command)),
                        format!("FORMAT '{}'", escape_clickhouse_string(&e.format)),
                    ];
                    if let Some(ik) = e.implicit_key {
                        params.push(format!("IMPLICIT_KEY {}", if ik { 1 } else { 0 }));
                    }
                    format!("SOURCE(EXECUTABLE({}))", params.join(" "))
                }
                ExternalDictionarySource::S3(s) => {
                    let mut params = vec![
                        format!("URL '{}'", escape_clickhouse_string(&s.url)),
                        format!("FORMAT '{}'", escape_clickhouse_string(&s.format)),
                    ];
                    if let Some(ref k) = s.access_key_id {
                        params.push(format!("ACCESS_KEY_ID '{}'", escape_clickhouse_string(k)));
                    }
                    if let Some(ref sk) = s.secret_access_key {
                        params.push(format!(
                            "SECRET_ACCESS_KEY '{}'",
                            escape_clickhouse_string(sk)
                        ));
                    }
                    format!("SOURCE(S3({}))", params.join(" "))
                }
            },
        }
    }

    /// Builds the optional SETTINGS clause
    fn settings_ddl(&self) -> Option<String> {
        if self.settings.is_empty() {
            return None;
        }
        let pairs: Vec<String> = self
            .settings
            .iter()
            .map(|(k, v)| format!("{}='{}'", k, escape_clickhouse_string(v)))
            .collect();
        Some(format!("SETTINGS({})", pairs.join(", ")))
    }

    /// Generates `CREATE DICTIONARY IF NOT EXISTS` — used for initial bootstrap
    pub fn to_create_if_not_exists_sql(&self) -> String {
        self.build_create_sql(false)
    }

    /// Generates `CREATE OR REPLACE DICTIONARY` — used for zero-downtime updates
    pub fn to_replace_sql(&self) -> String {
        self.build_create_sql(true)
    }

    /// Generates `DROP DICTIONARY IF EXISTS`
    pub fn to_drop_sql(&self) -> String {
        format!(
            "DROP DICTIONARY IF EXISTS {}{}",
            self.quoted_name(),
            self.cluster_clause()
        )
    }

    /// Internal helper — builds the CREATE DDL with or without OR REPLACE
    fn build_create_sql(&self, or_replace: bool) -> String {
        let create_clause = if or_replace {
            "CREATE OR REPLACE DICTIONARY"
        } else {
            "CREATE DICTIONARY IF NOT EXISTS"
        };

        let mut parts = vec![
            format!(
                "{} {}{}",
                create_clause,
                self.quoted_name(),
                self.cluster_clause()
            ),
            format!("(\n    {}\n)", self.columns_ddl()),
            self.primary_key_clause(),
            self.source_ddl(),
            self.layout.to_ddl(),
            self.lifetime.to_ddl(),
        ];

        if let Some(ref iq) = self.invalidate_query {
            parts.push(format!(
                "INVALIDATE_QUERY '{}'",
                escape_clickhouse_string(iq)
            ));
        }

        if let Some(settings) = self.settings_ddl() {
            parts.push(settings);
        }

        if let Some(ref c) = self.comment {
            parts.push(format!("COMMENT '{}'", escape_clickhouse_string(c)));
        }

        parts.join("\n")
    }

    /// Short display string for logging/UI
    pub fn short_display(&self) -> String {
        match &self.version {
            Some(v) => format!("OlapDictionary: {} v{}", self.name, v),
            None => format!("OlapDictionary: {}", self.name),
        }
    }

    /// Expanded display string with more details
    pub fn expanded_display(&self) -> String {
        match &self.version {
            Some(v) => format!(
                "OlapDictionary: {} v{} (layout: {:?}, lifetime: {:?})",
                self.name, v, &self.layout, &self.lifetime
            ),
            None => format!(
                "OlapDictionary: {} (layout: {:?}, lifetime: {:?})",
                self.name, &self.layout, &self.lifetime
            ),
        }
    }

    // ─── Proto conversion ─────────────────────────────────────────────────

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoOlapDictionary {
        let source = match &self.source {
            DictionarySource::Table(t) => Some(olap_dictionary::Source::TableSource(
                ProtoDictionaryTableSource {
                    table: t.table.clone(),
                    database: t.database.clone(),
                    where_clause: t.where_clause.clone(),
                    invalidate_query: t.invalidate_query.clone(),
                    special_fields: Default::default(),
                },
            )),
            DictionarySource::Query(q) => Some(olap_dictionary::Source::QuerySource(
                ProtoDictionaryQuerySource {
                    query: q.query.clone(),
                    invalidate_query: q.invalidate_query.clone(),
                    special_fields: Default::default(),
                },
            )),
            DictionarySource::External(wrapper) => {
                let external_t = match wrapper.external_source {
                    ExternalDictionarySource::Http(h) => {
                        dictionary_external_source::T::Http(ProtoDictionaryHttpSource {
                            url: h.url.clone(),
                            format: h.format.clone(),
                            method: h.method.clone(),
                            where_clause: h.where_clause.clone(),
                            special_fields: Default::default(),
                        })
                    }
                    ExternalDictionarySource::ClickHouse(c) => {
                        dictionary_external_source::T::Clickhouse(ProtoDictionaryClickHouseSource {
                            host: c.host.clone(),
                            port: c.port,
                            user: c.user.clone(),
                            password: c.password.clone(),
                            db: c.db.clone(),
                            table: c.table.clone(),
                            query: c.query.clone(),
                            where_clause: c.where_clause.clone(),
                            invalidate_query: c.invalidate_query.clone(),
                            special_fields: Default::default(),
                        })
                    }
                    ExternalDictionarySource::Mysql(m) => {
                        dictionary_external_source::T::Mysql(ProtoDictionaryMysqlSource {
                            host: m.host.clone(),
                            port: m.port,
                            user: m.user.clone(),
                            password: m.password.clone(),
                            db: m.db.clone(),
                            table: m.table.clone(),
                            query: m.query.clone(),
                            where_clause: m.where_clause.clone(),
                            invalidate_query: m.invalidate_query.clone(),
                            special_fields: Default::default(),
                        })
                    }
                    ExternalDictionarySource::Postgresql(p) => {
                        dictionary_external_source::T::Postgresql(ProtoDictionaryPostgresqlSource {
                            host: p.host.clone(),
                            port: p.port,
                            user: p.user.clone(),
                            password: p.password.clone(),
                            db: p.db.clone(),
                            table: p.table.clone(),
                            query: p.query.clone(),
                            where_clause: p.where_clause.clone(),
                            invalidate_query: p.invalidate_query.clone(),
                            special_fields: Default::default(),
                        })
                    }
                    ExternalDictionarySource::Redis(r) => {
                        dictionary_external_source::T::Redis(ProtoDictionaryRedisSource {
                            host: r.host.clone(),
                            port: r.port,
                            password: r.password.clone(),
                            db_index: r.db_index,
                            storage_type: r.storage_type.clone(),
                            special_fields: Default::default(),
                        })
                    }
                    ExternalDictionarySource::Mongodb(m) => {
                        dictionary_external_source::T::Mongodb(ProtoDictionaryMongoDbSource {
                            host: m.host.clone(),
                            port: m.port,
                            user: m.user.clone(),
                            password: m.password.clone(),
                            db: m.db.clone(),
                            collection: m.collection.clone(),
                            special_fields: Default::default(),
                        })
                    }
                    ExternalDictionarySource::Executable(e) => {
                        dictionary_external_source::T::Executable(ProtoDictionaryExecutableSource {
                            command: e.command.clone(),
                            format: e.format.clone(),
                            implicit_key: e.implicit_key,
                            special_fields: Default::default(),
                        })
                    }
                    ExternalDictionarySource::S3(s) => {
                        dictionary_external_source::T::S3(ProtoDictionaryS3Source {
                            url: s.url.clone(),
                            format: s.format.clone(),
                            access_key_id: s.access_key_id.clone(),
                            secret_access_key: s.secret_access_key.clone(),
                            special_fields: Default::default(),
                        })
                    }
                };
                Some(olap_dictionary::Source::ExternalSource(
                    ProtoDictionaryExternalSource {
                        t: Some(external_t),
                        special_fields: Default::default(),
                    },
                ))
            }
        };

        ProtoOlapDictionary {
            name: self.name.clone(),
            database: self.database.clone(),
            cluster_name: self.cluster_name.clone(),
            primary_key: self.primary_key.clone(),
            columns: self.columns.iter().map(|c| c.to_proto()).collect(),
            layout: MessageField::some(self.layout.to_proto()),
            lifetime: MessageField::some(self.lifetime.to_proto()),
            invalidate_query: self.invalidate_query.clone(),
            settings: self.settings.clone(),
            comment: self.comment.clone(),
            life_cycle: match self.life_cycle {
                LifeCycle::FullyManaged => ProtoLifeCycle::FULLY_MANAGED.into(),
                LifeCycle::DeletionProtected => ProtoLifeCycle::DELETION_PROTECTED.into(),
                LifeCycle::ExternallyManaged => ProtoLifeCycle::EXTERNALLY_MANAGED.into(),
            },
            metadata: MessageField::from_option(self.metadata.as_ref().map(|m| {
                crate::proto::infrastructure_map::Metadata {
                    description: m.description.clone().unwrap_or_default(),
                    source: MessageField::from_option(m.source.as_ref().map(|s| {
                        crate::proto::infrastructure_map::SourceLocation {
                            file: s.file.clone(),
                            special_fields: Default::default(),
                        }
                    })),
                    special_fields: Default::default(),
                }
            })),
            version: self.version.as_ref().map(|v| v.to_string()),
            source,
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoOlapDictionary) -> Self {
        let source = match proto.source {
            Some(olap_dictionary::Source::TableSource(t)) => {
                DictionarySource::Table(DictionaryTableSource {
                    table: t.table,
                    database: t.database,
                    where_clause: t.where_clause,
                    invalidate_query: t.invalidate_query,
                })
            }
            Some(olap_dictionary::Source::QuerySource(q)) => {
                DictionarySource::Query(DictionaryQuerySource {
                    query: q.query,
                    invalidate_query: q.invalidate_query,
                })
            }
            Some(olap_dictionary::Source::ExternalSource(ext)) => {
                let ext_source = match ext.t {
                    Some(dictionary_external_source::T::Http(h)) => {
                        ExternalDictionarySource::Http(DictionaryHttpSource {
                            url: h.url,
                            format: h.format,
                            method: h.method,
                            where_clause: h.where_clause,
                        })
                    }
                    Some(dictionary_external_source::T::Clickhouse(c)) => {
                        ExternalDictionarySource::ClickHouse(DictionaryClickHouseSource {
                            host: c.host,
                            port: c.port,
                            user: c.user,
                            password: c.password,
                            db: c.db,
                            table: c.table,
                            query: c.query,
                            where_clause: c.where_clause,
                            invalidate_query: c.invalidate_query,
                        })
                    }
                    Some(dictionary_external_source::T::Mysql(m)) => {
                        ExternalDictionarySource::Mysql(DictionaryMysqlSource {
                            host: m.host,
                            port: m.port,
                            user: m.user,
                            password: m.password,
                            db: m.db,
                            table: m.table,
                            query: m.query,
                            where_clause: m.where_clause,
                            invalidate_query: m.invalidate_query,
                        })
                    }
                    Some(dictionary_external_source::T::Postgresql(p)) => {
                        ExternalDictionarySource::Postgresql(DictionaryPostgresqlSource {
                            host: p.host,
                            port: p.port,
                            user: p.user,
                            password: p.password,
                            db: p.db,
                            table: p.table,
                            query: p.query,
                            where_clause: p.where_clause,
                            invalidate_query: p.invalidate_query,
                        })
                    }
                    Some(dictionary_external_source::T::Redis(r)) => {
                        ExternalDictionarySource::Redis(DictionaryRedisSource {
                            host: r.host,
                            port: r.port,
                            password: r.password,
                            db_index: r.db_index,
                            storage_type: r.storage_type,
                        })
                    }
                    Some(dictionary_external_source::T::Mongodb(m)) => {
                        ExternalDictionarySource::Mongodb(DictionaryMongoDbSource {
                            host: m.host,
                            port: m.port,
                            user: m.user,
                            password: m.password,
                            db: m.db,
                            collection: m.collection,
                        })
                    }
                    Some(dictionary_external_source::T::Executable(e)) => {
                        ExternalDictionarySource::Executable(DictionaryExecutableSource {
                            command: e.command,
                            format: e.format,
                            implicit_key: e.implicit_key,
                        })
                    }
                    Some(dictionary_external_source::T::S3(s)) => {
                        ExternalDictionarySource::S3(DictionaryS3Source {
                            url: s.url,
                            format: s.format,
                            access_key_id: s.access_key_id,
                            secret_access_key: s.secret_access_key,
                        })
                    }
                    None => {
                        // Fallback: shouldn't happen — proto external source type (ext.t) is missing
                        tracing::warn!(
                            "OlapDictionary proto external source type (ext.t) is None; \
                             defaulting to empty HTTP source — possible proto corruption or version mismatch"
                        );
                        ExternalDictionarySource::Http(DictionaryHttpSource {
                            url: String::new(),
                            format: "JSONEachRow".to_string(),
                            method: None,
                            where_clause: None,
                        })
                    }
                };
                DictionarySource::External(ExternalDictionarySourceWrapper {
                    external_source: ext_source,
                })
            }
            None => {
                // Fallback: shouldn't happen in practice — proto is missing source field
                tracing::warn!(
                    "OlapDictionary proto missing source field; defaulting to empty Table source"
                );
                DictionarySource::Table(DictionaryTableSource {
                    table: String::new(),
                    database: None,
                    where_clause: None,
                    invalidate_query: None,
                })
            }
        };

        let layout = proto
            .layout
            .into_option()
            .map(DictionaryLayout::from_proto)
            .unwrap_or(DictionaryLayout::Flat);

        let lifetime = proto
            .lifetime
            .into_option()
            .map(DictionaryLifetime::from_proto)
            .unwrap_or(DictionaryLifetime::Single { seconds: 3600 });

        let metadata = proto.metadata.into_option().map(|m| Metadata {
            description: if m.description.is_empty() {
                None
            } else {
                Some(m.description)
            },
            source: m.source.into_option().map(|s| {
                crate::framework::core::infrastructure::table::SourceLocation { file: s.file }
            }),
        });

        let life_cycle = match proto.life_cycle.enum_value_or_default() {
            ProtoLifeCycle::FULLY_MANAGED => LifeCycle::FullyManaged,
            ProtoLifeCycle::DELETION_PROTECTED => LifeCycle::DeletionProtected,
            ProtoLifeCycle::EXTERNALLY_MANAGED => LifeCycle::ExternallyManaged,
        };

        Self {
            name: proto.name,
            database: proto.database,
            cluster_name: proto.cluster_name,
            source,
            primary_key: proto.primary_key,
            columns: proto
                .columns
                .into_iter()
                .map(DictionaryColumn::from_proto)
                .collect(),
            layout,
            lifetime,
            invalidate_query: proto.invalidate_query,
            settings: proto.settings,
            comment: proto.comment,
            life_cycle,
            version: proto.version.map(Version::from_string),
            metadata,
        }
    }
}

impl OlapDictionary {
    /// Converts a table reference string (e.g. `` `db`.`table` `` or `table`) to the
    /// canonical `Table::id()` format (`"database_tablename"`), matching the format used
    /// by `MaterializedView::table_reference_to_id`.
    fn table_reference_to_id(table_ref: &str, default_database: &str) -> String {
        let cleaned = table_ref.replace('`', "");
        let parts: Vec<&str> = cleaned.split('.').collect();
        match parts.as_slice() {
            [table] => format!("{}_{}", default_database, table),
            [database, table] => format!("{}_{}", database, table),
            _ => format!("{}_{}", default_database, cleaned),
        }
    }
}

impl DataLineage for OlapDictionary {
    /// Returns the table(s) this dictionary pulls data from.
    /// For table sources: the source table (resolved via `table_reference_to_id`).
    /// For query sources: no structured dependency (query may reference multiple tables).
    /// For external sources: no local dependency.
    fn pulls_data_from(&self, default_database: &str) -> Vec<InfrastructureSignature> {
        match &self.source {
            DictionarySource::Table(t) => {
                let table_ref = match &t.database {
                    Some(db) => format!("{}.{}", db, t.table),
                    None => t.table.clone(),
                };
                vec![InfrastructureSignature::Table {
                    id: Self::table_reference_to_id(&table_ref, default_database),
                }]
            }
            DictionarySource::Query(_) | DictionarySource::External(_) => vec![],
        }
    }

    fn pushes_data_to(&self, _default_database: &str) -> Vec<InfrastructureSignature> {
        vec![]
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn simple_dict(name: &str) -> OlapDictionary {
        OlapDictionary {
            name: name.to_string(),
            database: None,
            cluster_name: None,
            source: DictionarySource::Table(DictionaryTableSource {
                table: "source_table".to_string(),
                database: None,
                where_clause: None,
                invalidate_query: None,
            }),
            primary_key: vec!["id".to_string()],
            // All columns — including primary key columns — must be listed here.
            // Primary key columns appear first in the generated DDL.
            columns: vec![
                DictionaryColumn {
                    name: "id".to_string(),
                    type_string: "UInt64".to_string(),
                    default_value: None,
                    expression: None,
                    is_injective: None,
                    is_hierarchical: None,
                    is_object_id: None,
                    comment: None,
                },
                DictionaryColumn {
                    name: "value".to_string(),
                    type_string: "String".to_string(),
                    default_value: None,
                    expression: None,
                    is_injective: None,
                    is_hierarchical: None,
                    is_object_id: None,
                    comment: None,
                },
            ],
            layout: DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
            lifetime: DictionaryLifetime::Single { seconds: 3600 },
            invalidate_query: None,
            settings: HashMap::new(),
            comment: None,
            life_cycle: LifeCycle::FullyManaged,
            version: None,
            metadata: None,
        }
    }

    // ─── DDL generation ────────────────────────────────────────────────────

    #[test]
    fn test_create_if_not_exists_sql() {
        let dict = simple_dict("my_dict");
        let sql = dict.to_create_if_not_exists_sql();
        assert!(sql.contains("CREATE DICTIONARY IF NOT EXISTS"));
        assert!(sql.contains("`my_dict`"));
        assert!(!sql.contains("OR REPLACE"));
    }

    #[test]
    fn test_replace_sql() {
        let dict = simple_dict("my_dict");
        let sql = dict.to_replace_sql();
        assert!(sql.contains("CREATE OR REPLACE DICTIONARY"));
        assert!(sql.contains("`my_dict`"));
        assert!(!sql.contains("IF NOT EXISTS"));
    }

    #[test]
    fn test_drop_sql() {
        let dict = simple_dict("my_dict");
        let sql = dict.to_drop_sql();
        assert_eq!(sql, "DROP DICTIONARY IF EXISTS `my_dict`");
    }

    #[test]
    fn test_drop_sql_with_database() {
        let mut dict = simple_dict("my_dict");
        dict.database = Some("mydb".to_string());
        let sql = dict.to_drop_sql();
        assert_eq!(sql, "DROP DICTIONARY IF EXISTS `mydb`.`my_dict`");
    }

    #[test]
    fn test_drop_sql_with_cluster() {
        let mut dict = simple_dict("my_dict");
        dict.cluster_name = Some("mycluster".to_string());
        let sql = dict.to_drop_sql();
        assert_eq!(
            sql,
            "DROP DICTIONARY IF EXISTS `my_dict` ON CLUSTER `mycluster`"
        );
    }

    #[test]
    fn test_source_table_ddl() {
        let dict = simple_dict("my_dict");
        let sql = dict.to_create_if_not_exists_sql();
        assert!(sql.contains("SOURCE(CLICKHOUSE(TABLE 'source_table'))"));
    }

    #[test]
    fn test_source_query_ddl() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::Query(DictionaryQuerySource {
            query: "SELECT id, value FROM source_table".to_string(),
            invalidate_query: None,
        });
        let sql = dict.to_create_if_not_exists_sql();
        assert!(sql.contains("SOURCE(CLICKHOUSE(QUERY 'SELECT id, value FROM source_table'))"));
    }

    #[test]
    fn test_source_table_with_database_ddl() {
        let mut dict = simple_dict("my_dict");
        if let DictionarySource::Table(ref mut t) = dict.source {
            t.database = Some("mydb".to_string());
        }
        let sql = dict.to_create_if_not_exists_sql();
        assert!(sql.contains("SOURCE(CLICKHOUSE(DB 'mydb' TABLE 'source_table'))"));
    }

    #[test]
    fn test_source_table_with_invalidate_query_ddl() {
        let mut dict = simple_dict("my_dict");
        if let DictionarySource::Table(ref mut t) = dict.source {
            t.invalidate_query = Some("SELECT max(updated_at) FROM source_table".to_string());
        }
        let sql = dict.to_create_if_not_exists_sql();
        assert!(sql.contains("INVALIDATE_QUERY 'SELECT max(updated_at) FROM source_table'"));
    }

    // ─── Layout DDL ────────────────────────────────────────────────────────

    #[test]
    fn test_flat_layout_ddl() {
        assert_eq!(DictionaryLayout::Flat.to_ddl(), "LAYOUT(FLAT())");
    }

    #[test]
    fn test_hashed_layout_ddl_no_params() {
        let layout = DictionaryLayout::Hashed {
            initial_array_size: None,
            max_load_factor: None,
        };
        assert_eq!(layout.to_ddl(), "LAYOUT(HASHED())");
    }

    #[test]
    fn test_hashed_layout_ddl_with_params() {
        let layout = DictionaryLayout::Hashed {
            initial_array_size: Some(1024),
            max_load_factor: Some(0.8),
        };
        let ddl = layout.to_ddl();
        assert!(ddl.contains("INITIAL_ARRAY_SIZE 1024"));
        assert!(ddl.contains("MAX_LOAD_FACTOR 0.8"));
    }

    #[test]
    fn test_cache_layout_ddl() {
        let layout = DictionaryLayout::Cache {
            size_in_cells: 10000,
            max_threads_for_updates: Some(4),
        };
        let ddl = layout.to_ddl();
        assert_eq!(
            ddl,
            "LAYOUT(CACHE(SIZE_IN_CELLS 10000 MAX_THREADS_FOR_UPDATES 4))"
        );
    }

    #[test]
    fn test_range_hashed_layout_ddl() {
        let layout = DictionaryLayout::RangeHashed {
            range_lookup_strategy: None,
        };
        assert_eq!(layout.to_ddl(), "LAYOUT(RANGE_HASHED())");
    }

    #[test]
    fn test_direct_layout_ddl() {
        assert_eq!(DictionaryLayout::Direct.to_ddl(), "LAYOUT(DIRECT())");
    }

    #[test]
    fn test_ip_trie_layout_ddl() {
        let layout = DictionaryLayout::IpTrie {
            access_to_key_from_attributes: Some(true),
        };
        assert_eq!(
            layout.to_ddl(),
            "LAYOUT(IP_TRIE(ACCESS_TO_KEY_FROM_ATTRIBUTES 1))"
        );
    }

    #[test]
    fn test_ip_trie_layout_ddl_default() {
        let layout = DictionaryLayout::IpTrie {
            access_to_key_from_attributes: None,
        };
        assert_eq!(layout.to_ddl(), "LAYOUT(IP_TRIE())");
    }

    #[test]
    fn test_complex_key_hashed_layout_ddl() {
        let layout = DictionaryLayout::ComplexKeyHashed {
            initial_array_size: None,
            max_load_factor: None,
        };
        assert_eq!(layout.to_ddl(), "LAYOUT(COMPLEX_KEY_HASHED())");
    }

    #[test]
    fn test_complex_key_direct_layout_ddl() {
        assert_eq!(
            DictionaryLayout::ComplexKeyDirect.to_ddl(),
            "LAYOUT(COMPLEX_KEY_DIRECT())"
        );
    }

    #[test]
    fn test_ssd_cache_layout_ddl() {
        let layout = DictionaryLayout::SsdCache {
            path: "/data/ssd_cache".to_string(),
            block_size: Some(4096),
            file_size: None,
            read_buffer_size: None,
            write_buffer_size: None,
            max_stored_keys: None,
        };
        let ddl = layout.to_ddl();
        assert!(ddl.contains("SSD_CACHE"));
        assert!(ddl.contains("PATH '/data/ssd_cache'"));
        assert!(ddl.contains("BLOCK_SIZE 4096"));
    }

    #[test]
    fn test_hashed_array_layout_ddl() {
        let layout = DictionaryLayout::HashedArray { shards: Some(4) };
        assert_eq!(layout.to_ddl(), "LAYOUT(HASHED_ARRAY(SHARDS 4))");
    }

    #[test]
    fn test_sparse_hashed_layout_ddl() {
        let layout = DictionaryLayout::SparseHashed {
            initial_array_size: None,
            max_load_factor: None,
        };
        assert_eq!(layout.to_ddl(), "LAYOUT(SPARSE_HASHED())");
    }

    #[test]
    fn test_complex_key_cache_layout_ddl() {
        let layout = DictionaryLayout::ComplexKeyCache {
            size_in_cells: 5000,
            max_threads_for_updates: None,
        };
        assert_eq!(
            layout.to_ddl(),
            "LAYOUT(COMPLEX_KEY_CACHE(SIZE_IN_CELLS 5000))"
        );
    }

    // ─── Lifetime DDL ──────────────────────────────────────────────────────

    #[test]
    fn test_static_lifetime_ddl() {
        assert_eq!(DictionaryLifetime::Static.to_ddl(), "LIFETIME(0)");
    }

    #[test]
    fn test_single_lifetime_ddl() {
        assert_eq!(
            DictionaryLifetime::Single { seconds: 3600 }.to_ddl(),
            "LIFETIME(3600)"
        );
    }

    #[test]
    fn test_range_lifetime_ddl() {
        let lifetime = DictionaryLifetime::Range(DictionaryRangeLifetime { min: 300, max: 600 });
        assert_eq!(lifetime.to_ddl(), "LIFETIME(MIN 300 MAX 600)");
    }

    // ─── Column DDL ────────────────────────────────────────────────────────

    #[test]
    fn test_column_basic_ddl() {
        let col = DictionaryColumn {
            name: "value".to_string(),
            type_string: "String".to_string(),
            default_value: None,
            expression: None,
            is_injective: None,
            is_hierarchical: None,
            is_object_id: None,
            comment: None,
        };
        assert_eq!(col.to_ddl(), "`value` String");
    }

    #[test]
    fn test_column_with_default_ddl() {
        let col = DictionaryColumn {
            name: "name".to_string(),
            type_string: "String".to_string(),
            default_value: Some("''".to_string()),
            expression: None,
            is_injective: None,
            is_hierarchical: None,
            is_object_id: None,
            comment: None,
        };
        assert!(col.to_ddl().contains("DEFAULT ''"));
    }

    #[test]
    fn test_column_with_injective_ddl() {
        let col = DictionaryColumn {
            name: "name".to_string(),
            type_string: "String".to_string(),
            default_value: None,
            expression: None,
            is_injective: Some(true),
            is_hierarchical: None,
            is_object_id: None,
            comment: None,
        };
        assert!(col.to_ddl().contains("IS_INJECTIVE 1"));
    }

    #[test]
    fn test_column_with_hierarchical_ddl() {
        let col = DictionaryColumn {
            name: "parent_id".to_string(),
            type_string: "UInt64".to_string(),
            default_value: Some("0".to_string()),
            expression: None,
            is_injective: None,
            is_hierarchical: Some(true),
            is_object_id: None,
            comment: None,
        };
        let ddl = col.to_ddl();
        assert!(ddl.contains("IS_HIERARCHICAL 1"));
        assert!(ddl.contains("DEFAULT 0"));
    }

    // ─── ID generation ─────────────────────────────────────────────────────

    #[test]
    fn test_id_default_database() {
        let dict = simple_dict("my_dict");
        assert_eq!(dict.id("default_db"), "default_db_my_dict");
    }

    #[test]
    fn test_id_explicit_database() {
        let mut dict = simple_dict("my_dict");
        dict.database = Some("other_db".to_string());
        assert_eq!(dict.id("default_db"), "other_db_my_dict");
    }

    // ─── Data lineage ──────────────────────────────────────────────────────

    #[test]
    fn test_data_lineage_table_source() {
        let dict = simple_dict("my_dict");
        let pulls = dict.pulls_data_from("local");
        assert_eq!(pulls.len(), 1);
        assert_eq!(
            pulls[0],
            InfrastructureSignature::Table {
                id: "local_source_table".to_string()
            }
        );
        assert!(dict.pushes_data_to("local").is_empty());
    }

    #[test]
    fn test_data_lineage_table_source_with_explicit_database() {
        let mut dict = simple_dict("my_dict");
        if let DictionarySource::Table(ref mut t) = dict.source {
            t.database = Some("mydb".to_string());
        }
        let pulls = dict.pulls_data_from("local");
        assert_eq!(pulls.len(), 1);
        assert_eq!(
            pulls[0],
            InfrastructureSignature::Table {
                id: "mydb_source_table".to_string()
            }
        );
    }

    #[test]
    fn test_data_lineage_query_source_no_deps() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::Query(DictionaryQuerySource {
            query: "SELECT id, value FROM source_table".to_string(),
            invalidate_query: None,
        });
        assert!(dict.pulls_data_from("local").is_empty());
    }

    #[test]
    fn test_data_lineage_external_source_no_deps() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::External(ExternalDictionarySourceWrapper {
            external_source: ExternalDictionarySource::Http(DictionaryHttpSource {
                url: "http://example.com".to_string(),
                format: "JSONEachRow".to_string(),
                method: None,
                where_clause: None,
            }),
        });
        assert!(dict.pulls_data_from("local").is_empty());
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    #[test]
    fn test_lifecycle_default_fully_managed() {
        let dict = simple_dict("my_dict");
        assert_eq!(dict.life_cycle, LifeCycle::FullyManaged);
    }

    #[test]
    fn test_lifecycle_serde_default() {
        let json = r#"{
            "name": "my_dict",
            "source": {"type": "TABLE", "table": "t"},
            "primaryKey": ["id"],
            "columns": [],
            "layout": {"type": "FLAT"},
            "lifetime": {"type": "SINGLE", "seconds": 3600}
        }"#;
        let dict: OlapDictionary = serde_json::from_str(json).unwrap();
        assert_eq!(dict.life_cycle, LifeCycle::FullyManaged);
    }

    // ─── Proto round-trip ──────────────────────────────────────────────────

    #[test]
    fn test_proto_round_trip_table_source() {
        let dict = simple_dict("my_dict");
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        assert_eq!(restored.name, "my_dict");
        assert_eq!(restored.life_cycle, LifeCycle::FullyManaged);
        if let DictionarySource::Table(t) = &restored.source {
            assert_eq!(t.table, "source_table");
        } else {
            panic!("Expected Table source");
        }
    }

    #[test]
    fn test_proto_round_trip_hashed_layout() {
        let mut dict = simple_dict("my_dict");
        dict.layout = DictionaryLayout::Hashed {
            initial_array_size: Some(512),
            max_load_factor: Some(0.9),
        };
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        if let DictionaryLayout::Hashed {
            initial_array_size,
            max_load_factor,
        } = &restored.layout
        {
            assert_eq!(*initial_array_size, Some(512));
            assert_eq!(*max_load_factor, Some(0.9));
        } else {
            panic!("Expected Hashed layout");
        }
    }

    #[test]
    fn test_proto_round_trip_cache_layout() {
        let mut dict = simple_dict("my_dict");
        dict.layout = DictionaryLayout::Cache {
            size_in_cells: 10000,
            max_threads_for_updates: Some(8),
        };
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        if let DictionaryLayout::Cache {
            size_in_cells,
            max_threads_for_updates,
        } = &restored.layout
        {
            assert_eq!(*size_in_cells, 10000);
            assert_eq!(*max_threads_for_updates, Some(8));
        } else {
            panic!("Expected Cache layout");
        }
    }

    #[test]
    fn test_proto_round_trip_static_lifetime() {
        let mut dict = simple_dict("my_dict");
        dict.lifetime = DictionaryLifetime::Static;
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        assert_eq!(restored.lifetime, DictionaryLifetime::Static);
    }

    #[test]
    fn test_proto_round_trip_range_lifetime() {
        let mut dict = simple_dict("my_dict");
        dict.lifetime = DictionaryLifetime::Range(DictionaryRangeLifetime { min: 300, max: 600 });
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        if let DictionaryLifetime::Range(r) = &restored.lifetime {
            assert_eq!(r.min, 300);
            assert_eq!(r.max, 600);
        } else {
            panic!("Expected Range lifetime");
        }
    }

    #[test]
    fn test_proto_round_trip_query_source() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::Query(DictionaryQuerySource {
            query: "SELECT id, name FROM users".to_string(),
            invalidate_query: Some("SELECT max(updated_at) FROM users".to_string()),
        });
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        if let DictionarySource::Query(q) = &restored.source {
            assert_eq!(q.query, "SELECT id, name FROM users");
            assert_eq!(
                q.invalidate_query.as_deref(),
                Some("SELECT max(updated_at) FROM users")
            );
        } else {
            panic!("Expected Query source");
        }
    }

    #[test]
    fn test_proto_round_trip_external_http_source() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::External(ExternalDictionarySourceWrapper {
            external_source: ExternalDictionarySource::Http(DictionaryHttpSource {
                url: "http://data.example.com/dict".to_string(),
                format: "CSV".to_string(),
                method: Some("GET".to_string()),
                where_clause: None,
            }),
        });
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        if let DictionarySource::External(ExternalDictionarySourceWrapper {
            external_source: ExternalDictionarySource::Http(h),
        }) = &restored.source
        {
            assert_eq!(h.url, "http://data.example.com/dict");
            assert_eq!(h.format, "CSV");
            assert_eq!(h.method.as_deref(), Some("GET"));
        } else {
            panic!("Expected HTTP external source");
        }
    }

    #[test]
    fn test_proto_round_trip_complex_key_hashed() {
        let mut dict = simple_dict("my_dict");
        dict.primary_key = vec!["region".to_string(), "category".to_string()];
        dict.layout = DictionaryLayout::ComplexKeyHashed {
            initial_array_size: None,
            max_load_factor: None,
        };
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        assert_eq!(
            restored.primary_key,
            vec!["region".to_string(), "category".to_string()]
        );
        assert!(matches!(
            restored.layout,
            DictionaryLayout::ComplexKeyHashed { .. }
        ));
    }

    #[test]
    fn test_proto_round_trip_deletion_protected_lifecycle() {
        let mut dict = simple_dict("my_dict");
        dict.life_cycle = LifeCycle::DeletionProtected;
        let proto = dict.to_proto();
        let restored = OlapDictionary::from_proto(proto);
        assert_eq!(restored.life_cycle, LifeCycle::DeletionProtected);
    }

    #[test]
    fn test_proto_round_trip_all_layout_types() {
        let layouts = vec![
            DictionaryLayout::Flat,
            DictionaryLayout::Hashed {
                initial_array_size: None,
                max_load_factor: None,
            },
            DictionaryLayout::SparseHashed {
                initial_array_size: None,
                max_load_factor: None,
            },
            DictionaryLayout::HashedArray { shards: None },
            DictionaryLayout::RangeHashed {
                range_lookup_strategy: None,
            },
            DictionaryLayout::Cache {
                size_in_cells: 1000,
                max_threads_for_updates: None,
            },
            DictionaryLayout::SsdCache {
                path: "/var/lib/clickhouse/dict".to_string(),
                block_size: None,
                file_size: None,
                read_buffer_size: None,
                write_buffer_size: None,
                max_stored_keys: None,
            },
            DictionaryLayout::Direct,
            DictionaryLayout::IpTrie {
                access_to_key_from_attributes: None,
            },
            DictionaryLayout::ComplexKeyHashed {
                initial_array_size: None,
                max_load_factor: None,
            },
            DictionaryLayout::ComplexKeySparseHashed {
                initial_array_size: None,
                max_load_factor: None,
            },
            DictionaryLayout::ComplexKeyHashedArray { shards: None },
            DictionaryLayout::ComplexKeyCache {
                size_in_cells: 1000,
                max_threads_for_updates: None,
            },
            DictionaryLayout::ComplexKeySsdCache {
                path: "/var/lib/clickhouse/dict".to_string(),
                block_size: None,
                file_size: None,
                read_buffer_size: None,
                write_buffer_size: None,
                max_stored_keys: None,
            },
            DictionaryLayout::ComplexKeyDirect,
        ];

        for layout in layouts {
            let proto = layout.to_proto();
            let restored = DictionaryLayout::from_proto(proto);
            assert_eq!(
                std::mem::discriminant(&layout),
                std::mem::discriminant(&restored),
                "Layout variant mismatch for {:?}",
                layout
            );
        }
    }

    // ─── External sources DDL ──────────────────────────────────────────────

    #[test]
    fn test_mysql_source_ddl() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::External(ExternalDictionarySourceWrapper {
            external_source: ExternalDictionarySource::Mysql(DictionaryMysqlSource {
                host: "mysql.example.com".to_string(),
                port: 3306,
                user: "user".to_string(),
                password: "pass".to_string(),
                db: "mydb".to_string(),
                table: "mytable".to_string(),
                query: None,
                where_clause: None,
                invalidate_query: None,
            }),
        });
        let sql = dict.to_create_if_not_exists_sql();
        assert!(sql.contains("SOURCE(MYSQL(HOST 'mysql.example.com' PORT 3306"));
    }

    #[test]
    fn test_s3_source_ddl() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::External(ExternalDictionarySourceWrapper {
            external_source: ExternalDictionarySource::S3(DictionaryS3Source {
                url: "s3://bucket/data.csv".to_string(),
                format: "CSV".to_string(),
                access_key_id: None,
                secret_access_key: None,
            }),
        });
        let sql = dict.to_create_if_not_exists_sql();
        assert!(sql.contains("SOURCE(S3(URL 's3://bucket/data.csv' FORMAT 'CSV'))"));
    }

    // ─── Serde round-trip ──────────────────────────────────────────────────

    #[test]
    fn test_serde_round_trip() {
        let dict = simple_dict("my_dict");
        let json = serde_json::to_string(&dict).unwrap();
        let restored: OlapDictionary = serde_json::from_str(&json).unwrap();
        assert_eq!(dict, restored);
    }

    #[test]
    fn test_serde_external_source_round_trip() {
        let mut dict = simple_dict("my_dict");
        dict.source =
            DictionarySource::External(ExternalDictionarySource::Http(DictionaryHttpSource {
                url: "http://example.com/data.json".to_string(),
                format: "JSONEachRow".to_string(),
                method: None,
                where_clause: None,
            }));
        let json = serde_json::to_string(&dict).unwrap();
        let restored: OlapDictionary = serde_json::from_str(&json).unwrap();
        assert_eq!(dict, restored);
    }

    #[test]
    fn test_serde_camel_case() {
        let dict = simple_dict("my_dict");
        let json = serde_json::to_string(&dict).unwrap();
        assert!(json.contains("primaryKey"));
        assert!(json.contains("lifeCycle"));
        assert!(!json.contains("primary_key"));
        assert!(!json.contains("life_cycle"));
    }

    #[test]
    fn test_serde_external_source_nested_shape() {
        // Verify the JSON shape matches what the TypeScript SDK produces:
        // { "type": "EXTERNAL", "externalSource": { "type": "HTTP", … } }
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::External(ExternalDictionarySourceWrapper {
            external_source: ExternalDictionarySource::Http(DictionaryHttpSource {
                url: "https://example.com/data".to_string(),
                format: "JSONEachRow".to_string(),
                method: None,
                where_clause: None,
            }),
        });
        let json = serde_json::to_string(&dict.source).unwrap();
        // Outer discriminant at top level
        assert!(
            json.contains(r#""type":"EXTERNAL""#),
            "outer type must be EXTERNAL; got: {json}"
        );
        // Inner discriminant nested under externalSource
        assert!(
            json.contains(r#""externalSource""#),
            "wrapper field must be externalSource (camelCase); got: {json}"
        );
        assert!(
            json.contains(r#""source_type":"HTTP""#),
            "inner source_type must be HTTP; got: {json}"
        );
        // Round-trip
        let restored: DictionarySource = serde_json::from_str(&json).unwrap();
        assert_eq!(dict.source, restored);
    }

    // ─── SQL escaping regressions ─────────────────────────────────────────────

    #[test]
    fn test_ssd_cache_path_single_quote_is_escaped() {
        let mut dict = simple_dict("my_dict");
        dict.layout = DictionaryLayout::SsdCache {
            path: "/var/it's/dict".to_string(),
            block_size: None,
            file_size: None,
            read_buffer_size: None,
            write_buffer_size: None,
            max_stored_keys: None,
        };
        let sql = dict.to_create_if_not_exists_sql();
        assert!(
            sql.contains("PATH '/var/it\\'s/dict'"),
            "single quote in SsdCache PATH must be escaped; got: {sql}"
        );
    }

    #[test]
    fn test_complex_key_ssd_cache_path_single_quote_is_escaped() {
        let mut dict = simple_dict("my_dict");
        dict.layout = DictionaryLayout::ComplexKeySsdCache {
            path: "/var/it's/dict".to_string(),
            block_size: None,
            file_size: None,
            read_buffer_size: None,
            write_buffer_size: None,
            max_stored_keys: None,
        };
        let sql = dict.to_create_if_not_exists_sql();
        assert!(
            sql.contains("PATH '/var/it\\'s/dict'"),
            "single quote in ComplexKeySsdCache PATH must be escaped; got: {sql}"
        );
    }

    #[test]
    fn test_table_source_where_clause_single_quote_is_escaped() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::Table(DictionaryTableSource {
            table: "users".to_string(),
            database: None,
            where_clause: Some("name = 'O\\'Brien'".to_string()),
            invalidate_query: None,
        });
        let sql = dict.to_create_if_not_exists_sql();
        // The where_clause itself already contains \', so escaping it again
        // produces \\\' — verify the WHERE appears and isn't broken
        assert!(
            sql.contains("WHERE '"),
            "WHERE clause must appear in TABLE source DDL; got: {sql}"
        );
        // Most importantly: no unescaped single quote that would break the DDL
        // by prematurely closing the string literal.
        let where_start = sql.find("WHERE '").unwrap() + 7;
        let after_where = &sql[where_start..];
        // The closing quote must be preceded by a backslash (escaped) or the
        // clause content must not contain a bare ' that closes early.
        // We verify by checking the SQL can be round-tripped through the DDL
        // without a stray unescaped ' between WHERE ' and the next space/paren.
        assert!(
            !after_where.starts_with("name = '"),
            "unescaped inner quote in WHERE would produce nested unescaped quotes"
        );
    }

    #[test]
    fn test_table_source_invalidate_query_single_quote_is_escaped() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::Table(DictionaryTableSource {
            table: "users".to_string(),
            database: None,
            where_clause: None,
            invalidate_query: Some("SELECT max(updated_at) FROM it's_log".to_string()),
        });
        let sql = dict.to_create_if_not_exists_sql();
        assert!(
            sql.contains("INVALIDATE_QUERY 'SELECT max(updated_at) FROM it\\'s_log'"),
            "single quote in TABLE source INVALIDATE_QUERY must be escaped; got: {sql}"
        );
    }

    #[test]
    fn test_query_source_invalidate_query_single_quote_is_escaped() {
        let mut dict = simple_dict("my_dict");
        dict.source = DictionarySource::Query(DictionaryQuerySource {
            query: "SELECT id, name FROM users".to_string(),
            invalidate_query: Some("SELECT max(ts) FROM it's_log".to_string()),
        });
        let sql = dict.to_create_if_not_exists_sql();
        assert!(
            sql.contains("INVALIDATE_QUERY 'SELECT max(ts) FROM it\\'s_log'"),
            "single quote in QUERY source INVALIDATE_QUERY must be escaped; got: {sql}"
        );
    }

    #[test]
    fn test_top_level_invalidate_query_single_quote_is_escaped() {
        let mut dict = simple_dict("my_dict");
        dict.invalidate_query = Some("SELECT max(ts) FROM it's_changelog".to_string());
        let sql = dict.to_create_if_not_exists_sql();
        assert!(
            sql.contains("INVALIDATE_QUERY 'SELECT max(ts) FROM it\\'s_changelog'"),
            "single quote in top-level INVALIDATE_QUERY must be escaped; got: {sql}"
        );
    }

    // ─── Proto fallback (T4) ──────────────────────────────────────────────────

    /// When a proto ExternalSource has `ext.t = None` (proto corruption or future version),
    /// `from_proto` must not panic — it should fall back to an empty HTTP source.
    #[test]
    fn test_from_proto_external_source_none_t_falls_back_to_http() {
        use crate::proto::infrastructure_map::{
            olap_dictionary, DictionaryExternalSource as ProtoDictionaryExternalSource,
            OlapDictionary as ProtoOlapDictionary,
        };

        let mut proto = ProtoOlapDictionary::new();
        // Build an ExternalSource proto where the `t` oneof is unset (None).
        let ext = ProtoDictionaryExternalSource {
            t: None,
            ..Default::default()
        };
        proto.source = Some(olap_dictionary::Source::ExternalSource(ext));

        // Must not panic; the fallback arm logs a warning and returns Http.
        let dict = OlapDictionary::from_proto(proto);
        match dict.source {
            DictionarySource::External(ExternalDictionarySourceWrapper {
                external_source: ExternalDictionarySource::Http(h),
            }) => {
                assert!(h.url.is_empty(), "fallback HTTP url should be empty");
                assert_eq!(
                    h.format, "JSONEachRow",
                    "fallback HTTP format should be JSONEachRow"
                );
            }
            other => panic!("expected External(Http(..)) fallback, got {:?}", other),
        }
    }

    // ─── source_type_label ────────────────────────────────────────────────────

    #[test]
    fn test_source_type_label_table() {
        let source = DictionarySource::Table(DictionaryTableSource {
            table: "t".to_string(),
            database: None,
            where_clause: None,
            invalidate_query: None,
        });
        assert_eq!(source.source_type_label(), "table");
    }

    #[test]
    fn test_source_type_label_query() {
        let source = DictionarySource::Query(DictionaryQuerySource {
            query: "SELECT 1".to_string(),
            invalidate_query: None,
        });
        assert_eq!(source.source_type_label(), "query");
    }

    #[test]
    fn test_source_type_label_external() {
        let source =
            DictionarySource::External(ExternalDictionarySource::Http(DictionaryHttpSource {
                url: "http://example.com".to_string(),
                format: "JSONEachRow".to_string(),
                method: None,
                where_clause: None,
            }));
        assert_eq!(source.source_type_label(), "external");
    }

    // ─── Versioning ────────────────────────────────────────────────────────────

    #[test]
    fn test_id_without_version() {
        let dict = simple_dict("my_dict");
        assert_eq!(dict.id("local"), "local_my_dict");
        assert_eq!(dict.id("prod"), "prod_my_dict");
    }

    #[test]
    fn test_id_with_version() {
        let mut dict = simple_dict("my_dict");
        dict.version = Some(Version::from_string("0.1".to_string()));
        // Version suffix is appended to id but NOT to name
        assert_eq!(dict.id("local"), "local_my_dict_0_1");
        assert_eq!(dict.name, "my_dict");
    }

    #[test]
    fn test_proto_round_trip_with_version() {
        let mut dict = simple_dict("my_dict");
        dict.version = Some(Version::from_string("1.2".to_string()));

        let proto = dict.to_proto();
        assert_eq!(proto.version, Some("1.2".to_string()));

        let restored = OlapDictionary::from_proto(proto);
        assert_eq!(restored.version, dict.version);
        assert_eq!(restored.name, dict.name);
    }

    #[test]
    fn test_proto_round_trip_without_version() {
        let dict = simple_dict("my_dict");
        let proto = dict.to_proto();
        assert_eq!(proto.version, None);

        let restored = OlapDictionary::from_proto(proto);
        assert_eq!(restored.version, None);
    }
}
