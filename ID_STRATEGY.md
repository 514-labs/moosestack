# Moose Logging - ID Strategy for Request & Message Tracing

## Document Purpose

This document defines the ID strategy for tracing requests and messages through the Moose data pipeline. It addresses three types of IDs and how they work together to provide end-to-end observability.

---

## Overview: Three Types of IDs

Moose needs **three distinct but related ID types** to trace data through the system:

| ID Type | Scope | Purpose | Lifespan |
|---------|-------|---------|----------|
| **`trace_id`** | Distributed operation | Follows a request across all services/boundaries (HTTP → Kafka → Transform → ClickHouse) | Entire request flow |
| **`request_id`** | Single HTTP request | Identifies a specific HTTP API call | HTTP request/response |
| **`message_id`** | Individual data record | Uniquely identifies a single message/event in the data pipeline | From ingest to OLAP table |

---

## Current State (As of 2026-01-09)

### ❌ What Doesn't Exist Today

Based on codebase analysis:

1. **No `trace_id`** - No distributed tracing infrastructure
2. **No `request_id`** - HTTP requests don't generate unique identifiers
3. **No `message_id`** - Individual records have no unique ID
4. **No Kafka headers** - Messages sent with only key + payload (no metadata)
5. **No cross-language correlation** - Rust, TypeScript, Python logs are isolated

**Key Code Locations:**
- `/apps/framework-cli/src/cli/local_webserver.rs:1300-1302` - Kafka producer (no headers)
- `/apps/framework-cli/src/infrastructure/stream/kafka/client.rs:759-761` - FutureRecord creation (no headers)
- `LOGGING_CURRENT_STATE.md:294-298` - Documented gap: "❌ Not possible" for cross-language correlation

---

## 1. `trace_id` - Distributed Request Tracing

### Definition

A **globally unique identifier** that follows a request across all service boundaries.

**Format:** 32-character hexadecimal (128-bit) - OTel standard
**Example:** `4bf92f3577b34da6a3ce929d0e0e4736`

### Scope & Propagation

```
HTTP POST /ingest/UserEvent [trace_id: abc123]
  │
  ├─> Validate & parse (Rust) [trace_id: abc123]
  ├─> Produce to Kafka topic [trace_id: abc123 in headers]
  │
  └─> Kafka message consumed [trace_id: abc123 from headers]
      │
      ├─> Transform execution (TypeScript) [trace_id: abc123]
      ├─> Produce transformed to Kafka [trace_id: abc123 in headers]
      │
      └─> Sync process consumes [trace_id: abc123 from headers]
          └─> Insert to ClickHouse [trace_id: abc123 in log]
```

### Where It's Generated

- **HTTP Ingest:** Extract from `traceparent` header (W3C Trace Context) **OR** generate new UUID if not present
- **Consumption API:** Extract from `traceparent` header **OR** generate new UUID
- **Workflow/Task:** Generate at workflow start (propagate to all tasks)
- **Consumer:** Extract from Kafka headers **OR** generate if missing

### Where It's Propagated

1. **HTTP → Kafka:** Inject into Kafka message headers
   ```rust
   let mut headers = OwnedHeaders::new();
   headers = headers.insert(Header {
       key: "trace_id",
       value: Some(trace_id.as_bytes()),
   });
   let record = FutureRecord::to(topic)
       .headers(headers)
       .payload(payload);
   ```

2. **Kafka → Transform (TS/Python):** Extract from Kafka message headers
   ```typescript
   const trace_id = message.headers.find(h => h.key === 'trace_id')?.value;
   ```

3. **Transform → Kafka:** Re-inject into output message headers
   ```typescript
   const outputHeaders = [{ key: 'trace_id', value: trace_id }];
   await producer.send({ topic, headers: outputHeaders, value });
   ```

4. **Kafka → ClickHouse:** Extract from headers, include in log context
   ```rust
   let trace_id = message.headers()
       .iter()
       .find(|h| h.key == "trace_id")
       .and_then(|h| h.value)
       .map(String::from_utf8_lossy);

   tracing::info!(trace_id = ?trace_id, "Inserting to ClickHouse");
   ```

### Use Cases

