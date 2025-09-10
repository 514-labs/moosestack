"""Tests for S3Queue engine configuration with the new type hints."""

import pytest
from pydantic import BaseModel
from datetime import datetime
import warnings

from moose_lib import OlapTable, OlapConfig, ClickHouseEngines
from moose_lib.blocks import S3QueueEngine, MergeTreeEngine, ReplacingMergeTreeEngine
from moose_lib.internal import (
    _convert_engine_to_config_dict, 
    EngineConfigDict,
    S3QueueConfigDict,
    MergeTreeConfigDict,
    ReplacingMergeTreeConfigDict
)


class SampleEvent(BaseModel):
    """Sample model for S3Queue table tests."""
    id: str
    timestamp: datetime
    message: str


def test_olap_config_accepts_enum():
    """Test that OlapConfig accepts ClickHouseEngines enum values."""
    config = OlapConfig(
        engine=ClickHouseEngines.MergeTree,
        order_by_fields=["id"]
    )
    assert config.engine == ClickHouseEngines.MergeTree


def test_olap_config_accepts_engine_config():
    """Test that OlapConfig accepts EngineConfig instances."""
    s3_engine = S3QueueEngine(
        s3_path="s3://bucket/data/*.json",
        format="JSONEachRow",
        aws_access_key_id="AKIA123",
        aws_secret_access_key="secret123"
    )
    config = OlapConfig(
        engine=s3_engine,
        order_by_fields=["timestamp"]
    )
    assert isinstance(config.engine, S3QueueEngine)
    assert config.engine.s3_path == "s3://bucket/data/*.json"


def test_olap_table_with_s3queue_engine():
    """Test creating OlapTable with S3QueueEngine."""
    table = OlapTable[SampleEvent](
        "TestS3Table",
        OlapConfig(
            engine=S3QueueEngine(
                s3_path="s3://test-bucket/logs/*.json",
                format="JSONEachRow",
                compression="gzip"
            ),
            order_by_fields=["timestamp", "id"],
            settings={
                "s3queue_mode": "unordered",
                "s3queue_keeper_path": "/clickhouse/s3queue/test"
            }
        )
    )
    
    assert table.name == "TestS3Table"
    assert isinstance(table.config.engine, S3QueueEngine)
    assert table.config.engine.s3_path == "s3://test-bucket/logs/*.json"
    assert table.config.settings["s3queue_mode"] == "unordered"


def test_olap_table_with_mergetree_engines():
    """Test creating OlapTable with various MergeTree engine configs."""
    # Test with MergeTreeEngine
    table1 = OlapTable[SampleEvent](
        "MergeTreeTable",
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["id"]
        )
    )
    assert isinstance(table1.config.engine, MergeTreeEngine)
    
    # Test with ReplacingMergeTreeEngine
    table2 = OlapTable[SampleEvent](
        "ReplacingTable",
        OlapConfig(
            engine=ReplacingMergeTreeEngine(),
            order_by_fields=["id"]
        )
    )
    assert isinstance(table2.config.engine, ReplacingMergeTreeEngine)


def test_engine_conversion_to_dict():
    """Test conversion of engine configs to EngineConfigDict."""
    # Create a mock table with S3QueueEngine
    table = OlapTable[SampleEvent](
        "TestTable",
        OlapConfig(
            engine=S3QueueEngine(
                s3_path="s3://bucket/data/*.parquet",
                format="Parquet",
                aws_access_key_id="AKIA456",
                aws_secret_access_key="secret456",
                compression="zstd",
                headers={"X-Custom": "value"}
            )
        )
    )
    
    # Convert engine to dict
    engine_dict = _convert_engine_to_config_dict(table.config.engine, table)
    
    assert engine_dict.engine == "S3Queue"
    assert engine_dict.s3_path == "s3://bucket/data/*.parquet"
    assert engine_dict.format == "Parquet"
    assert engine_dict.aws_access_key_id == "AKIA456"
    assert engine_dict.aws_secret_access_key == "secret456"
    assert engine_dict.compression == "zstd"
    assert engine_dict.headers == {"X-Custom": "value"}


def test_engine_conversion_with_enum():
    """Test conversion of enum engines to EngineConfigDict."""
    # Create a mock table with enum engine
    table = OlapTable[SampleEvent](
        "TestTable",
        OlapConfig(
            engine=ClickHouseEngines.ReplacingMergeTree
        )
    )
    
    # Convert engine to dict
    engine_dict = _convert_engine_to_config_dict(table.config.engine, table)
    
    assert engine_dict.engine == "ReplacingMergeTree"


