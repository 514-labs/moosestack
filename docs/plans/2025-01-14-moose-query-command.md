# Moose Query Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the core `moose query` command that executes arbitrary SQL against ClickHouse and returns raw results.

**Architecture:** Model after `moose peek` patterns - reuse connection pooling, JSON serialization, and error handling. Execute raw SQL provided by user without modification. Support input from argument, file, or stdin. Apply limit via ClickHouse client settings to avoid breaking user queries.

**Tech Stack:** Rust, ClickHouse native client (clickhouse-rs), existing moose infrastructure (peek patterns)

---

## Task 1: Add Query Command Definition

**Files:**
- Modify: `apps/framework-cli/src/cli/commands.rs:196` (after Kafka command)

**Step 1: Add Query command to Commands enum**

Add this new variant to the `Commands` enum after the `Kafka` variant (around line 196):

```rust
/// Execute SQL queries against ClickHouse
Query {
    /// SQL query to execute
    query: Option<String>,

    /// Read query from file
    #[arg(short = 'f', long = "file", conflicts_with = "query")]
    file: Option<PathBuf>,

    /// Maximum number of rows to return (applied via ClickHouse settings)
    #[arg(short, long, default_value = "10000")]
    limit: u64,
},
```

**Step 2: Verify it compiles**

Run: `cargo check`
Expected: Compilation errors about unhandled Query variant in cli.rs - this is expected, we'll fix it next

**Step 3: Commit**

```bash
git add apps/framework-cli/src/cli/commands.rs
git commit -m "feat: add Query command definition to CLI"
```

---

## Task 2: Create Query Routine Module

**Files:**
- Create: `apps/framework-cli/src/cli/routines/query.rs`

**Step 1: Create query routine skeleton**

Create new file with imports and basic structure:

```rust
//! Module for executing arbitrary SQL queries against ClickHouse.
//!
//! This module provides functionality to execute raw SQL queries and return
//! results as JSON for debugging and exploration purposes.

use crate::cli::display::Message;
use crate::cli::routines::{setup_redis_client, RoutineFailure, RoutineSuccess};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse_alt_client::get_pool;
use crate::project::Project;

use clickhouse_rs::types::Options;
use futures::StreamExt;
use log::info;
use serde_json::Value;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;

/// Executes a SQL query against ClickHouse and displays results as JSON.
///
/// Allows users to run arbitrary SQL queries against the ClickHouse database
/// for exploration and debugging. Results are streamed as JSON to stdout.
///
/// # Arguments
///
/// * `project` - The project configuration to use
/// * `sql` - Optional SQL query string
/// * `file` - Optional file path containing SQL query
/// * `limit` - Maximum number of rows to return (via ClickHouse settings)
///
/// # Returns
///
/// * `Result<RoutineSuccess, RoutineFailure>` - Success or failure of the operation
pub async fn query(
    project: Arc<Project>,
    sql: Option<String>,
    file: Option<PathBuf>,
    limit: u64,
) -> Result<RoutineSuccess, RoutineFailure> {
    // Implementation in next steps
    todo!()
}
```

**Step 2: Verify skeleton compiles**

Run: `cargo check`
Expected: Compiles successfully (with warnings about unused imports)

**Step 3: Commit**

```bash
git add apps/framework-cli/src/cli/routines/query.rs
git commit -m "feat: add query routine skeleton"
```

---

## Task 3: Export Query Module

**Files:**
- Modify: `apps/framework-cli/src/cli/routines/mod.rs`

**Step 1: Add query module export**

Find the module declarations in `mod.rs` and add:

```rust
pub mod query;
```

Add it alphabetically with the other module declarations.

