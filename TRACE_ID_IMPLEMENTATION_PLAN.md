# Trace ID Implementation Plan (Revised P0)

## Goal

Implement end-to-end request tracing through the entire Moose pipeline **without modifying user tables**.

**Core Principle:** Store trace context in **logs and Kafka headers only**. Users correlate back to their tables via business keys (user_id, timestamp, etc.).

---

## What We're Building

### Single ID for End-to-End Visibility

**`trace_id`**: A UUID that follows a request from HTTP → Kafka → Transform → ClickHouse

**Format:** UUID v7 (time-sortable)
**Example:** `01H3Z8X9Y2ABCDEFGHJKLMNPQR`

**Where it lives:**
- ✅ HTTP response header (`X-Trace-Id`)
- ✅ Kafka message headers
- ✅ Logs (Rust, TypeScript, Python)
- ❌ **NOT in user ClickHouse tables** (avoids migrations)

### Why This Works Without Table Columns

**Debugging flow:**
1. User makes request → receives `X-Trace-Id: abc123` in response
2. Query logs: `trace_id=abc123`
3. See operations: "Ingested 5 records" → "Inserted to UserEvent table at 10:30:00"
4. Correlate to table via business keys:
   ```sql
   SELECT * FROM UserEvent
   WHERE timestamp >= '10:30:00' AND timestamp < '10:30:01'
   ```

**Key insight:** Users don't need `trace_id` in the table if they can:
- See WHAT was inserted (count, timestamp) in logs
- Query their table by timestamp range or business keys
- Correlate via "around the same time" or known IDs

---

## Implementation Tasks

### Task 1: Generate trace_id at HTTP Entry Points

**Files to modify:**
- `/apps/framework-cli/src/cli/local_webserver.rs`

**Changes:**

#### 1.1: Add trace_id generation in router function

```rust
// In router() function (line ~1584)
async fn router(
    // ... existing params
) -> Result<Response<Full<Bytes>>, hyper::http::Error> {
    let now = Instant::now();

    // NEW: Generate or extract trace_id
    let trace_id = extract_or_generate_trace_id(&req);

    // NEW: Add to tracing context
    let _span = tracing::info_span!("http_request", trace_id = %trace_id);
    let _enter = _span.enter();

    tracing::info!("-> HTTP Request: {:?} - {:?}", req.method(), req.uri().path());

    // ... rest of function
}

// NEW: Helper function
fn extract_or_generate_trace_id(req: &Request<Incoming>) -> String {
    // Check if client provided trace_id in header
    req.headers()
        .get("X-Trace-Id")
        .and_then(|v| v.to_str().ok())
        .map(String::from)
        .unwrap_or_else(|| {
            // Generate new UUID v7
            uuid::Uuid::now_v7().to_string()
        })
}
```

#### 1.2: Return trace_id in response header

```rust
// In ingest_route() and consumption API handlers
Response::builder()
    .header("X-Trace-Id", trace_id.clone())
    .status(StatusCode::OK)
    .body(...)
```

**Validation:**
```bash
curl -X POST http://localhost:4000/ingest/UserEvent \
  -H "Content-Type: application/json" \
  -d '[{"user_id": 123}]' \
  -i

# Should see response header:
# X-Trace-Id: 01H3Z8X9Y2ABCDEFGHJKLMNPQR
```

**Estimated effort:** 2-3 hours

---

### Task 2: Propagate trace_id to Kafka Headers

**Files to modify:**
- `/apps/framework-cli/src/cli/local_webserver.rs` (send_to_kafka function)
- `/apps/framework-cli/src/infrastructure/stream/kafka/client.rs` (send_with_back_pressure function)

**Changes:**

#### 2.1: Update send_to_kafka to accept trace_id

