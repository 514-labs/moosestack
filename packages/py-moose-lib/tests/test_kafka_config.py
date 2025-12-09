"""Tests for Kafka engine configuration."""

import pytest
from moose_lib import OlapTable, OlapConfig
from moose_lib.blocks import ClickHouseEngines, KafkaEngine
from pydantic import BaseModel


class SampleEvent(BaseModel):
    event_id: str
    user_id: str
    timestamp: str


def test_kafka_engine_required_fields():
    engine = KafkaEngine(
        broker_list="kafka:9092",
        topic_list="events",
        group_name="moose_consumer",
        format="JSONEachRow",
    )
    assert engine.broker_list == "kafka:9092"
    assert engine.topic_list == "events"
    assert engine.group_name == "moose_consumer"
    assert engine.format == "JSONEachRow"


def test_kafka_engine_missing_broker_list():
    with pytest.raises(ValueError, match="Kafka engine requires 'broker_list'"):
        KafkaEngine(
            broker_list="", topic_list="events", group_name="c", format="JSONEachRow"
        )


def test_kafka_engine_missing_topic_list():
    with pytest.raises(ValueError, match="Kafka engine requires 'topic_list'"):
        KafkaEngine(
            broker_list="kafka:9092",
            topic_list="",
            group_name="c",
            format="JSONEachRow",
        )


def test_kafka_engine_missing_group_name():
    with pytest.raises(ValueError, match="Kafka engine requires 'group_name'"):
        KafkaEngine(
            broker_list="kafka:9092",
            topic_list="events",
            group_name="",
            format="JSONEachRow",
        )


def test_kafka_engine_missing_format():
    with pytest.raises(ValueError, match="Kafka engine requires 'format'"):
        KafkaEngine(
            broker_list="kafka:9092", topic_list="events", group_name="c", format=""
        )


def test_kafka_engine_rejects_order_by():
    with pytest.raises(ValueError, match="KafkaEngine does not support ORDER BY"):
        OlapTable[SampleEvent](
            "kafka_table",
            OlapConfig(
                engine=KafkaEngine(
                    broker_list="kafka:9092",
                    topic_list="events",
                    group_name="c",
                    format="JSONEachRow",
                ),
                order_by_fields=["event_id"],
            ),
        )


def test_kafka_engine_rejects_partition_by():
    with pytest.raises(ValueError, match="KafkaEngine does not support PARTITION BY"):
        OlapTable[SampleEvent](
            "kafka_table",
            OlapConfig(
                engine=KafkaEngine(
                    broker_list="kafka:9092",
                    topic_list="events",
                    group_name="c",
                    format="JSONEachRow",
                ),
                partition_by="toYYYYMM(timestamp)",
            ),
        )


def test_kafka_engine_rejects_sample_by():
    with pytest.raises(ValueError, match="KafkaEngine does not support SAMPLE BY"):
        OlapTable[SampleEvent](
            "kafka_table",
            OlapConfig(
                engine=KafkaEngine(
                    broker_list="kafka:9092",
                    topic_list="events",
                    group_name="c",
                    format="JSONEachRow",
                ),
                sample_by_expression="event_id",
            ),
        )


def test_kafka_engine_accepts_valid_config():
    table = OlapTable[SampleEvent](
        "kafka_table",
        OlapConfig(
            engine=KafkaEngine(
                broker_list="kafka:9092",
                topic_list="events",
                group_name="c",
                format="JSONEachRow",
            ),
            settings={"kafka_num_consumers": "2"},
        ),
    )
    assert table.name == "kafka_table"
    assert isinstance(table.config.engine, KafkaEngine)
    assert table.config.settings["kafka_num_consumers"] == "2"


def test_kafka_engine_serialization():
    from moose_lib.internal import _convert_engine_instance_to_config_dict

    engine = KafkaEngine(
        broker_list="kafka-1:9092,kafka-2:9092",
        topic_list="events,logs",
        group_name="moose_group",
        format="JSONEachRow",
    )
    config_dict = _convert_engine_instance_to_config_dict(engine)

    assert config_dict.engine == "Kafka"
    assert config_dict.broker_list == "kafka-1:9092,kafka-2:9092"
    assert config_dict.topic_list == "events,logs"
