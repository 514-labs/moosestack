//! SQL parsing utilities using the standard sqlparser crate
//!
//! This module provides parsing functionality for ClickHouse SQL statements,
//! particularly CREATE MATERIALIZED VIEW and INSERT INTO ... SELECT statements.

use crate::infrastructure::olap::clickhouse::model::ClickHouseIndex;
use sqlparser::ast::{
    Expr, ObjectName, ObjectNamePart, Query, Select, SelectItem, SetExpr, Statement, TableFactor,
    TableWithJoins, VisitMut, VisitorMut,
};
use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;
use std::collections::HashSet;
use std::ops::ControlFlow;
use std::sync::LazyLock;

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
    #[error("Invalid index definition: {0}")]
    InvalidIndexDefinition(String),
    #[error("Invalid granularity value: '{0}' (expected unsigned integer)")]
    InvalidGranularity(String),
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
    // Find the ENGINE keyword first to avoid matching "settings" in column names
    let sql_upper = sql.to_uppercase();
    let engine_pos = sql_upper.find("ENGINE")?;

    // Search for SETTINGS only after the ENGINE clause
    let after_engine = &sql_upper[engine_pos..];
    let settings_pos_relative = after_engine.find(" SETTINGS")?;
    let settings_pos = engine_pos + settings_pos_relative;

    // Get the substring starting from SETTINGS (skip " SETTINGS")
    let settings_part = &sql[settings_pos + 9..]; // Skip " SETTINGS"
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

/// Extract SAMPLE BY expression from a CREATE TABLE statement
/// Returns the raw expression string that follows SAMPLE BY, trimmed,
/// and stops before ORDER BY, SETTINGS, or end of statement
pub fn extract_sample_by_from_create_table(sql: &str) -> Option<String> {
    let upper = sql.to_uppercase();
    let pos = upper.find("SAMPLE BY")?;
    // After the keyword
    let after = &sql[pos + "SAMPLE BY".len()..];
    let after_upper = after.to_uppercase();

    // Find earliest terminating keyword after SAMPLE BY
    let mut end = after.len();
    if let Some(i) = after_upper.find("ORDER BY") {
        end = end.min(i);
    }
    if let Some(i) = after_upper.find("SETTINGS") {
        end = end.min(i);
    }
    if let Some(i) = after_upper.find("PRIMARY KEY") {
        end = end.min(i);
    }
    // Note: Match " TTL" with leading space to avoid matching substrings
    // within identifiers (e.g., "cattle" contains "ttl")
    if let Some(i) = after_upper.find(" TTL") {
        end = end.min(i);
    }

    let expr = after[..end].trim();
    if expr.is_empty() {
        None
    } else {
        Some(expr.to_string())
    }
}

/// Extract PRIMARY KEY expression from a CREATE TABLE statement
/// Returns the raw expression string that follows PRIMARY KEY, trimmed,
/// and stops before ORDER BY, SETTINGS, or end of statement
///
/// Note: This extracts the PRIMARY KEY clause, which in ClickHouse is used
/// to specify a different primary key than the ORDER BY clause.
pub fn extract_primary_key_from_create_table(sql: &str) -> Option<String> {
    let upper = sql.to_uppercase();

    // Find PRIMARY KEY that is NOT part of "ORDER BY PRIMARY KEY"
    // We need to check that it's a standalone PRIMARY KEY clause
    let mut primary_key_pos = None;
    for (idx, _) in upper.match_indices("PRIMARY KEY") {
        // Check if this is part of ORDER BY by looking at preceding text
        let preceding_start = idx.saturating_sub(20);
        let preceding = &upper[preceding_start..idx].trim();

        // If preceded by ORDER BY, this is "ORDER BY PRIMARY KEY", not a standalone PRIMARY KEY
        if !preceding.ends_with("ORDER BY") {
            primary_key_pos = Some(idx);
            break;
        }
    }

    let pos = primary_key_pos?;

    // After the keyword
    let after = &sql[pos + "PRIMARY KEY".len()..];
    let after_upper = after.to_uppercase();

    // Find earliest terminating keyword after PRIMARY KEY
    let mut end = after.len();
    if let Some(i) = after_upper.find("ORDER BY") {
        end = end.min(i);
    }
    if let Some(i) = after_upper.find("SAMPLE BY") {
        end = end.min(i);
    }
    if let Some(i) = after_upper.find(" SETTINGS") {
        end = end.min(i);
    }
    // Note: Match " TTL" with leading space to avoid matching substrings
    if let Some(i) = after_upper.find(" TTL") {
        end = end.min(i);
    }

    let expr = after[..end].trim();
    if expr.is_empty() {
        None
    } else {
        Some(expr.to_string())
    }
}

