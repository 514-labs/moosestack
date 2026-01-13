# Moose Logging - User Stories & Use Cases

## Document Purpose

This document captures user personas and their logging needs to drive the design of partitioned/filterable logging in Moose. Each story includes the persona, scenario, current pain points, and desired capabilities.

---

## Personas

### 👨‍💻 **Alex - Application Developer**
Building a Moose app with streaming data pipelines. Writes data models, transforms, and APIs. Needs to debug data flow issues and understand application behavior during development.

### 🔧 **Jordan - Platform/DevOps Engineer**
Responsible for running Moose apps in production. Monitors system health, investigates incidents, and ensures SLAs are met. Needs operational visibility and alerting.

### 📊 **Sam - Data Engineer**
Designs and maintains data pipelines. Concerned with data quality, completeness, and performance. Needs to trace data lineage and debug transformation issues.

### 🔒 **Riley - Security/Compliance Officer**
Ensures systems meet security and compliance requirements. Needs audit trails, authentication logs, and ability to investigate security incidents.

### 🆘 **Morgan - On-Call Engineer**
Responds to production incidents at 2 AM. Needs to quickly identify root cause and understand system state. Time is critical.

---

## User Stories

### US-1: Debug Why Data Isn't Appearing in a Table

**Persona:** Alex (Developer) / Sam (Data Engineer)

**Scenario:**
Alex deploys a new `UserEvent` data model with an ingest pipeline. Data is being sent to `/ingest/UserEvent`, but the `UserEvent` table in ClickHouse remains empty.

**Current Pain Points:**
- Needs to check multiple places: HTTP logs, Kafka topic, ClickHouse logs
- No visibility into topic-to-table sync process
- Cannot tell if data was accepted, rejected, or stuck
- No correlation between HTTP request and table insertion

**Desired Capability:**
```bash
# Show all logs related to UserEvent pipeline
moose logs --filter name=UserEventPipeline

# Follow a specific request through the pipeline
moose logs --trace <request-id>

# Show only sync process logs for this table
moose logs --filter type=olap_table,name=UserEvent --filter layer=sync
```

**Expected Output:**
```
[INFO] HTTP POST /ingest/UserEvent - request_id=abc123, status=200, latency=12ms
[DEBUG] Kafka produce - topic=UserEvent, partition=2, offset=45678, request_id=abc123
[INFO] Sync process - consuming from UserEvent, partition=2, offset=45678
[ERROR] ClickHouse insert failed - table=UserEvent, error=TypeConversionError, request_id=abc123
  ↳ Field 'timestamp' expects DateTime but got String
```

**Value:** Quickly identify that data validation is failing during ClickHouse insertion.

**Required Dimensions:**
- User primitive name (`UserEventPipeline`, `UserEvent`)
- Request/trace ID correlation
- Layer filtering (webserver → streaming → storage)
- Error categorization

---

### US-2: Investigate Slow Transform Performance

**Persona:** Sam (Data Engineer)

**Scenario:**
The `user_event_to_session` transform is processing messages slowly. Sam needs to identify if it's a code issue, external API latency, or batching problem.

**Current Pain Points:**
- Transform logs mixed with all other logs
- No performance context (batch size, throughput)
- Cannot filter by specific transform function
- No visibility into retry behavior

**Desired Capability:**
```bash
# Show only logs for this specific transform
moose logs --filter type=transform,name=user_event_to_session

# Show performance-related logs
moose logs --filter type=transform,name=user_event_to_session --include-metrics

# Show slow operations (> 1 second)
moose logs --filter type=transform --filter latency_ms:>1000
```

**Expected Output:**
```
[INFO] Transform: user_event_to_session - batch_size=100, latency=245ms, throughput=408msg/sec
[INFO] Transform: user_event_to_session - batch_size=100, latency=1340ms, throughput=75msg/sec
[WARN] Transform: user_event_to_session - batch_size=100, latency=2100ms, throughput=48msg/sec
  ↳ External API call to analytics.example.com took 1850ms (potential issue)
[DEBUG] Transform: user_event_to_session - retry_count=2, backoff_duration=4000ms
```

