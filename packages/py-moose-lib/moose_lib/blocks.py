from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Any, Union
from abc import ABC
import warnings


class ClickHouseEngines(Enum):
    MergeTree = "MergeTree"
    ReplacingMergeTree = "ReplacingMergeTree"
    SummingMergeTree = "SummingMergeTree"
    AggregatingMergeTree = "AggregatingMergeTree"
    CollapsingMergeTree = "CollapsingMergeTree"
    VersionedCollapsingMergeTree = "VersionedCollapsingMergeTree"
    GraphiteMergeTree = "GraphiteMergeTree"
    S3Queue = "S3Queue"
    S3 = "S3"
    Buffer = "Buffer"
    Distributed = "Distributed"
    IcebergS3 = "IcebergS3"
    Kafka = "Kafka"
    ReplicatedMergeTree = "ReplicatedMergeTree"
    ReplicatedReplacingMergeTree = "ReplicatedReplacingMergeTree"
    ReplicatedAggregatingMergeTree = "ReplicatedAggregatingMergeTree"
    ReplicatedSummingMergeTree = "ReplicatedSummingMergeTree"
    ReplicatedCollapsingMergeTree = "ReplicatedCollapsingMergeTree"
    ReplicatedVersionedCollapsingMergeTree = "ReplicatedVersionedCollapsingMergeTree"


# ==========================
# New Engine Configuration Classes
# ==========================


@dataclass
class EngineConfig(ABC):
    """Base class for engine configurations"""

    pass


@dataclass
class MergeTreeEngine(EngineConfig):
    """Configuration for MergeTree engine"""

    pass


@dataclass
class ReplacingMergeTreeEngine(EngineConfig):
    """Configuration for ReplacingMergeTree engine (with deduplication)

    Args:
        ver: Optional column name for version tracking
        is_deleted: Optional column name for deletion marking (requires ver)
    """

    ver: Optional[str] = None
    is_deleted: Optional[str] = None

    def __post_init__(self):
        if self.is_deleted and not self.ver:
            raise ValueError("is_deleted requires ver to be specified")


@dataclass
class AggregatingMergeTreeEngine(EngineConfig):
    """Configuration for AggregatingMergeTree engine"""

    pass


@dataclass
class SummingMergeTreeEngine(EngineConfig):
    """Configuration for SummingMergeTree engine

    Args:
        columns: Optional list of column names to sum
    """

    columns: Optional[List[str]] = None


@dataclass
class CollapsingMergeTreeEngine(EngineConfig):
    """Configuration for CollapsingMergeTree engine

    Args:
        sign: Column name indicating row type (1 = state, -1 = cancel)
    """

    sign: str

    def __post_init__(self):
        if not self.sign:
            raise ValueError("sign column is required for CollapsingMergeTree")


@dataclass
class VersionedCollapsingMergeTreeEngine(EngineConfig):
    """Configuration for VersionedCollapsingMergeTree engine

    Args:
        sign: Column name indicating row type (1 = state, -1 = cancel)
        ver: Column name for object state versioning
    """

    sign: str
    ver: str

    def __post_init__(self):
        if not self.sign:
            raise ValueError("sign column is required for VersionedCollapsingMergeTree")
        if not self.ver:
            raise ValueError("ver column is required for VersionedCollapsingMergeTree")


@dataclass
class ReplicatedMergeTreeEngine(EngineConfig):
    """Configuration for ReplicatedMergeTree engine (replicated version of MergeTree)

    Args:
        keeper_path: Keeper path for replication (e.g., '/clickhouse/tables/{database}/{shard}/table_name')
                     Optional: omit for ClickHouse Cloud which manages replication automatically
        replica_name: Replica name (e.g., '{replica}')
                      Optional: omit for ClickHouse Cloud which manages replication automatically

    Note: Both keeper_path and replica_name must be provided together, or both omitted.
    """

    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None

    def __post_init__(self):
        # Both must be provided or both must be None
        if (self.keeper_path is None) != (self.replica_name is None):
            raise ValueError(
                "keeper_path and replica_name must both be provided or both be None"
            )