// sql_parser library cannot handle clickhouse indexes last time i tried
// `show indexes` does not provide index argument info
// so we're stuck with this
pub fn extract_indexes_from_create_table(sql: &str) -> Result<Vec<ClickHouseIndex>, SqlParseError> {
    let mut result: Vec<ClickHouseIndex> = Vec::new();
    let upper = sql.to_uppercase();
    // Find opening '(' after CREATE TABLE ...
    let open_paren_pos = upper.find('(');
    let engine_pos = upper.find("\nENGINE").or_else(|| upper.find(" ENGINE"));
    if open_paren_pos.is_none() || engine_pos.is_none() {
        return Ok(result);
    }
    let (start, end) = (open_paren_pos.unwrap() + 1, engine_pos.unwrap());
    let body = &sql[start..end];

    // Split top-level comma-separated items, respecting nested parentheses
    let mut items: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for ch in body.chars() {
        if escape {
            current.push(ch);
            escape = false;
            continue;
        }
        match ch {
            '\\' if in_string => {
                current.push(ch);
                escape = true;
            }
            '\'' => {
                in_string = !in_string;
                current.push(ch);
            }
            '(' if !in_string => {
                depth += 1;
                current.push(ch);
            }
            ')' if !in_string => {
                depth -= 1;
                current.push(ch);
            }
            ',' if !in_string && depth == 0 => {
                items.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        items.push(current.trim().to_string());
    }

    for item in items
        .into_iter()
        .filter(|s| s.to_uppercase().starts_with("INDEX "))
    {
        // Structure: INDEX <name> <expression> TYPE <type>(args?) GRANULARITY <n>
        let mut rest = item.trim_start_matches(|c: char| c.is_whitespace()).trim();
        // strip leading INDEX
        if let Some(after_index) = rest.strip_prefix("INDEX ") {
            rest = after_index.trim_start();
        }
        // name is next token until whitespace
        let mut parts = rest.splitn(2, char::is_whitespace);
        let name = parts.next().unwrap_or("").trim().to_string();
        let after_name = parts.next().unwrap_or("").trim();
        if name.is_empty() || after_name.is_empty() {
            return Err(SqlParseError::InvalidIndexDefinition(item));
        }

        // Find TYPE ... GRANULARITY ... boundaries while allowing parentheses in expression
        let after_upper = after_name.to_uppercase();
        let type_pos = after_upper.find(" TYPE ");
        let gran_pos = after_upper.rfind(" GRANULARITY ");
        if type_pos.is_none() || gran_pos.is_none() || type_pos.unwrap() >= gran_pos.unwrap() {
            return Err(SqlParseError::InvalidIndexDefinition(item));
        }
        let expr = after_name[..type_pos.unwrap()].trim().to_string();
        let type_and_after = &after_name[type_pos.unwrap() + 6..];
        let type_upper = type_and_after.to_uppercase();
        let gran_rel = type_upper
            .rfind(" GRANULARITY ")
            .ok_or_else(|| SqlParseError::InvalidIndexDefinition(item.clone()))?;
        let type_section = type_and_after[..gran_rel].trim();
        let gran_part = type_and_after[gran_rel + " GRANULARITY ".len()..].trim();

        // Parse type name and optional arguments in parentheses
        let (type_name, args): (String, Vec<String>) = if let Some(open) = type_section.find('(') {
            let tname = type_section[..open].trim().to_string();
            let mut depth = 0i32;
            let mut end = None;
            for (i, ch) in type_section[open..].chars().enumerate() {
                match ch {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            end = Some(open + i);
                            break;
                        }
                    }
                    _ => {}
                }
            }
            let args_raw = end.map(|e| &type_section[open + 1..=e - 1]).unwrap_or("");
            let args = if args_raw.trim().is_empty() {
                vec![]
            } else {
                args_raw.split(',').map(|s| s.trim().to_string()).collect()
            };
            (tname, args)
        } else {
            (type_section.to_string(), vec![])
        };

        // Parse granularity precisely: allow only digits, optionally a trailing ')'
        let granularity: u64 = {
            let trimmed = gran_part.trim();
            let candidate = trimmed
                .strip_suffix(')')
                .map(|s| s.trim_end())
                .unwrap_or(trimmed);
            if !candidate.chars().all(|c| c.is_ascii_digit()) {
                return Err(SqlParseError::InvalidGranularity(trimmed.to_string()));
            }
            candidate
                .parse::<u64>()
                .map_err(|_| SqlParseError::InvalidGranularity(trimmed.to_string()))?
        };

        result.push(ClickHouseIndex {
            name,
            expression: expr,
            index_type: type_name,
            arguments: args,
            granularity,
        });
    }

    Ok(result)
}

/// Strips column definitions from CREATE VIEW/MATERIALIZED VIEW statements
/// ClickHouse includes column type definitions like `(col1 Type1, col2 Type2)` before AS
/// but the SQL parser doesn't support this syntax, so we remove it
///
/// Handles nested parentheses (e.g., DateTime('UTC')) by counting paren depth
/// Normalizes a SQL statement for comparison
/// - Strips database prefixes that match the default database
/// - Removes unnecessary backticks
/// - Normalizes whitespace
/// - Uppercases SQL keywords
struct Normalizer<'a> {
    default_database: &'a str,
}

