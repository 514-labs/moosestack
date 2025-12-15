"""
Shared types and base classes for Moose Data Model v2 (dmv2).

This module provides the core type definitions and base classes used across
the dmv2 package, including generic type parameters, type aliases, and base
resource classes.
"""

from typing import Any, Generic, TypeVar, Union

import typing_extensions
from pydantic import BaseModel
from pydantic.fields import FieldInfo
from ..data_models import Column

T = TypeVar("T", bound=BaseModel)
U = TypeVar("U", bound=BaseModel)
T_none = TypeVar("T_none", bound=Union[BaseModel, None])
U_none = TypeVar("U_none", bound=Union[BaseModel, None])
type ZeroOrMany[T] = Union[T, list[T], None]


class Cols:
    """Provides runtime checked column name access for Moose resources.

    Instead of using string literals for column names, you can use attribute access
    on this object, which will verify the name against the Pydantic model's fields.

    Example:
        >>> class MyModel(BaseModel):
        ...     user_id: int
        ...     event_name: str
        >>> table = OlapTable[MyModel]("my_models")
        >>> print(table.cols.user_id)  # Output: a column object
        >>> print(table.cols.non_existent) # Raises AttributeError
    """

    _columns: dict[str, Column]

    def __init__(self, columns: list[Column]):
        self._columns = {c.name: c for c in columns}

    def __getattr__(self, item: str) -> Column:
        if item in self._columns:
            return self._columns[item]
        raise AttributeError(f"{item} is not a valid column name")

    def __getitem__(self, item: str) -> Column:
        """Allow bracket access to columns, equivalent to attribute access.

        Example:
            table.cols["user_id"] is the same as table.cols.user_id
        """
        return self.__getattr__(item)


@typing_extensions.deprecated("use cols in OlapTable instead")
class Columns(Generic[T]):
    """Provides runtime checked column name access for Moose resources.

    Instead of using string literals for column names, you can use attribute access
    on this object, which will verify the name against the Pydantic model's fields.

    Example:
        >>> class MyModel(BaseModel):
        ...     user_id: int
        ...     event_name: str
        >>> cols = Columns(MyModel)
        >>> print(cols.user_id)  # Output: user_id
        >>> print(cols.non_existent) # Raises AttributeError

    Args:
        model: The Pydantic model type whose fields represent the columns.
    """

    _fields: dict[str, FieldInfo]

    def __init__(self, model: type[T]):
        self._fields = model.model_fields

    def __getattr__(self, item: str) -> str:
        if item in self._fields:
            return item  # or some Column representation
        raise AttributeError(f"{item} is not a valid column name")


class BaseTypedResource(Generic[T]):
    """Base class for Moose resources that are typed with a Pydantic model.

    Handles the association of a Pydantic model `T` with a Moose resource,
    providing type validation and access to the model type.

    Attributes:
        name (str): The name of the Moose resource.
    """

    _t: type[T]
    name: str

    @classmethod
    def _get_type(cls, keyword_args: dict):
        t = keyword_args.get("t")
        if t is None:
            raise ValueError(
                f"Use `{cls.__name__}[T](name='...')` to supply the Pydantic model type`"
            )
        if not isinstance(t, type) or not issubclass(t, BaseModel):
            raise ValueError(f"{t} is not a Pydantic model")
        return t

    @property
    def model_type(self) -> type[T]:
        """Get the Pydantic model type associated with this resource."""
        return self._t

    def _set_type(self, name: str, t: type[T]):
        """Internal method to set the resource name and associated Pydantic type."""
        self._t = t
        self.name = name

    def __class_getitem__(cls, item: type[BaseModel]):
        def curried_constructor(*args, **kwargs):
            return cls(t=item, *args, **kwargs)

        return curried_constructor


class TypedMooseResource(BaseTypedResource, Generic[T]):
    """Base class for Moose resources that have columns derived from a Pydantic model.

    Extends `BaseTypedResource` by adding a `Columns` helper for type-safe
    column name access.

    Attributes:
        columns (Columns[T]): An object providing attribute access to column names.
    """

    @property
    @typing_extensions.deprecated("use cols in OlapTable instead", category=None)
    def columns(self):
        return Columns[T](self._t)

    def _set_type(self, name: str, t: type[T]):
        super()._set_type(name, t)
