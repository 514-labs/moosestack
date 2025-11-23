"""
MooseModel base class for data models with LSP-friendly column access.

This module provides MooseModel, a Pydantic BaseModel subclass that adds
Column descriptors for each field, enabling LSP autocomplete when accessing
columns for SQL query construction.
"""

from pydantic import BaseModel
from typing import TYPE_CHECKING
from ..data_models import Column, _to_columns


class ColsNamespace:
    """
    Namespace object that provides column access via attributes.

    This is created at the class level for backward compatibility with
    the existing table.cols.field_name pattern.

    Example:
        >>> class User(MooseModel):
        ...     user_id: int
        >>> User.cols.user_id  # Returns Column object
    """

    def __init__(self, columns: list[Column]):
        """
        Initialize cols namespace with columns.

        Args:
            columns: List of Column objects for the model
        """
        self._columns = {c.name: c for c in columns}

        # Set each column as an attribute for direct access
        for col in columns:
            setattr(self, col.name, col)

    def __getitem__(self, item: str) -> Column:
        """
        Allow bracket notation access to columns.

        Args:
            item: Column name

        Returns:
            Column object

        Raises:
            KeyError: If column name not found

        Example:
            >>> User.cols['user_id']  # Returns Column object
        """
        if item not in self._columns:
            raise KeyError(f"{item} is not a valid column name")
        return self._columns[item]

    def __getattr__(self, item: str) -> Column:
        """
        Fallback for attribute access (shouldn't be needed due to setattr).

        Args:
            item: Column name

        Returns:
            Column object

        Raises:
            AttributeError: If column name not found
        """
        if item.startswith("_"):
            # Allow access to private attributes
            raise AttributeError(
                f"'{type(self).__name__}' object has no attribute '{item}'"
            )

        if item in self._columns:
            return self._columns[item]
        raise AttributeError(f"{item} is not a valid column name")


class MooseModelMeta(type(BaseModel)):
    """
    Metaclass for MooseModel that adds Column descriptors.

    This metaclass runs after Pydantic's metaclass creates the model class.
    It adds Column objects as class attributes for each model field, enabling:
    1. Direct column access: Model.field_name returns Column object
    2. LSP autocomplete: LSP sees field_name from annotations
    3. Backward compatibility: Model.cols.field_name also works

    The Column descriptors coexist with Pydantic's instance fields because
    Pydantic separates class-level attributes from instance-level fields.
    """

    def __new__(mcs, name, bases, namespace, **kwargs):
        """
        Create new MooseModel class with Column descriptors.

        Args:
            name: Name of the class being created
            bases: Base classes
            namespace: Class namespace dictionary
            **kwargs: Additional keyword arguments

        Returns:
            New class with Column descriptors added
        """
        # Let Pydantic's metaclass create the class first
        cls = super().__new__(mcs, name, bases, namespace, **kwargs)

        # Skip for MooseModel base class itself
        if name == "MooseModel":
            return cls

        # Add Column descriptors if this is a model with fields
        if hasattr(cls, "model_fields") and cls.model_fields:
            # Generate columns from model fields
            columns = _to_columns(cls)

            # Add Column object for each field as class attribute
            # This enables: Model.field_name → Column
            for col in columns:
                setattr(cls, col.name, col)

            # Add .cols namespace for backward compatibility
            # This enables: Model.cols.field_name → Column
            cls.cols = ColsNamespace(columns)

        return cls


class MooseModel(BaseModel, metaclass=MooseModelMeta):
    """
    Base class for Moose data models with LSP-friendly column access.

    MooseModel extends Pydantic's BaseModel by adding Column descriptors
    for each field, enabling autocomplete when constructing SQL queries.

    Usage Patterns:

    1. Direct column access (NEW - with autocomplete):
        >>> class User(MooseModel):
        ...     user_id: int
        ...     email: str
        >>> query = f"SELECT {User.user_id:col}, {User.email:col} FROM users"
        >>> # LSP provides autocomplete for User.user_id

    2. Legacy .cols access (OLD - backward compatible):
        >>> query = f"SELECT {User.cols.user_id} FROM users"
        >>> # Works but requires type stubs for autocomplete

    3. Pydantic instance behavior (unchanged):
        >>> user = User(user_id=123, email="test@example.com")
        >>> user.user_id  # Returns 123 (int), not Column

    The metaclass ensures:
    - Class attributes (Model.field) return Column objects
    - Instance attributes (instance.field) return actual values
    - Full Pydantic compatibility maintained
    """

    pass
