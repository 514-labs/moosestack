//! Materialized View infrastructure component.
//!
//! This module provides a structured representation of ClickHouse Materialized Views,
//! replacing the opaque SQL strings previously stored in `SqlResource`.
//!
//! A MaterializedView consists of:
//! - A SELECT query that defines the transformation
//! - Source tables/views that the SELECT reads from (for incremental MVs)
//! - A target table where data is written
//! - A kind that specifies whether the MV is incremental or refreshable
//!
//! Two types of materialized views are supported:
//! - **Incremental (trigger-based)**: Run on every insert to source tables
//! - **Refreshable**: Run on a schedule (REFRESH EVERY/AFTER)
//!
//! This structured representation allows for:
//! - Better schema introspection
//! - More accurate change detection
//! - Clearer dependency tracking
//! - Efficient updates via ALTER TABLE MODIFY REFRESH for refresh-only changes

use protobuf::MessageField;
use serde::{Deserialize, Deserializer, Serialize};

use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::proto::infrastructure_map::LifeCycle as ProtoLifeCycle;
use crate::proto::infrastructure_map::{
    materialized_view_kind::Kind as ProtoMvKind, refresh_interval::Interval_type as IntervalType,
    IncrementalConfig as ProtoIncrementalConfig, MaterializedView as ProtoMaterializedView,
    MaterializedViewKind as ProtoMaterializedViewKind, RefreshDuration as ProtoRefreshDuration,
    RefreshInterval as ProtoRefreshInterval, RefreshableConfig as ProtoRefreshableConfig,
    SelectQuery as ProtoSelectQuery, TableReference as ProtoTableReference,
};

use super::table::Metadata;
use super::{DataLineage, InfrastructureSignature};

/// Reference to a table, optionally qualified with database.
/// Used internally for proto conversion and dependency tracking.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TableReference {
    /// Database name (None means use default database)
    pub database: Option<String>,
    /// Table name
    pub table: String,
}

impl TableReference {
    /// Create a new table reference without database qualification
    pub fn new(table: impl Into<String>) -> Self {
        Self {
            database: None,
            table: table.into(),
        }
    }

    /// Create a new table reference with database qualification
    pub fn with_database(database: impl Into<String>, table: impl Into<String>) -> Self {
        Self {
            database: Some(database.into()),
            table: table.into(),
        }
    }

    /// Returns the fully qualified name (database.table or just table)
    pub fn qualified_name(&self) -> String {
        match &self.database {
            Some(db) => format!("{}.{}", db, self.table),
            None => self.table.clone(),
        }
    }

    /// Returns the quoted identifier for use in SQL
    pub fn quoted(&self) -> String {
        match &self.database {
            Some(db) => format!("`{}`.`{}`", db, self.table),
            None => format!("`{}`", self.table),
        }
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoTableReference {
        ProtoTableReference {
            database: self.database.clone(),
            table: self.table.clone(),
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoTableReference) -> Self {
        Self {
            database: proto.database,
            table: proto.table,
        }
    }
}

/// Deserializes a field that may be present as `null` in JSON, falling back to `T::default()`.
///
/// `MaterializedView` uses `#[serde(rename_all = "camelCase")]`, so the Python SDK's
/// `"lifeCycle": null` is recognized as the field (unlike `Table` where the camelCase key is
/// simply ignored as unknown). A plain `#[serde(default)]` only applies when the field is
/// *absent*; when it's present as `null`, serde would attempt to deserialize `null` as
/// the target type and fail. This deserializer treats `null` the same as a missing field.
fn deserialize_nullable_as_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(|opt| opt.unwrap_or_default())
}

/// Supported time units for refresh intervals.
/// Maps directly to ClickHouse interval units.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeUnit {
    Second,
    Minute,
    Hour,
    Day,
    Week,
    Month,
    Year,
}

impl TimeUnit {
    /// Convert to uppercase SQL string (e.g., "HOUR", "MINUTE")
    pub fn to_sql(&self) -> &'static str {
        match self {
            TimeUnit::Second => "SECOND",
            TimeUnit::Minute => "MINUTE",
            TimeUnit::Hour => "HOUR",
            TimeUnit::Day => "DAY",
            TimeUnit::Week => "WEEK",
            TimeUnit::Month => "MONTH",
            TimeUnit::Year => "YEAR",
        }
    }

    /// Parse from a string (case-insensitive)
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "SECOND" => Some(TimeUnit::Second),
            "MINUTE" => Some(TimeUnit::Minute),
            "HOUR" => Some(TimeUnit::Hour),
            "DAY" => Some(TimeUnit::Day),
            "WEEK" => Some(TimeUnit::Week),
            "MONTH" => Some(TimeUnit::Month),
            "YEAR" => Some(TimeUnit::Year),
            _ => None,
        }
    }
}

impl std::fmt::Display for TimeUnit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_sql())
    }
}

/// A duration specified as value + unit.
/// Used for intervals, offsets, and randomization windows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Duration {
    /// The numeric value
    pub value: u64,
    /// The time unit
    pub unit: TimeUnit,
}

impl Duration {
    /// Create a new duration
    pub fn new(value: u64, unit: TimeUnit) -> Self {
        Self { value, unit }
    }

