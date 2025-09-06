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
}

pub fn parse_create_materialized_view(
    sql: &str,
) -> Result<MaterializedViewStatement, SqlParseError> {
    use regex::Regex;

    // ClickHouse-specific CREATE MATERIALIZED VIEW syntax with TO clause
    let re = Regex::new(
        r"(?i)CREATE\s+MATERIALIZED\s+VIEW\s+(?:(IF\s+NOT\s+EXISTS)\s+)?(?:(?:`([^`]+)`|([a-zA-Z_][a-zA-Z0-9_]*))\.)?(?:`([^`]+)`|([a-zA-Z_][a-zA-Z0-9_]*))\s+TO\s+(?:(?:`([^`]+)`|([a-zA-Z_][a-zA-Z0-9_]*))\.)?(?:`([^`]+)`|([a-zA-Z_][a-zA-Z0-9_]*))\s+(?:(POPULATE)\s+)?AS\s+(.*)"
    ).unwrap();

    if let Some(caps) = re.captures(sql) {
        let if_not_exists = caps.get(1).is_some();

        // Extract view name (database.view or just view)
        let _view_database = caps.get(2).or(caps.get(3)).map(|m| m.as_str().to_string());
        let view_name = caps.get(4).or(caps.get(5)).unwrap().as_str().to_string();

        // Extract target table (database.table or just table)
        let target_database = caps.get(6).or(caps.get(7)).map(|m| m.as_str().to_string());
        let target_table = caps.get(8).or(caps.get(9)).unwrap().as_str().to_string();

        let populate = caps.get(10).is_some();
        let select_statement = caps.get(11).unwrap().as_str().to_string();

        // Parse the SELECT statement to extract source tables
        let source_tables = parse_select_source_tables(&select_statement)?;

        Ok(MaterializedViewStatement {
            view_name,
            target_database,
            target_table,
            select_statement,
            source_tables,
            if_not_exists,
            populate,
        })
    } else {
        Err(SqlParseError::NotMaterializedView)
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
    use regex::Regex;
    let re = Regex::new(r"(?i)CREATE\s+MATERIALIZED\s+VIEW").unwrap();
    re.is_match(sql)
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

fn parse_select_source_tables(select_sql: &str) -> Result<Vec<TableReference>, SqlParseError> {
    // Use the generic SQL parser for the SELECT statement
    let dialect = ClickHouseDialect {};
    let ast = Parser::parse_sql(&dialect, select_sql)?;

    if let Some(Statement::Query(query)) = ast.first() {
        extract_source_tables_from_query(query)
    } else {
        // Try wrapping in a query if it's just a SELECT without being wrapped
        let wrapped_sql = format!("({})", select_sql);
        let ast = Parser::parse_sql(&dialect, &wrapped_sql)?;

        if let Some(Statement::Query(query)) = ast.first() {
            extract_source_tables_from_query(query)
        } else {
            Ok(Vec::new())
        }
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
