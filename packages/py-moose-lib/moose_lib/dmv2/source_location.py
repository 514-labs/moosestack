"""
Source location utilities for Moose Data Model v2 (dmv2).

This module provides utilities for capturing source file location
from stack traces, used for tracking where resources are defined.
"""

import traceback
from typing import Optional


def get_source_file_from_stack() -> Optional[str]:
    """Extract the first user-code file path from the current stack trace.

    Looks for frames containing '/app/' or '\\app\\' to identify user code
    and filter out library internals.

    Returns:
        The file path of the first user-code frame, or None if not found.
    """
    try:
        for frame in traceback.extract_stack():
            if "/app/" in frame.filename or "\\app\\" in frame.filename:
                return frame.filename
    except Exception:
        pass
    return None
