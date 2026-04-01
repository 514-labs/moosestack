"""
OLAP Dictionary definitions for Moose Data Model v2 (dmv2).

This module provides the OlapDictionary class for defining ClickHouse Dictionaries —
in-memory key-value stores for fast lookups backed by local tables, queries, or
external systems.
"""

from typing import Any, Generic, Optional, Union
from pydantic import BaseModel

from .types import BaseTypedResource, T
from .olap_table import OlapTable
from .view import View
from .life_cycle import LifeCycle
from ._registry import _olap_dictionaries
from ._source_capture import get_source_file_from_stack
from ..data_models import (
    Column,
    DataType,
    DataEnum,
    ArrayType,
    Nested,
    NamedTupleType,
    MapType,
    _to_columns,
)


# ─── Column serialization ──────────────────────────────────────────────────────


def _data_type_to_string(dt: DataType) -> str:
    """Convert a DataType to a ClickHouse type string.

    Simple string types are already ClickHouse type strings (e.g. "String", "UInt64").
    Complex types (Nullable, Array, etc.) are reconstructed from their structured form.
    """
    if isinstance(dt, str):
        return dt
    if isinstance(dt, ArrayType):
        element_str = _data_type_to_string(dt.element_type)
        if dt.element_nullable:
            return f"Array(Nullable({element_str}))"
        return f"Array({element_str})"
    if isinstance(dt, NamedTupleType):
        fields = ", ".join(
            f"{name} {_data_type_to_string(ftype)}" for name, ftype in dt.fields
        )
        return f"Tuple({fields})"
    if isinstance(dt, MapType):
        key_str = _data_type_to_string(dt.key_type)
        val_str = _data_type_to_string(dt.value_type)
        return f"Map({key_str}, {val_str})"
    if isinstance(dt, DataEnum):
        if dt.values:
            enum_type = "Enum8" if len(dt.values) <= 255 else "Enum16"
            entries = ", ".join(
                (
                    f"'{v.name}' = {v.value}"
                    if isinstance(v.value, int)
                    else f"'{v.name}' = {i}"
                )
                for i, v in enumerate(dt.values)
            )
            return f"{enum_type}({entries})"
        return "String"
    if isinstance(dt, Nested):
        # Dictionary columns don't support Nested types; fall back to String
        return "String"
    return "String"


def _column_to_dict_col_json(
    column: Column,
    default_value: Any = None,
) -> dict:
    """Convert a Column to a DictionaryColumnJson dict, using the defaultValue if provided."""
    type_str = _data_type_to_string(column.data_type)
    # Wrap non-required (optional) fields in Nullable unless already nullable
    if not column.required and not type_str.startswith("Nullable("):
        type_str = f"Nullable({type_str})"
    result: dict = {
        "name": column.name,
        "typeString": type_str,
    }
    if default_value is not None:
        result["defaultValue"] = str(default_value)
    if column.comment is not None:
        result["comment"] = column.comment
    return result


# ─── OlapDictionary ────────────────────────────────────────────────────────────


