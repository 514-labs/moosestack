"""
ClickHouse Dictionary definitions for Moose Data Model v2 (dmv2).

This module provides OlapDictionary, an in-memory key-value store backed by a
ClickHouse table/query or an external system (MySQL, MongoDB, Redis, etc.).

Usage::

    from pydantic import BaseModel
    from moose_lib import OlapTable, OlapDictionary, OlapDictionaryConfig, OlapConfig
    from moose_lib import HashedLayout, ComplexKeyHashedLayout, DictionaryLifetime

    class Product(BaseModel):
        product_id: str
        product_name: str
        category: str

    products_table = OlapTable[Product](
        name="products",
        config=OlapConfig(order_by_fields=["product_id"]),
    )

    product_dict = OlapDictionary[Product](
        name="dict_products",
        config=OlapDictionaryConfig(
            source_table=products_table,
            primary_key=["product_id"],
            layout=HashedLayout(),
            lifetime=DictionaryLifetime(min=10, max=15),
        ),
    )
"""

from typing import Any, Generic, Literal, Optional, Union
from pydantic import (
    AliasGenerator,
    BaseModel,
    ConfigDict,
    SecretStr,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

from .types import BaseTypedResource, T
from .life_cycle import LifeCycle
from ._registry import _olap_dictionaries
from ._source_capture import get_source_file_from_stack
from .view import _format_table_reference
from ..data_models import _to_columns

# ─── Column attributes ────────────────────────────────────────────────────────


class DictionaryColumn(BaseModel):
    """Per-column attributes for a dictionary attribute column.

    These control ClickHouse-specific behaviour for each attribute column.
    The column name and type are derived from the Pydantic model field; these
    attributes are overlaid on top.
    """

    model_config = ConfigDict(extra="forbid")

    default: Optional[str] = None
    """DEFAULT expression — fallback value when key is not found."""
    expression: Optional[str] = None
    """EXPRESSION attribute — computed from other columns."""
    hierarchical: bool = False
    """IS_HIERARCHICAL — enables hierarchical parent-child lookups."""
    injective: bool = False
    """IS_INJECTIVE — enables GROUP BY optimisation (one-to-one mapping)."""
    is_object_id: bool = False
    """IS_OBJECT_ID — MongoDB-specific ObjectId attribute."""
    comment: Optional[str] = None
    """Optional column-level COMMENT string."""


# ─── Lifetime ─────────────────────────────────────────────────────────────────


class DictionaryLifetime(BaseModel):
    """Dictionary refresh policy.

    - ``DictionaryLifetime(min=0, max=0)`` — static, never refresh.
    - ``DictionaryLifetime(min=300, max=360)`` — refresh between 5-6 min.
    """

    model_config = ConfigDict(extra="forbid")
    min: int = 0
    max: int = 0

    @model_validator(mode="after")
    def _validate_bounds(self) -> "DictionaryLifetime":
        if self.min < 0 or self.max < 0 or self.max < self.min:
            raise ValueError(
                f"DictionaryLifetime requires 0 <= min <= max, got min={self.min} max={self.max}"
            )
        return self


# ─── Invalidation ─────────────────────────────────────────────────────────────


class DictionaryInvalidation(BaseModel):
    """Optional invalidation check: skip reload when result unchanged."""

    model_config = ConfigDict(extra="forbid")
    column: str
    fn: str
    """Aggregate function name, e.g. ``"max"``."""


# ─── Layout types ─────────────────────────────────────────────────────────────


class FlatLayout(BaseModel):
    """Simple array layout — fastest for small dictionaries with sequential integer keys."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["FLAT"] = "FLAT"


class HashedLayout(BaseModel):
    """Hash table layout — good general-purpose choice for arbitrary integer keys."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["HASHED"] = "HASHED"
    initial_array_size: Optional[int] = None
    max_load_factor: Optional[float] = None


class SparseHashedLayout(BaseModel):
    """Space-optimised hash table (~3x less memory, slightly slower)."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["SPARSE_HASHED"] = "SPARSE_HASHED"
    initial_array_size: Optional[int] = None
    max_load_factor: Optional[float] = None


class HashedArrayLayout(BaseModel):
    """Array of small hashed dictionaries — best for multi-threaded reads."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["HASHED_ARRAY"] = "HASHED_ARRAY"
    shards: Optional[int] = None


class RangeHashedLayout(BaseModel):
    """Hash table with range-based lookups."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["RANGE_HASHED"] = "RANGE_HASHED"
    range_lookup_strategy: Optional[str] = None


class CacheLayout(BaseModel):
    """Fixed-size LRU cache, loaded on demand."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["CACHE"] = "CACHE"
    size_in_cells: int
    max_threads_for_updates: Optional[int] = None


class SsdCacheLayout(BaseModel):
    """SSD-backed cache — larger than Cache but backed by SSD storage."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["SSD_CACHE"] = "SSD_CACHE"
    path: str
    block_size: Optional[int] = None
    file_size: Optional[int] = None
    read_buffer_size: Optional[int] = None
    write_buffer_size: Optional[int] = None
    max_stored_keys: Optional[int] = None


class DirectLayout(BaseModel):
    """Reads from source on every lookup — no caching."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["DIRECT"] = "DIRECT"


class IpTrieLayout(BaseModel):
    """Longest-prefix match for IPv4/IPv6 addresses."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["IP_TRIE"] = "IP_TRIE"
    access_to_key_from_attributes: Optional[bool] = None


class ComplexKeyHashedLayout(BaseModel):
    """Multi-column key hash table."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["COMPLEX_KEY_HASHED"] = "COMPLEX_KEY_HASHED"
    initial_array_size: Optional[int] = None
    max_load_factor: Optional[float] = None


class ComplexKeySparseHashedLayout(BaseModel):
    """Multi-column key sparse hash table."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["COMPLEX_KEY_SPARSE_HASHED"] = "COMPLEX_KEY_SPARSE_HASHED"
    initial_array_size: Optional[int] = None
    max_load_factor: Optional[float] = None


class ComplexKeyHashedArrayLayout(BaseModel):
    """Multi-column key hashed array."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["COMPLEX_KEY_HASHED_ARRAY"] = "COMPLEX_KEY_HASHED_ARRAY"
    shards: Optional[int] = None


class ComplexKeyCacheLayout(BaseModel):
    """Multi-column key LRU cache."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["COMPLEX_KEY_CACHE"] = "COMPLEX_KEY_CACHE"
    size_in_cells: int
    max_threads_for_updates: Optional[int] = None


class ComplexKeySsdCacheLayout(BaseModel):
    """Multi-column key SSD cache."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["COMPLEX_KEY_SSD_CACHE"] = "COMPLEX_KEY_SSD_CACHE"
    path: str
    block_size: Optional[int] = None
    file_size: Optional[int] = None
    read_buffer_size: Optional[int] = None
    write_buffer_size: Optional[int] = None
    max_stored_keys: Optional[int] = None


class ComplexKeyDirectLayout(BaseModel):
    """Multi-column key direct (no caching)."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["COMPLEX_KEY_DIRECT"] = "COMPLEX_KEY_DIRECT"


DictionaryLayout = Union[
    FlatLayout,
    HashedLayout,
    SparseHashedLayout,
    HashedArrayLayout,
    RangeHashedLayout,
    CacheLayout,
    SsdCacheLayout,
    DirectLayout,
    IpTrieLayout,
    ComplexKeyHashedLayout,
    ComplexKeySparseHashedLayout,
    ComplexKeyHashedArrayLayout,
    ComplexKeyCacheLayout,
    ComplexKeySsdCacheLayout,
    ComplexKeyDirectLayout,
]
"""Union of all 15 ClickHouse dictionary layout types."""

# ─── External source types ────────────────────────────────────────────────────

# Shared config for external source models: fields use snake_case for user
# convenience but serialize to camelCase so Rust's #[serde(rename_all = "camelCase")]
# can deserialize them correctly.
_external_source_config = ConfigDict(
    extra="forbid",
    populate_by_name=True,
    alias_generator=AliasGenerator(serialization_alias=to_camel),
)


class HttpSource(BaseModel):
    """HTTP/HTTPS endpoint as dictionary source."""

    model_config = _external_source_config
    type: Literal["HTTP"] = "HTTP"
    url: str
    format: str
    method: Optional[str] = None
    where_clause: Optional[str] = None

    @field_validator("where_clause")
    @classmethod
    def _reject_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("where_clause must not be blank")
        return v


class ClickHouseRemoteSource(BaseModel):
    """Remote ClickHouse server as dictionary source."""

    model_config = _external_source_config
    type: Literal["CLICK_HOUSE"] = "CLICK_HOUSE"
    host: str
    port: int
    user: str
    password: SecretStr
    db: str
    table: str
    query: Optional[str] = None
    where_clause: Optional[str] = None
    invalidate_query: Optional[str] = None

    @field_validator("query", "where_clause", "invalidate_query")
    @classmethod
    def _reject_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("field must not be blank")
        return v


class MysqlSource(BaseModel):
    """MySQL database as dictionary source."""

    model_config = _external_source_config
    type: Literal["MYSQL"] = "MYSQL"
    host: str
    port: int = 3306
    user: str
    password: SecretStr
    db: str
    table: str
    query: Optional[str] = None
    where_clause: Optional[str] = None
    invalidate_query: Optional[str] = None

    @field_validator("query", "where_clause", "invalidate_query")
    @classmethod
    def _reject_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("field must not be blank")
        return v


class PostgresqlSource(BaseModel):
    """PostgreSQL database as dictionary source."""

    model_config = _external_source_config
    type: Literal["POSTGRESQL"] = "POSTGRESQL"
    host: str
    port: int = 5432
    user: str
    password: SecretStr
    db: str
    table: str
    query: Optional[str] = None
    where_clause: Optional[str] = None
    invalidate_query: Optional[str] = None

    @field_validator("query", "where_clause", "invalidate_query")
    @classmethod
    def _reject_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("field must not be blank")
        return v


class RedisSource(BaseModel):
    """Redis as dictionary source."""

    model_config = _external_source_config
    type: Literal["REDIS"] = "REDIS"
    host: str
    port: int = 6379
    storage_type: str
    password: Optional[SecretStr] = None
    db_index: Optional[int] = None


class MongoDbSource(BaseModel):
    """MongoDB collection as dictionary source."""

    model_config = _external_source_config
    type: Literal["MONGODB"] = "MONGODB"
    host: str
    port: int = 27017
    user: str
    password: SecretStr
    db: str
    collection: str


class ExecutableSource(BaseModel):
    """External executable process as dictionary source."""

    model_config = _external_source_config
    type: Literal["EXECUTABLE"] = "EXECUTABLE"
    command: str
    format: str
    implicit_key: Optional[bool] = None


class S3Source(BaseModel):
    """S3 object storage as dictionary source."""

    model_config = _external_source_config
    type: Literal["S3"] = "S3"
    url: str
    format: str
    access_key_id: Optional[str] = None
    secret_access_key: Optional[SecretStr] = None


ExternalSource = Union[
    HttpSource,
    ClickHouseRemoteSource,
    MysqlSource,
    PostgresqlSource,
    RedisSource,
    MongoDbSource,
    ExecutableSource,
    S3Source,
]
"""Union of all supported external dictionary source types."""

# ─── Config ───────────────────────────────────────────────────────────────────


class OlapDictionaryConfig(BaseModel):
    """User-facing configuration for OlapDictionary.

    Exactly one of ``source_table``, ``source_query``, or ``external_source`` must
    be set.  Providing zero or more than one raises a ``ValueError`` at
    instantiation time (via ``model_post_init``).
    """

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    # ── Source — exactly one must be set ──────────────────────────────────────
    source_table: Optional[Any] = None
    """Direct reference to an OlapTable or View on the same ClickHouse server."""
    source_query: Optional[str] = None
    """SQL query string for the local ClickHouse server."""
    source_tables: Optional[list[Any]] = None
    """Explicit dependency list — required when ``source_query`` is set."""
    external_source: Optional[ExternalSource] = None
    """External system source (MySQL, MongoDB, HTTP, etc.)."""

    # ── Key and schema ────────────────────────────────────────────────────────
    primary_key: list[str]
    """List of primary-key column names (single for simple layouts, multi for COMPLEX_KEY_*)."""
    layout: DictionaryLayout
    """Memory layout / storage model (discriminated by ``type``)."""
    lifetime: Union[int, DictionaryLifetime] = DictionaryLifetime(min=0, max=0)
    """Refresh policy. ``0`` or ``DictionaryLifetime(0, 0)`` → static."""
    invalidate: Optional[DictionaryInvalidation] = None
    """Optional top-level invalidation query."""
    columns: Optional[dict[str, DictionaryColumn]] = None
    """Per-column attribute overrides (DEFAULT, EXPRESSION, INJECTIVE, etc.)."""
    settings: Optional[dict[str, Union[str, int]]] = None
    """Extra ClickHouse dictionary settings (values are coerced to strings)."""
    comment: Optional[str] = None
    database: Optional[str] = None
    cluster: Optional[str] = None
    life_cycle: Optional[LifeCycle] = None
    metadata: Optional[dict] = None

    @model_validator(mode="after")
    def _validate_source(self) -> "OlapDictionaryConfig":
        sources = [self.source_table, self.source_query, self.external_source]
        set_count = sum(1 for s in sources if s is not None)
        if set_count != 1:
            raise ValueError(
                "Exactly one of source_table, source_query, or external_source must be set "
                f"(got {set_count} set)"
            )
        if self.source_query is not None and not self.source_tables:
            raise ValueError("source_tables is required when using source_query")
        if self.source_query is not None and not self.source_query.strip():
            raise ValueError("source_query must not be blank")
        if isinstance(self.lifetime, int) and self.lifetime < 0:
            raise ValueError(
                f"lifetime must be a non-negative integer, got {self.lifetime}"
            )
        if not self.primary_key:
            raise ValueError("primary_key must contain at least one column name")
        # Validate primary key cardinality matches layout type.
        # COMPLEX_KEY_* layouts accept any-type (including string) keys and support
        # one or more columns. Non-complex layouts (HASHED, FLAT, etc.) require
        # exactly one UInt64-compatible key.
        complex_key_types = {
            "COMPLEX_KEY_HASHED",
            "COMPLEX_KEY_SPARSE_HASHED",
            "COMPLEX_KEY_HASHED_ARRAY",
            "COMPLEX_KEY_CACHE",
            "COMPLEX_KEY_SSD_CACHE",
            "COMPLEX_KEY_DIRECT",
        }
        layout_type = self.layout.type if self.layout else None
        if layout_type not in complex_key_types and layout_type is not None:
            if len(self.primary_key) != 1:
                raise ValueError(
                    f"Layout '{layout_type}' requires exactly 1 primary key column "
                    f"(got {len(self.primary_key)}). Use a COMPLEX_KEY_* layout for string or multi-column keys."
                )
        # Validate that invalidate is not used with external sources
        if self.external_source is not None and self.invalidate is not None:
            raise ValueError(
                "invalidate cannot be set when using external_source — "
                "use the per-source invalidate_query field instead "
                "(e.g., ClickHouseRemoteSource.invalidate_query)"
            )
        return self


# ─── OlapDictionary ───────────────────────────────────────────────────────────


class OlapDictionary(BaseTypedResource, Generic[T]):
    """Represents a ClickHouse Dictionary definition.

    Dictionaries are in-memory key-value stores for fast lookups backed by a
    ClickHouse table/query or an external system.

    Usage::

        product_dict = OlapDictionary[ProductLookup](
            name="dict_products",
            config=OlapDictionaryConfig(
                source_table=products_table,
                primary_key=["product_id"],
                layout=HashedLayout(),
                lifetime=DictionaryLifetime(min=10, max=15),
            ),
        )

        # Use in MV SQL (no database prefix when database is not configured)
        f"dictGet('dict_products', 'product_name', product_id)"
        # or via helper:
        product_dict.get("product_name", "product_id")

    Args:
        name: Dictionary name (used in ClickHouse DDL).
        config: OlapDictionaryConfig with source, layout, lifetime, etc.
    """

    kind: str = "OlapDictionary"

    def __init__(self, name: str, config: OlapDictionaryConfig, **kwargs: Any) -> None:
        t = self._get_type(kwargs)
        self._set_type(name, t)
        self.config = config
        self._column_list = _to_columns(t)
        self.life_cycle = config.life_cycle
        self.metadata = {**(config.metadata or {})}
        source_file = get_source_file_from_stack()
        if "source" not in self.metadata and source_file:
            self.metadata["source"] = {"file": source_file}

        # Build source_tables list for dependency tracking
        if config.source_table is not None:
            self.source_tables = [_format_table_reference(config.source_table)]
        elif config.source_tables:
            self.source_tables = [
                _format_table_reference(tbl) for tbl in config.source_tables
            ]
        else:
            self.source_tables = []

        if name in _olap_dictionaries:
            raise ValueError(f"OlapDictionary '{name}' is already registered")
        _olap_dictionaries[name] = self

    def _build_key_expr(self, *keys: Any) -> str:
        """Build the key expression for a dictGet/dictHas SQL fragment.

        Args:
            *keys: One or more SQL key expressions (column references or literals).

        Returns:
            A single SQL expression: the bare key for one column, or
            ``tuple(k1, k2, ...)`` for composite keys.

        Raises:
            ValueError: If no keys are provided or count doesn't match primary key.
        """
        if not keys:
            raise ValueError("At least one key argument is required")
        expected = len(self.config.primary_key)
        if len(keys) != expected:
            raise ValueError(
                f"Expected {expected} key argument(s) to match primary_key "
                f"{self.config.primary_key}, got {len(keys)}"
            )
        if len(keys) > 1:
            return f"tuple({', '.join(str(k) for k in keys)})"
        return str(keys[0])

    def _qualified_name(self) -> str:
        """Return ``database.name`` when database is set, otherwise just ``name``."""
        if self.config.database:
            return f"{self.config.database}.{self.name}"
        return self.name

    def get(self, attr: str, *keys: Any) -> str:
        """Generate a ``dictGet`` SQL fragment.

        Args:
            attr: Attribute column name to retrieve.
            *keys: Key column expressions (SQL fragments or column references).

        Returns:
            SQL fragment, e.g.
            ``dictGet('mydb.dict_products', 'product_name', product_id)``
        """
        key_expr = self._build_key_expr(*keys)
        return f"dictGet('{self._qualified_name()}', '{attr}', {key_expr})"

    def get_or_default(self, attr: str, default: Any, *keys: Any) -> str:
        """Generate a ``dictGetOrDefault`` SQL fragment.

        Args:
            attr: Attribute column name to retrieve.
            default: Default SQL expression when the key is not found. Must be
                a valid SQL literal or expression — string values must be
                single-quoted (e.g. ``"'Unknown'"``), numbers are passed as-is
                (e.g. ``0``), and expressions like ``"toDate('2020-01-01')"``
                are embedded verbatim. Bare Python strings without quotes are
                treated as column/identifier references by ClickHouse.
            *keys: Key column expressions (SQL fragments or column references).

        Returns:
            SQL fragment, e.g.
            ``dictGetOrDefault('mydb.dict_products', 'category', product_id, 'Unknown')``
        """
        key_expr = self._build_key_expr(*keys)
        return f"dictGetOrDefault('{self._qualified_name()}', '{attr}', {key_expr}, {default})"

    def has(self, *keys: Any) -> str:
        """Generate a ``dictHas`` SQL fragment.

        Args:
            *keys: Key column expressions.

        Returns:
            SQL fragment, e.g. ``dictHas('mydb.dict_products', product_id)``
        """
        key_expr = self._build_key_expr(*keys)
        return f"dictHas('{self._qualified_name()}', {key_expr})"
