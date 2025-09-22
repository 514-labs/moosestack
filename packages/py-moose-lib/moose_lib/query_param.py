import dataclasses
from dataclasses import dataclass, fields, is_dataclass
from datetime import datetime
from typing import Optional, Union, Any
import inspect

from pydantic import BaseModel
from .data_models import DataEnum, py_type_to_column_type, ArrayType as DataModelArrayType

scalar_types = Union[str, DataEnum]


@dataclass
class ArrayType:
    element_type: scalar_types


@dataclass
class QueryField:
    name: str
    data_type: Union[scalar_types, ArrayType]
    has_default: bool
    required: bool


def to_scalar_type(t: type) -> scalar_types:
    optional, mds, data_type = py_type_to_column_type(t, [])

    # Check if the result is a scalar type (str or DataEnum)
    if isinstance(data_type, str) or isinstance(data_type, DataEnum):
        return data_type
    else:
        raise ValueError(f"Type {t} maps to non-scalar ClickHouse type: {data_type}")


def unwrap_optional(union_type):
    return Union[*[arg for arg in union_type.__args__ if arg is not type(None)]]


# dmV1 code, won't upgrade to include the rich types
def parse_scalar_value(value: str, t: scalar_types) -> Any:
    match t:
        case 'String':
            return value
        case 'Int':
            return int(value)
        case 'Float' | 'Float64' | 'Float32':
            return float(value)
        case 'Boolean':
            value_lower = value.lower()
            if value_lower not in ('true', 'false'):
                raise ValueError(f"Boolean value must be 'true' or 'false', got: {value}")
            return value_lower == 'true'
        case 'DateTime':
            return datetime.fromisoformat(value)
        case _:
            # enum parsing will not be added to dmV1 code
            return value


def convert_pydantic_definition(cls: type) -> list[QueryField]:
    """Convert a Pydantic model into a list of QueryField definitions."""
    if not issubclass(cls, BaseModel):
        raise ValueError(f"Input {cls.__name__} must be a Pydantic model")
    fields_list = []
    for field_name, field_def in cls.model_fields.items():
        field_type = field_def.annotation
        if field_type is None:
            raise ValueError(f"Missing type for {field_name}")
        no_default = field_def.is_required()
        required = no_default

        if hasattr(field_type, "__origin__"):
            if field_type.__origin__ is Union:  # type: ignore
                field_type = unwrap_optional(field_type)
                required = False
            elif field_type.__origin__ is list:  # type: ignore
                element_type = field_type.__args__[0]  # type: ignore
                scala_type = to_scalar_type(element_type)
                fields_list.append(
                    QueryField(field_name, ArrayType(scala_type), has_default=not no_default, required=required))
                continue

        scala_type = to_scalar_type(field_type)
        fields_list.append(QueryField(field_name, scala_type, has_default=not no_default, required=required))

    return fields_list


def convert_dataclass_definition(cls: type) -> list[QueryField]:
    """Convert a dataclass into a list of QueryField definitions."""
    if not is_dataclass(cls):
        raise ValueError(f"Input {cls.__name__} must be a dataclass")
    fields_list = []
    for field_def in fields(cls):
        field_name = field_def.name
        field_type = field_def.type

        # Handle Optional types
        # Field is not required if it has a default value or is Optional
        no_default = field_def.default == field_def.default_factory == dataclasses.MISSING
        required = no_default

        if hasattr(field_type, "__origin__"):
            if field_type.__origin__ is Union:
                field_type = unwrap_optional(field_type)
                required = False
            elif field_type.__origin__ is list:
                element_type = field_type.__args__[0]  # type: ignore
                scala_type = to_scalar_type(element_type)
                fields_list.append(
                    QueryField(field_name, ArrayType(scala_type), has_default=not no_default, required=required))
                continue

        scala_type = to_scalar_type(field_type)
        fields_list.append(QueryField(field_name, scala_type, has_default=not no_default, required=required))

    return fields_list


def convert_api_param(module) -> Optional[tuple[type, list[QueryField]]]:
    run_func = module.run
    params_arg = inspect.getfullargspec(run_func).args[1]
    param_class: type = run_func.__annotations__.get(params_arg)
    if not param_class:
        return None
    if is_dataclass(param_class):
        query_fields = convert_dataclass_definition(param_class)
    elif issubclass(param_class, BaseModel):
        query_fields = convert_pydantic_definition(param_class)
    else:
        raise ValueError(f"{param_class.__name__} is neither a Pydantic model or a dataclass")
    return param_class, query_fields


def map_params_to_class(
        params: dict[str, list[str]],
        field_def_list: list[QueryField],
        cls: type,
) -> Any:
    # Initialize an empty dict for the constructor arguments
    constructor_args: dict[str, Any] = {}

    def parse(param: str, t: scalar_types) -> Any:
        if issubclass(cls, BaseModel):
            return param  # let pydantic handle the conversion
        elif is_dataclass(cls):
            return parse_scalar_value(param, t)
        else:
            raise ValueError(f"{cls.__name__} is neither a Pydantic model or a dataclass")

    # Get field definitions from the dataclass
    for field_def in field_def_list:
        field_name = field_def.name
        field_type = field_def.data_type

        if field_name not in params:
            if field_def.has_default:
                pass  # default will take effect
            elif isinstance(field_type, ArrayType):
                constructor_args[field_name] = []
            else:
                constructor_args[field_name] = None
            continue

        # Get the value(s) from the params list
        values = params[field_name]

        if isinstance(field_type, ArrayType):
            constructor_args[field_name] = [parse(v, field_type.element_type) for v in values]
        else:
            if len(values) != 1:
                raise ValueError(f"Expected a single element for {field_name}")
            [v] = values
            constructor_args[field_name] = parse(v, field_type)
    return cls(**constructor_args)
