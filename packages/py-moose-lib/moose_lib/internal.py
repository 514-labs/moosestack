"""
Internal utilities for Moose Python library.

This module contains Pydantic models representing the configuration signature
of various Moose resources (tables, streams/topics, APIs) and functions
to convert the user-defined resources (from `dmv2.py`) into a serializable
JSON format expected by the Moose infrastructure management system.
"""

from importlib import import_module
from typing import Literal, Optional, List, Any, Dict, Union, TYPE_CHECKING
from pydantic import BaseModel, ConfigDict, AliasGenerator, Field
import json
import os
import sys
from pathlib import Path
from .data_models import Column, _to_columns
from .blocks import EngineConfig, ClickHouseEngines
from moose_lib.dmv2 import (
    get_tables,
    get_streams,
    get_ingest_apis,
    get_apis,
    get_sql_resources,
    get_workflows,
    get_web_apps,
    get_materialized_views,
    get_views,
    OlapTable,
    OlapConfig,
    SqlResource,
)
from moose_lib.dmv2.stream import KafkaSchemaConfig
from pydantic.alias_generators import to_camel
from pydantic.json_schema import JsonSchemaValue

model_config = ConfigDict(
    alias_generator=AliasGenerator(
        serialization_alias=to_camel,
    )
)


class Target(BaseModel):
    """Represents a target destination for data flow, typically a stream.

    Attributes:
        kind: The type of the target (currently only "stream").
        name: The name of the target stream.
        version: Optional version of the target stream configuration.
        metadata: Optional metadata for the target stream.
    """

    kind: Literal["stream"]
    name: str
    version: Optional[str] = None
    metadata: Optional[dict] = None


class Consumer(BaseModel):
    """Represents a consumer attached to a stream.

    Attributes:
        version: Optional version of the consumer configuration.
    """

    version: Optional[str] = None


class BaseEngineConfigDict(BaseModel):
    """Base engine configuration for all ClickHouse table engines."""

    model_config = model_config
    engine: str


class MergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for MergeTree engine."""

    engine: Literal["MergeTree"] = "MergeTree"


class ReplacingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for ReplacingMergeTree engine."""

    engine: Literal["ReplacingMergeTree"] = "ReplacingMergeTree"
    ver: Optional[str] = None
    is_deleted: Optional[str] = None


class AggregatingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for AggregatingMergeTree engine."""

    engine: Literal["AggregatingMergeTree"] = "AggregatingMergeTree"


class SummingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for SummingMergeTree engine."""

    engine: Literal["SummingMergeTree"] = "SummingMergeTree"
    columns: Optional[List[str]] = None


class CollapsingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for CollapsingMergeTree engine."""

    engine: Literal["CollapsingMergeTree"] = "CollapsingMergeTree"
    sign: str


class VersionedCollapsingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for VersionedCollapsingMergeTree engine."""

    engine: Literal["VersionedCollapsingMergeTree"] = "VersionedCollapsingMergeTree"
    sign: str
    ver: str


class ReplicatedMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for ReplicatedMergeTree engine."""

    engine: Literal["ReplicatedMergeTree"] = "ReplicatedMergeTree"
    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None


class ReplicatedReplacingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for ReplicatedReplacingMergeTree engine."""

    engine: Literal["ReplicatedReplacingMergeTree"] = "ReplicatedReplacingMergeTree"
    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None
    ver: Optional[str] = None
    is_deleted: Optional[str] = None


class ReplicatedAggregatingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for ReplicatedAggregatingMergeTree engine."""

    engine: Literal["ReplicatedAggregatingMergeTree"] = "ReplicatedAggregatingMergeTree"
    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None


class ReplicatedSummingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for ReplicatedSummingMergeTree engine."""

    engine: Literal["ReplicatedSummingMergeTree"] = "ReplicatedSummingMergeTree"
    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None
    columns: Optional[List[str]] = None


class ReplicatedCollapsingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for ReplicatedCollapsingMergeTree engine."""

    engine: Literal["ReplicatedCollapsingMergeTree"] = "ReplicatedCollapsingMergeTree"
    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None
    sign: str


class ReplicatedVersionedCollapsingMergeTreeConfigDict(BaseEngineConfigDict):
    """Configuration for ReplicatedVersionedCollapsingMergeTree engine."""

    engine: Literal["ReplicatedVersionedCollapsingMergeTree"] = (
        "ReplicatedVersionedCollapsingMergeTree"
    )
    keeper_path: Optional[str] = None
    replica_name: Optional[str] = None
    sign: str
    ver: str


class S3QueueConfigDict(BaseEngineConfigDict):
    """Configuration for S3Queue engine with all specific fields."""

    engine: Literal["S3Queue"] = "S3Queue"
    s3_path: str
    format: str
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    compression: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class S3ConfigDict(BaseEngineConfigDict):
    """Configuration for S3 engine."""

    engine: Literal["S3"] = "S3"
    path: str
    format: str
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    compression: Optional[str] = None
    partition_strategy: Optional[str] = None
    partition_columns_in_data_file: Optional[str] = None


class BufferConfigDict(BaseEngineConfigDict):
    """Configuration for Buffer engine."""

    engine: Literal["Buffer"] = "Buffer"
    target_database: str
    target_table: str
    num_layers: int
    min_time: int
    max_time: int
    min_rows: int
    max_rows: int
    min_bytes: int
    max_bytes: int
    flush_time: Optional[int] = None
    flush_rows: Optional[int] = None
    flush_bytes: Optional[int] = None


class DistributedConfigDict(BaseEngineConfigDict):
    """Configuration for Distributed engine."""

    engine: Literal["Distributed"] = "Distributed"
    cluster: str
    target_database: str
    target_table: str
    sharding_key: Optional[str] = None
    policy_name: Optional[str] = None


class IcebergS3ConfigDict(BaseEngineConfigDict):
    """Configuration for IcebergS3 engine."""

    engine: Literal["IcebergS3"] = "IcebergS3"
    path: str
    format: str
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    compression: Optional[str] = None


class KafkaConfigDict(BaseEngineConfigDict):
    """Configuration for Kafka engine.

    Constructor: ENGINE = Kafka('broker', 'topic', 'group', 'format')
    Settings (kafka_schema, kafka_num_consumers, security, etc.) go in table settings.

    Reference: https://clickhouse.com/docs/engines/table-engines/integrations/kafka
    """

    engine: Literal["Kafka"] = "Kafka"
    broker_list: str
    topic_list: str
    group_name: str
    format: str


# Discriminated union of all engine configurations
EngineConfigDict = Union[
    MergeTreeConfigDict,
    ReplacingMergeTreeConfigDict,
    AggregatingMergeTreeConfigDict,
    SummingMergeTreeConfigDict,
    CollapsingMergeTreeConfigDict,
    VersionedCollapsingMergeTreeConfigDict,
    ReplicatedMergeTreeConfigDict,
    ReplicatedReplacingMergeTreeConfigDict,
    ReplicatedAggregatingMergeTreeConfigDict,
    ReplicatedSummingMergeTreeConfigDict,
    ReplicatedCollapsingMergeTreeConfigDict,
    ReplicatedVersionedCollapsingMergeTreeConfigDict,
    S3QueueConfigDict,
    S3ConfigDict,
    BufferConfigDict,
    DistributedConfigDict,
    IcebergS3ConfigDict,
    KafkaConfigDict,
]


class TableConfig(BaseModel):
    """Internal representation of an OLAP table configuration for serialization.

    Attributes:
        name: Name of the table.
        columns: List of columns with their types and attributes.
        order_by: List of columns used for the ORDER BY clause.
        partition_by: The column name used for the PARTITION BY clause.
        sample_by_expression: Optional SAMPLE BY expression for data sampling.
        primary_key_expression: Optional PRIMARY KEY expression (overrides column-level primary_key flags when specified).
        engine_config: Engine configuration with type-safe, engine-specific parameters.
        version: Optional version string of the table configuration.
        metadata: Optional metadata for the table.
        life_cycle: Lifecycle management setting for the table.
        table_settings: Optional table-level settings that can be modified with ALTER TABLE MODIFY SETTING.
        cluster: Optional cluster name for ON CLUSTER support in ClickHouse.
    """

    model_config = model_config

    name: str
    columns: List[Column]
    order_by: List[str] | str
    partition_by: Optional[str]
    sample_by_expression: Optional[str] = None
    primary_key_expression: Optional[str] = None
    engine_config: Optional[EngineConfigDict] = Field(None, discriminator="engine")
    version: Optional[str] = None
    metadata: Optional[dict] = None
    life_cycle: Optional[str] = None
    table_settings: Optional[dict[str, str]] = None
    indexes: list[OlapConfig.TableIndex] = []
    ttl: Optional[str] = None
    database: Optional[str] = None
    cluster: Optional[str] = None


class TopicConfig(BaseModel):
    """Internal representation of a stream/topic configuration for serialization.

    Attributes:
        name: Name of the topic.
        columns: List of columns (fields) in the topic messages.
        target_table: Optional name of the OLAP table this topic automatically syncs to.
        target_table_version: Optional version of the target table configuration.
        version: Optional version string of the topic configuration.
        retention_period: Data retention period in seconds.
        partition_count: Number of partitions.
        transformation_targets: List of streams this topic transforms data into.
        has_multi_transform: Flag indicating if a multi-transform function is defined.
        consumers: List of consumers attached to this topic.
        metadata: Optional metadata for the topic.
        life_cycle: Lifecycle management setting for the topic.
    """

    model_config = model_config

    name: str
    columns: List[Column]
    target_table: Optional[str] = None
    target_table_version: Optional[str] = None
    version: Optional[str] = None
    retention_period: int
    partition_count: int
    transformation_targets: List[Target]
    has_multi_transform: bool
    consumers: List[Consumer]
    metadata: Optional[dict] = None
    life_cycle: Optional[str] = None
    schema_config: Optional[KafkaSchemaConfig] = None


class IngestApiConfig(BaseModel):
    """Internal representation of an Ingest API configuration for serialization.

    Attributes:
        name: Name of the Ingest API.
        columns: List of columns expected in the input data.
        write_to: The target stream where the ingested data is written.
        dead_letter_queue: Optional dead letter queue name.
        version: Optional version string of the API configuration.
        path: Optional custom path for the ingestion endpoint.
        metadata: Optional metadata for the API.
        allow_extra_fields: Whether this API allows extra fields beyond the defined columns.
            When true, extra fields in payloads are passed through to streaming functions.
    """

    model_config = model_config

    name: str
    columns: List[Column]
    write_to: Target
    dead_letter_queue: Optional[str] = None
    version: Optional[str] = None
    path: Optional[str] = None
    metadata: Optional[dict] = None
    json_schema: dict[str, Any] = Field(serialization_alias="schema")
    allow_extra_fields: bool = False


class InternalApiConfig(BaseModel):
    """Internal representation of a API configuration for serialization.

    Attributes:
        name: Name of the API.
        query_params: List of columns representing the expected query parameters.
        response_schema: JSON schema definition of the API's response body.
        version: Optional version string of the API configuration.
        path: Optional custom path for the API endpoint.
        metadata: Optional metadata for the API.
    """

    model_config = model_config

    name: str
    query_params: List[Column]
    response_schema: JsonSchemaValue
    version: Optional[str] = None
    path: Optional[str] = None
    metadata: Optional[dict] = None


class WorkflowJson(BaseModel):
    """Internal representation of a workflow configuration for serialization.

    Attributes:
        name: Name of the workflow.
        retries: Optional number of retry attempts for the entire workflow.
        timeout: Optional timeout string for the entire workflow.
        schedule: Optional cron-like schedule string for recurring execution.
    """

    model_config = model_config

    name: str
    retries: Optional[int] = None
    timeout: Optional[str] = None
    schedule: Optional[str] = None


class WebAppMetadataJson(BaseModel):
    """Internal representation of WebApp metadata for serialization.

    Attributes:
        description: Optional description of the WebApp.
    """

    model_config = model_config

    description: Optional[str] = None


class WebAppJson(BaseModel):
    """Internal representation of a WebApp configuration for serialization.

    Attributes:
        name: Name of the WebApp.
        mount_path: The URL path where the WebApp is mounted.
        metadata: Optional metadata for documentation purposes.
    """

    model_config = model_config

    name: str
    mount_path: str
    metadata: Optional[WebAppMetadataJson] = None


class InfrastructureSignatureJson(BaseModel):
    """Represents the unique signature of an infrastructure component (Table, Topic, etc.).

    Used primarily for defining dependencies between SQL resources.

    Attributes:
        id: A unique identifier for the resource instance (often name + version).
        kind: The type of the infrastructure component.
    """

    id: str
    kind: Literal[
        "Table",
        "Topic",
        "ApiEndpoint",
        "TopicToTableSyncProcess",
        "View",
        "MaterializedView",
        "SqlResource",
    ]


class SqlResourceConfig(BaseModel):
    """Internal representation of a generic SQL resource (like View, MaterializedView) for serialization.

    Attributes:
        name: Name of the SQL resource.
        setup: List of SQL commands required to create the resource.
        teardown: List of SQL commands required to drop the resource.
        pulls_data_from: List of infrastructure components this resource reads from.
        pushes_data_to: List of infrastructure components this resource writes to.
        source_file: Optional path to the source file where this resource is defined.
        metadata: Optional metadata for the resource.
    """

    model_config = model_config

    name: str
    setup: list[str]
    teardown: list[str]
    pulls_data_from: list[InfrastructureSignatureJson]
    pushes_data_to: list[InfrastructureSignatureJson]
    source_file: Optional[str] = None
    metadata: Optional[dict] = None


class MaterializedViewJson(BaseModel):
    """Internal representation of a structured Materialized View for serialization.

    Attributes:
        name: Name of the materialized view.
        database: Optional database where the MV is created.
        select_sql: The SELECT SQL statement.
        source_tables: Names of source tables the SELECT reads from.
        target_table: Name of the target table where data is written.
        target_database: Optional database for the target table.
        metadata: Optional metadata for the materialized view (e.g., description, source file).
    """

    model_config = model_config

    name: str
    database: Optional[str] = None
    select_sql: str
    source_tables: List[str]
    target_table: str
    target_database: Optional[str] = None
    metadata: Optional[dict] = None


class ViewJson(BaseModel):
    """Internal representation of a structured Custom View for serialization.

    Attributes:
        name: Name of the view.
        database: Optional database where the view is created.
        select_sql: The SELECT SQL statement.
        source_tables: Names of source tables the SELECT reads from.
        metadata: Optional metadata for the view (e.g., description, source file).
    """

    model_config = model_config

    name: str
    database: Optional[str] = None
    select_sql: str
    source_tables: List[str]
    metadata: Optional[dict] = None


class InfrastructureMap(BaseModel):
    """Top-level model holding the configuration for all defined Moose resources.

    This structure is serialized to JSON and passed to the Moose infrastructure system.

    Attributes:
        tables: Dictionary mapping table names to their configurations.
        topics: Dictionary mapping topic/stream names to their configurations.
        ingest_apis: Dictionary mapping ingest API names to their configurations.
        apis: Dictionary mapping API names to their configurations.
        sql_resources: Dictionary mapping SQL resource names to their configurations.
        workflows: Dictionary mapping workflow names to their configurations.
        web_apps: Dictionary mapping WebApp names to their configurations.
        materialized_views: Dictionary mapping MV names to their structured configurations.
        views: Dictionary mapping view names to their structured configurations.
        unloaded_files: List of source files that exist but weren't loaded.
    """

    model_config = model_config

    tables: dict[str, TableConfig]
    topics: dict[str, TopicConfig]
    ingest_apis: dict[str, IngestApiConfig]
    apis: dict[str, InternalApiConfig]
    sql_resources: dict[str, SqlResourceConfig]
    workflows: dict[str, WorkflowJson]
    web_apps: dict[str, WebAppJson]
    materialized_views: dict[str, MaterializedViewJson]
    views: dict[str, ViewJson]
    unloaded_files: list[str] = []


def _map_sql_resource_ref(r: Any) -> InfrastructureSignatureJson:
    """Maps a `dmv2` SQL resource object to its `InfrastructureSignatureJson`.

    Determines the correct `kind` and generates the `id` based on the resource
    type and its configuration (e.g., including version if present).

    Args:
        r: An instance of OlapTable, View, MaterializedView, or SqlResource.

    Returns:
        An InfrastructureSignatureJson representing the resource.

    Raises:
        TypeError: If the input object is not a recognized SQL resource type.
    """
    if hasattr(r, "kind"):
        if r.kind == "OlapTable":
            # Explicitly cast for type hint checking if needed, though Python is dynamic
            table = r  # type: OlapTable
            res_id = (
                f"{table.name}_{table.config.version}"
                if table.config.version
                else table.name
            )
            return InfrastructureSignatureJson(id=res_id, kind="Table")
        elif r.kind == "SqlResource":
            # Explicitly cast for type hint checking if needed
            resource = r  # type: SqlResource
            return InfrastructureSignatureJson(id=resource.name, kind="SqlResource")
        elif r.kind == "View":
            return InfrastructureSignatureJson(id=r.name, kind="View")
        elif r.kind == "MaterializedView":
            return InfrastructureSignatureJson(id=r.name, kind="MaterializedView")
        else:
            raise TypeError(f"Unknown SQL resource kind: {r.kind} for object: {r}")
    else:
        # Fallback or error if 'kind' attribute is missing
        raise TypeError(f"Object {r} lacks a 'kind' attribute for dependency mapping.")


def _convert_basic_engine_instance(
    engine: "EngineConfig",
) -> Optional[EngineConfigDict]:
    """Convert basic MergeTree engine instances to config dict.

    Args:
        engine: An EngineConfig instance

    Returns:
        EngineConfigDict if matched, None otherwise
    """
    from moose_lib.blocks import (
        MergeTreeEngine,
        ReplacingMergeTreeEngine,
        AggregatingMergeTreeEngine,
        SummingMergeTreeEngine,
        CollapsingMergeTreeEngine,
        VersionedCollapsingMergeTreeEngine,
    )

    if isinstance(engine, MergeTreeEngine):
        return MergeTreeConfigDict()
    elif isinstance(engine, ReplacingMergeTreeEngine):
        return ReplacingMergeTreeConfigDict(
            ver=engine.ver, is_deleted=engine.is_deleted
        )
    elif isinstance(engine, AggregatingMergeTreeEngine):
        return AggregatingMergeTreeConfigDict()
    elif isinstance(engine, SummingMergeTreeEngine):
        return SummingMergeTreeConfigDict(columns=engine.columns)
    elif isinstance(engine, CollapsingMergeTreeEngine):
        return CollapsingMergeTreeConfigDict(sign=engine.sign)
    elif isinstance(engine, VersionedCollapsingMergeTreeEngine):
        return VersionedCollapsingMergeTreeConfigDict(sign=engine.sign, ver=engine.ver)
    return None


def _convert_replicated_engine_instance(
    engine: "EngineConfig",
) -> Optional[EngineConfigDict]:
    """Convert replicated MergeTree engine instances to config dict.

    Args:
        engine: An EngineConfig instance

    Returns:
        EngineConfigDict if matched, None otherwise
    """
    from moose_lib.blocks import (
        ReplicatedMergeTreeEngine,
        ReplicatedReplacingMergeTreeEngine,
        ReplicatedAggregatingMergeTreeEngine,
        ReplicatedSummingMergeTreeEngine,
        ReplicatedCollapsingMergeTreeEngine,
        ReplicatedVersionedCollapsingMergeTreeEngine,
    )

    if isinstance(engine, ReplicatedMergeTreeEngine):
        return ReplicatedMergeTreeConfigDict(
            keeper_path=engine.keeper_path, replica_name=engine.replica_name
        )
    elif isinstance(engine, ReplicatedReplacingMergeTreeEngine):
        return ReplicatedReplacingMergeTreeConfigDict(
            keeper_path=engine.keeper_path,
            replica_name=engine.replica_name,
            ver=engine.ver,
            is_deleted=engine.is_deleted,
        )
    elif isinstance(engine, ReplicatedAggregatingMergeTreeEngine):
        return ReplicatedAggregatingMergeTreeConfigDict(
            keeper_path=engine.keeper_path, replica_name=engine.replica_name
        )
    elif isinstance(engine, ReplicatedSummingMergeTreeEngine):
        return ReplicatedSummingMergeTreeConfigDict(
            keeper_path=engine.keeper_path,
            replica_name=engine.replica_name,
            columns=engine.columns,
        )
    elif isinstance(engine, ReplicatedCollapsingMergeTreeEngine):
        return ReplicatedCollapsingMergeTreeConfigDict(
            keeper_path=engine.keeper_path,
            replica_name=engine.replica_name,
            sign=engine.sign,
        )
    elif isinstance(engine, ReplicatedVersionedCollapsingMergeTreeEngine):
        return ReplicatedVersionedCollapsingMergeTreeConfigDict(
            keeper_path=engine.keeper_path,
            replica_name=engine.replica_name,
            sign=engine.sign,
            ver=engine.ver,
        )
    return None


def _convert_engine_instance_to_config_dict(engine: "EngineConfig") -> EngineConfigDict:
    """Convert an EngineConfig instance to config dict format.

    Args:
        engine: An EngineConfig instance

    Returns:
        EngineConfigDict with engine-specific configuration
    """
    from moose_lib.blocks import (
        S3QueueEngine,
        S3Engine,
        BufferEngine,
        DistributedEngine,
        IcebergS3Engine,
        KafkaEngine,
    )

    # Try S3Queue first
    if isinstance(engine, S3QueueEngine):
        return S3QueueConfigDict(
            s3_path=engine.s3_path,
            format=engine.format,
            aws_access_key_id=engine.aws_access_key_id,
            aws_secret_access_key=engine.aws_secret_access_key,
            compression=engine.compression,
            headers=engine.headers,
        )

    # Try S3
    if isinstance(engine, S3Engine):
        return S3ConfigDict(
            path=engine.path,
            format=engine.format,
            aws_access_key_id=engine.aws_access_key_id,
            aws_secret_access_key=engine.aws_secret_access_key,
            compression=engine.compression,
            partition_strategy=engine.partition_strategy,
            partition_columns_in_data_file=engine.partition_columns_in_data_file,
        )

    # Try Buffer
    if isinstance(engine, BufferEngine):
        return BufferConfigDict(
            target_database=engine.target_database,
            target_table=engine.target_table,
            num_layers=engine.num_layers,
            min_time=engine.min_time,
            max_time=engine.max_time,
            min_rows=engine.min_rows,
            max_rows=engine.max_rows,
            min_bytes=engine.min_bytes,
            max_bytes=engine.max_bytes,
            flush_time=engine.flush_time,
            flush_rows=engine.flush_rows,
            flush_bytes=engine.flush_bytes,
        )

    # Try Distributed
    if isinstance(engine, DistributedEngine):
        return DistributedConfigDict(
            cluster=engine.cluster,
            target_database=engine.target_database,
            target_table=engine.target_table,
            sharding_key=engine.sharding_key,
            policy_name=engine.policy_name,
        )

    # Try IcebergS3
    if isinstance(engine, IcebergS3Engine):
        return IcebergS3ConfigDict(
            path=engine.path,
            format=engine.format,
            aws_access_key_id=engine.aws_access_key_id,
            aws_secret_access_key=engine.aws_secret_access_key,
            compression=engine.compression,
        )

    # Try Kafka
    if isinstance(engine, KafkaEngine):
        return KafkaConfigDict(
            broker_list=engine.broker_list,
            topic_list=engine.topic_list,
            group_name=engine.group_name,
            format=engine.format,
        )

    # Try basic engines
    basic_config = _convert_basic_engine_instance(engine)
    if basic_config:
        return basic_config

    # Try replicated engines
    replicated_config = _convert_replicated_engine_instance(engine)
    if replicated_config:
        return replicated_config

    # Fallback for any other EngineConfig subclass
    return BaseEngineConfigDict(engine=engine.__class__.__name__.replace("Engine", ""))


def _find_source_files(directory: str, extensions: tuple = (".py",)) -> list[str]:
    """Recursively finds all Python files in a directory.

    Args:
        directory: The directory to search
        extensions: Tuple of file extensions to include

    Returns:
        List of file paths relative to the current working directory
    """
    source_files = []
    dir_path = Path(directory)

    if not dir_path.exists():
        return []

    for item in dir_path.rglob("*"):
        # Skip hidden directories and files, and __pycache__
        # Only check parts relative to the search directory, not the full absolute path
        try:
            relative_parts = item.relative_to(dir_path).parts
            if any(
                part.startswith(".") or part == "__pycache__" for part in relative_parts
            ):
                continue
        except ValueError:
            # item is not relative to dir_path, skip it
            continue

        if item.is_file() and item.suffix in extensions:
            try:
                rel_path = item.relative_to(Path.cwd())
                source_files.append(str(rel_path))
            except ValueError:
                # File is outside cwd, use absolute path
                source_files.append(str(item))

    return source_files


def _find_unloaded_files(source_dir: str) -> list[str]:
    """Checks for source files that exist but weren't loaded.

    Args:
        source_dir: The source directory to check (e.g., 'app')

    Returns:
        List of file paths that exist but weren't loaded
    """
    app_dir = Path.cwd() / source_dir

    # Find all Python source files
    all_source_files = set(_find_source_files(str(app_dir)))

    # Get all loaded modules from sys.modules
    loaded_files = set()
    for _module_name, module in sys.modules.items():
        if hasattr(module, "__file__") and module.__file__:
            try:
                module_path = Path(module.__file__).resolve()
                # Check if module is in our app directory
                try:
                    module_path = Path(module.__file__).resolve()
                    # Check if module is in our app directory
                    if module_path.is_relative_to(app_dir.resolve()):
                        rel_path = module_path.relative_to(Path.cwd())
                        loaded_files.add(str(rel_path))
                except (ValueError, OSError):
                    # Module file is outside cwd or can't be resolved
                    pass
            except (ValueError, OSError):
                # Module file is outside cwd or can't be resolved
                pass

    # Find files that exist but weren't loaded
    unloaded = sorted(all_source_files - loaded_files)

    return unloaded


def _convert_engine_to_config_dict(
    engine: Union[ClickHouseEngines, EngineConfig], table: OlapTable
) -> EngineConfigDict:
    """Convert engine enum or EngineConfig instance to new engine config format.

    Args:
        engine: Either a ClickHouseEngines enum value or an EngineConfig instance
        table: The OlapTable instance with configuration

    Returns:
        EngineConfigDict with engine-specific configuration
    """
    from moose_lib import ClickHouseEngines
    from moose_lib.blocks import EngineConfig
    from moose_lib.commons import Logger

    # Check if engine is an EngineConfig instance (new API)
    if isinstance(engine, EngineConfig):
        return _convert_engine_instance_to_config_dict(engine)

    # Handle legacy enum-based engine configuration
    if isinstance(engine, ClickHouseEngines):
        engine_name = engine.value
    else:
        engine_name = str(engine)

    # For S3Queue with legacy configuration, check for s3_queue_engine_config
    if engine_name == "S3Queue" and hasattr(table.config, "s3_queue_engine_config"):
        s3_config = table.config.s3_queue_engine_config
        if s3_config:
            logger = Logger(action="S3QueueConfig")
            logger.highlight(
                "Using deprecated s3_queue_engine_config. Please migrate to:\n"
                "  engine=S3QueueEngine(s3_path='...', format='...', ...)"
            )
            return S3QueueConfigDict(
                s3_path=s3_config.path,
                format=s3_config.format,
                aws_access_key_id=s3_config.aws_access_key_id,
                aws_secret_access_key=s3_config.aws_secret_access_key,
                compression=s3_config.compression,
                headers=s3_config.headers,
            )

    # Map engine names to specific config classes
    engine_map = {
        "MergeTree": MergeTreeConfigDict,
        "ReplacingMergeTree": ReplacingMergeTreeConfigDict,
        "AggregatingMergeTree": AggregatingMergeTreeConfigDict,
        "SummingMergeTree": SummingMergeTreeConfigDict,
        "ReplicatedMergeTree": ReplicatedMergeTreeConfigDict,
        "ReplicatedReplacingMergeTree": ReplicatedReplacingMergeTreeConfigDict,
        "ReplicatedAggregatingMergeTree": ReplicatedAggregatingMergeTreeConfigDict,
        "ReplicatedSummingMergeTree": ReplicatedSummingMergeTreeConfigDict,
    }

    config_class = engine_map.get(engine_name)
    if config_class:
        return config_class()

    # Fallback for unknown engines
    return BaseEngineConfigDict(engine=engine_name)


def to_infra_map() -> dict:
    """Converts the registered `dmv2` resources into the serializable `InfrastructureMap` format.

    Iterates through the internal registries (`_tables`, `_streams`, etc.) populated
    by the user's definitions in `app/main.py` (or elsewhere) and transforms them
    into the corresponding `*Config` Pydantic models.

    Returns:
        A dictionary representing the `InfrastructureMap`, ready for JSON serialization
        using Pydantic's `model_dump` with camelCase aliases.
    """
    tables = {}
    topics = {}
    ingest_apis = {}
    apis = {}
    sql_resources = {}
    workflows = {}
    web_apps = {}
    materialized_views = {}
    views = {}

    for _registry_key, table in get_tables().items():
        # Convert engine configuration to new format
        engine_config = None
        if table.config.engine:
            engine_config = _convert_engine_to_config_dict(table.config.engine, table)

        # Get table settings, applying defaults for S3Queue
        table_settings = table.config.settings.copy() if table.config.settings else {}

        # Apply default settings for S3Queue if not already specified
        if engine_config and engine_config.engine == "S3Queue":
            # Set default mode to 'unordered' if not specified
            if "mode" not in table_settings:
                table_settings["mode"] = "unordered"

        id_key = (
            f"{table.name}_{table.config.version}"
            if table.config.version
            else table.name
        )

        # Determine ORDER BY: list of fields or single expression
        has_fields = bool(table.config.order_by_fields)
        has_expr = table.config.order_by_expression is not None
        if has_fields and has_expr:
            raise ValueError(
                f"Table {table.name}: Provide either order_by_fields or order_by_expression, not both."
            )

        order_by_value = (
            table.config.order_by_expression
            if has_expr
            else table.config.order_by_fields
        )

        tables[id_key] = TableConfig(
            name=table.name,
            columns=table._column_list,
            order_by=order_by_value,
            partition_by=table.config.partition_by,
            sample_by_expression=table.config.sample_by_expression,
            primary_key_expression=table.config.primary_key_expression,
            engine_config=engine_config,
            version=table.config.version,
            metadata=getattr(table, "metadata", None),
            life_cycle=(
                table.config.life_cycle.value if table.config.life_cycle else None
            ),
            # Map 'settings' to 'table_settings' for internal use
            table_settings=table_settings if table_settings else None,
            indexes=table.config.indexes,
            ttl=table.config.ttl,
            database=table.config.database,
            cluster=table.config.cluster,
        )

    for name, stream in get_streams().items():
        transformation_targets = [
            Target(
                kind="stream",
                name=dest_name,
                version=transform.config.version,
                metadata=getattr(transform.config, "metadata", None),
            )
            for dest_name, transforms in stream.transformations.items()
            for transform in transforms
        ]

        consumers = [
            Consumer(version=consumer.config.version) for consumer in stream.consumers
        ]

        topics[name] = TopicConfig(
            name=name,
            columns=_to_columns(stream._t),
            target_table=(
                stream.config.destination.name if stream.config.destination else None
            ),
            target_table_version=(
                stream.config.destination.config.version
                if stream.config.destination
                else None
            ),
            retention_period=stream.config.retention_period,
            partition_count=stream.config.parallelism,
            version=stream.config.version,
            transformation_targets=transformation_targets,
            has_multi_transform=stream._multipleTransformations is not None,
            consumers=consumers,
            metadata=getattr(stream, "metadata", None),
            life_cycle=(
                stream.config.life_cycle.value if stream.config.life_cycle else None
            ),
            schema_config=stream.config.schema_config,
        )

    for name, api in get_ingest_apis().items():
        # Check if the Pydantic model allows extra fields (extra='allow')
        # This is the Python equivalent of TypeScript's index signature `[key: string]: any`
        model_allows_extra = api._t.model_config.get("extra") == "allow"

        ingest_apis[name] = IngestApiConfig(
            name=name,
            columns=_to_columns(api._t),
            version=api.config.version,
            path=api.config.path,
            write_to=Target(kind="stream", name=api.config.destination.name),
            metadata=getattr(api, "metadata", None),
            json_schema=api._t.model_json_schema(
                ref_template="#/components/schemas/{model}"
            ),
            dead_letter_queue=(
                api.config.dead_letter_queue.name
                if api.config.dead_letter_queue
                else None
            ),
            allow_extra_fields=model_allows_extra,
        )

    for name, api in get_apis().items():
        apis[name] = InternalApiConfig(
            name=api.name,
            query_params=_to_columns(api.model_type),
            response_schema=api.get_response_schema(),
            version=api.config.version,
            path=api.config.path,
            metadata=getattr(api, "metadata", None),
        )

    for name, resource in get_sql_resources().items():
        sql_resources[name] = SqlResourceConfig(
            name=resource.name,
            setup=resource.setup,
            teardown=resource.teardown,
            pulls_data_from=[
                _map_sql_resource_ref(dep) for dep in resource.pulls_data_from
            ],
            pushes_data_to=[
                _map_sql_resource_ref(dep) for dep in resource.pushes_data_to
            ],
            source_file=getattr(resource, "source_file", None),
            metadata=getattr(resource, "metadata", None),
        )

    for name, workflow in get_workflows().items():
        workflows[name] = WorkflowJson(
            name=workflow.name,
            retries=workflow.config.retries,
            timeout=workflow.config.timeout,
            schedule=workflow.config.schedule,
        )

    for name, web_app in get_web_apps().items():
        mount_path = web_app.config.mount_path or "/"
        metadata = None
        if web_app.config.metadata:
            metadata = WebAppMetadataJson(
                description=web_app.config.metadata.description
            )
        web_apps[name] = WebAppJson(
            name=web_app.name,
            mount_path=mount_path,
            metadata=metadata,
        )

    # Serialize materialized views with structured data
    for name, mv in get_materialized_views().items():
        materialized_views[name] = MaterializedViewJson(
            name=mv.name,
            select_sql=mv.select_sql,
            source_tables=mv.source_tables,
            target_table=mv.target_table.name,
            target_database=getattr(mv.target_table.config, "database", None),
            metadata=getattr(mv, "metadata", None),
        )

    # Serialize custom views with structured data
    for name, view in get_views().items():
        views[name] = ViewJson(
            name=view.name,
            select_sql=view.select_sql,
            source_tables=view.source_tables,
            metadata=getattr(view, "metadata", None),
        )

    infra_map = InfrastructureMap(
        tables=tables,
        topics=topics,
        ingest_apis=ingest_apis,
        apis=apis,
        sql_resources=sql_resources,
        workflows=workflows,
        web_apps=web_apps,
        materialized_views=materialized_views,
        views=views,
    )

    return infra_map.model_dump(by_alias=True, exclude_none=False)


def load_models() -> str:
    """Imports the user's main application module to register all Moose resources.

    This function triggers the registration of all Moose resources defined in
    the user's main module (OlapTable[...](...), Stream[...](...), etc.).

    Returns:
        The source directory name (e.g., "app") used for loading models.
    """
    source_dir = os.environ.get("MOOSE_SOURCE_DIR", "app")
    import_module(f"{source_dir}.main")
    return source_dir
