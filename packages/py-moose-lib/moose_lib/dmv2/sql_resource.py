"""
Base SQL resource definitions for Moose Data Model v2 (dmv2).

This module provides the base class for SQL resources like Views and Materialized Views,
handling common functionality like setup/teardown SQL commands and dependency tracking.
"""
from typing import Any, Optional, Union, List
from pydantic import BaseModel
import inspect

from .olap_table import OlapTable
from ._registry import _sql_resources


def _get_source_file_from_stack() -> Optional[str]:
    """Extract the source file path from the call stack, skipping internal modules."""
    try:
        # Get the current call stack
        stack = inspect.stack()
        # Start from index 1 to skip this function itself
        for frame_info in stack[1:]:
            filename = frame_info.filename
            # Skip internal modules and site-packages
            if (
                "site-packages" not in filename
                and "moose_lib" not in filename
                and "<" not in filename  # Skip special frames like <frozen importlib>
            ):
                return filename
    except Exception:
        # If anything goes wrong, just return None
        pass
    return None


class SqlResource:
    """Base class for SQL resources like Views and Materialized Views.

    Handles the definition of setup (CREATE) and teardown (DROP) SQL commands
    and tracks data dependencies.

    Attributes:
        name (str): The name of the SQL resource (e.g., view name).
        setup (list[str]): SQL commands to create the resource.
        teardown (list[str]): SQL commands to drop the resource.
        pulls_data_from (list[SqlObject]): List of tables/views this resource reads from.
        pushes_data_to (list[SqlObject]): List of tables/views this resource writes to.
        kind: The kind of the SQL resource (e.g., "SqlResource").
        source_file: Optional path to the source file where this resource was defined.
    """
    setup: list[str]
    teardown: list[str]
    name: str
    kind: str = "SqlResource"
    pulls_data_from: list[Union[OlapTable, "SqlResource"]]
    pushes_data_to: list[Union[OlapTable, "SqlResource"]]
    source_file: Optional[str]

    def __init__(
            self,
            name: str,
            setup: list[str],
            teardown: list[str],
            pulls_data_from: Optional[list[Union[OlapTable, "SqlResource"]]] = None,
            pushes_data_to: Optional[list[Union[OlapTable, "SqlResource"]]] = None,
            metadata: dict = None
    ):
        self.name = name
        self.setup = setup
        self.teardown = teardown
        self.pulls_data_from = pulls_data_from or []
        self.pushes_data_to = pushes_data_to or []
        self.metadata = metadata
        # Capture source file from call stack
        self.source_file = _get_source_file_from_stack()
        _sql_resources[name] = self