# Transform Foo events to Bar events
from datetime import datetime
from app.db.models import FooModel, BarModel, FooPipeline, BarPipeline
from moose_lib import MooseCache, DeadLetterModel


def transform_foo_to_bar(foo: FooModel) -> BarModel:
    """
    Transform Foo events to Bar events with error handling and caching.

    Normal flow:
    1. Check cache for previously processed events
    2. Transform Foo to Bar
    3. Cache the result
    4. Return transformed Bar event

    Alternate flow (DLQ):
    - If errors occur during transformation, the event is sent to DLQ
    - This enables separate error handling, monitoring, and retry strategies
    """
    # Initialize cache
    cache = MooseCache()
    cache_key = f"processed:{foo.primary_key}"

    # Check if we have processed this event before
    cached = cache.get(cache_key)
    if cached:
        print(f"Using cached result for {foo.primary_key}")
        return cached

    # Magic value to test the dead letter queue
    if foo.timestamp == 1728000000.0:
        raise ValueError("Test error for dead letter queue")

    result = BarModel(
        primary_key=foo.primary_key,
        utc_timestamp=datetime.fromtimestamp(foo.timestamp),
        has_text=foo.optional_text is not None,
        text_length=len(foo.optional_text) if foo.optional_text else 0,
    )

    # Cache the result (1 hour retention) - cache expects Pydantic model, not dict
    cache.set(cache_key, result, 3600)

    return result


# Register the transform
FooPipeline.get_stream().add_transform(
    destination=BarPipeline.get_stream(),
    transformation=transform_foo_to_bar,
)


# Add a streaming consumer to print Foo events
def print_foo_event(foo: FooModel) -> None:
    print("Received Foo event:")
    print(f"  Primary Key: {foo.primary_key}")
    print(f"  Timestamp: {datetime.fromtimestamp(foo.timestamp)}")
    print(f"  Optional Text: {foo.optional_text or 'None'}")
    print("---")


FooPipeline.get_stream().add_consumer(print_foo_event)


# DLQ consumer for handling failed events (alternate flow)
def handle_dead_letter(dead_letter: DeadLetterModel[FooModel]):
    print("Dead letter event:")
    print(dead_letter)
    # You can access the original Foo event from the dead letter
    foo = dead_letter.as_typed()
    print(f"Original Foo event: {foo}")
    # Implement retry logic or additional error handling


FooPipeline.get_dead_letter_queue().add_consumer(handle_dead_letter)
