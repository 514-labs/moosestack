from moose_lib import (
    MaterializedView,
    MaterializedViewOptions,
    AggregateFunction,
    ClickHouseEngines,
)
from pydantic import BaseModel
from datetime import datetime
from typing import Annotated
from app.pipelines.pipelines import unifiedHRPipeline

"""
        CREATE TABLE IF NOT EXISTS heart_rate_summary
        (
            user_name String,
            rounded_up_time Float64,
            processed_timestamp DateTime,
            avg_hr_per_second AggregateFunction(avg, Float64)
        )
        ENGINE = AggregatingMergeTree()
        PRIMARY KEY user_name
        ORDER BY (user_name, rounded_up_time, processed_timestamp);
        CREATE MATERIALIZED VIEW IF NOT EXISTS heart_rate_view
        TO heart_rate_summary
        AS
        SELECT
            user_name,
            ceil(hr_timestamp_seconds) as rounded_up_time,
            processed_timestamp,
            avgState(hr_value) as avg_hr_per_second
        FROM
            UNIFIED_HRM_MODEL_0_0
        GROUP BY user_name, rounded_up_time, processed_timestamp
        ORDER BY user_name, rounded_up_time;
        
"""


# Target table for the materialized view
class AggregateHeartRateSummaryPerSecond(BaseModel):
    user_name: str
    rounded_up_time: int
    processed_timestamp: datetime
    # Params: Aggregated [return_type_of_the_aggregated_function, AggregateFunction(agg_func="avg", param_types=[float])]
    avg_hr_per_second: Annotated[
        float, AggregateFunction(agg_func="avg", param_types=[float])
    ]


SELECT_QUERY = """
        SELECT
            user_name,
            ceil(hr_timestamp_seconds) as rounded_up_time,
            processed_timestamp,
            avgState(hr_value) as avg_hr_per_second
        FROM
            unified_hr_packet
        GROUP BY user_name, rounded_up_time, processed_timestamp
"""

## New: Get the table from the pipeline & pass it to the materialized view
unifiedHRTable = unifiedHRPipeline.get_table()

aggregateHeartRateSummaryPerSecondMV = MaterializedView[
    AggregateHeartRateSummaryPerSecond
](
    MaterializedViewOptions(
        select_statement=SELECT_QUERY,
        table_name="per_second_heart_rate_aggregate",
        materialized_view_name="per_second_heart_rate_aggregate_view",
        order_by_fields=["user_name", "rounded_up_time"],
        engine=ClickHouseEngines.AggregatingMergeTree,
        select_tables=[unifiedHRTable],
    )
)
