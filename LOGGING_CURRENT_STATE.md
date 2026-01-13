# Moose Logging - Current State Analysis

## Document Purpose

This document captures the **current state** of logging in Moose apps as of 2026-01-09. It serves as a baseline for understanding what logging capabilities exist today before designing improvements.

---

## 1. Current Logging Infrastructure

### 1.1 Rust CLI Logging

**Library:** `tracing` (0.1.40) + `tracing-subscriber` (0.3)

**Configuration:**
- File: `src/cli/logger.rs`
- Log location: `~/.moose/YYYY-MM-DD-cli.log` (daily rotation)
- Retention: 7 days automatic cleanup
- Levels: DEBUG, INFO, WARN, ERROR

**Output Formats:**
- **Legacy Text:** `[timestamp LEVEL - target] message`
- **Legacy JSON:** `{"timestamp": "...", "severity": "INFO", "target": "...", "message": "..."}`
- **Modern Format:** Opt-in via `MOOSE_LOGGER__USE_TRACING_FORMAT=true`

**Environment Variables:**
```bash
RUST_LOG=moose_cli::infrastructure=debug    # Standard Rust log filtering
MOOSE_LOGGER__LEVEL=Debug                   # Set log level
MOOSE_LOGGER__STDOUT=true                   # Output to stdout
MOOSE_LOGGER__FORMAT=json                   # Text or JSON
MOOSE_LOGGER__USE_TRACING_FORMAT=true       # Enable modern format
MOOSE_LOGGER__INCLUDE_SESSION_ID=true       # Include session ID
MOOSE_LOGGER__NO_ANSI=true                  # Disable colors
```

**Current Context Fields:**
- `CTX_SESSION_ID` - UUID for the CLI session (stored in static HashMap)
- `metadata.target()` - Module path (e.g., `moose_cli::infrastructure`)

**Example Log Output:**
```
[2026-01-09T10:15:23.456Z INFO - moose_cli::cli::routines] Running build command
[2026-01-09T10:15:23.789Z DEBUG - moose_cli::infrastructure] Loading InfrastructureMap from primitives
[2026-01-09T10:15:24.123Z WARN - moose_cli::infrastructure::redis] Failed to store connection string: RedisError
```

### 1.2 TypeScript Library Logging

**Logger Interface:** Custom (defined in `packages/ts-moose-lib/src/commons.ts`)

```typescript
interface Logger {
  logPrefix: string;
  log: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
}
```

**Log Destinations:**
- HTTP POST to management server (`http://localhost:5001/logs`)
- Console output for CLI operations
- Temporal `DefaultLogger` for workflow workers

**Log Structure (CLI Logs):**
```typescript
{
  message_type: "Info" | "Success" | "Error" | "Highlight",
  action: string,        // e.g., "Function", "Custom"
  message: string
}
```

**Streaming Function Logger:**
- Prefixed with source/target topic info
- Example: `[source: Foo → target: Bar] Processing message`

### 1.3 Python Library Logging

**Logger Class:** Custom (defined in `packages/py-moose-lib/moose_lib/commons.py`)

```python
class Logger:
    def __init__(self, action: Optional[str] = None, is_moose_task: bool = False)
    def info(self, message: str) -> None
    def success(self, message: str) -> None
    def error(self, message: str) -> None
    def highlight(self, message: str) -> None
```

**Log Destinations:**
- **Moose Tasks:** Python `logging` module (logger name: `"moose-scripts"`)
- **User Code:** HTTP POST to management server via `cli_log()`

**Log Structure:**
```python
{
  "message_type": "Info" | "Success" | "Error" | "Highlight",
  "action": str,
  "message": str
}
```

---

## 2. What Dimensions Are Currently Available

### ✅ Available Today

| Dimension | Available? | How Accessed | Example |
|-----------|-----------|--------------|---------|
| **Session ID** | ✅ Yes | `CTX_SESSION_ID` in Rust | `550e8400-e29b-41d4-a716-446655440000` |
| **Module Path** | ✅ Yes | `metadata.target()` | `moose_cli::infrastructure::olap` |
| **Log Level** | ✅ Yes | DEBUG/INFO/WARN/ERROR | `ERROR` |
| **Timestamp** | ✅ Yes | Automatic in all logs | `2026-01-09T10:15:23.456Z` |
| **Message** | ✅ Yes | Log text | `"Running build command"` |
| **Kafka Partition** | ✅ Partial | Captured in sync process | `2` |
| **Kafka Offset** | ✅ Partial | Captured in sync process | `1234567` |
| **Topic Name** | ✅ Partial | In streaming function logs | `"Foo"` |
| **Consumer Group** | ✅ Partial | In metrics only | `"clickhouse_sync"` |
| **HTTP Route** | ✅ Partial | In metrics only | `"/ingest/Foo"` |
| **HTTP Method** | ✅ Partial | In metrics only | `"POST"` |
| **Latency** | ✅ Partial | In metrics only | `0.125` seconds |

### ❌ NOT Available Today

