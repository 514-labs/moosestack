"""Tests for Kafka engine configuration."""

import pytest
from pydantic import BaseModel
from datetime import datetime

from moose_lib import OlapTable, OlapConfig
from moose_lib.blocks import KafkaEngine, MergeTreeEngine
from moose_lib.internal import (
    _convert_engine_to_config_dict,
    KafkaConfigDict,
)


class KafkaEvent(BaseModel):
    """Sample model for Kafka table tests."""
    id: str
    message: str
    timestamp: datetime


def test_kafka_engine_minimal_config():
    """Test creating OlapTable with minimal required Kafka configuration."""
    table = OlapTable[KafkaEvent](
        "KafkaMinimal",
        OlapConfig(
            engine=KafkaEngine(),
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "test_topic",
                "kafka_group_name": "test_group",
                "kafka_format": "JSONEachRow",
            }
        )
    )

    assert table.name == "KafkaMinimal"
    assert isinstance(table.config.engine, KafkaEngine)
    assert table.config.settings["kafka_broker_list"] == "localhost:9092"
    assert table.config.settings["kafka_format"] == "JSONEachRow"


def test_kafka_engine_full_config():
    """Test Kafka with comprehensive settings including security, consumers, and compression."""
    table = OlapTable[KafkaEvent](
        "KafkaFull",
        OlapConfig(
            engine=KafkaEngine(),
            settings={
                # Required settings
                "kafka_broker_list": "broker1:9092,broker2:9092",
                "kafka_topic_list": "topic1,topic2",
                "kafka_group_name": "consumer_group",
                "kafka_format": "JSONEachRow",
                # Security
                "kafka_security_protocol": "sasl_ssl",
                "kafka_sasl_mechanism": "SCRAM-SHA-256",
                "kafka_sasl_username": "user",
                "kafka_sasl_password": "pass",
                # Consumer settings
                "kafka_num_consumers": "4",
                "kafka_max_block_size": "65536",
                "kafka_skip_broken_messages": "10",
                "kafka_handle_error_mode": "stream",
                # Compression
                "kafka_compression_codec": "snappy",
                # Keeper storage (experimental)
                "kafka_keeper_path": "/clickhouse/kafka/offsets",
                "kafka_replica_name": "replica1",
            }
        )
    )

    assert table.config.settings["kafka_security_protocol"] == "sasl_ssl"
    assert table.config.settings["kafka_num_consumers"] == "4"
    assert table.config.settings["kafka_compression_codec"] == "snappy"
    assert table.config.settings["kafka_keeper_path"] == "/clickhouse/kafka/offsets"


def test_kafka_engine_rejects_unsupported_clauses():
    """Test that KafkaEngine rejects ORDER BY, PARTITION BY, and SAMPLE BY clauses."""
    # Reject ORDER BY with fields
    with pytest.raises(ValueError, match="KafkaEngine does not support ORDER BY clauses"):
        OlapConfig(
            engine=KafkaEngine(),
            order_by_fields=["id"],
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "test",
                "kafka_group_name": "group",
                "kafka_format": "JSONEachRow",
            }
        )

    # Reject ORDER BY with expression
    with pytest.raises(ValueError, match="KafkaEngine does not support ORDER BY clauses"):
        OlapConfig(
            engine=KafkaEngine(),
            order_by_expression="(id, timestamp)",
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "test",
                "kafka_group_name": "group",
                "kafka_format": "JSONEachRow",
            }
        )

    # Reject PARTITION BY
    with pytest.raises(ValueError, match="KafkaEngine does not support PARTITION BY clause"):
        OlapConfig(
            engine=KafkaEngine(),
            partition_by="toYYYYMM(timestamp)",
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "test",
                "kafka_group_name": "group",
                "kafka_format": "JSONEachRow",
            }
        )

    # Reject SAMPLE BY
    with pytest.raises(ValueError, match="KafkaEngine does not support SAMPLE BY clause"):
        OlapConfig(
            engine=KafkaEngine(),
            sample_by_expression="cityHash64(id)",
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "test",
                "kafka_group_name": "group",
                "kafka_format": "JSONEachRow",
            }
        )


def test_kafka_engine_conversion_to_dict():
    """Test conversion of KafkaEngine to KafkaConfigDict for serialization."""
    table = OlapTable[KafkaEvent](
        "TestKafka",
        OlapConfig(
            engine=KafkaEngine(),
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "events",
                "kafka_group_name": "moose_consumers",
                "kafka_format": "JSONEachRow",
            }
        )
    )

    engine_dict = _convert_engine_to_config_dict(table.config.engine, table)

    assert isinstance(engine_dict, KafkaConfigDict)
    assert engine_dict.engine == "Kafka"


def test_kafka_vs_mergetree_restrictions():
    """Test that Kafka has different restrictions than MergeTree family engines."""
    # MergeTree accepts ORDER BY, PARTITION BY, and SAMPLE BY
    mergetree_config = OlapConfig(
        engine=MergeTreeEngine(),
        order_by_fields=["id"],
        partition_by="toYYYYMM(timestamp)",
        sample_by_expression="cityHash64(id)"
    )
    assert mergetree_config.order_by_fields == ["id"]
    assert mergetree_config.partition_by == "toYYYYMM(timestamp)"
    assert mergetree_config.sample_by_expression == "cityHash64(id)"

    # Kafka rejects all of these
    with pytest.raises(ValueError, match="KafkaEngine does not support ORDER BY clauses"):
        OlapConfig(
            engine=KafkaEngine(),
            order_by_fields=["id"],
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "test",
                "kafka_group_name": "group",
                "kafka_format": "JSONEachRow",
            }
        )


def test_multiple_kafka_tables():
    """Test that multiple Kafka tables can coexist with different configurations."""
    table1 = OlapTable[KafkaEvent](
        "KafkaTopic1",
        OlapConfig(
            engine=KafkaEngine(),
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "topic_1",
                "kafka_group_name": "group_1",
                "kafka_format": "JSONEachRow",
            }
        )
    )

    table2 = OlapTable[KafkaEvent](
        "KafkaTopic2",
        OlapConfig(
            engine=KafkaEngine(),
            settings={
                "kafka_broker_list": "localhost:9092",
                "kafka_topic_list": "topic_2",
                "kafka_group_name": "group_2",
                "kafka_format": "CSV",
                "kafka_num_consumers": "8",
            }
        )
    )

    # Verify distinct configurations
    assert table1.config.settings["kafka_topic_list"] == "topic_1"
    assert table2.config.settings["kafka_topic_list"] == "topic_2"
    assert table2.config.settings["kafka_format"] == "CSV"
    assert table2.config.settings["kafka_num_consumers"] == "8"
    assert "kafka_num_consumers" not in table1.config.settings