**Step 2: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add apps/framework-cli/src/cli/routines/mod.rs
git commit -m "feat: export query module"
```

---

## Task 4: Wire Query Command Handler

**Files:**
- Modify: `apps/framework-cli/src/cli.rs` (in `top_command_handler` function)

**Step 1: Add use statement for query routine**

At the top of the file, add to the imports from `routines`:

```rust
use routines::query::query;
```

**Step 2: Add Query handler in top_command_handler**

Add this handler after the `Kafka` match arm (around line 1360):

```rust
Commands::Query { query: sql, file, limit } => {
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

    let result = query(project_arc, sql.clone(), file.clone(), *limit).await;

    wait_for_usage_capture(capture_handle).await;

    result
}
```

**Step 3: Add ActivityType::QueryCommand**

Note: This step requires adding `QueryCommand` to the `ActivityType` enum in `apps/framework-cli/src/utilities/capture.rs`. Add it alphabetically to the enum.

**Step 4: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 5: Commit**

```bash
git add apps/framework-cli/src/cli.rs apps/framework-cli/src/utilities/capture.rs
git commit -m "feat: wire query command handler"
```

---

## Task 5: Implement SQL Input Reading

**Files:**
- Modify: `apps/framework-cli/src/cli/routines/query.rs`

**Step 1: Implement get_sql_input helper function**

Add this helper function before the `query` function:

```rust
/// Reads SQL query from argument, file, or stdin.
///
/// # Arguments
///
/// * `sql` - Optional SQL query string from command line
/// * `file` - Optional file path containing SQL query
///
/// # Returns
///
/// * `Result<String, RoutineFailure>` - SQL query string or error
fn get_sql_input(
    sql: Option<String>,
    file: Option<PathBuf>,
) -> Result<String, RoutineFailure> {
    if let Some(query_str) = sql {
        // SQL provided as argument
        Ok(query_str)
    } else if let Some(file_path) = file {
        // Read SQL from file
        std::fs::read_to_string(&file_path).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Query".to_string(),
                    format!("Failed to read file: {}", file_path.display()),
                ),
                e,
            )
        })
    } else {
        // Read SQL from stdin
        let mut buffer = String::new();
        std::io::stdin().read_to_string(&mut buffer).map_err(|e| {
            RoutineFailure::new(
                Message::new("Query".to_string(), "Failed to read from stdin".to_string()),
                e,
            )
        })?;

        if buffer.trim().is_empty() {
            return Err(RoutineFailure::error(Message::new(
                "Query".to_string(),
                "No SQL query provided (use argument, --file, or stdin)".to_string(),
            )));
        }

        Ok(buffer)
    }
}
```

**Step 2: Update query function to use get_sql_input**

Replace the `todo!()` in the `query` function with:

```rust
let sql_query = get_sql_input(sql, file)?;
info!("Executing SQL: {}", sql_query);

// More implementation in next task
todo!()
```

**Step 3: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add apps/framework-cli/src/cli/routines/query.rs
git commit -m "feat: implement SQL input reading from arg/file/stdin"
```

---

## Task 6: Implement ClickHouse Connection and Query Execution

**Files:**
- Modify: `apps/framework-cli/src/cli/routines/query.rs`

**Step 1: Implement connection setup (following peek pattern)**

Replace the `todo!()` in the `query` function with:

```rust
// Get ClickHouse connection pool
// TODO: Apply max_result_rows setting to limit results without modifying user's SQL
let pool = get_pool(&project.clickhouse_config);

let mut client = pool.get_handle().await.map_err(|_| {
    RoutineFailure::error(Message::new(
        "Failed".to_string(),
        "Error connecting to storage".to_string(),
    ))
})?;

let redis_client = setup_redis_client(project.clone()).await.map_err(|e| {
    RoutineFailure::error(Message {
        action: "Query".to_string(),
        details: format!("Failed to setup redis client: {e:?}"),
    })
})?;

let _infra = InfrastructureMap::load_from_redis(&redis_client)
    .await
    .map_err(|_| {
        RoutineFailure::error(Message::new(
            "Failed".to_string(),
            "Error retrieving current state".to_string(),
        ))
    })?
    .ok_or_else(|| {
        RoutineFailure::error(Message::new(
            "Failed".to_string(),
            "No state found".to_string(),
        ))
    })?;

// More implementation in next step
todo!()
```

**Step 2: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add apps/framework-cli/src/cli/routines/query.rs
git commit -m "feat: implement ClickHouse connection setup with moose dev check"
```

---

## Task 7: Implement Query Execution and Result Streaming

**Files:**
- Modify: `apps/framework-cli/src/cli/routines/query.rs`
- Modify: `apps/framework-cli/src/infrastructure/olap/clickhouse_alt_client.rs`

**Step 1: Make row_to_json public in clickhouse_alt_client**

In `clickhouse_alt_client.rs`, find the `row_to_json` function (around line 204) and change its visibility from private to public:

```rust
// Change from:
fn row_to_json<C>(
    row: &Row<'_, C>,
    enum_mappings: &[Option<Vec<&str>>],
) -> Result<Value, clickhouse_rs::errors::Error>

