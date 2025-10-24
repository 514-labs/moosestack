"""
Example BYOF (Bring Your Own Framework) FastAPI app for python-tests template

This file demonstrates how to use FastAPI with MooseStack for consumption
APIs using the WebApp class.
"""
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from moose_lib.dmv2 import WebApp, WebAppConfig, WebAppMetadata
from moose_lib.dmv2.web_app_helpers import get_moose_utils
from src.views.bar_aggregated import barAggregatedMV
from pydantic import BaseModel, Field
from typing import Literal
from datetime import datetime

app = FastAPI()


# Middleware to log requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"[webapp_bar.py] {request.method} {request.url.path}")
    response = await call_next(request)
    return response


# JWT authentication dependency
async def require_auth(request: Request):
    """Require JWT authentication for protected endpoints"""
    moose = get_moose_utils(request)
    if not moose or not moose.jwt:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized - JWT token required"
        )
    return moose


# Health check endpoint
@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "service": "bar-fastapi-api",
    }


# Query endpoint with URL parameters
@app.get("/query")
async def query(request: Request, limit: int = 10):
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
            status_code=500,
            detail="MooseStack utilities not available"
        )

    try:
        # Build the query
        query_str = f"""
            SELECT
                day_of_month,
                total_rows
            FROM bar_aggregated
            ORDER BY total_rows DESC
            LIMIT {limit}
        """

        result = moose.client.query.execute(query_str)

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


# POST endpoint with request body validation
class DataRequest(BaseModel):
    """Request body for /data endpoint"""
    order_by: Literal["total_rows", "rows_with_text", "max_text_length", "total_text_length"] = Field(
        default="total_rows",
        description="Column to order by"
    )
    limit: int = Field(
        default=5,
        gt=0,
        le=100,
        description="Number of records to return"
    )
    start_day: int = Field(
        default=1,
        gt=0,
        le=31,
        description="Start day of month"
    )
    end_day: int = Field(
        default=31,
        gt=0,
        le=31,
        description="End day of month"
    )


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
        # Build the query with parameters
        query_str = f"""
            SELECT
                day_of_month,
                {body.order_by}
            FROM bar_aggregated
            WHERE
                day_of_month >= {body.start_day}
                AND day_of_month <= {body.end_day}
            ORDER BY {body.order_by} DESC
            LIMIT {body.limit}
        """

        result = moose.client.query.execute(query_str)

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
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# Protected endpoint requiring JWT authentication
@app.get("/protected")
async def protected(moose=Depends(require_auth)):
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
async def global_exception_handler(request: Request, exc: Exception):
    print(f"FastAPI error: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": str(exc),
        }
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
    )
)
