---
title: Python Table Configuration
description: Configure ClickHouse table engines, sorting keys, and advanced storage options
priority: 0.70
category: database-config
language: python
---

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

# Alternatively, you can provide an ORDER BY expression
user_event_table_expr = OlapTable[UserEvent](
    "UserEventTableExpr",
    OlapConfig(
        order_by_expression="(id, timestamp)"
    )
)
```

## Multi-Database Support

By default, tables are created in the global ClickHouse database configured in your Moose project. You can optionally specify a different database for any table using the `database` parameter:

```python
from moose_lib import OlapTable, OlapConfig
from pydantic import BaseModel

class MyData(BaseModel):
    id: str
    value: float

# Table created in the default database
default_table = OlapTable[MyData](
    "DefaultTable",
    OlapConfig(
        order_by_fields=["id"]
    )
)

# Table created in a specific database
analytics_table = OlapTable[MyData](
    "AnalyticsTable",
    OlapConfig(
        order_by_fields=["id"],
        database="analytics_db"
    )
)
```

**Notes**:
- If `database` is not specified, the table is created in the global database from your Moose configuration
- The database must exist in your ClickHouse cluster
- All table operations (queries, writes) will target the specified database
- **Changing the `database` field requires manual migration**: Create a new table with the target database, migrate your data, then delete the old table definition. This prevents accidental data loss.

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
from dataclasses import dataclass
from typing import Optional, Dict
from moose_lib.blocks import ClickHouseEngines, S3QueueEngineConfig

# Legacy structure used by Blocks helpers (deprecated, prefer TableConfig + Engine classes)
@dataclass
class TableCreateOptions:
    name: str
    columns: Dict[str, str]
    engine: Optional[ClickHouseEngines] = ClickHouseEngines.MergeTree
    order_by: Optional[str] = None  # e.g., "(id, timestamp)"
    s3_queue_engine_config: Optional[S3QueueEngineConfig] = None  # Required for S3Queue
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
from typing import Annotated
from moose_lib import OlapTable, OlapConfig, ClickHouseTTL
from pydantic import BaseModel

class TimeSeriesData(BaseModel):
    id: str
    timestamp: str
    value: float

# Column-level TTL example (mask PII sooner than row expiry)
class WithPii(BaseModel):
    id: str
    timestamp: str
    email: Annotated[str, ClickHouseTTL("timestamp + INTERVAL 30 DAY")]

# Table-level TTL example (expire rows after 90 days)
time_series_table = OlapTable[TimeSeriesData](
    "TimeSeriesTable",
    OlapConfig(
        order_by_fields=["id", "timestamp"],
        # Provide the ClickHouse TTL expression without the leading 'TTL'
        ttl="timestamp + INTERVAL 90 DAY DELETE",
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
            # ⚠️ WARNING: Never hardcode credentials directly!
            # Use moose_runtime_env for runtime environment variable resolution (see below)
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

#### Runtime Environment Variable Resolution (Recommended for Credentials)

**⚠️ IMPORTANT: Never hardcode AWS credentials in your code!** Hardcoded credentials get embedded in Docker images and deployment artifacts, creating serious security risks.

Instead, use `moose_runtime_env` to defer credential resolution until runtime:

```python
from moose_lib import OlapTable, OlapConfig, moose_runtime_env
from moose_lib.blocks import S3QueueEngine
from pydantic import BaseModel

class S3Event(BaseModel):
    id: str
    event_type: str
    timestamp: str
    data: dict

# ✅ RECOMMENDED: Runtime environment variable resolution
secure_s3_events = OlapTable[S3Event](
    "SecureS3Events",
    OlapConfig(
        # Note: S3Queue doesn't support ORDER BY as it's a streaming engine
        engine=S3QueueEngine(
            s3_path="s3://my-bucket/events/*.json",
            format="JSONEachRow",
            # Credentials resolved from environment variables at runtime
            aws_access_key_id=moose_runtime_env.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=moose_runtime_env.get("AWS_SECRET_ACCESS_KEY")
        ),
        settings={
            "mode": "unordered",
            "keeper_path": "/clickhouse/s3queue/s3_events"
        }
    )
)
```

**How it works:**
1. `moose_runtime_env.get("VAR_NAME")` creates a marker in your code
2. When you build your application, these markers (not actual values) are serialized
3. At runtime, the Moose CLI reads the environment variables and resolves the actual values
4. Credentials never get embedded in Docker images or deployment artifacts

**Setting environment variables:**
```bash
# In your deployment environment
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="your-secret-key"

