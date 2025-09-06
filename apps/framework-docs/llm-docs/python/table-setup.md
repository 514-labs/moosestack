# Database Tables

## Overview
OLAP (Online Analytical Processing) tables in Moose provide a powerful way to store and query your data. They support high-performance analytics, real-time data ingestion, and efficient querying capabilities.

## Basic Table Setup

```python
from moose_lib import OlapTable, Key
from pydantic import BaseModel

class UserEvent(BaseModel):
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: str

# Create a table
user_event_table = OlapTable(
    name="UserEventTable",
    order_by_fields=["id", "timestamp"],
    partition_by="toYYYYMM(timestamp)"
)
```

## Table Configuration

The `OlapTable` class supports both a modern engine-specific API and legacy configuration for backward compatibility.

### Modern API (Recommended)

```python
from moose_lib import (
    TableConfig, 
    MergeTreeEngine, 
    ReplacingMergeTreeEngine,
    S3QueueEngine
)

# Modern configuration with engine-specific classes
config = TableConfig(
    name="MyTable",
    columns={"id": "String", "value": "Int64"},
    engine=MergeTreeEngine(),  # or ReplacingMergeTreeEngine(), S3QueueEngine(...), etc.
    order_by="id"
)
```

### Legacy API (Still Supported)

```python
from typing import TypedDict, Optional, List
from moose_lib import ClickHouseEngines, S3QueueEngineConfig

class TableCreateOptions(TypedDict):
    name: str            # Required: Name of the table
    order_by_fields: List[str]  # Required: Fields to order by
    partition_by: Optional[str] = None  # Optional: Partition expression
    ttl: Optional[int] = None   # Optional: Time-to-live in seconds
    engine: Optional[ClickHouseEngines] = None  # Optional: Table engine (default: MergeTree)
    s3_queue_engine_config: Optional[S3QueueEngineConfig] = None  # Required when engine is S3Queue
```

## Table Operations

### Writing Data
```python
# Write a single record
await user_event_table.write({
    "id": "123",
    "user_id": "user_456",
    "event_type": "login",
    "timestamp": "2024-03-20T12:00:00Z"
})

# Write multiple records
await user_event_table.write_many([
    {
        "id": "123",
        "user_id": "user_456",
        "event_type": "login",
        "timestamp": "2024-03-20T12:00:00Z"
    },
    {
        "id": "124",
        "user_id": "user_457",
        "event_type": "logout",
        "timestamp": "2024-03-20T12:01:00Z"
    }
])
```

### Querying Data
```python
# Basic query
results = await user_event_table.query({
    "select": ["id", "user_id", "event_type"],
    "where": "event_type = 'login'",
    "limit": 10
})

# Advanced query with aggregations
stats = await user_event_table.query({
    "select": [
        "event_type",
        "count() as count",
        "min(timestamp) as first_seen",
        "max(timestamp) as last_seen"
    ],
    "group_by": ["event_type"],
    "order_by": ["count DESC"],
    "limit": 5
})
```

## Table Maintenance

### Partitioning
```python
# Create a table with partitioning
time_series_table = OlapTable(
    name="TimeSeriesTable",
    order_by_fields=["id", "timestamp"],
    partition_by="toYYYYMM(timestamp)"
)

# Get partition information
partitions = await time_series_table.get_partitions()
print("Table partitions:", partitions)

# Drop old partitions
await time_series_table.drop_partition("202401")
```

### TTL (Time-to-Live)
```python
# Create a table with TTL
temporary_table = OlapTable(
    name="TemporaryTable",
    order_by_fields=["id"],
    ttl=86400  # 24 hours in seconds
)
```

## Best Practices

1. **Table Design**
   - Choose appropriate primary keys
   - Use meaningful field names
   - Consider query patterns
   - Plan for data growth

2. **Partitioning**
   - Partition by time for time-series data
   - Use appropriate partition granularity
   - Monitor partition sizes
   - Clean up old partitions

3. **Performance**
   - Use appropriate indexes
   - Monitor query performance
   - Set appropriate TTLs
   - Use batch operations

4. **Maintenance**
   - Monitor table sizes
   - Clean up old data
   - Optimize table settings
   - Back up important data

## Example Usage

### Time Series Table
```python
from moose_lib import OlapTable, Key
from pydantic import BaseModel

class TimeSeriesEvent(BaseModel):
    id: Key[str]
    metric: str
    value: float
    timestamp: str

# Create table
metrics_table = OlapTable(
    name="MetricsTable",
    order_by_fields=["id", "timestamp"],
    partition_by="toYYYYMM(timestamp)",
    ttl=30 * 24 * 60 * 60  # 30 days
)

# Write metrics
await metrics_table.write({
    "id": "123",
    "metric": "cpu_usage",
    "value": 75.5,
    "timestamp": "2024-03-20T12:00:00Z"
})

# Query metrics
metrics = await metrics_table.query({
    "select": [
        "metric",
        "avg(value) as avg_value",
        "max(value) as max_value"
    ],
    "where": "timestamp >= '2024-03-20'",
    "group_by": ["metric"]
})
```

### Analytics Table
```python
from moose_lib import OlapTable, Key
from pydantic import BaseModel
from typing import Dict, Any

class AnalyticsEvent(BaseModel):
    id: Key[str]
    user_id: str
    action: str
    properties: Dict[str, Any]
    timestamp: str

# Create table
analytics_table = OlapTable(
    name="AnalyticsTable",
    order_by_fields=["id", "timestamp"],
    partition_by="toYYYYMM(timestamp)"
)

# Write analytics event
await analytics_table.write({
    "id": "123",
    "user_id": "user_456",
    "action": "page_view",
    "properties": {
        "page": "/home",
        "referrer": "google.com"
    },
    "timestamp": "2024-03-20T12:00:00Z"
})

# Query analytics
stats = await analytics_table.query({
    "select": [
        "action",
        "count() as count",
        "count(distinct user_id) as unique_users"
    ],
    "where": "timestamp >= '2024-03-20'",
    "group_by": ["action"],
    "order_by": ["count DESC"]
})
```

