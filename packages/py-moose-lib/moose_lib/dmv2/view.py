"""
View definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining standard SQL Views,
including their SQL statements and dependencies.
"""

from typing import Union, List, Optional
from pydantic import BaseModel

from .sql_resource import SqlResource
from .olap_table import OlapTable


class View(SqlResource):
    """Represents a standard SQL database View.

    Args:
        name: The name of the view to be created.
        select_statement: The SQL SELECT statement defining the view.
        base_tables: A list of `OlapTable`, `View`, or `MaterializedView` objects
                     that this view depends on.
        metadata: Optional metadata for the view.

    Attributes:
        name (str): The name of the view.
        setup (list[str]): SQL command to create the view.
        teardown (list[str]): SQL command to drop the view.
        pulls_data_from (list[SqlObject]): Source tables/views.
    """

    def __init__(
        self,
        name: str,
        select_statement: str,
        base_tables: list[Union[OlapTable, SqlResource]],
        metadata: dict = None,
    ):
        setup = [f"CREATE VIEW IF NOT EXISTS {name} AS {select_statement}".strip()]
        teardown = [f"DROP VIEW IF EXISTS {name}"]
        super().__init__(
            name, setup, teardown, pulls_data_from=base_tables, metadata=metadata
        )
