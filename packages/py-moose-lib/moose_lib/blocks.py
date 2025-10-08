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
    ReplicatedMergeTree = "ReplicatedMergeTree"
    ReplicatedReplacingMergeTree = "ReplicatedReplacingMergeTree"
    ReplicatedAggregatingMergeTree = "ReplicatedAggregatingMergeTree"
    ReplicatedSummingMergeTree = "ReplicatedSummingMergeTree"

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
            raise ValueError("keeper_path and replica_name must both be provided or both be None")

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
            raise ValueError("keeper_path and replica_name must both be provided or both be None")
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
            raise ValueError("keeper_path and replica_name must both be provided or both be None")

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
            raise ValueError("keeper_path and replica_name must both be provided or both be None")

@dataclass
class S3QueueEngine(EngineConfig):
    """Configuration for S3Queue engine - only non-alterable constructor parameters.
    
    S3Queue-specific settings like 'mode', 'keeper_path', etc. should be specified
    in the settings field of OlapConfig, not here.
    """
    
    # Required fields
    s3_path: str  # S3 bucket path with wildcards (e.g., 's3://bucket/prefix/*.json')
    format: str   # Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')
    
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
    s3_queue_engine_config: Optional[S3QueueEngineConfig] = None  # Required when engine is S3Queue

    def __post_init__(self):
        """Validate S3Queue configuration"""
        if self.engine == ClickHouseEngines.S3Queue and self.s3_queue_engine_config is None:
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
    if hasattr(config, 'engine') and isinstance(getattr(config, 'engine'), EngineConfig):
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
        stacklevel=2
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
                headers=s3_config.headers
            ),
            order_by=legacy.order_by
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
        order_by=legacy.order_by
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
        create_materialized_view(MaterializedViewCreateOptions(
            name=options.materialized_view_name,
            destination_table=options.table_create_options.name,
            select=options.select
        )),
        populate_table(PopulateTableOptions(
            destination_table=options.table_create_options.name,
            select=options.select
        )),
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
    column_definitions = ",\n".join([f"{name} {type}" for name, type in options.columns.items()])
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