@dataclass
class ReplicatedReplacingMergeTreeEngine(EngineConfig):
    """Configuration for ReplicatedReplacingMergeTree engine (replicated version with deduplication)

    Args:
        keeper_path: Keeper path for replication (e.g., '/clickhouse/tables/{database}/{shard}/table_name')
                     Optional: omit for ClickHouse Cloud which manages replication automatically
        replica_name: Replica name (e.g., '{replica}')
                      Optional: omit for ClickHouse Cloud which manages replication automatically
        ver: Optional column name for version tracking
        is_deleted: Optional column name for deletion marking (requires ver)

    Note: Both keeper_path and replica_name must be provided together, or both omitted.
    """

    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None
    ver: Optional[str] = None
    is_deleted: Optional[str] = None

    def __post_init__(self):
        # Both must be provided or both must be None
        if (self.keeper_path is None) != (self.replica_name is None):
            raise ValueError(
                "keeper_path and replica_name must both be provided or both be None"
            )
        if self.is_deleted and not self.ver:
            raise ValueError("is_deleted requires ver to be specified")


@dataclass
class ReplicatedAggregatingMergeTreeEngine(EngineConfig):
    """Configuration for ReplicatedAggregatingMergeTree engine (replicated version for aggregations)

    Args:
        keeper_path: Keeper path for replication (e.g., '/clickhouse/tables/{database}/{shard}/table_name')
                     Optional: omit for ClickHouse Cloud which manages replication automatically
        replica_name: Replica name (e.g., '{replica}')
                      Optional: omit for ClickHouse Cloud which manages replication automatically

    Note: Both keeper_path and replica_name must be provided together, or both omitted.
    """

    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None

    def __post_init__(self):
        # Both must be provided or both must be None
        if (self.keeper_path is None) != (self.replica_name is None):
            raise ValueError(
                "keeper_path and replica_name must both be provided or both be None"
            )


@dataclass
class ReplicatedSummingMergeTreeEngine(EngineConfig):
    """Configuration for ReplicatedSummingMergeTree engine (replicated version for summation)

    Args:
        keeper_path: Keeper path for replication (e.g., '/clickhouse/tables/{database}/{shard}/table_name')
                     Optional: omit for ClickHouse Cloud which manages replication automatically
        replica_name: Replica name (e.g., '{replica}')
                      Optional: omit for ClickHouse Cloud which manages replication automatically
        columns: Optional list of column names to sum

    Note: Both keeper_path and replica_name must be provided together, or both omitted.
    """

    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None
    columns: Optional[List[str]] = None

    def __post_init__(self):
        # Both must be provided or both must be None
        if (self.keeper_path is None) != (self.replica_name is None):
            raise ValueError(
                "keeper_path and replica_name must both be provided or both be None"
            )


@dataclass
class ReplicatedCollapsingMergeTreeEngine(EngineConfig):
    """Configuration for ReplicatedCollapsingMergeTree engine (replicated version with collapsing)

    Args:
        keeper_path: Keeper path for replication (e.g., '/clickhouse/tables/{database}/{shard}/table_name')
                     Optional: omit for ClickHouse Cloud which manages replication automatically
        replica_name: Replica name (e.g., '{replica}')
                      Optional: omit for ClickHouse Cloud which manages replication automatically
        sign: Column name indicating row type (1 = state, -1 = cancel)

    Note: Both keeper_path and replica_name must be provided together, or both omitted.
    """

    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None
    sign: str = field(default=None)

    def __post_init__(self):
        # Both must be provided or both must be None
        if (self.keeper_path is None) != (self.replica_name is None):
            raise ValueError(
                "keeper_path and replica_name must both be provided or both be None"
            )
        if not self.sign:
            raise ValueError(
                "sign column is required for ReplicatedCollapsingMergeTree"
            )


@dataclass
class ReplicatedVersionedCollapsingMergeTreeEngine(EngineConfig):
    """Configuration for ReplicatedVersionedCollapsingMergeTree engine (replicated version with versioned collapsing)

    Args:
        keeper_path: Keeper path for replication (e.g., '/clickhouse/tables/{database}/{shard}/table_name')
                     Optional: omit for ClickHouse Cloud which manages replication automatically
        replica_name: Replica name (e.g., '{replica}')
                      Optional: omit for ClickHouse Cloud which manages replication automatically
        sign: Column name indicating row type (1 = state, -1 = cancel)
        ver: Column name for object state versioning

    Note: Both keeper_path and replica_name must be provided together, or both omitted.
    """

    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None
    sign: str = field(default=None)
    ver: str = field(default=None)

    def __post_init__(self):
        # Both must be provided or both must be None
        if (self.keeper_path is None) != (self.replica_name is None):
            raise ValueError(
                "keeper_path and replica_name must both be provided or both be None"
            )
        if not self.sign:
            raise ValueError(
                "sign column is required for ReplicatedVersionedCollapsingMergeTree"
            )
        if not self.ver:
            raise ValueError(
                "ver column is required for ReplicatedVersionedCollapsingMergeTree"
            )


