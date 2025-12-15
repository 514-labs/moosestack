import pytest
from moose_lib import OlapTable, OlapConfig
from moose_lib.blocks import IcebergS3Engine
from pydantic import BaseModel


class SampleData(BaseModel):
    id: str
    name: str
    value: int


def test_iceberg_engine_basic_creation():
    """Test basic IcebergS3Engine creation with required fields"""
    engine = IcebergS3Engine(path="s3://bucket/warehouse/table/", format="Parquet")
    assert engine.path == "s3://bucket/warehouse/table/"
    assert engine.format == "Parquet"
    assert engine.aws_access_key_id is None
    assert engine.aws_secret_access_key is None
    assert engine.compression is None


def test_iceberg_engine_with_all_options():
    """Test IcebergS3Engine with all optional configuration"""
    engine = IcebergS3Engine(
        path="s3://bucket/table/",
        format="ORC",
        aws_access_key_id="AKIATEST",
        aws_secret_access_key="secret123",
        compression="zstd",
    )
    assert engine.path == "s3://bucket/table/"
    assert engine.format == "ORC"
    assert engine.aws_access_key_id == "AKIATEST"
    assert engine.aws_secret_access_key == "secret123"
    assert engine.compression == "zstd"


def test_iceberg_engine_missing_path():
    """Test that missing path raises ValueError"""
    with pytest.raises(ValueError, match="IcebergS3 engine requires 'path'"):
        IcebergS3Engine(path="", format="Parquet")


def test_iceberg_engine_missing_format():
    """Test that missing format raises ValueError"""
    with pytest.raises(ValueError, match="IcebergS3 engine requires 'format'"):
        IcebergS3Engine(path="s3://bucket/table/", format="")


def test_iceberg_engine_invalid_format():
    """Test that invalid format raises ValueError (only Parquet and ORC supported)"""
    with pytest.raises(ValueError, match="format must be 'Parquet' or 'ORC'"):
        IcebergS3Engine(path="s3://bucket/table/", format="JSON")


def test_iceberg_rejects_order_by():
    """Test that IcebergS3 engine rejects ORDER BY clauses (read-only external table)"""
    with pytest.raises(
        ValueError, match="IcebergS3Engine does not support ORDER BY clauses"
    ):
        OlapConfig(
            engine=IcebergS3Engine(path="s3://bucket/table/", format="Parquet"),
            order_by_fields=["id"],
        )


def test_iceberg_rejects_partition_by():
    """Test that IcebergS3 engine rejects PARTITION BY clauses (read-only external table)"""
    with pytest.raises(
        ValueError, match="IcebergS3Engine does not support PARTITION BY clause"
    ):
        OlapConfig(
            engine=IcebergS3Engine(path="s3://bucket/table/", format="Parquet"),
            partition_by="toYYYYMM(timestamp)",
        )


def test_iceberg_rejects_sample_by():
    """Test that IcebergS3 engine rejects SAMPLE BY clauses (read-only external table)"""
    with pytest.raises(
        ValueError, match="IcebergS3Engine does not support SAMPLE BY clause"
    ):
        OlapConfig(
            engine=IcebergS3Engine(path="s3://bucket/table/", format="Parquet"),
            sample_by_expression="cityHash64(id)",
        )


def test_iceberg_table_in_olap_table():
    """Test creating OlapTable with IcebergS3Engine and custom settings"""
    table = OlapTable[SampleData](
        "lake_events",
        OlapConfig(
            engine=IcebergS3Engine(
                path="s3://datalake/events/",
                format="Parquet",
                aws_access_key_id="AKIATEST",
                aws_secret_access_key="secret123",
            )
        ),
    )
    assert table.name == "lake_events"
    assert isinstance(table.config.engine, IcebergS3Engine)
    assert table.config.engine.path == "s3://datalake/events/"
