use serde::{Deserialize, Serialize};

/// Shared ClickHouse role name used by all row policies.
pub const MOOSE_RLS_ROLE: &str = "moose_rls_role";

/// A ClickHouse Row Policy defined by the user.
///
/// Maps 1:1 to a `CREATE ROW POLICY` DDL statement. Uses `getSetting()` for
/// dynamic per-query tenant scoping via a named ClickHouse setting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectRowPolicy {
    /// Name of the row policy
    pub name: String,

    /// Table names the policy applies to
    pub tables: Vec<String>,

    /// Column to filter on (e.g., "org_id")
    pub column: String,

    /// JWT claim name that provides the filter value (e.g., "org_id")
    pub claim: String,
}

impl SelectRowPolicy {
    /// ClickHouse setting name derived from the column: `custom_moose_rls_{column}`
    pub fn setting_name(&self) -> String {
        format!("custom_moose_rls_{}", self.column)
    }

    /// USING expression for the row policy DDL.
    /// Backtick-quotes the column identifier to handle reserved words and special characters.
    pub fn using_expr(&self) -> String {
        let escaped_column = self.column.replace('`', "``");
        let escaped_setting = self.setting_name().replace('\'', "''");
        format!("`{}` = getSetting('{}')", escaped_column, escaped_setting)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_policy(column: &str) -> SelectRowPolicy {
        SelectRowPolicy {
            name: "test_policy".to_string(),
            tables: vec!["events".to_string()],
            column: column.to_string(),
            claim: "org_id".to_string(),
        }
    }

    #[test]
    fn test_setting_name_basic() {
        let policy = make_policy("org_id");
        assert_eq!(policy.setting_name(), "custom_moose_rls_org_id");
    }

    #[test]
    fn test_setting_name_with_underscores() {
        let policy = make_policy("tenant_org_id");
        assert_eq!(policy.setting_name(), "custom_moose_rls_tenant_org_id");
    }

    #[test]
    fn test_using_expr_basic() {
        let policy = make_policy("org_id");
        assert_eq!(
            policy.using_expr(),
            "`org_id` = getSetting('custom_moose_rls_org_id')"
        );
    }

    #[test]
    fn test_using_expr_different_column() {
        let policy = make_policy("region");
        assert_eq!(
            policy.using_expr(),
            "`region` = getSetting('custom_moose_rls_region')"
        );
    }

    #[test]
    fn test_using_expr_escapes_backticks() {
        let policy = make_policy("col`name");
        assert_eq!(
            policy.using_expr(),
            "`col``name` = getSetting('custom_moose_rls_col`name')"
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
}