    /// Format as ClickHouse SQL fragment (e.g., "1 HOUR", "30 MINUTE")
    pub fn to_sql(&self) -> String {
        format!("{} {}", self.value, self.unit.to_sql())
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoRefreshDuration {
        ProtoRefreshDuration {
            value: self.value,
            unit: self.unit.to_sql().to_lowercase(),
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoRefreshDuration) -> Option<Self> {
        let unit = TimeUnit::parse(&proto.unit)?;
        Some(Self {
            value: proto.value,
            unit,
        })
    }
}

/// Refresh interval specification for refreshable materialized views.
///
/// ClickHouse supports two refresh modes:
/// - `Every`: Periodic refresh at fixed intervals (REFRESH EVERY 1 HOUR)
/// - `After`: Refresh after interval since last refresh completed (REFRESH AFTER 30 MINUTE)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RefreshInterval {
    /// REFRESH EVERY <interval> - periodic refresh at fixed times
    #[serde(rename = "every")]
    Every {
        /// The interval value
        value: u64,
        /// The time unit
        unit: TimeUnit,
    },
    /// REFRESH AFTER <interval> - refresh after interval since last refresh
    #[serde(rename = "after")]
    After {
        /// The interval value
        value: u64,
        /// The time unit
        unit: TimeUnit,
    },
}

impl RefreshInterval {
    /// Create an "EVERY" interval
    pub fn every(value: u64, unit: TimeUnit) -> Self {
        Self::Every { value, unit }
    }

    /// Create an "AFTER" interval
    pub fn after(value: u64, unit: TimeUnit) -> Self {
        Self::After { value, unit }
    }

    /// Create an "EVERY" interval in hours
    pub fn every_hours(hours: u64) -> Self {
        Self::Every {
            value: hours,
            unit: TimeUnit::Hour,
        }
    }

    /// Create an "EVERY" interval in minutes
    pub fn every_minutes(minutes: u64) -> Self {
        Self::Every {
            value: minutes,
            unit: TimeUnit::Minute,
        }
    }

    /// Create an "AFTER" interval in hours
    pub fn after_hours(hours: u64) -> Self {
        Self::After {
            value: hours,
            unit: TimeUnit::Hour,
        }
    }

    /// Create an "AFTER" interval in minutes
    pub fn after_minutes(minutes: u64) -> Self {
        Self::After {
            value: minutes,
            unit: TimeUnit::Minute,
        }
    }

    /// Format as ClickHouse SQL fragment (e.g., "1 HOUR")
    pub fn to_sql(&self) -> String {
        match self {
            RefreshInterval::Every { value, unit } | RefreshInterval::After { value, unit } => {
                format!("{} {}", value, unit.to_sql())
            }
        }
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoRefreshInterval {
        match self {
            RefreshInterval::Every { value, unit } => ProtoRefreshInterval {
                interval_type: Some(IntervalType::Every(ProtoRefreshDuration {
                    value: *value,
                    unit: unit.to_sql().to_lowercase(),
                    special_fields: Default::default(),
                })),
                special_fields: Default::default(),
            },
            RefreshInterval::After { value, unit } => ProtoRefreshInterval {
                interval_type: Some(IntervalType::After(ProtoRefreshDuration {
                    value: *value,
                    unit: unit.to_sql().to_lowercase(),
                    special_fields: Default::default(),
                })),
                special_fields: Default::default(),
            },
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoRefreshInterval) -> Option<Self> {
        match proto.interval_type {
            Some(IntervalType::Every(dur)) => Some(RefreshInterval::Every {
                value: dur.value,
                unit: TimeUnit::parse(&dur.unit)?,
            }),
            Some(IntervalType::After(dur)) => Some(RefreshInterval::After {
                value: dur.value,
                unit: TimeUnit::parse(&dur.unit)?,
            }),
            None => None,
        }
    }
}

/// Configuration for refreshable materialized views.
///
/// Refreshable MVs execute their SELECT query on a schedule rather than
/// on every insert to source tables.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshableConfig {
    /// The refresh interval (EVERY or AFTER)
    pub interval: RefreshInterval,
    /// Optional offset from the interval start (OFFSET 5 MINUTE)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<Duration>,
    /// Optional randomization window (RANDOMIZE FOR 10 SECOND)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub randomize: Option<Duration>,
    /// Other MVs this one depends on (DEPENDS ON other_mv1, other_mv2)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on: Vec<String>,
    /// Whether to use APPEND mode (vs full refresh)
    #[serde(default)]
    pub append: bool,
}

impl RefreshableConfig {
    /// Create a new refreshable config with just an interval
    pub fn new(interval: RefreshInterval) -> Self {
        Self {
            interval,
            offset: None,
            randomize: None,
            depends_on: Vec::new(),
            append: false,
        }
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoRefreshableConfig {
        ProtoRefreshableConfig {
            interval: MessageField::some(self.interval.to_proto()),
            offset: self.offset.as_ref().map(|d| d.to_proto()).into(),
            randomize: self.randomize.as_ref().map(|d| d.to_proto()).into(),
            depends_on: self.depends_on.clone(),
            append: self.append,
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoRefreshableConfig) -> Option<Self> {
        let interval = proto
            .interval
            .into_option()
            .and_then(RefreshInterval::from_proto)?;

        Some(Self {
            interval,
            offset: proto.offset.into_option().and_then(Duration::from_proto),
            randomize: proto.randomize.into_option().and_then(Duration::from_proto),
            depends_on: proto.depends_on,
            append: proto.append,
        })
    }
}

// Note: MaterializedViewKind enum has been removed in favor of a simpler model.
// If refresh_config is Some, it's a refreshable MV; if None, it's incremental.
// This is cleaner and avoids an empty IncrementalConfig marker type.


/// Represents a ClickHouse Materialized View.
///
/// A MaterializedView is a special view that:
/// 1. Runs a SELECT query whenever data is inserted into source tables (incremental)
/// 2. Or runs on a schedule (refreshable)
/// 3. Writes the transformed results to a target table
///
/// Unlike regular views, MVs persist data and can significantly speed up
/// queries at the cost of storage and insert-time computation.
///
/// Two types of materialized views are supported:
/// - **Incremental**: Triggered on every insert to source tables (refresh_config is None)
/// - **Refreshable**: Runs on a schedule (refresh_config is Some)
///
/// The structure is flat to match JSON output from TypeScript/Python moose-lib.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedView {
    /// Name of the materialized view
    pub name: String,

    /// Database where the MV is created (None = default database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,

    /// The raw SELECT SQL statement
    pub select_sql: String,

    /// Names of source tables/views referenced in the SELECT.
    /// This field is used for BOTH incremental and refreshable MVs:
    /// - For incremental MVs: these tables trigger the MV on insert
    /// - For refreshable MVs: these tables are read during scheduled refresh (data lineage)
    #[serde(default)]
    pub source_tables: Vec<String>,

    /// Name of the target table where transformed data is written
    pub target_table: String,

    /// Database of the target table (None = same as MV database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub target_database: Option<String>,

    /// Optional metadata for the materialized view (e.g., description, source file)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub metadata: Option<Metadata>,

    /// Lifecycle management policy for the materialized view.
    /// Controls whether Moose can drop or modify the MV automatically.
    #[serde(default, deserialize_with = "deserialize_nullable_as_default")]
    pub life_cycle: LifeCycle,

    /// Refresh configuration for refreshable MVs.
    /// If Some, this is a refreshable MV that runs on a schedule.
    /// If None, this is an incremental MV triggered by inserts to source_tables.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub refresh_config: Option<RefreshableConfig>,
}

impl MaterializedView {
    /// Creates a new incremental MaterializedView
    pub fn new(
        name: impl Into<String>,
        select_sql: impl Into<String>,
        source_tables: Vec<String>,
        target_table: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            database: None,
            select_sql: select_sql.into(),
            source_tables,
            target_table: target_table.into(),
            target_database: None,
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            refresh_config: None, // Incremental MV
        }
    }