**Value:** Identify that external API calls are causing slowdowns, not code logic.

**Required Dimensions:**
- User primitive (transform name)
- Performance metrics (latency, batch size, throughput)
- Operation type (external API calls)
- Retry context

---

### US-3: Respond to Production Incident - 500 Errors on API

**Persona:** Morgan (On-Call Engineer)

**Scenario:**
At 2 AM, PagerDuty alerts that `/consumption/leaderboard` API is returning 500 errors. Morgan needs to quickly understand what's failing and why.

**Current Pain Points:**
- Logs contain all operations, hard to isolate this API
- No error categorization (is it database? auth? code error?)
- Cannot filter by HTTP status code
- No request-level tracing to see full context

**Desired Capability:**
```bash
# Show only errors for this specific API endpoint
moose logs --filter type=api,name=leaderboard --level=error --since=10m

# Show all requests to this endpoint (not just errors)
moose logs --filter type=api,name=leaderboard --since=10m

# Show database operations related to this API
moose logs --filter name=leaderboard --filter layer=storage
```

**Expected Output:**
```
[ERROR] API: leaderboard - request_id=xyz789, status=500, latency=5023ms, error_category=timeout_error
  ↳ ClickHouse query timeout after 5000ms
  ↳ Query: SELECT * FROM leaderboard WHERE date >= '2026-01-09' ORDER BY score DESC LIMIT 100

[ERROR] API: leaderboard - request_id=abc456, status=500, latency=5021ms, error_category=timeout_error
  ↳ ClickHouse query timeout after 5000ms

[INFO] ClickHouse diagnostics - active_queries=15, slow_queries=12, connection_pool=10/10 (saturated)
  ↳ Potential issue: Connection pool exhausted
```

**Value:** Immediately identify ClickHouse connection pool saturation as root cause, not code bug.

**Required Dimensions:**
- API endpoint name
- Error category
- HTTP status code
- Request ID correlation
- Infrastructure layer (storage)
- Time filtering

---

### US-4: Audit Who Accessed Sensitive Data

**Persona:** Riley (Security/Compliance)

**Scenario:**
Compliance requires audit trail of all access to `/consumption/user-pii` API. Riley needs to generate a report showing who accessed the API, when, and from where.

**Current Pain Points:**
- Auth events only logged at DEBUG level
- No structured security event logs
- Cannot filter by API endpoint and auth events
- No user/principal identification in logs

**Desired Capability:**
```bash
# Show all access to sensitive API
moose logs --filter type=api,name=user-pii --filter security=true --since=24h

# Show all authentication failures
moose logs --filter security=auth_failure --level=warn,error --since=7d

# Generate audit report
moose logs --filter type=api,name=user-pii --format=csv --output=audit.csv
```

**Expected Output:**
```
[INFO] API: user-pii - request_id=def123, auth=success, principal=user@example.com, ip=192.168.1.100, status=200
[INFO] API: user-pii - request_id=ghi456, auth=success, principal=admin@example.com, ip=10.0.1.50, status=200
[WARN] API: user-pii - request_id=jkl789, auth=failure, reason=expired_token, ip=203.0.113.42, status=401
[WARN] API: user-pii - request_id=mno012, auth=failure, reason=invalid_signature, ip=203.0.113.42, status=401
  ↳ Potential security issue: Multiple failed auth attempts from same IP
```

**Value:** Meet compliance requirements and detect potential security threats.

**Required Dimensions:**
- Security event categorization
- Principal/user identification
- Authentication status
- IP address/origin
- Time-based filtering
- Export capabilities

---

### US-5: Understand Why Kafka Consumer Lag Is Growing

**Persona:** Jordan (DevOps)

**Scenario:**
Monitoring shows Kafka consumer lag for `clickhouse_sync` consumer group is growing. Jordan needs to understand if it's a performance issue, backpressure, or infrastructure problem.

**Current Pain Points:**
- Cannot filter logs by consumer group
- No visibility into batch processing performance
- Cannot correlate lag with ClickHouse operations
- No context on retry/backoff behavior

