from fastapi import FastAPI, Depends, HTTPException
from typing_extensions import Literal
from app.db.views import BarAggregatedTable as BarAgg
from moose_lib import QueryClient, WorkflowClient
from moose_lib.config.runtime import config_registry
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from app.db.models import BarTable, BarModel    

api = FastAPI()

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


class InsertResponse(BaseModel):
    message: str
    successful_count: int
    failed_count: int
    total_count: int
    errors: Optional[List[dict]] = None


class ErrorDetail(BaseModel):
    record_index: int
    error_message: str
    field_errors: Optional[dict] = None


@api.get("/bar", response_model=List[QueryResult])
def get_bar_data(params: QueryParams = Depends()):
    """
    Retrieve bar data with comprehensive error handling.
    
    Returns aggregated data based on the specified parameters with proper
    error handling for database connection and query execution issues.
    """
    global query_client
    
    try:
        # Initialize query client if needed
        if query_client is None:
            query_client = QueryClient(config_registry.get_clickhouse_config())
        
        # Validate date range
        if params.start_day is not None and params.end_day is not None and params.start_day > params.end_day:
            raise HTTPException(
                status_code=400,
                detail="start_day must be less than or equal to end_day"
            )
        
        # Build the query
        query = """
        SELECT
            day_of_month,
            {select_column}
        FROM {BarAgg}
        WHERE day_of_month >= {start_day}
        AND day_of_month <= {end_day}
        ORDER BY {order_by} DESC
        LIMIT {limit}
        """
        
        # Execute the query
        result = query_client.execute(
            query,
            {
                "select_column": BarAgg.cols[params.order_by or "total_rows"],
                "BarAgg": BarAgg,
                "order_by": BarAgg.cols[params.order_by or "total_rows"],
                "start_day": params.start_day,
                "end_day": params.end_day,
                "limit": params.limit
            },
            QueryResult
        )
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions (validation errors)
        raise
    except Exception as e:
     
        # Handle specific error types
        if "connection" in str(e).lower() or "database" in str(e).lower():
            raise HTTPException(
                status_code=503,
                detail="Database connection error. Please try again later."
            )
        elif "syntax" in str(e).lower() or "sql" in str(e).lower():
            raise HTTPException(
                status_code=500,
                detail="Query execution error. Please contact support."
            )
        else:
            raise HTTPException(
                status_code=500,
                detail="Internal server error during data retrieval"
            )


@api.post("/bar", response_model=InsertResponse)
def post_bar_data(data: List[BarModel]):
    """
    Insert bar data into the database with comprehensive error handling.
    
    Returns detailed information about the insertion results including:
    - Number of successful and failed records
    - Detailed error information for failed records
    - Appropriate HTTP status codes
    """
    if not data:
        raise HTTPException(
            status_code=400,
            detail="No data provided. At least one record is required."
        )
    
    try:
        # Perform the insert operation
        result = BarTable.insert(data)
        
        # Prepare error details if there are failed records
        error_details = None
        if result.failed_records:
            error_details = []
            for failed_record in result.failed_records:
                error_detail = {
                    "record_index": getattr(failed_record, 'index', -1),
                    "error_message": str(failed_record.error),
                    "field_errors": getattr(failed_record, 'field_errors', None)
                }
                error_details.append(error_detail)
        
        # Determine response based on results
        if result.failed == 0:
            # All records successful
            return InsertResponse(
                message="All data inserted successfully",
                successful_count=result.successful,
                failed_count=result.failed,
                total_count=result.total,
                errors=None
            )
        elif result.successful == 0:
            # All records failed
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "All records failed validation or insertion",
                    "successful_count": result.successful,
                    "failed_count": result.failed,
                    "total_count": result.total,
                    "errors": error_details
                }
            )
        else:
            # Partial success - some records failed
            return InsertResponse(
                message=f"Partial success: {result.successful} records inserted, {result.failed} records failed",
                successful_count=result.successful,
                failed_count=result.failed,
                total_count=result.total,
                errors=error_details
            )
            
    except Exception as e:        
        # Handle specific error types
        if "validation" in str(e).lower():
            raise HTTPException(
                status_code=422,
                detail=f"Data validation error: {str(e)}"
            )
        elif "connection" in str(e).lower() or "database" in str(e).lower():
            raise HTTPException(
                status_code=503,
                detail="Database connection error. Please try again later."
            )
        else:
            raise HTTPException(
                status_code=500,
                detail="Internal server error during data insertion"
            )
