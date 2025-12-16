import dataclasses
from decimal import Decimal
import re
from enum import Enum
from inspect import isclass
from uuid import UUID
from datetime import datetime, date

from typing import (
    Literal,
    Tuple,
    Union,
    Any,
    get_origin,
    get_args,
    TypeAliasType,
    Annotated,
    Type,
    _BaseGenericAlias,
    GenericAlias,
)
from pydantic import BaseModel, Field, PlainSerializer, GetCoreSchemaHandler, ConfigDict
from pydantic_core import CoreSchema, core_schema
import ipaddress

type Key[T: (str, int)] = T
type JWT[T] = T

# Integer type aliases for ClickHouse integer types
type Int8 = Annotated[int, "int8"]
type Int16 = Annotated[int, "int16"]
type Int32 = Annotated[int, "int32"]
type Int64 = Annotated[int, "int64"]
type UInt8 = Annotated[int, "uint8"]
type UInt16 = Annotated[int, "uint16"]
type UInt32 = Annotated[int, "uint32"]
type UInt64 = Annotated[int, "uint64"]

# Float type aliases for ClickHouse float types
type Float32 = Annotated[float, "float32"]
type Float64 = Annotated[float, "float64"]


@dataclasses.dataclass(
    frozen=True
)  # a BaseModel in the annotations will confuse pydantic
class ClickhousePrecision:
    precision: int


@dataclasses.dataclass(frozen=True)
class ClickhouseSize:
    size: int


@dataclasses.dataclass(frozen=True)
class ClickhouseFixedStringSize:
    size: int


@dataclasses.dataclass(frozen=True)
class ClickhouseDefault:
    expression: str


def clickhouse_default(expression: str) -> ClickhouseDefault:
    return ClickhouseDefault(expression=expression)


@dataclasses.dataclass(frozen=True)
class ClickHouseTTL:
    expression: str


@dataclasses.dataclass(frozen=True)
class ClickHouseCodec:
    expression: str


@dataclasses.dataclass(frozen=True)
class ClickHouseMaterialized:
    """
    ClickHouse MATERIALIZED column annotation.
    The column value is computed at INSERT time and physically stored.
    Cannot be explicitly inserted by users.

    Args:
        expression: ClickHouse SQL expression using column names (snake_case)

    Examples:
        # Extract date component
        event_date: Annotated[date, ClickHouseMaterialized("toDate(event_time)")]

        # Precompute hash
        user_hash: Annotated[int, ClickHouseMaterialized("cityHash64(user_id)")]

        # Complex expression with JSON
        combination_hash: Annotated[
            list[int],
            ClickHouseMaterialized(
                "arrayMap(kv -> cityHash64(kv.1, kv.2), "
                "JSONExtractKeysAndValuesRaw(toString(log_blob)))"
            )
        ]

    Notes:
        - Expression uses ClickHouse column names, not Python field names
        - MATERIALIZED and DEFAULT are mutually exclusive
        - Can be combined with ClickHouseCodec for compression
        - Changing the expression modifies the column in-place (existing values preserved)
    """

    expression: str


@dataclasses.dataclass(frozen=True)
class ClickHouseJson:
    max_dynamic_paths: int | None = None
    max_dynamic_types: int | None = None
    skip_paths: tuple[str, ...] = ()
    skip_regexps: tuple[str, ...] = ()


def clickhouse_decimal(precision: int, scale: int) -> Type[Decimal]:
    return Annotated[Decimal, Field(max_digits=precision, decimal_places=scale)]


def clickhouse_datetime64(precision: int) -> Type[datetime]:
    """
    Instructs Moose to create field as DateTime64(precision)
    However in Python the value still have microsecond precision at most,
    even if you write `timestamp: clickhouse_datetime64(9)
    """
    return Annotated[datetime, ClickhousePrecision(precision=precision)]


def FixedString(size: int) -> ClickhouseFixedStringSize:
    """
    Creates a FixedString(N) annotation for fixed-length strings.

    ClickHouse stores exactly N bytes, padding shorter values with null bytes.
    Values exceeding N bytes will raise an exception.

    Use for fixed-length data like hashes, IPs, UUIDs, MAC addresses.

    Example:
        md5_hash: Annotated[str, FixedString(16)]  # 16-byte MD5
        sha256: Annotated[str, FixedString(32)]    # 32-byte SHA256
        ipv6: Annotated[str, FixedString(16)]      # 16-byte IPv6
    """
    return ClickhouseFixedStringSize(size=size)


