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
    let dialect = ClickHouseDialect {};
    let ast = Parser::parse_sql(&dialect, sql)?;

    if ast.len() != 1 {
        return Err(SqlParseError::NotMaterializedView);
    }

    match &ast[0] {
        Statement::CreateView {
            name,
            materialized,
            if_not_exists,
            to,
            query,
            ..
        } => {
            if !materialized {
                return Err(SqlParseError::NotMaterializedView);
            }

            // Extract view name
            let view_name = extract_table_name_from_object_name(name);

            // Extract target table from TO clause
            let (target_database, target_table) = if let Some(to_table) = to {
                let qualified_name = object_name_to_string(to_table);
                split_qualified_name(&qualified_name)
            } else {
                return Err(SqlParseError::MissingField(
                    "TO clause is required for ClickHouse materialized views".to_string(),
                ));
            };

            // Check for POPULATE keyword by scanning the original SQL
            // The sqlparser might not preserve this ClickHouse-specific keyword
            let populate = sql.to_uppercase().contains("POPULATE");

            let select_statement = format!("{}", query);
            let source_tables = extract_source_tables_from_query(query)?;

            Ok(MaterializedViewStatement {
                view_name,
                target_database,
                target_table,
                select_statement,
                source_tables,
                if_not_exists: *if_not_exists,
                populate,
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
    let dialect = ClickHouseDialect {};
    if let Ok(ast) = Parser::parse_sql(&dialect, sql) {
        if ast.len() == 1 {
            if let Statement::CreateView { materialized, .. } = &ast[0] {
                return *materialized;
            }
        }
    }
    false
}

fn object_name_to_string(name: &ObjectName) -> String {
    // Use Display trait and strip backticks
    format!("{}", name).replace('`', "")
}

fn extract_table_name_from_object_name(name: &ObjectName) -> String {
    // For a qualified name like `db.table`, we want just the table name
    // Use the existing split_qualified_name function to extract the table part
    let qualified_name = object_name_to_string(name);
    let (_database, table_name) = split_qualified_name(&qualified_name);
    table_name
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
