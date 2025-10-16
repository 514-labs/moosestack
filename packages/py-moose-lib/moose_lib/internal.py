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
    OlapTable,
    View,
    MaterializedView,
    SqlResource
)
from moose_lib.dmv2.stream import KafkaSchemaConfig
from pydantic.alias_generators import to_camel
from pydantic.json_schema import JsonSchemaValue

model_config = ConfigDict(alias_generator=AliasGenerator(
    serialization_alias=to_camel,
))


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


class S3QueueConfigDict(BaseEngineConfigDict):
    """Configuration for S3Queue engine with all specific fields."""
    engine: Literal["S3Queue"] = "S3Queue"
    s3_path: str
    format: str
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    compression: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


# Discriminated union of all engine configurations
EngineConfigDict = Union[
    MergeTreeConfigDict,
    ReplacingMergeTreeConfigDict,
    AggregatingMergeTreeConfigDict,
    SummingMergeTreeConfigDict,
    ReplicatedMergeTreeConfigDict,
    ReplicatedReplacingMergeTreeConfigDict,
    ReplicatedAggregatingMergeTreeConfigDict,
    ReplicatedSummingMergeTreeConfigDict,
    S3QueueConfigDict
]


class TableConfig(BaseModel):
    """Internal representation of an OLAP table configuration for serialization.

    Attributes:
        name: Name of the table.
        columns: List of columns with their types and attributes.
        order_by: List of columns used for the ORDER BY clause.
        partition_by: The column name used for the PARTITION BY clause.
        engine_config: Engine configuration with type-safe, engine-specific parameters.
        version: Optional version string of the table configuration.
        metadata: Optional metadata for the table.
        life_cycle: Lifecycle management setting for the table.
        table_settings: Optional table-level settings that can be modified with ALTER TABLE MODIFY SETTING.
    """
    model_config = model_config

    name: str
    columns: List[Column]
    order_by: List[str] | str
    partition_by: Optional[str]
    engine_config: Optional[EngineConfigDict] = Field(None, discriminator='engine')
    version: Optional[str] = None
    metadata: Optional[dict] = None
    life_cycle: Optional[str] = None
    table_settings: Optional[Dict[str, str]] = None


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
    kind: Literal["Table", "Topic", "ApiEndpoint", "TopicToTableSyncProcess", "View", "SqlResource"]