@dataclass
class S3QueueEngine(EngineConfig):
    """Configuration for S3Queue engine - only non-alterable constructor parameters.

    S3Queue-specific settings like 'mode', 'keeper_path', etc. should be specified
    in the settings field of OlapConfig, not here.
    """

    # Required fields
    s3_path: str  # S3 bucket path with wildcards (e.g., 's3://bucket/prefix/*.json')
    format: str  # Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')

    # Optional AWS credentials
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None

    # Optional configuration
    compression: Optional[str] = None  # e.g., 'gzip', 'zstd'
    headers: Optional[Dict[str, str]] = None

    def __post_init__(self):
        """Validate required fields"""
        if not self.s3_path:
            raise ValueError("S3Queue engine requires 's3_path'")
        if not self.format:
            raise ValueError("S3Queue engine requires 'format'")


@dataclass
class S3Engine(EngineConfig):
    """Configuration for S3 engine - direct read/write from S3 storage.

    Args:
        path: S3 path to the data file(s) (e.g., 's3://bucket/path/file.json')
        format: Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')
        aws_access_key_id: AWS access key ID (optional, omit for public buckets)
        aws_secret_access_key: AWS secret access key (optional, omit for public buckets)
        compression: Compression type (e.g., 'gzip', 'zstd', 'auto')
        partition_strategy: Optional partition strategy
        partition_columns_in_data_file: Optional partition columns in data file
    """

    # Required fields
    path: str
    format: str

    # Optional fields
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    compression: Optional[str] = None
    partition_strategy: Optional[str] = None
    partition_columns_in_data_file: Optional[str] = None

    def __post_init__(self):
        """Validate required fields"""
        if not self.path:
            raise ValueError("S3 engine requires 'path'")
        if not self.format:
            raise ValueError("S3 engine requires 'format'")


@dataclass
class BufferEngine(EngineConfig):
    """Configuration for Buffer engine - in-memory buffer that flushes to a destination table.

    Args:
        target_database: Target database name for the destination table
        target_table: Target table name where data will be flushed
        num_layers: Number of buffer layers (typically 16)
        min_time: Minimum time in seconds before flushing
        max_time: Maximum time in seconds before flushing
        min_rows: Minimum number of rows before flushing
        max_rows: Maximum number of rows before flushing
        min_bytes: Minimum bytes before flushing
        max_bytes: Maximum bytes before flushing
        flush_time: Optional flush time in seconds
        flush_rows: Optional flush number of rows
        flush_bytes: Optional flush number of bytes
    """

    # Required fields
    target_database: str
    target_table: str
    num_layers: int
    min_time: int
    max_time: int
    min_rows: int
    max_rows: int
    min_bytes: int
    max_bytes: int

    # Optional fields
    flush_time: Optional[int] = None
    flush_rows: Optional[int] = None
    flush_bytes: Optional[int] = None

    def __post_init__(self):
        """Validate required fields"""
        if not self.target_database:
            raise ValueError("Buffer engine requires 'target_database'")
        if not self.target_table:
            raise ValueError("Buffer engine requires 'target_table'")


@dataclass
class DistributedEngine(EngineConfig):
    """Configuration for Distributed engine - distributed table across a cluster.

    Args:
        cluster: Cluster name from the ClickHouse configuration
        target_database: Database name on the cluster
        target_table: Table name on the cluster
        sharding_key: Optional sharding key expression for data distribution
        policy_name: Optional policy name for data distribution
    """

    # Required fields
    cluster: str
    target_database: str
    target_table: str

    # Optional fields
    sharding_key: Optional[str] = None
    policy_name: Optional[str] = None

    def __post_init__(self):
        """Validate required fields"""
        if not self.cluster:
            raise ValueError("Distributed engine requires 'cluster'")
        if not self.target_database:
            raise ValueError("Distributed engine requires 'target_database'")
        if not self.target_table:
            raise ValueError("Distributed engine requires 'target_table'")


