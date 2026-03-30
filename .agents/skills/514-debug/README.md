# 514-debug

A **workflow skill** that guides agents through debugging 514 deployment issues — checking status, tailing logs, finding slow queries, inspecting resources, and running diagnostic ClickHouse queries.

## What it covers

| Section | Commands |
|---------|----------|
| **Deployment status** | `514 deployment list` with status and branch filters |
| **Logs** | `514 logs query` with severity, search, time range, watch |
| **Query metrics** | `514 metrics query` with duration, kind, memory, rows filters |
| **Resource inspection** | `514 agent <type> list` for tables, views, streams, functions, etc. |
| **Diagnostic queries** | `514 clickhouse query` for ad-hoc SQL (table sizes, running queries, errors) |

## Editing

This is a workflow skill — all logic lives in `SKILL.md`. To make changes, edit that file directly. There is no build step.

## Extending

When new observability commands are added to the 514 CLI:

1. Determine which section the command belongs to (or add a new section)
2. Add the command with its flags and usage pattern
3. Update the quick reference table at the bottom of SKILL.md
4. Update the section table in this README
