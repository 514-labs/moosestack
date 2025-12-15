"""
API definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining and configuring APIs
that allow querying data through user-defined functions.
"""

import os
from typing import Any, Callable, Optional, Tuple, Generic

import requests
from pydantic import BaseModel
from pydantic.json_schema import JsonSchemaValue

from .types import BaseTypedResource, T, U
from ._registry import _apis, _api_name_aliases, _api_path_map

# Global base URL configuration
_global_base_url: Optional[str] = None


def _generate_api_key(name: str, version: Optional[str] = None) -> str:
    return f"{name}:{version}" if version else name


def set_moose_base_url(url: str) -> None:
    """Set the global base URL for API calls.

    Args:
        url: The base URL to use for API calls
    """
    global _global_base_url
    _global_base_url = url


def get_moose_base_url() -> Optional[str]:
    """Get the configured base URL from global setting or environment variable.

    Returns:
        The base URL if configured, None otherwise
    """
    # Priority: programmatically set > environment variable
    if _global_base_url:
        return _global_base_url
    return os.getenv("MOOSE_BASE_URL")


class ApiConfig(BaseModel):
    """Configuration for APIs.

    Attributes:
        version: Optional version string.
        path: Optional custom path for the API endpoint. If not specified, defaults to the API name.
        metadata: Optional metadata for the API.
    """

    version: Optional[str] = None
    path: Optional[str] = None
    metadata: Optional[dict] = None


