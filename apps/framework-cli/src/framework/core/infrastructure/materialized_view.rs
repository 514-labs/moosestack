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
use serde::{Deserialize, Serialize};

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

/// Refresh interval specification for refreshable materialized views.
///
/// ClickHouse supports two refresh modes:
/// - `Every`: Periodic refresh at fixed intervals (REFRESH EVERY 1 hour)
/// - `After`: Refresh after interval since last refresh completed (REFRESH AFTER 30 minutes)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RefreshInterval {
    /// REFRESH EVERY <interval> - periodic refresh at fixed times
    #[serde(rename = "every")]
    Every {
        /// Interval in seconds
        interval: u64,
    },
    /// REFRESH AFTER <interval> - refresh after interval since last refresh
    #[serde(rename = "after")]
    After {
        /// Interval in seconds
        interval: u64,
    },
}

impl RefreshInterval {
    /// Create an "EVERY" interval from seconds
    pub fn every(seconds: u64) -> Self {
        Self::Every { interval: seconds }
    }

    /// Create an "AFTER" interval from seconds
    pub fn after(seconds: u64) -> Self {
        Self::After { interval: seconds }
    }

    /// Create an "EVERY" interval from hours
    pub fn every_hours(hours: u64) -> Self {
        Self::Every {
            interval: hours * 3600,
        }
    }

    /// Create an "EVERY" interval from minutes
    pub fn every_minutes(minutes: u64) -> Self {
        Self::Every {
            interval: minutes * 60,
        }
    }

    /// Create an "AFTER" interval from hours
    pub fn after_hours(hours: u64) -> Self {
        Self::After {
            interval: hours * 3600,
        }
    }

    /// Create an "AFTER" interval from minutes
    pub fn after_minutes(minutes: u64) -> Self {
        Self::After {
            interval: minutes * 60,
        }
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoRefreshInterval {
        match self {
            RefreshInterval::Every { interval } => ProtoRefreshInterval {
                interval_type: Some(IntervalType::Every(ProtoRefreshDuration {
                    seconds: *interval,
                    special_fields: Default::default(),
                })),
                special_fields: Default::default(),
            },
            RefreshInterval::After { interval } => ProtoRefreshInterval {
                interval_type: Some(IntervalType::After(ProtoRefreshDuration {
                    seconds: *interval,
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
                interval: dur.seconds,
            }),
            Some(IntervalType::After(dur)) => Some(RefreshInterval::After {
                interval: dur.seconds,
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
    /// Optional offset from the interval start in seconds (OFFSET 5 minutes)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    /// Optional randomization window in seconds (RANDOMIZE FOR 10 seconds)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub randomize: Option<u64>,
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
            offset: self
                .offset
                .map(|secs| ProtoRefreshDuration {
                    seconds: secs,
                    special_fields: Default::default(),
                })
                .into(),
            randomize: self
                .randomize
                .map(|secs| ProtoRefreshDuration {
                    seconds: secs,
                    special_fields: Default::default(),
                })
                .into(),
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
            offset: proto.offset.into_option().map(|d| d.seconds),
            randomize: proto.randomize.into_option().map(|d| d.seconds),
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

    /// Format seconds as a ClickHouse interval string (e.g., "1 HOUR", "30 MINUTE")
    fn format_seconds(secs: u64) -> String {
        if secs.is_multiple_of(86400) && secs >= 86400 {
            format!("{} DAY", secs / 86400)
        } else if secs.is_multiple_of(3600) && secs >= 3600 {
            format!("{} HOUR", secs / 3600)
        } else if secs.is_multiple_of(60) && secs >= 60 {
            format!("{} MINUTE", secs / 60)
        } else {
            format!("{} SECOND", secs)
        }
    }

    /// Format the REFRESH clause for refreshable MVs
    fn format_refresh_clause(config: &RefreshableConfig) -> String {
        let mut parts = Vec::new();

        // Add interval type
        match &config.interval {
            RefreshInterval::Every { interval } => {
                parts.push(format!("EVERY {}", Self::format_seconds(*interval)));
            }
            RefreshInterval::After { interval } => {
                parts.push(format!("AFTER {}", Self::format_seconds(*interval)));
            }
        }

        // Add optional OFFSET
        if let Some(offset) = config.offset {
            parts.push(format!("OFFSET {}", Self::format_seconds(offset)));
        }

        // Add optional RANDOMIZE FOR
        if let Some(randomize) = config.randomize {
            parts.push(format!("RANDOMIZE FOR {}", Self::format_seconds(randomize)));
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
                    RefreshInterval::Every { interval } => {
                        format!("EVERY {}", Self::format_seconds(*interval))
                    }
                    RefreshInterval::After { interval } => {
                        format!("AFTER {}", Self::format_seconds(*interval))
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
            interval: RefreshInterval::every(3600), // 1 hour
            offset: Some(300),                      // 5 minutes
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
            interval: RefreshInterval::after(1800), // 30 minutes
            offset: None,
            randomize: Some(60), // 1 minute
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
        let refresh_config = RefreshableConfig::new(RefreshInterval::every(7200)); // 2 hours

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
        let refresh_config = RefreshableConfig::new(RefreshInterval::every(3600));
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
            interval: RefreshInterval::every(3600),
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
            interval: RefreshInterval::every(3600),
            offset: Some(300),
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
        assert_eq!(config.offset, Some(300));
        assert_eq!(config.depends_on, vec!["dep1".to_string()]);
        assert!(config.append);
    }

    #[test]
    fn test_format_seconds() {
        // Test various duration formats
        assert_eq!(MaterializedView::format_seconds(30), "30 SECOND");
        assert_eq!(MaterializedView::format_seconds(60), "1 MINUTE");
        assert_eq!(MaterializedView::format_seconds(90), "90 SECOND");
        assert_eq!(MaterializedView::format_seconds(3600), "1 HOUR");
        assert_eq!(MaterializedView::format_seconds(7200), "2 HOUR");
        assert_eq!(MaterializedView::format_seconds(86400), "1 DAY");
        assert_eq!(MaterializedView::format_seconds(172800), "2 DAY");
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
                "interval": { "type": "every", "interval": 3600 },
                "offset": 300,
                "dependsOn": ["other_mv"],
                "append": false
            }
        }"#;

        let mv: MaterializedView = serde_json::from_str(json).unwrap();
        assert!(mv.is_refreshable());
        let config = mv.refreshable_config().unwrap();
        assert_eq!(config.offset, Some(300));
        assert_eq!(config.depends_on, vec!["other_mv".to_string()]);
        assert!(!config.append);

        match &config.interval {
            RefreshInterval::Every { interval } => assert_eq!(*interval, 3600),
            _ => panic!("Expected Every interval"),
        }
    }
}
