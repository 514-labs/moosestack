"""
WebApp support for Python - bring your own FastAPI application.

This module allows developers to register FastAPI applications as WebApp resources
that are managed by the Moose infrastructure, similar to other resources like
OlapTables, Streams, and APIs.
"""

from typing import Optional, Dict, Any
from dataclasses import dataclass


# Reserved mount paths that cannot be used by WebApps
RESERVED_MOUNT_PATHS = [
    "/admin",
    "/api",
    "/consumption",
    "/health",
    "/ingest",
    "/moose",  # reserved for future use
    "/ready",
    "/workflows",
]


@dataclass
class WebAppMetadata:
    """Metadata for a WebApp.

    Attributes:
        description: Optional description of the WebApp's purpose.
    """

    description: Optional[str] = None


@dataclass
class WebAppConfig:
    """Configuration for a WebApp.

    Attributes:
        mount_path: The URL path where the WebApp will be mounted (required).
                   Cannot be "/" (root path).
                   Cannot end with "/" (trailing slash).
                   Cannot start with reserved paths.
        metadata: Optional metadata for documentation purposes.
        inject_moose_utils: Whether to inject MooseClient utilities into requests.
                           Defaults to True.
    """

    mount_path: str
    metadata: Optional[WebAppMetadata] = None
    inject_moose_utils: bool = True


class WebApp:
    """A WebApp resource that wraps a FastAPI application.

    WebApps are managed by the Moose infrastructure and automatically
    proxied through the Rust webserver, allowing them to coexist with
    other Moose resources on the same port.

    Example:
        ```python
        from fastapi import FastAPI, Request
        from moose_lib.dmv2 import WebApp, WebAppConfig, WebAppMetadata
        from moose_lib.dmv2.web_app_helpers import get_moose_utils

        app = FastAPI()

        @app.get("/hello")
        async def hello(request: Request):
            moose = get_moose_utils(request)
            # Use moose.client for queries
            return {"message": "Hello World"}

        # Register as a WebApp with custom mount path
        my_webapp = WebApp(
            "myApi",
            app,
            WebAppConfig(
                mount_path="/myapi",
                metadata=WebAppMetadata(description="My custom API"),
            )
        )
        ```

    Args:
        name: Unique name for this WebApp.
        app: The FastAPI application instance.
        config: Configuration for the WebApp (required, must include mount_path).

    Raises:
        ValueError: If validation fails (duplicate name, invalid mount path, etc.)
    """

    def __init__(
        self,
        name: str,
        app: Any,  # FastAPI app, typed as Any to avoid import dependency
        config: WebAppConfig,
    ):
        self.name = name
        self.app = app
        self.config = config

        # Import the registry here to avoid circular dependency
        from ._registry import _web_apps

        # Validate the configuration
        self._validate(name, self.config, _web_apps)

        # Register this WebApp
        _web_apps[name] = self

    @staticmethod
    def _validate(
        name: str, config: WebAppConfig, existing_web_apps: Dict[str, "WebApp"]
    ) -> None:
        """Validate WebApp configuration.

        Args:
            name: The name of the WebApp being validated.
            config: The configuration to validate.
            existing_web_apps: Dictionary of already registered WebApps.

        Raises:
            ValueError: If validation fails.
        """
        # Check for duplicate name
        if name in existing_web_apps:
            raise ValueError(f"WebApp with name '{name}' already exists")

        # Validate mountPath - it is required
        if not config.mount_path:
            raise ValueError(
                f'mountPath is required. Please specify a mount path for your WebApp (e.g., "/myapi").'
            )

        mount_path = config.mount_path

        # Check for root path - not allowed as it would overlap reserved paths
        if mount_path == "/":
            raise ValueError(
                f'mountPath cannot be "/" as it would allow routes to overlap with reserved paths: '
                f"{', '.join(RESERVED_MOUNT_PATHS)}"
            )

        # Validate mount path format
        if mount_path.endswith("/"):
            raise ValueError(
                f"mountPath cannot end with a trailing slash. "
                f"Remove the '/' from: \"{mount_path}\""
            )

        # Check for reserved path prefixes
        for reserved in RESERVED_MOUNT_PATHS:
            if mount_path == reserved or mount_path.startswith(f"{reserved}/"):
                raise ValueError(
                    f"mountPath cannot begin with a reserved path: "
                    f"{', '.join(RESERVED_MOUNT_PATHS)}. "
                    f'Got: "{mount_path}"'
                )

        # Check for duplicate mount path
        for existing_name, existing_app in existing_web_apps.items():
            existing_mount = existing_app.config.mount_path
            if existing_mount == mount_path:
                raise ValueError(
                    f'WebApp with mountPath "{mount_path}" already exists '
                    f'(used by WebApp "{existing_name}")'
                )

    def __repr__(self) -> str:
        return f"WebApp(name='{self.name}', mount_path='{self.config.mount_path}')"
