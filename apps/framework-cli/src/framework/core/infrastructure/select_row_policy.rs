use serde::{Deserialize, Serialize};

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

    /// USING expression for the row policy DDL
    pub fn using_expr(&self) -> String {
        format!("{} = getSetting('{}')", self.column, self.setting_name())
    }
}
