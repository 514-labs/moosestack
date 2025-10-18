"""
Helper utilities for WebApp integration with FastAPI.

This module provides utilities to access Moose services (ClickHouse, Temporal)
from within FastAPI request handlers.
"""
from typing import Optional, Any, Dict
from dataclasses import dataclass


@dataclass
class ApiUtil:
    """Utilities available to WebApp request handlers.

    Attributes:
        client: MooseClient instance for executing queries and workflows.
        sql: SQL template function for building safe queries.
        jwt: JWT payload if authentication is enabled, None otherwise.
    """
    client: Any  # MooseClient, typed as Any to avoid circular import
    sql: Any  # sql function from moose_lib.main
    jwt: Optional[Dict[str, Any]] = None


def get_moose_utils(request: Any) -> Optional[ApiUtil]:
    """Extract Moose utilities from a FastAPI request.

    The Moose infrastructure automatically injects utilities into request.state
    when inject_moose_utils is enabled (default).

    Args:
        request: FastAPI Request object.

    Returns:
        ApiUtil instance if available, None otherwise.

    Example:
        ```python
        from fastapi import FastAPI, Request
        from moose_lib.dmv2.web_app_helpers import get_moose_utils

        app = FastAPI()

        @app.get("/data")
        async def get_data(request: Request):
            moose = get_moose_utils(request)
            if not moose:
                return {"error": "Moose utilities not available"}

            # Execute a query
            result = moose.client.query.execute(
                moose.sql("SELECT * FROM my_table LIMIT {limit}", limit=10)
            )
            return result
        ```
    """
    # FastAPI uses request.state for storing custom data
    if hasattr(request, 'state') and hasattr(request.state, 'moose'):
        return request.state.moose
    return None


def get_moose_dependency():
    """FastAPI dependency for injecting Moose utilities.

    Can be used with FastAPI's Depends() to automatically inject
    Moose utilities into route handlers.

    Returns:
        A dependency function that extracts ApiUtil from the request.

    Example:
        ```python
        from fastapi import FastAPI, Depends, Request
        from moose_lib.dmv2.web_app_helpers import get_moose_dependency, ApiUtil

        app = FastAPI()

        @app.get("/data")
        async def get_data(moose: ApiUtil = Depends(get_moose_dependency())):
            # moose is automatically injected
            result = moose.client.query.execute(...)
            return result
        ```
    """
    def moose_dependency(request: Any) -> ApiUtil:
        moose = get_moose_utils(request)
        if moose is None:
            # This should rarely happen if inject_moose_utils=True
            raise RuntimeError("Moose utilities not available in request")
        return moose
    return moose_dependency
