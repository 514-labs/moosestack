# Query Format Code Flag Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `--format-query` flag to `moose query` command to format SQL queries as Python or TypeScript code literals without executing them.

**Architecture:** Extend existing `moose query` command with optional formatting path. When `-q/--format-query` flag is present, skip query execution and instead format the SQL input as a code literal (Python raw string or TypeScript template literal). Reuse existing SQL input logic (argument/file/stdin).

**Tech Stack:** Rust (clap for CLI, existing query routine infrastructure)

---

## Task 1: Add Format Query Flag to Command Definition

**Files:**

- Modify: `apps/framework-cli/src/cli/commands.rs:197-208`

**Step 1: Add format_query field to Query command**

In the `Query` variant of the `Commands` enum (around line 197), add the new flag after the `limit` field:

```rust
Query {
    /// SQL query to execute
    query: Option<String>,

    /// Read query from file
    #[arg(short = 'f', long = "file", conflicts_with = "query")]
    file: Option<PathBuf>,

    /// Maximum number of rows to return (applied via ClickHouse settings)
    #[arg(short, long, default_value = "10000")]
    limit: u64,

    /// Format query as code literal (python|typescript). Skips execution.
    #[arg(short = 'c', long = "format-query", value_name = "LANGUAGE")]
    format_query: Option<String>,
},
```

**Step 2: Verify it compiles**

