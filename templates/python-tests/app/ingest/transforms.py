from app.ingest.models import fooModel, barModel, Foo, Bar
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
    cached_result = cache.get(cache_key)
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
from app.ingest.models import array_input_model, array_output_stream, ArrayInput, ArrayOutput

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
