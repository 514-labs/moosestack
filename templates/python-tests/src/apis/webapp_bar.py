"""
Example BYOF (Bring Your Own Framework) FastAPI app for python-tests template

This file demonstrates how to use FastAPI with MooseStack for consumption
APIs using the WebApp class.
"""
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from moose_lib.dmv2 import WebApp, WebAppConfig, WebAppMetadata
from moose_lib.dmv2.web_app_helpers import get_moose_utils
from src.views.bar_aggregated import barAggregatedMV
from pydantic import BaseModel
from typing import Optional

app = FastAPI()


# Middleware to log requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"[webapp_bar.py] {request.method} {request.url.path}")
    response = await call_next(request)
    return response


# Health check endpoint
@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "timestamp": str(__import__("datetime").datetime.now()),
        "service": "bar-fastapi-api",
    }


# Query endpoint
@app.get("/query")
async def query(request: Request, limit: int = 10):
    """
    Query aggregated bar data.

    This endpoint demonstrates:
    - Accessing MooseStack utilities via get_moose_utils
    - Using the QueryClient to execute queries
    - Using the sql function for safe query building
    """
    moose = get_moose_utils(request)
    if not moose:
        raise HTTPException(
            status_code=500,
            detail="MooseStack utilities not available"
        )

    try:
        # Get the target table
        target_table = barAggregatedMV.target_table

        # Build the query
        query = f"""
            SELECT
                {target_table.cols.day_of_month},
                {target_table.cols.total_rows}
            FROM {target_table.name}
            ORDER BY {target_table.cols.total_rows} DESC
            LIMIT {limit}
        """

        result = moose.client.query.execute(query)

        return {
            "success": True,
            "count": len(result),
            "data": result,
        }
    except Exception as error:
        print(f"Query error: {error}")
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# POST endpoint for filtered data
class DataRequest(BaseModel):
    order_by: str = "total_rows"
    limit: int = 5
    start_day: int = 1
    end_day: int = 31


@app.post("/data")
async def data(request: Request, body: DataRequest):
    """
    Query aggregated bar data with filters.

    This endpoint demonstrates:
    - POST request handling
    - Request body validation with Pydantic
    - Dynamic query building based on request parameters
    """
    moose = get_moose_utils(request)
    if not moose:
        raise HTTPException(
            status_code=500,
            detail="MooseStack utilities not available"
        )

    try:
        # Get the target table
        target_table = barAggregatedMV.target_table

        # Map the order_by field to the column
        order_by_column = getattr(target_table.cols, body.order_by, None)
        if not order_by_column:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid order_by field: {body.order_by}"
            )

        query = f"""
            SELECT
                {target_table.cols.day_of_month},
                {order_by_column}
            FROM {target_table.name}
            WHERE
                {target_table.cols.day_of_month} >= {body.start_day}
                AND {target_table.cols.day_of_month} <= {body.end_day}
            ORDER BY {order_by_column} DESC
            LIMIT {body.limit}
        """

        result = moose.client.query.execute(query)

        return {
            "success": True,
            "params": body.model_dump(),
            "count": len(result),
            "data": result,
        }
    except HTTPException:
        raise
    except Exception as error:
        print(f"Query error: {error}")
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# Protected endpoint (requires JWT)
@app.get("/protected")
async def protected(request: Request):
    """
    Protected endpoint that requires authentication.

    This endpoint demonstrates:
    - JWT authentication
    - Accessing JWT claims from the request
    """
    moose = get_moose_utils(request)
    if not moose or not moose.jwt:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized - JWT token required"
        )

    return {
        "message": "You are authenticated",
        "user": moose.jwt.get("sub"),
        "claims": moose.jwt,
    }


# Error handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global error handler for unhandled exceptions"""
    print(f"FastAPI error: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": str(exc),
        }
    )


# Register as a WebApp with custom mount path
bar_webapp = WebApp(
    "barFastAPI",
    app,
    WebAppConfig(
        mount_path="/fastapi",
        metadata=WebAppMetadata(
            description="FastAPI API with middleware demonstrating WebApp integration"
        ),
    )
)
