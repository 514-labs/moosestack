# P0 Filter Requirements for Moose Logging (Simplified)

## Document Purpose

This document defines the **Priority 0 (P0) filters** required for Moose logging based on user stories. These filters are essential for the initial implementation and will guide the engineering design of structured logging.

**Key Decision:** We've dropped "domain/layer" concepts to avoid ambiguity and user confusion. Filters focus on concrete, unambiguous concepts.

---

## Core Philosophy

**P0 filters must be:**
1. **Unambiguous** - Clear what they filter, no overlap
2. **User-centric** - Match user mental models (their component names)
3. **Actionable** - Enable debugging and troubleshooting

---

## P0 Filter Categories

### 1. User Primitive Filters

**Purpose:** Filter logs by user-defined components (the things users name and create)

#### 1.1 Filter by Primitive Type

**Syntax:**
```bash
--filter type=<primitive_type>
```

**Supported Types:**
- `ingest_api` - HTTP POST endpoint accepting data (`/ingest/Foo`)
- `consumption_api` - HTTP GET/POST endpoint serving queries (`/leaderboard`)
- `ingest_pipeline` - Complete ingest pipeline (api + stream + table)
- `stream` - Kafka/Redpanda topic
- `olap_table` - ClickHouse table
- `materialized_view` - Pre-aggregated table
- `transform` - Streaming transformation function
- `consumer` - Stream consumer
- `workflow` - Temporal workflow
- `task` - Workflow task

**User Stories:** US-1, US-2, US-3, US-6, US-9, US-10 (10/10 stories)

**Examples:**
```bash
# All transform logs
moose logs --filter type=transform

# All table logs
moose logs --filter type=olap_table

# All API logs (both ingest and consumption)
moose logs --filter type=ingest_api,consumption_api
```

**Implementation Requirements:**
- Log field: `primitive_type` (enum)
- Must be present on all logs related to user primitives
- Indexed for fast filtering

---

#### 1.2 Filter by Primitive Name

**Syntax:**
```bash
--filter name=<primitive_name>
```

**What:** The actual name the user gave their component

**Examples:**
```bash
# Specific pipeline
moose logs --filter name=UserEventPipeline

# Specific table
moose logs --filter name=UserEvent

# Specific transform
moose logs --filter name=user_event_to_session

# Specific API
moose logs --filter name=leaderboard
```

**User Stories:** US-1, US-2, US-3, US-4, US-6, US-9, US-10 (10/10 stories)

**Implementation Requirements:**
- Log field: `primitive_name` (string)
- Must match user-defined names exactly
- Indexed for fast filtering
- **Critical: Most commonly used filter (10/10 stories)**

---

#### 1.3 Combined Type + Name Filter

**Syntax:**
```bash
--filter type=<type>,name=<name>
```

**Examples:**
```bash
# Specific table by type and name
moose logs --filter type=olap_table,name=UserEvent

# Specific transform by type and name
moose logs --filter type=transform,name=foo_to_bar

# Specific API by type and name
moose logs --filter type=consumption_api,name=leaderboard
```

**Value:** Disambiguate when same name exists across different types

**Implementation Requirements:**
- Support AND operation between type and name
- Both fields present in structured log

---

### 2. Log Level Filter

**Purpose:** Filter by severity/importance

#### 2.1 Filter by Level

**Syntax:**
```bash
--level=<level_names>
```

**Supported Levels:**
- `trace` - Very detailed debugging
- `debug` - Diagnostic information
- `info` - Operational confirmations
- `warn` - Unexpected situations
- `error` - System failures

**User Stories:** US-3, US-4, US-6, US-8 (8/10 stories)

**Examples:**
```bash
# Errors only
moose logs --level=error

# Warnings and errors
moose logs --level=warn,error

# Debug and above
moose logs --level=debug,info,warn,error
```

**Implementation Requirements:**
- Log field: `level` (enum)
- Already exists in current logging (standard feature)
- Must be preserved in new system

---

### 3. Time Range Filters

**Purpose:** Filter logs by time period

#### 3.1 Relative Time Ranges

**Syntax:**
```bash
--since=<duration>
--until=<duration>
```

**Supported Formats:**
- `10m` - 10 minutes
- `1h` - 1 hour
- `24h` or `1d` - 1 day
- `7d` - 7 days

**User Stories:** US-3, US-4, US-5, US-7, US-8, US-10 (9/10 stories)

**Examples:**
```bash
# Last 10 minutes
moose logs --since=10m

# Last hour
moose logs --since=1h

# Between 2 days ago and 1 day ago
moose logs --since=2d --until=1d
```

**Implementation Requirements:**
- Parse relative time expressions
- Convert to absolute timestamps
- Query logs in time range
- **Critical: Used in 9/10 user stories**

---

#### 3.2 Follow Mode (Real-Time)

**Syntax:**
```bash
--follow
```

**User Stories:** US-7

**Examples:**
```bash
# Monitor in real-time
moose logs --filter type=transform --follow

# Monitor errors as they happen
moose logs --level=error --follow
```

