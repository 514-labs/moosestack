# Moose Logging - P0 Filters

## Document Purpose

This document defines the Priority 0 filters for Moose logging. These filters are essential for the initial implementation and will be exposed in the UI for users to query logs.

---

## P0 Filters

| Filter | Field Name | Type | Values | Optional | Description |
|--------|-----------|------|--------|----------|-------------|
| **Context** | `context` | enum | `runtime`, `deploy`, `system` | No | Execution context of the log |
| **Resource Type** | `resource_type` | enum | `ingest_api`, `consumption_api`, `ingest_pipeline`, `stream`, `olap_table`, `materialized_view`, `transform`, `consumer`, `workflow`, `task` | Yes* | Type of user-defined resource |
| **Resource Name** | `resource_name` | string | User-defined names | Yes* | Specific name user gave their resource |
| **Log Level** | `level` | enum | `trace`, `debug`, `info`, `warn`, `error` | No | Log severity |
| **Timestamp** | `timestamp` | datetime | ISO 8601 | No | When log was created |

\* `resource_type` and `resource_name` are only present on logs related to user-defined resources.

---

## Contexts Explained

### Runtime Context (`context=runtime`)
Steady-state operational logs when the Moose app is running:
- HTTP requests being processed
- Transform execution
- Sync processes writing data to tables
- Query execution
- Workflow execution
- Consumer processing messages

**Always has resource context** when touching user resources.

### Deploy Context (`context=deploy`)
Infrastructure changes, migrations, and deployment operations:
- File watcher detecting code changes
- Planning infrastructure diffs (comparing current vs target state)
- Executing DDL (CREATE TABLE, ALTER TABLE, DROP TABLE)
- Infrastructure reconciliation
- Schema migrations

**May or may not have resource context** depending on operation.

### System Context (`context=system`)
System-wide health and operational logs not tied to user resources:
- ClickHouse/Kafka/Temporal/Redis health checks
- Leadership lock acquisition/renewal
- Connection pool status
- Docker container status
- General system health metrics

**Typically no resource context** - these are about infrastructure, not user resources.

---

## Filter Usage

| Filter | User Stories | Priority | Notes |
|--------|--------------|----------|-------|
| `context` | 10/10 | **P0** | Separate runtime from deploy/system logs |
| `resource_name` | 10/10 | **P0** | Most critical - filter by user resource |
| `resource_type` | 10/10 | **P0** | Filter by resource type |
| `level` | 8/10 | **P0** | Standard severity filtering |
| `timestamp` | 9/10 | **P0** | Time range queries (existing) |

---

## Coverage Analysis

### User Story Coverage

All 10 user stories can be addressed with P0 filters:

| Story | Filters Needed | Coverage |
|-------|----------------|----------|
| **US-1: Data not appearing in table** | `context=runtime`, `resource_name=UserEventPipeline` | ✅ **Complete** - See all runtime operations on pipeline |
| **US-2: Slow transform performance** | `context=runtime`, `resource_type=transform`, `resource_name=user_event_to_session` | ✅ **Complete** - Filter to specific transform |
| **US-3: Production 500 errors** | `context=runtime`, `resource_type=consumption_api`, `resource_name=leaderboard`, `level=error` | ✅ **Complete** - Runtime API errors |
| **US-4: Security audit** | `context=runtime`, `resource_type=consumption_api`, `resource_name=user-pii` | ⚠️ **Partial** - Can filter logs, but no auth events (Phase 2) |
| **US-5: Consumer lag growing** | `context=runtime`, `resource_name=UserEvent` | ✅ **Complete** - See sync process for table |
| **US-6: Transform wrong output** | `context=runtime`, `resource_type=transform`, `resource_name=foo_to_bar`, `level=error` | ⚠️ **Partial** - Can filter, but no kafka trace (Phase 2) |
| **US-7: Monitor deployment** | `context=deploy`, `timestamp` (follow mode) | ✅ **Complete** - See deployment operations in real-time |
| **US-8: Find all errors** | `level=error` | ✅ **Complete** - All errors across contexts |
| **US-9: Workflow failure** | `context=runtime`, `resource_type=workflow`, `resource_name=data_refresh` | ⚠️ **Partial** - Can filter, but no workflow_run_id (Phase 2) |
| **US-10: Performance comparison** | `context=runtime`, `resource_type=transform`, `resource_name=user_enrichment`, `timestamp` ranges | ⚠️ **Partial** - Can filter, but no performance metrics in logs (Phase 2) |

