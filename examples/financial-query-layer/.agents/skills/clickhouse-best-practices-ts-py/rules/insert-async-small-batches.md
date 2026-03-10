---
title: Use Async Inserts for High-Frequency Small Batches
impact: HIGH
impactDescription: "Server-side buffering when client batching isn't practical"
tags: [insert, async, buffering, small-batches]
---

## Use Async Inserts for High-Frequency Small Batches

**Impact: HIGH**

When client-side batching isn't practical, async inserts buffer server-side and create larger parts automatically.

**Incorrect (small batches without async):**

```python
# Small batches without async_insert - creates too many parts
for batch in chunks(events, 100):
    client.execute("INSERT INTO events VALUES", batch)
```

**Correct (enable async inserts):**

```python
# Enable async_insert with safe defaults
client.execute("SET async_insert = 1")
client.execute("SET wait_for_async_insert = 1")  # Confirms durability

for batch in chunks(events, 100):
    client.execute("INSERT INTO events VALUES", batch)
# Server buffers and creates larger parts automatically
```

```sql
-- Configure server-side for specific users
ALTER USER my_app_user SETTINGS
    async_insert = 1,
    wait_for_async_insert = 1,
    async_insert_max_data_size = 10000000,  -- Flush at 10MB
    async_insert_busy_timeout_ms = 1000;    -- Flush after 1s
```

**Flush conditions (whichever occurs first):**
- Buffer reaches `async_insert_max_data_size`
- Time threshold `async_insert_busy_timeout_ms` elapses
- Maximum insert queries accumulate

**MooseStack - Stream-based buffering (alternative approach):**

MooseStack's IngestPipeline and Streams provide built-in buffering via Kafka. This is a different approach to the same problem — Kafka handles backpressure and durability at the stream level, while async inserts handle it at the ClickHouse level:

```typescript
import { IngestPipeline } from "@514labs/moose-lib";

// Kafka provides buffering for high-frequency small events
const pipeline = new IngestPipeline<Event>("events", {
  ingestApi: true,   // Accept individual events via API
  stream: true,      // Kafka buffers and batches
  table: true        // Efficient bulk writes to ClickHouse
});
// Each API call is buffered via Kafka - no async_insert needed
```

```python
from moose_lib import IngestPipeline, IngestPipelineConfig

# Kafka provides buffering for high-frequency small events
pipeline = IngestPipeline[Event]("events", IngestPipelineConfig(
    ingest_api=True,   # Accept individual events via API
    stream=True,       # Kafka buffers and batches
    table=True         # Efficient bulk writes to ClickHouse
))
# Each API call is buffered via Kafka - no async_insert needed
```

**When to use async_insert vs MooseStack streams:**

| Scenario | Recommendation |
|----------|----------------|
| High-frequency events from API | Use IngestPipeline with Kafka |
| Direct ClickHouse client inserts | Enable async_insert |
| Bulk ETL loads | Use OlapTable.insert() with proper batching |

**Return modes:**

| Setting | Behavior | Use Case |
|---------|----------|----------|
| `wait_for_async_insert=1` | Waits for flush, confirms durability | **Recommended** |
| `wait_for_async_insert=0` | Fire-and-forget, unaware of errors | **Risky** - only if you accept data loss |

Reference: [Selecting an Insert Strategy](https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy)