**Implementation Requirements:**
- Stream logs as they're produced
- Similar to `tail -f`
- Essential for live monitoring

---

### 4. Trace/Correlation ID Filters

**Purpose:** Follow a single request or data flow through the system

#### 4.1 Trace by Request ID

**Syntax:**
```bash
--trace <request_id>
```

**User Stories:** US-1 (6/10 stories use tracing)

**Examples:**
```bash
# Follow specific HTTP request through pipeline
moose logs --trace abc123-def456-ghi789
```

**Implementation Requirements:**
- Log field: `request_id` (UUID)
- Generated at HTTP ingestion
- Propagated through: HTTP → Kafka → ClickHouse
- Must survive across language boundaries (Rust → TS/Python)
- **NEW FIELD - Does not exist today**

**Value:** Critical for "data isn't appearing" debugging - trace from ingest to table

---

#### 4.2 Trace by Kafka Offset

**Syntax:**
```bash
--trace-kafka topic=<topic_name>,partition=<num>,offset=<num>
```

**User Stories:** US-6

**Examples:**
```bash
# Follow specific Kafka message
moose logs --trace-kafka topic=Foo,partition=2,offset=12345
```

**Implementation Requirements:**
- Log fields: `kafka_topic`, `kafka_partition`, `kafka_offset`
- Available in streaming and sync logs
- Partially exists today (captured but not filterable)

---

#### 4.3 Trace by Workflow Run ID

**Syntax:**
```bash
--filter workflow_run_id=<run_id>
```

**User Stories:** US-9

**Examples:**
```bash
# Follow specific workflow execution
moose logs --filter workflow_run_id=abc123-def456
```

**Implementation Requirements:**
- Log field: `workflow_run_id` (string)
- Only present in orchestration logs
- Comes from Temporal execution context

---

### 5. Error Category Filters

**Purpose:** Filter by type/category of error

#### 5.1 Filter by Error Category

**Syntax:**
```bash
--filter error=<category>
```

**Supported Categories:**
- `timeout_error` - Operation timeouts
- `connection_error` - Network/connectivity failures
- `type_conversion_error` - Data type mismatches
- `authentication_error` - Auth failures
- `authorization_error` - Permission denied
- `validation_error` - Configuration/constraint violations
- `parsing_error` - Code/data parsing failures
- `resource_not_found` - Missing resources

**User Stories:** US-3, US-8 (5/10 stories)

**Examples:**
```bash
# All timeout errors
moose logs --filter error=timeout_error --level=error

# All auth errors
moose logs --filter error=authentication_error,authorization_error

# Connection issues for specific table
moose logs --filter type=olap_table,name=UserEvent --filter error=connection_error
```

**Implementation Requirements:**
- Log field: `error_category` (enum, optional)
- Only present on error-level logs
- Map from existing `thiserror` error types
- **NEW FIELD - Does not exist today**

---

#### 5.2 Filter by Error Recoverability

**Syntax:**
```bash
--filter error_type=<retryable|non_retryable>
```

**Examples:**
```bash
# Show only retryable errors
moose logs --filter error_type=retryable --level=error

# Show permanent failures
moose logs --filter error_type=non_retryable --level=error
```

**User Stories:** Implicit in US-3, US-5, US-8

**Implementation Requirements:**
- Log field: `error_retryable` (boolean, optional)
- Determined from error type
- Helps identify transient vs permanent failures

---

### 6. Aggregation & Analysis

**Purpose:** Group and analyze logs, not just filter them

#### 6.1 Group By Dimension

**Syntax:**
```bash
--group-by=<dimension>
```

**Supported Dimensions:**
- `error_category`
- `primitive_type`
- `primitive_name`

**User Stories:** US-8 (3/10 stories)

**Examples:**
```bash
# Group errors by category
moose logs --level=error --since=1h --group-by=error_category

# Group by primitive type
moose logs --level=error --since=1h --group-by=primitive_type

# Group by primitive name
moose logs --since=1h --group-by=primitive_name
```

**Expected Output:**
```
Error Summary (last 1h):
  timeout_error: 45 occurrences
    └─ olap_table: 42
    └─ stream: 3

  type_conversion_error: 12 occurrences
    └─ olap_table: 12

Recent Errors:
[ERROR] type=olap_table, name=UserEvent - timeout_error - Query timeout after 5001ms
[ERROR] type=olap_table, name=leaderboard - timeout_error - Query timeout after 5003ms
```

**Implementation Requirements:**
- Aggregate logs by specified dimension
- Show count per group
- Sort by frequency (descending)
- Essential for error pattern analysis

---

## Summary: P0 Filter Implementation Checklist

### Core P0 Filters (Simple & Unambiguous)