**Summary:**
- **6/10 fully covered** with P0 filters
- **4/10 partially covered** - basic filtering works, advanced features in Phase 2

---

### Codebase Coverage

How well can we map existing codebase components to P0 filters?

#### Runtime Context Coverage

| Codebase Component | `resource_type` | `resource_name` | Mappable? |
|--------------------|-----------------|-----------------|-----------|
| **HTTP Ingest Endpoints** | `ingest_api` | Topic name (e.g., `Foo`) | ✅ Yes |
| **Consumption API Endpoints** | `consumption_api` | API name (e.g., `leaderboard`) | ✅ Yes |
| **Function Processes** (transforms) | `transform` | Function name | ✅ Yes |
| **Function Processes** (consumers) | `consumer` | Consumer name | ✅ Yes |
| **Sync Processes** (topic→table) | `stream` | Stream name (e.g., `UserEvent`) | ✅ Yes |
| **Kafka Producer/Consumer** | `stream` | Topic name | ✅ Yes |
| **ClickHouse Operations** | `olap_table` | Table name | ✅ Yes |
| **Temporal Workflows** | `workflow` | Workflow name | ✅ Yes |
| **Temporal Tasks** | `task` | Task name | ✅ Yes |

**Coverage:** 100% of runtime operations can be tagged with resource type/name

---

#### Deploy Context Coverage

| Codebase Component | `resource_type` | `resource_name` | Mappable? |
|--------------------|-----------------|-----------------|-----------|
| **File Watcher** | Depends | File → resource name | ✅ Yes (when file = resource) |
| **Infrastructure Planning** | Depends | Resource being planned | ✅ Yes |
| **DDL Execution** (CREATE TABLE) | `olap_table` | Table name | ✅ Yes |
| **DDL Execution** (CREATE TOPIC) | `stream` | Topic name | ✅ Yes |
| **State Sync** | N/A | N/A | ❌ No resource context |
| **Leadership Lock (DDL)** | N/A | N/A | ❌ No resource context |

**Coverage:** ~70% of deploy operations can be tagged with resource type/name

---

#### System Context Coverage

| Codebase Component | `resource_type` | `resource_name` | Mappable? |
|--------------------|-----------------|-----------------|-----------|
| **ClickHouse Health Checks** | N/A | N/A | ❌ No resource context |
| **Kafka Health Checks** | N/A | N/A | ❌ No resource context |
| **Temporal Health Checks** | N/A | N/A | ❌ No resource context |
| **Redis Health Checks** | N/A | N/A | ❌ No resource context |
| **Leadership Lock (Coordination)** | N/A | N/A | ❌ No resource context |
| **Connection Pool Status** | N/A | N/A | ❌ No resource context |

**Coverage:** 0% - system logs are infrastructure-wide, not resource-specific (by design)

---

### Coverage Gaps

#### Gap 1: Sync Processes
**Problem:** Topic-to-table sync processes touch multiple resources (source stream + target table)

**Options Evaluated:**
1. Tag with target table: `resource_type=olap_table, resource_name=UserEvent`
2. Tag with source stream: `resource_type=stream, resource_name=UserEvent`
3. Add separate fields for source/target (Phase 2)

**Decision:** Tag with source stream (`resource_type=stream, resource_name=UserEvent`)

**Rationale:** This matches the underlying implementation where:
- IngestPipeline creates a Stream with `destination: table` configured
- The sync process is triggered by the stream's destination property
- User searches "Why isn't data appearing in UserEvent?" → filters by `resource_name=UserEvent` will show both stream operations AND sync process logs
- Keeps sync processes aligned with the user-facing primitive that creates them

**Example Log Output:**
```
[INFO] context=runtime, resource_type=stream, resource_name=UserEvent - Consuming from partition 2, offset 12345
[INFO] context=runtime, resource_type=stream, resource_name=UserEvent - Inserted 10000 records to table UserEvent
[DEBUG] context=runtime, resource_type=stream, resource_name=UserEvent - Committed offset 22345
```

---

#### Gap 2: Cross-Resource Operations
**Problem:** Some operations touch multiple resources simultaneously

**Examples:**
- Materialized View reads from source table(s), writes to target table
- Consumption API queries multiple tables dynamically
- Workflows orchestrate multiple resources