impl<'a> VisitorMut for Normalizer<'a> {
    type Break = ();

    fn pre_visit_table_factor(
        &mut self,
        table_factor: &mut TableFactor,
    ) -> ControlFlow<Self::Break> {
        if let TableFactor::Table { name, .. } = table_factor {
            // Strip default database prefix
            if name.0.len() == 2 {
                if let ObjectNamePart::Identifier(ident) = &name.0[0] {
                    if ident.value.eq_ignore_ascii_case(self.default_database) {
                        name.0.remove(0);
                    }
                }
            }
            // Unquote table names
            for part in &mut name.0 {
                if let ObjectNamePart::Identifier(ident) = part {
                    ident.quote_style = None;
                    ident.value = ident.value.replace('`', "");
                }
            }
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::Identifier(ident) => {
                ident.quote_style = None;
                ident.value = ident.value.replace('`', "");
            }
            Expr::Function(func) => {
                // Uppercase function names (e.g. count -> COUNT)
                if let Some(ObjectNamePart::Identifier(ident)) = func.name.0.last_mut() {
                    let upper = ident.value.to_uppercase();
                    if matches!(
                        upper.as_str(),
                        "COUNT"
                            | "SUM"
                            | "AVG"
                            | "MIN"
                            | "MAX"
                            | "ABS"
                            | "COALESCE"
                            | "IF"
                            | "DISTINCT"
                    ) {
                        ident.value = upper;
                    }
                    ident.quote_style = None;
                    ident.value = ident.value.replace('`', "");
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_statement(&mut self, statement: &mut Statement) -> ControlFlow<Self::Break> {
        if let Statement::CreateView { name, to, .. } = statement {
            // Strip default database prefix from view name
            if name.0.len() == 2 {
                if let ObjectNamePart::Identifier(ident) = &name.0[0] {
                    if ident.value.eq_ignore_ascii_case(self.default_database) {
                        name.0.remove(0);
                    }
                }
            }

            for part in &mut name.0 {
                if let ObjectNamePart::Identifier(ident) = part {
                    ident.quote_style = None;
                    ident.value = ident.value.replace('`', "");
                }
            }
            if let Some(to_name) = to {
                // Strip default database prefix from TO table
                if to_name.0.len() == 2 {
                    if let ObjectNamePart::Identifier(ident) = &to_name.0[0] {
                        if ident.value.eq_ignore_ascii_case(self.default_database) {
                            to_name.0.remove(0);
                        }
                    }
                }

                for part in &mut to_name.0 {
                    if let ObjectNamePart::Identifier(ident) = part {
                        ident.quote_style = None;
                        ident.value = ident.value.replace('`', "");
                    }
                }
            }
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        // Handle SELECT items (including aliases)
        if let SetExpr::Select(select) = &mut *query.body {
            for item in &mut select.projection {
                if let SelectItem::ExprWithAlias { alias, .. } = item {
                    alias.quote_style = None;
                    alias.value = alias.value.replace('`', "");
                }
            }
        }
        ControlFlow::Continue(())
    }
}

pub fn normalize_sql_for_comparison(sql: &str, default_database: &str) -> String {
    // 1. Parse with sqlparser (AST-based structural normalization)
    // This handles stripping default database prefixes (e.g., `local.Table` -> `Table`)
    // and basic unquoting where the parser understands the structure.
    let dialect = ClickHouseDialect {};
    let intermediate = match Parser::parse_sql(&dialect, sql) {
        Ok(mut ast) => {
            if ast.is_empty() {
                return sql.trim().to_string();
            }

            // 2. Walk AST to normalize (strip database prefixes, unquote)
            let mut normalizer = Normalizer { default_database };
            for statement in &mut ast {
                let _ = statement.visit(&mut normalizer);
            }

            // 3. Convert back to string
            ast[0].to_string()
        }
        Err(_e) => {
            // Fallback if parsing fails: rudimentary string replacement
            let mut result = sql.to_string();
            if !default_database.is_empty() {
                let prefix_pattern = format!("{}.", default_database);
                result = result.replace(&prefix_pattern, "");
            }
            result
        }
    };

    intermediate.trim().to_string()
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
            let source_tables = extract_source_tables_from_query_ast(query)?;

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
                let source_tables = extract_source_tables_from_query_ast(query)?;
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

pub fn split_qualified_name(name: &str) -> (Option<String>, String) {
    if let Some(dot_pos) = name.rfind('.') {
        let database = name[..dot_pos].to_string();
        let table = name[dot_pos + 1..].to_string();
        (Some(database), table)
    } else {
        (None, name.to_string())
    }
}

pub fn extract_source_tables_from_query(sql: &str) -> Result<Vec<TableReference>, SqlParseError> {
    let dialect = ClickHouseDialect {};
    let ast = Parser::parse_sql(&dialect, sql)?;

    if ast.len() != 1 {
        // Should be exactly one query
        return Err(SqlParseError::UnsupportedStatement);
    }

    if let Statement::Query(query) = &ast[0] {
        extract_source_tables_from_query_ast(query)
    } else {
        Err(SqlParseError::UnsupportedStatement)
    }
}

static FROM_JOIN_TABLE_PATTERN: LazyLock<regex::Regex> = LazyLock::new(|| {
    // Pattern to extract table names from FROM and JOIN clauses
    // Matches: FROM schema.table, JOIN schema.table, FROM table, etc.
    // Captures optional schema and required table name
    regex::Regex::new(r"(?i)\b(?:FROM|JOIN)\s+(?:([a-zA-Z0-9_`]+)\.)?([a-zA-Z0-9_`]+)")
        .expect("FROM_JOIN_TABLE_PATTERN regex should compile")
});

/// Extracts table names from a SQL query using regex fallback.
/// Used when the standard SQL parser fails (e.g., ClickHouse-specific syntax like array literals).
///
/// This is a simplified fallback that pattern-matches FROM/JOIN clauses rather than
/// parsing the full AST. It won't catch tables in subqueries, but it's sufficient for
/// basic dependency tracking when full parsing isn't possible.
pub fn extract_source_tables_from_query_regex(
    sql: &str,
    default_database: &str,
) -> Result<Vec<TableReference>, SqlParseError> {
    let mut tables = Vec::new();

    for captures in FROM_JOIN_TABLE_PATTERN.captures_iter(sql) {
        let database = captures.get(1).map(|m| m.as_str().replace('`', ""));
        let table = captures
            .get(2)
            .map(|m| m.as_str().replace('`', ""))
            .ok_or(SqlParseError::UnsupportedStatement)?;

        tables.push(TableReference {
            database: database.or_else(|| Some(default_database.to_string())),
            table,
            alias: None,
        });
    }

    if tables.is_empty() {
        // No tables found - this might be a problem, but don't fail hard
        // The view might have tables in subqueries that regex can't catch
    }

    Ok(tables)
}

fn extract_source_tables_from_query_ast(
    query: &Query,
) -> Result<Vec<TableReference>, SqlParseError> {
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
pub mod tests {
    use super::*;

    pub const NESTED_OBJECTS_SQL: &str = "CREATE TABLE local.NestedObjects (`id` String, `timestamp` DateTime('UTC'), `address` Nested(street String, city String, coordinates Nested(lat Float64, lng Float64)), `metadata` Nested(tags Array(String), priority Int64, config Nested(enabled Bool, settings Nested(theme String, notifications Bool)))) ENGINE = MergeTree PRIMARY KEY id ORDER BY id SETTINGS enable_mixed_granularity_parts = 1, index_granularity = 8192, index_granularity_bytes = 10485760";

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
    fn test_extract_table_settings_nested_objects() {
        // Test with deeply nested structure containing "settings" as a nested field name
        let result = extract_table_settings_from_create_table(NESTED_OBJECTS_SQL);
        assert!(
            result.is_some(),
            "Should extract settings from SQL with nested 'settings' field"
        );
        let settings = result.unwrap();
        assert_eq!(
            settings.get("enable_mixed_granularity_parts"),
            Some(&"1".to_string())
        );
        assert_eq!(settings.get("index_granularity"), Some(&"8192".to_string()));
        assert_eq!(
            settings.get("index_granularity_bytes"),
            Some(&"10485760".to_string())
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

    // Tests for SharedMergeTree family engines
    #[test]
    fn test_extract_shared_merge_tree() {
        let sql = r#"CREATE TABLE test (x Int32)
            ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')".to_string())
        );
    }

    #[test]
    fn test_extract_shared_replacing_merge_tree_no_params() {
        let sql = r#"CREATE TABLE test (x Int32)
            ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some(
                "SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')"
                    .to_string()
            )
        );
    }

    #[test]
    fn test_extract_shared_replacing_merge_tree_with_ver() {
        let sql = r#"CREATE TABLE test (x Int32, version DateTime)
            ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', version)
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', version)".to_string())
        );
    }

    #[test]
    fn test_extract_shared_replacing_merge_tree_with_ver_and_is_deleted() {
        let sql = r#"CREATE TABLE test (x Int32, _peerdb_version DateTime, _peerdb_is_deleted UInt8)
            ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _peerdb_version, _peerdb_is_deleted)
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _peerdb_version, _peerdb_is_deleted)".to_string())
        );
    }

    #[test]
    fn test_extract_shared_aggregating_merge_tree() {
        let sql = r#"CREATE TABLE test (x Int32)
            ENGINE = SharedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some(
                "SharedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')"
                    .to_string()
            )
        );
    }

    #[test]
    fn test_extract_shared_summing_merge_tree() {
        let sql = r#"CREATE TABLE test (x Int32, sum_column Int64)
            ENGINE = SharedSummingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', sum_column)
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedSummingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', sum_column)".to_string())
        );
    }

    #[test]
    fn test_extract_replicated_replacing_merge_tree_no_params() {
        let sql = r#"CREATE TABLE test (x Int32)
            ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/01/{shard}/hits', '{replica}')
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some(
                "ReplicatedReplacingMergeTree('/clickhouse/tables/01/{shard}/hits', '{replica}')"
                    .to_string()
            )
        );
    }