@dataclass
class IcebergS3Engine(EngineConfig):
    """Configuration for IcebergS3 engine - read-only Iceberg table access.

    Provides direct querying of Apache Iceberg tables stored on S3.
    Data is not copied; queries stream directly from Parquet/ORC files.

    Args:
        path: S3 path to Iceberg table root (e.g., 's3://bucket/warehouse/events/')
        format: Data format - 'Parquet' or 'ORC'
        aws_access_key_id: AWS access key ID (optional, omit for public buckets or IAM roles)
        aws_secret_access_key: AWS secret access key (optional)
        compression: Compression type (optional: 'gzip', 'zstd', 'auto')

    Example:
        >>> from moose_lib import OlapTable, OlapConfig, moose_runtime_env
        >>> from moose_lib.blocks import IcebergS3Engine
        >>>
        >>> lake_events = OlapTable[Event](
        ...     "lake_events",
        ...     OlapConfig(
        ...         engine=IcebergS3Engine(
        ...             path="s3://datalake/events/",
        ...             format="Parquet",
        ...             aws_access_key_id=moose_runtime_env.get("AWS_ACCESS_KEY_ID"),
        ...             aws_secret_access_key=moose_runtime_env.get("AWS_SECRET_ACCESS_KEY")
        ...         )
        ...     )
        ... )

    Note:
        - IcebergS3 engine is read-only
        - Does not support ORDER BY, PARTITION BY, or SAMPLE BY clauses
        - Queries always see the latest Iceberg snapshot (with metadata cache)
    """

    # Required fields
    path: str
    format: str

    # Optional fields
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    compression: Optional[str] = None

    def __post_init__(self):
        """Validate required fields"""
        if not self.path:
            raise ValueError("IcebergS3 engine requires 'path'")
        if not self.format:
            raise ValueError("IcebergS3 engine requires 'format'")
        if self.format not in ["Parquet", "ORC"]:
            raise ValueError(
                f"IcebergS3 format must be 'Parquet' or 'ORC', got '{self.format}'"
            )


@dataclass
class KafkaEngine(EngineConfig):
    """Kafka engine for streaming data from Kafka topics.

    Args:
        broker_list: Kafka broker addresses (e.g., 'kafka:9092')
        topic_list: Topics to consume from
        group_name: Consumer group identifier
        format: Message format (e.g., 'JSONEachRow')

    Additional settings (kafka_num_consumers, security) go in OlapConfig.settings.
    """

    broker_list: str
    topic_list: str
    group_name: str
    format: str

    def __post_init__(self):
        """Validate required fields"""
        if not self.broker_list:
            raise ValueError("Kafka engine requires 'broker_list'")
        if not self.topic_list:
            raise ValueError("Kafka engine requires 'topic_list'")
        if not self.group_name:
            raise ValueError("Kafka engine requires 'group_name'")
        if not self.format:
            raise ValueError("Kafka engine requires 'format'")


# ==========================
# New Table Configuration (Recommended API)
# ==========================


@dataclass
class TableConfig:
    """Modern table configuration with engine-specific settings"""

    # Engine configuration (required in new API)
    engine: EngineConfig

    # Common settings
    name: str
    columns: Dict[str, str]
    order_by: Optional[str] = None

    # Note: Factory methods (with_s3_queue, with_merge_tree, with_replacing_merge_tree)
    # were removed in ENG-856. Use direct configuration instead, e.g.:
    # TableConfig(name="table", columns={...}, engine=S3QueueEngine(s3_path="...", format="..."))
    # TableConfig(name="table", columns={...}, engine=ReplacingMergeTreeEngine(ver="updated_at"))


# ==========================
# Legacy API Support (Deprecated)
# ==========================


@dataclass
class S3QueueEngineConfig:
    """Legacy S3Queue configuration (deprecated - use S3QueueEngine instead)"""

    path: str  # S3 path pattern (e.g., 's3://bucket/data/*.json')
    format: str  # Data format (e.g., 'JSONEachRow', 'CSV', etc.)
    # Optional S3 access credentials - can be NOSIGN for public buckets
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    # Optional compression
    compression: Optional[str] = None
    # Optional headers
    headers: Optional[Dict[str, str]] = None


@dataclass
class TableCreateOptions:
    name: str
    columns: Dict[str, str]
    engine: Optional[ClickHouseEngines] = ClickHouseEngines.MergeTree
    order_by: Optional[str] = None
    s3_queue_engine_config: Optional[S3QueueEngineConfig] = (
        None  # Required when engine is S3Queue
    )

    def __post_init__(self):
        """Validate S3Queue configuration"""
        if (
            self.engine == ClickHouseEngines.S3Queue
            and self.s3_queue_engine_config is None
        ):
            raise ValueError(
                "s3_queue_engine_config is required when using ClickHouseEngines.S3Queue engine. "
                "Please provide s3_queue_engine_config with path, format, and optional settings."
            )


# ==========================
# Backward Compatibility Layer
# ==========================


def is_new_config(config: Any) -> bool:
    """Check if configuration uses new API"""
    if isinstance(config, TableConfig):
        return True
    if hasattr(config, "engine") and isinstance(
        getattr(config, "engine"), EngineConfig
    ):
        return True
    return False