### S3Queue Engine Tables

The S3Queue engine enables automatic processing of files from S3 buckets as they arrive.

#### Modern API (Recommended)

```python
from moose_lib import TableConfig, S3QueueEngine, OlapTable, Key
from pydantic import BaseModel

class S3Event(BaseModel):
    id: Key[str]
    event_type: str
    timestamp: str
    data: dict

# Option 1: Direct configuration with new API
s3_events_config = TableConfig(
    name="S3EventsTable",
    columns={"id": "String", "event_type": "String", "timestamp": "DateTime", "data": "JSON"},
    engine=S3QueueEngine(
        s3_path="s3://my-bucket/events/*.json",
        format="JSONEachRow",
        # Optional authentication (omit for public buckets)
        aws_access_key_id="AKIA...",
        aws_secret_access_key="secret...",
        # Optional compression
        compression="gzip",
        # Engine-specific settings
        s3_settings={
            "mode": "unordered",  # or "ordered" for sequential processing
            "keeper_path": "/clickhouse/s3queue/s3_events",
            "s3queue_loading_retries": 3,
            "s3queue_processing_threads_num": 4,
            # Additional settings as needed
        }
    ),
    order_by="id, timestamp"
)

# Option 2: Using factory method (cleanest approach)
s3_events_table = TableConfig.with_s3_queue(
    name="S3EventsTable",
    columns={"id": "String", "event_type": "String", "timestamp": "DateTime", "data": "JSON"},
    s3_path="s3://my-bucket/events/*.json",
    format="JSONEachRow",
    order_by="id, timestamp",
    aws_access_key_id="AKIA...",
    aws_secret_access_key="secret...",
    compression="gzip",
    s3_settings={
        "mode": "unordered",
        "keeper_path": "/clickhouse/s3queue/s3_events"
    }
)

# Public S3 bucket example (no credentials needed)
public_s3_table = TableConfig.with_s3_queue(
    name="PublicS3DataTable",
    columns={"id": "String", "data": "String"},
    s3_path="s3://public-bucket/data/*.csv",
    format="CSV",
    order_by="id",
    # No AWS credentials for public buckets
    s3_settings={
        "mode": "ordered",
        "keeper_path": "/clickhouse/s3queue/public_data"
    }
)
```

#### Legacy API (Still Supported)

```python
from moose_lib import OlapTable, ClickHouseEngines, S3QueueEngineConfig

# Legacy configuration format (will show deprecation warning)
s3_events_legacy = OlapTable(
    name="S3EventsTable",
    order_by_fields=["id", "timestamp"],
    engine=ClickHouseEngines.S3Queue,
    s3_queue_engine_config=S3QueueEngineConfig(
        path="s3://my-bucket/events/*.json",
        format="JSONEachRow",
        aws_access_key_id="AKIA...",
        aws_secret_access_key="secret...",
        compression="gzip",
        settings={
            "mode": "unordered",
            "keeper_path": "/clickhouse/s3queue/s3_events",
            "s3queue_loading_retries": 3
        }
    )
)
```

#### S3Queue Configuration Options

```python
from dataclasses import dataclass
from typing import Optional, Dict, Any

@dataclass
class S3QueueEngineConfig:
    path: str  # S3 path pattern (e.g., 's3://bucket/data/*.json')
    format: str  # Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')
    aws_access_key_id: Optional[str] = None  # AWS access key or 'NOSIGN' for public buckets
    aws_secret_access_key: Optional[str] = None  # AWS secret key (paired with access key)
    compression: Optional[str] = None  # Optional: 'gzip', 'brotli', 'xz', 'zstd', etc.
    headers: Optional[Dict[str, str]] = None  # Optional: custom HTTP headers
    settings: Optional[Dict[str, Any]] = None  # Engine-specific settings:
    # - mode: 'ordered' | 'unordered' - Processing mode
    # - keeper_path: str - ZooKeeper/Keeper path for coordination
    # - s3queue_loading_retries: int - Number of retry attempts
    # - s3queue_processing_threads_num: int - Number of processing threads
    # - s3queue_polling_min_timeout_ms: int - Min polling timeout
    # - s3queue_polling_max_timeout_ms: int - Max polling timeout
    # - s3queue_polling_backoff_ms: int - Polling backoff
    # - s3queue_track_processed_files: bool - Track processed files
    # - s3queue_cleanup_interval_min_age: int - Cleanup interval min age
    # - s3queue_cleanup_interval_max_age: int - Cleanup interval max age
    # - s3queue_total_max_retries: int - Total max retries
    # - s3queue_max_processed_files_before_commit: int - Max files before commit
    # - s3queue_max_processed_rows_before_commit: int - Max rows before commit
    # - s3queue_max_processed_bytes_before_commit: int - Max bytes before commit
```

#### Use Cases for S3Queue

1. **Real-time log processing**: Automatically process log files as they're uploaded to S3
2. **Data ingestion pipelines**: Continuously ingest data from S3 without manual intervention
3. **Event streaming**: Process event streams stored in S3 buckets
4. **ETL workflows**: Build automated ETL pipelines with S3 as the source 