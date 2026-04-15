"""
View definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining standard SQL Views,
including their SQL statements and dependencies.
"""

import warnings
from typing import Union, Optional

from pydantic import BaseModel, ConfigDict

from .olap_table import OlapTable
from ._registry import _views
from ._source_capture import get_source_file_from_stack


def _format_table_reference(table: Union[OlapTable, "View"]) -> str:
    """Helper function to format a table reference as `database`.`table` or just `table`"""
    if isinstance(table, OlapTable):
        database = table.config.database
    elif hasattr(table, "database"):
        database = table.database
    else:
        database = None
    if database:
        return f"`{database}`.`{table.name}`"
    return f"`{table.name}`"


class ViewConfig(BaseModel):
    """Configuration options for creating a View.

    Attributes:
        select_statement: The SQL SELECT statement defining the view's logic.
        base_tables: Source tables/views the SELECT reads from. Used for dependency tracking.
        database: Optional database where the view is created. When set, the view is created
                  as ``database``.``name`` in ClickHouse.
        metadata: Optional metadata for the view (e.g., description, source file).
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    select_statement: str
    base_tables: list[Union[OlapTable, "View"]]
    database: Optional[str] = None
    metadata: Optional[dict] = None


class View:
    """Represents a standard SQL database View.

    Emits structured data for the Moose infrastructure system.

    Args:
        name: The name of the view to be created.
        config: A ``ViewConfig`` object containing the select statement, base tables,
                optional database, and optional metadata.

    Attributes:
        name (str): The name of the view.
        database (Optional[str]): The database where the view is created.
        select_sql (str): The SELECT SQL statement.
        source_tables (list[str]): Names of source tables the SELECT reads from.
        source_file (Optional[str]): Path to source file where defined.
    """

    kind: str = "View"
    name: str
    database: Optional[str]
    select_sql: str
    source_tables: list[str]
    metadata: Optional[dict] = None

    def __init__(
        self,
        name: str,
        config_or_select: Union["ViewConfig", str],
        base_tables: Optional[list[Union[OlapTable, "View"]]] = None,
        database: Optional[str] = None,
        metadata: Optional[dict] = None,
    ):
        if isinstance(config_or_select, ViewConfig):
            config = config_or_select
        elif isinstance(config_or_select, str):
            warnings.warn(
                "Passing positional arguments to View() is deprecated. "
                "Use View(name, ViewConfig(select_statement=..., base_tables=...)) instead.",
                DeprecationWarning,
                stacklevel=2,
            )
            config = ViewConfig(
                select_statement=config_or_select,
                base_tables=base_tables or [],
                database=database,
                metadata=metadata,
            )
        else:
            raise TypeError(
                f"Expected ViewConfig or str for second argument, got {type(config_or_select).__name__}"
            )

        self.name = name
        self.database = config.database
        self.select_sql = config.select_statement
        self.source_tables = [_format_table_reference(t) for t in config.base_tables]

        # Initialize metadata, preserving user-provided metadata if any
        if config.metadata:
            self.metadata = (
                config.metadata.copy()
                if isinstance(config.metadata, dict)
                else config.metadata
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

        # Database-aware registry key to allow same view name in different databases.
        # Uses '::' separator (collision-free: underscores are valid in ClickHouse names).
        registry_key = f"{self.database}::{self.name}" if self.database else self.name
        if registry_key in _views:
            qualified = f"{self.database}.{self.name}" if self.database else self.name
            raise ValueError(f"View with name {qualified} already exists")
        _views[registry_key] = self
