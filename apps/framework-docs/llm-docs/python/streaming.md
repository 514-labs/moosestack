---
title: Python Streaming
description: Process real-time data streams with Kafka/Redpanda integration and message handling
priority: 0.75
category: streaming
language: python
---

# Stream Processing

## Overview
Streams in Moose provide a reliable, high-throughput mechanism for transforming and delivering data to your tables. They handle data validation, transformation, and delivery with built-in error handling and monitoring.

## Basic Stream Setup

```python
from moose_lib import Stream, Key
from pydantic import BaseModel

class UserEvent(BaseModel):
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: str

# Create a stream
user_event_stream = Stream(
    name="user-event-stream",
    destination="UserEventTable",
    parallelism=2
)
```

## Stream Configuration

The `Stream` class accepts the following configuration:

```python
from typing import TypedDict, Optional

class StreamConfig(BaseModel):
    name: str            # Required: Name of the stream
    destination: str     # Required: Destination table
    parallelism: Optional[int] = None  # Optional: Number of parallel processors
    retention_period: Optional[int] = None  # Optional: Data retention in seconds
    validation: Optional[dict] = None  # Optional: Validation configuration
```

## Stream Transformations

Streams support data transformations using the `add_transform` method:

```python
from typing import List, Optional
from pydantic import BaseModel

class InputEvent(BaseModel):
    id: Key[str]
    raw_data: str
    timestamp: str

class OutputEvent(BaseModel):
    id: Key[str]
    processed_data: float
    timestamp: str

# Create streams
input_stream = Stream(
    name="input-stream",
    destination="RawTable"
)

output_stream = Stream(
    name="output-stream",
    destination="ProcessedTable"
)

# Add transformation
def transform_record(record: InputEvent) -> Optional[List[OutputEvent]]:
    try:
        return [OutputEvent(
            id=record.id,
            processed_data=float(record.raw_data),
            timestamp=record.timestamp
        )]
    except Exception as e:
        print(f"Error processing record: {str(e)}")
        return None

input_stream.add_transform(
    destination=output_stream,
    transformation=transform_record
)
```

### Transform Return Types

The transform function can return:
- A list of records
- `None` to filter out records

```python
# Transform returning multiple records
def transform_multiple(record: InputEvent) -> Optional[List[OutputEvent]]:
    try:
        return [
            OutputEvent(
                id=f"{record.id}-1",
                processed_data=float(record.raw_data) * 2,
                timestamp=record.timestamp
            ),
            OutputEvent(
                id=f"{record.id}-2",
                processed_data=float(record.raw_data) * 3,
                timestamp=record.timestamp
            )
        ]
    except Exception as e:
        print(f"Error processing record: {str(e)}")
        return None

# Transform filtering records
def transform_filter(record: InputEvent) -> Optional[List[OutputEvent]]:
    try:
        value = float(record.raw_data)
        if value > 100:
            return [OutputEvent(
                id=record.id,
                processed_data=value,
                timestamp=record.timestamp
            )]
        return None
    except Exception as e:
        print(f"Error processing record: {str(e)}")
        return None
```

## Error Handling

Streams provide built-in error handling:

```python
try:
    await stream.write(event)
except ValidationError as error:
    print(f"Validation failed: {error.details}")
except TransformError as error:
    print(f"Transform failed: {error.message}")
except Exception as error:
    print(f"Stream error: {error}")
```

## Monitoring and Debugging

You can monitor your streams using various tools:

```python
# Get stream metrics
metrics = await stream.get_metrics()
print("Stream metrics:", metrics)

# Check stream health
health = await stream.get_health()
print("Stream health:", health)

# Get validation statistics
validation_stats = await stream.get_validation_stats()
print("Validation statistics:", validation_stats)
```

## Best Practices

1. **Transformations**
   - Keep transformations pure and side-effect free
   - Make transforms deterministic
   - Handle errors gracefully
   - Use appropriate return types

2. **Performance**
   - Set appropriate parallelism
   - Monitor stream latency
   - Use batch processing when possible
   - Set appropriate retention periods

3. **Error Handling**
   - Implement proper error handling
   - Log transformation failures
   - Monitor error rates
   - Set up alerts for critical errors

4. **Monitoring**
   - Track stream metrics
   - Monitor transformation latency
   - Watch for validation failures
   - Set up health checks

## Example Usage

### Basic Stream
```python
from moose_lib import Stream, Key
from pydantic import BaseModel

class UserEvent(BaseModel):
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: str

# Create stream
user_event_stream = Stream(
    name="user-event-stream",
    destination="UserEventTable",
    parallelism=2
)

# Write to stream
await user_event_stream.write(UserEvent(
    id="123",
    user_id="user_456",
    event_type="login",
    timestamp="2024-03-20T12:00:00Z"
))
```

### Stream with Transformations
```python
from typing import List, Optional
from pydantic import BaseModel

class RawEvent(BaseModel):
    id: Key[str]
    data: str
    timestamp: str

class ProcessedEvent(BaseModel):
    id: Key[str]
    value: float
    timestamp: str

# Create streams
raw_stream = Stream(
    name="raw-stream",
    destination="RawTable"
)

processed_stream = Stream(
    name="processed-stream",
    destination="ProcessedTable"
)

# Add transformation
def transform_record(record: RawEvent) -> Optional[List[ProcessedEvent]]:
    try:
        return [ProcessedEvent(
            id=record.id,
            value=float(record.data),
            timestamp=record.timestamp
        )]
    except Exception as e:
        print(f"Error processing record: {str(e)}")
        return None

raw_stream.add_transform(
    destination=processed_stream,
    transformation=transform_record
)
```

