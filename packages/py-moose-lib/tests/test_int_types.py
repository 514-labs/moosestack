from datetime import datetime
from typing import Annotated
from pydantic import BaseModel
from moose_lib import (
    Key,
    Int8,
    Int16,
    Int32,
    Int64,
    UInt8,
    UInt16,
    UInt32,
    UInt64,
    Float32,
    Float64,
)
from moose_lib.data_models import _to_columns


def test_integer_type_aliases():
    """Test that integer type aliases convert to correct ClickHouse types."""

    class IntegerTypesTest(BaseModel):
        id: Key[str]
        created_at: datetime
        tiny_int: Int8
        small_int: Int16
        medium_int: Int32
        big_int: Int64
        tiny_uint: UInt8
        small_uint: UInt16
        medium_uint: UInt32
        big_uint: UInt64

    columns = _to_columns(IntegerTypesTest)
    by_name = {col.name: col for col in columns}

    # Verify signed integer types
    assert by_name["tiny_int"].data_type == "Int8"
    assert by_name["small_int"].data_type == "Int16"
    assert by_name["medium_int"].data_type == "Int32"
    assert by_name["big_int"].data_type == "Int64"

    # Verify unsigned integer types
    assert by_name["tiny_uint"].data_type == "UInt8"
    assert by_name["small_uint"].data_type == "UInt16"
    assert by_name["medium_uint"].data_type == "UInt32"
    assert by_name["big_uint"].data_type == "UInt64"

    # Verify other fields still work
    assert by_name["id"].data_type == "String"
    assert by_name["created_at"].data_type == "DateTime"


def test_float_type_aliases():
    """Test that float type aliases convert to correct ClickHouse types."""

    class FloatTypesTest(BaseModel):
        id: Key[str]
        precision_float: Float32
        double_precision_float: Float64

    columns = _to_columns(FloatTypesTest)
    by_name = {col.name: col for col in columns}

    assert by_name["precision_float"].data_type == "Float32"
    assert by_name["double_precision_float"].data_type == "Float64"
    assert by_name["id"].data_type == "String"


def test_combined_numeric_types():
    """Test combining integer and float types in a single model."""

    class NumericTypesTest(BaseModel):
        user_id: UInt64
        age: UInt8
        score: Int32
        latitude: Float64
        longitude: Float64
        precision_value: Float32

    columns = _to_columns(NumericTypesTest)
    by_name = {col.name: col for col in columns}

    assert by_name["user_id"].data_type == "UInt64"
    assert by_name["age"].data_type == "UInt8"
    assert by_name["score"].data_type == "Int32"
    assert by_name["latitude"].data_type == "Float64"
    assert by_name["longitude"].data_type == "Float64"
    assert by_name["precision_value"].data_type == "Float32"


def test_integer_types_as_keys():
    """Test that integer types can be used as primary keys."""

    class IntegerKeyTest(BaseModel):
        user_id: Key[UInt64]
        event_id: Key[Int64]
        name: str

    columns = _to_columns(IntegerKeyTest)
    by_name = {col.name: col for col in columns}

    assert by_name["user_id"].data_type == "UInt64"
    assert by_name["user_id"].primary_key is True
    assert by_name["event_id"].data_type == "Int64"
    assert by_name["event_id"].primary_key is True
    assert by_name["name"].data_type == "String"


def test_optional_integer_types():
    """Test that optional integer types work correctly."""
    from typing import Optional

    class OptionalIntTest(BaseModel):
        required_count: UInt32
        optional_count: Optional[UInt32]
        optional_score: Optional[Int16]

    columns = _to_columns(OptionalIntTest)
    by_name = {col.name: col for col in columns}

    assert by_name["required_count"].data_type == "UInt32"
    assert by_name["required_count"].required is True

    assert by_name["optional_count"].data_type == "UInt32"
    assert by_name["optional_count"].required is False

    assert by_name["optional_score"].data_type == "Int16"
    assert by_name["optional_score"].required is False


def test_uint_common_use_cases():
    """Test common use cases for unsigned integers."""

    class CommonUIntUseCases(BaseModel):
        # User/entity IDs (always positive)
        user_id: UInt64
        # Counters (always positive or zero)
        page_views: UInt32
        click_count: UInt32
        # Small enums/flags (0-255)
        status_code: UInt8
        # Port numbers (0-65535)
        port: UInt16
        # Timestamps as unix epoch
        timestamp: UInt64

    columns = _to_columns(CommonUIntUseCases)
    by_name = {col.name: col for col in columns}

    assert by_name["user_id"].data_type == "UInt64"
    assert by_name["page_views"].data_type == "UInt32"
    assert by_name["click_count"].data_type == "UInt32"
    assert by_name["status_code"].data_type == "UInt8"
    assert by_name["port"].data_type == "UInt16"
    assert by_name["timestamp"].data_type == "UInt64"


def test_int_common_use_cases():
    """Test common use cases for signed integers."""

    class CommonIntUseCases(BaseModel):
        # Temperature (can be negative)
        temperature: Int16
        # Financial amounts (can be negative for debits)
        balance: Int64
        # Deltas/differences
        delta: Int32
        # Small range values
        offset: Int8

    columns = _to_columns(CommonIntUseCases)
    by_name = {col.name: col for col in columns}

    assert by_name["temperature"].data_type == "Int16"
    assert by_name["balance"].data_type == "Int64"
    assert by_name["delta"].data_type == "Int32"
    assert by_name["offset"].data_type == "Int8"


def test_default_int_still_works():
    """Test that plain int without type annotation still works as before."""

    class PlainIntTest(BaseModel):
        plain_int: int
        typed_int: UInt32

    columns = _to_columns(PlainIntTest)
    by_name = {col.name: col for col in columns}

    # Plain int should still map to "Int" (default behavior)
    assert by_name["plain_int"].data_type == "Int64"
    # Typed int should map to specific type
    assert by_name["typed_int"].data_type == "UInt32"


def test_default_float_still_works():
    """Test that plain float without type annotation still works as before."""

    class PlainFloatTest(BaseModel):
        plain_float: float
        typed_float: Float32

    columns = _to_columns(PlainFloatTest)
    by_name = {col.name: col for col in columns}

    # Plain float should still map to "Float64" (default behavior)
    assert by_name["plain_float"].data_type == "Float64"
    # Typed float should map to specific type
    assert by_name["typed_float"].data_type == "Float32"
