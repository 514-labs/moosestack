---
title: Use Native Format for Best Insert Performance
impact: MEDIUM
impactDescription: "Native format is most efficient; JSONEachRow is expensive to parse"
tags: [insert, format, Native, performance]
---

## Use Native Format for Best Insert Performance

**Impact: MEDIUM**

Data format affects insert performance. Native format is column-oriented with minimal parsing overhead.

**Performance Ranking (fastest to slowest):**

| Format | Notes |
|--------|-------|
| **Native** | Most efficient. Column-oriented, minimal parsing. Recommended. |
| **RowBinary** | Efficient row-based alternative |
| **JSONEachRow** | Easier to use but expensive to parse |

**Example:**

```python
# Use Native format for best performance
client.execute("INSERT INTO events VALUES", data, settings={'input_format': 'Native'})
```

**MooseStack - Format handled automatically:**

MooseStack automatically optimizes the insert format when using `OlapTable.insert()`. You don't need to specify the format explicitly.

```typescript
import { OlapTable } from "@514labs/moose-lib";

const eventsTable = new OlapTable<Event>("events");

// MooseStack handles format optimization internally
await eventsTable.insert(events);  // Uses efficient format automatically
```

```python
from moose_lib import OlapTable

events_table = OlapTable[Event]("events")

# MooseStack handles format optimization internally
await events_table.insert(events)  # Uses efficient format automatically
```

When using IngestPipeline, data flows through Kafka and is efficiently batched and inserted by the sink.

Reference: [Selecting an Insert Strategy](https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy)