**Options Evaluated:**
1. Pick primary resource (tag with user-defined resource name)
2. Log multiple times (once per involved resource)
3. Add multi-resource field like `source_resources`, `target_resources` (Phase 2)

**Decision:** Tag with primary user-defined resource (Option 1)

**Rationale:**
- **User mental model:** Users debug "my leaderboard API" not "what's querying table1"
- **Simplicity:** One resource per log, no duplication
- **Clear ownership:** Each log belongs to exactly one user-defined resource
- **Defers complexity:** Advanced queries ("what's touching this table?") → Phase 2

**Example Log Output:**
```
[INFO] context=runtime, resource_type=materialized_view, resource_name=BarAggregated_MV - Starting materialization
[DEBUG] context=runtime, resource_type=materialized_view, resource_name=BarAggregated_MV - Reading 10000 rows from source table
[INFO] context=runtime, resource_type=materialized_view, resource_name=BarAggregated_MV - Inserted 500 aggregated rows

[INFO] context=runtime, resource_type=consumption_api, resource_name=leaderboard - Processing request
[DEBUG] context=runtime, resource_type=consumption_api, resource_name=leaderboard - Executing query on BarAggregated
[INFO] context=runtime, resource_type=consumption_api, resource_name=leaderboard - Returned 10 rows in 45ms
```

**P0 Coverage:**
- ✅ "Show me logs for my BarAggregated_MV" → `resource_name=BarAggregated_MV`
- ✅ "Show all materialized view logs" → `resource_type=materialized_view`
- ✅ "Errors in my leaderboard API" → `resource_name=leaderboard, level=error`
- ❌ "What's touching the Bar table?" → NOT SUPPORTED (Phase 2 with `source_resources` field)

---

#### Gap 3: Infrastructure Operations Without Resources
**Problem:** ~30% of deploy logs and 100% of system logs have no resource context

**Examples of logs without resource context:**

**Deploy Context:**
- File watcher: "File changed: datamodels/Foo.ts" (before mapped to resource)
- Infrastructure reconciliation: "Reconciling infrastructure map with actual database state"
- Leadership lock (DDL coordination): "Error acquiring lock ddl_lock"
- State sync: Infrastructure-wide operations

**System Context:**
- Health checks: ClickHouse/Kafka/Temporal/Redis connection testing
- Connection pools: Status monitoring
- Docker containers: Container lifecycle events
- Leadership lock (coordination): Lock acquisition/renewal for distributed coordination

**Options Evaluated:**
1. Accept as-is: Filter by `context` only (deploy/system), no further granularity
2. Add `infrastructure_component` field: Tag with component name ("file_watcher", "clickhouse_health", "leadership_lock")
3. Add `operation_category` field: Tag with operation type ("health_check", "lock_coordination", "state_sync")

**Decision:** Accept as-is for P0 (Option 1)

**Rationale:**
- **Low user priority:** All 10 user stories focus on debugging user resources, not infrastructure
- **Sufficient filtering:** `context=deploy, level=error` or `context=system, level=error` covers deployment monitoring (US-7)
- **Defer complexity:** Infrastructure component filtering can be added in Phase 2 if user demand emerges
- **Module path available:** Current logs already include module path (e.g., `moose_cli::cli::watcher`) which provides some granularity

**P0 Coverage:**
- ✅ "Monitor deployment errors" → `context=deploy, level=error`
- ✅ "Show all system errors" → `context=system, level=error`
- ✅ "Follow deployment" → `context=deploy, follow=true` (US-7)
- ❌ "Show only file watcher logs" → NOT SUPPORTED (Phase 2 with `infrastructure_component`)
- ❌ "Show all health check failures" → NOT SUPPORTED (Phase 2 with `operation_category`)

**Impact:** Acceptable for P0. Users primarily debug their resources, not infrastructure internals.

---

### What's Missing (Phase 2+)

Features that would improve coverage but deferred:

1. **Request Trace ID** - Would improve US-1, US-6 coverage (trace data flow)
2. **Error Categorization** - Would improve US-3, US-8 coverage (error analysis)
3. **Kafka Trace IDs** - Would improve US-6 coverage (message-level debugging)
4. **Workflow Run ID** - Would improve US-9 coverage (workflow execution tracing)
5. **Performance Metrics** - Would improve US-2, US-10 coverage (latency/throughput analysis)
6. **Security Events** - Would improve US-4 coverage (auth/audit trails)

---

### Summary