    /// Creates a new incremental MaterializedView (alias for new)
    pub fn new_incremental(
        name: impl Into<String>,
        select_sql: impl Into<String>,
        source_tables: Vec<String>,
        target_table: impl Into<String>,
    ) -> Self {
        Self::new(name, select_sql, source_tables, target_table)
    }

    /// Creates a new refreshable MaterializedView
    ///
    /// Note: `source_tables` should list the tables read by the SELECT for data lineage tracking.
    pub fn new_refreshable(
        name: impl Into<String>,
        select_sql: impl Into<String>,
        source_tables: Vec<String>,
        target_table: impl Into<String>,
        refresh_config: RefreshableConfig,
    ) -> Self {
        Self {
            name: name.into(),
            database: None,
            select_sql: select_sql.into(),
            source_tables,
            target_table: target_table.into(),
            target_database: None,
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            refresh_config: Some(refresh_config),
        }
    }

    /// Returns true if this is an incremental (trigger-based) MV
    pub fn is_incremental(&self) -> bool {
        self.refresh_config.is_none()
    }

    /// Returns true if this is a refreshable (scheduled) MV
    pub fn is_refreshable(&self) -> bool {
        self.refresh_config.is_some()
    }

    /// Returns the source tables for this MV.
    /// Both incremental and refreshable MVs have source tables - the tables
    /// referenced in the SELECT query. For incremental MVs these also serve
    /// as triggers; for refreshable MVs they track data lineage.
    pub fn get_source_tables(&self) -> &[String] {
        &self.source_tables
    }

    /// Returns the refreshable config if this is a refreshable MV
    pub fn refreshable_config(&self) -> Option<&RefreshableConfig> {
        self.refresh_config.as_ref()
    }

    /// Returns a unique identifier for this MV
    ///
    /// Format: `{database}_{name}` to ensure uniqueness across databases
    pub fn id(&self, default_database: &str) -> String {
        let db = self.database.as_deref().unwrap_or(default_database);
        format!("{}_{}", db, self.name)
    }

    /// Returns the quoted view name for SQL
    pub fn quoted_name(&self) -> String {
        match &self.database {
            Some(db) => format!("`{}`.`{}`", db, self.name),
            None => format!("`{}`", self.name),
        }
    }

    /// Returns the quoted target table name for SQL
    pub fn quoted_target_table(&self) -> String {
        match &self.target_database {
            Some(db) => format!("`{}`.`{}`", db, self.target_table),
            None => format!("`{}`", self.target_table),
        }
    }

