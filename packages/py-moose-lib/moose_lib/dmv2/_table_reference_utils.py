"""
Shared utility for formatting table/view references.

This module provides a single implementation of table reference formatting
to avoid duplication between view.py and materialized_view.py.
"""

from typing import Union, TYPE_CHECKING

if TYPE_CHECKING:
    from .olap_table import OlapTable
    from .view import View


def format_table_reference(table: Union["OlapTable", "View"]) -> str:
    """Helper function to format a table reference as `database`.`table` or just `table`"""
    from .olap_table import OlapTable

    if isinstance(table, OlapTable):
        database = table.config.database
    elif hasattr(table, "database"):
        database = table.database
    else:
        database = None
    if database:
        return f"`{database}`.`{table.name}`"
    return f"`{table.name}`"