type Point = Annotated[tuple[float, float], "Point"]
type Ring = Annotated[list[tuple[float, float]], "Ring"]
type LineString = Annotated[list[tuple[float, float]], "LineString"]
type MultiLineString = Annotated[list[list[tuple[float, float]]], "MultiLineString"]
type Polygon = Annotated[list[list[tuple[float, float]]], "Polygon"]
type MultiPolygon = Annotated[list[list[list[tuple[float, float]]]], "MultiPolygon"]


def aggregated[T](
    result_type: Type[T],
    agg_func: str,
    param_types: list[type | GenericAlias | _BaseGenericAlias],
) -> Type[T]:
    return Annotated[
        result_type,
        AggregateFunction(agg_func=agg_func, param_types=tuple(param_types)),
    ]


@dataclasses.dataclass(frozen=True)
class AggregateFunction:
    agg_func: str
    param_types: tuple[type | GenericAlias | _BaseGenericAlias, ...]

    def to_dict(self):
        return {
            "functionName": self.agg_func,
            "argumentTypes": [
                py_type_to_column_type(t, [])[2] for t in self.param_types
            ],
        }


def simple_aggregated[T](agg_func: str, arg_type: Type[T]) -> Type[T]:
    """Helper to create a SimpleAggregateFunction type annotation.

    SimpleAggregateFunction is a ClickHouse type for storing aggregated values directly
    instead of intermediate states. It's more efficient for functions like sum, max, min, etc.

    Args:
        agg_func: The aggregation function name (e.g., "sum", "max", "anyLast")
        arg_type: The argument type for the function (also the result type)

    Returns:
        An Annotated type with SimpleAggregateFunction metadata

    Example:
        ```python
        from moose_lib import simple_aggregated

        row_count: simple_aggregated("sum", int)
        max_value: simple_aggregated("max", float)
        last_status: simple_aggregated("anyLast", str)
        ```
    """
    return Annotated[
        arg_type, SimpleAggregateFunction(agg_func=agg_func, arg_type=arg_type)
    ]


@dataclasses.dataclass(frozen=True)
class SimpleAggregateFunction:
    agg_func: str
    arg_type: type | GenericAlias | _BaseGenericAlias

    def to_dict(self):
        return {
            "functionName": self.agg_func,
            "argumentType": py_type_to_column_type(self.arg_type, [])[2],
        }


def enum_value_serializer(value: int | str):
    if isinstance(value, int):
        return {"Int": value}
    else:
        return {"String": value}


class EnumValue(BaseModel):
    name: str
    value: Annotated[
        int | str, PlainSerializer(enum_value_serializer, return_type=dict)
    ]


class DataEnum(BaseModel):
    name: str
    values: list[EnumValue]


class Nested(BaseModel):
    name: str
    columns: list["Column"]
    jwt: bool = False


class ArrayType(BaseModel):
    element_type: "DataType"
    element_nullable: bool


class NamedTupleType(BaseModel):
    fields: list[tuple[str, "DataType"]]


class MapType(BaseModel):
    key_type: "DataType"
    value_type: "DataType"


class JsonOptions(BaseModel):
    max_dynamic_paths: int | None = None
    max_dynamic_types: int | None = None
    typed_paths: list[tuple[str, "DataType"]] = []
    skip_paths: list[str] = []
    skip_regexps: list[str] = []


type DataType = (
    str | DataEnum | ArrayType | Nested | NamedTupleType | MapType | JsonOptions
)


def handle_jwt(field_type: type) -> Tuple[bool, type]:
    if hasattr(field_type, "__origin__") and field_type.__origin__ is JWT:
        return True, field_type.__args__[0]  # type: ignore
    return False, field_type


def handle_optional(field_type: type) -> Tuple[bool, type]:
    if hasattr(field_type, "__origin__") and field_type.__origin__ is Union:
        args = field_type.__args__  # type: ignore
        if type(None) in args and len(args) == 2:
            return True, next(t for t in args if t is not type(None))
    return False, field_type


def handle_key(field_type: type) -> Tuple[bool, type]:
    if hasattr(field_type, "__origin__") and field_type.__origin__ is Key:
        return True, field_type.__args__[0]  # type: ignore
    return False, field_type


def handle_annotation(t: type, md: list[Any]) -> Tuple[type, list[Any]]:
    if isinstance(t, TypeAliasType):
        return handle_annotation(t.__value__, md)
    if get_origin(t) is Annotated:
        return handle_annotation(t.__origin__, md + list(t.__metadata__))  # type: ignore
    return t, md


