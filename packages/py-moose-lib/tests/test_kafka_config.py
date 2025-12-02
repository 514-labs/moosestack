"""Tests for Kafka engine configuration."""

import pytest
from moose_lib import OlapTable, OlapConfig
from moose_lib.blocks import ClickHouseEngines, KafkaEngine
from pydantic import BaseModel


class SampleEvent(BaseModel):
    event_id: str
    user_id: str
    timestamp: str


def test_kafka_engine_in_enum():
    """Test that Kafka is in ClickHouseEngines enum."""
    assert ClickHouseEngines.Kafka.value == "Kafka"


def test_kafka_engine_required_fields():
    """Test that KafkaEngine validates required fields."""
    # Valid configuration
    engine = KafkaEngine(
        broker_list="kafka:9092",
        topic_list="events",
        group_name="moose_consumer",
        format="JSONEachRow"
    )
    assert engine.broker_list == "kafka:9092"
    assert engine.topic_list == "events"
    assert engine.group_name == "moose_consumer"
    assert engine.format == "JSONEachRow"


def test_kafka_engine_missing_broker_list():
    """Test that KafkaEngine raises error when broker_list is missing."""
    with pytest.raises(ValueError, match="Kafka engine requires 'broker_list'"):
        KafkaEngine(
            broker_list="",
            topic_list="events",
            group_name="consumer",
            format="JSONEachRow"
        )


def test_kafka_engine_missing_topic_list():
    """Test that KafkaEngine raises error when topic_list is missing."""
    with pytest.raises(ValueError, match="Kafka engine requires 'topic_list'"):
        KafkaEngine(
            broker_list="kafka:9092",
            topic_list="",
            group_name="consumer",
            format="JSONEachRow"
        )


def test_kafka_engine_missing_group_name():
    """Test that KafkaEngine raises error when group_name is missing."""
    with pytest.raises(ValueError, match="Kafka engine requires 'group_name'"):
        KafkaEngine(
            broker_list="kafka:9092",
            topic_list="events",
            group_name="",
            format="JSONEachRow"
        )


def test_kafka_engine_missing_format():
    """Test that KafkaEngine raises error when format is missing."""
    with pytest.raises(ValueError, match="Kafka engine requires 'format'"):
        KafkaEngine(
            broker_list="kafka:9092",
            topic_list="events",
            group_name="consumer",
            format=""
        )


def test_kafka_engine_only_has_constructor_params():
    """Test that KafkaEngine only has the 4 constructor params.

    Additional settings like num_consumers, security, schema must be
    specified in OlapConfig.settings, not on KafkaEngine itself.
    """
    engine = KafkaEngine(
        broker_list="kafka:9092",
        topic_list="events",
        group_name="consumer",
        format="JSONEachRow"
    )
    # Only the 4 constructor params should exist
    assert engine.broker_list == "kafka:9092"
    assert engine.topic_list == "events"
    assert engine.group_name == "consumer"
    assert engine.format == "JSONEachRow"

    # These fields should NOT exist on KafkaEngine (they go in settings)
    assert not hasattr(engine, 'row_delimiter')
    assert not hasattr(engine, 'schema')
    assert not hasattr(engine, 'num_consumers')
    assert not hasattr(engine, 'security_protocol')
    assert not hasattr(engine, 'sasl_mechanism')
    assert not hasattr(engine, 'sasl_username')
    assert not hasattr(engine, 'sasl_password')


def test_kafka_engine_rejects_order_by():
    """Test that Kafka engine rejects ORDER BY clause."""
    with pytest.raises(ValueError, match="KafkaEngine does not support ORDER BY"):
        OlapTable[SampleEvent](
            "kafka_table",
            OlapConfig(
                engine=KafkaEngine(
                    broker_list="kafka:9092",
                    topic_list="events",
                    group_name="consumer",
                    format="JSONEachRow"
                ),
                order_by_fields=["event_id"]
            )
        )


