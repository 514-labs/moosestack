"""
Utilities for capturing source file information from the call stack.

This module provides functions to extract source file paths from Python's
call stack, filtering out internal library paths.
"""

from typing import Optional
import inspect


def get_source_file_from_stack() -> Optional[str]:
    """Extract the source file path from the call stack, skipping internal modules.

    Returns the first file path that is not from internal moose_lib modules,
    site-packages, or special Python frames.

    Returns:
        The absolute path to the user's source file, or None if not found.
    """
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
