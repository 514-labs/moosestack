# Database Tables

## Overview
OLAP (Online Analytical Processing) tables in Moose provide a powerful way to store and query your data. They support high-performance analytics, real-time data ingestion, and efficient querying capabilities.

## Basic Table Setup

```python
from moose_lib import OlapTable, OlapConfig
from pydantic import BaseModel

class UserEvent(BaseModel):
    id: str
    user_id: str
    event_type: str
    timestamp: str

# Create a table
user_event_table = OlapTable[UserEvent](
    "UserEventTable",
    OlapConfig(
        order_by_fields=["id", "timestamp"]
    )
)
```

## Table Configuration

The `OlapTable` class supports both a modern engine-specific API and legacy configuration for backward compatibility.

### Modern API (Recommended)

```python
from moose_lib import OlapTable, OlapConfig
from moose_lib.blocks import (
    MergeTreeEngine, 
    ReplacingMergeTreeEngine,
    AggregatingMergeTreeEngine,
    SummingMergeTreeEngine,
    ReplicatedMergeTreeEngine,
    ReplicatedReplacingMergeTreeEngine,
    ReplicatedAggregatingMergeTreeEngine,
    ReplicatedSummingMergeTreeEngine,
    S3QueueEngine
)
from pydantic import BaseModel

class MyData(BaseModel):
    id: str
    value: float
    timestamp: str

# Modern configuration with engine-specific classes
my_table = OlapTable[MyData](
    "MyTable",
    OlapConfig(
        order_by_fields=["id"],
        engine=MergeTreeEngine(),
        # Optional: settings for alterable table settings
        settings={
            "index_granularity": "8192",
            # Other ClickHouse table settings as needed
        }
    )
)

# ReplacingMergeTree with version control and soft deletes
dedup_table = OlapTable[MyData](
    "DedupTable",
    OlapConfig(
        order_by_fields=["id"],
        engine=ReplacingMergeTreeEngine(
            ver="timestamp",  # Optional: keeps row with max timestamp value
            is_deleted="deleted"  # Optional: soft delete when deleted=1 (requires ver)
        )
    )
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

### Partitioning and TTL
```python
from moose_lib import OlapTable, OlapConfig
from pydantic import BaseModel

class TimeSeriesData(BaseModel):
    id: str
    timestamp: str
    value: float

