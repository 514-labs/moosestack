from pydantic import BaseModel
from moose_lib import Key, OlapTable, OlapConfig, Stream, IngestApi
from moose_lib.blocks import KafkaEngine
from moose_lib.dmv2 import MaterializedView, MaterializedViewOptions, IngestConfigWithDestination


class KafkaTestEvent(BaseModel):
    event_id: Key[str]
    user_id: str
    event_type: str
    amount: float
    timestamp: int


kafka_test_input_stream = Stream[KafkaTestEvent]("kafka_test_input")

kafka_test_ingest_api = IngestApi[KafkaTestEvent](
    "kafka-test",
    IngestConfigWithDestination(destination=kafka_test_input_stream)
)

kafka_test_source_table = OlapTable[KafkaTestEvent](
    "kafka_test_source",
    OlapConfig(
        engine=KafkaEngine(
            broker_list="redpanda:9092",
            topic_list="kafka_test_input",
            group_name="e2e_kafka_test_consumer_py",
            format="JSONEachRow"
        ),
        settings={
            "kafka_num_consumers": "1",
        },
    ),
)

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
