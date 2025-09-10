import dataclasses
from decimal import Decimal
import re
from enum import Enum
from inspect import isclass
from uuid import UUID
from datetime import datetime, date

from typing import Literal, Tuple, Union, Any, get_origin, get_args, TypeAliasType, Annotated, Type, _BaseGenericAlias, \
    GenericAlias, NewType, List
from pydantic import BaseModel, Field, PlainSerializer, GetCoreSchemaHandler, ConfigDict
from pydantic_core import CoreSchema, core_schema
import ipaddress

type Key[T: (str, int)] = T
type JWT[T] = T

# ClickHouse Geo Types (requires ClickHouse 25.6+ with experimental geo types enabled)
Point = NewType("Point", Tuple[float, float])  # (longitude, latitude)
Ring = NewType("Ring", List[Point])  # Closed polygon boundary (no holes)
LineString = NewType("LineString", List[Point])  # Open polyline
Polygon = NewType("Polygon", List[Ring])  # First ring is outer, others are holes
MultiLineString = NewType("MultiLineString", List[LineString])
MultiPolygon = NewType("MultiPolygon", List[Polygon])


@dataclasses.dataclass  # a BaseModel in the annotations will confuse pydantic
class ClickhousePrecision:
    precision: int


@dataclasses.dataclass
class ClickhouseSize:
    size: int


@dataclasses.dataclass
class ClickhouseDefault:
    expression: str


def clickhouse_default(expression: str) -> ClickhouseDefault:
    return ClickhouseDefault(expression=expression)


def clickhouse_decimal(precision: int, scale: int) -> Type[Decimal]:
    return Annotated[Decimal, Field(max_digits=precision, decimal_places=scale)]


def clickhouse_datetime64(precision: int) -> Type[datetime]:
    """
    Instructs Moose to create field as DateTime64(precision)
    However in Python the value still have microsecond precision at most,
    even if you write `timestamp: clickhouse_datetime64(9)
    """
    return Annotated[datetime, ClickhousePrecision(precision=precision)]


def aggregated[T](
        result_type: Type[T],
        agg_func: str,
        param_types: list[type | GenericAlias | _BaseGenericAlias]
) -> Type[T]:
    return Annotated[result_type, AggregateFunction(agg_func=agg_func, param_types=param_types)]


@dataclasses.dataclass
class AggregateFunction:
    agg_func: str
    param_types: list[type | GenericAlias | _BaseGenericAlias]

    def to_dict(self):
        return {
            "functionName": self.agg_func,
            "argumentTypes": [
                py_type_to_column_type(t, [])[2] for t in self.param_types
            ]
        }


def enum_value_serializer(value: int | str):
    if isinstance(value, int):
        return {"Int": value}
    else:
        return {"String": value}


class EnumValue(BaseModel):
    name: str
    value: Annotated[int | str, PlainSerializer(enum_value_serializer, return_type=dict)]


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


type DataType = str | DataEnum | ArrayType | Nested | NamedTupleType | MapType


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