# Note: Partitioning and TTL are typically configured at the infrastructure level
# or through table settings, not directly in the OlapTable API
time_series_table = OlapTable[TimeSeriesData](
    "TimeSeriesTable",
    OlapConfig(
        order_by_fields=["id", "timestamp"],
        # Partitioning and TTL would be configured through settings
        # or at the ClickHouse level
    )
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
from moose_lib import OlapTable, OlapConfig
from pydantic import BaseModel

class TimeSeriesEvent(BaseModel):
    id: str
    metric: str
    value: float
    timestamp: str

# Create table
metrics_table = OlapTable[TimeSeriesEvent](
    "MetricsTable",
    OlapConfig(
        order_by_fields=["id", "timestamp"]
    )
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
from moose_lib import OlapTable, OlapConfig
from pydantic import BaseModel
from typing import Dict, Any

class AnalyticsEvent(BaseModel):
    id: str
    user_id: str
    action: str
    properties: Dict[str, Any]
    timestamp: str

# Create table
analytics_table = OlapTable[AnalyticsEvent](
    "AnalyticsTable",
    OlapConfig(
        order_by_fields=["id", "timestamp"]
    )
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

### Replicated Engine Tables

Replicated engines provide high availability and data replication across multiple ClickHouse nodes.

```python
from moose_lib import OlapTable, OlapConfig, Key
from moose_lib.blocks import (
    ReplicatedMergeTreeEngine,
    ReplicatedReplacingMergeTreeEngine
)
from pydantic import BaseModel

class ReplicatedData(BaseModel):
    id: Key[str]
    data: str
    timestamp: datetime
    deleted: int = 0

# For self-managed ClickHouse with explicit keeper paths
replicated_table = OlapTable[ReplicatedData](
    "ReplicatedTable",
    OlapConfig(
        order_by_fields=["id", "timestamp"],
        engine=ReplicatedMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_table",
            replica_name="{replica}"
        )
    )
)

# For ClickHouse Cloud or Boreal (no parameters needed)
cloud_replicated_table = OlapTable[ReplicatedData](
    "CloudReplicatedTable",
    OlapConfig(
        order_by_fields=["id"],
        engine=ReplicatedMergeTreeEngine()
        # No keeper_path or replica_name - managed automatically by Cloud/Boreal
    )
)

# Replicated with deduplication
replicated_dedup_table = OlapTable[ReplicatedData](
    "ReplicatedDedupTable",
    OlapConfig(
        order_by_fields=["id"],
        engine=ReplicatedReplacingMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_dedup",
            replica_name="{replica}",
            ver="timestamp",
            is_deleted="deleted"
        )
    )
)
```

**Note**: The `keeper_path` and `replica_name` parameters are optional. When omitted, Moose uses smart defaults (`/clickhouse/tables/{uuid}/{shard}` and `{replica}`) that work in both ClickHouse Cloud and self-managed environments with Atomic databases (default in modern ClickHouse). You can still provide both parameters explicitly if you need custom replication paths.

Available replicated engines:
- `ReplicatedMergeTreeEngine` - Replicated version of MergeTree
- `ReplicatedReplacingMergeTreeEngine` - Replicated with deduplication
- `ReplicatedAggregatingMergeTreeEngine` - Replicated with aggregation
- `ReplicatedSummingMergeTreeEngine` - Replicated with summation

### S3Queue Engine Tables

The S3Queue engine enables automatic processing of files from S3 buckets as they arrive.

#### Modern API (Recommended)

```python
from moose_lib import OlapConfig, S3QueueEngine, OlapTable
from pydantic import BaseModel

class S3Event(BaseModel):
    id: str
    event_type: str
    timestamp: str
    data: dict

# Create S3Queue table with new API
s3_events_table = OlapTable[S3Event](
    "S3EventsTable",
    OlapConfig(
        # Note: S3Queue doesn't support ORDER BY as it's a streaming engine
        engine=S3QueueEngine(
            s3_path="s3://my-bucket/events/*.json",
            format="JSONEachRow",
            # Optional authentication (omit for public buckets)
            aws_access_key_id="AKIA...",
            aws_secret_access_key="secret...",
            # Optional compression
            compression="gzip"
        ),
    # S3Queue-specific settings go in settings (can be altered without recreating table)
    # Note: Since ClickHouse 24.7, settings don't require the 's3queue_' prefix
    settings={
        "mode": "unordered",  # or "ordered" for sequential processing
        "keeper_path": "/clickhouse/s3queue/s3_events",
        "loading_retries": "3",
        "processing_threads_num": "4",
        # Additional settings as needed
    }
    )
)

# Public S3 bucket example (no credentials needed)
public_s3_table = OlapTable[S3Event](
    "PublicS3Table",
    OlapConfig(
        # Note: S3Queue doesn't support ORDER BY as it's a streaming engine
        engine=S3QueueEngine(
            s3_path="s3://public-bucket/data/*.csv",
            format="CSV"
            # No AWS credentials for public buckets
        ),
    # S3Queue-specific settings go in settings
    settings={
        "mode": "ordered",
        "keeper_path": "/clickhouse/s3queue/public_data"
    }
    )
)
```

#### Legacy API (Still Supported but Deprecated)

```python
from moose_lib import OlapTable, OlapConfig, ClickHouseEngines
from pydantic import BaseModel

class S3Event(BaseModel):
    id: str
    event_type: str
    timestamp: str
    data: dict

# Legacy configuration format (will show deprecation warning in Moose logs)
s3_events_legacy = OlapTable[S3Event](
    "S3EventsTableLegacy",
    OlapConfig(
        order_by_fields=["id", "timestamp"],
        engine=ClickHouseEngines.S3Queue,  # Using enum directly - deprecated
        # Note: With legacy enum approach, you cannot specify S3 configuration
        # You would need to use s3_queue_engine_config field (also deprecated)
    )
)
```

#### S3Queue Configuration Options

```python
from moose_lib.blocks import S3QueueEngine
from typing import Optional, Dict

# S3QueueEngine configuration (modern API)
class S3QueueEngine:
    """Configuration for S3Queue engine - only non-alterable constructor parameters"""
    def __init__(
        self,
        s3_path: str,  # S3 path pattern (e.g., 's3://bucket/data/*.json')
        format: str,  # Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')
        aws_access_key_id: Optional[str] = None,  # AWS access key (omit for public buckets)
        aws_secret_access_key: Optional[str] = None,  # AWS secret key (paired with access key)
        compression: Optional[str] = None,  # Optional: 'gzip', 'brotli', 'xz', 'zstd', etc.
        headers: Optional[Dict[str, str]] = None,  # Optional: custom HTTP headers
    ):
        pass

# S3Queue-specific settings go in OlapConfig.settings field
# These settings can be modified with ALTER TABLE MODIFY SETTING.
# Since ClickHouse 24.7, settings don't require the 's3queue_' prefix.
# Note: If not specified, 'mode' defaults to 'unordered'
s3queue_settings = {
    "mode": "ordered",  # or "unordered" (default) - Processing mode
    "after_processing": "keep",  # or "delete" - What to do with files after processing
    "keeper_path": "/clickhouse/s3queue/...",  # ZooKeeper/Keeper path for coordination
    "loading_retries": "3",  # Number of retry attempts
    "processing_threads_num": "4",  # Number of processing threads
    "parallel_inserts": "false",  # Enable parallel inserts
    "enable_logging_to_queue_log": "true",  # Enable logging to system.s3queue_log
    "last_processed_path": "",  # Last processed file path (for ordered mode)
    "tracked_files_limit": "1000",  # Maximum number of tracked files in ZooKeeper
    "tracked_file_ttl_sec": "0",  # TTL for tracked files in seconds
    "polling_min_timeout_ms": "1000",  # Min polling timeout
    "polling_max_timeout_ms": "10000",  # Max polling timeout
    "polling_backoff_ms": "0",  # Polling backoff
    "cleanup_interval_min_ms": "10000",  # Min cleanup interval
    "cleanup_interval_max_ms": "30000",  # Max cleanup interval
    "buckets": "0",  # Number of buckets for sharding (0 = disabled)
    "list_objects_batch_size": "1000",  # Batch size for listing objects
    "enable_hash_ring_filtering": "0",  # Enable hash ring filtering
    "max_processed_files_before_commit": "100",  # Max files before commit
    "max_processed_rows_before_commit": "0",  # Max rows before commit
    "max_processed_bytes_before_commit": "0",  # Max bytes before commit
    "max_processing_time_sec_before_commit": "0",  # Max processing time before commit
}
```

#### Use Cases for S3Queue

1. **Real-time log processing**: Automatically process log files as they're uploaded to S3
2. **Data ingestion pipelines**: Continuously ingest data from S3 without manual intervention
3. **Event streaming**: Process event streams stored in S3 buckets
4. **ETL workflows**: Build automated ETL pipelines with S3 as the source 