**Desired Capability:**
```bash
# Show sync process logs with performance metrics
moose logs --filter layer=sync,consumer_group=clickhouse_sync --include-metrics

# Show only slow operations
moose logs --filter layer=sync --filter latency_ms:>1000

# Show ClickHouse insert operations from sync process
moose logs --filter layer=sync --filter operation=batch_insert --since=1h
```

**Expected Output:**
```
[INFO] Sync: clickhouse_sync - topic=UserEvent, batch_size=10000, latency=450ms, throughput=22222msg/sec
[WARN] Sync: clickhouse_sync - topic=UserEvent, batch_size=10000, latency=8500ms, throughput=1176msg/sec
  ↳ ClickHouse insert slow, possible load issue
[INFO] ClickHouse: batch_insert - table=UserEvent, records=10000, duration=8200ms, retry_count=0
[DEBUG] ClickHouse diagnostics - pending_merges=45, running_merges=8, merge_queue_size=250
  ↳ High merge activity may be causing slowdown
```

**Value:** Identify that ClickHouse merge activity is causing slowdowns, not consumer code.

**Required Dimensions:**
- Consumer group
- Layer (sync)
- Performance metrics (batch size, latency, throughput)
- Infrastructure operation (batch_insert)
- ClickHouse diagnostics

---

### US-6: Debug Transform Producing Wrong Output

**Persona:** Alex (Developer)

**Scenario:**
The `foo_to_bar` transform is producing incorrect output in the `Bar` topic. Alex needs to see what data is flowing through and where the logic error occurs.

**Current Pain Points:**
- Cannot trace a single message through the transform
- No visibility into input/output data
- Cannot filter by source and target topics
- No data lineage in logs

**Desired Capability:**
```bash
# Show transform logs with data lineage
moose logs --filter type=transform,name=foo_to_bar --filter phase=runtime --verbose

# Trace a specific message through transform
moose logs --trace-kafka topic=Foo,partition=2,offset=12345

# Show only transform errors with input data
moose logs --filter type=transform,name=foo_to_bar --level=error --include-payload
```

**Expected Output:**
```
[DEBUG] Transform: foo_to_bar - source=Foo, target=Bar, kafka_offset=12345, kafka_partition=2
  Input: {"id": "abc123", "value": 42, "timestamp": "2026-01-09T10:00:00Z"}
  Output: {"id": "abc123", "computed": 84, "processed_at": "2026-01-09T10:00:01Z"}

[ERROR] Transform: foo_to_bar - source=Foo, target=Bar, kafka_offset=12346, kafka_partition=2
  Input: {"id": "def456", "value": null, "timestamp": "2026-01-09T10:00:02Z"}
  Error: TypeError: Cannot read property 'value' of null
  Stack: at compute() line 45
  ↳ Sent to dead_letter_queue: FooDeadLetter
```

**Value:** See exact input data causing the error and understand transform logic flow.

**Required Dimensions:**
- Transform name
- Data lineage (source/target topics)
- Kafka partition/offset
- Trace ID
- Payload visibility (opt-in)
- Dead letter queue routing

---

### US-7: Monitor Infrastructure Changes During Deployment

**Persona:** Jordan (DevOps)

**Scenario:**
Deploying a new version of the Moose app that adds columns to existing tables. Jordan needs to monitor DDL operations and ensure migrations succeed without downtime.

**Current Pain Points:**
- DDL operations mixed with all other logs
- No clear indication of operation phase (planning vs execution)
- Cannot filter by infrastructure operation type
- No visibility into leadership lock acquisition

**Desired Capability:**
```bash
# Show only infrastructure planning and execution
moose logs --filter phase=planning,execution --filter layer=storage,streaming

# Show DDL operations only
moose logs --filter operation=ddl_* --since=5m

# Monitor deployment in real-time
moose logs --filter phase=execution --follow
```