| Dimension | Status | Notes |
|-----------|--------|-------|
| **Request ID** | ❌ Missing | No HTTP request UUID generated |
| **Trace ID** | ❌ Missing | No distributed tracing context |
| **Correlation ID** | ❌ Missing | HTTP → Kafka → ClickHouse not linked |
| **User Primitive Name** | ❌ Missing | Pipeline/table/transform names not in logs |
| **Operation Phase** | ❌ Missing | No discovery/planning/execution tags |
| **Error Category** | ❌ Missing | Errors are typed but not tagged in logs |
| **Infrastructure Operation** | ❌ Missing | DDL/query/produce/consume not categorized |
| **Performance Context** | ❌ Missing | Batch size, throughput not in logs |
| **Security Events** | ❌ Missing | Auth success/failure only at DEBUG level |
| **Language Runtime** | ❌ Missing | No tag for Rust/TypeScript/Python |
| **Data Lineage** | ❌ Missing | Source/target not structured |
| **Structured Fields** | ❌ Missing | Logs are plain strings, not structured |

---

## 3. Current Log Examples (Real Output)

### 3.1 CLI Startup
```
[2026-01-09T10:15:20.123Z INFO - moose_cli::cli] Moose CLI v0.6.0
[2026-01-09T10:15:20.456Z DEBUG - moose_cli::project] Loading project from /path/to/project
[2026-01-09T10:15:20.789Z INFO - moose_cli::cli::routines] Starting development server
```

### 3.2 File Watcher
```
[2026-01-09T10:15:25.123Z DEBUG - moose_cli::cli::routines::file_watcher] File changed: datamodels/Foo.ts
[2026-01-09T10:15:25.456Z INFO - moose_cli::infrastructure] Reconciling infrastructure map with actual database state
```

### 3.3 ClickHouse Operations
```
[2026-01-09T10:15:30.123Z INFO - moose_cli::infrastructure::olap::clickhouse] Executing CREATE TABLE Bar
[2026-01-09T10:15:30.456Z DEBUG - moose_cli::infrastructure::olap::clickhouse] Table created successfully
[2026-01-09T10:15:30.789Z ERROR - moose_cli::infrastructure::olap::clickhouse] Query execution failed: Connection timeout
```

### 3.4 Kafka Operations
```
[2026-01-09T10:15:35.123Z INFO - moose_cli::infrastructure::stream::kafka] Creating topic: Foo with 3 partitions
[2026-01-09T10:15:35.456Z DEBUG - moose_cli::infrastructure::stream::kafka] Topic created successfully
```

### 3.5 HTTP Requests
```
[2026-01-09T10:15:40.123Z DEBUG - moose_cli::cli::local_webserver] -> HTTP Request: POST - /ingest/Foo
[2026-01-09T10:15:40.456Z TRACE - moose_cli::metrics] Metrics event: IngestedEvent { topic: "Foo", count: 1, latency: 12ms }
```

### 3.6 Streaming Functions (TypeScript)
```
[Function: foo_to_bar] Processing message from topic Foo
[Function: foo_to_bar] Transformed 1 record
[Function: foo_to_bar] Error processing message: TypeError: Cannot read property 'x' of undefined
```

### 3.7 Authentication
```
[2026-01-09T10:15:45.123Z DEBUG - moose_cli::cli::local_webserver] Validating admin authentication
[2026-01-09T10:15:45.456Z DEBUG - moose_cli::cli::local_webserver] Token validation successful
```

---

## 4. Metrics Collection (Separate from Logs)

Moose collects **metrics** separately via Prometheus client:

**Available Metrics:**
- `moose_latency` - Request latency histogram (by endpoint)
- `moose_http_to_topic_event_count` - Messages ingested
- `moose_topic_to_olap_event_count` - Messages persisted to ClickHouse
- `moose_streaming_functions_events_input_count` - Transform input
- `moose_streaming_functions_events_output_count` - Transform output
- `moose_ingested_bytes` - Byte throughput (ingest)
- `moose_consumed_bytes` - Byte throughput (consumption)

**Exposure:**
- Prometheus text format at `/metrics`
- Visualized in metrics console

**Key Insight:** Metrics have rich context (topic, function, endpoint) that logs lack.

---

## 5. Error Handling (Current State)

### 5.1 Error Types (Defined with `thiserror`)

**Hierarchical Structure:**
```
ExecutionError
├── OlapChange(OlapChangesError)
│   ├── Clickhouse(ClickhouseError)
│   └── LifecycleViolation
├── StreamingChange(StreamingChangesError)
│   └── RedpandaChanges(KafkaChangesError)
├── ApiChange(ApiChangeError)
└── LeadershipCheckFailed
```

**Error Categories (Examples):**
- Connection errors (transient)
- Timeout errors (retryable)
- Parsing errors (non-retryable)
- Validation errors (configuration issues)
- Type conversion errors (data issues)
- Authentication/authorization errors

### 5.2 Dead Letter Queue

**Purpose:** Capture failed messages from transforms/consumers

**Implementation:**
- Failed records routed to separate Kafka topic
- Optional per-transform/consumer
- Stored in ClickHouse table for debugging

