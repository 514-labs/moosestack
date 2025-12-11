"""
Lifecycle management definitions for Moose Data Model v2 (dmv2).

This module defines how Moose manages the lifecycle of database resources
when your code changes.
"""

from enum import Enum


class LifeCycle(Enum):
    """Defines how Moose manages the lifecycle of database resources when your code changes.

    This enum controls the behavior when there are differences between your code definitions
    and the actual database schema or structure.
    """

    FULLY_MANAGED = "FULLY_MANAGED"
    """Full automatic management (default behavior).
    Moose will automatically modify database resources to match your code definitions,
    including potentially destructive operations like dropping columns or tables.
    """

    DELETION_PROTECTED = "DELETION_PROTECTED"
    """Deletion-protected automatic management.
    Moose will modify resources to match your code but will avoid destructive actions
    such as dropping columns, or tables. Only additive changes are applied.
    """

    EXTERNALLY_MANAGED = "EXTERNALLY_MANAGED"
    """External management - no automatic changes.
    Moose will not modify the database resources. You are responsible for managing
    the schema and ensuring it matches your code definitions manually.
    """
