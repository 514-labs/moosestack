use serde::{Deserialize, Serialize};

pub use super::table::TableReference;

/// Shared ClickHouse role name used by all row policies.
/// IMPORTANT: Must match MOOSE_RLS_ROLE in packages/ts-moose-lib/src/consumption-apis/helpers.ts
pub const MOOSE_RLS_ROLE: &str = "moose_rls_role";

/// Dedicated ClickHouse user for RLS queries.
/// IMPORTANT: Must match MOOSE_RLS_USER in packages/ts-moose-lib/src/consumption-apis/helpers.ts
pub const MOOSE_RLS_USER: &str = "moose_rls_user";

/// Prefix for ClickHouse custom settings used by row policies.
/// Setting names are `{MOOSE_RLS_SETTING_PREFIX}{column}`.
/// IMPORTANT: Must match MOOSE_RLS_SETTING_PREFIX in packages/ts-moose-lib/src/consumption-apis/helpers.ts
pub const MOOSE_RLS_SETTING_PREFIX: &str = "SQL_moose_rls_";

/// A ClickHouse Row Policy defined by the user.
///
/// Maps 1:1 to a `CREATE ROW POLICY` DDL statement. Uses `getSetting()` for
/// dynamic per-query tenant scoping via a named ClickHouse setting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectRowPolicy {
    /// Name of the row policy
    pub name: String,

    /// Tables the policy applies to
    pub tables: Vec<TableReference>,

    /// Column to filter on (e.g., "org_id")
    pub column: String,

    /// JWT claim name that provides the filter value (e.g., "org_id")
    pub claim: String,
}

impl SelectRowPolicy {
    /// ClickHouse setting name derived from the column: `SQL_moose_rls_{column}`
    /// IMPORTANT: Prefix must match MOOSE_RLS_SETTING_PREFIX in packages/ts-moose-lib/src/consumption-apis/helpers.ts
    pub fn setting_name(&self) -> String {
        format!("{}{}", MOOSE_RLS_SETTING_PREFIX, self.column)
    }

    /// Returns `(setting_name, claim)` for passing to the consumption runner CLI.
    pub fn to_cli_config(&self) -> (String, String) {
        (self.setting_name(), self.claim.clone())
    }

    /// USING expression for the row policy DDL.
    /// Backtick-quotes the column identifier to handle reserved words and special characters.
    pub fn using_expr(&self) -> String {
        let escaped_column = self.column.replace('`', "``");
        let escaped_setting = self.setting_name().replace('\'', "''");
        format!("`{}` = getSetting('{}')", escaped_column, escaped_setting)
    }

    /// Unique database names this policy's tables belong to, sorted.
    pub fn resolved_databases(&self, default_database: &str) -> Vec<String> {
        let mut dbs: Vec<String> = self
            .tables
            .iter()
            .map(|t| {
                t.database
                    .as_deref()
                    .unwrap_or(default_database)
                    .to_string()
            })
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        dbs.sort();
        dbs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_table_ref(name: &str) -> TableReference {
        TableReference {
            name: name.to_string(),
            database: None,
        }
    }

    fn make_table_ref_with_db(name: &str, db: &str) -> TableReference {
        TableReference {
            name: name.to_string(),
            database: Some(db.to_string()),
        }
    }

    fn make_policy(column: &str) -> SelectRowPolicy {
        SelectRowPolicy {
            name: "test_policy".to_string(),
            tables: vec![make_table_ref("events")],
            column: column.to_string(),
            claim: "org_id".to_string(),
        }
    }

    #[test]
    fn test_setting_name_basic() {
        let policy = make_policy("org_id");
        assert_eq!(policy.setting_name(), "SQL_moose_rls_org_id");
    }

    #[test]
    fn test_setting_name_with_underscores() {
        let policy = make_policy("tenant_org_id");
        assert_eq!(policy.setting_name(), "SQL_moose_rls_tenant_org_id");
    }

    #[test]
    fn test_using_expr_basic() {
        let policy = make_policy("org_id");
        assert_eq!(
            policy.using_expr(),
            "`org_id` = getSetting('SQL_moose_rls_org_id')"
        );
    }

    #[test]
    fn test_using_expr_different_column() {
        let policy = make_policy("region");
        assert_eq!(
            policy.using_expr(),
            "`region` = getSetting('SQL_moose_rls_region')"
        );
    }

    #[test]
    fn test_using_expr_escapes_backticks() {
        let policy = make_policy("col`name");
        assert_eq!(
            policy.using_expr(),
            "`col``name` = getSetting('SQL_moose_rls_col`name')"
        );
    }

    #[test]
    fn test_same_column_produces_same_setting() {
        let policy_a = make_policy("org_id");
        let policy_b = make_policy("org_id");
        assert_eq!(policy_a.setting_name(), policy_b.setting_name());
    }

    #[test]
    fn test_different_columns_produce_different_settings() {
        let policy_a = make_policy("org_id");
        let policy_b = make_policy("region");
        assert_ne!(policy_a.setting_name(), policy_b.setting_name());
    }

    #[test]
    fn test_resolved_databases_default_only() {
        let policy = make_policy("org_id");
        assert_eq!(policy.resolved_databases("local"), vec!["local"]);
    }

    #[test]
    fn test_resolved_databases_multi_db() {
        let policy = SelectRowPolicy {
            name: "multi".to_string(),
            tables: vec![
                make_table_ref("events"),
                make_table_ref_with_db("orders", "analytics"),
            ],
            column: "org_id".to_string(),
            claim: "org_id".to_string(),
        };
        let dbs = policy.resolved_databases("local");
        assert_eq!(dbs, vec!["analytics", "local"]);
    }
}
