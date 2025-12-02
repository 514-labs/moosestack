from src.ingest.models import fooModel, barModel, Foo, Bar
from moose_lib import DeadLetterQueue, DeadLetterModel, TransformConfig, MooseCache
from datetime import datetime


def foo_to_bar(foo: Foo):
    """Transform Foo events to Bar events with error handling and caching.
    
    Normal flow:
    1. Check cache for previously processed events
    2. Transform Foo to Bar
    3. Cache the result
    4. Return transformed Bar event
    
    Alternate flow (DLQ):
    - If errors occur during transformation, the event is sent to DLQ
    - This enables separate error handling, monitoring, and retry strategies
    """

    # Create a cache
    cache = MooseCache()
    cache_key = f"foo_to_bar:{foo.primary_key}"

    # Checked for cached transformation result
    cached_result = cache.get(cache_key, type_hint=Bar)
    if cached_result:
        return cached_result

    if foo.timestamp == 1728000000.0:  # magic value to test the dead letter queue
        raise ValueError("blah")
    result = Bar(
        primary_key=foo.primary_key,
        baz=foo.baz,
        utc_timestamp=datetime.fromtimestamp(foo.timestamp),
        has_text=foo.optional_text is not None,
        text_length=len(foo.optional_text) if foo.optional_text else 0
    )

    # Store the result in cache
    cache.set(cache_key, result, 3600)  # Cache for 1 hour
    return result


# Transform Foo events to Bar events
fooModel.get_stream().add_transform(
    destination=barModel.get_stream(),
    transformation=foo_to_bar,
)


# Add a streaming consumer to print Foo events
def print_foo_event(foo):
    print(f"Received Foo event:")
    print(f"  Primary Key: {foo.primary_key}")
    print(f"  Timestamp: {datetime.fromtimestamp(foo.timestamp)}")
    print(f"  Optional Text: {foo.optional_text or 'None'}")
    print("---")


fooModel.get_stream().add_consumer(print_foo_event)


# DLQ consumer for handling failed events (alternate flow)
def print_messages(dead_letter: DeadLetterModel[Foo]):
    print("dead letter:", dead_letter)
    print("foo in dead letter:", dead_letter.as_typed())


fooModel.get_dead_letter_queue().add_consumer(print_messages)

# Test transform that returns a list - each element should be sent as a separate Kafka message
from src.ingest.models import array_input_model, array_output_stream, ArrayInput, ArrayOutput


def array_transform(input_data: ArrayInput) -> list[ArrayOutput]:
    """Transform that explodes an input array into individual output records.

    This tests that when a transform returns an array, each element
    is sent as a separate Kafka message to the destination stream.
    """
    # Explode the input array into individual output records
    # Each item in input_data.data becomes a separate Kafka message
    return [
        ArrayOutput(
            input_id=input_data.id,
            value=value,
            index=index,
            timestamp=datetime.now()
        )
        for index, value in enumerate(input_data.data)
    ]


array_input_model.get_stream().add_transform(
    destination=array_output_stream,
    transformation=array_transform,
)

# Test transform for DateTime precision - verifies that Python datetime preserves microseconds
from src.ingest.models import (
    datetime_precision_input_model,
    datetime_precision_output_stream,
    DateTimePrecisionTestData,
)


def datetime_precision_transform(input_data: DateTimePrecisionTestData) -> DateTimePrecisionTestData:
    """Transform that verifies Python datetime objects preserve microsecond precision.
    
    Unlike JavaScript, Python's datetime natively supports microsecond precision,
    so all datetime fields should be datetime objects with microseconds preserved.
    """

    print("DateTime precision transform (Python) - input types and values:")
    print(f"  created_at: {type(input_data.created_at)} = {input_data.created_at} (µs: {input_data.created_at.microsecond})")
    print(f"  timestamp_ms: {type(input_data.timestamp_ms)} = {input_data.timestamp_ms} (µs: {input_data.timestamp_ms.microsecond})")
    print(f"  timestamp_us: {type(input_data.timestamp_us)} = {input_data.timestamp_us} (µs: {input_data.timestamp_us.microsecond})")
    print(f"  timestamp_ns: {type(input_data.timestamp_ns)} = {input_data.timestamp_ns} (µs: {input_data.timestamp_ns.microsecond})")

    # Verify all are datetime objects
    if not isinstance(input_data.created_at, datetime):
        raise TypeError(f"Expected created_at to be datetime, got {type(input_data.created_at)}")
    if not isinstance(input_data.timestamp_ms, datetime):
        raise TypeError(f"Expected timestamp_ms to be datetime, got {type(input_data.timestamp_ms)}")
    if not isinstance(input_data.timestamp_us, datetime):
        raise TypeError(f"Expected timestamp_us to be datetime, got {type(input_data.timestamp_us)}")
    if not isinstance(input_data.timestamp_ns, datetime):
        raise TypeError(f"Expected timestamp_ns to be datetime, got {type(input_data.timestamp_ns)}")

    # Verify microseconds are present
    if input_data.timestamp_us.microsecond == 0:
        print(f"WARNING: timestamp_us has no microseconds: {input_data.timestamp_us}")
    else:
        print(f"✓ timestamp_us has microseconds: {input_data.timestamp_us.microsecond}")
    
    if input_data.timestamp_ns.microsecond == 0:
        print(f"WARNING: timestamp_ns has no microseconds: {input_data.timestamp_ns}")
    else:
        print(f"✓ timestamp_ns has microseconds: {input_data.timestamp_ns.microsecond}")

    # Pass through unchanged
    return input_data


datetime_precision_input_model.get_stream().add_transform(
    destination=datetime_precision_output_stream,
    transformation=datetime_precision_transform,
)


# ============================================================================
# Extra Fields Transform (ENG-1617)
# Demonstrates how streaming functions receive extra fields from Pydantic's extra='allow'
# ============================================================================

from src.ingest.models import (
    user_event_input_stream,
    user_event_output_stream,
    UserEventInput,
    UserEventOutput,
)


def user_event_transform(input_data: UserEventInput) -> UserEventOutput:
    """Transform for extra fields types.
    
    KEY POINT: The streaming function receives ALL fields from the input,
    including extra fields allowed by Pydantic's `model_config = ConfigDict(extra='allow')`.
    
    Since OlapTable requires a fixed schema, we extract known fields and store
    extra fields in a JSON column (`properties`).
    """
    # Get known fields
    known_fields = {
        "timestamp": input_data.timestamp,
        "event_name": input_data.event_name,
        "user_id": input_data.user_id,
        "org_id": input_data.org_id,
        "project_id": input_data.project_id,
    }
    
    # Get extra fields using model_extra (Pydantic v2)
    # This contains all fields that were not defined in the model schema
    extra_fields = input_data.model_extra or {}
    
    # Log to demonstrate that extra fields ARE received by the streaming function
    print("Extra fields transform received:", {
        "known_fields": known_fields,
        "extra_fields": extra_fields,  # These came through extra='allow'!
    })
    
    return UserEventOutput(
        timestamp=input_data.timestamp,
        event_name=input_data.event_name,
        user_id=input_data.user_id,
        org_id=input_data.org_id,
        project_id=input_data.project_id,
        # Store extra fields in JSON column for persistence to ClickHouse
        properties=extra_fields,
    )


user_event_input_stream.add_transform(
    destination=user_event_output_stream,
    transformation=user_event_transform,
)
