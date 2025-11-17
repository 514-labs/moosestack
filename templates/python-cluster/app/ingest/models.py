"""
Test models for ClickHouse cluster support
"""

from moose_lib import Key, OlapTable, OlapConfig, ReplicatedMergeTreeEngine, MergeTreeEngine
from pydantic import BaseModel


# Table using cluster_a
class TableA(BaseModel):
    id: Key[str]
    value: str
    timestamp: float


# Table using cluster_b
class TableB(BaseModel):
    id: Key[str]
    count: int
    timestamp: float


# Table without cluster (for mixed testing)
class TableC(BaseModel):
    id: Key[str]
    data: str
    timestamp: float


# Table with explicit keeper args but no cluster
class TableD(BaseModel):
    id: Key[str]
    metric: int
    timestamp: float


# Table with ReplicatedMergeTree but no cluster or explicit params (ClickHouse Cloud mode)
class TableE(BaseModel):
    id: Key[str]
    status: str
    timestamp: float


# OLAP Tables

# table_a: Uses cluster_a with ReplicatedMergeTree
table_a = OlapTable[TableA](
    "TableA",
    OlapConfig(
        order_by_fields=["id"],
        engine=ReplicatedMergeTreeEngine(),
        cluster="cluster_a",
    ),
)

# table_b: Uses cluster_b with ReplicatedMergeTree
table_b = OlapTable[TableB](
    "TableB",
    OlapConfig(
        order_by_fields=["id"],
        engine=ReplicatedMergeTreeEngine(),
        cluster="cluster_b",
    ),
)

# TableC: No cluster, uses plain MergeTree (not replicated)
table_c = OlapTable[TableC](
    "TableC",
    OlapConfig(
        order_by_fields=["id"],
        engine=MergeTreeEngine(),
    ),
)

# TableD: ReplicatedMergeTree with explicit keeper args, no cluster
table_d = OlapTable[TableD](
    "TableD",
    OlapConfig(
        order_by_fields=["id"],
        engine=ReplicatedMergeTreeEngine(
            keeper_path="/clickhouse/tables/{database}/{table}",
            replica_name="{replica}",
        ),
    ),
)

# TableE: ReplicatedMergeTree with auto-injected params (ClickHouse Cloud mode)
table_e = OlapTable[TableE](
    "TableE",
    OlapConfig(
        order_by_fields=["id"],
        engine=ReplicatedMergeTreeEngine(),
        # No cluster, no keeper_path, no replica_name - Moose will auto-inject in dev
    ),
)

