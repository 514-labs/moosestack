//! SQL parsing utilities using the standard sqlparser crate
//!
//! This module provides parsing functionality for ClickHouse SQL statements,
//! particularly CREATE MATERIALIZED VIEW and INSERT INTO ... SELECT statements.

use sqlparser::ast::{
    Expr, ObjectName, Query, Select, SelectItem, Statement, TableFactor, TableWithJoins,
};
use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq)]
pub struct MaterializedViewStatement {
    pub view_name: String,
    pub target_database: Option<String>,
    pub target_table: String,
    pub select_statement: String,
    pub source_tables: Vec<TableReference>,
    pub if_not_exists: bool,
    pub populate: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InsertSelectStatement {
    pub target_database: Option<String>,
    pub target_table: String,
    pub columns: Option<Vec<String>>,
    pub select_statement: String,
    pub source_tables: Vec<TableReference>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TableReference {
    pub database: Option<String>,
    pub table: String,
    pub alias: Option<String>,
}

impl TableReference {
    pub fn new(table: String) -> Self {
        Self {
            database: None,
            table,
            alias: None,
        }
    }

    pub fn with_database(database: String, table: String) -> Self {
        Self {
            database: Some(database),
            table,
            alias: None,
        }
    }

    pub fn qualified_name(&self) -> String {
        match &self.database {
            Some(db) => format!("{}.{}", db, self.table),
            None => self.table.clone(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SqlParseError {
    #[error("Parse error: {0}")]
    ParseError(#[from] sqlparser::parser::ParserError),
    #[error("Not a materialized view statement")]
    NotMaterializedView,
    #[error("Not an insert select statement")]
    NotInsertSelect,
    #[error("Missing required field: {0}")]
    MissingField(String),
    #[error("Unsupported statement type")]
    UnsupportedStatement,
    #[error("Not a create table statement")]
    NotCreateTable,
}

/// Extract engine definition from a CREATE TABLE statement
/// Returns the full engine definition including parameters
///
/// This function uses a more robust approach than regex to handle nested parentheses
/// and complex engine parameters (e.g., S3Queue with credentials, headers, etc.)
/// Extract table settings from a CREATE TABLE statement
/// Returns a HashMap of setting name to value
pub fn extract_table_settings_from_create_table(
    sql: &str,
) -> Option<std::collections::HashMap<String, String>> {
    // Find the SETTINGS keyword (case-insensitive)
    let sql_upper = sql.to_uppercase();
    let settings_pos = sql_upper.find("SETTINGS")?;

    // Get the substring starting from SETTINGS
    let settings_part = &sql[settings_pos + 8..]; // Skip "SETTINGS"
    let trimmed = settings_part.trim();

    // Parse key=value pairs
    let mut settings = std::collections::HashMap::new();
    let mut current_key = String::new();
    let mut current_value = String::new();
    let mut in_key = true;
    let mut in_quotes = false;
    let mut escape_next = false;

    for ch in trimmed.chars() {
        if escape_next {
            if in_key {
                current_key.push(ch);
            } else {
                current_value.push(ch);
            }
            escape_next = false;
            continue;
        }

        match ch {
            '\\' => escape_next = true,
            '\'' | '"' if !in_key => in_quotes = !in_quotes,
            '=' if in_key && !in_quotes => {
                in_key = false;
                current_key = current_key.trim().to_string();
            }
            ',' if !in_key && !in_quotes => {
                // End of this setting
                let value = current_value
                    .trim()
                    .trim_matches(|c| c == '\'' || c == '"')
                    .to_string();
                if !current_key.is_empty() && !value.is_empty() {
                    settings.insert(current_key.clone(), value);
                }
                current_key.clear();
                current_value.clear();
                in_key = true;
            }
            _ => {
                if in_key {
                    current_key.push(ch);
                } else {
                    current_value.push(ch);
                }
            }
        }
    }

    // Don't forget the last setting
    if !current_key.is_empty() && !current_value.is_empty() {
        let value = current_value
            .trim()
            .trim_matches(|c| c == '\'' || c == '"')
            .to_string();
        settings.insert(current_key.trim().to_string(), value);
    }

    if settings.is_empty() {
        None
    } else {
        Some(settings)
    }
}

pub fn extract_engine_from_create_table(sql: &str) -> Option<String> {
    // Find the ENGINE keyword (case-insensitive)
    let sql_upper = sql.to_uppercase();
    let engine_pos = sql_upper.find("ENGINE")?;

    // Skip "ENGINE" and any whitespace/equals
    let rest = &sql[engine_pos + 6..];
    let rest_trimmed = rest.trim_start();
    let rest_after_eq = rest_trimmed.strip_prefix('=').map(|s| s.trim_start())?; // ENGINE must be followed by =

    // Now extract the engine name and parameters
    // Engine name is alphanumeric (including underscore)
    let engine_name_end = rest_after_eq
        .find(|c: char| !c.is_alphanumeric() && c != '_')
        .unwrap_or(rest_after_eq.len());

    let engine_name = &rest_after_eq[..engine_name_end];

    // Check if there are parameters (starting with '(')
    let after_name = &rest_after_eq[engine_name_end..].trim_start();
    if after_name.starts_with('(') {
        // Find the matching closing parenthesis, handling nested parentheses
        let mut paren_count = 0;
        let mut in_string = false;
        let mut escape_next = false;
        let mut end_pos = None;

        for (i, ch) in after_name.chars().enumerate() {
            if escape_next {
                escape_next = false;
                continue;
            }

            match ch {
                '\\' if in_string => escape_next = true,
                '\'' => in_string = !in_string,
                '(' if !in_string => paren_count += 1,
                ')' if !in_string => {
                    paren_count -= 1;
                    if paren_count == 0 {
                        end_pos = Some(i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }

        end_pos.map(|end| format!("{}{}", engine_name, &after_name[..end]))
    } else {
        // Engine without parameters
        Some(engine_name.to_string())
    }
}

pub fn parse_create_materialized_view(
    sql: &str,
) -> Result<MaterializedViewStatement, SqlParseError> {
    let dialect = ClickHouseDialect {};
    let ast = Parser::parse_sql(&dialect, sql)?;

    if ast.len() != 1 {
        return Err(SqlParseError::NotMaterializedView);
    }

    match &ast[0] {
        Statement::CreateView {
            name,
            materialized,
            to,
            query,
            if_not_exists,
            ..
        } => {
            // Must be a materialized view
            if !materialized {
                return Err(SqlParseError::NotMaterializedView);
            }

            // ClickHouse materialized views must have a TO clause
            let to_table = to
                .as_ref()
                .ok_or_else(|| SqlParseError::MissingField("TO clause".to_string()))?;

            // Extract view name (just the view name, not database.view)
            let view_name_str = object_name_to_string(name);
            let (_view_database, view_name) = split_qualified_name(&view_name_str);

            // Extract target table and database from TO clause
            let to_table_str = object_name_to_string(to_table);
            let (target_database, target_table) = split_qualified_name(&to_table_str);

            // Format the SELECT statement
            let select_statement = format!("{}", query);

            // Extract source tables from the query
            let source_tables = extract_source_tables_from_query(query)?;

            Ok(MaterializedViewStatement {
                view_name,
                target_database,
                target_table,
                select_statement,
                source_tables,
                if_not_exists: *if_not_exists,
                populate: false, // sqlparser doesn't support POPULATE, always false
            })
        }
        _ => Err(SqlParseError::NotMaterializedView),
    }
}

pub fn parse_insert_select(sql: &str) -> Result<InsertSelectStatement, SqlParseError> {
    let dialect = ClickHouseDialect {};
    let ast = Parser::parse_sql(&dialect, sql)?;

    if ast.len() != 1 {
        return Err(SqlParseError::NotInsertSelect);
    }

    match &ast[0] {
        Statement::Insert(insert) => {
            let table_name_str = format!("{}", insert.table);
            let (target_database, target_table) = split_qualified_name(&table_name_str);

            let column_names: Option<Vec<String>> = if insert.columns.is_empty() {
                None
            } else {
                Some(insert.columns.iter().map(|c| c.value.clone()).collect())
            };

            if let Some(query) = &insert.source {
                let source_tables = extract_source_tables_from_query(query)?;
                let select_statement = format!("{}", query);

                Ok(InsertSelectStatement {
                    target_database,
                    target_table,
                    columns: column_names,
                    select_statement,
                    source_tables,
                })
            } else {
                Err(SqlParseError::NotInsertSelect)
            }
        }
        _ => Err(SqlParseError::NotInsertSelect),
    }
}

pub fn is_insert_select(sql: &str) -> bool {
    parse_insert_select(sql).is_ok()
}

pub fn is_materialized_view(sql: &str) -> bool {
    // Try to parse it as a materialized view
    parse_create_materialized_view(sql).is_ok()
}

fn object_name_to_string(name: &ObjectName) -> String {
    // Use Display trait and strip backticks
    format!("{}", name).replace('`', "")
}

fn split_qualified_name(name: &str) -> (Option<String>, String) {
    if let Some(dot_pos) = name.rfind('.') {
        let database = name[..dot_pos].to_string();
        let table = name[dot_pos + 1..].to_string();
        (Some(database), table)
    } else {
        (None, name.to_string())
    }
}

fn extract_source_tables_from_query(query: &Query) -> Result<Vec<TableReference>, SqlParseError> {
    let mut tables = HashSet::new();
    extract_tables_from_query_recursive(query, &mut tables)?;
    Ok(tables.into_iter().collect())
}

fn extract_tables_from_query_recursive(
    query: &Query,
    tables: &mut HashSet<TableReference>,
) -> Result<(), SqlParseError> {
    extract_tables_from_set_expr(query.body.as_ref(), tables)
}

fn extract_tables_from_set_expr(
    set_expr: &sqlparser::ast::SetExpr,
    tables: &mut HashSet<TableReference>,
) -> Result<(), SqlParseError> {
    match set_expr {
        sqlparser::ast::SetExpr::Select(select) => {
            extract_tables_from_select(select, tables)?;
        }
        sqlparser::ast::SetExpr::SetOperation {
            op: _,
            set_quantifier: _,
            left,
            right,
        } => {
            extract_tables_from_set_expr(left, tables)?;
            extract_tables_from_set_expr(right, tables)?;
        }
        _ => {
            // Handle other set expression types if needed
        }
    }
    Ok(())
}

fn extract_tables_from_select(
    select: &Select,
    tables: &mut HashSet<TableReference>,
) -> Result<(), SqlParseError> {
    // Extract tables from FROM clause
    for table_with_joins in &select.from {
        extract_tables_from_table_with_joins(table_with_joins, tables)?;
    }

    // Extract tables from subqueries in SELECT items
    for item in &select.projection {
        if let SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. } = item {
            extract_tables_from_expr(expr, tables)?;
        }
    }

    // Extract tables from WHERE clause
    if let Some(where_clause) = &select.selection {
        extract_tables_from_expr(where_clause, tables)?;
    }

    // Extract tables from GROUP BY
    match &select.group_by {
        sqlparser::ast::GroupByExpr::Expressions(exprs, _) => {
            for expr in exprs {
                extract_tables_from_expr(expr, tables)?;
            }
        }
        _ => {
            // Handle other GROUP BY types if needed
        }
    }

    // Extract tables from HAVING
    if let Some(having) = &select.having {
        extract_tables_from_expr(having, tables)?;
    }

    Ok(())
}

fn extract_tables_from_table_with_joins(
    table_with_joins: &TableWithJoins,
    tables: &mut HashSet<TableReference>,
) -> Result<(), SqlParseError> {
    // Extract from main table
    extract_tables_from_table_factor(&table_with_joins.relation, tables)?;

    // Extract from joins
    for join in &table_with_joins.joins {
        extract_tables_from_table_factor(&join.relation, tables)?;
        match &join.join_operator {
            sqlparser::ast::JoinOperator::Inner(constraint)
            | sqlparser::ast::JoinOperator::LeftOuter(constraint)
            | sqlparser::ast::JoinOperator::RightOuter(constraint)
            | sqlparser::ast::JoinOperator::FullOuter(constraint) => {
                if let sqlparser::ast::JoinConstraint::On(expr) = constraint {
                    extract_tables_from_expr(expr, tables)?;
                }
            }
            _ => {}
        }
    }

    Ok(())
}

fn extract_tables_from_table_factor(
    table_factor: &TableFactor,
    tables: &mut HashSet<TableReference>,
) -> Result<(), SqlParseError> {
    match table_factor {
        TableFactor::Table { name, alias, .. } => {
            let table_name = object_name_to_string(name);
            let (database, table) = split_qualified_name(&table_name);
            let alias_name = alias.as_ref().map(|a| a.name.value.clone());

            tables.insert(TableReference {
                database,
                table,
                alias: alias_name,
            });
        }
        TableFactor::Derived { subquery, .. } => {
            extract_tables_from_query_recursive(subquery, tables)?;
        }
        TableFactor::TableFunction { .. } => {
            // Table functions might reference tables in their arguments
            // This would require more complex parsing
        }
        _ => {
            // Handle other table factor types if needed
        }
    }
    Ok(())
}

fn extract_tables_from_expr(
    expr: &Expr,
    tables: &mut HashSet<TableReference>,
) -> Result<(), SqlParseError> {
    match expr {
        Expr::Subquery(query) => {
            extract_tables_from_query_recursive(query, tables)?;
        }
        Expr::BinaryOp { left, right, .. } => {
            extract_tables_from_expr(left, tables)?;
            extract_tables_from_expr(right, tables)?;
        }
        Expr::UnaryOp { expr, .. } => {
            extract_tables_from_expr(expr, tables)?;
        }
        Expr::Function(func) => {
            match &func.args {
                sqlparser::ast::FunctionArguments::List(function_arg_list) => {
                    for arg in &function_arg_list.args {
                        match arg {
                            sqlparser::ast::FunctionArg::Unnamed(arg_expr) => {
                                if let sqlparser::ast::FunctionArgExpr::Expr(expr) = arg_expr {
                                    extract_tables_from_expr(expr, tables)?;
                                }
                            }
                            sqlparser::ast::FunctionArg::Named { arg, .. } => {
                                if let sqlparser::ast::FunctionArgExpr::Expr(expr) = arg {
                                    extract_tables_from_expr(expr, tables)?;
                                }
                            }
                            sqlparser::ast::FunctionArg::ExprNamed { .. } => {
                                // Handle ExprNamed if needed
                            }
                        }
                    }
                }
                _ => {
                    // Handle other function argument types if needed
                }
            }
        }
        Expr::Case {
            operand,
            conditions,
            else_result,
            ..
        } => {
            if let Some(operand) = operand {
                extract_tables_from_expr(operand, tables)?;
            }
            for condition in conditions {
                extract_tables_from_expr(&condition.condition, tables)?;
                extract_tables_from_expr(&condition.result, tables)?;
            }
            if let Some(else_result) = else_result {
                extract_tables_from_expr(else_result, tables)?;
            }
        }
        _ => {
            // Handle other expression types that might contain subqueries
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests for extract_engine_from_create_table
    #[test]
    fn test_extract_simple_merge_tree() {
        let sql = "CREATE TABLE test (x Int32) ENGINE = MergeTree ORDER BY x";
        let result = extract_engine_from_create_table(sql);
        assert_eq!(result, Some("MergeTree".to_string()));
    }

    #[test]
    fn test_extract_merge_tree_with_parentheses() {
        let sql = "CREATE TABLE test (x Int32) ENGINE = MergeTree() ORDER BY x";
        let result = extract_engine_from_create_table(sql);
        assert_eq!(result, Some("MergeTree()".to_string()));
    }

    #[test]
    fn test_extract_s3queue_simple() {
        let sql = r#"CREATE TABLE s3_queue (name String, value UInt32) 
            ENGINE = S3Queue('http://localhost:11111/test/file.csv', 'CSV')"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("S3Queue('http://localhost:11111/test/file.csv', 'CSV')".to_string())
        );
    }

    #[test]
    fn test_extract_s3queue_with_credentials() {
        let sql = r#"CREATE TABLE s3_queue (name String, value UInt32) 
            ENGINE = S3Queue('http://localhost:11111/test/{a,b,c}.tsv', 'user', 'password', CSV)"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some(
                "S3Queue('http://localhost:11111/test/{a,b,c}.tsv', 'user', 'password', CSV)"
                    .to_string()
            )
        );
    }

    #[test]
    fn test_extract_distributed_with_quotes() {
        let sql = r#"CREATE TABLE t1 (c0 Int, c1 Int) 
            ENGINE = Distributed('test_shard_localhost', default, t0, `c1`)"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("Distributed('test_shard_localhost', default, t0, `c1`)".to_string())
        );
    }

    #[test]
    fn test_extract_replicated_merge_tree() {
        let sql = r#"CREATE TABLE test_r1 (x UInt64, "\\" String DEFAULT '\r\n\t\\' || '')
            ENGINE = ReplicatedMergeTree('/clickhouse/{database}/test', 'r1') 
            ORDER BY "\\""#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("ReplicatedMergeTree('/clickhouse/{database}/test', 'r1')".to_string())
        );
    }

    #[test]
    fn test_extract_merge_engine_with_regex() {
        let sql = r#"CREATE TABLE merge1 (x UInt64) 
            ENGINE = Merge(currentDatabase(), '^merge\\d$')"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some(r#"Merge(currentDatabase(), '^merge\\d$')"#.to_string())
        );
    }

    #[test]
    fn test_extract_engine_with_escaped_quotes() {
        let sql = r#"CREATE TABLE test (x String) 
            ENGINE = S3Queue('http://test.com/file\'s.csv', 'user\'s', 'pass\'word', CSV)"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some(
                r#"S3Queue('http://test.com/file\'s.csv', 'user\'s', 'pass\'word', CSV)"#
                    .to_string()
            )
        );
    }

    #[test]
    fn test_extract_engine_with_nested_parentheses() {
        let sql = r#"CREATE TABLE test (x String) 
            ENGINE = S3Queue('http://test.com/path', func('arg1', 'arg2'), 'format')"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("S3Queue('http://test.com/path', func('arg1', 'arg2'), 'format')".to_string())
        );
    }

    #[test]
    fn test_extract_engine_case_insensitive() {
        let sql = "CREATE TABLE test (x Int32) engine = MergeTree ORDER BY x";
        let result = extract_engine_from_create_table(sql);
        assert_eq!(result, Some("MergeTree".to_string()));

        let sql2 = "CREATE TABLE test (x Int32) ENGINE=MergeTree ORDER BY x";
        let result2 = extract_engine_from_create_table(sql2);
        assert_eq!(result2, Some("MergeTree".to_string()));
    }

    #[test]
    fn test_extract_engine_with_whitespace() {
        let sql = "CREATE TABLE test (x Int32) ENGINE   =   MergeTree   ORDER BY x";
        let result = extract_engine_from_create_table(sql);
        assert_eq!(result, Some("MergeTree".to_string()));
    }

    #[test]
    fn test_extract_no_engine() {
        let sql = "CREATE TABLE test (x Int32)";
        let result = extract_engine_from_create_table(sql);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_malformed_engine() {
        let sql = "CREATE TABLE test (x Int32) ENGINE = S3Queue('unclosed";
        let result = extract_engine_from_create_table(sql);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_s3queue_with_curly_braces() {
        // Test path with curly braces for pattern matching
        let sql = r#"CREATE TABLE s3_queue (name String, value UInt32) 
            ENGINE = S3Queue('http://localhost:11111/test/{a,b,c}.tsv', 'user', 'password', CSV)"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some(
                "S3Queue('http://localhost:11111/test/{a,b,c}.tsv', 'user', 'password', CSV)"
                    .to_string()
            )
        );
    }

    #[test]
    fn test_extract_engine_with_complex_nested_functions() {
        // Test with multiple levels of nested function calls
        let sql = r#"CREATE TABLE test (x String) 
            ENGINE = CustomEngine(func1(func2('arg1', func3('nested')), 'arg2'), 'final')"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some(
                "CustomEngine(func1(func2('arg1', func3('nested')), 'arg2'), 'final')".to_string()
            )
        );
    }

    // Existing tests for parse_create_materialized_view
    #[test]
    fn test_parse_simple_materialized_view() {
        let sql = "CREATE MATERIALIZED VIEW test_mv TO target_table AS SELECT * FROM source_table";
        let result = parse_create_materialized_view(sql).unwrap();

        assert_eq!(result.view_name, "test_mv");
        assert_eq!(result.target_table, "target_table");
        assert_eq!(result.target_database, None);
        assert_eq!(result.source_tables.len(), 1);
        assert_eq!(result.source_tables[0].table, "source_table");
    }

    #[test]
    fn test_parse_materialized_view_with_database() {
        let sql = "CREATE MATERIALIZED VIEW analytics.test_mv TO analytics.target_table AS SELECT * FROM source_db.source_table";
        let result = parse_create_materialized_view(sql).unwrap();

        assert_eq!(result.view_name, "test_mv");
        assert_eq!(result.target_table, "target_table");
        assert_eq!(result.target_database, Some("analytics".to_string()));
        assert_eq!(result.source_tables.len(), 1);
        assert_eq!(
            result.source_tables[0].database,
            Some("source_db".to_string())
        );
        assert_eq!(result.source_tables[0].table, "source_table");
    }

    #[test]
    fn test_parse_insert_select() {
        let sql = "INSERT INTO target_table SELECT * FROM source_table";
        let result = parse_insert_select(sql).unwrap();

        assert_eq!(result.target_table, "target_table");
        assert_eq!(result.target_database, None);
        assert!(result.columns.is_none());
        assert_eq!(result.source_tables.len(), 1);
        assert_eq!(result.source_tables[0].table, "source_table");
    }

    #[test]
    fn test_is_insert_select() {
        assert!(is_insert_select("INSERT INTO target SELECT * FROM source"));
        assert!(!is_insert_select("CREATE TABLE test (id INT)"));
    }

    #[test]
    fn test_extract_table_settings() {
        let sql = r#"CREATE TABLE test (x Int32) ENGINE = S3Queue('path', 'CSV') 
            SETTINGS mode = 'unordered', keeper_path = '/clickhouse/s3queue/test'"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_some());
        let settings = result.unwrap();
        assert_eq!(settings.get("mode"), Some(&"unordered".to_string()));
        assert_eq!(
            settings.get("keeper_path"),
            Some(&"/clickhouse/s3queue/test".to_string())
        );
    }

    #[test]
    fn test_extract_table_settings_with_numeric_values() {
        // Test settings with numeric values (no quotes)
        let sql = r#"CREATE TABLE test (x Int32) 
            ENGINE = MergeTree ORDER BY x 
            SETTINGS index_granularity = 8192, min_bytes_for_wide_part = 0"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_some());
        let settings = result.unwrap();
        assert_eq!(settings.get("index_granularity"), Some(&"8192".to_string()));
        assert_eq!(
            settings.get("min_bytes_for_wide_part"),
            Some(&"0".to_string())
        );
    }

    #[test]
    fn test_extract_table_settings_with_large_numbers() {
        // Test with very large numbers (from S3Queue test)
        let sql = r#"CREATE TABLE s3_queue (name String, value UInt32) 
            ENGINE = S3Queue('http://localhost:11111/test/{a,b,c}.tsv', 'user', 'password', CSV) 
            SETTINGS s3queue_tracked_files_limit = 18446744073709551615, mode = 'ordered'"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_some());
        let settings = result.unwrap();
        assert_eq!(
            settings.get("s3queue_tracked_files_limit"),
            Some(&"18446744073709551615".to_string())
        );
        assert_eq!(settings.get("mode"), Some(&"ordered".to_string()));
    }

    #[test]
    fn test_extract_table_settings_mixed_quotes() {
        // Test with mixed quoted and unquoted values
        let sql = r#"CREATE TABLE test (x Int32) ENGINE = MergeTree ORDER BY x 
            SETTINGS storage_policy = 's3_cache', min_rows_for_wide_part = 10000, min_bytes_for_wide_part = 0"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_some());
        let settings = result.unwrap();
        assert_eq!(
            settings.get("storage_policy"),
            Some(&"s3_cache".to_string())
        );
        assert_eq!(
            settings.get("min_rows_for_wide_part"),
            Some(&"10000".to_string())
        );
        assert_eq!(
            settings.get("min_bytes_for_wide_part"),
            Some(&"0".to_string())
        );
    }

    #[test]
    fn test_extract_table_settings_multiple_s3queue_settings() {
        // Test from actual S3Queue settings example
        let sql = r#"CREATE TABLE s3queue_test
        (
            `column1` UInt32,
            `column2` UInt32,
            `column3` UInt32
        )
        ENGINE = S3Queue('http://whatever:9001/root/data/', 'username', 'password', CSV)
        SETTINGS s3queue_loading_retries = 0, after_processing = 'delete', keeper_path = '/s3queue', mode = 'ordered', enable_hash_ring_filtering = 1, s3queue_enable_logging_to_s3queue_log = 1"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_some());
        let settings = result.unwrap();
        assert_eq!(
            settings.get("s3queue_loading_retries"),
            Some(&"0".to_string())
        );
        assert_eq!(
            settings.get("after_processing"),
            Some(&"delete".to_string())
        );
        assert_eq!(settings.get("keeper_path"), Some(&"/s3queue".to_string()));
        assert_eq!(settings.get("mode"), Some(&"ordered".to_string()));
        assert_eq!(
            settings.get("enable_hash_ring_filtering"),
            Some(&"1".to_string())
        );
        assert_eq!(
            settings.get("s3queue_enable_logging_to_s3queue_log"),
            Some(&"1".to_string())
        );
    }

    #[test]
    fn test_extract_table_settings_with_boolean_values() {
        // Test settings with boolean-like values (0, 1)
        let sql = r#"CREATE TABLE test (x Int32) ENGINE = MergeTree ORDER BY x 
            SETTINGS enable_block_number_column = 1, enable_block_offset_column = 1"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_some());
        let settings = result.unwrap();
        assert_eq!(
            settings.get("enable_block_number_column"),
            Some(&"1".to_string())
        );
        assert_eq!(
            settings.get("enable_block_offset_column"),
            Some(&"1".to_string())
        );
    }

    #[test]
    fn test_extract_table_settings_no_settings() {
        // Test table without SETTINGS clause
        let sql = r#"CREATE TABLE test (x Int32) ENGINE = MergeTree ORDER BY x"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_table_settings_with_special_chars_in_values() {
        // Test settings with special characters in values
        let sql = r#"CREATE TABLE test (x Int32) ENGINE = MergeTree ORDER BY x 
            SETTINGS storage_policy = 's3_cache-2024', path_prefix = '/data/test-123'"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_some());
        let settings = result.unwrap();
        assert_eq!(
            settings.get("storage_policy"),
            Some(&"s3_cache-2024".to_string())
        );
        assert_eq!(
            settings.get("path_prefix"),
            Some(&"/data/test-123".to_string())
        );
    }

    #[test]
    fn test_extract_table_settings_multiline() {
        // Test multiline SETTINGS with various formatting
        let sql = r#"CREATE TABLE test (x Int32) 
            ENGINE = MergeTree 
            ORDER BY x 
            SETTINGS 
                index_granularity = 3, 
                min_bytes_for_wide_part = 0, 
                min_rows_for_wide_part = 0"#;
        let result = extract_table_settings_from_create_table(sql);
        assert!(result.is_some());
        let settings = result.unwrap();
        assert_eq!(settings.get("index_granularity"), Some(&"3".to_string()));
        assert_eq!(
            settings.get("min_bytes_for_wide_part"),
            Some(&"0".to_string())
        );
        assert_eq!(
            settings.get("min_rows_for_wide_part"),
            Some(&"0".to_string())
        );
    }

    #[test]
    fn test_is_materialized_view() {
        assert!(is_materialized_view(
            "CREATE MATERIALIZED VIEW mv TO table AS SELECT * FROM source"
        ));
        assert!(!is_materialized_view(
            "CREATE VIEW mv AS SELECT * FROM source"
        ));
    }

    #[test]
    fn test_table_reference_qualified_name() {
        let table_ref = TableReference::new("users".to_string());
        assert_eq!(table_ref.qualified_name(), "users");

        let table_ref_with_db =
            TableReference::with_database("analytics".to_string(), "events".to_string());
        assert_eq!(table_ref_with_db.qualified_name(), "analytics.events");
    }
}
