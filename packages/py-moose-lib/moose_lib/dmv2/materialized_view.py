"""
Materialized View definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining Materialized Views,
including their SQL statements, target tables, and dependencies.

Two types of materialized views are supported:
- **Incremental**: Triggered on every insert to source tables (when refresh_config is NOT set)
- **Refreshable**: Runs on a schedule (when refresh_config IS set)
"""

from dataclasses import dataclass, field
from typing import Any, Literal, Optional, Union, Generic, List

from pydantic import BaseModel, ConfigDict

from ..blocks import ClickHouseEngines
from .types import BaseTypedResource, T
from .olap_table import OlapTable, OlapConfig
from ._registry import _materialized_views
from ._source_capture import get_source_file_from_stack
from .view import View


def _format_table_reference(table: Union[OlapTable, View]) -> str:
    """Helper function to format a table reference as `database`.`table` or just `table`"""
    database = table.config.database if isinstance(table, OlapTable) else None
    if database:
        return f"`{database}`.`{table.name}`"
    return f"`{table.name}`"


# ============================================================================
# Refresh Configuration Types for Refreshable Materialized Views
# ============================================================================

# Supported time units for refresh intervals
TimeUnit = Literal["second", "minute", "hour", "day", "week"]


@dataclass
class RefreshIntervalEvery:
    """
    Refresh interval using EVERY mode - periodic refresh at fixed times.
    Example: RefreshIntervalEvery(1, "hour") => REFRESH EVERY 1 HOUR
    """

    value: int
    """The numeric value of the interval"""
    unit: TimeUnit
    """The time unit for the interval"""
    type: Literal["every"] = "every"


@dataclass
class RefreshIntervalAfter:
    """
    Refresh interval using AFTER mode - refresh after interval since last refresh.
    Example: RefreshIntervalAfter(30, "minute") => REFRESH AFTER 30 MINUTE
    """

    value: int
    """The numeric value of the interval"""
    unit: TimeUnit
    """The time unit for the interval"""
    type: Literal["after"] = "after"


RefreshInterval = Union[RefreshIntervalEvery, RefreshIntervalAfter]


@dataclass
class Duration:
    """
    A duration specified as value + unit.
    Used for offset and randomize configurations.
    """

    value: int
    """The numeric value"""
    unit: TimeUnit
    """The time unit"""


@dataclass
class RefreshConfig:
    """
    Configuration for refreshable (scheduled) materialized views.

    Refreshable MVs run on a schedule (REFRESH EVERY/AFTER) rather than
    being triggered by inserts to source tables.

    Example:
        >>> config = RefreshConfig(
        ...     interval=RefreshIntervalEvery(1, "hour"),
        ...     offset=Duration(5, "minute"),
        ... )
    """

    interval: RefreshInterval
    """The refresh interval (EVERY or AFTER)"""
    offset: Optional[Duration] = None
    """Optional offset from interval start"""
    randomize: Optional[Duration] = None
    """Optional randomization window"""
    depends_on: List[str] = field(default_factory=list)
    """Names of other MVs this one depends on"""
    append: bool = False
    """Use APPEND mode instead of full refresh"""


# ============================================================================
# MaterializedView Options and Class
# ============================================================================


class MaterializedViewOptions(BaseModel):
    """Configuration options for creating a Materialized View.

    Two types of materialized views are supported:
    - **Incremental**: Triggered on every insert to source tables (when refresh_config is NOT set)
    - **Refreshable**: Runs on a schedule (when refresh_config IS set)

    Attributes:
        select_statement: The SQL SELECT statement defining the view's data.
        select_tables: List of source tables/views the select statement reads from.
                       Can be OlapTable, View, or any object with a `name` attribute.
        table_name: Optional name of the underlying target table storing the materialized data.
                    Not needed if passing target_table directly to MaterializedView constructor.
        materialized_view_name: The name of the MATERIALIZED VIEW object itself.
        engine: Optional ClickHouse engine for the target table (used when creating
                a target table via table_name). Note: refreshable MVs only support MergeTree.
        order_by_fields: Optional ordering key for the target table (required for
                         engines like ReplacingMergeTree).
        refresh_config: Configuration for refreshable MVs. If set, creates a refreshable MV.
                        If not set, creates an incremental MV.
        metadata: Optional metadata dictionary.
    """

    select_statement: str
    select_tables: List[Union[OlapTable, "View"]]
    # For inline table creation (when not passing target_table to constructor)
    table_name: Optional[str] = None
    materialized_view_name: str
    engine: Optional[ClickHouseEngines] = None
    order_by_fields: Optional[List[str]] = None
    # Refresh configuration for refreshable MVs
    refresh_config: Optional[RefreshConfig] = None
    metadata: Optional[dict] = None
    # Ensure arbitrary types are allowed for Pydantic validation
    model_config = ConfigDict(arbitrary_types_allowed=True)


