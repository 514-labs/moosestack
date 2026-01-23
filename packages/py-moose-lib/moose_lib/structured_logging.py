"""
Shared structured logging utilities for Moose Python code.

This module provides a factory function to create structured print wrappers
that emit JSON-formatted logs to stderr when running within a specific context
(e.g., a streaming function or workflow task).

The structured log format is parsed by the Rust CLI to:
1. Route logs with proper tracing spans (context, resource_type, resource_name)
2. Display errors in the CLI UI for visibility
"""

import builtins
import contextvars
import json
import sys
from datetime import datetime, timezone
from typing import Any, Callable, Optional, TextIO

# Store original print for all wrappers to use
_original_print = builtins.print


def create_structured_print_wrapper(
    context_var: contextvars.ContextVar[Optional[str]],
    context_field_name: str,
) -> Callable[..., None]:
    """
    Create a structured print wrapper for a given context variable.

    When the context variable is set (non-None), print statements are converted
    to JSON-formatted structured logs written to stderr. When the context is not
    set or when printing to a custom file, the original print behavior is used.

    Args:
        context_var: A ContextVar that holds the current context identifier
                     (e.g., task name or function name). When None, regular
                     print behavior is used.
        context_field_name: The JSON field name for the context identifier
                           in the structured log (e.g., "task_name", "function_name").

    Returns:
        A print-like function that can replace builtins.print.

    Example:
        >>> _task_context = contextvars.ContextVar("task_context", default=None)
        >>> builtins.print = create_structured_print_wrapper(_task_context, "task_name")
        >>> _task_context.set("my_workflow/my_task")
        >>> print("Hello, world!")  # Emits structured JSON to stderr
    """

    def structured_print(
        *args: Any,
        sep: str = " ",
        end: str = "\n",
        file: Optional[TextIO] = None,
        flush: bool = False,
        **kwargs: Any,
    ) -> None:
        """Print wrapper that emits structured logs when in context."""
        context_value = context_var.get()

        if context_value and file in (None, sys.stderr, sys.stdout):
            # We're in a context - emit structured log to stderr
            message = sep.join(str(arg) for arg in args)
            structured_log = json.dumps(
                {
                    "__moose_structured_log__": True,
                    "level": "info",
                    "message": message,
                    context_field_name: context_value,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
            sys.stderr.write(structured_log + "\n")
            if flush:
                # Flush immediately to ensure logs appear in real-time for debugging.
                # This is intentional despite performance implications.
                sys.stderr.flush()
        else:
            # Not in context or custom file specified - use original print
            _original_print(*args, sep=sep, end=end, file=file, flush=flush, **kwargs)

    return structured_print


def get_original_print() -> Callable[..., None]:
    """
    Get the original builtin print function.

    Useful when you need to bypass structured logging and print directly.
    """
    return _original_print