    /// Format the REFRESH clause for refreshable MVs
    fn format_refresh_clause(config: &RefreshableConfig) -> String {
        let mut parts = Vec::new();

        // Add interval type
        match &config.interval {
            RefreshInterval::Every { value, unit } => {
                parts.push(format!("EVERY {} {}", value, unit.to_sql()));
            }
            RefreshInterval::After { value, unit } => {
                parts.push(format!("AFTER {} {}", value, unit.to_sql()));
            }
        }

        // Add optional OFFSET
        if let Some(offset) = &config.offset {
            parts.push(format!("OFFSET {}", offset.to_sql()));
        }

        // Add optional RANDOMIZE FOR
        if let Some(randomize) = &config.randomize {
            parts.push(format!("RANDOMIZE FOR {}", randomize.to_sql()));
        }

        // Add optional DEPENDS ON
        if !config.depends_on.is_empty() {
            parts.push(format!("DEPENDS ON {}", config.depends_on.join(", ")));
        }

        // Add optional APPEND
        if config.append {
            parts.push("APPEND".to_string());
        }

        parts.join(" ")
    }

    /// Generates the CREATE MATERIALIZED VIEW SQL statement
    pub fn to_create_sql(&self) -> String {
        let refresh_clause = match self.refreshable_config() {
            Some(config) => format!(" REFRESH {}", Self::format_refresh_clause(config)),
            None => String::new(),
        };

        format!(
            "CREATE MATERIALIZED VIEW IF NOT EXISTS {}{} TO {} AS {}",
            self.quoted_name(),
            refresh_clause,
            self.quoted_target_table(),
            self.select_sql
        )
    }

    /// Returns the REFRESH clause (e.g. "REFRESH EVERY 1 HOUR OFFSET 5 MINUTE")
    /// for use in CREATE MATERIALIZED VIEW statements. Returns None for incremental MVs.
    pub fn refresh_clause(&self) -> Option<String> {
        self.refreshable_config()
            .map(|config| format!("REFRESH {}", Self::format_refresh_clause(config)))
    }

    /// Generates the ALTER TABLE MODIFY REFRESH SQL statement.
    /// Only valid for refreshable MVs.
    pub fn to_alter_refresh_sql(&self) -> Option<String> {
        self.refreshable_config().map(|config| {
            format!(
                "ALTER TABLE {} MODIFY REFRESH {}",
                self.quoted_name(),
                Self::format_refresh_clause(config)
            )
        })
    }

    /// Generates the DROP VIEW SQL statement
    pub fn to_drop_sql(&self) -> String {
        format!("DROP VIEW IF EXISTS {}", self.quoted_name())
    }

    /// Short display string for logging/UI
    pub fn short_display(&self) -> String {
        let kind_str = if self.is_refreshable() {
            " (refreshable)"
        } else {
            ""
        };
        format!(
            "MaterializedView{}: {} -> {}",
            kind_str, self.name, self.target_table
        )
    }