| Filter | Field(s) | Exists Today? | Stories | Priority |
|--------|----------|---------------|---------|----------|
| **Primitive Type** | `primitive_type` | ❌ No | 10/10 | **P0** |
| **Primitive Name** | `primitive_name` | ❌ No | 10/10 | **P0** |
| **Log Level** | `level` | ✅ Yes | 8/10 | **P0** |
| **Time Range** | `timestamp` | ✅ Yes | 9/10 | **P0** |
| **Request Trace** | `request_id` | ❌ No | 6/10 | **P0** |
| **Error Category** | `error_category` | ❌ No | 5/10 | **P0** |
| **Aggregation** | (analysis) | ❌ No | 3/10 | **P0** |

### Additional Trace IDs (P0 but specialized)

| Filter | Field(s) | Exists Today? | Stories |
|--------|----------|---------------|---------|
| **Kafka Trace** | `kafka_topic`, `kafka_partition`, `kafka_offset` | ⚠️ Partial | 3/10 |
| **Workflow Trace** | `workflow_run_id` | ❌ No | 2/10 |
| **Error Retryability** | `error_retryable` | ❌ No | 3/10 |

---

## New Required Fields

| Field | Type | Optional? | Notes |
|-------|------|-----------|-------|
| `primitive_type` | enum | Yes* | *Only on logs for user primitives |
| `primitive_name` | string | Yes* | *Only on logs for user primitives |
| `request_id` | UUID | Yes | Generated at HTTP ingest, propagated |
| `kafka_topic` | string | Yes | Only in streaming/sync logs |
| `kafka_partition` | int | Yes | Only in streaming/sync logs |
| `kafka_offset` | int64 | Yes | Only in streaming/sync logs |
| `workflow_run_id` | string | Yes | Only in orchestration logs |
| `error_category` | enum | Yes | Only on error logs |
| `error_retryable` | bool | Yes | Only on error logs |

---

## Structured Log Format Example

```json
{
  "timestamp": "2026-01-09T10:15:23.456Z",
  "level": "INFO",
  "message": "Inserted 10000 records",

  "primitive_type": "olap_table",
  "primitive_name": "UserEvent",

  "request_id": "abc123-def456-ghi789",
  "kafka_topic": "UserEvent",
  "kafka_partition": 2,
  "kafka_offset": 12345,

  "latency_ms": 450,
  "batch_size": 10000,

  "context": {
    "operation": "batch_insert",
    "table": "UserEvent",
    "database": "moose_db"
  }
}
```

---

## What We're NOT Doing (Dropped)

❌ **Domain/Layer filtering** - Too ambiguous, spans don't map cleanly
❌ **Process filtering** - Redundant with primitive type
❌ **Operation phase** - Moved to P1 (only 2 stories)
❌ **Infrastructure operation type** - Moved to P1 (only 4 stories)
❌ **Security event filtering** - Moved to P1 (only 2 stories)
❌ **Performance metrics** - Moved to P1 (only 5 stories)

These can be added later if users request them, but we start with the essentials.

---

## User Story Coverage

**All 10 user stories can be solved with these P0 filters:**

| Story | Key Filters Used |
|-------|------------------|
| US-1: Data not appearing | `name=UserEventPipeline`, `--trace <request_id>` |
| US-2: Slow transform | `type=transform, name=user_event_to_session` |
| US-3: Production 500s | `type=consumption_api, name=leaderboard, level=error` |
| US-4: Security audit | `type=consumption_api, name=user-pii` (security moved to P1) |
| US-5: Consumer lag | `type=olap_table, name=UserEvent` + kafka trace |
| US-6: Wrong output | `type=transform, name=foo_to_bar`, kafka trace |
| US-7: Monitor deployment | Time range + `--follow` |
| US-8: All errors | `level=error, --group-by=error_category` |
| US-9: Workflow failure | `type=workflow, name=data_refresh` |
| US-10: Performance comparison | `type=transform, name=user_enrichment` + time ranges |

---

## Engineering Design Implications

### 1. Cross-Language Correlation

**Critical:** `request_id` must propagate:
1. Generated in Rust HTTP handler (UUID v4)
2. Added to Kafka message headers
3. Extracted by TypeScript/Python consumers
4. Logged in all languages

### 2. Indexing Strategy

For fast filtering, index:
- `primitive_type`, `primitive_name` (most common filters)
- `request_id` (trace queries)
- `timestamp` (time range queries)
- `level` (severity filtering)
- `error_category` (error analysis)

### 3. Log Storage

Need queryable storage supporting:
- Time-based partitioning
- Field indexing
- Full-text search (for message)
- Aggregations (group-by)

**Candidates:** ClickHouse, Elasticsearch, Loki

---

## Next Steps

1. ✅ P0 filter requirements (simplified)
2. ⏭️ Design request ID propagation (Rust → Kafka → TS/Python)
3. ⏭️ Design structured logging schema
4. ⏭️ Choose log storage backend
5. ⏭️ Implementation plan

---

**Document Version:** 2.0 (Simplified)
**Date:** 2026-01-09
**Changes:** Removed domain/layer filters to eliminate ambiguity
**Related:** `LOGGING_USER_STORIES.md`, `LOGGING_CURRENT_STATE.md`
