"""
Kafka Engine E2E Test

Tests the Kafka table engine integration by:
1. Creating a Stream that writes to Redpanda (creates topic)
2. Creating a Kafka table that reads from the same topic
3. Creating a MaterializedView to persist data from Kafka to MergeTree
4. E2E test sends data via ingest API → verifies it lands in the MergeTree table

This uses Moose's built-in Redpanda instance (internal address: redpanda:9092)
"""

from pydantic import BaseModel
from moose_lib import Key, OlapTable, OlapConfig, Stream, IngestApi
from moose_lib.blocks import KafkaEngine
from moose_lib.dmv2 import MaterializedView, MaterializedViewOptions, IngestConfigWithDestination


class KafkaTestEvent(BaseModel):
    """Event data model for Kafka test"""
    event_id: Key[str]
    user_id: str
    event_type: str
    amount: float
    timestamp: int  # Unix timestamp (seconds) - required for Kafka engine JSONEachRow parsing


# 1. Stream: Creates the Redpanda topic "kafka_test_input_1"
# Data sent via IngestApi goes here first
kafka_test_input_stream = Stream[KafkaTestEvent]("kafka_test_input")

# 2. IngestApi: HTTP endpoint to send test data
# POST /ingest/kafka-test → writes to kafka_test_input_stream
kafka_test_ingest_api = IngestApi[KafkaTestEvent](
    "kafka-test",
    IngestConfigWithDestination(destination=kafka_test_input_stream)
)

# 3. Kafka Table: Reads from the same topic the Stream writes to
# Uses ClickHouse's Kafka engine to consume from "kafka_test_input_1"
#
# Note: broker_list uses internal Docker address since both
# ClickHouse and Redpanda are in the same docker-compose network
kafka_test_source_table = OlapTable[KafkaTestEvent](
    "kafka_test_source",
    OlapConfig(
        engine=KafkaEngine(
            broker_list="redpanda:9092",  # Internal Docker network address
            topic_list="kafka_test_input",  # Must match Stream's topic name
            group_name="e2e_kafka_test_consumer_py",
            format="JSONEachRow"
        ),
        settings={
            "kafka_num_consumers": "1",
        },
    ),
)

# 4. MaterializedView: Continuously moves data from Kafka table to MergeTree
# This is what makes the continuous data flow work:
# Redpanda topic → Kafka table → MV → MergeTree table
kafka_test_mv_query = """
SELECT
    event_id,
    user_id,
    event_type,
    amount,
    timestamp
FROM kafka_test_source
"""

kafka_test_mv = MaterializedView[KafkaTestEvent](
    MaterializedViewOptions(
        select_statement=kafka_test_mv_query,
        select_tables=[kafka_test_source_table],
        table_name="kafka_test_dest",
        materialized_view_name="kafka_test_dest_mv",
        order_by_fields=["event_id", "timestamp"],
    )
)

