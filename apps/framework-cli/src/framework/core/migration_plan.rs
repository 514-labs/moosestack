use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::{InfraChanges, InfrastructureMap};
use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;
use crate::infrastructure::olap::ddl_ordering::PlanOrderingError;
use crate::utilities::json;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashMap;

/// A comprehensive migration plan that can be reviewed, approved, and executed
///
/// Note: This type has a custom `Serialize` implementation that sorts all JSON keys
/// alphabetically for deterministic output in version-controlled migration files.
#[derive(Debug, Clone, Deserialize)]
pub struct MigrationPlan {
    /// Timestamp when this plan was generated
    pub created_at: DateTime<Utc>,
    /// DB Operations to run
    pub operations: Vec<SerializableOlapOperation>,
}

pub const MIGRATION_SCHEMA: &str = include_str!("../../utilities/migration_plan_schema.json");

impl MigrationPlan {
    /// Creates a new migration plan from an infrastructure plan
    pub fn from_infra_plan(
        infra_plan_changes: &InfraChanges,
        default_database: &str,
    ) -> Result<Self, PlanOrderingError> {
        let operations = crate::framework::core::plan::infra_changes_to_operations(
            infra_plan_changes,
            default_database,
        )?;

        Ok(MigrationPlan {
            created_at: Utc::now(),
            operations,
        })
    }

    /// Returns the total number of operations
    pub fn total_operations(&self) -> usize {
        self.operations.len()
    }

    /// Scans the plan for versioned `CreateTable` operations and returns a
    /// [`BackfillCheckResult`] for each, describing whether a backfill SQL
    /// can be appended, was already present, or why it was skipped.
    pub fn detect_backfill_candidates(
        &self,
        remote_tables: &HashMap<String, Table>,
        default_database: &str,
    ) -> Vec<BackfillCheckResult> {
        let re = regex::Regex::new(r"^(.+)_v(\d+)$").expect("valid regex");
        let mut results = Vec::new();

        let created_tables: Vec<&Table> = self
            .operations
            .iter()
            .filter_map(|op| match op {
                SerializableOlapOperation::CreateTable { table } => Some(table),
                _ => None,
            })
            .collect();

        let existing_raw_sqls: std::collections::HashSet<String> = self
            .operations
            .iter()
            .filter_map(|op| match op {
                SerializableOlapOperation::RawSql { sql, .. } => Some(sql.to_vec().join("; ")),
                _ => None,
            })
            .collect();

        for new_table in &created_tables {
            let caps = match re.captures(&new_table.name) {
                Some(c) => c,
                None => continue,
            };
            let base_name = caps[1].to_string();

            let base_table = match find_base_table(remote_tables, &base_name, &re) {
                Some(t) => t,
                None => continue,
            };

            let src_db = base_table
                .database
                .as_deref()
                .unwrap_or(default_database)
                .to_string();
            let dst_db = new_table
                .database
                .as_deref()
                .unwrap_or(default_database)
                .to_string();

            if !columns_equivalent(&base_table.columns, &new_table.columns) {
                let reason = schema_diff_reason(&base_table.columns, &new_table.columns);
                results.push(BackfillCheckResult::NonEquivalent {
                    target: new_table.name.clone(),
                    source: base_table.name.clone(),
                    reason,
                });
                continue;
            }

            let col_names: Vec<&str> = base_table.columns.iter().map(|c| c.name.as_str()).collect();
            let cols_csv = col_names.join(", ");

            let sql = format!(
                "INSERT INTO `{dst_db}`.`{}` ({cols_csv}) SELECT {cols_csv} FROM `{src_db}`.`{}`",
                new_table.name, base_table.name
            );

            if existing_raw_sqls.contains(&sql) {
                results.push(BackfillCheckResult::Duplicate {
                    target: new_table.name.clone(),
                    source: base_table.name.clone(),
                });
                continue;
            }

            results.push(BackfillCheckResult::Candidate(BackfillCandidate {
                source_table_name: base_table.name.clone(),
                target_table_name: new_table.name.clone(),
                source_db: src_db,
                target_db: dst_db,
                sql,
            }));
        }

        results
    }

