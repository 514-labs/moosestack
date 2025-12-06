"""
View definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining standard SQL Views,
including their SQL statements and dependencies.
"""
from typing import Union, List, Optional

from .sql_resource import SqlResource
from .olap_table import OlapTable
from ._registry import _custom_views


class View:
    """Represents a standard SQL database View.

    Emits structured data for the Moose infrastructure system.

    Args:
        name: The name of the view to be created.
        select_statement: The SQL SELECT statement defining the view.
        base_tables: A list of `OlapTable`, `View`, or `MaterializedView` objects
                     that this view depends on.
        metadata: Optional metadata for the view.

    Attributes:
        name (str): The name of the view.
        select_sql (str): The SELECT SQL statement.
        source_tables (List[str]): Names of source tables the SELECT reads from.
        source_file (Optional[str]): Path to source file where defined.
    """
    kind: str = "CustomView"
    name: str
    select_sql: str
    source_tables: List[str]
    source_file: Optional[str] = None
    metadata: Optional[dict] = None

    def __init__(
        self,
        name: str,
        select_statement: str,
        base_tables: list[Union[OlapTable, SqlResource, "View"]],
        metadata: dict = None
    ):
        self.name = name
        self.select_sql = select_statement
        self.source_tables = [t.name for t in base_tables]
        self.metadata = metadata

        # Try to capture source file
        import traceback
        try:
            for frame in traceback.extract_stack():
                if '/app/' in frame.filename or '\\app\\' in frame.filename:
                    self.source_file = frame.filename
                    break
        except Exception:
            pass

        # Register in the custom_views registry
        if self.name in _custom_views:
            raise ValueError(f"View with name {self.name} already exists")
        _custom_views[self.name] = self