```rust
// In local_webserver.rs (line ~1290)
async fn send_to_kafka<T: Iterator<Item = Vec<u8>>>(
    producer: &FutureProducer,
    topic_name: &str,
    records: T,
    trace_id: &str,  // NEW parameter
) -> Vec<Result<OwnedDeliveryResult, KafkaError>> {
    let mut res_arr: Vec<Result<OwnedDeliveryResult, KafkaError>> = Vec::new();
    let mut temp_res: Vec<Result<DeliveryFuture, KafkaError>> = Vec::new();

    // NEW: Create headers with trace_id
    let headers = OwnedHeaders::new()
        .insert(Header {
            key: "trace_id",
            value: Some(trace_id.as_bytes()),
        });

    for (count, payload) in records.enumerate() {
        tracing::trace!(
            trace_id = %trace_id,
            "Sending payload to topic: {}",
            topic_name
        );

        let record = FutureRecord::to(topic_name)
            .key(topic_name)
            .payload(payload.as_slice())
            .headers(headers.clone());  // NEW: Add headers

        temp_res.push(producer.send_result(record).map_err(|(e, _)| e));

        if count % 1024 == 1023 {
            wait_for_batch_complete(&mut res_arr, temp_res).await;
            temp_res = Vec::new();
        }
    }
    wait_for_batch_complete(&mut res_arr, temp_res).await;
    res_arr
}
```

#### 2.2: Update all callers of send_to_kafka

```rust
// In handle_json_array_body (line ~1399)
send_to_kafka(
    &configured_producer.producer,
    dlq,
    objects.into_iter().map(...),
    &trace_id,  // NEW: Pass trace_id
).await;

// Similar updates for other send_to_kafka calls
```

#### 2.3: Thread trace_id through function signatures

Update these functions to accept and pass `trace_id`:
- `handle_json_array_body()`
- `ingest_route()`
- Any other functions that call `send_to_kafka()`

**Validation:**
```bash
# Run moose dev, send request, check Kafka message headers
kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic UserEvent \
  --from-beginning \
  --property print.headers=true

# Should see header: trace_id:01H3Z8X9Y2ABCDEFGHJKLMNPQR
```

**Estimated effort:** 4-6 hours (threading through function signatures)

---

### Task 3: Extract trace_id in Kafka → ClickHouse Sync

**Files to modify:**
- `/apps/framework-cli/src/infrastructure/processes/kafka_clickhouse_sync.rs`

**Changes:**

#### 3.1: Extract trace_id from Kafka message headers

```rust
// In sync_to_table_with_inserter() function (around line 200-300)
async fn sync_to_table_with_inserter<E: Engine>(...) {
    // ... existing code ...

    loop {
        tokio::select! {
            message_result = consumer.recv() => {
                match message_result {
                    Ok(message) => {
                        // NEW: Extract trace_id from headers
                        let trace_id = message.headers()
                            .and_then(|headers| {
                                headers.iter()
                                    .find(|h| h.key == "trace_id")
                                    .and_then(|h| h.value)
                                    .and_then(|v| std::str::from_utf8(v).ok())
                            })
                            .unwrap_or("none");

                        // NEW: Add to tracing context
                        let _span = tracing::debug_span!(
                            "kafka_consume",
                            trace_id = %trace_id,
                            partition = message.partition(),
                            offset = message.offset()
                        );
                        let _enter = _span.enter();

                        tracing::debug!(
                            "Consumed message from partition {}, offset {}",
                            message.partition(),
                            message.offset()
                        );

                        // ... existing processing code ...
                    }
                }
            }
        }
    }
}
```

#### 3.2: Log trace_id during ClickHouse insert

```rust
// In batch flush logic (where inserter.write() is called)
tracing::info!(
    trace_id = %trace_id,  // NEW
    table = %table_name,
    count = batch.len(),
    "Inserting batch to ClickHouse"
);

inserter.write(&batch).await?;

tracing::debug!(
    trace_id = %trace_id,  // NEW
    "Batch insert completed"
);
```

**Validation:**
```bash
# Send request with trace_id, watch logs
grep "trace_id=01H3Z8X9Y2" ~/.moose/$(date +%Y-%m-%d)-cli.log

# Should see:
# [INFO] trace_id=01H3Z8X9Y2... - Consumed message from partition 0
# [INFO] trace_id=01H3Z8X9Y2... - Inserting batch to ClickHouse
```

**Estimated effort:** 3-4 hours

---

### Task 4: Extract trace_id in TypeScript Transforms

**Files to modify:**
- `/packages/ts-moose-lib/src/streaming-functions.ts` (or equivalent)

**Changes:**