# Then start Moose
moose prod up
```

**Benefits:**
- ✅ Credentials never embedded in Docker images
- ✅ Supports credential rotation (changing passwords triggers table recreation)
- ✅ Different credentials for different environments (dev/staging/prod)
- ✅ Clear error messages if environment variables are missing

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

### S3 Engine Tables

The S3 engine provides direct read/write access to S3 storage without streaming semantics. Unlike S3Queue, it's designed for batch processing or querying static data.

#### Modern API (Recommended)

```python
from moose_lib import OlapConfig, S3Engine, OlapTable, moose_runtime_env
from pydantic import BaseModel

class S3Data(BaseModel):
    id: str
    timestamp: str
    data: dict

# S3 table with credentials (recommended with moose_runtime_env)
s3_data_table = OlapTable[S3Data](
    "S3DataTable",
    OlapConfig(
        engine=S3Engine(
            path="s3://my-bucket/data/file.json",
            format="JSONEachRow",
            # Credentials resolved at runtime from environment variables
            aws_access_key_id=moose_runtime_env.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=moose_runtime_env.get("AWS_SECRET_ACCESS_KEY"),
            compression="gzip"
        )
    )
)

# Public S3 bucket (no credentials needed - just omit them)
public_s3_table = OlapTable[S3Data](
    "PublicS3Table",
    OlapConfig(
        engine=S3Engine(
            path="s3://public-bucket/data/*.parquet",
            format="Parquet"
        )
    )
)
```

#### S3 Engine Configuration Options

```python
from moose_lib.blocks import S3Engine
from typing import Optional

# S3Engine configuration (modern API)
class S3Engine:
    """Configuration for S3 engine - direct S3 access"""
    def __init__(
        self,
        path: str,  # S3 path (e.g., 's3://bucket/data/file.json')
        format: str,  # Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')
        aws_access_key_id: Optional[str] = None,  # AWS access key (omit for public buckets)
        aws_secret_access_key: Optional[str] = None,  # AWS secret key (paired with access key)
        compression: Optional[str] = None,  # Optional: 'gzip', 'brotli', 'xz', 'zstd', 'auto', etc.
        partition_strategy: Optional[str] = None,  # Optional: partitioning strategy
        partition_columns_in_data_file: Optional[str] = None,  # Optional: partition columns
    ):
        pass
```

#### S3 vs S3Queue

- **S3**: Direct read/write access to S3 files. Use for batch processing, querying static data, or one-time imports.
- **S3Queue**: Streaming engine that automatically processes new files as they arrive. Use for continuous data ingestion.

Both engines support the same credential management and format options.

### Buffer Engine Tables

The Buffer engine provides an in-memory buffer that flushes data to a destination table based on time, row count, or size thresholds. This is useful for high-throughput scenarios where you want to batch writes.

#### Modern API (Recommended)

```python
from moose_lib import OlapConfig, OlapTable
from moose_lib.blocks import MergeTreeEngine, BufferEngine
from pydantic import BaseModel

class Record(BaseModel):
    id: str
    timestamp: str
    value: float

# First create the destination table
destination_table = OlapTable[Record](
    "DestinationTable",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_fields=["id", "timestamp"]
    )
)

# Then create the buffer table that points to it
buffer_table = OlapTable[Record](
    "BufferTable",
    OlapConfig(
        engine=BufferEngine(
            target_database="local",
            target_table="DestinationTable",
            num_layers=16,
            min_time=10,        # Minimum 10 seconds before flush
            max_time=100,       # Maximum 100 seconds before flush
            min_rows=10000,     # Minimum 10k rows before flush
            max_rows=1000000,   # Maximum 1M rows before flush
            min_bytes=10485760, # Minimum 10MB before flush
            max_bytes=104857600 # Maximum 100MB before flush
        )
    )
)
```

#### Buffer Engine Configuration Options

```python
from moose_lib.blocks import BufferEngine

