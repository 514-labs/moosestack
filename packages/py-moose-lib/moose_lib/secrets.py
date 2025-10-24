"""Utilities for runtime environment variable resolution.

This module provides functionality to mark values that should be resolved
from environment variables at runtime by the Moose CLI, rather than being
embedded at build time.

Example:
    >>> from moose_lib import S3QueueEngine, moose_runtime_env
    >>>
    >>> engine = S3QueueEngine(
    ...     s3_path="s3://bucket/data/*.json",
    ...     format="JSONEachRow",
    ...     aws_access_key_id=moose_runtime_env.get("AWS_ACCESS_KEY_ID"),
    ...     aws_secret_access_key=moose_runtime_env.get("AWS_SECRET_ACCESS_KEY")
    ... )
"""

#: Prefix used to mark values for runtime environment variable resolution.
MOOSE_RUNTIME_ENV_PREFIX = "__MOOSE_RUNTIME_ENV__:"


def get(env_var_name: str) -> str:
    """Marks a value to be resolved from an environment variable at runtime.

    When you use this function, the value is not read immediately. Instead,
    a special marker is created that the Moose CLI will resolve when it
    processes your infrastructure configuration.

    This is useful for:
    - Credentials that should never be embedded in Docker images
    - Configuration that can be rotated without rebuilding
    - Different values for different environments (dev, staging, prod)
    - Any runtime configuration in infrastructure elements (Tables, Topics, etc.)

    Args:
        env_var_name: Name of the environment variable to resolve

    Returns:
        A marker string that Moose CLI will resolve at runtime

    Raises:
        ValueError: If the environment variable name is empty

    Example:
        >>> # Instead of this (evaluated at build time):
        >>> import os
        >>> aws_key = os.environ.get("AWS_ACCESS_KEY_ID")
        >>>
        >>> # Use this (evaluated at runtime):
        >>> aws_key = moose_runtime_env.get("AWS_ACCESS_KEY_ID")
    """
    if not env_var_name or not env_var_name.strip():
        raise ValueError("Environment variable name cannot be empty")
    return f"{MOOSE_RUNTIME_ENV_PREFIX}{env_var_name}"


class MooseRuntimeEnv:
    """Utilities for marking values to be resolved from environment variables at runtime.

    This class provides a namespace for runtime environment variable resolution.
    Use the singleton instance `moose_runtime_env` rather than instantiating this class directly.

    Attributes:
        get: Static method for creating runtime environment variable markers
    """

    @staticmethod
    def get(env_var_name: str) -> str:
        """Marks a value to be resolved from an environment variable at runtime.

        Args:
            env_var_name: Name of the environment variable to resolve

        Returns:
            A marker string that Moose CLI will resolve at runtime

        Raises:
            ValueError: If the environment variable name is empty
        """
        return get(env_var_name)


# Export singleton instance for module-level access
moose_runtime_env = MooseRuntimeEnv()

# Legacy exports for backwards compatibility
MooseEnvSecrets = MooseRuntimeEnv  # Deprecated: Use MooseRuntimeEnv instead
moose_env_secrets = moose_runtime_env  # Deprecated: Use moose_runtime_env instead
MOOSE_ENV_SECRET_PREFIX = MOOSE_RUNTIME_ENV_PREFIX  # Deprecated: Use MOOSE_RUNTIME_ENV_PREFIX instead

__all__ = [
    "moose_runtime_env",
    "MooseRuntimeEnv",
    "get",
    "MOOSE_RUNTIME_ENV_PREFIX",
    # Legacy exports (deprecated)
    "moose_env_secrets",
    "MooseEnvSecrets",
    "MOOSE_ENV_SECRET_PREFIX",
]