class Api(BaseTypedResource, Generic[U]):
    """Represents a API endpoint.

    Allows querying data, typically powered by a user-defined function.
    Requires two Pydantic models: `T` for query parameters and `U` for the response body.

    Args:
        name: The name of the API endpoint.
        query_function: The callable that executes the query logic.
                      It receives parameters matching model `T` (and potentially
                      other runtime utilities) and should return data matching model `U`.
        config: Optional configuration (currently only `version`).
        t: A tuple containing the input (`T`) and output (`U`) Pydantic models
           (passed via `Api[InputModel, OutputModel](...)`).

    Attributes:
        config (ApiConfig): Configuration for the API.
        query_function (Callable[..., U]): The handler function for the API.
        name (str): The name of the API.
        model_type (type[T]): The Pydantic model for the input/query parameters.
        return_type (type[U]): The Pydantic model for the response body.
    """

    config: ApiConfig
    query_function: Callable[..., U]
    _u: type[U]

    def __class_getitem__(cls, items):
        # Handle two type parameters
        if not isinstance(items, tuple) or len(items) != 2:
            raise ValueError(
                f"Use `{cls.__name__}[T, U](name='...')` to supply both input and output types"
            )
        input_type, output_type = items

        def curried_constructor(*args, **kwargs):
            return cls(t=(input_type, output_type), *args, **kwargs)

        return curried_constructor

    def __init__(
        self,
        name: str,
        query_function: Callable[..., U],
        config: ApiConfig = None,
        version: str = None,
        **kwargs,
    ):
        super().__init__()
        self._set_type(name, self._get_type(kwargs))

        # Handle config and version parameters properly
        if config is not None:
            # If config is provided, use it as base
            if version is not None:
                # If version is also provided, update the config's version
                self.config = ApiConfig(version=version, metadata=config.metadata)
            else:
                # Use the provided config as-is
                self.config = config
        elif version is not None:
            # Only version provided, create new config with version
            self.config = ApiConfig(version=version)
        else:
            # Neither provided, use default config
            self.config = ApiConfig()

        self.query_function = query_function
        self.metadata = getattr(self.config, "metadata", {}) or {}
        key = _generate_api_key(name, self.config.version)

        # Check for duplicate registration
        if key in _apis:
            raise ValueError(
                f"Consumption API with name {name} and version {self.config.version} already exists"
            )
        _apis[key] = self

        # Register by custom path if provided
        if self.config.path:
            # For unversioned APIs or when path should be used as-is
            if self.config.version is None:
                # Check for collision
                if self.config.path in _api_path_map:
                    existing = _api_path_map[self.config.path]
                    raise ValueError(
                        f'Cannot register API "{name}" with custom path "{self.config.path}" - '
                        f'this path is already used by API "{existing.name}"'
                    )
                # Only register unversioned path for unversioned APIs
                _api_path_map[self.config.path] = self
            else:
                # For versioned APIs, check if version is already in the path
                path_ends_with_version = (
                    self.config.path.endswith(f"/{self.config.version}")
                    or self.config.path == self.config.version
                    or (
                        self.config.path.endswith(self.config.version)
                        and len(self.config.path) > len(self.config.version)
                        and self.config.path[-(len(self.config.version) + 1)] == "/"
                    )
                )

                if path_ends_with_version:
                    # Path already contains version, check for collision
                    if self.config.path in _api_path_map:
                        existing = _api_path_map[self.config.path]
                        raise ValueError(
                            f'Cannot register API "{name}" with path "{self.config.path}" - '
                            f'this path is already used by API "{existing.name}"'
                        )
                    _api_path_map[self.config.path] = self
                else:
                    # Path doesn't contain version, register with version appended
                    path_with_version = (
                        f"{self.config.path.rstrip('/')}/{self.config.version}"
                    )

                    # Check for collision on versioned path
                    if path_with_version in _api_path_map:
                        existing = _api_path_map[path_with_version]
                        raise ValueError(
                            f'Cannot register API "{name}" with path "{path_with_version}" - '
                            f'this path is already used by API "{existing.name}"'
                        )
                    _api_path_map[path_with_version] = self

                    # Also register the unversioned path if not already claimed
                    # (This is intentionally more permissive - first API gets the unversioned path)
                    if self.config.path not in _api_path_map:
                        _api_path_map[self.config.path] = self

        # Maintain alias for base name:
        # - If explicit unversioned registered, alias -> that
        # - Else, if exactly one versioned exists, alias -> that
        base = name
        if self.config.version is None:
            _api_name_aliases[base] = self
            return

        # Versioned registration: only adjust alias if no explicit unversioned exists
        if base in _apis:
            # Explicit unversioned present, ensure alias points to it
            _api_name_aliases[base] = _apis[base]
            return

        # Determine if there is exactly one versioned API
        prefix = f"{base}:"
        # Early exit on 2 matches to avoid O(n) counting
        match_count = 0
        sole = None
        for k in _apis.keys():
            if k.startswith(prefix):
                match_count += 1
                sole = _apis[k]
                if match_count > 1:
                    break
        if match_count == 1 and sole is not None:
            _api_name_aliases[base] = sole
        else:
            _api_name_aliases.pop(base, None)

    @classmethod
    def _get_type(cls, keyword_args: dict):
        t = keyword_args.get("t")
        if not isinstance(t, tuple) or len(t) != 2:
            raise ValueError(
                f"Use `{cls.__name__}[T, U](name='...')` to supply both input and output types"
            )

        input_type, output_type = t
        if not isinstance(input_type, type) or not issubclass(input_type, BaseModel):
            raise ValueError(f"Input type {input_type} is not a Pydantic model")
        if not isinstance(output_type, type) or not issubclass(output_type, BaseModel):
            raise ValueError(f"Output type {output_type} is not a Pydantic model")
        return t

    def _set_type(self, name: str, t: Tuple[type[T], type[U]]):
        input_type, output_type = t
        self._t = input_type
        self._u = output_type
        self.name = name

    def return_type(self) -> type[U]:
        """Get the Pydantic model type for the API's response body."""
        return self._u

    def get_response_schema(self) -> JsonSchemaValue:
        """Generates the JSON schema for the API's response body model (`U`).

        Returns:
            A dictionary representing the JSON schema.
        """
        from pydantic.type_adapter import TypeAdapter

        return TypeAdapter(self.return_type()).json_schema(
            ref_template="#/components/schemas/{model}"
        )

    def call(self, params: T, base_url: Optional[str] = None) -> U:
        """Call the API with the given parameters.

        Args:
            params: Parameters matching the input model T
            base_url: Optional base URL override. If not provided, uses the global
                     base URL set via set_base_url() or MOOSE_BASE_URL environment variable.

        Returns:
            Response data matching the output model U

        Raises:
            ValueError: If no base URL is configured
        """
        # Determine which base URL to use
        effective_base_url = base_url or get_moose_base_url()
        if not effective_base_url:
            raise ValueError(
                "No base URL configured. Set it via set_base_url(), "
                "MOOSE_BASE_URL environment variable, or pass base_url parameter."
            )

        # Construct the API endpoint URL using custom path or default to name
        if self.config.path:
            # Check if the custom path already contains the version
            if self.config.version:
                path_ends_with_version = (
                    self.config.path.endswith(f"/{self.config.version}")
                    or self.config.path == self.config.version
                    or (
                        self.config.path.endswith(self.config.version)
                        and len(self.config.path) > len(self.config.version)
                        and self.config.path[-(len(self.config.version) + 1)] == "/"
                    )
                )
                if path_ends_with_version:
                    path = self.config.path
                else:
                    path = f"{self.config.path.rstrip('/')}/{self.config.version}"
            else:
                path = self.config.path
        else:
            # Default to name with optional version
            path = (
                self.name
                if not self.config.version
                else f"{self.name}/{self.config.version}"
            )
        url = f"{effective_base_url.rstrip('/')}/api/{path}"

        # Convert Pydantic model to dictionary
        params_dict = params.model_dump()

        # Build query parameters, handling lists as repeated params
        query_params = []
        for key, value in params_dict.items():
            if isinstance(value, list):
                # For list values, add each item as a separate query param
                for item in value:
                    query_params.append((key, str(item)))
            elif value is not None:
                query_params.append((key, str(value)))

        # Make the HTTP request
        response = requests.get(url, params=query_params)
        response.raise_for_status()  # Raise an exception for bad status codes

        # Parse JSON response and return as the expected type
        response_data = response.json()
        return self._u.model_validate(response_data)


# Backward compatibility aliases (deprecated)
ConsumptionApi = Api
"""@deprecated: Use Api instead of ConsumptionApi"""

EgressConfig = ApiConfig
"""@deprecated: Use ApiConfig instead of EgressConfig"""