**Expected Output:**
```
[INFO] Phase: planning - Detected schema change for table UserEvent
[INFO] Phase: planning - Change: add_column "session_id" String
[INFO] Phase: validation - Pre-flight checks passed
[INFO] Phase: execution - Acquiring leadership lock
[DEBUG] Redis: lock_acquire - lock_id=infra_ddl, instance_id=abc123, ttl=15s, status=acquired
[INFO] Phase: execution - Executing DDL: ALTER TABLE UserEvent ADD COLUMN session_id String
[INFO] ClickHouse: ddl_add_column - table=UserEvent, column=session_id, duration=1200ms, status=success
[INFO] Phase: execution - Releasing leadership lock
[INFO] Phase: execution - Infrastructure changes applied successfully
```

**Value:** Confidence that schema migrations are executing correctly with proper locking.

**Required Dimensions:**
- Operation phase (planning, validation, execution)
- Infrastructure operation type (DDL)
- Layer (storage, streaming)
- Leadership lock context
- Time-based filtering

---

### US-8: Find All Errors Across the System

**Persona:** Morgan (On-Call) / Jordan (DevOps)

**Scenario:**
System is experiencing intermittent issues. Need to see all errors across all components to identify patterns or common root causes.

**Current Pain Points:**
- Errors from different layers mixed with info logs
- Cannot aggregate errors by category
- No way to see error frequency or patterns
- Errors in TypeScript/Python processes not correlated with Rust logs

**Desired Capability:**
```bash
# Show all errors in last hour
moose logs --level=error --since=1h

# Group errors by category
moose logs --level=error --since=1h --group-by=error_category

# Show errors by component
moose logs --level=error --since=1h --group-by=layer

# Show error rate over time
moose logs --level=error --since=24h --histogram=1h
```

**Expected Output:**
```
Error Summary (last 1h):
  timeout_error: 45 occurrences
    └─ storage layer: 42 (ClickHouse query timeout)
    └─ streaming layer: 3 (Kafka produce timeout)

  type_conversion_error: 12 occurrences
    └─ sync layer: 12 (String to DateTime conversion)

  authentication_error: 8 occurrences
    └─ webserver layer: 8 (JWT expired)

Recent Errors:
[ERROR] storage/ClickHouse - query_timeout - table=leaderboard, duration=5001ms
[ERROR] storage/ClickHouse - query_timeout - table=leaderboard, duration=5003ms
[ERROR] sync/kafka_clickhouse - type_conversion - field=timestamp, expected=DateTime, got=String
```

**Value:** Quickly identify that ClickHouse timeouts are the dominant error pattern.

**Required Dimensions:**
- Log level
- Error category
- Layer/component
- Time-based filtering
- Aggregation capabilities
- Error frequency analysis

---

### US-9: Debug Workflow/Task Failures

**Persona:** Alex (Developer) / Sam (Data Engineer)

**Scenario:**
A scheduled workflow `data_refresh` is failing intermittently. Need to see workflow execution logs and understand which task is failing and why.

**Current Pain Points:**
- Workflow logs mixed with all other logs
- Cannot filter by workflow or task name
- No correlation between Temporal and Moose logs
- No visibility into retry attempts

**Desired Capability:**
```bash
# Show logs for specific workflow
moose logs --filter type=workflow,name=data_refresh

# Show logs for specific task
moose logs --filter type=task,name=fetch_external_data

# Show workflow execution with trace ID
moose logs --filter workflow_run_id=abc123-def456
```

**Expected Output:**
```
[INFO] Workflow: data_refresh - run_id=abc123-def456, status=started
[INFO] Task: fetch_external_data - workflow_run_id=abc123-def456, status=started
[ERROR] Task: fetch_external_data - workflow_run_id=abc123-def456, status=failed, error_category=connection_error
  ↳ External API unreachable: https://api.example.com/data
[INFO] Workflow: data_refresh - run_id=abc123-def456, status=retrying, retry_count=1, backoff=60s
[INFO] Task: fetch_external_data - workflow_run_id=abc123-def456, status=started
[INFO] Task: fetch_external_data - workflow_run_id=abc123-def456, status=success, duration=2300ms
[INFO] Task: load_to_clickhouse - workflow_run_id=abc123-def456, status=started
[INFO] Task: load_to_clickhouse - workflow_run_id=abc123-def456, status=success, records=5000
[INFO] Workflow: data_refresh - run_id=abc123-def456, status=completed
```

**Value:** See complete workflow execution timeline with retry behavior.