    #[test]
    fn test_extract_replicated_replacing_merge_tree_with_ver() {
        let sql = r#"CREATE TABLE test (x Int32, ver DateTime)
            ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/01/{shard}/hits', '{replica}', ver)
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("ReplicatedReplacingMergeTree('/clickhouse/tables/01/{shard}/hits', '{replica}', ver)".to_string())
        );
    }

    #[test]
    fn test_extract_replicated_replacing_merge_tree_with_ver_and_is_deleted() {
        let sql = r#"CREATE TABLE test (x Int32, ver DateTime, is_deleted UInt8)
            ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/01/{shard}/hits', '{replica}', ver, is_deleted)
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("ReplicatedReplacingMergeTree('/clickhouse/tables/01/{shard}/hits', '{replica}', ver, is_deleted)".to_string())
        );
    }

    #[test]
    fn test_extract_shared_merge_tree_with_backticks() {
        // Test with backticks in column names (common in ClickHouse)
        let sql = r#"CREATE TABLE test (x Int32, `version` DateTime)
            ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', `version`)
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', `version`)".to_string())
        );
    }

    #[test]
    fn test_extract_shared_merge_tree_complex_path() {
        // Test with more complex path patterns
        let sql = r#"CREATE TABLE test (x Int32)
            ENGINE = SharedMergeTree('/clickhouse/prod/tables/{database}/{table}/{uuid}', 'replica-{replica_num}')
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedMergeTree('/clickhouse/prod/tables/{database}/{table}/{uuid}', 'replica-{replica_num}')".to_string())
        );
    }

    #[test]
    fn test_extract_shared_merge_tree_with_settings() {
        // Ensure extraction stops at engine definition and doesn't include SETTINGS
        let sql = r#"CREATE TABLE test (x Int32)
            ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
            ORDER BY x
            SETTINGS index_granularity = 8192"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')".to_string())
        );
    }

    #[test]
    fn test_extract_engine_from_create_table_nested_objects() {
        // Test with deeply nested structure
        let result = extract_engine_from_create_table(NESTED_OBJECTS_SQL);
        assert_eq!(result, Some("MergeTree".to_string()));
    }

    #[test]
    fn test_extract_clickhouse_cloud_real_example() {
        // Real example from ClickHouse Cloud as shown in the user's message
        let sql = r#"CREATE TABLE `f45-lionheart-backen-staging-408b5`.RawGCPData_0_0 (
            `studio_object_id` String,
            `studio_id` String,
            `studio_access_code` String,
            `user_object_id` String,
            `user_name` String,
            `user_email` String,
            `serial` String,
            `max` String,
            `totalpoints` String,
            `totalcalories` String,
            `averagebpm` String,
            `bpmmax` String,
            `bpmin` String,
            `hr70plus` String,
            `workoutname` String,
            `session_type` String,
            `workouttime` String,
            `workouttimestamp` String,
            `localip` String,
            `uuid` String,
            `scalar` String,
            `columns` Nested(time Array(Float64), percent Array(Float64), calories Array(Float64), points Array(Float64), certainty Array(Float64), bpm Array(Float64)),
            `created_at` String,
            `workouttimestampiso` String,
            `file_name` String,
            `line_number` Float64
        ) ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
        PRIMARY KEY studio_object_id
        ORDER BY studio_object_id
        SETTINGS index_granularity = 8192"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')".to_string())
        );
    }

    #[test]
    fn test_extract_shared_replacing_merge_tree_quoted_params() {
        // Test with quoted column names as parameters
        let sql = r#"CREATE TABLE test (x Int32, `_version` DateTime, `_is_deleted` UInt8)
            ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', '_version', '_is_deleted')
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', '_version', '_is_deleted')".to_string())
        );
    }

    #[test]
    fn test_extract_shared_replacing_merge_tree_special_chars_in_path() {
        // Test with special characters in the path
        let sql = r#"CREATE TABLE test (x Int32)
            ENGINE = SharedReplacingMergeTree('/clickhouse/tables-v2/{uuid:01234-5678}/{shard}', '{replica}')
            ORDER BY x"#;
        let result = extract_engine_from_create_table(sql);
        assert_eq!(
            result,
            Some("SharedReplacingMergeTree('/clickhouse/tables-v2/{uuid:01234-5678}/{shard}', '{replica}')".to_string())
        );
    }

    #[test]
    fn test_extract_sample_by_simple() {
        let sql = r#"CREATE TABLE t (id UInt64) ENGINE = MergeTree ORDER BY id"#;
        assert_eq!(extract_sample_by_from_create_table(sql), None);

        let sql2 = r#"CREATE TABLE t (id UInt64) ENGINE = MergeTree
            PARTITION BY toYYYYMM(now())
            SAMPLE BY cityHash64(id)
            ORDER BY id"#;
        assert_eq!(
            extract_sample_by_from_create_table(sql2),
            Some("cityHash64(id)".to_string())
        );
    }

    #[test]
    fn test_extract_sample_by_with_settings() {
        let sql = r#"CREATE TABLE t (id UInt64) ENGINE = MergeTree
            SAMPLE BY cityHash64(id)
            ORDER BY id
            SETTINGS index_granularity = 8192"#;
        assert_eq!(
            extract_sample_by_from_create_table(sql),
            Some("cityHash64(id)".to_string())
        );
    }

    #[test]
    fn test_extract_sample_by_no_order_by() {
        let sql = r#"CREATE TABLE t (id UInt64) ENGINE = MergeTree
            SAMPLE BY someExpr(id)"#;
        assert_eq!(
            extract_sample_by_from_create_table(sql),
            Some("someExpr(id)".to_string())
        );
    }

    #[test]
    fn test_extract_sample_by_nested_objects() {
        // Test with deeply nested structure - should not find SAMPLE BY since none is present
        assert_eq!(
            extract_sample_by_from_create_table(NESTED_OBJECTS_SQL),
            None
        );
    }

    #[test]
    fn test_extract_sample_by_with_ttl_single_line() {
        // When parsing CREATE TABLE with both SAMPLE BY and TTL,
        // the parser needs to stop at TTL keyword to avoid capturing the TTL expression.
        //
        // Bug: Parser only checked for ORDER BY, SETTINGS, and PRIMARY KEY as terminators,
        // so it extracted "sample_hash TTL toDateTime(...)" instead of just "sample_hash".
        //
        // This primarily affected tables created outside Moose (not in state storage).
        // For Moose-managed tables, the correct value from state storage was used instead.
        // Customer reported this when migrating external tables.
        let sql = "CREATE TABLE t (id UInt64, ts DateTime) ENGINE = MergeTree ORDER BY (hour_stamp, sample_hash, ts) SAMPLE BY sample_hash TTL toDateTime(ts / 1000) + toIntervalDay(30) SETTINGS index_granularity = 8192";
        assert_eq!(
            extract_sample_by_from_create_table(sql),
            Some("sample_hash".to_string())
        );
    }

    #[test]
    fn test_extract_sample_by_with_identifier_containing_ttl() {
        // Edge case: Ensure identifiers containing "ttl" substring don't cause false matches
        // "cattle" contains "ttl" when uppercased, but shouldn't be treated as TTL keyword
        let sql = "CREATE TABLE t (id UInt64, cattle_count UInt64) ENGINE = MergeTree ORDER BY id SAMPLE BY cattle_count SETTINGS index_granularity = 8192";
        assert_eq!(
            extract_sample_by_from_create_table(sql),
            Some("cattle_count".to_string())
        );
    }

    // Tests for extract_primary_key_from_create_table
    #[test]
    fn test_extract_primary_key_simple() {
        let sql = r#"CREATE TABLE t (id UInt64, name String) ENGINE = MergeTree PRIMARY KEY id ORDER BY id"#;
        assert_eq!(
            extract_primary_key_from_create_table(sql),
            Some("id".to_string())
        );
    }

    #[test]
    fn test_extract_primary_key_tuple() {
        let sql = r#"CREATE TABLE t (id UInt64, ts DateTime) ENGINE = MergeTree PRIMARY KEY (id, ts) ORDER BY (id, ts)"#;
        assert_eq!(
            extract_primary_key_from_create_table(sql),
            Some("(id, ts)".to_string())
        );
    }

    #[test]
    fn test_extract_primary_key_with_expression() {
        let sql = r#"CREATE TABLE t (id UInt64, ts DateTime) ENGINE = MergeTree PRIMARY KEY (id, toYYYYMM(ts)) ORDER BY (id, ts)"#;
        assert_eq!(
            extract_primary_key_from_create_table(sql),
            Some("(id, toYYYYMM(ts))".to_string())
        );
    }

    #[test]
    fn test_extract_primary_key_order_by_primary_key() {
        // Test that we DON'T extract "ORDER BY PRIMARY KEY" as a PRIMARY KEY clause
        let sql = r#"CREATE TABLE t (id UInt64) ENGINE = MergeTree ORDER BY PRIMARY KEY id"#;
        assert_eq!(extract_primary_key_from_create_table(sql), None);
    }

    #[test]
    fn test_extract_primary_key_with_settings() {
        let sql = r#"CREATE TABLE t (id UInt64, name String) ENGINE = MergeTree PRIMARY KEY id ORDER BY id SETTINGS index_granularity = 8192"#;
        assert_eq!(
            extract_primary_key_from_create_table(sql),
            Some("id".to_string())
        );
    }

    #[test]
    fn test_extract_primary_key_no_primary_key() {
        let sql = r#"CREATE TABLE t (id UInt64) ENGINE = MergeTree ORDER BY id"#;
        assert_eq!(extract_primary_key_from_create_table(sql), None);
    }

    #[test]
    fn test_extract_primary_key_nested_objects() {
        // NESTED_OBJECTS_SQL has "PRIMARY KEY id"
        assert_eq!(
            extract_primary_key_from_create_table(NESTED_OBJECTS_SQL),
            Some("id".to_string())
        );
    }

    #[test]
    fn test_extract_primary_key_with_sample_by() {
        let sql = r#"CREATE TABLE t (id UInt64, hash UInt64) ENGINE = MergeTree PRIMARY KEY id SAMPLE BY hash ORDER BY (id, hash)"#;
        assert_eq!(
            extract_primary_key_from_create_table(sql),
            Some("id".to_string())
        );
    }

    #[test]
    fn test_extract_primary_key_with_ttl() {
        let sql = r#"CREATE TABLE t (id UInt64, ts DateTime) ENGINE = MergeTree PRIMARY KEY id ORDER BY id TTL ts + INTERVAL 30 DAY"#;
        assert_eq!(
            extract_primary_key_from_create_table(sql),
            Some("id".to_string())
        );
    }

    #[test]
    fn test_extract_indexes_from_create_table_multiple() {
        let sql = "CREATE TABLE local.table_name (`u64` UInt64, `i32` Int32, `s` String, \
        INDEX idx1 u64 TYPE bloom_filter GRANULARITY 3, \
        INDEX idx2 u64 * i32 TYPE minmax GRANULARITY 3, \
        INDEX idx3 u64 * length(s) TYPE set(1000) GRANULARITY 4, \
        INDEX idx4 (u64, i32) TYPE MinMax GRANULARITY 1, \
        INDEX idx5 (u64, i32) TYPE minmax GRANULARITY 1, \
        INDEX idx6 toString(i32) TYPE ngrambf_v1(2, 256, 1, 123) GRANULARITY 1, \
        INDEX idx7 s TYPE nGraMbf_v1(3, 256, 1, 123) GRANULARITY 1\
        ) ENGINE = MergeTree ORDER BY u64 SETTINGS index_granularity = 8192";

        let indexes = extract_indexes_from_create_table(sql).unwrap();
        assert_eq!(indexes.len(), 7);

        assert_eq!(
            indexes[0],
            ClickHouseIndex {
                name: "idx1".to_string(),
                expression: "u64".to_string(),
                index_type: "bloom_filter".to_string(),
                arguments: vec![],
                granularity: 3,
            }
        );
        assert_eq!(
            indexes[1],
            ClickHouseIndex {
                name: "idx2".to_string(),
                expression: "u64 * i32".to_string(),
                index_type: "minmax".to_string(),
                arguments: vec![],
                granularity: 3,
            }
        );
        assert_eq!(
            indexes[2],
            ClickHouseIndex {
                name: "idx3".to_string(),
                expression: "u64 * length(s)".to_string(),
                index_type: "set".to_string(),
                arguments: vec!["1000".to_string()],
                granularity: 4,
            }
        );
        assert_eq!(
            indexes[3],
            ClickHouseIndex {
                name: "idx4".to_string(),
                expression: "(u64, i32)".to_string(),
                index_type: "MinMax".to_string(),
                arguments: vec![],
                granularity: 1,
            }
        );
        assert_eq!(
            indexes[4],
            ClickHouseIndex {
                name: "idx5".to_string(),
                expression: "(u64, i32)".to_string(),
                index_type: "minmax".to_string(),
                arguments: vec![],
                granularity: 1,
            }
        );
        assert_eq!(
            indexes[5],
            ClickHouseIndex {
                name: "idx6".to_string(),
                expression: "toString(i32)".to_string(),
                index_type: "ngrambf_v1".to_string(),
                arguments: vec![
                    "2".to_string(),
                    "256".to_string(),
                    "1".to_string(),
                    "123".to_string()
                ],
                granularity: 1,
            }
        );
        assert_eq!(
            indexes[6],
            ClickHouseIndex {
                name: "idx7".to_string(),
                expression: "s".to_string(),
                index_type: "nGraMbf_v1".to_string(),
                arguments: vec![
                    "3".to_string(),
                    "256".to_string(),
                    "1".to_string(),
                    "123".to_string()
                ],
                granularity: 1,
            }
        );
    }

    #[test]
    fn test_extract_indexes_from_create_table_nested_objects() {
        // Test with deeply nested structure - should not find indexes since none are present
        let indexes = extract_indexes_from_create_table(NESTED_OBJECTS_SQL).unwrap();
        assert_eq!(indexes.len(), 0);
    }

    #[test]
    fn test_normalize_sql_removes_backticks() {
        let input = "SELECT `column1`, `column2` FROM `table_name`";
        let result = normalize_sql_for_comparison(input, "");
        assert!(!result.contains('`'));
        assert!(result.contains("column1"));
        assert!(result.contains("table_name"));
    }

    #[test]
    fn test_normalize_sql_uppercases_keywords() {
        let input = "select count(id) as total from users where active = true";
        let result = normalize_sql_for_comparison(input, "");
        assert!(result.contains("SELECT"));
        assert!(result.contains("COUNT"));
        assert!(result.contains("AS"));
        assert!(result.contains("FROM"));
        assert!(result.contains("WHERE"));
    }

    #[test]
    fn test_normalize_sql_collapses_whitespace() {
        let input = "SELECT\n    col1,\n    col2\n  FROM\n    my_table";
        let result = normalize_sql_for_comparison(input, "");
        assert!(!result.contains('\n'));
        assert_eq!(result, "SELECT col1, col2 FROM my_table");
    }

    #[test]
    fn test_normalize_sql_removes_database_prefix() {
        let input = "SELECT * FROM mydb.table1 JOIN mydb.table2";
        let result = normalize_sql_for_comparison(input, "mydb");
        assert!(!result.contains("mydb."));
        assert!(result.contains("table1"));
        assert!(result.contains("table2"));
    }

    #[test]
    fn test_normalize_sql_comprehensive() {
        // Test with all differences at once
        let user_sql = "CREATE MATERIALIZED VIEW IF NOT EXISTS `MV`\n        TO `Target`\n        AS SELECT\n    count(`id`) as total\n  FROM `Source`";
        let ch_sql = "CREATE MATERIALIZED VIEW IF NOT EXISTS MV TO Target AS SELECT COUNT(id) AS total FROM Source";

        let normalized_user = normalize_sql_for_comparison(user_sql, "");
        let normalized_ch = normalize_sql_for_comparison(ch_sql, "");

        assert_eq!(normalized_user, normalized_ch);
    }

    #[test]
    fn test_normalize_sql_with_database_prefix() {
        let user_sql = "CREATE VIEW `MyView` AS SELECT `col` FROM `MyTable`";
        let ch_sql = "CREATE VIEW local.MyView AS SELECT col FROM local.MyTable";

        let normalized_user = normalize_sql_for_comparison(user_sql, "local");
        let normalized_ch = normalize_sql_for_comparison(ch_sql, "local");

        assert_eq!(normalized_user, normalized_ch);
    }

    #[test]
    fn test_normalize_sql_handles_backticks_on_reserved_keyword_aliases() {
        // ClickHouse automatically adds backticks around reserved keywords like "table"
        let ch_sql = "CREATE MATERIALIZED VIEW mv AS SELECT date, 'value' AS `table` FROM source";
        // User code typically doesn't have backticks
        let user_sql = "CREATE MATERIALIZED VIEW mv AS SELECT date, 'value' AS table FROM source";

        let normalized_ch = normalize_sql_for_comparison(ch_sql, "");
        let normalized_user = normalize_sql_for_comparison(user_sql, "");

        assert_eq!(normalized_ch, normalized_user);
        // Both should normalize to the version without backticks
        assert!(normalized_ch.contains("AS table"));
        assert!(!normalized_ch.contains("AS `table`"));
    }

    #[test]
    fn test_extract_source_tables_with_standard_sql() {
        let sql = "SELECT a.id, b.name FROM users a JOIN orders b ON a.id = b.user_id";
        let result = extract_source_tables_from_query(sql).unwrap();

        assert_eq!(result.len(), 2);
        let table_names: Vec<&str> = result.iter().map(|t| t.table.as_str()).collect();
        assert!(table_names.contains(&"users"));
        assert!(table_names.contains(&"orders"));
    }

    #[test]
    fn test_extract_source_tables_regex_fallback_with_clickhouse_array_literals() {
        // Reproduces customer bug: ClickHouse array literal syntax ['item1', 'item2']
        // causes standard SQL parser to fail at the '[' character.
        // This tests the regex fallback successfully extracts tables despite parse failure.
        let sql = r#"
            SELECT name, count() as total
            FROM mydb.endpoint_process
            WHERE arrayExists(x -> (lower(name) LIKE x), ['pattern1', 'pattern2'])
            AND status NOT IN ['completed', 'failed']
            GROUP BY name
        "#;

        // Standard parser should fail on '[' in array literals
        let parse_result = extract_source_tables_from_query(sql);
        assert!(
            parse_result.is_err(),
            "Expected parser to fail on ClickHouse array syntax"
        );

        // Regex fallback should succeed and extract the correct table with schema
        let result = extract_source_tables_from_query_regex(sql, "default").unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].table, "endpoint_process");
        assert_eq!(result[0].database, Some("mydb".to_string()));
    }

    #[test]
    fn test_extract_source_tables_regex_handles_joins_and_defaults() {
        // Tests regex fallback extracts FROM/JOIN tables, handles backticks,
        // and applies default database to unqualified names
        let sql = "SELECT * FROM `schema1`.`table1` JOIN table2 ON table1.id = table2.id";

        let result = extract_source_tables_from_query_regex(sql, "default_db").unwrap();

        assert_eq!(result.len(), 2);

        let tables: Vec<(Option<String>, String)> = result
            .iter()
            .map(|t| (t.database.clone(), t.table.clone()))
            .collect();

        // table1 has schema, table2 gets default_db
        assert!(tables.contains(&(Some("schema1".to_string()), "table1".to_string())));
        assert!(tables.contains(&(Some("default_db".to_string()), "table2".to_string())));
    }
}
