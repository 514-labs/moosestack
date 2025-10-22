"""
Example BYOF (Bring Your Own Framework) FastAPI app

This file demonstrates how to use FastAPI with MooseStack for consumption
APIs using the WebApp class.
"""
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from moose_lib.dmv2 import WebApp, WebAppConfig, WebAppMetadata
from moose_lib.dmv2.web_app_helpers import get_moose_utils
from app.db.views import BarAggregatedMV
from pydantic import BaseModel
from typing import Optional, List

app = FastAPI()


# Middleware to log requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"[bar.py] {request.method} {request.url.path}")
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
        # Build the query
        query = f"""
            SELECT
                day_of_month,
                total_rows
            FROM BarAggregated
            ORDER BY total_rows DESC
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
        # Validate order_by field
        valid_fields = ["total_rows", "rows_with_text", "max_text_length", "total_text_length"]
        if body.order_by not in valid_fields:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid order_by field: {body.order_by}"
            )

        query = f"""
            SELECT
                day_of_month,
                {body.order_by}
            FROM BarAggregated
            WHERE
                day_of_month >= {body.start_day}
                AND day_of_month <= {body.end_day}
            ORDER BY {body.order_by} DESC
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
bar_webapp_api = WebApp(
    "barFastAPI",
    app,
    WebAppConfig(
        mount_path="/fastapi",
        metadata=WebAppMetadata(
            description="FastAPI API with middleware demonstrating WebApp integration"
        ),
    )
)
