from dataclasses import dataclass
from enum import Enum
from typing import Dict, Optional


class ClickHouseEngines(Enum):
    MergeTree = "MergeTree"
    ReplacingMergeTree = "ReplacingMergeTree"
    SummingMergeTree = "SummingMergeTree"
    AggregatingMergeTree = "AggregatingMergeTree"
    CollapsingMergeTree = "CollapsingMergeTree"
    VersionedCollapsingMergeTree = "VersionedCollapsingMergeTree"
    GraphiteMergeTree = "GraphiteMergeTree"

@dataclass
class TableCreateOptions:
    name: str
    columns: Dict[str, str]
    engine: Optional[ClickHouseEngines] = ClickHouseEngines.MergeTree
    order_by: Optional[str] = None
    dedup_by: Optional[str] = None

@dataclass
class AggregationCreateOptions:
    table_create_options: TableCreateOptions
    materialized_view_name: str
    select: str

@dataclass
class AggregationDropOptions:
    view_name: str
    table_name: str

@dataclass
class MaterializedViewCreateOptions:
    name: str
    destination_table: str
    select: str

@dataclass
class PopulateTableOptions:
    destination_table: str
    select: str

@dataclass
class Blocks:
    teardown: list[str]
    setup: list[str]

def drop_aggregation(options: AggregationDropOptions) -> list[str]:
    """
    Drops an aggregation's view & underlying table.
    """
    return [drop_view(options.view_name), drop_table(options.table_name)]

def drop_table(name: str) -> str:
    """
    Drops an existing table if it exists.
    """
    return f"DROP TABLE IF EXISTS {name}".strip()

def drop_view(name: str) -> str:
    """
    Drops an existing view if it exists.
    """
    return f"DROP VIEW IF EXISTS {name}".strip()

def create_aggregation(options: AggregationCreateOptions) -> list[str]:
    """
    Creates an aggregation which includes a table, materialized view, and initial data load.
    """
    return [
        create_table(options.table_create_options),
        create_materialized_view(MaterializedViewCreateOptions(
            name=options.materialized_view_name,
            destination_table=options.table_create_options.name,
            select=options.select
        )),
        populate_table(PopulateTableOptions(
            destination_table=options.table_create_options.name,
            select=options.select
        )),
    ]

def create_materialized_view(options: MaterializedViewCreateOptions) -> str:
    """
    Creates a materialized view.
    """
    return f"CREATE MATERIALIZED VIEW IF NOT EXISTS {options.name} \nTO {options.destination_table}\nAS {options.select}".strip()

def create_table(options: TableCreateOptions) -> str:
    """
    Creates a new table with default MergeTree engine.
    """
    column_definitions = ",\n".join([f"{name} {type}" for name, type in options.columns.items()])
    order_by_clause = f"ORDER BY {options.order_by}" if options.order_by else ""
    engine = options.engine.value
    engine_expr = (
        f"ReplacingMergeTree({options.dedup_by})"
        if engine == ClickHouseEngines.ReplacingMergeTree.value and options.dedup_by
        else f"{engine}()"
    )

    return f"""
    CREATE TABLE IF NOT EXISTS {options.name} 
    (
      {column_definitions}
    )
    ENGINE = {engine_expr}
    {order_by_clause}
    """.strip()

def populate_table(options: PopulateTableOptions) -> str:
    """
    Populates a table with data.
    """
    return f"INSERT INTO {options.destination_table}\n{options.select}".strip()