def test_backward_compatibility():
    """Test that both old and new APIs work together."""
    # Old API with enum
    old_table = OlapTable[SampleEvent](
        "OldTable",
        OlapConfig(
            engine=ClickHouseEngines.MergeTree,
            order_by_fields=["id"]
        )
    )
    
    # New API with EngineConfig
    new_table = OlapTable[SampleEvent](
        "NewTable", 
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["id"]
        )
    )
    
    # Both should work
    assert old_table.config.engine == ClickHouseEngines.MergeTree
    assert isinstance(new_table.config.engine, MergeTreeEngine)


def test_deprecation_warning_for_enum():
    """Test that using enum engine triggers deprecation warning."""
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        
        table = OlapTable[SampleEvent](
            "LegacyTable",
            OlapConfig(
                engine=ClickHouseEngines.S3Queue,
                order_by_fields=["id"]
            )
        )
        
        # Check that a deprecation warning was issued
        assert len(w) == 1
        assert issubclass(w[0].category, DeprecationWarning)
        assert "deprecated ClickHouseEngines enum" in str(w[0].message)
        assert "S3QueueEngine" in str(w[0].message)


def test_s3queue_with_all_options():
    """Test S3QueueEngine with all configuration options."""
    engine = S3QueueEngine(
        s3_path="s3://my-bucket/path/to/data/*.json",
        format="JSONEachRow",
        aws_access_key_id="AKIAIOSFODNN7EXAMPLE",
        aws_secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        compression="gzip",
        headers={
            "X-Custom-Header": "value1",
            "Authorization": "Bearer token"
        }
    )
    
    table = OlapTable[SampleEvent](
        "FullConfigTable",
        OlapConfig(
            engine=engine,
            order_by_fields=["timestamp"],
            settings={
                "s3queue_mode": "ordered",
                "s3queue_keeper_path": "/clickhouse/s3queue/full",
                "s3queue_loading_retries": "5",
                "s3queue_processing_threads_num": "8"
            }
        )
    )
    
    assert table.config.engine.s3_path == "s3://my-bucket/path/to/data/*.json"
    assert table.config.engine.format == "JSONEachRow"
    assert table.config.engine.compression == "gzip"
    assert table.config.engine.headers["X-Custom-Header"] == "value1"


def test_s3queue_public_bucket():
    """Test S3QueueEngine for public bucket (no credentials)."""
    engine = S3QueueEngine(
        s3_path="s3://public-bucket/open-data/*.parquet",
        format="Parquet"
        # No AWS credentials needed for public buckets
    )
    
    table = OlapTable[SampleEvent](
        "PublicBucketTable",
        OlapConfig(
            engine=engine,
            order_by_fields=["id"]
        )
    )
    
    assert table.config.engine.aws_access_key_id is None
    assert table.config.engine.aws_secret_access_key is None


def test_migration_from_legacy_to_new():
    """Test migration path from legacy to new API."""
    # Legacy approach
    legacy_config = OlapConfig(
        engine=ClickHouseEngines.S3Queue,
        order_by_fields=["timestamp"]
    )
    
    # New approach - equivalent configuration
    new_config = OlapConfig(
        engine=S3QueueEngine(
            s3_path="s3://bucket/data/*.json",
            format="JSONEachRow"
        ),
        order_by_fields=["timestamp"]
    )
    
    # Both should have the same order_by_fields
    assert legacy_config.order_by_fields == new_config.order_by_fields
    
    # Engine types should be different
    assert isinstance(legacy_config.engine, ClickHouseEngines)
    assert isinstance(new_config.engine, S3QueueEngine)


def test_engine_config_validation():
    """Test that S3QueueEngine validates required fields."""
    # Test missing required fields
    with pytest.raises(ValueError, match="S3Queue engine requires 's3_path'"):
        S3QueueEngine(
            s3_path="",  # Empty path should fail
            format="JSONEachRow"
        )
    
    with pytest.raises(ValueError, match="S3Queue engine requires 'format'"):
        S3QueueEngine(
            s3_path="s3://bucket/data/*.json",
            format=""  # Empty format should fail
        )


def test_multiple_engine_types():
    """Test that different engine types can be used in the same application."""
    tables = []
    
    # Create tables with different engine types
    tables.append(OlapTable[SampleEvent](
        "MergeTreeTable",
        OlapConfig(engine=MergeTreeEngine())
    ))
    
    tables.append(OlapTable[SampleEvent](
        "ReplacingTreeTable",
        OlapConfig(engine=ReplacingMergeTreeEngine())
    ))
    
    tables.append(OlapTable[SampleEvent](
        "S3QueueTable",
        OlapConfig(
            engine=S3QueueEngine(
                s3_path="s3://bucket/*.json",
                format="JSONEachRow"
            )
        )
    ))
    
    # Verify all tables were created with correct engine types
    assert isinstance(tables[0].config.engine, MergeTreeEngine)
    assert isinstance(tables[1].config.engine, ReplacingMergeTreeEngine)
    assert isinstance(tables[2].config.engine, S3QueueEngine)