✅ **US-1: Data not appearing in table**
- Filter all logs by `trace_id=abc123`
- See entire flow: HTTP ingest → Kafka → Transform → ClickHouse
- Identify where data was lost or failed

✅ **US-6: Transform producing wrong output**
- Follow single message through transform pipeline
- See input/output at each stage with same `trace_id`

✅ **US-9: Workflow failure**
- Trace workflow execution across all tasks
- See which task failed and why

### OTel Integration

If using OpenTelemetry:
- Use standard `trace_id` (128-bit)
- Use standard `span_id` (64-bit) for each operation
- Standard W3C Trace Context propagation via `traceparent` header
- Standard Kafka headers: `traceparent`, `tracestate`

**W3C Trace Context Format:**
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             ^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^  ^^
           version       trace_id (128-bit)        span_id (64-bit)  flags
```

---

## 2. `request_id` - HTTP Request Identifier

### Definition

A **unique identifier for a single HTTP request**, scoped to the request/response cycle.

**Format:** UUID v4 or v7 (UUIDv7 preferred for sortability)
**Example:** `550e8400-e29b-41d4-a716-446655440000`

### Relationship to `trace_id`

- **Same for single-request flows:** If HTTP request directly inserts to ClickHouse, `request_id == trace_id`
- **Different for multi-hop flows:** If HTTP request triggers async pipeline (Kafka → Transform), they diverge:
  - `request_id`: Scoped to HTTP request/response
  - `trace_id`: Continues through entire async pipeline

### Where It's Used

1. **HTTP Response Header:** Return `X-Request-Id` to client
   ```rust
   Response::builder()
       .header("X-Request-Id", request_id.to_string())
       .body(...)
   ```

2. **Log Correlation:** Include in all logs for that HTTP request
   ```rust
   tracing::info!(request_id = %request_id, "Processing ingest request");
   ```

3. **Metrics:** Tag metrics with `request_id` for correlation
   ```rust
   metrics.record_ingest(request_id, topic, latency);
   ```

### Use Cases

✅ **US-3: Production 500 errors**
- Client receives 500 response with `X-Request-Id: xyz789`
- Filter logs by `request_id=xyz789`
- See exactly what happened during that HTTP request

✅ **US-8: Find all errors**
- Filter by `level=error, request_id=xyz789`
- See all errors for a specific API call

### Example Flow

```
Client: POST /ingest/UserEvent
        ↓
Server: Generate request_id=req_001
        Generate trace_id=trace_abc (if not present)
        ↓
        [All logs tagged with request_id=req_001, trace_id=trace_abc]
        ↓
        Produce to Kafka with headers:
          - trace_id: trace_abc
          - request_id: req_001
        ↓
Client: ← 200 OK
        X-Request-Id: req_001

        [Async pipeline continues with trace_id=trace_abc]
```

---

## 3. `message_id` - Individual Message Identifier

### Definition

A **unique identifier for a single data record/event** that persists from ingest to OLAP table.

**Format:** UUID v7 (time-sortable) or ULID
**Example:** `01H3Z8X9Y2ABCDEFGHJKLMNPQR`

### Scope & Storage

Unlike `trace_id` (for operations) and `request_id` (for HTTP calls), `message_id`:
- **Identifies the data itself** (not the operation processing it)
- **Stored in the data record** (as a field in the message payload)
- **Persisted in ClickHouse** (as a column in the table)

### Where It's Generated

**Option 1: Client-provided (Preferred for idempotency)**
```typescript
// Client generates message_id
const event = {
  message_id: uuidv7(),
  user_id: 123,
  event_type: "click",
  timestamp: "2026-01-09T10:30:00Z"
};

await fetch('/ingest/UserEvent', {
  method: 'POST',
  body: JSON.stringify([event])
});
```

**Option 2: Server-generated (Fallback)**
```rust
// Server injects message_id if not present
let message_id = payload.get("message_id")
    .and_then(|v| v.as_str())
    .map(String::from)
    .unwrap_or_else(|| Uuid::new_v7().to_string());
