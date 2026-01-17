"""
Materialized View definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining Materialized Views,
including their SQL statements, target tables, and dependencies.
"""

from typing import Any, Optional, Union, Generic
from pydantic import BaseModel, ConfigDict, model_validator

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


class MaterializedViewOptions(BaseModel):
    """Configuration options for creating a Materialized View.

    Attributes:
        select_statement: The SQL SELECT statement defining the view's data.
        select_tables: List of source tables/views the select statement reads from.
                       Can be OlapTable, View, or any object with a `name` attribute.
        table_name: (Deprecated in favor of target_table) Optional name of the underlying
                    target table storing the materialized data.
        materialized_view_name: The name of the MATERIALIZED VIEW object itself.
        engine: Optional ClickHouse engine for the target table (used when creating
                a target table via table_name or inline config).
        order_by_fields: Optional ordering key for the target table (required for
                         engines like ReplacingMergeTree).
        model_config: ConfigDict for Pydantic validation
    """

    select_statement: str
    select_tables: list[Union[OlapTable, "View"]]
    # Backward-compatibility: allow specifying just the table_name and engine
    table_name: Optional[str] = None
    materialized_view_name: str
    engine: Optional[ClickHouseEngines] = None
    order_by_fields: Optional[list[str]] = None
    metadata: Optional[dict] = None
    # Ensure arbitrary types are allowed for Pydantic validation
    model_config = ConfigDict(arbitrary_types_allowed=True)


class MaterializedView(BaseTypedResource, Generic[T]):
    """Represents a ClickHouse Materialized View.

    Encapsulates the MATERIALIZED VIEW definition and the underlying target `OlapTable`
    that stores the data. Emits structured data for the Moose infrastructure system.

    Args:
        options: Configuration defining the select statement, names, and dependencies.
        t: The Pydantic model defining the schema of the target table
           (passed via `MaterializedView[MyModel](...)`).

    Attributes:
        target_table (OlapTable[T]): The `OlapTable` instance storing the materialized data.
        config (MaterializedViewOptions): The configuration options used to create the view.
        name (str): The name of the MATERIALIZED VIEW object.
        model_type (type[T]): The Pydantic model associated with the target table.
        select_sql (str): The SELECT SQL statement.
        source_tables (list[str]): Names of source tables the SELECT reads from.
    """

    kind: str = "MaterializedView"
    target_table: OlapTable[T]
    config: MaterializedViewOptions
    name: str
    select_sql: str
    source_tables: list[str]
    metadata: Optional[dict] = None

    def __init__(
        self,
        options: MaterializedViewOptions,
        target_table: Optional[OlapTable[T]] = None,
        **kwargs,
    ):
        self._set_type(options.materialized_view_name, self._get_type(kwargs))

        # Resolve target table from options
        if target_table:
            self.target_table = target_table
            if self._t != target_table._t:
                raise ValueError(
                    "Target table must have the same type as the materialized view"
                )
        else:
            # Backward-compatibility path using table_name/engine/order_by_fields
            if not options.table_name:
                raise ValueError(
                    "Name of target table is not specified. Provide 'target_table' or 'table_name'."
                )
            target_table = OlapTable(
                name=options.table_name,
                config=OlapConfig(
                    order_by_fields=options.order_by_fields or [], engine=options.engine
                ),
                t=self._t,
            )

        if target_table.name == options.materialized_view_name:
            raise ValueError(
                "Target table name cannot be the same as the materialized view name"
            )

        self.name = options.materialized_view_name
        self.target_table = target_table
        self.config = options
        self.select_sql = options.select_statement
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