def test_kafka_engine_rejects_order_by_expression():
    """Test that Kafka engine rejects ORDER BY expression."""
    with pytest.raises(ValueError, match="KafkaEngine does not support ORDER BY"):
        OlapTable[SampleEvent](
            "kafka_table",
            OlapConfig(
                engine=KafkaEngine(
                    broker_list="kafka:9092",
                    topic_list="events",
                    group_name="consumer",
                    format="JSONEachRow"
                ),
                order_by_expression="event_id"
            )
        )


def test_kafka_engine_rejects_partition_by():
    """Test that Kafka engine rejects PARTITION BY clause."""
    with pytest.raises(ValueError, match="KafkaEngine does not support PARTITION BY"):
        OlapTable[SampleEvent](
            "kafka_table",
            OlapConfig(
                engine=KafkaEngine(
                    broker_list="kafka:9092",
                    topic_list="events",
                    group_name="consumer",
                    format="JSONEachRow"
                ),
                partition_by="toYYYYMM(timestamp)"
            )
        )


def test_kafka_engine_rejects_sample_by():
    """Test that Kafka engine rejects SAMPLE BY clause."""
    with pytest.raises(ValueError, match="KafkaEngine does not support SAMPLE BY"):
        OlapTable[SampleEvent](
            "kafka_table",
            OlapConfig(
                engine=KafkaEngine(
                    broker_list="kafka:9092",
                    topic_list="events",
                    group_name="consumer",
                    format="JSONEachRow"
                ),
                sample_by_expression="event_id"
            )
        )


def test_kafka_engine_accepts_valid_config():
    """Test that Kafka engine accepts valid configuration without unsupported clauses."""
    table = OlapTable[SampleEvent](
        "kafka_table",
        OlapConfig(
            engine=KafkaEngine(
                broker_list="kafka:9092",
                topic_list="events",
                group_name="consumer",
                format="JSONEachRow"
            ),
            settings={
                "kafka_num_consumers": "2"
            }
        )
    )
    assert table.name == "kafka_table"
    assert isinstance(table.config.engine, KafkaEngine)
    assert table.config.engine.broker_list == "kafka:9092"
    assert table.config.settings["kafka_num_consumers"] == "2"


def test_kafka_engine_serialization():
    """Test that KafkaEngine serializes correctly to config dict.

    Only the 4 constructor params are serialized. Settings like num_consumers
    and security are handled separately via OlapConfig.settings.
    """
    from moose_lib.internal import _convert_engine_instance_to_config_dict

    engine = KafkaEngine(
        broker_list="kafka-1:9092,kafka-2:9092",
        topic_list="events,logs",
        group_name="moose_group",
        format="JSONEachRow"
    )

    config_dict = _convert_engine_instance_to_config_dict(engine)

    assert config_dict.engine == "Kafka"
    assert config_dict.broker_list == "kafka-1:9092,kafka-2:9092"
    assert config_dict.topic_list == "events,logs"
    assert config_dict.group_name == "moose_group"
    assert config_dict.format == "JSONEachRow"
    # These should NOT be on config_dict (they go in table settings)
    assert not hasattr(config_dict, 'num_consumers')
    assert not hasattr(config_dict, 'security_protocol')
    assert not hasattr(config_dict, 'sasl_username')
    assert not hasattr(config_dict, 'sasl_password')


def test_kafka_engine_runtime_env_markers_in_settings():
    """Test that runtime environment markers work in OlapConfig.settings for Kafka.

    Security credentials should be specified in settings, not on KafkaEngine directly.
    """
    table = OlapTable[SampleEvent](
        "kafka_table",
        OlapConfig(
            engine=KafkaEngine(
                broker_list="kafka:9092",
                topic_list="events",
                group_name="consumer",
                format="JSONEachRow"
            ),
            settings={
                "kafka_sasl_username": "__MOOSE_RUNTIME_ENV__:KAFKA_USERNAME",
                "kafka_sasl_password": "__MOOSE_RUNTIME_ENV__:KAFKA_PASSWORD"
            }
        )
    )

    assert "__MOOSE_RUNTIME_ENV__:" in table.config.settings["kafka_sasl_username"]
    assert "__MOOSE_RUNTIME_ENV__:" in table.config.settings["kafka_sasl_password"]