class Column(BaseModel):
    name: str
    data_type: DataType
    required: bool
    unique: Literal[False]
    primary_key: bool
    default: str | None = None
    annotations: list[Tuple[str, Any]] = []
    ttl: str | None = None
    codec: str | None = None
    materialized: str | None = None
    comment: str | None = None

    def to_expr(self):
        # Lazy import to avoid circular dependency at import time
        from .query_builder import ColumnRef

        return ColumnRef(self)

    def __str__(self) -> str:
        """Return properly quoted identifier for SQL interpolation.

        This enables Column objects to be used directly in f-strings and
        string concatenation for SQL query construction.

        Returns:
            Backtick-quoted identifier safe for ClickHouse SQL.

        Example:
            >>> col = Column(name="user_id", ...)
            >>> f"SELECT {col} FROM users"
            "SELECT `user_id` FROM users"
        """
        from .utilities.sql import quote_identifier

        return quote_identifier(self.name)

    def __format__(self, format_spec: str) -> str:
        """Format Column for f-string interpolation with format specifiers.

        Supports format specs:
        - 'col', 'c', 'column': Returns quoted identifier
        - '' (empty): Returns quoted identifier (default)

        Args:
            format_spec: Format specification string

        Returns:
            Backtick-quoted identifier

        Example:
            >>> col = Column(name="email", ...)
            >>> f"SELECT {col:col} FROM users"
            "SELECT `email` FROM users"
        """
        # All format specs return quoted identifier
        # This provides flexibility for user preference
        from .utilities.sql import quote_identifier

        return quote_identifier(self.name)


def _is_point_type(t: type) -> bool:
    origin = get_origin(t)
    if origin is tuple:
        args = get_args(t)
        return len(args) == 2 and all(arg is float for arg in args)
    return False


def _is_list_of(inner_check: Any, t: type) -> bool:
    origin = get_origin(t)
    if origin is list:
        args = get_args(t)
        return len(args) == 1 and inner_check(args[0])
    return False


def _validate_geometry_type(requested: str, t: type) -> None:
    """
    Validates that the provided Python type matches the expected structure
    for the requested geometry annotation.
    """
    match requested:
        case "Point":
            if not _is_point_type(t):
                raise ValueError("Point must be typed as tuple[float, float]")
        case "Ring" | "LineString":
            if not _is_list_of(_is_point_type, t):
                raise ValueError(
                    f"{requested} must be typed as list[tuple[float, float]]"
                )
        case "MultiLineString" | "Polygon":
            if not _is_list_of(lambda x: _is_list_of(_is_point_type, x), t):
                raise ValueError(
                    f"{requested} must be typed as list[list[tuple[float, float]]]"
                )
        case "MultiPolygon":
            if not _is_list_of(
                lambda x: _is_list_of(lambda y: _is_list_of(_is_point_type, y), x),
                t,
            ):
                raise ValueError(
                    "MultiPolygon must be typed as list[list[list[tuple[float, float]]]]"
                )
        case _:
            raise ValueError(f"Unknown geometry type annotation: {requested}")


