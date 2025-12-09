"""Tests for OlapTable cluster validation."""

import pytest
from moose_lib import OlapTable, OlapConfig, MergeTreeEngine, ReplicatedMergeTreeEngine
from pydantic import BaseModel


class SampleModel(BaseModel):
    """Test model for cluster validation tests."""

    id: str
    value: int


def test_cluster_only_is_allowed():
    """Test that specifying only cluster works."""
    table = OlapTable[SampleModel](
        "TestClusterOnly",
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["id"],
            cluster="test_cluster",
        ),
    )
    assert table is not None


def test_explicit_params_only_is_allowed():
    """Test that specifying explicit keeper_path and replica_name without cluster works."""
    table = OlapTable[SampleModel](
        "TestExplicitOnly",
        OlapConfig(
            engine=ReplicatedMergeTreeEngine(
                keeper_path="/clickhouse/tables/{database}/{table}",
                replica_name="{replica}",
            ),
            order_by_fields=["id"],
        ),
    )
    assert table is not None


def test_cluster_and_explicit_params_raises_error():
    """Test that specifying both cluster and explicit keeper_path/replica_name raises an error."""
    with pytest.raises(
        ValueError,
        match=r"Cannot specify both 'cluster' and explicit replication params",
    ):
        OlapTable[SampleModel](
            "TestBothClusterAndExplicit",
            OlapConfig(
                engine=ReplicatedMergeTreeEngine(
                    keeper_path="/clickhouse/tables/{database}/{table}",
                    replica_name="{replica}",
                ),
                order_by_fields=["id"],
                cluster="test_cluster",
            ),
        )


def test_non_replicated_engine_with_cluster_is_allowed():
    """Test that non-replicated engines can have a cluster specified."""
    table = OlapTable[SampleModel](
        "TestMergeTreeWithCluster",
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["id"],
            cluster="test_cluster",
        ),
    )
    assert table is not None


def test_replicated_engine_without_cluster_or_explicit_params_is_allowed():
    """Test that ReplicatedMergeTree without cluster or explicit params works (ClickHouse Cloud mode)."""
    table = OlapTable[SampleModel](
        "TestCloudMode",
        OlapConfig(
            engine=ReplicatedMergeTreeEngine(),
            order_by_fields=["id"],
            # No cluster, no keeper_path, no replica_name
        ),
    )
    assert table is not None