Run: `cargo check`
Expected: Compilation errors in cli.rs about pattern mismatch (Query destructuring doesn't include format_query)

**Step 3: Commit**

```bash
git add apps/framework-cli/src/cli/commands.rs
git commit -m "feat: add --format-query flag to query command"
```

---

## Task 2: Create Format Query Module

**Files:**

- Create: `apps/framework-cli/src/cli/routines/format_query.rs`

**Step 1: Create module with language enum and validation**

Create new file with complete implementation:

```rust
//! Module for formatting SQL queries as code literals.
//!
//! Supports formatting SQL queries as Python raw strings or TypeScript template literals
//! for easy copy-pasting into application code.

use crate::cli::display::Message;
use crate::cli::routines::RoutineFailure;

/// Supported languages for code formatting
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeLanguage {
    Python,
    TypeScript,
}

impl CodeLanguage {
    /// Parse language string into CodeLanguage enum
    pub fn from_str(s: &str) -> Result<Self, RoutineFailure> {
        match s.to_lowercase().as_str() {
            "python" | "py" => Ok(CodeLanguage::Python),
            "typescript" | "ts" => Ok(CodeLanguage::TypeScript),
            _ => Err(RoutineFailure::error(Message::new(
                "Format Query".to_string(),
                format!(
                    "Unsupported language: '{}'. Supported: python, typescript",
                    s
                ),
            ))),
        }
    }
}

/// Format SQL query as a code literal for the specified language.
///
/// # Arguments
///
/// * `sql` - The SQL query string to format
/// * `language` - Target language (Python or TypeScript)
///
/// # Returns
///
/// Formatted code literal as a string
pub fn format_as_code(sql: &str, language: CodeLanguage) -> String {
    match language {
        CodeLanguage::Python => format_python(sql),
        CodeLanguage::TypeScript => format_typescript(sql),
    }
}

/// Format SQL as Python raw triple-quoted string
fn format_python(sql: &str) -> String {
    format!("r\"\"\"\n{}\n\"\"\"", sql.trim())
}

/// Format SQL as TypeScript template literal
fn format_typescript(sql: &str) -> String {
    format!("`\n{}\n`", sql.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_from_str() {
        assert_eq!(
            CodeLanguage::from_str("python").unwrap(),
            CodeLanguage::Python
        );
        assert_eq!(CodeLanguage::from_str("py").unwrap(), CodeLanguage::Python);
        assert_eq!(
            CodeLanguage::from_str("typescript").unwrap(),
            CodeLanguage::TypeScript
        );
        assert_eq!(CodeLanguage::from_str("ts").unwrap(), CodeLanguage::TypeScript);
        assert!(CodeLanguage::from_str("java").is_err());
    }

    #[test]
    fn test_format_python() {
        let sql = "SELECT * FROM users\nWHERE id = 1";
        let result = format_python(sql);
        assert_eq!(result, "r\"\"\"\nSELECT * FROM users\nWHERE id = 1\n\"\"\"");
    }

    #[test]
    fn test_format_python_with_regex() {
        let sql = r"SELECT * FROM users WHERE email REGEXP '[a-z]+'";
        let result = format_python(sql);
        assert!(result.starts_with("r\"\"\""));
        assert!(result.contains(r"REGEXP '[a-z]+'"));
    }

    #[test]
    fn test_format_typescript() {
        let sql = "SELECT * FROM users\nWHERE id = 1";
        let result = format_typescript(sql);
        assert_eq!(result, "`\nSELECT * FROM users\nWHERE id = 1\n`");
    }

    #[test]
    fn test_format_as_code_python() {
        let sql = "SELECT 1";
        let result = format_as_code(sql, CodeLanguage::Python);
        assert_eq!(result, "r\"\"\"\nSELECT 1\n\"\"\"");
    }

    #[test]
    fn test_format_as_code_typescript() {
        let sql = "SELECT 1";
        let result = format_as_code(sql, CodeLanguage::TypeScript);
        assert_eq!(result, "`\nSELECT 1\n`");
    }

    #[test]
    fn test_format_python_multiline_complex() {
        let sql = r#"SELECT
    user_id,
    email,
    created_at
FROM users
WHERE email REGEXP '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    AND status = 'active'
ORDER BY created_at DESC"#;
        let result = format_python(sql);
        assert!(result.starts_with("r\"\"\""));
        assert!(result.ends_with("\"\"\""));
        assert!(result.contains("REGEXP"));
        assert!(result.contains("ORDER BY"));
        // Verify backslashes are preserved as-is in raw string
        assert!(result.contains(r"[a-zA-Z0-9._%+-]+"));
    }

    #[test]
    fn test_format_python_complex_regex_patterns() {
        // Test various regex special characters
        let sql = r"SELECT * FROM logs WHERE message REGEXP '\\d{4}-\\d{2}-\\d{2}\\s+\\w+'";
        let result = format_python(sql);
        assert!(result.contains(r"\\d{4}-\\d{2}-\\d{2}\\s+\\w+"));

        // Test with character classes and quantifiers
        let sql2 = r"SELECT * FROM data WHERE field REGEXP '[A-Z]{3,5}\-\d+'";
        let result2 = format_python(sql2);
        assert!(result2.contains(r"[A-Z]{3,5}\-\d+"));
    }

    #[test]
    fn test_format_typescript_multiline_complex() {
        let sql = r#"SELECT
    order_id,
    customer_email,
    total_amount
FROM orders
WHERE customer_email REGEXP '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    AND total_amount > 100
LIMIT 50"#;
        let result = format_typescript(sql);
        assert!(result.starts_with("`"));
        assert!(result.ends_with("`"));
        assert!(result.contains("REGEXP"));
        assert!(result.contains("LIMIT 50"));
    }

    #[test]
    fn test_format_preserves_indentation() {
        let sql = "SELECT *\n    FROM users\n        WHERE id = 1";
        let python_result = format_python(sql);
        let typescript_result = format_typescript(sql);

        // Both should preserve the indentation
        assert!(python_result.contains("    FROM users"));
        assert!(python_result.contains("        WHERE id = 1"));
        assert!(typescript_result.contains("    FROM users"));
        assert!(typescript_result.contains("        WHERE id = 1"));
    }

    #[test]
    fn test_format_python_with_quotes_and_backslashes() {
        // SQL with single quotes and backslashes
        let sql = r"SELECT * FROM data WHERE pattern REGEXP '\\b(foo|bar)\\b' AND name = 'test'";
        let result = format_python(sql);
        // Raw strings should preserve everything as-is
        assert!(result.contains(r"\\b(foo|bar)\\b"));
        assert!(result.contains("name = 'test'"));
    }
}
```

**Step 2: Run tests to verify implementation**

Run: `cargo test --package framework-cli format_query`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/framework-cli/src/cli/routines/format_query.rs
git commit -m "feat: implement SQL code formatting for Python and TypeScript"
```

