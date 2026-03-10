---
title: Batch Inserts Appropriately (10K-100K rows)
impact: CRITICAL
impactDescription: "Each INSERT creates a part; single-row inserts overwhelm merge process"
tags: [insert, batching, parts, performance]
---

## Batch Inserts Appropriately (10K-100K rows)

**Impact: CRITICAL**

Each INSERT creates a new data part. Single-row or small-batch inserts create thousands of tiny parts, overwhelming the merge process and causing cluster instability.

**Incorrect (single-row or tiny batches):**

```python
# Single-row inserts - creates 10,000 parts!
for event in events:
    client.execute("INSERT INTO events VALUES", [event])

# Tiny batches - still too many parts
for batch in chunks(events, 100):  # 100 rows per INSERT
    client.execute("INSERT INTO events VALUES", batch)
```

**Correct (proper batch size):**

```python
# Ideal batch size: 10,000-100,000 rows
BATCH_SIZE = 10_000
for batch in chunks(events, BATCH_SIZE):
    client.execute("INSERT INTO events VALUES", batch)
```

**MooseStack - Batching handled automatically:**

When using MooseStack's IngestPipeline with Kafka streaming, batching is handled automatically - Kafka buffers messages and the sink writes in efficient batches.

```typescript
import { IngestPipeline } from "@514labs/moose-lib";

// IngestPipeline uses Kafka - batching is automatic
const pipeline = new IngestPipeline<Event>("events", {
  ingestApi: true,   // HTTP API accepts individual events
  stream: true,      // Kafka buffers events
  table: true        // Sink writes batches to ClickHouse
});
// Individual API calls are buffered via Kafka and inserted in efficient batches
```

**MooseStack - Direct bulk inserts:**

When using direct OlapTable inserts, batch your data appropriately:

```typescript
import { OlapTable } from "@514labs/moose-lib";

const eventsTable = new OlapTable<Event>("events");

// ✅ Good: Bulk insert with proper batch size
const events: Event[] = [...];  // 10,000+ rows
await eventsTable.insert(events);

// ❌ Bad: Single row inserts in a loop
for (const event of events) {
  await eventsTable.insert([event]);  // Creates a part per insert!
}
```

```python
from moose_lib import OlapTable

events_table = OlapTable[Event]("events")

# ✅ Good: Bulk insert with proper batch size
events: list[Event] = [...]  # 10,000+ rows
await events_table.insert(events)

# ❌ Bad: Single row inserts in a loop
for event in events:
    await events_table.insert([event])  # Creates a part per insert!
```

**Recommended batch sizes:**

| Threshold | Value |
|-----------|-------|
| Minimum | 1,000 rows |
| Ideal range | 10,000-100,000 rows |
| Insert rate (sync) | ~1 insert per second |

**Validation:**

```sql
-- Monitor part count (>3000 per partition blocks inserts)
SELECT table, count() as parts, sum(rows) as total_rows
FROM system.parts
WHERE active AND database = 'default'
GROUP BY table
ORDER BY parts DESC;
```

Reference: [Selecting an Insert Strategy](https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy)