class OlapDictionary(BaseTypedResource, Generic[T]):
    """Represents a ClickHouse Dictionary — an in-memory key-value store for fast lookups.

    Dictionaries can be backed by local ClickHouse tables/queries or external systems.
    They are refreshed automatically according to the configured lifetime policy.

    Args:
        name: The name of the dictionary.
        source_table: An OlapTable or View on the same ClickHouse server.
                      Automatically generates a TABLE source. Mutually exclusive with
                      source_query and external_source.
        source_query: An arbitrary SQL query on the local ClickHouse server.
                      Mutually exclusive with source_table and external_source.
        source_tables: Source tables referenced by source_query (dependency tracking).
                       Only relevant when source_query is provided.
        external_source: A dict with a ``type`` key (e.g. ``{"type": "HTTP", ...}``).
                         Mutually exclusive with source_table and source_query.
        primary_key: List of column names to use as the primary key.
        layout: Dict with a ``type`` key (e.g. ``{"type": "HASHED"}``).
                Defaults to ``{"type": "HASHED"}``.
        lifetime: Refresh policy.
                  - ``0`` → STATIC (never refresh)
                  - positive int → SINGLE (refresh every N seconds)
                  - ``{"min": m, "max": x}`` → RANGE
                  Defaults to 3600.
        life_cycle: Lifecycle management policy. Defaults to FULLY_MANAGED.
        defaults: Dict mapping column names to default values for missing keys.
        settings: Dict of dictionary-level ClickHouse settings.
        comment: Optional comment for the dictionary.
        database: Optional database name. Uses the default database if not specified.
        cluster_name: Optional ON CLUSTER name for distributed ClickHouse deployments.
        metadata: Optional metadata (e.g., description, source file).
        t: The Pydantic model type defining the column schema
           (pass via ``OlapDictionary[MyModel](name, ...)``).

    Example::

        class UserAttributes(BaseModel):
            user_id: str
            display_name: str
            tier: str

        user_dict = OlapDictionary[UserAttributes](
            "user_attributes",
            source_table=users_table,
            primary_key=["user_id"],
            layout={"type": "HASHED"},
            lifetime=3600,
        )

        # Use in a query
        sql = f"dictGet('{user_dict.name}', 'display_name', user_id)"
    """

    kind: str = "OlapDictionary"

    def __init__(
        self,
        name: str,
        *,
        source_table: Optional[Union["OlapTable", "View"]] = None,
        source_query: Optional[str] = None,
        source_tables: Optional[list] = None,
        external_source: Optional[dict] = None,
        primary_key: list[str],
        layout: Optional[dict] = None,
        lifetime: Union[int, dict] = 3600,
        life_cycle: Optional[LifeCycle] = None,
        defaults: Optional[dict] = None,
        settings: Optional[dict] = None,
        comment: Optional[str] = None,
        database: Optional[str] = None,
        cluster_name: Optional[str] = None,
        metadata: Optional[dict] = None,
        **kwargs,
    ) -> None:
        super().__init__()
        self._set_type(name, self._get_type(kwargs))

        # Validate source: exactly one must be provided
        sources_provided = sum(
            [
                source_table is not None,
                source_query is not None,
                external_source is not None,
            ]
        )
        if sources_provided != 1:
            raise ValueError(
                "OlapDictionary: provide exactly one of source_table, source_query, "
                "or external_source."
            )

        self.name = name
        self._source_table = source_table
        self._source_query = source_query
        self._source_tables = source_tables or []
        self._external_source = external_source
        self.primary_key = primary_key
        self.layout = layout or {"type": "HASHED"}
        self.lifetime = lifetime
        self.life_cycle = life_cycle
        self.defaults = defaults or {}
        self.settings = settings or {}
        self.comment = comment
        self.database = database
        self.cluster_name = cluster_name

        # Build column list from Pydantic model type
        self._column_list: list[Column] = _to_columns(self._t)

        # Initialize metadata
        self.metadata: dict = metadata.copy() if metadata else {}
        if "source" not in self.metadata:
            source_file = get_source_file_from_stack()
            if source_file:
                self.metadata["source"] = {"file": source_file}

        # Register in the global registry
        if name in _olap_dictionaries:
            raise ValueError(f"OlapDictionary with name {name} already exists")
        _olap_dictionaries[name] = self

    # ─── Source serialization ──────────────────────────────────────────────────

    def _resolve_source(self) -> dict:
        """Resolve the source configuration to its JSON representation."""
        if self._source_table is not None:
            table = self._source_table
            if isinstance(table, OlapTable):
                table_name = table.name
                db = getattr(table.config, "database", None)
            else:
                # View
                table_name = table.name
                db = getattr(table, "database", None)
            result: dict = {"type": "TABLE", "table": table_name}
            if db is not None:
                result["database"] = db
            return result

        if self._source_query is not None:
            return {"type": "QUERY", "query": self._source_query}

        # external_source
        return {"type": "EXTERNAL", "source": self._external_source}

    # ─── Lifetime serialization ────────────────────────────────────────────────

    def _serialize_lifetime(self) -> dict:
        """Serialize the lifetime config to the Rust serde format."""
        lt = self.lifetime
        if isinstance(lt, int):
            if lt == 0:
                return {"type": "STATIC"}
            return {"type": "SINGLE", "seconds": lt}
        # dict with min/max
        return {"type": "RANGE", "min": lt["min"], "max": lt["max"]}

    # ─── JSON serialization ────────────────────────────────────────────────────

    def to_json(self) -> dict:
        """Serialize to the camelCase JSON dict expected by the Rust CLI.

        Returns:
            A dict matching the Rust ``OlapDictionary`` serde schema (camelCase keys).
        """
        columns = [
            _column_to_dict_col_json(col, self.defaults.get(col.name))
            for col in self._column_list
        ]

        settings_str: dict[str, str] = {k: str(v) for k, v in self.settings.items()}

        result: dict = {
            "name": self.name,
            "database": self.database,
            "clusterName": self.cluster_name,
            "source": self._resolve_source(),
            "primaryKey": self.primary_key,
            "columns": columns,
            "layout": self.layout,
            "lifetime": self._serialize_lifetime(),
            "settings": settings_str,
            "lifeCycle": (
                self.life_cycle.value
                if self.life_cycle is not None
                else LifeCycle.FULLY_MANAGED.value
            ),
            "metadata": self.metadata if self.metadata else None,
        }
        if self.comment is not None:
            result["comment"] = self.comment
        return result

    # ─── SQL helper methods ────────────────────────────────────────────────────

    def _dict_ref(self) -> str:
        """Return the fully qualified dictionary reference for SQL."""
        if self.database:
            return f"{self.database}.{self.name}"
        return self.name

    def get(self, attribute: str, key: str) -> str:
        """Generate a ``dictGet(dictionary, attribute, key)`` SQL expression.

        Args:
            attribute: The attribute column name to look up.
            key: A SQL expression representing the key value(s).

        Returns:
            A SQL string: ``dictGet('dict_name', 'attr', key)``
        """
        return f"dictGet('{self._dict_ref()}', '{attribute}', {key})"

    def get_or_default(self, attribute: str, key: str, default: str) -> str:
        """Generate a ``dictGetOrDefault(dictionary, attribute, key, default)`` SQL expression.

        Args:
            attribute: The attribute column name to look up.
            key: A SQL expression representing the key value(s).
            default: The default value SQL expression for missing keys.

        Returns:
            A SQL string: ``dictGetOrDefault('dict_name', 'attr', key, default)``
        """
        return (
            f"dictGetOrDefault('{self._dict_ref()}', '{attribute}', {key}, {default})"
        )

    def has(self, key: str) -> str:
        """Generate a ``dictHas(dictionary, key)`` SQL expression.

        Args:
            key: A SQL expression representing the key value(s).

        Returns:
            A SQL string: ``dictHas('dict_name', key)``
        """
        return f"dictHas('{self._dict_ref()}', {key})"
