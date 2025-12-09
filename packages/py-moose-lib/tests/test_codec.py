from datetime import datetime
from typing import Annotated, Any
from pydantic import BaseModel
from moose_lib import Key, ClickHouseCodec, UInt64
from moose_lib.data_models import _to_columns


def test_codec_single():
    """Test single codec annotation converts to correct ClickHouse CODEC."""

    class CodecTest(BaseModel):
        id: Key[str]
        data: Annotated[str, ClickHouseCodec("ZSTD(3)")]

    columns = _to_columns(CodecTest)
    by_name = {col.name: col for col in columns}

    assert by_name["data"].codec == "ZSTD(3)"
    assert by_name["id"].codec is None


def test_codec_chain():
    """Test codec chain annotation (Delta, LZ4)."""

    class CodecChainTest(BaseModel):
        timestamp: Annotated[datetime, ClickHouseCodec("Delta, LZ4")]
        value: Annotated[float, ClickHouseCodec("Gorilla, ZSTD")]

    columns = _to_columns(CodecChainTest)
    by_name = {col.name: col for col in columns}

    assert by_name["timestamp"].codec == "Delta, LZ4"
    assert by_name["value"].codec == "Gorilla, ZSTD"


def test_codec_with_level():
    """Test codec with compression level."""

    class CodecLevelTest(BaseModel):
        log_blob: Annotated[Any, ClickHouseCodec("ZSTD(3)")]
        combination_hash: Annotated[list[UInt64], ClickHouseCodec("ZSTD(1)")]

    columns = _to_columns(CodecLevelTest)
    by_name = {col.name: col for col in columns}

    assert by_name["log_blob"].codec == "ZSTD(3)"
    assert by_name["combination_hash"].codec == "ZSTD(1)"


def test_codec_specialized():
    """Test specialized codecs."""

    class SpecializedCodecTest(BaseModel):
        timestamp: Annotated[datetime, ClickHouseCodec("Delta")]
        counter: Annotated[int, ClickHouseCodec("DoubleDelta")]
        temperature: Annotated[float, ClickHouseCodec("Gorilla")]

    columns = _to_columns(SpecializedCodecTest)
    by_name = {col.name: col for col in columns}

    assert by_name["timestamp"].codec == "Delta"
    assert by_name["counter"].codec == "DoubleDelta"
    assert by_name["temperature"].codec == "Gorilla"


def test_codec_none():
    """Test codec with NONE (uncompressed)."""

    class NoCodecTest(BaseModel):
        data: Annotated[str, ClickHouseCodec("NONE")]

    columns = _to_columns(NoCodecTest)
    by_name = {col.name: col for col in columns}

    assert by_name["data"].codec == "NONE"
