# Implement End-to-End Request Tracing with trace_id

## Summary

Add `trace_id` propagation through the entire Moose pipeline (HTTP → Kafka → Transform → ClickHouse) to enable end-to-end debugging via logs. No user table changes required.

**User benefit:** Query logs by `trace_id` to see complete flow of any request and identify where data was lost or failed.

**Estimated effort:** 2 weeks

---

## Implementation Tasks

### 1. Generate trace_id at HTTP Entry
**Files:** `apps/framework-cli/src/cli/local_webserver.rs`

- [ ] Generate UUID v7 in `router()` function OR extract from `X-Trace-Id` request header
- [ ] Add trace_id to tracing span context: `tracing::info_span!("http_request", trace_id = %trace_id)`
- [ ] Return `X-Trace-Id` header in HTTP response
- [ ] Log trace_id for all HTTP operations

**Validation:** `curl -i POST /ingest/Foo` returns `X-Trace-Id` header

---

### 2. Propagate trace_id to Kafka Headers
**Files:** `apps/framework-cli/src/cli/local_webserver.rs`, `apps/framework-cli/src/infrastructure/stream/kafka/client.rs`

- [ ] Update `send_to_kafka()` to accept `trace_id` parameter
- [ ] Create Kafka headers with trace_id: `OwnedHeaders::new().insert(Header { key: "trace_id", value: ... })`
- [ ] Add headers to `FutureRecord` when producing to Kafka
- [ ] Thread `trace_id` through function signatures (`handle_json_array_body`, `ingest_route`, etc.)

**Validation:** Kafka messages have `trace_id` header (check with kafka-console-consumer --property print.headers=true)

---

### 3. Extract trace_id in Kafka → ClickHouse Sync
**Files:** `apps/framework-cli/src/infrastructure/processes/kafka_clickhouse_sync.rs`

- [ ] Extract trace_id from Kafka message headers in `sync_to_table_with_inserter()`
- [ ] Add trace_id to tracing span when consuming messages
- [ ] Log trace_id during batch processing and ClickHouse inserts

**Validation:** Grep logs for trace_id during sync process: `grep "trace_id=abc123" ~/.moose/*.log`

---

### 4. Extract trace_id in TypeScript Transforms
**Files:** `packages/ts-moose-lib/src/streaming-functions.ts` (or equivalent)

- [ ] Extract trace_id from Kafka message headers
- [ ] Pass trace_id to Logger context
- [ ] Update Logger class to accept and log trace_id
- [ ] Propagate trace_id to output message headers

**Validation:** Transform logs show trace_id: `[Transform][trace_id=abc123] Processing message`

---

### 5. Extract trace_id in Python Transforms
**Files:** `packages/py-moose-lib/moose_lib/streaming_functions.py`, `packages/py-moose-lib/moose_lib/commons.py`

- [ ] Extract trace_id from Kafka message headers
- [ ] Pass trace_id to Logger context
- [ ] Update Logger class to accept and log trace_id
- [ ] Propagate trace_id to output message headers

**Validation:** Python transform logs show trace_id

---

### 6. Verify Structured Logging Output
**Files:** `apps/framework-cli/src/cli/logger.rs`

- [ ] Ensure JSON log format includes trace_id field
- [ ] Verify `tracing` span fields are included in log output
- [ ] Test with `MOOSE_LOGGER__FORMAT=json moose dev`

**Validation:** JSON logs contain `"trace_id": "..."` field

---

### 7. Update Log Storage & Querying
**Files:** TBD (depends on log storage backend)

- [ ] Add trace_id index to log storage (ClickHouse, Loki, or other)
- [ ] Create query interface for filtering by trace_id
- [ ] Update P0 filters UI to support trace_id search

**Validation:** Can query logs by trace_id and get chronological timeline

---

## Testing Checklist

### Basic Flow
- [ ] Send HTTP request, capture `X-Trace-Id` from response
- [ ] Query logs by trace_id, see all operations (HTTP → Kafka → ClickHouse)
- [ ] Verify trace_id appears in Kafka message headers
- [ ] Verify trace_id appears in all log entries for that request

### Cross-Language Propagation
- [ ] Send request that triggers TypeScript transform
- [ ] Verify trace_id propagates through transform logs
- [ ] Send request that triggers Python transform
- [ ] Verify trace_id propagates through transform logs

### Error Scenarios
- [ ] Send invalid data, verify trace_id in error logs
- [ ] Trigger validation failure, verify trace_id in DLQ logs
- [ ] Simulate transform failure, verify trace_id in error logs

### User Story Validation
- [ ] US-1: "Data not appearing in table" - Query trace_id to identify failure point
- [ ] US-3: "500 error" - Use trace_id from response to debug
- [ ] US-6: "Transform wrong output" - Trace execution through transform logs

---

## Success Criteria

✅ **HTTP requests return X-Trace-Id header**
✅ **trace_id propagates through Kafka headers**
✅ **All logs (Rust/TypeScript/Python) include trace_id**
✅ **Can query logs by trace_id to get complete request timeline**
✅ **No changes to user tables** (zero migrations)
✅ **6/10 user stories from P0_FILTERS.md are addressed**

---

## Out of Scope (Future Work)

- Adding trace_id as column in user ClickHouse tables (Phase 2)
- Full OpenTelemetry integration with spans (Phase 2)
- Performance timing analysis (Phase 2)
- Adding message_id for data lineage (Phase 2)

---

## Dependencies

- Requires Kafka headers support (already available in rdkafka)
- Requires tracing infrastructure (already in place)
- May require log storage backend update (investigate current setup)

---

## Notes

**How it works:**
1. Generate UUID at HTTP entry
2. Pass through Kafka headers
3. Log at every operation
4. Query logs by UUID → get complete timeline

**No complex infrastructure needed** - just pass a UUID around and log it everywhere.

**User workflow:**
```bash
# 1. Make request
curl -i POST /ingest/UserEvent -d '[{...}]'
# Get: X-Trace-Id: abc123

# 2. Query logs
SELECT * FROM moose_logs WHERE trace_id = 'abc123' ORDER BY timestamp;

# 3. See complete flow:
# [10:30:00] HTTP received
# [10:30:01] Kafka produced
# [10:30:02] Transform executed
# [10:30:03] ClickHouse inserted
```

---

## Related Documents

- `P0_FILTERS.md` - User stories and filter requirements
- `ID_STRATEGY.md` - Full explanation of trace_id vs request_id vs message_id
- `TRACE_ID_IMPLEMENTATION_PLAN.md` - Detailed implementation guide
