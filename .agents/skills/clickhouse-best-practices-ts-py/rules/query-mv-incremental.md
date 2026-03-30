---
title: Use Incremental MVs for Real-Time Aggregations
impact: HIGH
impactDescription: "Read thousands of rows instead of billions; minimal cluster overhead"
tags: [query, materialized-view, aggregation, real-time]
---

## Use Incremental MVs for Real-Time Aggregations

**Impact: HIGH**

Incremental MVs automatically apply the view's query to new data blocks at insert time. Results are written to a target table and partial results merge over time.

**Incorrect (full aggregation on every query):**

```sql
-- Full aggregation on every dashboard load
SELECT
    event_type,
    toStartOfHour(timestamp) as hour,
    count() as events,
    uniq(user_id) as unique_users
FROM events
WHERE timestamp >= now() - INTERVAL 7 DAY
GROUP BY event_type, hour;
-- Scans 7 days of data every time (billions of rows)
```

**Correct (incremental MV with pre-aggregation):**

```sql
-- Create target table for aggregated data
CREATE TABLE events_hourly (
    event_type LowCardinality(String),
    hour DateTime,
    events AggregateFunction(count),
    unique_users AggregateFunction(uniq, UInt64)
)
ENGINE = AggregatingMergeTree()
ORDER BY (event_type, hour);

-- Create materialized view to populate incrementally
CREATE MATERIALIZED VIEW events_hourly_mv TO events_hourly AS
SELECT
    event_type,
    toStartOfHour(timestamp) as hour,
    countState() as events,
    uniqState(user_id) as unique_users
FROM events
GROUP BY event_type, hour;

-- Query the pre-aggregated data
SELECT
    event_type, hour,
    countMerge(events) as events,
    uniqMerge(unique_users) as unique_users
FROM events_hourly
WHERE hour >= now() - INTERVAL 7 DAY
GROUP BY event_type, hour;
-- Reads thousands of rows instead of billions
```

**Key points:**
- Use `-State` functions in MV, `-Merge` functions in query
- Incremental - existing data not automatically included (backfill separately)
- Minimal cluster overhead at insert time

**MooseStack - Incremental Materialized Views:**

```typescript
import { Key, LowCardinality, OlapTable, MaterializedView } from "@514labs/moose-lib";

// Source table
interface Event {
  id: Key<string>;
  eventType: string & LowCardinality;
  timestamp: Date;
  userId: number;
}

// Aggregated data model
interface EventHourly {
  eventType: string & LowCardinality;
  hour: Date;
  events: number;      // Will use AggregateFunction in target table
  uniqueUsers: number; // Will use AggregateFunction in target table
}

export const eventsTable = new OlapTable<Event>("events");

// Target table for aggregated data
export const eventsHourlyTable = new OlapTable<EventHourly>("events_hourly", {
  orderByFields: ["eventType", "hour"],
  engine: "AggregatingMergeTree()"
});

// Incremental MV that populates events_hourly from events
export const eventsHourlyMV = new MaterializedView<Event, EventHourly>({
  name: "events_hourly_mv",
  source: eventsTable,
  destination: eventsHourlyTable,
  query: `
    SELECT
      event_type,
      toStartOfHour(timestamp) as hour,
      countState() as events,
      uniqState(user_id) as unique_users
    FROM events
    GROUP BY event_type, hour
  `
});
```

```python
from moose_lib import Key, OlapTable, MaterializedView

# Incremental MV that populates events_hourly from events
events_hourly_mv = MaterializedView(
    name="events_hourly_mv",
    source=events_table,
    destination=events_hourly_table,
    query="""
      SELECT
        event_type,
        toStartOfHour(timestamp) as hour,
        countState() as events,
        uniqState(user_id) as unique_users
      FROM events
      GROUP BY event_type, hour
    """
)
```

Reference: [Use Materialized Views](https://clickhouse.com/docs/best-practices/use-materialized-views)