```

### Where It's Stored

1. **Kafka Message Payload** (as a field):
   ```json
   {
     "message_id": "01H3Z8X9Y2ABCDEFGHJKLMNPQR",
     "user_id": 123,
     "event_type": "click",
     "timestamp": "2026-01-09T10:30:00Z"
   }
   ```

2. **ClickHouse Table** (as a column):
   ```sql
   CREATE TABLE UserEvent (
     message_id String,           -- Message identifier
     user_id UInt64,
     event_type String,
     timestamp DateTime64(3),
     -- Metadata (optional)
     _trace_id String,            -- Operation trace ID
     _request_id String,          -- HTTP request ID
     _ingested_at DateTime64(3)   -- When Moose received it
   ) ENGINE = MergeTree()
   ORDER BY (user_id, timestamp);
   ```

3. **Logs** (as context):
   ```rust
   tracing::info!(
       message_id = %message_id,
       trace_id = %trace_id,
       "Processing message"
   );
   ```

### Use Cases

✅ **US-1: Data not appearing in table**
- Query: "Did message `message_id=msg_123` make it to ClickHouse?"
- Check logs: `message_id=msg_123` → see if it was processed, failed, or filtered

✅ **US-6: Transform producing wrong output**
- Input message: `message_id=msg_123`
- Output message: `message_id=msg_456` (with `parent_message_id=msg_123`)
- Trace lineage through transform

✅ **Idempotency**
- Client retries same request with same `message_id`
- Moose detects duplicate and deduplicates before inserting to ClickHouse
- Requires ClickHouse deduplication strategy (ReplacingMergeTree or explicit check)

✅ **Data Lineage**
- Track transformations: Input `message_id` → Output `message_id`
- Build data lineage graph for compliance/debugging

---

## Comparison: When to Use Each ID

| Scenario | `trace_id` | `request_id` | `message_id` |
|----------|-----------|-------------|-------------|
| **Client receives 500 error** | ✅ (if async) | ✅ (return in header) | ❌ |
| **Message lost in pipeline** | ✅ (trace operations) | ❌ | ✅ (identify record) |
| **Transform output incorrect** | ✅ (trace execution) | ❌ | ✅ (identify input/output) |
| **Query "did this record arrive?"** | ❌ | ❌ | ✅ (query by `message_id`) |
| **Correlate HTTP → Kafka → ClickHouse** | ✅ (end-to-end) | ✅ (HTTP only) | ✅ (data record) |
| **Retry same request (idempotency)** | ❌ (new trace) | ❌ (new request) | ✅ (same data) |
| **Performance analysis** | ✅ (span durations) | ✅ (request latency) | ❌ |
| **Security audit** | ✅ (operation trail) | ✅ (API calls) | ✅ (data access) |

---

## Implementation Phases

### Phase 1: Add `request_id` to HTTP Requests (P0)

**Goal:** Basic HTTP request tracing without distributed tracing complexity.

**Changes:**
1. Generate `request_id` in `ingest_route()` and consumption API handlers
2. Return `X-Request-Id` header in HTTP responses
3. Include `request_id` in all logs for that request
4. Add `request_id` to Kafka message headers (for later correlation)

**Effort:** Low (2-3 days)
**Value:** Immediate HTTP debugging capability

### Phase 2: Add `message_id` to Data Records (P0)

**Goal:** Track individual messages through pipeline.

**Changes:**
1. Accept `message_id` from client payload (optional)
2. Generate `message_id` if not provided (server-side)
3. Store `message_id` in ClickHouse tables (add column)
4. Log `message_id` in sync process
5. Build UI to query by `message_id`

**Effort:** Medium (5-7 days)
**Value:** Data-level debugging and lineage

**Migration:** Add `message_id String` column to existing tables (nullable initially)

### Phase 3: Add `trace_id` for Distributed Tracing (Phase 2)

**Goal:** Full end-to-end request tracing across all boundaries.

**Changes:**
1. Generate/extract `trace_id` from W3C Trace Context header
2. Propagate through Kafka headers (all producers/consumers)
3. Extract in TypeScript/Python transforms
4. Include in all logs (Rust, TS, Python)
5. Store `_trace_id` in ClickHouse (metadata column)
6. Build UI to visualize trace timeline

**Effort:** High (2-3 weeks - cross-language propagation)
**Value:** Complete observability (addresses US-1, US-6, US-9)

**Optional:** Full OTel integration (adds spans, metrics correlation)

---

## Storage Strategy

### Kafka Message Structure (After Phase 3)

**Headers:**
```
trace_id: 4bf92f3577b34da6a3ce929d0e0e4736      (operation)
request_id: 550e8400-e29b-41d4-a716-446655440000 (HTTP request, optional)
```

**Payload:**
```json
{
  "message_id": "01H3Z8X9Y2ABCDEFGHJKLMNPQR",  // data record
  "user_id": 123,
  "event_type": "click",
  "timestamp": "2026-01-09T10:30:00Z"
}
```

### ClickHouse Table Structure

**User-facing columns:**
```sql
user_id UInt64,
event_type String,
timestamp DateTime64(3)
```

**Metadata columns (prefixed with `_`):**
```sql
message_id String,                  -- Unique message ID
_trace_id String DEFAULT '',        -- Distributed trace ID
_request_id String DEFAULT '',      -- HTTP request ID
_ingested_at DateTime64(3) DEFAULT now64(3),  -- When received
_kafka_partition Int32 DEFAULT -1,  -- Source partition
_kafka_offset Int64 DEFAULT -1      -- Source offset
```

**Rationale:**
- `message_id`: User-facing (for queries like "WHERE message_id = 'xxx'")
- `_trace_id`, `_request_id`: Internal metadata (prefixed to avoid conflicts)
- Default values allow gradual rollout (existing data won't break)

### Log Structure (with all IDs)

**Example log entry:**
```json
{
  "timestamp": "2026-01-09T10:30:00.123Z",
  "level": "INFO",
  "context": "runtime",
  "resource_type": "ingest_api",
  "resource_name": "UserEvent",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "message_id": "01H3Z8X9Y2ABCDEFGHJKLMNPQR",
  "message": "Ingested 1 record to topic UserEvent"
}
```

---

## Querying with IDs

### Query 1: "Did my HTTP request succeed?"

**User has:** `request_id=req_001` (from HTTP response header)

**Query logs:**
```sql
SELECT * FROM moose_logs
WHERE request_id = 'req_001'
ORDER BY timestamp;
```

**Result:** All logs for that HTTP request (validation, Kafka produce, response)

### Query 2: "Did my message reach the table?"

**User has:** `message_id=msg_123` (from their payload)

**Query ClickHouse:**
```sql
SELECT * FROM UserEvent
WHERE message_id = 'msg_123';
```

**If not found, query logs:**
```sql
SELECT * FROM moose_logs
WHERE message_id = 'msg_123'
ORDER BY timestamp;
```

**Result:** See where message was processed, failed, or filtered

### Query 3: "Show me the entire flow for this request"

**User has:** `trace_id=trace_abc` (from logs or HTTP header)

**Query logs:**
```sql
SELECT * FROM moose_logs
WHERE trace_id = 'trace_abc'
ORDER BY timestamp;
```

**Result:** Complete timeline:
```
[INFO] HTTP request received
[DEBUG] Validated schema
[INFO] Produced to Kafka topic UserEvent
[DEBUG] Transform started (TypeScript)
[INFO] Transform output produced to UserEvent_Transformed
[DEBUG] Sync process consumed message
[INFO] Inserted to ClickHouse table UserEvent_Transformed
```

### Query 4: "What happened to this specific data record?"

**User has:** `message_id=msg_123`

**Query logs + ClickHouse:**
```sql
-- Check if in table
SELECT * FROM UserEvent WHERE message_id = 'msg_123';

