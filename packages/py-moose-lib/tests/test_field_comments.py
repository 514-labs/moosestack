"""Tests for TSDoc-style field comment extraction from Pydantic models."""

from pydantic import BaseModel, Field, ConfigDict
from moose_lib import Key
from moose_lib.data_models import _to_columns


def test_field_description_basic():
    """Test basic Field(description=...) extraction."""

    class DescriptionTest(BaseModel):
        user_id: str = Field(description="Unique identifier for the user")
        email: str = Field(description="User's email address")
        name: str  # No description

    columns = _to_columns(DescriptionTest)
    by_name = {col.name: col for col in columns}

    assert by_name["user_id"].comment == "Unique identifier for the user"
    assert by_name["email"].comment == "User's email address"
    assert by_name["name"].comment is None


def test_field_description_with_key():
    """Test Field(description=...) works with Key type."""

    class KeyDescriptionTest(BaseModel):
        id: Key[str] = Field(description="Primary key identifier")
        value: int = Field(description="The value")

    columns = _to_columns(KeyDescriptionTest)
    by_name = {col.name: col for col in columns}

    assert by_name["id"].comment == "Primary key identifier"
    assert by_name["id"].primary_key is True
    assert by_name["value"].comment == "The value"


def test_field_description_with_special_characters():
    """Test Field(description=...) with special characters."""

    class SpecialCharsTest(BaseModel):
        email: str = Field(description="User's email (must be valid)")
        price: float = Field(description="Price in USD ($)")
        query: str = Field(description='Contains "quoted" text')
        sql: str = Field(description="SQL: SELECT * FROM users WHERE id = 1")

    columns = _to_columns(SpecialCharsTest)
    by_name = {col.name: col for col in columns}

    assert by_name["email"].comment == "User's email (must be valid)"
    assert by_name["price"].comment == "Price in USD ($)"
    assert by_name["query"].comment == 'Contains "quoted" text'
    assert by_name["sql"].comment == "SQL: SELECT * FROM users WHERE id = 1"


def test_attribute_docstrings():
    """Test attribute docstrings with use_attribute_docstrings=True."""

    class DocstringTest(BaseModel):
        model_config = ConfigDict(use_attribute_docstrings=True)

        user_id: str
        """Unique identifier for the user."""

        email: str
        """User's email address."""

        name: str  # No docstring

    columns = _to_columns(DocstringTest)
    by_name = {col.name: col for col in columns}

    assert by_name["user_id"].comment == "Unique identifier for the user."
    assert by_name["email"].comment == "User's email address."
    assert by_name["name"].comment is None


def test_mixed_description_sources():
    """Test that both Field(description=...) and attribute docstrings work together."""

    class MixedTest(BaseModel):
        model_config = ConfigDict(use_attribute_docstrings=True)

        # Using Field(description=...)
        field_desc: str = Field(description="From Field()")

        # Using attribute docstring
        docstring_desc: str
        """From docstring."""

        # No description at all
        no_desc: int

    columns = _to_columns(MixedTest)
    by_name = {col.name: col for col in columns}

    assert by_name["field_desc"].comment == "From Field()"
    assert by_name["docstring_desc"].comment == "From docstring."
    assert by_name["no_desc"].comment is None


def test_field_description_preserved_with_other_metadata():
    """Test that descriptions work alongside other column metadata."""
    from typing import Annotated
    from moose_lib import ClickHouseCodec, clickhouse_default

    class MetadataTest(BaseModel):
        id: Key[str] = Field(description="Primary key")
        timestamp: Annotated[str, clickhouse_default("now()")] = Field(
            description="When created"
        )
        payload: Annotated[str, ClickHouseCodec("ZSTD(3)")] = Field(
            description="Compressed data"
        )

    columns = _to_columns(MetadataTest)
    by_name = {col.name: col for col in columns}

    # Comments are preserved
    assert by_name["id"].comment == "Primary key"
    assert by_name["timestamp"].comment == "When created"
    assert by_name["payload"].comment == "Compressed data"

    # Other metadata still works
    assert by_name["id"].primary_key is True
    assert by_name["timestamp"].default == "now()"
    assert by_name["payload"].codec == "ZSTD(3)"
