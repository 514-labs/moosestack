# Data Modeling

## Overview
Data modeling in Moose is the foundation of your data infrastructure. It defines the structure of your data and how it flows through your system. Moose uses Pydantic models to define schemas, providing type safety and validation throughout your data pipeline.

## Python-Specific Requirements

When creating Python data models, you must follow these requirements exactly:

1. **Imports**
   ```python
   from moose_lib import IngestPipeline, IngestPipelineConfig, OlapConfig
   from pydantic import BaseModel
   from typing import Optional, Dict, Any
   ```

2. **Model Structure**
   - Always inherit from BaseModel
   - Use standard Python types for primary keys
   - Create separate Pydantic models for nested structures
   - Use snake_case for variable and function names
   - Never use dictionary expressions in type annotations

3. **Configuration Objects**
   - Use proper configuration objects, not dictionaries
   - Use IngestPipelineConfig for pipeline configuration
   - Use OlapConfig for table customization
   - Set required flags (stream=True, ingest_api=True)
   - Do not add undocumented fields to configurations

Example of correct Python schema:
```python
from moose_lib import IngestPipeline, IngestPipelineConfig, OlapConfig
from pydantic import BaseModel

class Accelerometer(BaseModel):
    x: float
    y: float
    z: float

class BrainData(BaseModel):
    id: str  # Use standard type
    timestamp: float
    acc: Accelerometer  # Use nested model
    # ... other fields ...

# Correct configuration - only documented fields
config = IngestPipelineConfig(
    table=OlapConfig(
        order_by_fields=["id", "timestamp"],
        engine=ClickHouseEngines.ReplacingMergeTree,
    ),
    stream=True,
    ingest_api=True
)

pipeline = IngestPipeline[BrainData](
    "brain_data",
    config
)
```

## Schema Definition

```python
from moose_lib import IngestPipeline, IngestPipelineConfig, OlapConfig
from pydantic import BaseModel
from typing import Optional, Dict, Any

class UserEvent(BaseModel):
    id: str  # Use standard Python types, not custom Key types
    user_id: str
    event_type: str
    timestamp: str
    metadata: Optional[Dict[str, Any]] = None
```

## Key Concepts

### Primary Keys
- Use standard Python types (e.g., `str` or `int`) for primary keys
- Each table must have exactly one primary key
- Do not use custom types like `Key[str]`

### Optional Fields
- Use `Optional[T]` or default values to mark fields as optional
- Optional fields can be `None`

### Complex Types
- Use Python's type system to define complex data structures
- Support for lists, dictionaries, and nested objects
- Built-in support for common types like `datetime`, `Dict`, etc.

### Nested Structures
When defining nested structures, always create separate Pydantic models for each nested object. Do not use dictionary expressions in type annotations.

```python
from moose_lib import IngestPipeline, IngestPipelineConfig, OlapConfig
from pydantic import BaseModel

# Define nested structures as separate classes
class Accelerometer(BaseModel):
    x: float
    y: float
    z: float

class Gyroscope(BaseModel):
    x: float
    y: float
    z: float

class PPM(BaseModel):
    ch1: float
    ch2: float
    ch3: float

# Use the nested classes in your main schema
class SensorData(BaseModel):
    id: str  # Use standard type
    timestamp: float
    is_active: bool
    acc: Accelerometer
    gyro: Gyroscope
    ppm: PPM
```

**Incorrect** - Using dictionary expressions in type annotations:
```python
class SensorData(BaseModel):
    id: str
    timestamp: float
    is_active: bool
    acc: {
        "x": float,
        "y": float,
        "z": float
    }
    gyro: {
        "x": float,
        "y": float,
        "z": float
    }
    ppm: {
        "ch1": float,
        "ch2": float,
        "ch3": float
    }
```

## Best Practices

1. **Type Safety**
   - Always use Pydantic models for schema definitions
   - Use standard Python types (str, int, float, etc.)
   - Do not use custom types like `Key[str]`
   - Leverage Python's type hints for validation
   - Use strict type checking with mypy

2. **Schema Design**
   - Keep schemas focused and single-purpose
   - Use meaningful field names
   - Document complex fields with Field descriptions
   - Define nested structures as separate Pydantic models

3. **Performance**
   - Choose appropriate key types
   - Consider query patterns when designing schemas
   - Use appropriate field types for your data

4. **Pipeline Integration**
   - Ensure schemas are compatible with both `IngestApi` and `IngestPipeline`
   - For pipeline schemas, ensure all required fields are present
   - Use proper configuration objects when creating ingestion endpoints

## Schema Requirements for Ingestion

When using schemas with ingestion pipelines or APIs, there are specific requirements to consider:

```python
from moose_lib import IngestPipeline, IngestPipelineConfig, OlapConfig
from pydantic import BaseModel

# Correct schema definition for ingestion
class BrainData(BaseModel):
    id: str  # Use standard type
    timestamp: float
    data: dict

# Correct pipeline creation using IngestPipelineConfig
config = IngestPipelineConfig(
    table=OlapConfig(  # Use OlapConfig for table customization
        order_by_fields=["id", "timestamp"],
        engine=ClickHouseEngines.ReplacingMergeTree,
    ),
    stream=True,
    ingest_api=True,
    metadata={"description": "Brain data pipeline"}
)

brain_data_pipeline = IngestPipeline[BrainData](
    "brain_data",    # Pipeline name
    config          # Pass IngestPipelineConfig object
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

### Configuration Requirements

1. **Pipeline Configuration**
   - Use `IngestPipelineConfig` object, not dictionaries
   - Required flags: `ingest_api=True`, `stream=True`
   - Table configuration must be either:
     - `True` for default settings
     - `OlapConfig` object for custom settings
   - Pipeline name must be provided as first argument
   - Do not add undocumented fields like `metadata`

2. **Configuration Structure**
   ```python
   # Correct configuration structure
   config = IngestPipelineConfig(
       table=OlapConfig(
           order_by_fields=["id", "timestamp"],
           engine=ClickHouseEngines.ReplacingMergeTree,
       ),
       stream=True,
       ingest_api=True
   )
   
   pipeline = IngestPipeline[MyModel](
       "my_pipeline",
       config
   )
   
   # Incorrect - Dictionary-based configuration
   pipeline = IngestPipeline[MyModel](
       "my_pipeline",
       {
           "ingest": True,
           "stream": True,
           "table": True
       }
   )

   # Incorrect - Adding undocumented fields
   config = IngestPipelineConfig(
       table=OlapConfig(
           order_by_fields=["id", "timestamp"],
           engine=ClickHouseEngines.ReplacingMergeTree,
       ),
       stream=True,
       ingest_api=True,
       metadata={"description": "My pipeline"}  # Invalid field
   )
   ```

### Ingestion-Specific Requirements

1. **Primary Keys**
   - Must use standard Python types (str, int)
   - Required for both API and Pipeline ingestion
   - Must be unique within the dataset

2. **Timestamp Fields**
   - Required for time-series data
   - Should be in ISO 8601 format
   - Used for data ordering and partitioning

3. **Data Types**
   - Use simple types for better performance
   - Complex types should be serializable
   - Consider storage and query requirements

4. **Configuration Objects**
   - Always use `IngestPipelineConfig` for pipeline configuration
   - Use `OlapConfig` for table customization
   - Never use dictionaries for configuration
   - Ensure all required flags are set
   - Provide pipeline name as first argument

## Schema Validation

Moose automatically validates data against your schemas:

```python
# Valid data
valid_event = UserEvent(
    id="123",
    user_id="user_456",
    event_type="login",
    timestamp="2024-03-20T12:00:00Z"
)

# Invalid data will be rejected
try:
    invalid_event = UserEvent(
        id=123,  # Error: Key must be string
        user_id="user_456",
        # Error: Missing required field 'event_type'
        timestamp="2024-03-20T12:00:00Z"
    )
except ValidationError as e:
    print(f"Schema validation failed: {e}")
```

## Schema Evolution

Moose supports schema evolution with the following rules:

1. **Adding Fields**
   - New fields must be optional
   - Existing data will have `None` for new fields

2. **Removing Fields**
   - Fields can be removed if they are optional
   - Required fields cannot be removed

3. **Type Changes**
   - Type changes must be compatible
   - String to number conversions are not allowed
   - List types must match

## Example Schemas

### Basic Schema
```python
from moose_lib import Key
from pydantic import BaseModel

class BasicSchema(BaseModel):
    id: Key[str]
    name: str
    created_at: str
```

### Complex Schema
```python
from moose_lib import Key
from pydantic import BaseModel, Field
from typing import List, Dict, Any

class ComplexSchema(BaseModel):
    id: Key[str]
    user: Dict[str, str] = Field(
        ...,
        description="User information",
        example={"id": "user_123", "name": "John Doe", "email": "john@example.com"}
    )
    events: List[Dict[str, Any]] = Field(
        ...,
        description="List of events",
        example=[{"type": "login", "timestamp": "2024-03-20T12:00:00Z", "data": {}}]
    )
    metadata: Optional[Dict[str, Any]] = None
```

## Error Handling

Schema validation errors are handled automatically:

```python
try:
    # Data will be validated against schema
    await table.write(event)
except ValidationError as error:
    print(f"Schema validation failed: {error.details}")
```