**P0 Filters provide:**
- ✅ Full coverage for 6/10 user stories
- ⚠️ Partial coverage for 4/10 user stories (basic filtering works)
- ✅ 100% coverage of runtime operations
- ✅ 70% coverage of deploy operations
- ✅ 100% coverage of system operations (by design - no resource context)

**Key strength:** Simple, unambiguous model that covers the most common debugging scenarios

**Known gaps:** Advanced tracing, performance analysis, security events → Phase 2

---

## Additional Filters (Deferred)

These filters were evaluated but deferred to later phases based on user story frequency and implementation complexity.

### Request Trace ID

**Fields:** `request_id` (UUID)

**Why Deferred:**
- Requires cross-language propagation (Rust → Kafka headers → TS/Python)
- Complex implementation across all runtime boundaries
- High value (6/10 stories) but significant engineering effort
- Can be added in Phase 2 after P0 stabilizes

---

### Error Categorization

**Fields:** `error_category` (enum), `error_retryable` (boolean)

**Why Deferred:**
- Requires mapping all `thiserror` error types to categories
- 5/10 stories, but `level=error` + `resource_name` covers basic filtering
- Users can filter errors by resource without categorization initially
- Can be added in Phase 2

---

### Kafka Trace IDs

**Fields:** `kafka_topic`, `kafka_partition`, `kafka_offset`

**Why Deferred:**
- Only 3/10 stories required Kafka-level tracing
- Partially exists today (captured but not logged)
- Lower priority than request trace
- Can be added in Phase 2

---

### Workflow Trace ID

**Fields:** `workflow_run_id`

**Why Deferred:**
- Only 2/10 stories required workflow tracing
- Temporal provides its own UI for workflow debugging
- Can be added in Phase 2

---

### Domain/Layer Filter (Rejected)

**Proposal:** Group resources by high-level domains (`streaming`, `storage`, `api`, `orchestration`)

**Why Rejected:**
- **Ambiguous mapping:** Resources don't map cleanly to domains (e.g., sync process touches both streaming and storage)
- **User confusion:** Users would have to guess which domain contains relevant logs
- **Redundant:** `resource_type` already provides sufficient categorization
- **Spans create gaps:** Pipelines and streams span multiple domains, creating filtering blind spots

**Decision:** Use `resource_type` for categorization. It's concrete, unambiguous, and maps directly to user mental models.

---

### Other Deferred Filters

**Operation Phase** (2/10 stories)
- Primarily for infrastructure deployment monitoring
- Can be added when users request it

**Infrastructure Operation Type** (4/10 stories)
- More granular than needed for initial use cases
- Resource type + level covers most debugging needs

**Security Events** (2/10 stories)
- Critical for compliance but not core debugging
- Should be prioritized in Phase 2

**Performance Metrics** (5/10 stories)
- Metrics already exist separately in Prometheus
- Adding to logs is valuable but not MVP-critical

---

## Implementation Priority

**Phase 1 (P0 - MVP):**
1. Add `context` to ALL logs (runtime, deploy, system)
2. Add `resource_type` to all logs related to user resources
3. Add `resource_name` to all logs related to user resources
4. Ensure `level` and `timestamp` are present and indexed
5. Build UI with filtering by these 5 fields

**Phase 2 (High Value Add-ons):**
1. Request trace ID (`request_id`) - cross-language propagation
2. Error categorization (`error_category`, `error_retryable`)
3. Security events for compliance
4. Performance metrics in logs

**Phase 3 (Nice to Have):**
- Kafka trace IDs
- Workflow trace IDs
- Operation phase
- Infrastructure operation types

---

## Gaps: Fields That Don't Exist Today

| Field | Status | Impact | Phase |
|-------|--------|--------|-------|
| `context` | ❌ Missing | **HIGH** | P0 |
| `resource_type` | ❌ Missing | **HIGH** | P0 |
| `resource_name` | ❌ Missing | **HIGH** | P0 |
| `level` | ✅ Exists | - | P0 |
| `timestamp` | ✅ Exists | - | P0 |

All other fields are deferred to Phase 2+.

---

**Document Version:** 7.0
**Date:** 2026-01-09
**Changes:**
- Updated sync process tagging to use `resource_type: stream` (Gap 1)
- Resolved cross-resource operations with primary resource tagging (Gap 2)
- Analyzed infrastructure operations and confirmed acceptable for P0 (Gap 3)
**Related:** `LOGGING_USER_STORIES.md`, `LOGGING_CURRENT_STATE.md`