**Current Logging:**
- Errors logged at ERROR level with message
- No structured DLQ event tracking

### 5.3 Retry Logic

**Retry Utility:** `utilities/retry.rs`
- Exponential backoff (configurable)
- Custom `should_retry()` predicate per operation
- Used for: Redis, Kafka, ClickHouse, framework scripts

**Current Logging:**
```
[WARN] Retrying operation (attempt 2/10)
[DEBUG] Error is ConnectionTimeout. Will retry.
```

---

## 6. Current Filtering Capabilities

### 6.1 Rust Logs (via `RUST_LOG`)

**Module-level filtering:**
```bash
# All logs from infrastructure module
RUST_LOG=moose_cli::infrastructure=debug

# Multiple modules
RUST_LOG=moose_cli::infrastructure=debug,moose_cli::cli=info

# All debug logs
RUST_LOG=debug
```

**By severity:**
```bash
MOOSE_LOGGER__LEVEL=Debug  # or Info, Warn, Error
```

### 6.2 TypeScript/Python Logs

**No filtering available** - logs go directly to management server or stdout.

### 6.3 Cross-Language Correlation

**Current State:** ❌ Not possible
- Rust, TypeScript, and Python logs are separate
- No shared trace/correlation ID
- No way to follow a single request across languages

---

## 7. Log Storage and Access

### 7.1 Storage Locations

- **Rust CLI:** `~/.moose/YYYY-MM-DD-cli.log`
- **TypeScript/Python:** Sent to management server (no persistent storage documented)
- **External services:** Docker container logs (stdout/stderr)

### 7.2 Access Methods

- **File reading:** `tail -f ~/.moose/2026-01-09-cli.log`
- **Filtering:** `grep`, `awk`, manual text processing
- **No built-in log query tool**

### 7.3 Retention

- **Rust logs:** 7 days automatic cleanup
- **TypeScript/Python logs:** No documented retention policy
- **Metrics:** No persistent storage (Prometheus scraping only)

---

## 8. Gaps Summary

### 8.1 Structural Gaps

1. **No structured logging fields** - Logs are plain text strings
2. **No cross-language correlation** - Rust/TS/Python isolated
3. **No request tracing** - HTTP → Kafka → ClickHouse not linked
4. **Metrics separate from logs** - Rich context only in metrics

### 8.2 Context Gaps

1. **No user primitive names** - Pipeline/table/transform names missing
2. **No operation phase tags** - Discovery/planning/execution not labeled
3. **No error categorization** - Error types not tagged for filtering
4. **No performance context** - Batch size, throughput, lag not in logs

### 8.3 Filtering Gaps

1. **Module-level only** - Cannot filter by component type, operation, etc.
2. **No semantic filtering** - Cannot filter by "all transform errors"
3. **No trace queries** - Cannot follow a single data flow
4. **No time-based queries** - No built-in log search tool

### 8.4 Security Gaps

1. **Auth events at DEBUG only** - Not surfaced at production log levels
2. **No audit trail** - Who did what when is not tracked
3. **No security event categorization** - Auth failures not tagged

---

## 9. What Works Well Today

### ✅ Strengths

1. **Solid foundation** - `tracing` crate is production-ready
2. **Multiple output formats** - Text and JSON available
3. **Log rotation** - Automatic daily rotation and cleanup
4. **Module filtering** - Fine-grained control via `RUST_LOG`
5. **Configurable levels** - Easy to adjust verbosity
6. **Error context** - `thiserror` provides rich error chains
7. **Metrics infrastructure** - Good operational visibility

### ✅ What Users Can Do Now

1. Debug issues by reading log files
2. Filter logs by module and severity
3. Correlate with metrics dashboard
4. View error stack traces and context
5. Monitor via `tail -f` or log aggregators

---

## 10. Key Insights for Improvement

Based on this analysis, the **highest value improvements** would be:

1. **Add structured fields** to existing logs (not just strings)
2. **Implement trace IDs** for request correlation
3. **Tag logs with user primitives** (pipeline, table, function names)
4. **Categorize errors** for easier filtering
5. **Unify metrics and logs** with shared context
6. **Add semantic filtering** (by component type, operation, etc.)
7. **Build log query tool** for user-friendly access

---

## Next Steps

This document establishes the **baseline**. Next, we will:

1. ✅ Document current state (this document)
2. ⏭️ Define user stories for log use cases
3. ⏭️ Design partitioned logging system
4. ⏭️ Implement structured logging with dimensions
5. ⏭️ Build filtering and query capabilities

---

## References

- Research agents: a9e2752, afde6c1, a596304, aa13caa, ae01595, a90710a, a05ff56, adca876
- Key files:
  - `/apps/framework-cli/src/cli/logger.rs` - Rust logging config
  - `/apps/framework-cli/src/metrics.rs` - Metrics collection
  - `/packages/ts-moose-lib/src/commons.ts` - TypeScript logger interface
  - `/packages/py-moose-lib/moose_lib/commons.py` - Python logger class

---

**Document Version:** 1.0
**Date:** 2026-01-09
**Research Session:** master branch, commit 37a6be7
