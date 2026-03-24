"""
Example BYOF (Bring Your Own Framework) FastAPI app

This file demonstrates how to use FastAPI with MooseStack for consumption
APIs using the WebApp class.
"""

from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from moose_lib.dmv2 import WebApp, WebAppConfig, WebAppMetadata
from moose_lib.dmv2.web_app_helpers import ApiUtil, get_moose_utils
from pydantic import BaseModel, Field

app = FastAPI()


# Middleware to log requests
@app.middleware("http")
async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    print(f"[bar.py] {request.method} {request.url.path}")
    response = await call_next(request)
    return response


# JWT authentication dependency
async def require_auth(request: Request) -> ApiUtil:
    """Require JWT authentication for protected endpoints"""
    moose = get_moose_utils(request)
    if not moose or not moose.jwt:
        raise HTTPException(status_code=401, detail="Unauthorized - JWT token required")
    return moose


# Health check endpoint
@app.get("/health")
async def health() -> dict:
    """Health check endpoint"""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "bar-fastapi-api",
    }


# Query endpoint with URL parameters
@app.get("/query")
async def query(request: Request, limit: int = Query(default=10, gt=0, le=100)) -> dict:
    """
    Query aggregated bar data.

    This endpoint demonstrates:
    - Accessing MooseStack utilities via get_moose_utils
    - Using the QueryClient to execute queries
    - Using query parameters for filtering
    """
    moose = get_moose_utils(request)
    if not moose:
        raise HTTPException(
            status_code=500, detail="MooseStack utilities not available"
        )

    try:
        # Build the query with safe parameterization
        query_str = """
            SELECT
                day_of_month,
                total_rows
            FROM BarAggregated
            ORDER BY total_rows DESC
            LIMIT {limit}
        """

        result = moose.client.query.execute(query_str, {"limit": limit})

        return {
            "success": True,
            "count": len(result),
            "data": result,
        }
    except Exception as error:
        print(f"Query error: {error}")
        raise HTTPException(status_code=500, detail="Query execution failed") from error


# POST endpoint with request body validation
class DataRequest(BaseModel):
    """Request body for /data endpoint"""

    order_by: Literal[
        "total_rows", "rows_with_text", "max_text_length", "total_text_length"
    ] = Field(default="total_rows", description="Column to order by")
    limit: int = Field(
        default=5, gt=0, le=100, description="Number of records to return"
    )
    start_day: int = Field(default=1, gt=0, le=31, description="Start day of month")
    end_day: int = Field(default=31, gt=0, le=31, description="End day of month")


@app.post("/data")
async def data(request: Request, body: DataRequest) -> dict:
    """
    Query aggregated bar data with filters.

    This endpoint demonstrates:
    - POST request handling
    - Request body validation with Pydantic
    - Dynamic query building based on request parameters
    """
    if body.start_day > body.end_day:
        raise HTTPException(
            status_code=422,
            detail="start_day must be less than or equal to end_day",
        )

    moose = get_moose_utils(request)
    if not moose:
        raise HTTPException(
            status_code=500, detail="MooseStack utilities not available"
        )

    try:
        # Build the query - column identifiers use f-string (safe: validated by Literal type),
        # value parameters use ClickHouse parameterization
        query_str = f"""
            SELECT
                day_of_month,
                {body.order_by}
            FROM BarAggregated
            WHERE
                day_of_month >= {{start_day}}
                AND day_of_month <= {{end_day}}
            ORDER BY {body.order_by} DESC
            LIMIT {{limit}}
        """

        result = moose.client.query.execute(
            query_str,
            {
                "start_day": body.start_day,
                "end_day": body.end_day,
                "limit": body.limit,
            },
        )

        return {
            "success": True,
            "params": {
                "order_by": body.order_by,
                "limit": body.limit,
                "start_day": body.start_day,
                "end_day": body.end_day,
            },
            "count": len(result),
            "data": result,
        }
    except Exception as error:
        print(f"Query error: {error}")
        raise HTTPException(status_code=500, detail="Query execution failed") from error


# Protected endpoint requiring JWT authentication
@app.get("/protected")
async def protected(moose: ApiUtil = Depends(require_auth)) -> dict:
    """
    Protected endpoint requiring JWT authentication.

    This endpoint demonstrates:
    - JWT token validation
    - Accessing JWT claims
    """
    return {
        "message": "You are authenticated",
        "user": moose.jwt.get("sub") if moose.jwt else None,
        "claims": moose.jwt,
    }


# Global error handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    print(f"FastAPI error: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
        },
    )


# Register the FastAPI app as a WebApp
bar_fastapi_app = WebApp(
    "barFastApi",
    app,
    WebAppConfig(
        mount_path="/fastapi",
        metadata=WebAppMetadata(
            description="FastAPI WebApp with middleware demonstrating WebApp integration"
        ),
    ),
)
