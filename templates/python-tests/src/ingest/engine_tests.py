# Test all supported ClickHouse engines to ensure proper configuration
# These tables verify that all engine types can be created and configured correctly

from moose_lib import OlapTable, OlapConfig, Key, Int8, ClickHouseTTL, clickhouse_default, FixedString
from moose_lib.blocks import (
    MergeTreeEngine,
    ReplacingMergeTreeEngine,
    SummingMergeTreeEngine,
    AggregatingMergeTreeEngine,
    CollapsingMergeTreeEngine,
    VersionedCollapsingMergeTreeEngine,
    ReplicatedMergeTreeEngine,
    ReplicatedReplacingMergeTreeEngine,
    ReplicatedAggregatingMergeTreeEngine,
    ReplicatedSummingMergeTreeEngine,
    ReplicatedCollapsingMergeTreeEngine,
    ReplicatedVersionedCollapsingMergeTreeEngine,
    BufferEngine,
    # S3QueueEngine - requires S3 configuration, tested separately
)
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Annotated, List


class EngineTestData(BaseModel):
    """Test data model for engine testing"""
    id: Key[str]
    timestamp: datetime
    value: int
    category: str
    version: int
    is_deleted: bool  # For ReplacingMergeTree soft deletes (UInt8 in ClickHouse)

# Table with TTL: delete rows older than 90 days, delete email after 30 days
class TTLTestData(BaseModel):
    id: Key[str]
    timestamp: datetime
    email: Annotated[str, ClickHouseTTL("timestamp + INTERVAL 30 DAY")]

ttl_table = OlapTable[TTLTestData](
    "TTLTable",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_fields=["id", "timestamp"],
        ttl="timestamp + INTERVAL 90 DAY DELETE",
    ),
)

# Table with DEFAULT values for testing DEFAULT removal
class DefaultTestData(BaseModel):
    id: Key[str]
    timestamp: datetime
    status: Annotated[str, clickhouse_default("'pending'")]
    count: Annotated[int, clickhouse_default("0"), "uint32"]

default_table = OlapTable[DefaultTestData](
    "DefaultTable",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_fields=["id", "timestamp"],
    ),
)

# Table with FixedString: test direct usage and type aliases
# Type alias for MAC address (17 bytes for format "XX:XX:XX:XX:XX:XX")
type MacAddress = Annotated[str, FixedString(17)]

class FixedStringTestData(BaseModel):
    id: Key[str]
    timestamp: datetime
    # Direct FixedString usage
    md5_hash: Annotated[str, FixedString(16)]  # 16-byte MD5
    ipv6_address: Annotated[str, FixedString(16)]  # 16-byte IPv6
    # Type alias usage
    mac_address: MacAddress  # Should become FixedString(17)
    mac_addresses: List[MacAddress]  # Should become Array(FixedString(17))

fixedstring_table = OlapTable[FixedStringTestData](
    "FixedStringTest",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_fields=["id", "timestamp"],
    ),
)

class CollapsingTestData(EngineTestData):
    """Test data model for CollapsingMergeTree and VersionedCollapsingMergeTree testing"""
    sign: Int8  # For CollapsingMergeTree (1 = state, -1 = cancel)

class EngineTestDataSample(BaseModel):
    """Test data model for engine testing"""
    id: str
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

# Test CollapsingMergeTree engine
collapsing_merge_tree_table = OlapTable[CollapsingTestData](
    "CollapsingMergeTreeTest",
    OlapConfig(
        engine=CollapsingMergeTreeEngine(sign="sign"),
        order_by_fields=["id", "timestamp"]
    )
)

# Test VersionedCollapsingMergeTree engine
versioned_collapsing_merge_tree_table = OlapTable[CollapsingTestData](
    "VersionedCollapsingMergeTreeTest",
    OlapConfig(
        engine=VersionedCollapsingMergeTreeEngine(sign="sign", ver="version"),
        order_by_fields=["id", "timestamp"]
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

# Test ReplicatedCollapsingMergeTree engine
replicated_collapsing_merge_tree_table = OlapTable[CollapsingTestData](
    "ReplicatedCollapsingMergeTreeTest",
    OlapConfig(
        engine=ReplicatedCollapsingMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_collapsing_test",
            replica_name="{replica}",
            sign="sign"
        ),
        order_by_fields=["id", "timestamp"]
    )
)

# Test ReplicatedVersionedCollapsingMergeTree engine
replicated_versioned_collapsing_merge_tree_table = OlapTable[CollapsingTestData](
    "ReplicatedVersionedCollapsingMergeTreeTest",
    OlapConfig(
        engine=ReplicatedVersionedCollapsingMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{shard}/replicated_versioned_collapsing_test",
            replica_name="{replica}",
            sign="sign",
            ver="version"
        ),
        order_by_fields=["id", "timestamp"]
    )
)

# Test SAMPLE BY clause for data sampling
sample_by_table = OlapTable[EngineTestDataSample](
    "SampleByTest",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_expression="cityHash64(id)",
        sample_by_expression="cityHash64(id)"
    )
)

# Note: S3Queue engine testing is more complex as it requires S3 configuration
# and external dependencies, so it's not included in this basic engine test suite.
# For S3Queue testing, see the dedicated S3 integration tests.

# Test Buffer engine - buffers writes before flushing to destination table
# First create the destination table
buffer_destination_table = OlapTable[EngineTestData](
    "BufferDestinationTest",
    OlapConfig(
        engine=MergeTreeEngine(),
        order_by_fields=["id", "timestamp"]
    )
)

# Then create the buffer table that points to it
buffer_table = OlapTable[EngineTestData](
    "BufferTest",
    OlapConfig(
        engine=BufferEngine(
            target_database="local",
            target_table="BufferDestinationTest",
            num_layers=16,
            min_time=10,
            max_time=100,
            min_rows=10000,
            max_rows=1000000,
            min_bytes=10485760,
            max_bytes=104857600,
        ),
    )
)

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
    collapsing_merge_tree_table,
    versioned_collapsing_merge_tree_table,
    replicated_merge_tree_table,
    replicated_merge_tree_cloud_table,
    replicated_replacing_merge_tree_table,
    replicated_replacing_soft_delete_table,
    replicated_aggregating_merge_tree_table,
    replicated_summing_merge_tree_table,
    replicated_collapsing_merge_tree_table,
    replicated_versioned_collapsing_merge_tree_table,
    sample_by_table,
    ttl_table,
    buffer_destination_table,
    buffer_table,
    default_table,
    fixedstring_table,
]
