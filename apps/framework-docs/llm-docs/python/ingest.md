---
title: Python Data Ingestion
description: Ingest data into Moose using HTTP APIs, SDKs, and batch imports with automatic schema validation
priority: 0.90
category: data-ingestion
language: python
---

# Ingestion APIs

## Overview
Ingestion APIs in Moose provide a type-safe way to create HTTP endpoints that accept data and write it to your streams. They handle validation, error handling, and provide a clean interface for data ingestion.

## Basic Setup

```python
from moose_lib import IngestApi, Key
from pydantic import BaseModel

class UserEvent(BaseModel):
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: str

# Create an ingest endpoint
UserEventIngest = IngestApi[UserEvent](
    name="UserEventIngest",
    destination="UserEventStream",
    format="JSON"
)
```

## Configuration

### API Configuration
The `IngestApi` class accepts the following configuration:

```python
from typing import TypedDict, Literal, Optional

class IngestConfig(BaseModel):
    name: str                    # Required: Name of the ingest endpoint
    destination: str             # Required: Stream to write to
    format: Optional[Literal["JSON", "JSON_ARRAY"]]  # Optional: Ingestion format
    validation: Optional[dict]   # Optional: Validation configuration
```

### Pipeline Configuration
For `IngestPipeline`, configuration must be provided as keyword arguments:

```python
# Correct pipeline creation with keyword arguments
brain_data_pipeline = IngestPipeline[BrainData](
    "brain_data",    # Required: Pipeline name
    ingest_api=True,     # Required: Enable ingestion
    stream=True,     # Required: Enable streaming
    table=True       # Required: Enable table storage
)

# Incorrect - Using a dictionary for configuration
brain_data_pipeline = IngestPipeline[BrainData](
    "brain_data",
    {
        "ingest": True,
        "stream": True,
        "table": True
    }
)
```

> **Important**: When using `IngestPipeline`, always provide configuration as keyword arguments, not as a dictionary. The library expects to access configuration options as attributes (e.g., `config.table`), which is not possible with a dictionary.

## Ingestion Formats

### JSON Format
```python
# Single record ingestion
UserEventIngest = IngestApi[UserEvent](
    name="UserEventIngest",
    destination="UserEventStream",
    format="JSON"
)

# Example request body
{
    "id": "123",
    "user_id": "user_456",
    "event_type": "login",
    "timestamp": "2024-03-20T12:00:00Z"
}
```

### JSON Array Format
```python
# Batch ingestion
BatchUserEventIngest = IngestApi[UserEvent](
    name="BatchUserEventIngest",
    destination="UserEventStream",
    format="JSON_ARRAY"
)

# Example request body
[
    {
        "id": "123",
        "user_id": "user_456",
        "event_type": "login",
        "timestamp": "2024-03-20T12:00:00Z"
    },
    {
        "id": "124",
        "user_id": "user_457",
        "event_type": "logout",
        "timestamp": "2024-03-20T12:01:00Z"
    }
]
```

## Common Pitfalls

### Configuration Object Requirements

When creating an ingest API or pipeline, you must ensure that:

1. The configuration object has all required attributes (like `table` for pipelines)
2. You're not passing a plain dictionary where an object is expected
3. The configuration matches the expected type for your specific use case

```python
# ❌ Incorrect - Using a plain dictionary
config = {
    "name": "MyIngest",
    "destination": "MyStream"
}
MyIngest = IngestApi[MyModel](config)  # This will fail

# ✅ Correct - Using proper configuration
MyIngest = IngestApi[MyModel](
    name="MyIngest",
    destination="MyStream",
    format="JSON"
)
```

### Pipeline Configuration Requirements

When creating an ingest pipeline, you must ensure that:

1. Configuration is provided as keyword arguments
2. Required flags are set:
   - `ingest_api=True` to enable ingestion
   - `stream=True` to enable streaming
   - `table=True` to enable table storage
3. The pipeline name is provided as the first argument

```python
# Correct - Using keyword arguments
pipeline = IngestPipeline[MyModel](
    "my_pipeline",
    ingest_api=True,
    stream=True,
    table=True
)

# Incorrect - Using a dictionary
pipeline = IngestPipeline[MyModel](
    "my_pipeline",
    {
        "ingest": True,
        "stream": True,
        "table": True
    }
)
```

## Validation

Ingestion APIs automatically validate incoming data:

```python
UserEventIngest = IngestApi[UserEvent](
    name="UserEventIngest",
    destination="UserEventStream",
    format="JSON",
    validation={
        "enabled": True,
        "strict": True
    }
)
```

### Validation Rules
1. All required fields must be present
2. Field types must match the schema
3. Primary key must be unique
4. Timestamps must be valid ISO 8601 strings

## Error Handling

```python
try:
    await UserEventIngest.write(event)
except ValidationError as error:
    print("Validation failed:", error.details)
except DuplicateKeyError as error:
    print("Duplicate key:", error.key)
except Exception as error:
    print("Ingestion failed:", error)
```

## Best Practices

1. **Use Appropriate Format**
   - Use `JSON` for single record ingestion
   - Use `JSON_ARRAY` for batch ingestion
   - Consider payload size limits

2. **Validation**
   - Enable validation in development
   - Use strict validation for production
   - Handle validation errors gracefully

3. **Error Handling**
   - Implement proper error handling
   - Log validation failures
   - Monitor ingestion errors

4. **Performance**
   - Use batch ingestion for high volume
   - Monitor ingestion latency
   - Set appropriate timeouts

## Example Usage

### Basic Ingestion
```python
from moose_lib import IngestApi, Key
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException

class UserEvent(BaseModel):
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: str

UserEventIngest = IngestApi[UserEvent](
    name="UserEventIngest",
    destination="UserEventStream",
    format="JSON"
)

app = FastAPI()

@app.post("/events")
async def ingest_event(event: UserEvent):
    try:
        await UserEventIngest.write(event)
        return {"success": True}
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))
```

### Batch Ingestion
```python
BatchUserEventIngest = IngestApi[UserEvent](
    name="BatchUserEventIngest",
    destination="UserEventStream",
    format="JSON_ARRAY"
)

@app.post("/events/batch")
async def ingest_events(events: list[UserEvent]):
    try:
        await BatchUserEventIngest.write(events)
        return {"success": True}
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))
```