#### 4.1: Extract trace_id from Kafka message

```typescript
// In transform execution wrapper
async function executeTransform(message: KafkaMessage, transform: Function) {
  // NEW: Extract trace_id from headers
  const trace_id = message.headers?.find(h => h.key === 'trace_id')?.value?.toString() || 'none';

  // NEW: Add to logger context
  const logger = new Logger('Transform', { trace_id });

  logger.log(`Executing transform on message`);

  try {
    const result = await transform(message.value, logger);

    logger.log(`Transform completed`);

    // NEW: Propagate trace_id to output message headers
    return {
      value: result,
      headers: [{ key: 'trace_id', value: trace_id }]
    };
  } catch (error) {
    logger.error(`Transform failed: ${error.message}`);
    throw error;
  }
}
```

#### 4.2: Update Logger to accept trace_id context

```typescript
// In commons.ts
interface Logger {
  logPrefix: string;
  trace_id?: string;  // NEW
  log: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
}

class LoggerImpl implements Logger {
  constructor(
    public logPrefix: string,
    private context?: { trace_id?: string }  // NEW
  ) {}

  log(message: string) {
    const prefix = this.context?.trace_id
      ? `[${this.logPrefix}] [trace_id=${this.context.trace_id}]`
      : `[${this.logPrefix}]`;
    console.log(`${prefix} ${message}`);
  }

  // Similar for error(), warn()
}
```

**Validation:**
```bash
# Check transform logs (sent to management server or stdout)
# Should see: [Function: foo_to_bar] [trace_id=01H3Z8X9Y2...] Processing message
```

**Estimated effort:** 3-4 hours

---

### Task 5: Extract trace_id in Python Transforms

**Files to modify:**
- `/packages/py-moose-lib/moose_lib/streaming_functions.py` (or equivalent)

**Changes:**

#### 5.1: Extract trace_id from Kafka message

```python
# In transform execution wrapper
async def execute_transform(message: KafkaMessage, transform: Callable):
    # NEW: Extract trace_id from headers
    trace_id = next(
        (h.value.decode('utf-8') for h in message.headers() if h[0] == 'trace_id'),
        'none'
    )

    # NEW: Add to logger context
    logger = Logger(action='Transform', trace_id=trace_id)

    logger.info('Executing transform on message')

    try:
        result = await transform(message.value(), logger)

        logger.info('Transform completed')

        # NEW: Propagate trace_id to output
        return {
            'value': result,
            'headers': [('trace_id', trace_id.encode('utf-8'))]
        }
    except Exception as e:
        logger.error(f'Transform failed: {str(e)}')
        raise
```

#### 5.2: Update Logger to accept trace_id

```python
# In commons.py
class Logger:
    def __init__(
        self,
        action: Optional[str] = None,
        trace_id: Optional[str] = None  # NEW
    ):
        self.action = action
        self.trace_id = trace_id  # NEW

    def _format_message(self, level: str, message: str) -> str:
        prefix = f"[{self.action}]" if self.action else ""
        trace_prefix = f"[trace_id={self.trace_id}]" if self.trace_id else ""
        return f"{prefix}{trace_prefix} {message}"

    def info(self, message: str):
        print(self._format_message("INFO", message))

    # Similar for error(), warn()
```

**Validation:**
```bash
# Check Python transform logs
# Should see: [Transform][trace_id=01H3Z8X9Y2...] Executing transform
```

**Estimated effort:** 3-4 hours

---

### Task 6: Add trace_id to Structured Logging (P0 Filters)

**Files to modify:**
- `/apps/framework-cli/src/cli/logger.rs`

**Changes:**

#### 6.1: Ensure trace_id is captured in log output

The `tracing` library already captures span fields, so if we use `tracing::info_span!("operation", trace_id = %trace_id)`, it should appear in logs automatically.

**Verify JSON log format includes trace_id:**
```rust
// In logger.rs, ensure JSON formatter includes span fields
let json_layer = tracing_subscriber::fmt::layer()
    .json()
    .with_span_list(true)  // Include span context
    .with_current_span(true);  // Include current span fields
```

