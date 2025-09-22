"""
Runtime configuration management for Moose.

This module provides a singleton registry for managing runtime configuration settings,
particularly for ClickHouse connections.
"""
import os
from dataclasses import dataclass
from typing import Optional

@dataclass
class RuntimeClickHouseConfig:
    """Runtime ClickHouse configuration settings."""
    host: str
    port: str
    username: str
    password: str
    database: str
    use_ssl: bool

class ConfigurationRegistry:
    """Singleton registry for managing runtime configuration.

    This class provides a centralized way to manage and access runtime configuration
    settings, with fallback to file-based configuration when runtime settings are not set.
    """
    _instance: Optional['ConfigurationRegistry'] = None
    _clickhouse_config: Optional[RuntimeClickHouseConfig] = None

    @classmethod
    def get_instance(cls) -> 'ConfigurationRegistry':
        """Get the singleton instance of ConfigurationRegistry.

        Returns:
            The singleton ConfigurationRegistry instance.
        """
        if not cls._instance:
            cls._instance = cls()
        return cls._instance

    def set_clickhouse_config(self, config: RuntimeClickHouseConfig) -> None:
        """Set the runtime ClickHouse configuration.

        Args:
            config: The ClickHouse configuration to use.
        """
        self._clickhouse_config = config

    def get_clickhouse_config(self) -> RuntimeClickHouseConfig:
        """Get the current ClickHouse configuration.

        If runtime configuration is not set, falls back to reading from moose.config.toml.

        Returns:
            The current ClickHouse configuration.
        """
        if self._clickhouse_config:
            return self._clickhouse_config

        # Fallback to reading from config file
        from .config_file import read_project_config

        def _env(name: str) -> Optional[str]:
            val = os.environ.get(name)
            if val is None:
                return None
            trimmed = val.strip()
            return trimmed if trimmed else None

        def _parse_bool(val: Optional[str]) -> Optional[bool]:
            if val is None:
                return None
            v = val.strip().lower()
            if v in ("1", "true", "yes", "on"):
                return True
            if v in ("0", "false", "no", "off"):
                return False
            return None

        try:
            config = read_project_config()

            env_host = _env("MOOSE_CLICKHOUSE_CONFIG__HOST")
            env_port = _env("MOOSE_CLICKHOUSE_CONFIG__HOST_PORT")
            env_user = _env("MOOSE_CLICKHOUSE_CONFIG__USER")
            env_password = _env("MOOSE_CLICKHOUSE_CONFIG__PASSWORD")
            env_db = _env("MOOSE_CLICKHOUSE_CONFIG__DB_NAME")
            env_use_ssl = _parse_bool(_env("MOOSE_CLICKHOUSE_CONFIG__USE_SSL"))

            return RuntimeClickHouseConfig(
                host=env_host or config.clickhouse_config.host,
                port=(env_port or str(config.clickhouse_config.host_port)),
                username=env_user or config.clickhouse_config.user,
                password=env_password or config.clickhouse_config.password,
                database=env_db or config.clickhouse_config.db_name,
                use_ssl=(env_use_ssl if env_use_ssl is not None else config.clickhouse_config.use_ssl),
            )
        except Exception as e:
            raise RuntimeError(f"Failed to get ClickHouse configuration: {e}")

    def has_runtime_config(self) -> bool:
        """Check if runtime configuration is set.

        Returns:
            True if runtime configuration is set, False otherwise.
        """
        return self._clickhouse_config is not None

# Create singleton instance
config_registry = ConfigurationRegistry.get_instance()
