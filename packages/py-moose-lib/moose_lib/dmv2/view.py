"""
View definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining standard SQL Views,
including their SQL statements and dependencies.
"""

from typing import Union, Optional

from .olap_table import OlapTable
from ._registry import _views
from ._source_capture import get_source_file_from_stack


def _format_table_reference(table: Union[OlapTable, "View"]) -> str:
    """Helper function to format a table reference as `database`.`table` or just `table`"""
    database = table.config.database if isinstance(table, OlapTable) else None
    if database:
        return f"`{database}`.`{table.name}`"
    return f"`{table.name}`"


class View:
    """Represents a standard SQL database View.

    Emits structured data for the Moose infrastructure system.

    Args:
        name: The name of the view to be created.
        select_statement: The SQL SELECT statement defining the view.
        base_tables: A list of objects with a `name` attribute (OlapTable, View)
                     that this view depends on. Used for dependency tracking.
        metadata: Optional metadata for the view.

    Attributes:
        name (str): The name of the view.
        select_sql (str): The SELECT SQL statement.
        source_tables (list[str]): Names of source tables the SELECT reads from.
        source_file (Optional[str]): Path to source file where defined.
    """

    kind: str = "View"
    name: str
    select_sql: str
    source_tables: list[str]
    metadata: Optional[dict] = None

    def __init__(
        self,
        name: str,
        select_statement: str,
        base_tables: list[Union[OlapTable, "View"]],
        metadata: Optional[dict] = None,
    ):
        self.name = name
        self.select_sql = select_statement
        self.source_tables = [_format_table_reference(t) for t in base_tables]

        # Initialize metadata, preserving user-provided metadata if any
        if metadata:
            self.metadata = metadata.copy() if isinstance(metadata, dict) else metadata
        else:
            self.metadata = {}

        # Capture source file from stack trace if not already provided
        if not isinstance(self.metadata, dict):
            self.metadata = {}
        if "source" not in self.metadata:
            source_file = get_source_file_from_stack()
            if source_file:
                self.metadata["source"] = {"file": source_file}

        if self.name in _views:
            raise ValueError(f"View with name {self.name} already exists")
        _views[self.name] = self