class MaterializedView(BaseTypedResource, Generic[T]):
    """Represents a ClickHouse Materialized View.

    Two types are supported:
    - **Incremental**: Triggered on inserts to source tables (refresh_config not set)
    - **Refreshable**: Runs on a schedule (refresh_config is set)

    Args:
        options: Configuration defining the select statement, names, and dependencies.
        target_table: Optional existing OlapTable to use as the target. If not provided,
                      a new table will be created using options.table_name.
        t: The Pydantic model defining the schema of the target table
           (passed via `MaterializedView[MyModel](...)`).

    Attributes:
        target_table (OlapTable[T]): The `OlapTable` instance storing the materialized data.
        config (MaterializedViewOptions): The configuration options used to create the view.
        name (str): The name of the MATERIALIZED VIEW object.
        model_type (type[T]): The Pydantic model associated with the target table.
        select_sql (str): The SELECT SQL statement.
        source_tables (list[str]): Names of source tables the SELECT reads from.
        refresh_config (Optional[RefreshConfig]): The refresh configuration if refreshable.
    """

    kind: str = "MaterializedView"
    target_table: OlapTable[T]
    config: MaterializedViewOptions
    name: str
    select_sql: str
    source_tables: List[str]
    metadata: Optional[dict] = None
    refresh_config: Optional[RefreshConfig] = None

    def __init__(
        self,
        options: MaterializedViewOptions,
        target_table: Optional[OlapTable[T]] = None,
        **kwargs: Any,
    ):
        self._set_type(options.materialized_view_name, self._get_type(kwargs))

        # Determine if this is a refreshable MV
        is_refreshable = options.refresh_config is not None

        # Resolve target table
        if target_table:
            # Using existing OlapTable passed as parameter
            self.target_table = target_table
            if self._t != target_table._t:
                raise ValueError(
                    "Target table must have the same type as the materialized view"
                )
            target_engine = getattr(target_table.config, "engine", None)
        else:
            # Create table from options.table_name
            if not options.table_name:
                raise ValueError(
                    "Name of target table is not specified. "
                    "Provide 'target_table' parameter or 'table_name' in options."
                )
            target_engine = options.engine
            target_table = OlapTable(
                name=options.table_name,
                config=OlapConfig(
                    order_by_fields=options.order_by_fields or [],
                    engine=options.engine,
                ),
                t=self._t,
            )
            self.target_table = target_table

        # Validate: refreshable MVs cannot use custom engines
        if (
            is_refreshable
            and target_engine is not None
            and target_engine != ClickHouseEngines.MergeTree
        ):
            raise ValueError(
                f"Refreshable materialized views cannot use custom engines. "
                f"Found engine '{target_engine}' but refreshable MVs only support MergeTree. "
                f"Remove the 'engine' option or remove 'refresh_config' to create an incremental MV."
            )

        if target_table.name == options.materialized_view_name:
            raise ValueError(
                "Target table name cannot be the same as the materialized view name"
            )

        self.name = options.materialized_view_name
        self.config = options
        self.select_sql = options.select_statement
        self.refresh_config = options.refresh_config
        self.source_tables = [_format_table_reference(t) for t in options.select_tables]

        # Initialize metadata, preserving user-provided metadata if any
        if options.metadata:
            self.metadata = (
                options.metadata.copy()
                if isinstance(options.metadata, dict)
                else options.metadata
            )
        else:
            self.metadata = {}

        # Capture source file from stack trace if not already provided
        if not isinstance(self.metadata, dict):
            self.metadata = {}
        if "source" not in self.metadata:
            source_file = get_source_file_from_stack()
            if source_file:
                self.metadata["source"] = {"file": source_file}

        if self.name in _materialized_views:
            raise ValueError(f"MaterializedView with name {self.name} already exists")
        _materialized_views[self.name] = self

    def is_incremental(self) -> bool:
        """Returns True if this is an incremental (trigger-based) materialized view."""
        return self.refresh_config is None

    def is_refreshable(self) -> bool:
        """Returns True if this is a refreshable (scheduled) materialized view."""
        return self.refresh_config is not None

    def get_refresh_config(self) -> Optional[RefreshConfig]:
        """Returns the refresh configuration if this is a refreshable MV."""
        return self.refresh_config