---

## Task 3: Export Format Query Module

**Files:**

- Modify: `apps/framework-cli/src/cli/routines/mod.rs`

**Step 1: Add module declaration**

Find the module declarations and add alphabetically:

```rust
pub mod format_query;
```

**Step 2: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add apps/framework-cli/src/cli/routines/mod.rs
git commit -m "feat: export format_query module"
```

---

## Task 4: Update Query Routine to Handle Format Flag

**Files:**

- Modify: `apps/framework-cli/src/cli/routines/query.rs:79-84`

**Step 1: Update query function signature**

Add the `format_query` parameter to the `query` function signature:

```rust
pub async fn query(
    project: Arc<Project>,
    sql: Option<String>,
    file: Option<PathBuf>,
    limit: u64,
    format_query: Option<String>,
) -> Result<RoutineSuccess, RoutineFailure> {
```

**Step 2: Add early return for format-only path**

At the start of the function body, right after `get_sql_input`, add:

```rust
let sql_query = get_sql_input(sql, file)?;
info!("Executing SQL: {}", sql_query);

// If format_query flag is present, format and exit without executing
if let Some(lang_str) = format_query {
    use crate::cli::routines::format_query::{format_as_code, CodeLanguage};

    let language = CodeLanguage::from_str(&lang_str)?;
    let formatted = format_as_code(&sql_query, language);

    println!("{}", formatted);

    return Ok(RoutineSuccess::success(Message::new(
        "Format Query".to_string(),
        format!("Formatted as {} code", lang_str),
    )));
}

// Continue with existing execution logic...
```

**Step 3: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add apps/framework-cli/src/cli/routines/query.rs
git commit -m "feat: add format-only code path to query routine"
```

---

## Task 5: Add SQL Prettify Option

**Files:**
- Modify: `apps/framework-cli/src/cli/commands.rs:197-212`
- Modify: `apps/framework-cli/src/cli/routines/format_query.rs`

**Step 1: Add prettify flag to Query command**

In the `Query` variant of the `Commands` enum, add the prettify flag after `format_query`:

```rust
Query {
    /// SQL query to execute
    query: Option<String>,

    /// Read query from file
    #[arg(short = 'f', long = "file", conflicts_with = "query")]
    file: Option<PathBuf>,

    /// Maximum number of rows to return (applied via ClickHouse settings)
    #[arg(short, long, default_value = "10000")]
    limit: u64,

    /// Format query as code literal (python|typescript). Skips execution.
    #[arg(short = 'c', long = "format-query", value_name = "LANGUAGE")]
    format_query: Option<String>,

    /// Prettify SQL before formatting (only with --format-query)
    #[arg(short = 'p', long = "prettify", requires = "format_query")]
    prettify: bool,
},
```

**Step 2: Add prettify function to format_query module**

Add this function before the `format_as_code` function in `format_query.rs`:

```rust
/// Prettify SQL query with basic formatting.
///
/// Applies simple formatting rules:
/// - Capitalizes SQL keywords
/// - Adds line breaks after major clauses
/// - Indents nested content
///
/// # Arguments
///
/// * `sql` - The SQL query string to prettify
///
/// # Returns
///
/// Prettified SQL string
pub fn prettify_sql(sql: &str) -> String {
    let sql = sql.trim();

    // Major SQL keywords that should start new lines
    let major_keywords = [
        "SELECT", "FROM", "WHERE", "GROUP BY", "HAVING",
        "ORDER BY", "LIMIT", "OFFSET", "JOIN", "LEFT JOIN",
        "RIGHT JOIN", "INNER JOIN", "OUTER JOIN", "ON", "AND", "OR"
    ];

    let mut result = String::new();
    let mut current_line = String::new();
    let mut indent_level = 0;

    // Simple tokenization by whitespace
    let tokens: Vec<&str> = sql.split_whitespace().collect();
    let mut i = 0;

    while i < tokens.len() {
        let token = tokens[i];
        let upper_token = token.to_uppercase();

        // Check if this is a major keyword
        let is_major_keyword = major_keywords.iter().any(|&kw| {
            upper_token.starts_with(kw) ||
            (i + 1 < tokens.len() && format!("{} {}", upper_token, tokens[i + 1].to_uppercase()) == kw)
        });

        if is_major_keyword && !current_line.is_empty() {
            // Finish current line and start new one
            result.push_str(&current_line.trim_end());
            result.push('\n');
            current_line.clear();

            // Add indentation
            if upper_token != "SELECT" && upper_token != "FROM" {
                current_line.push_str("    ");
            }
        }

        // Add token to current line
        if !current_line.trim().is_empty() {
            current_line.push(' ');
        }
        current_line.push_str(token);

        i += 1;
    }

    // Add final line
    if !current_line.is_empty() {
        result.push_str(&current_line.trim_end());
    }

    result
}
```

**Step 3: Update format_as_code to accept prettify parameter**

Modify the `format_as_code` function signature and implementation:

```rust
/// Format SQL query as a code literal for the specified language.
///
/// # Arguments
///
/// * `sql` - The SQL query string to format
/// * `language` - Target language (Python or TypeScript)
/// * `prettify` - Whether to prettify SQL before formatting
///
/// # Returns
///
/// Formatted code literal as a string
pub fn format_as_code(sql: &str, language: CodeLanguage, prettify: bool) -> String {
    let sql_to_format = if prettify {
        prettify_sql(sql)
    } else {
        sql.to_string()
    };

    match language {
        CodeLanguage::Python => format_python(&sql_to_format),
        CodeLanguage::TypeScript => format_typescript(&sql_to_format),
    }
}
```

**Step 4: Add tests for prettify functionality**

Add these tests to the `tests` module in `format_query.rs`:

```rust
    #[test]
    fn test_prettify_sql_basic() {
        let sql = "SELECT id, name FROM users WHERE active = 1 ORDER BY name";
        let result = prettify_sql(sql);

        assert!(result.contains("SELECT"));
        assert!(result.contains("FROM"));
        assert!(result.contains("WHERE"));
        assert!(result.contains("ORDER BY"));
        // Should have line breaks
        assert!(result.contains('\n'));
    }

    #[test]
    fn test_prettify_sql_preserves_values() {
        let sql = "SELECT * FROM users WHERE email = 'test@example.com'";
        let result = prettify_sql(sql);

        // Should preserve the email value
        assert!(result.contains("test@example.com"));
    }

    #[test]
    fn test_format_as_code_with_prettify() {
        let sql = "SELECT id, name FROM users WHERE active = 1";

        // With prettify
        let result = format_as_code(sql, CodeLanguage::Python, true);
        assert!(result.starts_with("r\"\"\""));
        assert!(result.contains('\n'));
        assert!(result.contains("SELECT"));

        // Without prettify
        let result_no_prettify = format_as_code(sql, CodeLanguage::Python, false);
        assert!(result_no_prettify.starts_with("r\"\"\""));
        assert!(result_no_prettify.contains("SELECT id, name FROM users"));
    }

    #[test]
    fn test_prettify_with_complex_query() {
        let sql = "SELECT u.id, u.name, o.total FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.active = 1 AND o.total > 100 ORDER BY o.total DESC LIMIT 10";
        let result = prettify_sql(sql);

        assert!(result.contains("SELECT"));
        assert!(result.contains("FROM"));
        assert!(result.contains("LEFT JOIN"));
        assert!(result.contains("WHERE"));
        assert!(result.contains("ORDER BY"));
        assert!(result.contains("LIMIT"));
    }
```

**Step 5: Run tests**

Run: `cargo test --package framework-cli format_query`
Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/framework-cli/src/cli/commands.rs apps/framework-cli/src/cli/routines/format_query.rs
git commit -m "feat: add prettify option for SQL formatting"
```

---

## Task 6: Wire Prettify Parameter Through Query Routine and CLI Handler

**Files:**
- Modify: `apps/framework-cli/src/cli/routines/query.rs`
- Modify: `apps/framework-cli/src/cli.rs` (in the `Query` match arm)

**Step 1: Update query function signature to include prettify**

In `query.rs`, update the function signature:

```rust
pub async fn query(
    project: Arc<Project>,
    sql: Option<String>,
    file: Option<PathBuf>,
    limit: u64,
    format_query: Option<String>,
    prettify: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
```

**Step 2: Update format_as_code call to pass prettify parameter**

In the format-only code path (where `format_query` is Some), update the call:

```rust
// If format_query flag is present, format and exit without executing
if let Some(lang_str) = format_query {
    use crate::cli::routines::format_query::{format_as_code, CodeLanguage};

    let language = CodeLanguage::from_str(&lang_str)?;
    let formatted = format_as_code(&sql_query, language, prettify);

    println!("{}", formatted);

    return Ok(RoutineSuccess::success(Message::new(
        "Format Query".to_string(),
        format!("Formatted as {} code{}", lang_str, if prettify { " (prettified)" } else { "" }),
    )));
}
```

**Step 3: Update CLI handler to pass prettify parameter**

In `cli.rs`, update the `Commands::Query` match arm:

```rust
Commands::Query { query: sql, file, limit, format_query, prettify } => {
    info!("Running query command");

    let project = load_project(commands)?;
    let project_arc = Arc::new(project);

    let capture_handle = crate::utilities::capture::capture_usage(
        ActivityType::QueryCommand,
        Some(project_arc.name()),
        &settings,
        machine_id.clone(),
        HashMap::new(),
    );

    let result = query(project_arc, sql.clone(), file.clone(), *limit, format_query.clone(), *prettify).await;

    wait_for_usage_capture(capture_handle).await;

    result
}
```

**Step 4: Update existing tests to pass prettify parameter**

Update the existing `format_as_code` test calls to include `false` for prettify:

```rust
// In existing tests, change:
let result = format_as_code(sql, CodeLanguage::Python);
// To:
let result = format_as_code(sql, CodeLanguage::Python, false);
```

**Step 5: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 6: Commit**

```bash
git add apps/framework-cli/src/cli/routines/query.rs apps/framework-cli/src/cli.rs apps/framework-cli/src/cli/routines/format_query.rs
git commit -m "feat: wire prettify parameter through query routine and CLI"
```

---

## Task 7: Run Linting and Fix Warnings

**Files:**

- Various (as needed based on clippy output)

**Step 1: Run clippy**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: May have warnings about unused imports, etc.

**Step 2: Fix all warnings**

Address each warning that clippy reports.

**Step 3: Run clippy again**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: Zero warnings

**Step 4: Commit if changes made**

```bash
git add .
git commit -m "fix: address clippy warnings"
```

---

## Task 8: Manual Testing

**Files:**

- None (testing only)

**Step 1: Build CLI**

Run: `cargo build`
Expected: Successful build

**Step 2: Test Python formatting with argument**

Run: `./target/debug/moose-cli query -c python "SELECT * FROM users WHERE email REGEXP '[a-z]+'"`
Expected:

```
r"""
SELECT * FROM users WHERE email REGEXP '[a-z]+'
"""
```

**Step 3: Test TypeScript formatting with argument**

Run: `./target/debug/moose-cli query -c typescript "SELECT * FROM users"`
Expected:

```
`
SELECT * FROM users
`
```

**Step 4: Test with file input**

```bash
echo "SELECT count(*) FROM events" > /tmp/test.sql
./target/debug/moose-cli query -c python -f /tmp/test.sql
```

Expected:

```
r"""
SELECT count(*) FROM events
"""
```

**Step 5: Test with stdin**

Run: `echo "SELECT 1" | ./target/debug/moose-cli query -c typescript`
Expected:

```
`
SELECT 1
`
```

**Step 6: Test invalid language**

Run: `./target/debug/moose-cli query -c java "SELECT 1"`
Expected: Error message about unsupported language

**Step 6.5: Test multi-line SQL with complex regex**

Create a test file with complex SQL:
```bash
cat > /tmp/complex_query.sql << 'EOF'
SELECT
    user_id,
    email,
    created_at
FROM users
WHERE email REGEXP '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    AND status = 'active'
ORDER BY created_at DESC
LIMIT 100
EOF

./target/debug/moose-cli query -c python -f /tmp/complex_query.sql
```
Expected:
```
r"""
SELECT
    user_id,
    email,
    created_at
FROM users
WHERE email REGEXP '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    AND status = 'active'
ORDER BY created_at DESC
LIMIT 100
"""
```

Verify that:
- Indentation is preserved
- Regex pattern with backslashes is intact
- No extra escaping was added

**Step 6.6: Test TypeScript with complex pattern**

Run: `./target/debug/moose-cli query -c typescript "SELECT * FROM logs WHERE message REGEXP '\\d{4}-\\d{2}-\\d{2}'"`
Expected:
```
`
SELECT * FROM logs WHERE message REGEXP '\d{4}-\d{2}-\d{2}'
`
```

**Step 7: Test that normal execution still works**

```bash
# Start moose dev if not running
cd /tmp/test-query-cmd
../../target/debug/moose-cli dev --no-infra &
sleep 3

# Test normal query execution
../../target/debug/moose-cli query "SELECT 1 as num"
```

Expected: Normal JSON output (not formatted code)

**Step 7.5: Test prettify flag**

Test prettify with Python:
```bash
./target/debug/moose-cli query -c python -p "SELECT id, name FROM users WHERE active = 1 ORDER BY name"
```
Expected:
```
r"""
SELECT id, name
FROM users
    WHERE active = 1
    ORDER BY name
"""
```

Test prettify with TypeScript:
```bash
./target/debug/moose-cli query -c typescript -p "SELECT id, email FROM users WHERE status = 'active' AND created_at > '2024-01-01'"
```
Expected:
```
`
SELECT id, email
FROM users
    WHERE status = 'active'
    AND created_at > '2024-01-01'
`
```

Verify that:
- SQL keywords are on separate lines
- Clauses are indented
- Values and strings are preserved

**Step 8: Document test results**

No commit needed - verify all tests pass.

---

## Task 9: Add End-to-End Tests

**Files:**

- Modify: `apps/framework-cli-e2e/tests/cli_query.test.ts`

**Step 1: Add format query tests to existing test file**

Add these test cases to the existing `cli_query.test.ts` file (after the existing tests):

```typescript
  describe('format query flag', () => {
    it('should format query as Python code', () => {
      const result = execSync(
        `${mooseBin} query -c python "SELECT * FROM users WHERE email REGEXP '[a-z]+'"`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(result).toContain('r"""');
      expect(result).toContain("SELECT * FROM users WHERE email REGEXP '[a-z]+'");
      expect(result).toContain('"""');
      expect(result).not.toContain('{'); // Should not have JSON output
    });

    it('should format query as TypeScript code', () => {
      const result = execSync(
        `${mooseBin} query -c typescript "SELECT * FROM users"`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(result).toContain('`');
      expect(result).toContain('SELECT * FROM users');
      expect(result).not.toContain('{'); // Should not have JSON output
    });

    it('should format query from file', () => {
      const queryFile = path.join(testDir, 'format-test.sql');
      fs.writeFileSync(queryFile, 'SELECT count(*) as total FROM events');

      const result = execSync(
        `${mooseBin} query -c python -f format-test.sql`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(result).toContain('r"""');
      expect(result).toContain('SELECT count(*) as total FROM events');
    });

    it('should reject invalid language', () => {
      expect(() => {
        execSync(`${mooseBin} query -c java "SELECT 1"`, {
          cwd: testDir,
        });
      }).toThrow();
    });

    it('should accept language aliases', () => {
      const pyResult = execSync(`${mooseBin} query -c py "SELECT 1"`, {
        cwd: testDir,
        encoding: 'utf-8',
      });
      expect(pyResult).toContain('r"""');

      const tsResult = execSync(`${mooseBin} query -c ts "SELECT 1"`, {
        cwd: testDir,
        encoding: 'utf-8',
      });
      expect(tsResult).toContain('`');
    });

    it('should format multi-line SQL with proper indentation', () => {
      const queryFile = path.join(testDir, 'multiline-query.sql');
      const multilineSQL = `SELECT
    user_id,
    email,
    created_at
FROM users
WHERE status = 'active'
ORDER BY created_at DESC`;
      fs.writeFileSync(queryFile, multilineSQL);

      const result = execSync(
        `${mooseBin} query -c python -f multiline-query.sql`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(result).toContain('r"""');
      expect(result).toContain('    user_id,');
      expect(result).toContain('ORDER BY created_at DESC');
      expect(result).toContain('"""');
    });

    it('should format SQL with complex regex patterns', () => {
      const complexQuery = `SELECT * FROM logs WHERE message REGEXP '\\\\d{4}-\\\\d{2}-\\\\d{2}\\\\s+\\\\w+'`;

      const result = execSync(
        `${mooseBin} query -c python "${complexQuery}"`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(result).toContain('r"""');
      // Raw strings should preserve backslashes
      expect(result).toContain('\\\\d{4}');
      expect(result).toContain('REGEXP');
    });

    it('should format SQL with email regex pattern', () => {
      const emailQuery = `SELECT * FROM users WHERE email REGEXP '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$'`;

      const pyResult = execSync(
        `${mooseBin} query -c python "${emailQuery}"`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(pyResult).toContain('r"""');
      expect(pyResult).toContain('[a-zA-Z0-9._%+-]+');

      const tsResult = execSync(
        `${mooseBin} query -c typescript "${emailQuery}"`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(tsResult).toContain('`');
      expect(tsResult).toContain('[a-zA-Z0-9._%+-]+');
    });

    it('should handle queries with single quotes and backslashes', () => {
      const queryFile = path.join(testDir, 'complex-pattern.sql');
      const complexSQL = `SELECT * FROM data WHERE pattern REGEXP '\\\\b(foo|bar)\\\\b' AND name = 'test'`;
      fs.writeFileSync(queryFile, complexSQL);

      const result = execSync(
        `${mooseBin} query -c python -f complex-pattern.sql`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(result).toContain('r"""');
      expect(result).toContain("name = 'test'");
      expect(result).toContain('\\\\b(foo|bar)\\\\b');
    });

    it('should prettify SQL when --prettify flag is used', () => {
      const messyQuery = "SELECT id, name FROM users WHERE active = 1 ORDER BY name LIMIT 10";

      const result = execSync(
        `${mooseBin} query -c python -p "${messyQuery}"`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(result).toContain('r"""');
      expect(result).toContain('SELECT');
      expect(result).toContain('FROM');
      expect(result).toContain('WHERE');
      expect(result).toContain('ORDER BY');
      // Should have line breaks (prettified)
      const lines = result.split('\\n');
      expect(lines.length).toBeGreaterThan(3);
    });

    it('should prettify complex SQL with TypeScript', () => {
      const complexQuery = "SELECT u.id, u.name, o.total FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.active = 1 AND o.total > 100 ORDER BY o.total DESC";

      const result = execSync(
        `${mooseBin} query -c typescript -p "${complexQuery}"`,
        { cwd: testDir, encoding: 'utf-8' }
      );

      expect(result).toContain('`');
      expect(result).toContain('SELECT');
      expect(result).toContain('LEFT JOIN');
      expect(result).toContain('WHERE');
      expect(result).toContain('ORDER BY');
    });

    it('should require format-query flag when using prettify', () => {
      // Prettify without format-query should fail
      expect(() => {
        execSync(`${mooseBin} query -p "SELECT 1"`, {
          cwd: testDir,
        });
      }).toThrow();
    });
  });
```

**Step 2: Run E2E tests**

Run: `cd apps/framework-cli-e2e && pnpm test -- cli_query.test.ts`
Expected: All tests pass (including new format query tests)

**Step 3: Commit**

```bash
git add apps/framework-cli-e2e/tests/cli_query.test.ts
git commit -m "test: add E2E tests for query format flag"
```

---

## Task 10: Update Documentation

**Files:**

- Modify: Documentation for query command (find appropriate docs file)

**Step 1: Find documentation file**

Run: `find apps/framework-docs -name "*.mdx" -o -name "*.md" | xargs grep -l "moose query"`
Expected: Path to CLI documentation file

**Step 2: Add format-query documentation**

Add this section to the query command documentation:

```markdown
#### Formatting Queries for Code

Use the `-c/--format-query` flag to format SQL queries as code literals instead of executing them:

```bash
# Format as Python (raw string)
moose query -c python "SELECT * FROM users WHERE email REGEXP '[a-z]+'"
# Output:
# r"""
# SELECT * FROM users WHERE email REGEXP '[a-z]+'
# """

# Format as TypeScript (template literal)
moose query -c typescript "SELECT * FROM events"
# Output:
# `
# SELECT * FROM events
# `

# Works with file input
moose query -c python -f my_query.sql

# Prettify SQL before formatting (adds line breaks and indentation)
moose query -c python -p "SELECT id, name FROM users WHERE active = 1 ORDER BY name"
# Output:
# r"""
# SELECT id, name
# FROM users
#     WHERE active = 1
#     ORDER BY name
# """

# Supported languages: python (py), typescript (ts)
# Prettify flag: -p, --prettify (only works with --format-query)
```

**Use case:** Iterate on SQL queries in the CLI, then format and paste into your application code without manual escaping. Use `--prettify` to clean up messy one-line queries.

```

**Step 3: Commit**

```bash
git add apps/framework-docs/
git commit -m "docs: add format-query flag documentation"
```

---

## Task 11: Final Verification

**Files:**

- None (verification only)

**Step 1: Run full Rust test suite**

Run: `cargo test`
Expected: All tests pass

**Step 2: Run full E2E test suite**

Run: `cd apps/framework-cli-e2e && pnpm test`
Expected: All tests pass

**Step 3: Run full build**

Run: `pnpm build`
Expected: Successful build

**Step 4: Final smoke tests**

Test all three input methods with both languages:

```bash
# Argument + Python
./target/debug/moose-cli query -c python "SELECT 1"

# File + TypeScript
echo "SELECT 2" > /tmp/test.sql
./target/debug/moose-cli query -c typescript -f /tmp/test.sql

# Stdin + Python
echo "SELECT 3" | ./target/debug/moose-cli query -c python
```

Expected: All produce correctly formatted output

**Step 5: Verify normal query still works**

Run: `cd /tmp/test-query-cmd && ../../target/debug/moose-cli query "SELECT 1"`
Expected: JSON output (normal execution)

---

## Success Criteria Verification

✅ `-c python` formats SQL as Python raw triple-quoted string
✅ `-c typescript` formats SQL as TypeScript template literal
✅ Works with all input methods (argument, file, stdin)
✅ Skips query execution when format flag is present
✅ Preserves exact SQL formatting by default (no modification)
✅ `-p/--prettify` flag formats SQL with proper indentation and line breaks
✅ Prettify requires format-query flag (enforced by clap)
✅ Handles multi-line SQL and complex regex patterns correctly
✅ Proper error handling for invalid languages
✅ All tests pass (unit + E2E + prettify tests)
✅ Documentation updated with prettify examples
✅ Zero clippy warnings

## Additional Notes

- Format-only path exits early, avoiding need for `moose dev` to be running
- Raw strings in Python handle regex patterns without escaping
- Template literals in TypeScript handle most special characters naturally
- Aliases supported: `py` for Python, `ts` for TypeScript
- Output is just the literal - user assigns to their own variable name
- Prettify uses simple keyword-based formatting (SELECT, FROM, WHERE, etc. on separate lines)
- Prettify is optional - without `-p`, exact formatting is preserved
