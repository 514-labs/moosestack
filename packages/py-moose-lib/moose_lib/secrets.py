"""Utilities for runtime secret resolution from environment variables.

This module provides functionality to mark values that should be resolved
from environment variables at runtime by the Moose CLI, rather than being
embedded at build time.

Example:
    >>> from moose_lib import S3QueueEngine, moose_env_secrets
    >>>
    >>> engine = S3QueueEngine(
    ...     s3_path="s3://bucket/data/*.json",
    ...     format="JSONEachRow",
    ...     aws_access_key_id=moose_env_secrets.get("AWS_ACCESS_KEY_ID"),
    ...     aws_secret_access_key=moose_env_secrets.get("AWS_SECRET_ACCESS_KEY")
    ... )
"""

#: Prefix used to mark values for runtime environment variable resolution.
MOOSE_ENV_SECRET_PREFIX = "__MOOSE_ENV_SECRET__:"


def get(env_var_name: str) -> str:
    """Marks a value to be resolved from an environment variable at runtime.

    When you use this function, the value is not read immediately. Instead,
    a special marker is created that the Moose CLI will resolve when it
    processes your infrastructure configuration.

    This ensures that:
    - Credentials are never embedded in Docker images
    - Secrets can be rotated without rebuilding
    - Different environments can use different credentials

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
        >>> aws_key = moose_env_secrets.get("AWS_ACCESS_KEY_ID")
    """
    if not env_var_name or not env_var_name.strip():
        raise ValueError("Environment variable name cannot be empty")
    return f"{MOOSE_ENV_SECRET_PREFIX}{env_var_name}"


class MooseEnvSecrets:
    """Utilities for marking values to be resolved from environment variables at runtime.

    This class provides a namespace for secret resolution utilities. Use the
    singleton instance `moose_env_secrets` rather than instantiating this class directly.

    Attributes:
        get: Static method for creating runtime secret markers
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
moose_env_secrets = MooseEnvSecrets()

__all__ = ["moose_env_secrets", "MooseEnvSecrets", "get", "MOOSE_ENV_SECRET_PREFIX"]