-- Check processing logs
SELECT * FROM moose_logs WHERE message_id = 'msg_123';

-- Check if it was transformed
SELECT * FROM UserEvent_Transformed WHERE parent_message_id = 'msg_123';
```

---

## Edge Cases & Considerations

### 1. Batch Requests

**Problem:** Single HTTP request contains 1000 messages - what IDs apply?

**Solution:**
- **One `request_id`** for the HTTP request (all messages share it)
- **One `trace_id`** for the operation (all messages share it)
- **1000 `message_id`s** (one per message in the batch)

**Example:**
```json
POST /ingest/UserEvent [request_id: req_001, trace_id: trace_abc]
[
  { "message_id": "msg_001", "user_id": 1 },
  { "message_id": "msg_002", "user_id": 2 },
  ...
  { "message_id": "msg_1000", "user_id": 1000 }
]
```

**Logs:**
```
[INFO] request_id=req_001, trace_id=trace_abc - Received 1000 messages
[DEBUG] request_id=req_001, trace_id=trace_abc, message_id=msg_001 - Validating message
[DEBUG] request_id=req_001, trace_id=trace_abc, message_id=msg_002 - Validating message
...
[INFO] request_id=req_001, trace_id=trace_abc - Produced 1000 messages to Kafka
```

### 2. External Kafka Topics (Not Moose-managed)

**Problem:** Messages arriving from external systems have no `trace_id` or `message_id`.

**Solution:**
- **Generate `trace_id`** when consuming (marks start of Moose processing)
- **Generate `message_id`** if not present in payload
- **Log origin:** `external_topic=true` to indicate source

**Example:**
```rust
let trace_id = headers.get("trace_id")
    .unwrap_or_else(|| generate_trace_id()); // New trace starts here