// To:
pub fn row_to_json<C>(
    row: &Row<'_, C>,
    enum_mappings: &[Option<Vec<&str>>],
) -> Result<Value, clickhouse_rs::errors::Error>
```

**Step 2: Import row_to_json in query.rs**

Add to imports at top of `query.rs`:

```rust
use crate::infrastructure::olap::clickhouse_alt_client::row_to_json;
use clickhouse_rs::types::ColumnType;
```

**Step 3: Implement query execution and streaming**

Replace the final `todo!()` with:

```rust
// Execute query and stream results
// Create empty enum mappings (we don't need enum handling for raw SQL)
let enum_mappings: Vec<Option<Vec<&str>>> = vec![];

let mut stream = client.query(&sql_query).stream();

let mut success_count = 0;

while let Some(row_result) = stream.next().await {
    match row_result {
        Ok(row) => {
            // Reuse peek's row_to_json with empty enum mappings
            let value = row_to_json(&row, &enum_mappings).map_err(|e| {
                RoutineFailure::new(
                    Message::new("Query".to_string(), "Failed to convert row to JSON".to_string()),
                    e,
                )
            })?;

            let json = serde_json::to_string(&value).map_err(|e| {
                RoutineFailure::new(
                    Message::new("Query".to_string(), "Failed to serialize result".to_string()),
                    e,
                )
            })?;

            println!("{}", json);
            info!("{}", json);
            success_count += 1;

            // Check limit to avoid unbounded queries
            if success_count >= limit {
                info!("Reached limit of {} rows", limit);
                break;
            }
        }
        Err(e) => {
            return Err(RoutineFailure::new(
                Message::new(
                    "Query".to_string(),
                    "ClickHouse query error".to_string(),
                ),
                e,
            ));
        }
    }
}

// Add newline for output cleanliness (like peek does)
println!();

Ok(RoutineSuccess::success(Message::new(
    "Query".to_string(),
    format!("{} rows", success_count),
)))
```

**Step 4: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 5: Commit**

```bash
git add apps/framework-cli/src/cli/routines/query.rs apps/framework-cli/src/infrastructure/olap/clickhouse_alt_client.rs
git commit -m "feat: implement query execution reusing peek's row_to_json"
```

---

## Task 8: Manual Testing

**Files:**
- None (testing only)

**Step 1: Build the CLI**

Run: `cargo build`
Expected: Builds successfully

**Step 2: Start moose dev in test project**

If you don't have a test project:
```bash
cd /tmp
./target/debug/moose-cli init test-query typescript-empty
cd test-query
./target/debug/moose-cli dev
```

In another terminal, test the query command.

**Step 3: Test basic query**

Run: `./target/debug/moose-cli query "SELECT 1 as num"`
Expected: JSON output with one row: `{"num":1}`

**Step 4: Test query with multiple rows**

Run: `./target/debug/moose-cli query "SELECT number FROM system.numbers LIMIT 5"`
Expected: 5 rows of JSON output

**Step 5: Test file input**

```bash
echo "SELECT 'hello' as greeting" > /tmp/test.sql
./target/debug/moose-cli query -f /tmp/test.sql
```
Expected: JSON output with `{"greeting":"hello"}`

**Step 6: Test stdin input**

Run: `echo "SELECT 2+2 as result" | ./target/debug/moose-cli query`
Expected: JSON output with `{"result":4}`

**Step 7: Test error handling (without moose dev running)**

Stop moose dev, then run:
```bash
./target/debug/moose-cli query "SELECT 1"
```
Expected: Error message suggesting to run `moose dev`

**Step 8: Document test results**

No commit needed - just verify everything works.

---

## Task 9: Add End-to-End Test

**Files:**
- Modify: `apps/framework-cli-e2e/tests/cli_query.test.ts` (create new file)

**Step 1: Create E2E test file**

Create new file `apps/framework-cli-e2e/tests/cli_query.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

