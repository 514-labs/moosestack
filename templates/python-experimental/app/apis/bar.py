# This file is where you can define your API templates for consuming your data
# The implementation has been moved to FastAPI routes in main.py

from moose_lib import MooseClient, Api, MooseCache, Query, and_
from pydantic import BaseModel, Field
from typing import Optional, Literal
from app.views.bar_aggregated import barAggregatedMV
from datetime import datetime, timezone


# Query params are defined as Pydantic models and are validated automatically
class QueryParams(BaseModel):
    order_by: Optional[
        Literal["total_rows", "rows_with_text", "max_text_length", "total_text_length"]
    ] = Field(
        default="total_rows",
        description="Must be one of: total_rows, rows_with_text, max_text_length, total_text_length",
    )
    limit: Optional[int] = Field(
        default=5, gt=0, le=100, description="Must be between 1 and 100"
    )
    start_day: Optional[int] = Field(
        default=1, gt=0, le=31, description="Must be between 1 and 31"
    )
    end_day: Optional[int] = Field(
        default=31, gt=0, le=31, description="Must be between 1 and 31"
    )


class QueryResult(BaseModel):
    day_of_month: int
    total_rows: int
    rows_with_text: int
    max_text_length: int
    total_text_length: int


## The run function is where you can define your API logic
def run(client: MooseClient, params: QueryParams):
    # Create a cache
    cache = MooseCache()
    cache_key = (
        f"bar:{params.order_by}:{params.limit}:{params.start_day}:{params.end_day}"
    )

    # Check for cached query results
    cached_result = cache.get(cache_key, type_hint=list)
    if cached_result and len(cached_result) > 0:
        return cached_result

    # Import BarAggregated model for column autocomplete
    from app.views.bar_aggregated import BarAggregated

    # NEW PATTERN: Use MooseModel for direct column access with autocomplete!
    # LSP provides autocomplete when typing BarAggregated.<field_name>

    # For dynamic column selection, we need to use .cols and format it
    order_by_col = BarAggregated.cols[params.order_by]

    query = f"""
    SELECT 
        {BarAggregated.day_of_month:col},
        {BarAggregated.total_rows:col},
        {BarAggregated.rows_with_text:col},
        {BarAggregated.max_text_length:col},
        {BarAggregated.total_text_length:col}
    FROM {{table}}
    WHERE {BarAggregated.day_of_month:col} >= {{start_day}} 
    AND {BarAggregated.day_of_month:col} <= {{end_day}} 
    ORDER BY {order_by_col:col} DESC
    LIMIT {{limit}}
    """

    result = client.query.execute(
        query,
        {
            "table": barAggregatedMV.target_table,
            "start_day": params.start_day,
            "end_day": params.end_day,
            "limit": params.limit,
        },
    )

    # Cache query results
    cache.set(cache_key, result, 3600)  # Cache for 1 hour

    return result


def run_v1(client: MooseClient, params: QueryParams):
    # Create a cache
    cache = MooseCache()
    cache_key = (
        f"bar:v1:{params.order_by}:{params.limit}:{params.start_day}:{params.end_day}"
    )

    # Check for cached query results
    cached_result = cache.get(cache_key, type_hint=list)
    if cached_result and len(cached_result) > 0:
        return cached_result

    # Import BarAggregated model for column autocomplete
    from app.views.bar_aggregated import BarAggregated

    # NEW PATTERN: Direct column access with Query builder
    # LSP provides autocomplete when typing BarAggregated.<field_name>
    query = (
        Query()
        .select(
            BarAggregated.day_of_month,
            BarAggregated.total_rows,
            BarAggregated.rows_with_text,
            BarAggregated.max_text_length,
            BarAggregated.total_text_length,
        )
        .from_(barAggregatedMV.target_table)
        .where(
            and_(
                BarAggregated.day_of_month.to_expr().ge(params.start_day),
                BarAggregated.day_of_month.to_expr().le(params.end_day),
            )
        )
        .order_by((BarAggregated.cols[params.order_by], "desc"))
        .limit(params.limit)
    )
    result = client.query.execute(query)

    # V1 specific: Add metadata
    for item in result:
        item["metadata"] = {
            "version": "1.0",
            "query_params": {
                "order_by": params.order_by,
                "limit": params.limit,
                "start_day": params.start_day,
                "end_day": params.end_day,
            },
        }

    # Cache query results
    cache.set(cache_key, result, 3600)  # Cache for 1 hour

    return result


bar = Api[QueryParams, QueryResult](name="bar", query_function=run)
bar_v1 = Api[QueryParams, QueryResult](name="bar", query_function=run_v1, version="1")
