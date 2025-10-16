# Test all supported ClickHouse engines to ensure proper configuration
# These tables verify that all engine types can be created and configured correctly

from moose_lib import OlapTable, OlapConfig, Key
from moose_lib.blocks import (
    MergeTreeEngine,
    ReplacingMergeTreeEngine,
    SummingMergeTreeEngine,
    AggregatingMergeTreeEngine,
    ReplicatedMergeTreeEngine,
    ReplicatedReplacingMergeTreeEngine,
    ReplicatedAggregatingMergeTreeEngine,
    ReplicatedSummingMergeTreeEngine,
    # S3QueueEngine - requires S3 configuration, tested separately
)
from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class EngineTestData(BaseModel):
    """Test data model for engine testing"""
    id: Key[str]
    timestamp: datetime
    value: int
    category: str
    version: int
    is_deleted: bool  # For ReplacingMergeTree soft deletes (UInt8 in ClickHouse)


# Test MergeTree engine (default)
merge_tree_table = OlapTable[EngineTestData](
    "MergeTreeTest",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_fields=["id", "timestamp"]
    )
)

# Test MergeTree with order_by_expression (equivalent to fields)
merge_tree_table_expr = OlapTable[EngineTestData](
    "MergeTreeTestExpr",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_expression="(id, timestamp)",
    )
)

# Test ReplacingMergeTree engine with basic deduplication
replacing_merge_tree_basic_table = OlapTable[EngineTestData](
    "ReplacingMergeTreeBasic", 
    OlapConfig(
        engine=ReplacingMergeTreeEngine(),
        order_by_fields=["id"]
    )
)

# Test ReplacingMergeTree engine with version column
replacing_merge_tree_version_table = OlapTable[EngineTestData](
    "ReplacingMergeTreeVersion",
    OlapConfig(
        engine=ReplacingMergeTreeEngine(ver="version"),
        order_by_fields=["id"]
    )
)

# Test ReplacingMergeTree engine with version and soft delete
replacing_merge_tree_soft_delete_table = OlapTable[EngineTestData](
    "ReplacingMergeTreeSoftDelete",
    OlapConfig(
        engine=ReplacingMergeTreeEngine(ver="version", is_deleted="is_deleted"),
        order_by_fields=["id"]
    )
)

# Test SummingMergeTree engine
summing_merge_tree_table = OlapTable[EngineTestData](
    "SummingMergeTreeTest",
    OlapConfig(
        engine=SummingMergeTreeEngine(),
        order_by_fields=["id", "category"]
    )
)

# Test AggregatingMergeTree engine
aggregating_merge_tree_table = OlapTable[EngineTestData](
    "AggregatingMergeTreeTest", 
    OlapConfig(
        engine=AggregatingMergeTreeEngine(),
        order_by_fields=["id", "category"]
    )
)

# Test ReplicatedMergeTree engine (with explicit keeper params - for self-hosted)
replicated_merge_tree_table = OlapTable[EngineTestData](
    "ReplicatedMergeTreeTest",
    OlapConfig(
        engine=ReplicatedMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_merge_tree_test",
            replica_name="{replica}"
        ),
        order_by_fields=["id", "timestamp"]
    )
)

# Test ReplicatedMergeTree engine (Cloud-compatible - no keeper params)
# In dev mode, Moose automatically injects default parameters
# In production, ClickHouse uses its automatic configuration
replicated_merge_tree_cloud_table = OlapTable[EngineTestData](
    "ReplicatedMergeTreeCloudTest",
    OlapConfig(
        engine=ReplicatedMergeTreeEngine(),  # No params - uses server defaults (Cloud compatible)
        order_by_fields=["id", "timestamp"]
    )
)

# Test ReplicatedReplacingMergeTree engine with version column
replicated_replacing_merge_tree_table = OlapTable[EngineTestData](
    "ReplicatedReplacingMergeTreeTest",
    OlapConfig(
        engine=ReplicatedReplacingMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_replacing_test",
            replica_name="{replica}",
            ver="version"
        ),
        order_by_fields=["id"]
    )
)

# Test ReplicatedReplacingMergeTree with soft delete
replicated_replacing_soft_delete_table = OlapTable[EngineTestData](
    "ReplicatedReplacingSoftDeleteTest",
    OlapConfig(
        engine=ReplicatedReplacingMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_replacing_sd_test",
            replica_name="{replica}",
            ver="version",
            is_deleted="is_deleted"
        ),
        order_by_fields=["id"]
    )
)

# Test ReplicatedAggregatingMergeTree engine
replicated_aggregating_merge_tree_table = OlapTable[EngineTestData](
    "ReplicatedAggregatingMergeTreeTest",
    OlapConfig(
        engine=ReplicatedAggregatingMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_aggregating_test",
            replica_name="{replica}"
        ),
        order_by_fields=["id", "category"]
    )
)

# Test ReplicatedSummingMergeTree engine
replicated_summing_merge_tree_table = OlapTable[EngineTestData](
    "ReplicatedSummingMergeTreeTest",
    OlapConfig(
        engine=ReplicatedSummingMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_summing_test",
            replica_name="{replica}",
            columns=["value"]
        ),
        order_by_fields=["id", "category"]
    )
)

# Test SAMPLE BY clause for data sampling
sample_by_table = OlapTable[EngineTestData](
    "SampleByTest",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_fields=["id", "timestamp"],
        sample_by="id"
    )
)

# Note: S3Queue engine testing is more complex as it requires S3 configuration
# and external dependencies, so it's not included in this basic engine test suite.
# For S3Queue testing, see the dedicated S3 integration tests.

# Export all test tables for verification that engine configurations
# can be properly instantiated and don't throw errors during table creation
all_engine_test_tables = [
    merge_tree_table,
    merge_tree_table_expr,
    replacing_merge_tree_basic_table,
    replacing_merge_tree_version_table,
    replacing_merge_tree_soft_delete_table,
    summing_merge_tree_table,
    aggregating_merge_tree_table,
    replicated_merge_tree_table,
    replicated_merge_tree_cloud_table,
    replicated_replacing_merge_tree_table,
    replicated_replacing_soft_delete_table,
    replicated_aggregating_merge_tree_table,
    replicated_summing_merge_tree_table,
    sample_by_table,
]