    /// Expanded display string with more details
    pub fn expanded_display(&self) -> String {
        match self.refreshable_config() {
            Some(config) => {
                let interval_str = match &config.interval {
                    RefreshInterval::Every { value, unit } => {
                        format!("EVERY {} {}", value, unit.to_sql())
                    }
                    RefreshInterval::After { value, unit } => {
                        format!("AFTER {} {}", value, unit.to_sql())
                    }
                };
                format!(
                    "MaterializedView: {} (refresh: {}) -> {}",
                    self.name, interval_str, self.target_table
                )
            }
            None => {
                format!(
                    "MaterializedView: {} (sources: {:?}) -> {}",
                    self.name,
                    self.get_source_tables(),
                    self.target_table
                )
            }
        }
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoMaterializedView {
        // Get source tables from the effective kind
        let source_tables_for_select = self.get_source_tables();

        let select_query = ProtoSelectQuery {
            sql: self.select_sql.clone(),
            source_tables: source_tables_for_select
                .iter()
                .map(|t| ProtoTableReference {
                    database: None,
                    table: t.clone(),
                    special_fields: Default::default(),
                })
                .collect(),
            special_fields: Default::default(),
        };

        let target_table = ProtoTableReference {
            database: self.target_database.clone(),
            table: self.target_table.clone(),
            special_fields: Default::default(),
        };

        // Convert refresh_config to proto's MaterializedViewKind format
        let proto_kind = match &self.refresh_config {
            None => ProtoMaterializedViewKind {
                kind: Some(ProtoMvKind::Incremental(ProtoIncrementalConfig {
                    source_tables: Vec::new(), // Deprecated, source_tables are in select_query
                    special_fields: Default::default(),
                })),
                special_fields: Default::default(),
            },
            Some(config) => ProtoMaterializedViewKind {
                kind: Some(ProtoMvKind::Refreshable(config.to_proto())),
                special_fields: Default::default(),
            },
        };

        ProtoMaterializedView {
            name: self.name.clone(),
            database: self.database.clone(),
            select_query: MessageField::some(select_query),
            target_table: MessageField::some(target_table),
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
            life_cycle: match self.life_cycle {
                LifeCycle::FullyManaged => ProtoLifeCycle::FULLY_MANAGED.into(),
                LifeCycle::DeletionProtected => ProtoLifeCycle::DELETION_PROTECTED.into(),
                LifeCycle::ExternallyManaged => ProtoLifeCycle::EXTERNALLY_MANAGED.into(),
            },
            kind: MessageField::some(proto_kind),
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoMaterializedView) -> Self {
        let (select_sql, source_tables) = proto
            .select_query
            .as_ref()
            .map(|sq| {
                (
                    sq.sql.clone(),
                    sq.source_tables
                        .iter()
                        .map(|t| t.table.clone())
                        .collect::<Vec<_>>(),
                )
            })
            .unwrap_or_default();

        let (target_table, target_database) = proto
            .target_table
            .as_ref()
            .map(|t| (t.table.clone(), t.database.clone()))
            .unwrap_or_default();

        let metadata = proto.metadata.into_option().map(|m| Metadata {
            description: if m.description.is_empty() {
                None
            } else {
                Some(m.description)
            },
            source: m
                .source
                .into_option()
                .map(|s| super::table::SourceLocation { file: s.file }),
        });

        let life_cycle = match proto.life_cycle.enum_value_or_default() {
            ProtoLifeCycle::FULLY_MANAGED => LifeCycle::FullyManaged,
            ProtoLifeCycle::DELETION_PROTECTED => LifeCycle::DeletionProtected,
            ProtoLifeCycle::EXTERNALLY_MANAGED => LifeCycle::ExternallyManaged,
        };

        // Parse refresh_config from proto's MaterializedViewKind
        // If Incremental or missing, refresh_config is None
        // If Refreshable, extract the config
        let refresh_config = proto.kind.into_option().and_then(|kind| match kind.kind {
            Some(ProtoMvKind::Refreshable(config)) => RefreshableConfig::from_proto(config),
            _ => None, // Incremental or missing -> None
        });

        Self {
            name: proto.name,
            database: proto.database,
            select_sql,
            source_tables,
            target_table,
            target_database,
            metadata,
            life_cycle,
            refresh_config,
        }
    }
}

impl MaterializedView {
    /// Parse a table reference string (e.g., "`table`" or "`database`.`table`")
    /// and return the database and table names with backticks removed.
    ///
    /// Returns (database, table) where database is None if not specified.
    fn parse_table_reference(table_ref: &str) -> (Option<String>, String) {
        // Remove backticks and split by '.'
        let cleaned = table_ref.replace('`', "");
        let parts: Vec<&str> = cleaned.split('.').collect();

        match parts.as_slice() {
            [table] => (None, table.to_string()),
            [database, table] => (Some(database.to_string()), table.to_string()),
            _ => {
                // Fallback: treat the whole string as table name
                (None, cleaned)
            }
        }
    }

    /// Convert a table reference string to a Table ID format: "database_tablename"
    ///
    /// This matches the format used by `Table::id(default_database)` to ensure
    /// dependency edges connect properly in the DDL ordering graph.
    fn table_reference_to_id(table_ref: &str, default_database: &str) -> String {
        let (db, table) = Self::parse_table_reference(table_ref);
        let database = db.as_deref().unwrap_or(default_database);
        format!("{}_{}", database, table)
    }
}

impl DataLineage for MaterializedView {
    fn pulls_data_from(&self, default_database: &str) -> Vec<InfrastructureSignature> {
        // Both incremental and refreshable MVs have source tables for data lineage
        let mut signatures: Vec<InfrastructureSignature> = self
            .get_source_tables()
            .iter()
            .map(|t| InfrastructureSignature::Table {
                id: Self::table_reference_to_id(t, default_database),
            })
            .collect();

        // For refreshable MVs, also add dependencies on other MVs (DEPENDS ON clause)
        if let Some(config) = &self.refresh_config {
            for dep in &config.depends_on {
                signatures.push(InfrastructureSignature::MaterializedView {
                    id: format!("{}_{}", default_database, dep),
                });
            }
        }

        signatures
    }

    fn pushes_data_to(&self, default_database: &str) -> Vec<InfrastructureSignature> {
        vec![InfrastructureSignature::Table {
            id: Self::table_reference_to_id(&self.target_table, default_database),
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_table_reference_qualified_name() {
        let simple = TableReference::new("users");
        assert_eq!(simple.qualified_name(), "users");

        let qualified = TableReference::with_database("mydb", "users");
        assert_eq!(qualified.qualified_name(), "mydb.users");
    }

    #[test]
    fn test_table_reference_quoted() {
        let simple = TableReference::new("users");
        assert_eq!(simple.quoted(), "`users`");

        let qualified = TableReference::with_database("mydb", "users");
        assert_eq!(qualified.quoted(), "`mydb`.`users`");
    }

    #[test]
    fn test_materialized_view_create_sql() {
        let mv = MaterializedView::new(
            "user_stats_mv",
            "SELECT user_id, count(*) as cnt FROM events GROUP BY user_id",
            vec!["events".to_string()],
            "user_stats",
        );

        let sql = mv.to_create_sql();
        assert!(sql.contains("CREATE MATERIALIZED VIEW IF NOT EXISTS"));
        assert!(sql.contains("`user_stats_mv`"));
        assert!(sql.contains("TO `user_stats`"));
        assert!(sql.contains("SELECT user_id, count(*) as cnt FROM events GROUP BY user_id"));
        // Incremental MV should not have REFRESH clause
        assert!(!sql.contains("REFRESH"));
    }

    #[test]
    fn test_refreshable_mv_create_sql_every() {
        let refresh_config = RefreshableConfig {
            interval: RefreshInterval::every(1, TimeUnit::Hour),
            offset: Some(Duration::new(5, TimeUnit::Minute)),
            randomize: None,
            depends_on: Vec::new(),
            append: false,
        };

        let mv = MaterializedView::new_refreshable(
            "hourly_stats_mv",
            "SELECT count(*) as cnt FROM events",
            vec!["events".to_string()],
            "hourly_stats",
            refresh_config,
        );

        let sql = mv.to_create_sql();
        assert!(sql.contains("CREATE MATERIALIZED VIEW IF NOT EXISTS"));
        assert!(sql.contains("`hourly_stats_mv`"));
        assert!(sql.contains("REFRESH EVERY 1 HOUR OFFSET 5 MINUTE"));
        assert!(sql.contains("TO `hourly_stats`"));
    }

    #[test]
    fn test_refreshable_mv_create_sql_after() {
        let refresh_config = RefreshableConfig {
            interval: RefreshInterval::after(30, TimeUnit::Minute),
            offset: None,
            randomize: Some(Duration::new(1, TimeUnit::Minute)),
            depends_on: vec!["other_mv".to_string()],
            append: true,
        };

        let mv = MaterializedView::new_refreshable(
            "derived_mv",
            "SELECT * FROM other_mv",
            vec!["other_mv".to_string()],
            "derived_table",
            refresh_config,
        );

        let sql = mv.to_create_sql();
        assert!(sql.contains("REFRESH AFTER 30 MINUTE"));
        assert!(sql.contains("RANDOMIZE FOR 1 MINUTE"));
        assert!(sql.contains("DEPENDS ON other_mv"));
        assert!(sql.contains("APPEND"));
    }

    #[test]
    fn test_refreshable_mv_alter_refresh_sql() {
        let refresh_config = RefreshableConfig::new(RefreshInterval::every(2, TimeUnit::Hour));

        let mv = MaterializedView::new_refreshable(
            "hourly_stats_mv",
            "SELECT count(*) as cnt FROM events",
            vec!["events".to_string()],
            "hourly_stats",
            refresh_config,
        );

        let alter_sql = mv.to_alter_refresh_sql();
        assert!(alter_sql.is_some());
        let sql = alter_sql.unwrap();
        assert!(sql.contains("ALTER TABLE `hourly_stats_mv` MODIFY REFRESH EVERY 2 HOUR"));
    }

    #[test]
    fn test_incremental_mv_no_alter_refresh() {
        let mv = MaterializedView::new(
            "user_stats_mv",
            "SELECT user_id, count(*) as cnt FROM events GROUP BY user_id",
            vec!["events".to_string()],
            "user_stats",
        );

        // Incremental MVs should not support ALTER REFRESH
        assert!(mv.to_alter_refresh_sql().is_none());
    }

    #[test]
    fn test_materialized_view_is_incremental() {
        let mv = MaterializedView::new(
            "mv",
            "SELECT * FROM events",
            vec!["events".to_string()],
            "target",
        );
        assert!(mv.is_incremental());
        assert!(!mv.is_refreshable());
    }

    #[test]
    fn test_materialized_view_is_refreshable() {
        let refresh_config = RefreshableConfig::new(RefreshInterval::every(1, TimeUnit::Hour));
        let mv = MaterializedView::new_refreshable(
            "mv",
            "SELECT * FROM events",
            vec!["events".to_string()],
            "target",
            refresh_config,
        );
        assert!(!mv.is_incremental());
        assert!(mv.is_refreshable());
    }

    #[test]
    fn test_materialized_view_data_lineage() {
        let mv = MaterializedView::new(
            "mv",
            "SELECT * FROM a JOIN b ON a.id = b.id",
            vec!["a".to_string(), "b".to_string()],
            "target",
        );

        let pulls = mv.pulls_data_from("local");
        assert_eq!(pulls.len(), 2);

        let pushes = mv.pushes_data_to("local");
        assert_eq!(pushes.len(), 1);
    }

    #[test]
    fn test_refreshable_mv_data_lineage_with_depends_on() {
        let refresh_config = RefreshableConfig {
            interval: RefreshInterval::every(1, TimeUnit::Hour),
            offset: None,
            randomize: None,
            depends_on: vec!["other_mv".to_string(), "another_mv".to_string()],
            append: false,
        };

        let mv = MaterializedView::new_refreshable(
            "derived_mv",
            "SELECT * FROM target_table",
            vec!["target_table".to_string()],
            "derived_table",
            refresh_config,
        );

        let pulls = mv.pulls_data_from("local");
        // Should include the source tables AND the dependent MVs
        assert_eq!(pulls.len(), 3);
        assert!(pulls.contains(&InfrastructureSignature::Table {
            id: "local_target_table".to_string()
        }));
        assert!(pulls.contains(&InfrastructureSignature::MaterializedView {
            id: "local_other_mv".to_string()
        }));
        assert!(pulls.contains(&InfrastructureSignature::MaterializedView {
            id: "local_another_mv".to_string()
        }));
    }

    #[test]
    fn test_materialized_view_data_lineage_with_backticks() {
        // Test with backticked table names (as they come from TypeScript/Python)
        let mv = MaterializedView::new(
            "mv",
            "SELECT * FROM events",
            vec!["`events`".to_string()],
            "`target`",
        );

        let pulls = mv.pulls_data_from("local");
        assert_eq!(pulls.len(), 1);
        // Should match Table::id format: "database_tablename"
        assert_eq!(
            pulls[0],
            InfrastructureSignature::Table {
                id: "local_events".to_string()
            }
        );

        let pushes = mv.pushes_data_to("local");
        assert_eq!(pushes.len(), 1);
        assert_eq!(
            pushes[0],
            InfrastructureSignature::Table {
                id: "local_target".to_string()
            }
        );
    }

    #[test]
    fn test_materialized_view_data_lineage_with_database_qualifier() {
        // Test with database-qualified table names
        let mv = MaterializedView::new(
            "mv",
            "SELECT * FROM mydb.events",
            vec!["`mydb`.`events`".to_string()],
            "`otherdb`.`target`",
        );

        let pulls = mv.pulls_data_from("local");
        assert_eq!(pulls.len(), 1);
        // Should use the explicit database, not default
        assert_eq!(
            pulls[0],
            InfrastructureSignature::Table {
                id: "mydb_events".to_string()
            }
        );

        let pushes = mv.pushes_data_to("local");
        assert_eq!(pushes.len(), 1);
        assert_eq!(
            pushes[0],
            InfrastructureSignature::Table {
                id: "otherdb_target".to_string()
            }
        );
    }

    #[test]
    fn test_materialized_view_id() {
        let mv = MaterializedView::new("my_mv", "SELECT 1", vec![], "target");
        assert_eq!(mv.id("default_db"), "default_db_my_mv");

        let mv_with_db = MaterializedView {
            database: Some("other_db".to_string()),
            ..mv
        };
        assert_eq!(mv_with_db.id("default_db"), "other_db_my_mv");
    }

    #[test]
    fn test_materialized_view_life_cycle_default() {
        let mv = MaterializedView::new("test_mv", "SELECT 1", vec![], "target");
        assert_eq!(mv.life_cycle, LifeCycle::FullyManaged);
    }

    #[test]
    fn test_materialized_view_life_cycle_serde_default() {
        // Deserializing JSON without lifeCycle should default to FullyManaged
        let json = r#"{
            "name": "test_mv",
            "selectSql": "SELECT 1",
            "sourceTables": [],
            "targetTable": "target"
        }"#;
        let mv: MaterializedView = serde_json::from_str(json).unwrap();
        assert_eq!(mv.life_cycle, LifeCycle::FullyManaged);
    }

    #[test]
    fn test_materialized_view_life_cycle_serde_round_trip() {
        let mut mv = MaterializedView::new("test_mv", "SELECT 1", vec![], "target");
        mv.life_cycle = LifeCycle::DeletionProtected;

        let json = serde_json::to_string(&mv).unwrap();
        assert!(
            json.contains("DELETION_PROTECTED"),
            "Expected lifeCycle in JSON"
        );

        let deserialized: MaterializedView = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.life_cycle, LifeCycle::DeletionProtected);
    }

    #[test]
    fn test_materialized_view_proto_round_trip() {
        let mut mv = MaterializedView::new(
            "test_mv",
            "SELECT * FROM source",
            vec!["source".to_string()],
            "target",
        );
        mv.life_cycle = LifeCycle::ExternallyManaged;

        let proto = mv.to_proto();
        let restored = MaterializedView::from_proto(proto);
        assert_eq!(restored.life_cycle, LifeCycle::ExternallyManaged);
    }

    #[test]
    fn test_materialized_view_proto_default_life_cycle() {
        // Proto with default field (0 = FULLY_MANAGED) should deserialize to FullyManaged
        use crate::proto::infrastructure_map::MaterializedView as ProtoMv;
        let proto = ProtoMv {
            name: "test".to_string(),
            ..Default::default()
        };
        let mv = MaterializedView::from_proto(proto);
        assert_eq!(mv.life_cycle, LifeCycle::FullyManaged);
    }

    #[test]
    fn test_materialized_view_life_cycle_serde_null() {
        // Python SDK emits "lifeCycle": null when life_cycle is unset — must default to FullyManaged
        let json = r#"{
            "name": "test_mv",
            "selectSql": "SELECT 1",
            "sourceTables": [],
            "targetTable": "target",
            "lifeCycle": null
        }"#;
        let mv: MaterializedView = serde_json::from_str(json).unwrap();
        assert_eq!(mv.life_cycle, LifeCycle::FullyManaged);
    }

    #[test]
    fn test_materialized_view_serde_camel_case() {
        let mv = MaterializedView::new(
            "test_mv",
            "SELECT * FROM source",
            vec!["source".to_string()],
            "target",
        );

        let json = serde_json::to_string(&mv).unwrap();
        assert!(json.contains("selectSql"));
        assert!(json.contains("sourceTables"));
        assert!(json.contains("targetTable"));
        assert!(!json.contains("select_sql"));
        assert!(!json.contains("source_tables"));
        assert!(!json.contains("target_table"));
    }

    #[test]
    fn test_materialized_view_serde_incremental() {
        let mv = MaterializedView::new(
            "test_mv",
            "SELECT * FROM source",
            vec!["source".to_string()],
            "target",
        );

        let json = serde_json::to_string(&mv).unwrap();
        // Incremental MVs should NOT have a refreshConfig field (it's None and skipped)
        assert!(!json.contains("refreshConfig"));

        // Round-trip
        let deserialized: MaterializedView = serde_json::from_str(&json).unwrap();
        assert!(deserialized.is_incremental());
        assert!(!deserialized.is_refreshable());
        assert_eq!(deserialized.get_source_tables(), &["source".to_string()]);
    }

    #[test]
    fn test_materialized_view_serde_refreshable() {
        let refresh_config = RefreshableConfig {
            interval: RefreshInterval::every(1, TimeUnit::Hour),
            offset: Some(Duration::new(5, TimeUnit::Minute)),
            randomize: None,
            depends_on: vec!["dep1".to_string()],
            append: true,
        };

        let mv = MaterializedView::new_refreshable(
            "test_mv",
            "SELECT * FROM source",
            vec!["source".to_string()],
            "target",
            refresh_config,
        );

        let json = serde_json::to_string(&mv).unwrap();
        // Refreshable MVs should have a refreshConfig field
        assert!(json.contains("refreshConfig"));
        // The interval should have type discriminator
        assert!(json.contains(r#""type":"every""#));

        // Round-trip
        let deserialized: MaterializedView = serde_json::from_str(&json).unwrap();
        assert!(deserialized.is_refreshable());
        assert!(!deserialized.is_incremental());
        let config = deserialized.refreshable_config().unwrap();
        assert_eq!(config.offset, Some(Duration::new(5, TimeUnit::Minute)));
        assert_eq!(config.depends_on, vec!["dep1".to_string()]);
        assert!(config.append);
    }

    #[test]
    fn test_duration_to_sql() {
        assert_eq!(Duration::new(30, TimeUnit::Second).to_sql(), "30 SECOND");
        assert_eq!(Duration::new(1, TimeUnit::Minute).to_sql(), "1 MINUTE");
        assert_eq!(Duration::new(1, TimeUnit::Hour).to_sql(), "1 HOUR");
        assert_eq!(Duration::new(2, TimeUnit::Day).to_sql(), "2 DAY");
        assert_eq!(Duration::new(1, TimeUnit::Month).to_sql(), "1 MONTH");
        assert_eq!(Duration::new(1, TimeUnit::Year).to_sql(), "1 YEAR");
    }

    #[test]
    fn test_refresh_interval_every_hours() {
        let interval = RefreshInterval::every_hours(2);
        assert_eq!(
            interval,
            RefreshInterval::Every {
                value: 2,
                unit: TimeUnit::Hour
            }
        );
    }

    #[test]
    fn test_refresh_interval_every_minutes() {
        let interval = RefreshInterval::every_minutes(15);
        assert_eq!(
            interval,
            RefreshInterval::Every {
                value: 15,
                unit: TimeUnit::Minute
            }
        );
    }

    #[test]
    fn test_refresh_interval_after_hours() {
        let interval = RefreshInterval::after_hours(1);
        assert_eq!(
            interval,
            RefreshInterval::After {
                value: 1,
                unit: TimeUnit::Hour
            }
        );
    }

    #[test]
    fn test_refresh_interval_after_minutes() {
        let interval = RefreshInterval::after_minutes(30);
        assert_eq!(
            interval,
            RefreshInterval::After {
                value: 30,
                unit: TimeUnit::Minute
            }
        );
    }

    #[test]
    fn test_backward_compat_no_kind_field() {
        // Test deserialization without kind field (backward compatibility)
        let json = r#"{
            "name": "test_mv",
            "selectSql": "SELECT * FROM source",
            "sourceTables": ["source"],
            "targetTable": "target"
        }"#;

        let mv: MaterializedView = serde_json::from_str(json).unwrap();
        // Should default to incremental with source_tables from the field
        assert!(mv.is_incremental());
        assert_eq!(mv.get_source_tables(), &["source".to_string()]);
    }

    #[test]
    fn test_deserialize_from_sdk_format() {
        // Test deserializing JSON as sent by TypeScript/Python SDKs
        let json = r#"{
            "name": "hourly_stats_mv",
            "selectSql": "SELECT count(*) FROM events",
            "sourceTables": ["events"],
            "targetTable": "hourly_stats",
            "refreshConfig": {
                "interval": { "type": "every", "value": 1, "unit": "hour" },
                "offset": { "value": 5, "unit": "minute" },
                "dependsOn": ["other_mv"],
                "append": false
            }
        }"#;

        let mv: MaterializedView = serde_json::from_str(json).unwrap();
        assert!(mv.is_refreshable());
        let config = mv.refreshable_config().unwrap();
        assert_eq!(config.offset, Some(Duration::new(5, TimeUnit::Minute)));
        assert_eq!(config.depends_on, vec!["other_mv".to_string()]);
        assert!(!config.append);

        match &config.interval {
            RefreshInterval::Every { value, unit } => {
                assert_eq!(*value, 1);
                assert_eq!(*unit, TimeUnit::Hour);
            }
            _ => panic!("Expected Every interval"),
        }
    }
}