    /// Appends a single backfill candidate as a `RawSql` operation.
    pub fn append_backfill(&mut self, candidate: &BackfillCandidate) {
        self.operations.push(SerializableOlapOperation::RawSql {
            sql: vec![candidate.sql.clone()],
            description: format!(
                "Backfill `{}`.`{}` from `{}`.`{}`",
                candidate.target_db,
                candidate.target_table_name,
                candidate.source_db,
                candidate.source_table_name,
            ),
        });
    }

    pub fn to_yaml(&self) -> anyhow::Result<String> {
        // going through JSON before YAML because tooling does not support `!tag`
        // Sorted keys are handled by the custom Serialize implementation
        let plan_json = serde_json::to_value(self)?;
        // We must explicitly convert rather than using serde_yaml::to_string(&json_value)
        // because arbitrary precision numbers in serde_json becomes `$serde_json::private::Number: '42'`
        let plan_yaml = serde_yaml::to_string(&json::json_value_to_yaml(&plan_json))?;
        Ok(plan_yaml)
    }
}

/// A versioned table whose schema matches the base — ready to have backfill
/// SQL appended.
#[derive(Debug, Clone)]
pub struct BackfillCandidate {
    pub source_table_name: String,
    pub target_table_name: String,
    pub source_db: String,
    pub target_db: String,
    pub sql: String,
}

/// Result of checking a single versioned table for backfill eligibility.
#[derive(Debug)]
pub enum BackfillCheckResult {
    /// Schemas are equivalent — backfill can be appended after confirmation.
    Candidate(BackfillCandidate),
    /// Schemas differ — backfill skipped with a human-readable reason.
    NonEquivalent {
        target: String,
        source: String,
        reason: String,
    },
    /// An identical backfill `RawSql` already exists in the plan.
    Duplicate { target: String, source: String },
}

/// Finds the base table: first tries exact `base_name`, then looks for the
/// highest existing version below the new one (e.g. `Events_v1` for `Events_v2`).
fn find_base_table<'a>(
    tables: &'a HashMap<String, Table>,
    base_name: &str,
    version_re: &regex::Regex,
) -> Option<&'a Table> {
    if let Some(t) = tables.get(base_name) {
        return Some(t);
    }
    tables
        .values()
        .filter(|t| {
            version_re
                .captures(&t.name)
                .map(|c| c.get(1).unwrap().as_str() == base_name)
                .unwrap_or(false)
        })
        .max_by_key(|t| {
            version_re
                .captures(&t.name)
                .and_then(|c| c[2].parse::<u32>().ok())
                .unwrap_or(0)
        })
}

/// Two column sets are equivalent when they contain the same columns
/// (by name, data_type, and required) regardless of order.
fn columns_equivalent(
    a: &[crate::framework::core::infrastructure::table::Column],
    b: &[crate::framework::core::infrastructure::table::Column],
) -> bool {
    use std::collections::HashSet;

    if a.len() != b.len() {
        return false;
    }

    type ColKey<'c> = (
        &'c str,
        &'c crate::framework::core::infrastructure::table::ColumnType,
        bool,
    );

    let set_a: HashSet<ColKey> = a
        .iter()
        .map(|c| (c.name.as_str(), &c.data_type, c.required))
        .collect();
    let set_b: HashSet<ColKey> = b
        .iter()
        .map(|c| (c.name.as_str(), &c.data_type, c.required))
        .collect();

    set_a == set_b
}