**Expected log output:**
```json
{
  "timestamp": "2026-01-09T10:30:00.123Z",
  "level": "INFO",
  "target": "moose_cli::cli::local_webserver",
  "fields": {
    "message": "Inserting batch to ClickHouse",
    "trace_id": "01H3Z8X9Y2ABCDEFGHJKLMNPQR",
    "table": "UserEvent",
    "count": 100
  }
}
```

**Validation:**
```bash
# Enable JSON logging
MOOSE_LOGGER__FORMAT=json moose dev

# Check log output
tail -f ~/.moose/$(date +%Y-%m-%d)-cli.log | jq '.fields.trace_id'
```

**Estimated effort:** 2 hours (mostly validation)

---

### Task 7: Update P0 Filters to Support trace_id

**Files to modify:**
- Update log storage schema to index `trace_id`
- Update log query UI to filter by `trace_id`

**This depends on your log storage backend:**

#### Option A: Logs stored in ClickHouse

```sql
-- Update log table schema
CREATE TABLE moose_logs (
    timestamp DateTime64(3),
    level Enum8('TRACE'=0, 'DEBUG'=1, 'INFO'=2, 'WARN'=3, 'ERROR'=4),
    context Enum8('runtime'=0, 'deploy'=1, 'system'=2),
    resource_type LowCardinality(String),
    resource_name String,
    trace_id String,  -- NEW: Indexed for fast queries
    message String,
    module_path String,

    INDEX trace_id_idx trace_id TYPE bloom_filter GRANULARITY 1
) ENGINE = MergeTree()
ORDER BY (context, resource_name, timestamp);
```

#### Option B: Logs in external system (Loki, Elastic)

Configure to extract and index `trace_id` field from JSON logs.

**Estimated effort:** 4-6 hours (depends on storage backend)

---

## Implementation Order

### Week 1: Core Propagation

**Days 1-2:**
- ✅ Task 1: Generate trace_id at HTTP entry (2-3 hours)
- ✅ Task 2: Propagate to Kafka headers (4-6 hours)
- ✅ Validation: End-to-end test (HTTP → Kafka)

**Days 3-4:**
- ✅ Task 3: Extract in Kafka→ClickHouse sync (3-4 hours)
- ✅ Task 4: Extract in TypeScript transforms (3-4 hours)
- ✅ Validation: End-to-end test (HTTP → Kafka → Transform → ClickHouse)

**Day 5:**
- ✅ Task 5: Extract in Python transforms (3-4 hours)
- ✅ Task 6: Verify structured logging (2 hours)
- ✅ Validation: Full pipeline test

### Week 2: Storage & Querying

**Days 1-3:**
- ✅ Task 7: Update log storage to index trace_id (4-6 hours)
- ✅ Build UI filter for trace_id
- ✅ Documentation

**Days 4-5:**
- ✅ End-to-end testing with user stories
- ✅ Bug fixes and polish

---

## Validation Plan

### Test 1: Basic Propagation

```bash
# 1. Send request
curl -X POST http://localhost:4000/ingest/UserEvent \
  -H "Content-Type: application/json" \
  -d '[{"user_id": 123, "event": "click"}]' \
  -i

# 2. Capture trace_id from response header
TRACE_ID=<from X-Trace-Id header>

# 3. Query logs
grep "trace_id=$TRACE_ID" ~/.moose/$(date +%Y-%m-%d)-cli.log

# Expected output:
# [INFO] trace_id=... - Produced to Kafka topic UserEvent
# [DEBUG] trace_id=... - Consumed message from partition 0
# [INFO] trace_id=... - Inserting batch to ClickHouse
```

### Test 2: Cross-Language Propagation (with Transform)

```bash
# 1. Send request that triggers transform
curl -X POST http://localhost:4000/ingest/RawEvent \
  -H "Content-Type: application/json" \
  -d '[{"raw_data": "test"}]' \
  -i

TRACE_ID=<from X-Trace-Id header>

# 2. Check Rust logs
grep "trace_id=$TRACE_ID" ~/.moose/$(date +%Y-%m-%d)-cli.log

# 3. Check TypeScript transform logs (stdout or management server)
# Should see: [Transform][trace_id=...] Processing message

# 4. Check downstream ClickHouse insert
# Should see: [INFO] trace_id=... - Inserting to ProcessedEvent table
```