# BufferEngine configuration (modern API)
class BufferEngine:
    """Configuration for Buffer engine - in-memory buffered writes"""
    def __init__(
        self,
        target_database: str,  # Database name of destination table
        target_table: str,  # Name of destination table
        num_layers: int,  # Number of buffer layers (typically 16)
        min_time: int,  # Minimum time in seconds before flushing
        max_time: int,  # Maximum time in seconds before flushing
        min_rows: int,  # Minimum number of rows before flushing
        max_rows: int,  # Maximum number of rows before flushing
        min_bytes: int,  # Minimum bytes before flushing
        max_bytes: int,  # Maximum bytes before flushing
        flush_time: Optional[int] = None,  # Optional: flush time override
        flush_rows: Optional[int] = None,  # Optional: flush rows override
        flush_bytes: Optional[int] = None,  # Optional: flush bytes override
    ):
        pass
```

#### Buffer Engine Considerations

**⚠️ Important Caveats:**
- Data in buffer is **lost if server crashes** before flush
- Not suitable for critical data that must be durable
- Best for high-throughput scenarios where minor data loss is acceptable
- Buffer and destination table must have identical schemas
- Buffer tables don't support `order_by_fields`, `partition_by`, or `sample_by_expression`

**Use Cases:**
1. **High-throughput ingestion**: Reduce the overhead of many small inserts
2. **Smoothing write load**: Buffer bursty writes and flush in larger batches
3. **Real-time dashboards**: Trade durability for lower write latency

For more details, see the [ClickHouse Buffer documentation](https://clickhouse.com/docs/en/engines/table-engines/special/buffer).

### Distributed Engine Tables

The Distributed engine creates a distributed table across a ClickHouse cluster for horizontal scaling and query parallelization.

#### Modern API (Recommended)

```python
from moose_lib import OlapConfig, OlapTable
from moose_lib.blocks import DistributedEngine
from pydantic import BaseModel

class Record(BaseModel):
    id: str
    timestamp: str
    value: float

# Distributed table across cluster
distributed_table = OlapTable[Record](
    "DistributedTable",
    OlapConfig(
        engine=DistributedEngine(
            cluster="my_cluster",
            target_database="default",
            target_table="local_table",
            sharding_key="cityHash64(id)"  # Optional: how to distribute data
        )
    )
)
```

#### Distributed Engine Configuration Options

```python
from moose_lib.blocks import DistributedEngine
from typing import Optional

# DistributedEngine configuration (modern API)
class DistributedEngine:
    """Configuration for Distributed engine - cluster-wide distributed tables"""
    def __init__(
        self,
        cluster: str,  # Cluster name from ClickHouse configuration
        target_database: str,  # Database name on the cluster
        target_table: str,  # Table name on the cluster (must exist on all nodes)
        sharding_key: Optional[str] = None,  # Optional: sharding key expression (e.g., 'cityHash64(id)')
        policy_name: Optional[str] = None,  # Optional: policy name for data distribution
    ):
        pass
```

#### Distributed Table Requirements

- Requires a configured ClickHouse cluster with `remote_servers` configuration
- The local table must exist on all cluster nodes with identical schema
- Distributed tables are virtual - actual data is stored in local tables
- Distributed tables don't support `order_by_fields`, `partition_by`, or `sample_by_expression`
- The `cluster` name must match a cluster defined in your ClickHouse configuration

**Use Cases:**
1. **Horizontal scaling**: Distribute data across multiple nodes for larger datasets
2. **Query parallelization**: Speed up queries by executing them across cluster nodes
3. **Load distribution**: Balance write and read load across multiple servers
4. **Geographic distribution**: Place data closer to users in different regions

For more details, see the [ClickHouse Distributed documentation](https://clickhouse.com/docs/en/engines/table-engines/special/distributed). 