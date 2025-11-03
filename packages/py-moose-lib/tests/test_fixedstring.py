from datetime import datetime
from typing import Annotated
from pydantic import BaseModel
from moose_lib import Key, FixedString
from moose_lib.data_models import _to_columns


def test_fixedstring_annotation():
    """Test FixedString annotation converts to correct ClickHouse type."""

    class BinaryDataTest(BaseModel):
        id: Key[str]
        created_at: datetime
        md5_hash: Annotated[bytes, FixedString(16)]
        sha256_hash: Annotated[bytes, FixedString(32)]
        ipv6_address: Annotated[bytes, FixedString(16)]

    columns = _to_columns(BinaryDataTest)
    by_name = {col.name: col for col in columns}

    assert by_name["md5_hash"].data_type == "FixedString(16)"
    assert by_name["sha256_hash"].data_type == "FixedString(32)"
    assert by_name["ipv6_address"].data_type == "FixedString(16)"

    # Verify other fields still work
    assert by_name["id"].data_type == "String"
    assert by_name["created_at"].data_type == "DateTime"


def test_fixedstring_different_sizes():
    """Test various FixedString sizes."""

    class FixedStringSizes(BaseModel):
        mac_address: Annotated[bytes, FixedString(6)]
        uuid_binary: Annotated[bytes, FixedString(16)]
        sha512_hash: Annotated[bytes, FixedString(64)]

    columns = _to_columns(FixedStringSizes)
    by_name = {col.name: col for col in columns}

    assert by_name["mac_address"].data_type == "FixedString(6)"
    assert by_name["uuid_binary"].data_type == "FixedString(16)"
    assert by_name["sha512_hash"].data_type == "FixedString(64)"