def py_type_to_column_type(t: type, mds: list[Any]) -> Tuple[bool, list[Any], DataType]:
    # handle Annotated[Optional[Annotated[...], ...]
    t, mds = handle_annotation(t, mds)
    optional, t = handle_optional(t)
    t, mds = handle_annotation(t, mds)

    data_type: DataType

    if t is str:
        # Check for FixedString annotation
        fixed_string_size = next(
            (md.size for md in mds if isinstance(md, ClickhouseFixedStringSize)), None
        )
        if fixed_string_size:
            data_type = f"FixedString({fixed_string_size})"
        else:
            data_type = "String"
    elif t is bytes:
        # Check for FixedString annotation
        fixed_string_size = next(
            (md.size for md in mds if isinstance(md, ClickhouseFixedStringSize)), None
        )
        if fixed_string_size:
            data_type = f"FixedString({fixed_string_size})"
        else:
            # Regular bytes without FixedString annotation
            data_type = "String"
    elif t is int:
        # Check for int size annotations
        int_size = next(
            (md for md in mds if isinstance(md, str) and re.match(r"^u?int\d+$", md)),
            None,
        )
        if int_size:
            data_type = int_size.replace("u", "U").replace("i", "I")
        else:
            data_type = "Int64"
    elif t is float:
        size = next((md for md in mds if isinstance(md, ClickhouseSize)), None)
        if size is None:
            bit_size = next(
                (
                    md
                    for md in mds
                    if isinstance(md, str) and re.match(r"^float\d+$", md)
                ),
                None,
            )
            if bit_size:
                if bit_size == "float32":
                    data_type = "Float32"
                elif bit_size == "float64":
                    data_type = "Float64"
                else:
                    raise ValueError(f'Unsupported float size "{bit_size}"')
            else:
                data_type = "Float64"
        elif size.size == 8:
            data_type = "Float64"
        elif size.size == 4:
            data_type = "Float32"
        else:
            raise ValueError(f"Unsupported float size {size.size}")
    elif t is Decimal:
        precision = next((md.max_digits for md in mds if hasattr(md, "max_digits")), 10)
        scale = next(
            (md.decimal_places for md in mds if hasattr(md, "decimal_places")), 0
        )
        data_type = f"Decimal({precision}, {scale})"
    elif t is bool:
        data_type = "Boolean"
    elif t is datetime:
        precision = next(
            (md for md in mds if isinstance(md, ClickhousePrecision)), None
        )
        if precision is None:
            data_type = "DateTime"
        else:
            data_type = f"DateTime({precision.precision})"
    elif t is date:
        size = next((md for md in mds if isinstance(md, ClickhouseSize)), None)
        if size is None or size.size == 4:
            data_type = "Date"
        elif size.size == 2:
            data_type = "Date16"
        else:
            raise ValueError(f"Unsupported date size {size.size}")
    elif t is ipaddress.IPv4Address:
        data_type = "IPv4"
    elif t is ipaddress.IPv6Address:
        data_type = "IPv6"
    elif any(
        md
        in [  # this check has to happen before t is matched against tuple/list
            "Point",
            "Ring",
            "LineString",
            "MultiLineString",
            "Polygon",
            "MultiPolygon",
        ]
        for md in mds
    ):
        data_type = next(
            md
            for md in mds
            if md
            in [
                "Point",
                "Ring",
                "LineString",
                "MultiLineString",
                "Polygon",
                "MultiPolygon",
            ]
        )
        _validate_geometry_type(data_type, t)
    elif get_origin(t) is list:
        inner_optional, _, inner_type = py_type_to_column_type(get_args(t)[0], [])
        data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
    elif get_origin(t) is dict:
        args = get_args(t)
        if len(args) == 2:
            # Special case: dict[str, Any] should be JSON type (matches TypeScript's Record<string, any>)
            # This is useful for storing arbitrary extra fields in a JSON column
            if args[0] is str and args[1] is Any:
                data_type = "Json"
            else:
                key_optional, _, key_type = py_type_to_column_type(args[0], [])
                value_optional, _, value_type = py_type_to_column_type(args[1], [])
                # For dict types, we assume keys are required and values match their type
                data_type = MapType(key_type=key_type, value_type=value_type)
        else:
            raise ValueError(
                f"Dict type must have exactly 2 type arguments, got {len(args)}"
            )
    elif t is UUID:
        data_type = "UUID"
    elif t is Any:
        data_type = "Json"
    elif any(isinstance(md, ClickHouseJson) for md in mds) and issubclass(t, BaseModel):
        # Annotated[SomePydanticClass, ClickHouseJson(...)]
        columns = _to_columns(t)
        for c in columns:
            if c.default is not None:
                raise ValueError(
                    "Default in inner field. Put ClickHouseDefault in top level field."
                )
        # Enforce extra='allow' for JSON-mapped models
        if t.model_config.get("extra") != "allow":
            raise ValueError(
                f"Model {t.__name__} with ClickHouseJson must have model_config with extra='allow'. "
                "Add: model_config = ConfigDict(extra='allow')"
            )
        opts = next(md for md in mds if isinstance(md, ClickHouseJson))

        # Build typed_paths from fields as tuples of (name, type)
        typed_paths: list[tuple[str, DataType]] = []
        for c in columns:
            typed_paths.append((c.name, c.data_type))

        has_any_option = (
            opts.max_dynamic_paths is not None
            or opts.max_dynamic_types is not None
            or len(typed_paths) > 0
            or len(opts.skip_paths) > 0
            or len(opts.skip_regexps) > 0
        )

        if not has_any_option:
            data_type = "Json"
        else:
            data_type = JsonOptions(
                max_dynamic_paths=opts.max_dynamic_paths,
                max_dynamic_types=opts.max_dynamic_types,
                typed_paths=typed_paths,
                skip_paths=list(opts.skip_paths),
                skip_regexps=list(opts.skip_regexps),
            )
    elif get_origin(t) is Literal and all(isinstance(arg, str) for arg in get_args(t)):
        data_type = "String"
        mds.append("LowCardinality")
    elif not isclass(t):
        raise ValueError(f"Unknown type {t}")
    elif issubclass(t, BaseModel):
        columns = _to_columns(t)
        for c in columns:
            if c.default is not None:
                raise ValueError(
                    "Default in inner field. Put ClickHouseDefault in top level field."
                )
        if any(md == "ClickHouseNamedTuple" for md in mds):
            data_type = NamedTupleType(
                fields=[(column.name, column.data_type) for column in columns],
            )
        else:
            data_type = Nested(
                name=t.__name__,
                columns=columns,
            )
    elif issubclass(t, Enum):
        values = [EnumValue(name=member.name, value=member.value) for member in t]
        data_type = DataEnum(name=t.__name__, values=values)
    else:
        raise ValueError(f"Unknown type {t}")
    return optional, mds, data_type


