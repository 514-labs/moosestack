"""
Configuration file handling for Moose.

This module provides functionality for reading and parsing the moose.config.toml file,
which contains project-wide configuration settings.
"""
import os
import tomllib
from dataclasses import dataclass
from typing import Optional


@dataclass
class ClickHouseConfig:
    """ClickHouse configuration settings from moose.config.toml."""
    host: str
    host_port: int
    user: str
    password: str
    db_name: str
    use_ssl: bool = False
    native_port: Optional[int] = None


@dataclass
class KafkaConfig:
    """Redpanda/Kafka configuration settings from moose.config.toml."""
    broker: str
    message_timeout_ms: int
    sasl_username: Optional[str] = None
    sasl_password: Optional[str] = None
    sasl_mechanism: Optional[str] = None
    security_protocol: Optional[str] = None
    namespace: Optional[str] = None
    schema_registry_url: Optional[str] = None


@dataclass
class ProjectConfig:
    """Project configuration from moose.config.toml."""
    language: str
    clickhouse_config: ClickHouseConfig
    kafka_config: Optional[KafkaConfig] = None


def find_config_file(start_dir: str = os.getcwd()) -> Optional[str]:
    """Find moose.config.toml by walking up directory tree.

    Args:
        start_dir: Directory to start searching from. Defaults to current directory.

    Returns:
        Path to moose.config.toml if found, None otherwise.
    """
    current_dir = os.path.abspath(start_dir)
    while True:
        config_path = os.path.join(current_dir, "moose.config.toml")
        if os.path.exists(config_path):
            return config_path

        parent_dir = os.path.dirname(current_dir)
        # Reached root directory
        if parent_dir == current_dir:
            break
        current_dir = parent_dir
    return None


def read_project_config() -> ProjectConfig:
    """Read and parse moose.config.toml.

    Returns:
        ProjectConfig object containing parsed configuration.
    """
    config_path = find_config_file()
    if not config_path:
        raise FileNotFoundError(
            "moose.config.toml not found in current directory or any parent directory"
        )

    try:
        with open(config_path, "rb") as f:
            config_data = tomllib.load(f)

        clickhouse_config = ClickHouseConfig(
            host=config_data["clickhouse_config"]["host"],
            host_port=config_data["clickhouse_config"]["host_port"],
            user=config_data["clickhouse_config"]["user"],
            password=config_data["clickhouse_config"]["password"],
            db_name=config_data["clickhouse_config"]["db_name"],
            use_ssl=config_data["clickhouse_config"].get("use_ssl", False),
            native_port=config_data["clickhouse_config"].get("native_port")
        )

        def _parse_kafka(section_name: str) -> Optional[KafkaConfig]:
            sec = config_data.get(section_name)
            if sec is None:
                return None
            return KafkaConfig(
                broker=sec["broker"],
                message_timeout_ms=sec.get("message_timeout_ms", 1000),
                sasl_username=sec.get("sasl_username"),
                sasl_password=sec.get("sasl_password"),
                sasl_mechanism=sec.get("sasl_mechanism"),
                security_protocol=sec.get("security_protocol"),
                namespace=sec.get("namespace"),
                schema_registry_url=sec.get("schema_registry_url"),
            )

        kafka_cfg = _parse_kafka("kafka_config")
        if kafka_cfg is None:
            kafka_cfg = _parse_kafka("redpanda_config")

        return ProjectConfig(
            language=config_data["language"],
            clickhouse_config=clickhouse_config,
            kafka_config=kafka_cfg,
        )
    except Exception as e:
        raise RuntimeError(f"Failed to parse moose.config.toml: {e}")
