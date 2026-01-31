"""
Structured logging utilities for Python Moose applications.

Provides context-aware logging that outputs JSON to stderr with a marker for the CLI to parse.
"""

import json
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, TypeVar

T = TypeVar("T")

# Context variable to store the current logging context
_logging_context: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "_logging_context", default=None
)


class StructuredLogContext:
    """
    Context manager for structured logging with propagated context.
    """

    def __init__(
        self,
        get_context_field: Callable[[Dict[str, Any]], Any],
        context_field_name: str,
    ):
        """
        Initialize the structured logging context.

        Args:
            get_context_field: Function to extract the context field value from context dict
            context_field_name: Name of the field to include in log output
        """
        self.get_context_field = get_context_field
        self.context_field_name = context_field_name

    def run(self, context: Dict[str, Any], func: Callable[[], T]) -> T:
        """
        Run a function with the given logging context.

        Args:
            context: Dictionary containing context values
            func: Function to execute with context

        Returns:
            The return value of func
        """
        token = _logging_context.set(context)
        try:
            return func()
        finally:
            _logging_context.reset(token)

    def log(self, level: str, message: str) -> None:
        """
        Emit a structured log message to stderr.

        Args:
            level: Log level (e.g., "info", "error", "debug")
            message: Log message
        """
        context = _logging_context.get()
        log_entry: Dict[str, Any] = {
            "__moose_structured_log__": True,
            "level": level,
            "message": message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        if context is not None:
            field_value = self.get_context_field(context)
            log_entry[self.context_field_name] = field_value

        json.dump(log_entry, sys.stderr)
        sys.stderr.write("\n")
        sys.stderr.flush()


def setup_structured_logging(
    get_context_field: Callable[[Dict[str, Any]], Any],
    context_field_name: str,
) -> StructuredLogContext:
    """
    Set up structured logging with a context field.

    Args:
        get_context_field: Function to extract the context field value from context dict
        context_field_name: Name of the field to include in log output

    Returns:
        A StructuredLogContext instance for managing logging context
    """
    return StructuredLogContext(get_context_field, context_field_name)