### Test 3: User Story Validation

**US-1: Data not appearing in table**

```bash
# User reports: "Data not in my UserEvent table"
# User provides: trace_id from HTTP response

# Query logs:
SELECT * FROM moose_logs
WHERE trace_id = '<user_provided_trace_id>'
ORDER BY timestamp;

# Identify failure point:
# - If "Produced to Kafka" but no "Consumed" → Kafka issue
# - If "Consumed" but no "Inserting to ClickHouse" → Transform issue
# - If "Inserting" but not in table → ClickHouse issue
```

---

## What Users Get

### 1. End-to-End Visibility

**Before (today):**
```
User: "My data isn't appearing in the table"
You: "Let me check logs... but I can't connect the HTTP request to the ClickHouse insert"
```

**After (with trace_id):**
```
User: "My data isn't appearing, trace_id: abc123"
You: Query logs by trace_id → "Transform failed with validation error on field X"
```

### 2. Debugging Workflow

```
1. Make API request → Get X-Trace-Id in response
2. Query logs: WHERE trace_id = 'abc123'
3. See full flow:
   - [10:30:00.100] HTTP POST /ingest/UserEvent
   - [10:30:00.150] Validated 5 records
   - [10:30:00.200] Produced to Kafka topic UserEvent
   - [10:30:00.300] Transform started
   - [10:30:00.400] Transform completed, 5 outputs
   - [10:30:00.500] Inserted 5 records to ClickHouse table UserEvent
4. Correlate to table: SELECT * FROM UserEvent WHERE timestamp >= '10:30:00.5'
```

### 3. No User Table Changes

- ✅ No schema migrations needed
- ✅ No breaking changes to existing data
- ✅ Users correlate via business keys (user_id, timestamp, etc.)
- ✅ Can add table columns later (Phase 2) if needed

---

## Future Enhancements (Phase 2)

Once basic trace_id is working:

1. **Add message_id to tables (optional)**
   - For users who want "did THIS specific record arrive?" queries
   - Non-breaking: nullable column, gradually populated

2. **Migrate to OTel standard**
   - W3C Trace Context (`traceparent` header)
   - Parent/child spans for timing analysis
   - Standard tooling (Jaeger, Tempo)

3. **Add span timing**
   - See "transform took 500ms" vs "ClickHouse insert took 2s"
   - Performance debugging (US-2, US-10)

4. **Add request_id for HTTP-specific context**
   - Differentiate HTTP request from async pipeline
   - More granular HTTP debugging

---

## Success Metrics

### Coverage of User Stories (P0 Filters)

| User Story | Before | After |
|------------|--------|-------|
| US-1: Data not appearing | ❌ Blind spots | ✅ Full visibility |
| US-2: Slow transform | ⚠️ Partial | ✅ Can identify bottleneck |
| US-3: 500 errors | ⚠️ Partial | ✅ Full error context |
| US-6: Transform wrong output | ❌ No visibility | ✅ Can trace execution |
| US-7: Monitor deployment | ✅ Works today | ✅ Still works |
| US-8: Find all errors | ✅ Works today | ✅ + trace correlation |
| US-9: Workflow failure | ❌ No visibility | ✅ Can trace workflow |

**Result:** 6/10 user stories fully addressed (vs 0/10 today)

### Implementation Metrics

- **Time to implement:** 2 weeks
- **Breaking changes:** 0
- **User table migrations:** 0
- **Lines of code changed:** ~500-800
- **Languages touched:** Rust, TypeScript, Python (full stack)

---

## Open Questions

1. **Log storage backend:** Where are logs stored for querying?
   - ClickHouse? → Need table schema
   - Loki? → Need label extraction
   - Files only? → Need query tool

2. **Transform infrastructure:** How are TypeScript/Python functions executed?
   - Separate processes? → Need IPC for trace_id
   - Inline? → Easy to pass context

3. **Existing trace infrastructure:** Any OpenTelemetry already in use?
   - If yes → Build on that
   - If no → Start with simple UUID

---

**Document Version:** 1.0
**Date:** 2026-01-09
**Related:** `P0_FILTERS.md`, `ID_STRATEGY.md`, `LOGGING_USER_STORIES.md`
