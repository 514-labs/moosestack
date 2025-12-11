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


@dataclass
class RuntimeKafkaConfig:
    """Runtime Kafka configuration settings."""

    broker: str
    message_timeout_ms: int
    sasl_username: Optional[str]
    sasl_password: Optional[str]
    sasl_mechanism: Optional[str]
    security_protocol: Optional[str]
    namespace: Optional[str]
    schema_registry_url: Optional[str]


class ConfigurationRegistry:
    """Singleton registry for managing runtime configuration.

    This class provides a centralized way to manage and access runtime configuration
    settings, with fallback to file-based configuration when runtime settings are not set.
    """

    _instance: Optional["ConfigurationRegistry"] = None
    _clickhouse_config: Optional[RuntimeClickHouseConfig] = None
    _kafka_config: Optional[RuntimeKafkaConfig] = None

    @classmethod
    def get_instance(cls) -> "ConfigurationRegistry":
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

    def set_kafka_config(self, config: "RuntimeKafkaConfig") -> None:
        """Set the runtime Kafka configuration.

        Args:
            config: The Kafka configuration to use.
        """
        self._kafka_config = config

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
                use_ssl=(
                    env_use_ssl
                    if env_use_ssl is not None
                    else config.clickhouse_config.use_ssl
                ),
            )
        except Exception as e:
            raise RuntimeError(f"Failed to get ClickHouse configuration: {e}")

    def get_kafka_config(self) -> "RuntimeKafkaConfig":
        """Get the current Kafka configuration.

        If runtime configuration is not set, falls back to reading from moose.config.toml
        and environment variables (Redpanda- and Kafka-prefixed).

        Returns:
            The current Kafka configuration.
        """
        if self._kafka_config:
            return self._kafka_config

        from .config_file import read_project_config

        def _env(name: str) -> Optional[str]:
            val = os.environ.get(name)
            if val is None:
                return None
            trimmed = val.strip()
            return trimmed if trimmed else None

        try:
            config = read_project_config()

            # Prefer Redpanda-prefixed env vars; fallback to Kafka-prefixed
            broker = _env("MOOSE_REDPANDA_CONFIG__BROKER") or _env(
                "MOOSE_KAFKA_CONFIG__BROKER"
            )
            message_timeout_ms = _env(
                "MOOSE_REDPANDA_CONFIG__MESSAGE_TIMEOUT_MS"
            ) or _env("MOOSE_KAFKA_CONFIG__MESSAGE_TIMEOUT_MS")
            sasl_username = _env("MOOSE_REDPANDA_CONFIG__SASL_USERNAME") or _env(
                "MOOSE_KAFKA_CONFIG__SASL_USERNAME"
            )
            sasl_password = _env("MOOSE_REDPANDA_CONFIG__SASL_PASSWORD") or _env(
                "MOOSE_KAFKA_CONFIG__SASL_PASSWORD"
            )
            sasl_mechanism = _env("MOOSE_REDPANDA_CONFIG__SASL_MECHANISM") or _env(
                "MOOSE_KAFKA_CONFIG__SASL_MECHANISM"
            )
            security_protocol = _env(
                "MOOSE_REDPANDA_CONFIG__SECURITY_PROTOCOL"
            ) or _env("MOOSE_KAFKA_CONFIG__SECURITY_PROTOCOL")
            namespace = _env("MOOSE_REDPANDA_CONFIG__NAMESPACE") or _env(
                "MOOSE_KAFKA_CONFIG__NAMESPACE"
            )
            schema_registry_url = _env(
                "MOOSE_REDPANDA_CONFIG__SCHEMA_REGISTRY_URL"
            ) or _env("MOOSE_KAFKA_CONFIG__SCHEMA_REGISTRY_URL")

            file_kafka = config.kafka_config

            def _to_int(value: Optional[str], fallback: int) -> int:
                try:
                    return int(value) if value is not None else fallback
                except Exception:
                    return fallback

            return RuntimeKafkaConfig(
                broker=broker
                or (file_kafka.broker if file_kafka else "localhost:19092"),
                message_timeout_ms=_to_int(
                    message_timeout_ms,
                    file_kafka.message_timeout_ms if file_kafka else 1000,
                ),
                sasl_username=(
                    sasl_username
                    if sasl_username is not None
                    else (file_kafka.sasl_username if file_kafka else None)
                ),
                sasl_password=(
                    sasl_password
                    if sasl_password is not None
                    else (file_kafka.sasl_password if file_kafka else None)
                ),
                sasl_mechanism=(
                    sasl_mechanism
                    if sasl_mechanism is not None
                    else (file_kafka.sasl_mechanism if file_kafka else None)
                ),
                security_protocol=(
                    security_protocol
                    if security_protocol is not None
                    else (file_kafka.security_protocol if file_kafka else None)
                ),
                namespace=(
                    namespace
                    if namespace is not None
                    else (file_kafka.namespace if file_kafka else None)
                ),
                schema_registry_url=(
                    schema_registry_url
                    if schema_registry_url is not None
                    else (file_kafka.schema_registry_url if file_kafka else None)
                ),
            )
        except Exception as e:
            raise RuntimeError(f"Failed to get Kafka configuration: {e}")

    def has_runtime_config(self) -> bool:
        """Check if runtime configuration is set.

        Returns:
            True if either runtime clickhouse or kafka configuration is set, False otherwise.
        """
        return self._clickhouse_config is not None or self._kafka_config is not None


# Create singleton instance
config_registry = ConfigurationRegistry.get_instance()