def migrate_legacy_config(legacy: TableCreateOptions) -> TableConfig:
    """Convert legacy configuration to new format"""

    # Show deprecation warning
    warnings.warn(
        "Using deprecated TableCreateOptions. Please migrate to TableConfig:\n"
        "- For S3Queue: Use TableConfig(name='table', columns={...}, engine=S3QueueEngine(s3_path='...', format='...'))\n"
        "- For deduplication: Use TableConfig(name='table', columns={...}, engine=ReplacingMergeTreeEngine())\n"
        "See documentation for examples.",
        DeprecationWarning,
        stacklevel=2,
    )

    # Handle S3Queue with separate config
    if legacy.engine == ClickHouseEngines.S3Queue and legacy.s3_queue_engine_config:
        s3_config = legacy.s3_queue_engine_config
        return TableConfig(
            name=legacy.name,
            columns=legacy.columns,
            engine=S3QueueEngine(
                s3_path=s3_config.path,
                format=s3_config.format,
                aws_access_key_id=s3_config.aws_access_key_id,
                aws_secret_access_key=s3_config.aws_secret_access_key,
                compression=s3_config.compression,
                headers=s3_config.headers,
            ),
            order_by=legacy.order_by,
        )

    # Map legacy engine enum to new engine classes
    engine_map = {
        ClickHouseEngines.MergeTree: MergeTreeEngine(),
        ClickHouseEngines.ReplacingMergeTree: ReplacingMergeTreeEngine(),
        ClickHouseEngines.AggregatingMergeTree: AggregatingMergeTreeEngine(),
        ClickHouseEngines.SummingMergeTree: SummingMergeTreeEngine(),
    }

    engine = engine_map.get(legacy.engine) if legacy.engine else MergeTreeEngine()
    if engine is None:
        engine = MergeTreeEngine()

    return TableConfig(
        name=legacy.name,
        columns=legacy.columns,
        engine=engine,
        order_by=legacy.order_by,
    )


def normalize_config(config: Union[TableConfig, TableCreateOptions]) -> TableConfig:
    """Normalize any configuration format to new API"""
    if is_new_config(config):
        return config  # type: ignore
    return migrate_legacy_config(config)  # type: ignore


@dataclass
class AggregationCreateOptions:
    table_create_options: TableCreateOptions
    materialized_view_name: str
    select: str


@dataclass
class AggregationDropOptions:
    view_name: str
    table_name: str


@dataclass
class MaterializedViewCreateOptions:
    name: str
    destination_table: str
    select: str


@dataclass
class PopulateTableOptions:
    destination_table: str
    select: str


@dataclass
class Blocks:
    teardown: list[str]
    setup: list[str]


def drop_aggregation(options: AggregationDropOptions) -> list[str]:
    """
    Drops an aggregation's view & underlying table.
    """
    return [drop_view(options.view_name), drop_table(options.table_name)]


def drop_table(name: str) -> str:
    """
    Drops an existing table if it exists.
    """
    return f"DROP TABLE IF EXISTS {name}".strip()


def drop_view(name: str) -> str:
    """
    Drops an existing view if it exists.
    """
    return f"DROP VIEW IF EXISTS {name}".strip()


def create_aggregation(options: AggregationCreateOptions) -> list[str]:
    """
    Creates an aggregation which includes a table, materialized view, and initial data load.
    """
    return [
        create_table(options.table_create_options),
        create_materialized_view(
            MaterializedViewCreateOptions(
                name=options.materialized_view_name,
                destination_table=options.table_create_options.name,
                select=options.select,
            )
        ),
        populate_table(
            PopulateTableOptions(
                destination_table=options.table_create_options.name,
                select=options.select,
            )
        ),
    ]


def create_materialized_view(options: MaterializedViewCreateOptions) -> str:
    """
    Creates a materialized view.
    """
    return f"CREATE MATERIALIZED VIEW IF NOT EXISTS {options.name} \nTO {options.destination_table}\nAS {options.select}".strip()


def create_table(options: TableCreateOptions) -> str:
    """
    Creates a new table with default MergeTree engine.
    """
    column_definitions = ",\n".join(
        [f"{name} {type}" for name, type in options.columns.items()]
    )
    order_by_clause = f"ORDER BY {options.order_by}" if options.order_by else ""
    engine = options.engine.value if options.engine else "MergeTree"

    return f"""
    CREATE TABLE IF NOT EXISTS {options.name} 
    (
      {column_definitions}
    )
    ENGINE = {engine}()
    {order_by_clause}
    """.strip()


def populate_table(options: PopulateTableOptions) -> str:
    """
    Populates a table with data.
    """
    return f"INSERT INTO {options.destination_table}\n{options.select}".strip()
