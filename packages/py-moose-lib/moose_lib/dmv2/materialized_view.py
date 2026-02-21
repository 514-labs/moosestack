"""
Materialized View definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining Materialized Views,
including their SQL statements, target tables, and dependencies.

Two types of materialized views are supported:
- **MaterializedView**: Incremental MV triggered on every insert to source tables
- **RefreshableMaterializedView**: Scheduled MV that runs on a refresh interval
"""

from dataclasses import dataclass, field
from typing import Any, Literal, Optional, Union, Generic, List

from pydantic import BaseModel, ConfigDict

from ..blocks import ClickHouseEngines, MergeTreeEngine
from .types import BaseTypedResource, T
from .olap_table import OlapTable, OlapConfig
from .life_cycle import LifeCycle
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
TimeUnit = Literal["second", "minute", "hour", "day", "week", "month", "year"]


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

    def __post_init__(self):
        if self.value <= 0:
            raise ValueError(
                f"Refresh interval value must be positive, got {self.value}"
            )


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

    def __post_init__(self):
        if self.value <= 0:
            raise ValueError(
                f"Refresh interval value must be positive, got {self.value}"
            )


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

    def __post_init__(self):
        if self.value <= 0:
            raise ValueError(f"Duration value must be positive, got {self.value}")


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
        ...     depends_on=[hourly_stats_mv],  # Type-safe: only accepts RefreshableMaterializedView
        ... )
    """

    interval: RefreshInterval
    """The refresh interval (EVERY or AFTER)"""
    offset: Optional[Duration] = None
    """Optional offset from interval start. NOTE: Only valid with REFRESH EVERY, not REFRESH AFTER."""
    randomize: Optional[Duration] = None
    """Optional randomization window"""
    depends_on: List["RefreshableMaterializedView"] = field(default_factory=list)
    """Other refreshable MVs this one depends on. Only accepts RefreshableMaterializedView objects."""
    append: bool = False
    """Use APPEND mode instead of full refresh"""


@dataclass
class ResolvedRefreshConfig:
    """
    Internal representation of RefreshConfig with depends_on resolved to string names.
    """

    interval: RefreshInterval
    """The refresh interval (EVERY or AFTER)"""
    offset: Optional[Duration] = None
    """Optional offset from interval start"""
    randomize: Optional[Duration] = None
    """Optional randomization window"""
    depends_on: List[str] = field(default_factory=list)
    """Names of other MVs this one depends on (resolved to strings)"""
    append: bool = False
    """Use APPEND mode instead of full refresh"""


# ============================================================================
# Incremental MaterializedView Configuration and Class
# ============================================================================


class MaterializedViewOptions(BaseModel):
    """Configuration options for creating an incremental Materialized View.

    Incremental MVs are triggered on every insert to source tables.

    Attributes:
        select_statement: The SQL SELECT statement defining the view's data.
        select_tables: List of source tables/views the select statement reads from.
        table_name: Optional name of the underlying target table storing the materialized data.
        materialized_view_name: The name of the MATERIALIZED VIEW object itself.
        engine: Optional ClickHouse engine for the target table.
        order_by_fields: Optional ordering key for the target table.
        metadata: Optional metadata dictionary.
        model_config: ConfigDict for Pydantic validation
        life_cycle: Optional lifecycle management policy. Controls how Moose handles
                    this materialized view when code definitions change. Valid values:
                    LifeCycle.FULLY_MANAGED (default) — Moose auto-creates, updates
                    (via DROP+CREATE), and drops the MV; LifeCycle.DELETION_PROTECTED —
                    Moose auto-creates but will not drop or update the MV;
                    LifeCycle.EXTERNALLY_MANAGED — Moose will not create, update, or
                    drop the MV. Defaults to FULLY_MANAGED when not specified.
    """

    select_statement: str
    select_tables: List[Union[OlapTable, "View"]]
    table_name: Optional[str] = None
    materialized_view_name: str
    engine: Optional[ClickHouseEngines] = None
    order_by_fields: Optional[List[str]] = None
    metadata: Optional[dict] = None
    life_cycle: Optional[LifeCycle] = None
    model_config = ConfigDict(arbitrary_types_allowed=True)


class MaterializedView(BaseTypedResource, Generic[T]):
    """Represents an incremental Materialized View in ClickHouse.

    Incremental MVs are triggered on every insert to source tables.
    For scheduled/refreshable MVs, use `RefreshableMaterializedView` instead.

    Args:
        options: Configuration defining the select statement, names, and dependencies.
        target_table: Optional existing OlapTable to use as the target.
        t: The Pydantic model defining the schema of the target table.

    Attributes:
        target_table (OlapTable[T]): The `OlapTable` instance storing the materialized data.
        config (MaterializedViewOptions): The configuration options used to create the view.
        name (str): The name of the MATERIALIZED VIEW object.
        select_sql (str): The SELECT SQL statement.
        source_tables (list[str]): Names of source tables the SELECT reads from.
        life_cycle (LifeCycle | None): Lifecycle management policy. Controls how Moose
            handles this MV when code definitions change. Defaults to FULLY_MANAGED when
            not specified. See LifeCycle enum for available values.
    """

    kind: str = "MaterializedView"
    target_table: OlapTable[T]
    config: MaterializedViewOptions
    name: str
    select_sql: str
    source_tables: List[str]
    metadata: Optional[dict] = None
    refresh_config: None = None  # Always None for incremental MVs
    life_cycle: Optional[LifeCycle] = None

    def __init__(
        self,
        options: MaterializedViewOptions,
        target_table: Optional[OlapTable[T]] = None,
        **kwargs: Any,
    ):
        self._set_type(options.materialized_view_name, self._get_type(kwargs))

        # Resolve target table
        if target_table:
            self.target_table = target_table
            if self._t != target_table._t:
                raise ValueError(
                    "Target table must have the same type as the materialized view"
                )
        else:
            if not options.table_name:
                raise ValueError(
                    "Name of target table is not specified. "
                    "Provide 'target_table' parameter or 'table_name' in options."
                )
            target_table = OlapTable(
                name=options.table_name,
                config=OlapConfig(
                    order_by_fields=options.order_by_fields or [],
                    engine=options.engine,
                ),
                t=self._t,
            )
            self.target_table = target_table

        if target_table.name == options.materialized_view_name:
            raise ValueError(
                "Target table name cannot be the same as the materialized view name"
            )

        self.name = options.materialized_view_name
        self.config = options
        self.select_sql = options.select_statement
        self.source_tables = [_format_table_reference(t) for t in options.select_tables]
        self.refresh_config = None
        self.life_cycle = options.life_cycle

        # Initialize metadata
        if options.metadata:
            self.metadata = (
                options.metadata.copy()
                if isinstance(options.metadata, dict)
                else options.metadata
            )
        else:
            self.metadata = {}

        # Capture source file from stack trace
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
        """Returns True - incremental MVs are always incremental."""
        return True

    def is_refreshable(self) -> bool:
        """Returns False - incremental MVs are never refreshable."""
        return False


# ============================================================================
# Refreshable MaterializedView Configuration and Class
# ============================================================================


class RefreshableMaterializedViewOptions(BaseModel):
    """Configuration options for creating a Refreshable Materialized View.

    Refreshable MVs run on a schedule (REFRESH EVERY/AFTER) rather than
    being triggered by inserts to source tables.

    Note: Refreshable MVs always use MergeTree engine (no custom engine option).

    Attributes:
        select_statement: The SQL SELECT statement defining the view's data.
        select_tables: List of source tables/views the select statement reads from.
        materialized_view_name: The name of the MATERIALIZED VIEW object itself.
        target_table_name: Name of the underlying target table.
        order_by_fields: Optional ordering key for the target table.
        refresh_config: Configuration for the refresh schedule. Required.
        metadata: Optional metadata dictionary.
    """

    select_statement: str
    select_tables: List[Union[OlapTable, "View"]]
    materialized_view_name: str
    target_table_name: str
    order_by_fields: Optional[List[str]] = None
    refresh_config: RefreshConfig
    metadata: Optional[dict] = None
    model_config = ConfigDict(arbitrary_types_allowed=True)


class RefreshableMaterializedView(BaseTypedResource, Generic[T]):
    """Represents a Refreshable Materialized View in ClickHouse.

    Refreshable MVs run on a schedule (REFRESH EVERY/AFTER) rather than
    being triggered by inserts to source tables.

    For incremental/trigger-based MVs, use `MaterializedView` instead.

    Args:
        options: Configuration defining the select statement, names, and dependencies.
        t: The Pydantic model defining the schema of the target table.

    Attributes:
        target_table (OlapTable[T]): The `OlapTable` instance storing the materialized data.
        config (RefreshableMaterializedViewOptions): The configuration options.
        name (str): The name of the MATERIALIZED VIEW object.
        select_sql (str): The SELECT SQL statement.
        source_tables (list[str]): Names of source tables the SELECT reads from.
        refresh_config (ResolvedRefreshConfig): The refresh configuration with resolved dependencies.
    """

    kind: str = "MaterializedView"
    target_table: OlapTable[T]
    config: RefreshableMaterializedViewOptions
    name: str
    select_sql: str
    source_tables: List[str]
    metadata: Optional[dict] = None
    refresh_config: ResolvedRefreshConfig  # Always set for refreshable MVs

    def __init__(
        self,
        options: RefreshableMaterializedViewOptions,
        **kwargs: Any,
    ):
        self._set_type(options.materialized_view_name, self._get_type(kwargs))

        # Create target table (always MergeTree for refreshable MVs)
        target_table = OlapTable(
            name=options.target_table_name,
            config=OlapConfig(
                order_by_fields=options.order_by_fields or [],
                engine=MergeTreeEngine(),
            ),
            t=self._t,
        )
        self.target_table = target_table

        if target_table.name == options.materialized_view_name:
            raise ValueError(
                "Target table name cannot be the same as the materialized view name"
            )

        # Validate OFFSET is not used with REFRESH AFTER (only valid with REFRESH EVERY)
        if (
            options.refresh_config.interval.type == "after"
            and options.refresh_config.offset is not None
        ):
            raise ValueError(
                "OFFSET is only valid with REFRESH EVERY, not REFRESH AFTER. "
                "Remove the 'offset' option or change the interval type to 'every'."
            )

        self.name = options.materialized_view_name
        self.config = options
        self.select_sql = options.select_statement
        self.source_tables = [_format_table_reference(t) for t in options.select_tables]

        # Convert refresh_config.depends_on from RefreshableMaterializedView objects to string names
        dep_names = [dep.name for dep in options.refresh_config.depends_on]
        if options.materialized_view_name in dep_names:
            raise ValueError(
                f"RefreshableMaterializedView '{options.materialized_view_name}' "
                "cannot depend on itself"
            )
        self.refresh_config = ResolvedRefreshConfig(
            interval=options.refresh_config.interval,
            offset=options.refresh_config.offset,
            randomize=options.refresh_config.randomize,
            depends_on=dep_names,
            append=options.refresh_config.append,
        )

        # Initialize metadata
        if options.metadata:
            self.metadata = (
                options.metadata.copy()
                if isinstance(options.metadata, dict)
                else options.metadata
            )
        else:
            self.metadata = {}

        # Capture source file from stack trace
        if not isinstance(self.metadata, dict):
            self.metadata = {}
        if "source" not in self.metadata:
            source_file = get_source_file_from_stack()
            if source_file:
                self.metadata["source"] = {"file": source_file}

        if self.name in _materialized_views:
            raise ValueError(
                f"RefreshableMaterializedView with name {self.name} already exists"
            )
        _materialized_views[self.name] = self

    def is_incremental(self) -> bool:
        """Returns False - refreshable MVs are never incremental."""
        return False

    def is_refreshable(self) -> bool:
        """Returns True - refreshable MVs are always refreshable."""
        return True

    def get_refresh_config(self) -> ResolvedRefreshConfig:
        """Returns the refresh configuration."""
        return self.refresh_config