def _to_columns(model: type[BaseModel]) -> list[Column]:
    """Convert Pydantic model fields to Column definitions."""
    columns = []
    # Get raw annotations from the model class to preserve type aliases
    raw_annotations = getattr(model, "__annotations__", {})

    for field_name, field_info in model.model_fields.items():
        # Use raw annotation if available (preserves type aliases and their metadata)
        # Fall back to field_info.annotation if not found in __annotations__
        field_type = raw_annotations.get(field_name, field_info.annotation)
        if field_type is None:
            raise ValueError(f"Missing type for {field_name}")
        primary_key, field_type = handle_key(field_type)
        is_jwt, field_type = handle_jwt(field_type)

        optional, mds, data_type = py_type_to_column_type(
            field_type, field_info.metadata
        )

        annotations = []
        for md in mds:
            if isinstance(md, AggregateFunction) and all(
                key != "aggregationFunction" for (key, _) in annotations
            ):
                annotations.append(("aggregationFunction", md.to_dict()))
            if isinstance(md, SimpleAggregateFunction) and all(
                key != "simpleAggregationFunction" for (key, _) in annotations
            ):
                annotations.append(("simpleAggregationFunction", md.to_dict()))
            if md == "LowCardinality" and all(
                key != "LowCardinality" for (key, _) in annotations
            ):
                annotations.append(("LowCardinality", True))

        column_name = field_name if field_info.alias is None else field_info.alias

        # Extract default expression from metadata, if provided
        default_expr = next(
            (md.expression for md in mds if isinstance(md, ClickhouseDefault)),
            None,
        )

        # Extract MATERIALIZED expression from metadata, if provided
        materialized_expr = next(
            (md.expression for md in mds if isinstance(md, ClickHouseMaterialized)),
            None,
        )

        # Validate mutual exclusivity of DEFAULT and MATERIALIZED
        if default_expr and materialized_expr:
            raise ValueError(
                f"Column '{column_name}' cannot have both DEFAULT and MATERIALIZED. "
                f"Use one or the other."
            )

        # Extract TTL expression from metadata, if provided
        ttl_expr = next(
            (md.expression for md in mds if isinstance(md, ClickHouseTTL)),
            None,
        )

        # Extract CODEC expression from metadata, if provided
        codec_expr = next(
            (md.expression for md in mds if isinstance(md, ClickHouseCodec)),
            None,
        )

        # Extract description from Pydantic Field (supports both Field(description=...)
        # and attribute docstrings with use_attribute_docstrings=True)
        comment = field_info.description

        columns.append(
            Column(
                name=column_name,
                data_type=data_type,
                required=not optional,
                unique=False,
                primary_key=primary_key,
                default=default_expr,
                materialized=materialized_expr,
                annotations=annotations,
                ttl=ttl_expr,
                codec=codec_expr,
                comment=comment,
            )
        )
    return columns


class StringToEnumMixin:
    @classmethod
    def __get_pydantic_core_schema__(
        cls, _source_type: Any, _handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        def validate(value: Any, _: Any) -> Any:
            if isinstance(value, str):
                try:
                    return cls[value]
                except KeyError:
                    raise ValueError(f"Invalid enum name: {value}")
            return cls(value)  # fallback to default enum validation

        return core_schema.with_info_before_validator_function(
            validate, core_schema.enum_schema(cls, list(cls))
        )


def is_array_nested_type(data_type: DataType) -> bool:
    """Type guard to check if a data type is Array(Nested(...))."""
    return isinstance(data_type, ArrayType) and isinstance(
        data_type.element_type, Nested
    )


def is_nested_type(data_type: DataType) -> bool:
    """Type guard to check if a data type is Nested (not Array)."""
    return isinstance(data_type, Nested)
