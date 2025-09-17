from fastapi import FastAPI, Depends
from typing_extensions import Literal
from app.db.views import BarAggregatedTable as BarAgg
from moose_lib import QueryClient, WorkflowClient
from moose_lib.config.runtime import config_registry
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from app.db.models import BarTable, BarModel

app = FastAPI()

query_client: Optional[QueryClient] = None

# Query params are defined as Pydantic models and are validated automatically
class QueryParams(BaseModel):
    order_by: Optional[Literal["total_rows", "rows_with_text", "max_text_length", "total_text_length"]] = Field(
        default="total_rows",
        description="Must be one of: total_rows, rows_with_text, max_text_length, total_text_length"
    )
    limit: Optional[int] = Field(
        default=5,
        gt=0,
        le=100,
        description="Must be between 1 and 100"
    )
    start_day: Optional[int] = Field(
        default=1,
        gt=0,
        le=31,
        description="Must be between 1 and 31"
    )
    end_day: Optional[int] = Field(
        default=31,
        gt=0,
        le=31,
        description="Must be between 1 and 31"
    )


class QueryResult(BaseModel):
    day_of_month: int
    total_rows: Optional[int] = None
    rows_with_text: Optional[int] = None
    max_text_length: Optional[int] = None
    total_text_length: Optional[int] = None


@app.get("/bar", response_model=List[QueryResult])
def get_bar_data(params: QueryParams = Depends()):
    global query_client
    if query_client is None:
        query_client = QueryClient(config_registry.get_clickhouse_config())
    
    workflow_client = WorkflowClient(config_registry.get_temporal_config())

    query = f"""
    SELECT
        {BarAgg.columns.day_of_month},
        {params.order_by}
    FROM {BarAgg.name}
    WHERE {BarAgg.columns.day_of_month} >= {params.start_day}
    AND {BarAgg.columns.day_of_month} <= {params.end_day}
    ORDER BY {params.order_by} DESC
    LIMIT {params.limit}
    """
    
    result = query_client.execute(
        query,
        {
            "order_by": params.order_by,
            "start_day": params.start_day,
            "end_day": params.end_day,
            "limit": params.limit
        },
        QueryResult
    )

    return result


@app.post("/bar")
def post_bar_data(data: List[BarModel]):
    result = BarTable.insert(data)
    
    if result.successful:
        return {"message": "Data inserted successfully"}
    elif result.failed:
        return {"message": "Data inserted with errors", "errors": result.failed_records}
    else:
        return {"message": "Data inserted with errors", "errors": result.failed_records}
    