def py_type_to_column_type(t: type, mds: list[Any]) -> Tuple[bool, list[Any], DataType]:
    # handle Annotated[Optional[Annotated[...], ...]
    t, mds = handle_annotation(t, mds)
    optional, t = handle_optional(t)
    t, mds = handle_annotation(t, mds)

    data_type: DataType

    # Check for geo NewTypes first
    if hasattr(t, '__supertype__'):  # NewType check
        newtype_name = getattr(t, '__name__', '')
        if newtype_name == 'Point':
            data_type = "Point"
        elif newtype_name == 'Ring':
            data_type = "Ring"
        elif newtype_name == 'LineString':
            data_type = "LineString"
        elif newtype_name == 'Polygon':
            data_type = "Polygon"
        elif newtype_name == 'MultiLineString':
            data_type = "MultiLineString"
        elif newtype_name == 'MultiPolygon':
            data_type = "MultiPolygon"
        else:
            # Handle other NewTypes by recursing on the supertype
            return py_type_to_column_type(t.__supertype__, mds)
    elif t is str:
        data_type = "String"
    elif t is int:
        # Check for int size annotations
        int_size = next((md for md in mds if isinstance(md, str) and re.match(r'^u?int\d+$', md)), None)
        if int_size:
            data_type = int_size.replace("u", "U").replace("i", "I")
        else:
            data_type = "Int"
    elif t is float:
        size = next((md for md in mds if isinstance(md, ClickhouseSize)), None)
        if size is None or size.size == 8:
            data_type = "Float64"
        elif size.size == 4:
            data_type = "Float32"
        else:
            raise ValueError(f"Unsupported float size {size.size}")
    elif t is Decimal:
        precision = next((md.max_digits for md in mds if hasattr(md, "max_digits")), 10)
        scale = next((md.decimal_places for md in mds if hasattr(md, "decimal_places")), 0)
        data_type = f"Decimal({precision}, {scale})"
    elif t is bool:
        data_type = "Boolean"
    elif t is datetime:
        precision = next((md for md in mds if isinstance(md, ClickhousePrecision)), None)
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
    elif get_origin(t) is list:
        args = get_args(t)
        if args:
            inner_type_raw = args[0]
            # Check for geo type structural patterns
            if get_origin(inner_type_raw) is tuple:
                tuple_args = get_args(inner_type_raw)
                if len(tuple_args) == 2 and all(arg is float for arg in tuple_args):
                    # List[Tuple[float, float]] -> LineString (default, use Ring NewType for ring)
                    data_type = "LineString"
                else:
                    # Regular array
                    inner_optional, _, inner_type = py_type_to_column_type(inner_type_raw, [])
                    data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
            elif get_origin(inner_type_raw) is list:
                # Check for nested list patterns
                inner_args = get_args(inner_type_raw)
                if inner_args:
                    inner_inner_type = inner_args[0]
                    if get_origin(inner_inner_type) is tuple:
                        tuple_args = get_args(inner_inner_type)
                        if len(tuple_args) == 2 and all(arg is float for arg in tuple_args):
                            # List[List[Tuple[float, float]]] -> Polygon (default, use MultiLineString NewType if needed)
                            data_type = "Polygon"
                        else:
                            # Regular nested array
                            inner_optional, _, inner_type = py_type_to_column_type(inner_type_raw, [])
                            data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
                    elif get_origin(inner_inner_type) is list:
                        # Check for triple-nested list
                        inner_inner_args = get_args(inner_inner_type)
                        if inner_inner_args:
                            triple_inner_type = inner_inner_args[0]
                            if get_origin(triple_inner_type) is tuple:
                                tuple_args = get_args(triple_inner_type)
                                if len(tuple_args) == 2 and all(arg is float for arg in tuple_args):
                                    # List[List[List[Tuple[float, float]]]] -> MultiPolygon
                                    data_type = "MultiPolygon"
                                else:
                                    # Regular triple-nested array
                                    inner_optional, _, inner_type = py_type_to_column_type(inner_type_raw, [])
                                    data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
                            else:
                                # Regular triple-nested array
                                inner_optional, _, inner_type = py_type_to_column_type(inner_type_raw, [])
                                data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
                        else:
                            # Regular nested array
                            inner_optional, _, inner_type = py_type_to_column_type(inner_type_raw, [])
                            data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
                    else:
                        # Regular nested array
                        inner_optional, _, inner_type = py_type_to_column_type(inner_type_raw, [])
                        data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
                else:
                    # Regular nested array
                    inner_optional, _, inner_type = py_type_to_column_type(inner_type_raw, [])
                    data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
            else:
                # Regular array
                inner_optional, _, inner_type = py_type_to_column_type(inner_type_raw, [])
                data_type = ArrayType(element_type=inner_type, element_nullable=inner_optional)
        else:
            raise ValueError("List type must have a type argument")
    elif get_origin(t) is dict:
        args = get_args(t)
        if len(args) == 2:
            key_optional, _, key_type = py_type_to_column_type(args[0], [])
            value_optional, _, value_type = py_type_to_column_type(args[1], [])
            # For dict types, we assume keys are required and values match their type
            data_type = MapType(key_type=key_type, value_type=value_type)
        else:
            raise ValueError(f"Dict type must have exactly 2 type arguments, got {len(args)}")
    # Structural fallback for geo types (when users don't use NewTypes)
    elif get_origin(t) is tuple:
        args = get_args(t)
        if len(args) == 2 and all(arg is float for arg in args):
            # Tuple[float, float] -> Point
            data_type = "Point"
        else:
            # Other tuples are not geo types
            raise ValueError(f"Unsupported tuple type: {t}")
    elif t is UUID:
        data_type = "UUID"
    elif t is Any:
        data_type = "Json"
    elif get_origin(t) is Literal and all(isinstance(arg, str) for arg in get_args(t)):
        data_type = "String"
        mds.append("LowCardinality")
    elif not isclass(t):
        raise ValueError(f"Unknown type {t}")
    elif issubclass(t, BaseModel):
        if any(md == "ClickHouseNamedTuple" for md in mds):
            data_type = NamedTupleType(
                fields=[(
                    column.name,
                    column.data_type
                ) for column in _to_columns(t)],
            )
        else:
            data_type = Nested(
                name=t.__name__,
                columns=_to_columns(t),
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
    for field_name, field_info in model.model_fields.items():
        # Get the field type annotation
        field_type = field_info.annotation
        if field_type is None:
            raise ValueError(f"Missing type for {field_name}")
        primary_key, field_type = handle_key(field_type)
        is_jwt, field_type = handle_jwt(field_type)

        optional, mds, data_type = py_type_to_column_type(field_type, field_info.metadata)

        annotations = []
        for md in mds:
            if isinstance(md, AggregateFunction):
                annotations.append(
                    ("aggregationFunction", md.to_dict())
                )
            if md == "LowCardinality":
                annotations.append(
                    ("LowCardinality", True)
                )

        column_name = field_name if field_info.alias is None else field_info.alias

        # Extract default expression from metadata, if provided
        default_expr = next(
            (md.expression for md in mds if isinstance(md, ClickhouseDefault)),
            None,
        )

        columns.append(
            Column(
                name=column_name,
                data_type=data_type,
                required=not optional,
                unique=False,
                primary_key=primary_key,
                default=default_expr,
                annotations=annotations,
            )
        )
    return columns


class StringToEnumMixin:
    @classmethod
    def __get_pydantic_core_schema__(cls, _source_type: Any, _handler: GetCoreSchemaHandler) -> CoreSchema:
        def validate(value: Any, _: Any) -> Any:
            if isinstance(value, str):
                try:
                    return cls[value]
                except KeyError:
                    raise ValueError(f"Invalid enum name: {value}")
            return cls(value)  # fallback to default enum validation

        return core_schema.with_info_before_validator_function(validate, core_schema.enum_schema(cls, list(cls)))


def is_array_nested_type(data_type: DataType) -> bool:
    """Type guard to check if a data type is Array(Nested(...))."""
    return (
            isinstance(data_type, ArrayType) and
            isinstance(data_type.element_type, Nested)
    )


def is_nested_type(data_type: DataType) -> bool:
    """Type guard to check if a data type is Nested (not Array)."""
    return isinstance(data_type, Nested)