/// Produces a human-readable description of why two column sets differ.
fn schema_diff_reason(
    source: &[crate::framework::core::infrastructure::table::Column],
    target: &[crate::framework::core::infrastructure::table::Column],
) -> String {
    use std::collections::HashSet;
    let src_names: HashSet<&str> = source.iter().map(|c| c.name.as_str()).collect();
    let tgt_names: HashSet<&str> = target.iter().map(|c| c.name.as_str()).collect();

    let extra_in_target: Vec<&&str> = tgt_names.difference(&src_names).collect();
    let extra_in_source: Vec<&&str> = src_names.difference(&tgt_names).collect();

    let mut parts = Vec::new();
    if !extra_in_target.is_empty() {
        parts.push(format!(
            "target has columns not present in source: {}",
            extra_in_target
                .iter()
                .map(|s| format!("`{s}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !extra_in_source.is_empty() {
        parts.push(format!(
            "source has columns not present in target: {}",
            extra_in_source
                .iter()
                .map(|s| format!("`{s}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if parts.is_empty() {
        parts.push("column type or nullability mismatch".to_string());
    }
    parts.join("; ")
}

impl serde::Serialize for MigrationPlan {
    /// Custom serialization with sorted keys for deterministic output.
    ///
    /// Migration files are version-controlled, so we need consistent output.
    /// Without sorted keys, HashMap serialization order is random, causing noisy diffs.
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // Shadow type to avoid infinite recursion
        #[derive(serde::Serialize)]
        struct MigrationPlanForSerialization<'a> {
            created_at: &'a DateTime<Utc>,
            operations: &'a Vec<SerializableOlapOperation>,
        }

        let shadow = MigrationPlanForSerialization {
            created_at: &self.created_at,
            operations: &self.operations,
        };

        // Serialize to JSON value, sort keys, then serialize that
        let json_value = serde_json::to_value(&shadow).map_err(serde::ser::Error::custom)?;
        let sorted_value = json::sort_json_keys(json_value);
        sorted_value.serialize(serializer)
    }
}

/// Intermediate result from remote migration generation.
///
/// Holds the infrastructure diff (`changes`) before it is converted to a
/// [`MigrationPlan`].  Callers should run confirmation gates on `changes`
/// first, then call [`Self::into_migration_plan`] to produce the final
/// serialised operations.
pub struct MigrationPlanWithBeforeAfter {
    pub remote_state: InfrastructureMap,
    pub local_infra_map: InfrastructureMap,
    /// The raw infrastructure diff — may still contain unconfirmed
    /// `Removed` + `Added` pairs that the rename gate should process.
    pub changes: InfraChanges,
    pub(crate) default_database: String,
}

impl MigrationPlanWithBeforeAfter {
    /// Converts the (potentially modified) `InfraChanges` into a
    /// [`MigrationPlan`] with ordered, serialisable operations.
    pub fn to_migration_plan(&self) -> Result<MigrationPlan, PlanOrderingError> {
        MigrationPlan::from_infra_plan(&self.changes, &self.default_database)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy, TableIndex};
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    fn test_table(name: &str, cols: Vec<Column>) -> Table {
        Table {
            name: name.to_string(),
            columns: cols,
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            engine: ClickhouseEngine::MergeTree,
            version: None,
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            projections: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
            seed_filter: Default::default(),
        }
    }

    fn test_col(name: &str, dt: ColumnType) -> Column {
        Column {
            name: name.to_string(),
            data_type: dt,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
            alias: None,
        }
    }

    #[test]
    fn test_to_yaml_does_not_leak_serde_json_private_number() {
        let plan = MigrationPlan {
            created_at: DateTime::parse_from_rfc3339("2025-01-15T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            operations: vec![SerializableOlapOperation::AddTableIndex {
                table: "events".to_string(),
                index: TableIndex {
                    name: "idx_timestamp".to_string(),
                    expression: "timestamp".to_string(),
                    index_type: "minmax".to_string(),
                    arguments: vec![],
                    granularity: 3,
                },
                database: None,
                cluster_name: None,
            }],
        };

        let yaml = plan.to_yaml().unwrap();

        assert!(
            !yaml.contains("serde_json::private"),
            "YAML output leaked serde_json internal representation:\n{yaml}"
        );
        assert!(
            yaml.contains("granularity: 3"),
            "Expected `granularity: 3` in YAML output:\n{yaml}"
        );
    }

    // ---------------------------------------------------------------
    // Backfill detection tests
    // ---------------------------------------------------------------

    #[test]
    fn detect_candidate_for_equivalent_versioned_table() {
        let cols = vec![
            test_col("id", ColumnType::String),
            test_col("ts", ColumnType::DateTime { precision: None }),
        ];
        let base = test_table("Events", cols.clone());
        let new = test_table("Events_v2", cols);

        let mut remote = HashMap::new();
        remote.insert("Events".to_string(), base);

        let plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![SerializableOlapOperation::CreateTable { table: new }],
        };

        let results = plan.detect_backfill_candidates(&remote, "default");
        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], BackfillCheckResult::Candidate(c)
            if c.target_table_name == "Events_v2" && c.source_table_name == "Events"
        ));
    }

    #[test]
    fn append_backfill_adds_raw_sql() {
        let cols = vec![test_col("id", ColumnType::String)];
        let base = test_table("Events", cols.clone());
        let new = test_table("Events_v2", cols);

        let mut remote = HashMap::new();
        remote.insert("Events".to_string(), base);

        let mut plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![SerializableOlapOperation::CreateTable { table: new }],
        };

        let results = plan.detect_backfill_candidates(&remote, "default");
        if let BackfillCheckResult::Candidate(c) = &results[0] {
            plan.append_backfill(c);
        }

        assert_eq!(plan.operations.len(), 2);
        match plan.operations.last().unwrap() {
            SerializableOlapOperation::RawSql { sql, .. } => {
                assert!(sql[0].contains("INSERT INTO"));
                assert!(sql[0].contains("Events_v2"));
                assert!(sql[0].contains("Events"));
            }
            _ => panic!("Expected RawSql operation"),
        }
    }

    #[test]
    fn detect_non_equivalent_returns_reason() {
        let base_cols = vec![test_col("id", ColumnType::String)];
        let new_cols = vec![
            test_col("id", ColumnType::String),
            test_col("extra", ColumnType::BigInt),
        ];
        let base = test_table("Events", base_cols);
        let new = test_table("Events_v2", new_cols);

        let mut remote = HashMap::new();
        remote.insert("Events".to_string(), base);

        let plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![SerializableOlapOperation::CreateTable { table: new }],
        };

        let results = plan.detect_backfill_candidates(&remote, "default");
        assert_eq!(results.len(), 1);
        assert!(
            matches!(&results[0], BackfillCheckResult::NonEquivalent { target, reason, .. }
                if target == "Events_v2" && reason.contains("extra")
            )
        );
    }

    #[test]
    fn detect_skipped_when_no_base_table() {
        let cols = vec![test_col("id", ColumnType::String)];
        let new = test_table("BrandNew_v2", cols);

        let remote = HashMap::new();

        let plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![SerializableOlapOperation::CreateTable { table: new }],
        };

        let results = plan.detect_backfill_candidates(&remote, "default");
        assert!(results.is_empty());
    }

    #[test]
    fn detect_duplicate_after_append() {
        let cols = vec![test_col("id", ColumnType::String)];
        let base = test_table("Events", cols.clone());
        let new = test_table("Events_v2", cols);

        let mut remote = HashMap::new();
        remote.insert("Events".to_string(), base);

        let mut plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![SerializableOlapOperation::CreateTable { table: new }],
        };

        let first = plan.detect_backfill_candidates(&remote, "default");
        assert_eq!(first.len(), 1);
        if let BackfillCheckResult::Candidate(c) = &first[0] {
            plan.append_backfill(c);
        }

        let second = plan.detect_backfill_candidates(&remote, "default");
        assert_eq!(second.len(), 1);
        assert!(
            matches!(&second[0], BackfillCheckResult::Duplicate { target, .. }
                if target == "Events_v2"
            )
        );
        assert_eq!(plan.operations.len(), 2);
    }

    #[test]
    fn detect_non_versioned_table_is_skipped() {
        let cols = vec![test_col("id", ColumnType::String)];
        let new = test_table("NewTable", cols);

        let remote = HashMap::new();
        let plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![SerializableOlapOperation::CreateTable { table: new }],
        };

        let results = plan.detect_backfill_candidates(&remote, "default");
        assert!(results.is_empty());
    }

    #[test]
    fn detect_finds_highest_existing_version() {
        let cols = vec![test_col("id", ColumnType::String)];
        let v1 = test_table("Events_v1", cols.clone());
        let v2 = test_table("Events_v2", cols.clone());
        let new = test_table("Events_v3", cols);

        let mut remote = HashMap::new();
        remote.insert("Events_v1".to_string(), v1);
        remote.insert("Events_v2".to_string(), v2);

        let plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![SerializableOlapOperation::CreateTable { table: new }],
        };

        let results = plan.detect_backfill_candidates(&remote, "default");
        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], BackfillCheckResult::Candidate(c)
            if c.source_table_name == "Events_v2"
        ));
    }
}