let message_id = payload.get("message_id")
    .unwrap_or_else(|| generate_message_id()); // Assign ID

tracing::info!(
    trace_id = %trace_id,
    message_id = %message_id,
    external_topic = true,
    "Consuming from external Kafka topic"
);
```

### 3. Workflow/Temporal Tasks

**Problem:** Workflows spawn multiple tasks - how do IDs propagate?

**Solution:**
- **One `trace_id` for entire workflow** (created at workflow start)
- **Propagate via Temporal context** (automatic in Temporal SDK)
- **Each task logs with same `trace_id`**

**Example:**
```typescript
// Workflow start
const trace_id = context.workflowInfo.workflowId; // or generate new

// Task 1
await context.executeActivity('fetchData', { trace_id });

// Task 2
await context.executeActivity('processData', { trace_id });
```

### 4. Dead Letter Queue (DLQ)

**Problem:** Failed messages sent to DLQ - how to correlate?

**Solution:**
- **Preserve all IDs** in DLQ payload
- **Add failure metadata**

**DLQ Payload:**
```json
{
  "message_id": "msg_123",
  "trace_id": "trace_abc",
  "request_id": "req_001",
  "original_payload": { ... },
  "error": "Validation failed: missing required field 'user_id'",
  "failed_at": "2026-01-09T10:30:00Z",
  "source": "transform:user_event_to_session"
}
```

### 5. ClickHouse Materialized Views

**Problem:** Data flows through multiple tables - how to track?

**Solution:**
- **Preserve `message_id`** in all derived tables
- **Add `parent_message_id`** for lineage
- **Store `trace_id` for operation correlation**

**Example:**
```sql
-- Source table
CREATE TABLE UserEvent (
    message_id String,
    user_id UInt64,
    timestamp DateTime64(3)
);

-- Materialized view (aggregated)
CREATE TABLE UserSessionAgg (
    message_id String,              -- New aggregate record ID
    parent_message_ids Array(String), -- Source message IDs
    user_id UInt64,
    session_count UInt64,
    _trace_id String
) ENGINE = MergeTree();
```

---

## Summary

### Three IDs, Three Purposes

| ID | What It Tracks | Stored In | Used For |
|----|---------------|-----------|----------|
| `trace_id` | **Operation flow** | Logs, Kafka headers | End-to-end request tracing |
| `request_id` | **HTTP request** | Logs, HTTP headers | API debugging |
| `message_id` | **Data record** | Payload, ClickHouse | Data lineage, idempotency |

### Key Principles

1. **`trace_id` follows operations** - Propagates through all service boundaries
2. **`request_id` stays with HTTP** - Scoped to request/response cycle
3. **`message_id` stays with data** - Stored in the record itself

### Implementation Priority

**P0 (MVP):**
- ✅ `request_id` for HTTP requests
- ✅ `message_id` for data records

**Phase 2:**
- ✅ `trace_id` for distributed tracing (high value, addresses 6/10 user stories)

**Future:**
- Consider full OTel integration for spans, metrics correlation, and standard tooling

---

**Document Version:** 1.0
**Date:** 2026-01-09
**Related:** `P0_FILTERS.md`, `LOGGING_CURRENT_STATE.md`, `LOGGING_USER_STORIES.md`