describe('moose query command', () => {
  const testDir = path.join(__dirname, '../../tmp/query-test');
  const mooseBin = path.join(__dirname, '../../target/debug/moose-cli');

  beforeAll(() => {
    // Setup test project
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    execSync(`${mooseBin} init query-test typescript-empty`, {
      cwd: path.join(__dirname, '../../tmp'),
    });

    // Start moose dev in background
    execSync(`${mooseBin} dev --no-infra &`, { cwd: testDir });

    // Wait for dev to be ready
    execSync('sleep 5');
  });

  afterAll(() => {
    // Cleanup
    execSync(`pkill -f "moose.*dev"`);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should execute simple SELECT query', () => {
    const result = execSync(`${mooseBin} query "SELECT 1 as num"`, {
      cwd: testDir,
      encoding: 'utf-8',
    });

    expect(result).toContain('{"num":1}');
    expect(result).toContain('1 rows');
  });

  it('should execute query from file', () => {
    const queryFile = path.join(testDir, 'test-query.sql');
    fs.writeFileSync(queryFile, 'SELECT 42 as answer');

    const result = execSync(`${mooseBin} query -f test-query.sql`, {
      cwd: testDir,
      encoding: 'utf-8',
    });

    expect(result).toContain('{"answer":42}');
  });

  it('should respect limit parameter', () => {
    const result = execSync(
      `${mooseBin} query "SELECT number FROM system.numbers" --limit 3`,
      { cwd: testDir, encoding: 'utf-8' }
    );

    const lines = result.trim().split('\n').filter(l => l.startsWith('{'));
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it('should handle query errors gracefully', () => {
    expect(() => {
      execSync(`${mooseBin} query "SELECT * FROM nonexistent_table"`, {
        cwd: testDir,
      });
    }).toThrow();
  });
});
```

**Step 2: Run E2E tests**

Run: `cd apps/framework-cli-e2e && pnpm test -- cli_query.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/framework-cli-e2e/tests/cli_query.test.ts
git commit -m "test: add end-to-end tests for query command"
```

---

## Task 10: Run Rust Linting and Fix Warnings

**Files:**
- Modify: Various Rust files as needed

**Step 1: Run clippy**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: May have warnings about unused imports, formatting, etc.

**Step 2: Fix all clippy warnings**

Address each warning:
- Remove unused imports
- Fix formatting issues
- Address any other suggestions

**Step 3: Run clippy again**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: Zero warnings

**Step 4: Commit**

```bash
git add .
git commit -m "fix: address clippy warnings in query implementation"
```

---

## Task 11: Update Documentation

**Files:**
- Modify: `apps/framework-docs/src/pages/moose/moose-cli.mdx` or equivalent docs

**Step 1: Add query command documentation**

Add section to CLI docs:

```markdown
### moose query

Execute SQL queries against your ClickHouse database during development.

**Usage:**
```bash
# Direct query
moose query "SELECT count(*) FROM users"

# From file
moose query -f queries/analysis.sql

# From stdin
cat query.sql | moose query

# With limit
moose query "SELECT * FROM events" --limit 100
```

**Options:**
- `query` - SQL query string to execute
- `-f, --file <PATH>` - Read query from file
- `-l, --limit <NUM>` - Maximum rows to return (default: 10000)

**Requirements:**
- Requires `moose dev` to be running
- Executes queries against your development ClickHouse instance

**Output:**
- Returns results as newline-delimited JSON
- One JSON object per row
- Row count summary at end
```

**Step 2: Commit**

```bash
git add apps/framework-docs/
git commit -m "docs: add moose query command documentation"
```

---

## Task 12: Final Verification

**Files:**
- None (verification only)

**Step 1: Run full Rust test suite**

Run: `cargo test`
Expected: All tests pass

**Step 2: Run E2E tests**

Run: `cd apps/framework-cli-e2e && pnpm test`
Expected: All tests pass (including new query tests)

**Step 3: Run full build**

Run: `pnpm build`
Expected: Successful build

**Step 4: Manual smoke test**

Test all three input methods (arg, file, stdin) one more time with the built binary.

**Step 5: Final commit if any fixes needed**

```bash
git add .
git commit -m "chore: final verification and cleanup"
```

---

## Success Criteria Verification

✅ `moose query "SELECT 1"` works and returns usable results
✅ Proper error propagation from ClickHouse
✅ Follows existing patterns (peek) for consistency
✅ Supports file and stdin input
✅ All tests pass
✅ Documentation updated

## Additional Notes

- The implementation reuses `get_pool()`, connection patterns, and error handling from `moose peek`
- Limit is applied by checking row count in the stream rather than modifying SQL
- JSON output format matches peek for consistency
- Error messages guide users to check if `moose dev` is running
- The command assumes moose dev is running but doesn't require it directly - connection errors provide helpful hints
