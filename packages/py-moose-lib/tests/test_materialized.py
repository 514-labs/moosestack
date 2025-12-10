from datetime import datetime, date
from typing import Annotated, Any
from pydantic import BaseModel
from moose_lib import Key, ClickHouseMaterialized, ClickHouseCodec, UInt64
from moose_lib.data_models import _to_columns
import pytest


def test_materialized_basic():
    """Test basic MATERIALIZED annotation converts to correct expression."""

    class MaterializedTest(BaseModel):
        timestamp: datetime
        event_date: Annotated[date, ClickHouseMaterialized("toDate(timestamp)")]

    columns = _to_columns(MaterializedTest)
    by_name = {col.name: col for col in columns}

    assert by_name["timestamp"].materialized is None
    assert by_name["event_date"].materialized == "toDate(timestamp)"


def test_materialized_hash():
    """Test MATERIALIZED with hash function."""

    class HashTest(BaseModel):
        user_id: str
        user_hash: Annotated[UInt64, ClickHouseMaterialized("cityHash64(user_id)")]

    columns = _to_columns(HashTest)
    by_name = {col.name: col for col in columns}

    assert by_name["user_id"].materialized is None
    assert by_name["user_hash"].materialized == "cityHash64(user_id)"


def test_materialized_with_codec():
    """Test MATERIALIZED combined with CODEC."""

    class MaterializedCodecTest(BaseModel):
        log_blob: Annotated[Any, ClickHouseCodec("ZSTD(3)")]
        combination_hash: Annotated[
            list[UInt64],
            ClickHouseMaterialized(
                "arrayMap(kv -> cityHash64(kv.1, kv.2), JSONExtractKeysAndValuesRaw(toString(log_blob)))"
            ),
            ClickHouseCodec("ZSTD(1)"),
        ]

    columns = _to_columns(MaterializedCodecTest)
    by_name = {col.name: col for col in columns}

    assert by_name["log_blob"].materialized is None
    assert by_name["log_blob"].codec == "ZSTD(3)"
    assert (
        by_name["combination_hash"].materialized
        == "arrayMap(kv -> cityHash64(kv.1, kv.2), JSONExtractKeysAndValuesRaw(toString(log_blob)))"
    )
    assert by_name["combination_hash"].codec == "ZSTD(1)"


def test_materialized_mutually_exclusive_with_default():
    """Test that MATERIALIZED and DEFAULT are mutually exclusive."""
    from moose_lib import clickhouse_default

    class BadModel(BaseModel):
        bad_field: Annotated[
            str,
            clickhouse_default("'default_value'"),
            ClickHouseMaterialized("'materialized_value'"),
        ]

    with pytest.raises(ValueError, match="cannot have both DEFAULT and MATERIALIZED"):
        _to_columns(BadModel)