class SqlResourceConfig(BaseModel):
    """Internal representation of a generic SQL resource (like View, MaterializedView) for serialization.

    Attributes:
        name: Name of the SQL resource.
        setup: List of SQL commands required to create the resource.
        teardown: List of SQL commands required to drop the resource.
        pulls_data_from: List of infrastructure components this resource reads from.
        pushes_data_to: List of infrastructure components this resource writes to.
        metadata: Optional metadata for the resource.
    """
    model_config = model_config

    name: str
    setup: list[str]
    teardown: list[str]
    pulls_data_from: list[InfrastructureSignatureJson]
    pushes_data_to: list[InfrastructureSignatureJson]
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
    """
    model_config = model_config

    tables: dict[str, TableConfig]
    topics: dict[str, TopicConfig]
    ingest_apis: dict[str, IngestApiConfig]
    apis: dict[str, InternalApiConfig]
    sql_resources: dict[str, SqlResourceConfig]
    workflows: dict[str, WorkflowJson]
    web_apps: dict[str, WebAppJson]


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
    if hasattr(r, 'kind'):
        if r.kind == "OlapTable":
            # Explicitly cast for type hint checking if needed, though Python is dynamic
            table = r  # type: OlapTable
            res_id = f"{table.name}_{table.config.version}" if table.config.version else table.name
            return InfrastructureSignatureJson(id=res_id, kind="Table")
        elif r.kind == "SqlResource":
            # Explicitly cast for type hint checking if needed
            resource = r  # type: SqlResource
            return InfrastructureSignatureJson(id=resource.name, kind="SqlResource")
        else:
            raise TypeError(f"Unknown SQL resource kind: {r.kind} for object: {r}")
    else:
        # Fallback or error if 'kind' attribute is missing
        raise TypeError(f"Object {r} lacks a 'kind' attribute for dependency mapping.")


def _convert_basic_engine_instance(engine: "EngineConfig") -> Optional[EngineConfigDict]:
    """Convert basic MergeTree engine instances to config dict.
    
    Args:
        engine: An EngineConfig instance
        
    Returns:
        EngineConfigDict if matched, None otherwise
    """
    from moose_lib.blocks import (
        MergeTreeEngine, ReplacingMergeTreeEngine,
        AggregatingMergeTreeEngine, SummingMergeTreeEngine
    )

    if isinstance(engine, MergeTreeEngine):
        return MergeTreeConfigDict()
    elif isinstance(engine, ReplacingMergeTreeEngine):
        return ReplacingMergeTreeConfigDict(
            ver=engine.ver,
            is_deleted=engine.is_deleted
        )
    elif isinstance(engine, AggregatingMergeTreeEngine):
        return AggregatingMergeTreeConfigDict()
    elif isinstance(engine, SummingMergeTreeEngine):
        return SummingMergeTreeConfigDict(columns=engine.columns)
    return None


def _convert_replicated_engine_instance(engine: "EngineConfig") -> Optional[EngineConfigDict]:
    """Convert replicated MergeTree engine instances to config dict.
    
    Args:
        engine: An EngineConfig instance
        
    Returns:
        EngineConfigDict if matched, None otherwise
    """
    from moose_lib.blocks import (
        ReplicatedMergeTreeEngine, ReplicatedReplacingMergeTreeEngine,
        ReplicatedAggregatingMergeTreeEngine, ReplicatedSummingMergeTreeEngine
    )

    if isinstance(engine, ReplicatedMergeTreeEngine):
        return ReplicatedMergeTreeConfigDict(
            keeper_path=engine.keeper_path,
            replica_name=engine.replica_name
        )
    elif isinstance(engine, ReplicatedReplacingMergeTreeEngine):
        return ReplicatedReplacingMergeTreeConfigDict(
            keeper_path=engine.keeper_path,
            replica_name=engine.replica_name,
            ver=engine.ver,
            is_deleted=engine.is_deleted
        )
    elif isinstance(engine, ReplicatedAggregatingMergeTreeEngine):
        return ReplicatedAggregatingMergeTreeConfigDict(
            keeper_path=engine.keeper_path,
            replica_name=engine.replica_name
        )
    elif isinstance(engine, ReplicatedSummingMergeTreeEngine):
        return ReplicatedSummingMergeTreeConfigDict(
            keeper_path=engine.keeper_path,
            replica_name=engine.replica_name,
            columns=engine.columns
        )
    return None


def _convert_engine_instance_to_config_dict(engine: "EngineConfig") -> EngineConfigDict:
    """Convert an EngineConfig instance to config dict format.
    
    Args:
        engine: An EngineConfig instance
        
    Returns:
        EngineConfigDict with engine-specific configuration
    """
    from moose_lib.blocks import S3QueueEngine

    # Try S3Queue first
    if isinstance(engine, S3QueueEngine):
        return S3QueueConfigDict(
            s3_path=engine.s3_path,
            format=engine.format,
            aws_access_key_id=engine.aws_access_key_id,
            aws_secret_access_key=engine.aws_secret_access_key,
            compression=engine.compression,
            headers=engine.headers
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


def _convert_engine_to_config_dict(engine: Union[ClickHouseEngines, EngineConfig],
                                   table: OlapTable) -> EngineConfigDict:
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
    if engine_name == "S3Queue" and hasattr(table.config, 's3_queue_engine_config'):
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
                headers=s3_config.headers
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
            f"{table.name}_{table.config.version}" if table.config.version else table.name
        )

        # Determine ORDER BY: list of fields or single expression
        has_fields = bool(table.config.order_by_fields)
        has_expr = table.config.order_by_expression is not None
        if has_fields and has_expr:
            raise ValueError(f"Table {table.name}: Provide either order_by_fields or order_by_expression, not both.")

        order_by_value = table.config.order_by_expression if has_expr else table.config.order_by_fields

        tables[id_key] = TableConfig(
            name=table.name,
            columns=table._column_list,
            order_by=order_by_value,
            partition_by=table.config.partition_by,
            engine_config=engine_config,
            version=table.config.version,
            metadata=getattr(table, "metadata", None),
            life_cycle=table.config.life_cycle.value if table.config.life_cycle else None,
            # Map 'settings' to 'table_settings' for internal use
            table_settings=table_settings if table_settings else None,
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
            Consumer(version=consumer.config.version)
            for consumer in stream.consumers
        ]

        topics[name] = TopicConfig(
            name=name,
            columns=_to_columns(stream._t),
            target_table=stream.config.destination.name if stream.config.destination else None,
            target_table_version=stream.config.destination.config.version if stream.config.destination else None,
            retention_period=stream.config.retention_period,
            partition_count=stream.config.parallelism,
            version=stream.config.version,
            transformation_targets=transformation_targets,
            has_multi_transform=stream._multipleTransformations is not None,
            consumers=consumers,
            metadata=getattr(stream, "metadata", None),
            life_cycle=stream.config.life_cycle.value if stream.config.life_cycle else None,
            schema_config=stream.config.schema_config,
        )

    for name, api in get_ingest_apis().items():
        ingest_apis[name] = IngestApiConfig(
            name=name,
            columns=_to_columns(api._t),
            version=api.config.version,
            path=api.config.path,
            write_to=Target(
                kind="stream",
                name=api.config.destination.name
            ),
            metadata=getattr(api, "metadata", None),
            json_schema=api._t.model_json_schema(
                ref_template='#/components/schemas/{model}'
            ),
            dead_letter_queue=api.config.dead_letter_queue.name if api.config.dead_letter_queue else None
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
            pulls_data_from=[_map_sql_resource_ref(dep) for dep in resource.pulls_data_from],
            pushes_data_to=[_map_sql_resource_ref(dep) for dep in resource.pushes_data_to],
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

    infra_map = InfrastructureMap(
        tables=tables,
        topics=topics,
        ingest_apis=ingest_apis,
        apis=apis,
        sql_resources=sql_resources,
        workflows=workflows,
        web_apps=web_apps
    )

    return infra_map.model_dump(by_alias=True)


def load_models():
    """Imports the user's main application module and prints the infrastructure map.

    This function is typically the entry point for the Moose infrastructure system
    when processing Python-defined resources.

    1. Imports `app.main`, which should trigger the registration of all Moose
       resources defined therein (OlapTable[...](...), Stream[...](...), etc.).
    2. Calls `to_infra_map()` to generate the infrastructure configuration dictionary.
    3. Prints the dictionary as a JSON string, wrapped in specific delimiters
       (`___MOOSE_STUFF___start` and `end___MOOSE_STUFF___`), which the
       calling system uses to extract the configuration.
    """
    import_module("app.main")

    # Generate the infrastructure map
    infra_map = to_infra_map()

    # Print in the format expected by the infrastructure system
    print("___MOOSE_STUFF___start", json.dumps(infra_map), "end___MOOSE_STUFF___")
