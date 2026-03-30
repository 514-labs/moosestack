---
name: 514-debug
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
description: >
  Use when debugging a 514 deployment — checking status, tailing logs,
  finding slow queries, inspecting resources, and running diagnostic
  ClickHouse queries.
---

# 514 Deployment Debugging

Diagnose issues in a 514/Moose deployment using the CLI's observability commands. The sections below are independent — jump to whichever is relevant.

Command shape: `514 <resource> <action> [args] [flags]`

All commands accept `--json` for machine-readable output.

---

## 1. Deployment Status

Check whether the deployment is healthy.

List deployments:
```
514 deployment list --project <ORG/PROJECT> --json
```

Filter by status:
```
514 deployment list --project <ORG/PROJECT> --status <STATUS> --json
```
`--status` is repeatable — pass it multiple times to include several statuses.

Narrow to a specific branch:
```
514 deployment list --project <ORG/PROJECT> --branch-id <BRANCH_ID> --json
```

### Common statuses

| Status | Meaning |
|--------|---------|
| `active` | Running and serving traffic |
| `building` | Build in progress — not yet live |
| `failed` | Build or deploy error — check logs |
| `stopped` | Manually stopped or scaled to zero |

When running inside a linked repo, `--project` can be omitted.

---

## 2. Logs

Find errors and trace application behavior.

Query logs:
```
514 logs query --project <ORG/PROJECT> --json
```

### Key flags

| Flag | Purpose | Example |
|------|---------|---------|
| `--severity` | Filter by severity (repeatable) | `--severity ERROR --severity FATAL` |
| `--search` | Full-text search | `--search "connection refused"` |
| `--start` / `--end` | Time range (ISO 8601 or relative) | `--start 2h` (2 hours ago) |
| `--watch` | Live tail — streams new logs | `--watch` |
| `--branch` | Logs from a specific branch | `--branch feature/foo` |
| `--sort-by` | Sort field | `--sort-by timestamp` |
| `--sort-dir` | Sort direction | `--sort-dir desc` |
| `--limit` | Max results | `--limit 50` |
| `--offset` | Pagination offset | `--offset 100` |

Default time range is the last 1 hour.

### Common patterns

Errors in the last hour:
```
514 logs query --project <ORG/PROJECT> --severity ERROR --severity FATAL --json
```

Search for a specific message:
```
514 logs query --project <ORG/PROJECT> --search "timeout" --start 6h --json
```

Live tail on a branch:
```
514 logs query --project <ORG/PROJECT> --branch feature/foo --watch
```

---

## 3. Query Metrics

Find slow or expensive queries.

```
514 metrics query --project <ORG/PROJECT> --json
```

### Key flags

| Flag | Purpose | Example |
|------|---------|---------|
| `--duration-min` | Minimum duration (ms) | `--duration-min 500` |
| `--kind` | Query type (repeatable) | `--kind Select --kind Insert` |
| `--sort-by` | Sort field | `--sort-by query_duration_ms` |
| `--sort-dir` | Sort direction | `--sort-dir desc` |
| `--memory-min` | Minimum memory usage (bytes) | `--memory-min 1000000` |
| `--rows-read-min` | Minimum rows read | `--rows-read-min 1000000` |
| `--search` | Match query text | `--search "JOIN"` |
| `--start` / `--end` | Time range | `--start 24h` |
| `--limit` | Max results | `--limit 20` |

Default time range is the last 24 hours.

### Common patterns

Top 10 slowest queries:
```
514 metrics query --project <ORG/PROJECT> --sort-by query_duration_ms --sort-dir desc --limit 10 --json
```

Slow SELECTs over 1 second:
```
514 metrics query --project <ORG/PROJECT> --kind Select --duration-min 1000 --sort-by query_duration_ms --sort-dir desc --json
```

Memory-heavy queries:
```
514 metrics query --project <ORG/PROJECT> --sort-by memory_usage --sort-dir desc --limit 10 --json
```

---

## 4. Resource Inspection

Verify what's actually deployed. Each command lists resources of a given type.

### Resource listing commands

| Resource | Command |
|----------|---------|
| Tables | `514 agent table list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| Materialized views | `514 agent materialized-view list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| Views | `514 agent view list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| Streams | `514 agent stream list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| Functions | `514 agent function list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| API endpoints | `514 agent api-endpoint list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| SQL resources | `514 agent sql-resource list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| Workflows | `514 agent workflow list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| Web apps | `514 agent web-app list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| Stream→table syncs | `514 agent stream-to-table-sync list [DEPLOY_ID] --project <ORG/PROJECT> --json` |
| Stream→stream syncs | `514 agent stream-to-stream-sync list [DEPLOY_ID] --project <ORG/PROJECT> --json` |

`[DEPLOY_ID]` is optional — when omitted, the CLI auto-detects the deployment from the current branch.

Use these to confirm that expected tables, views, or endpoints exist and match what's in the codebase.

---

## 5. Diagnostic ClickHouse Queries

Run ad-hoc SQL against the deployment's ClickHouse instance.

```
514 clickhouse query '<SQL>' --project <ORG/PROJECT> --json
```

Also supports:
- `--file <FILE>` — run SQL from a file
- `--branch <BRANCH>` — target a specific branch deployment

### Useful diagnostic queries

**Table sizes and part counts:**
```
514 clickhouse query 'SELECT database, table, partition, sum(rows) AS total_rows, formatReadableSize(sum(bytes_on_disk)) AS disk_size, count() AS part_count FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') GROUP BY database, table, partition ORDER BY sum(bytes_on_disk) DESC LIMIT 20' --project <ORG/PROJECT> --json
```

**Currently running queries:**
```
514 clickhouse query 'SELECT query_id, user, elapsed, query FROM system.processes ORDER BY elapsed DESC' --project <ORG/PROJECT> --json
```

**Recent query errors:**
```
514 clickhouse query 'SELECT event_time, query, exception FROM system.query_log WHERE exception != '\'''\'' ORDER BY event_time DESC LIMIT 20' --project <ORG/PROJECT> --json
```

---

## Quick reference

| What | Command |
|------|---------|
| List deployments | `514 deployment list --project <ORG/PROJECT> --json` |
| Filter by status | `514 deployment list --status <STATUS> --json` |
| Query logs | `514 logs query --project <ORG/PROJECT> --json` |
| Error logs | `514 logs query --severity ERROR --severity FATAL --json` |
| Search logs | `514 logs query --search <TEXT> --json` |
| Live tail | `514 logs query --watch` |
| Slow queries | `514 metrics query --sort-by query_duration_ms --sort-dir desc --json` |
| List tables | `514 agent table list --project <ORG/PROJECT> --json` |
| List all resources | `514 agent <TYPE> list --json` |
| Run SQL | `514 clickhouse query '<SQL>' --project <ORG/PROJECT> --json` |