**Required Dimensions:**
- Workflow name
- Task name
- Workflow run ID
- Status/phase
- Retry context
- Error category

---

### US-10: Compare Performance Before/After Code Change

**Persona:** Sam (Data Engineer) / Alex (Developer)

**Scenario:**
Optimized a transform function and want to verify it's actually faster. Need to compare performance metrics before and after deployment.

**Current Pain Points:**
- Performance data only in metrics, not correlated with logs
- Cannot query historical performance by time range
- No easy way to compare "before" vs "after"
- Metrics aggregated, cannot see per-operation details

**Desired Capability:**
```bash
# Show transform performance yesterday (before deployment)
moose logs --filter type=transform,name=user_enrichment --since=2d --until=1d --include-metrics

# Show transform performance today (after deployment)
moose logs --filter type=transform,name=user_enrichment --since=1d --include-metrics

# Compare performance metrics
moose logs --filter type=transform,name=user_enrichment --compare before=2d-1d after=1d-now
```

**Expected Output:**
```
Performance Comparison: user_enrichment transform

Before (2026-01-08):
  Average latency: 450ms
  P50 latency: 380ms
  P95 latency: 850ms
  P99 latency: 1200ms
  Throughput: 2222 msg/sec
  Error rate: 0.5%

After (2026-01-09):
  Average latency: 180ms (-60%)
  P50 latency: 150ms (-61%)
  P95 latency: 340ms (-60%)
  P99 latency: 520ms (-57%)
  Throughput: 5555 msg/sec (+150%)
  Error rate: 0.3% (-40%)

✅ Performance improved significantly!
```

**Value:** Data-driven confirmation that optimization worked as expected.

**Required Dimensions:**
- Transform name
- Time range filtering
- Performance metrics
- Comparison capabilities
- Statistical aggregation

---

## Summary: Most Requested Capabilities

Across all user stories, these capabilities appear most frequently:

### 🔍 **Filtering Capabilities**
1. **By user primitive** (pipeline, table, transform, API name) - 10/10 stories
2. **By layer** (webserver, streaming, storage, sync) - 7/10 stories
3. **By error category** - 5/10 stories
4. **By time range** (since, until) - 9/10 stories
5. **By log level** - 8/10 stories
6. **By operation type** (DDL, query, produce, consume) - 4/10 stories

### 🔗 **Correlation Capabilities**
1. **Request/trace ID** - 6/10 stories
2. **Kafka partition/offset** - 3/10 stories
3. **Workflow run ID** - 2/10 stories
4. **Cross-language correlation** - 5/10 stories

### 📊 **Analysis Capabilities**
1. **Performance metrics in logs** - 5/10 stories
2. **Error aggregation/grouping** - 3/10 stories
3. **Time-based analysis** - 4/10 stories
4. **Comparison (before/after)** - 1/10 stories

### 🔒 **Security/Audit Capabilities**
1. **Auth events** - 2/10 stories
2. **Principal/user identification** - 1/10 stories
3. **Security event categorization** - 1/10 stories

---

## Prioritization Matrix

| Capability | User Value | Implementation Effort | Priority |
|-----------|------------|----------------------|----------|
| User primitive filtering | HIGH | Medium | **P0** |
| Request/trace ID correlation | HIGH | High | **P0** |
| Layer/component filtering | HIGH | Low | **P0** |
| Error categorization | HIGH | Medium | **P0** |
| Time range filtering | HIGH | Low | **P0** |
| Performance metrics in logs | MEDIUM | Medium | **P1** |
| Security event logging | MEDIUM | Medium | **P1** |
| Cross-language correlation | HIGH | High | **P1** |
| Aggregation/grouping | MEDIUM | High | **P2** |
| Comparison tools | LOW | High | **P3** |

---

## Next Steps

1. ✅ Current state analysis
2. ✅ User stories
3. ⏭️ Design structured logging schema (based on P0 capabilities)
4. ⏭️ Plan implementation phases
5. ⏭️ Build filtering/query tool

---

**Document Version:** 1.0
**Date:** 2026-01-09
**Related:** `LOGGING_CURRENT_STATE.md`
