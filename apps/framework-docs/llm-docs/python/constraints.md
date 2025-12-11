---
title: Python Data Constraints
description: Define data validation rules and constraints for schema enforcement
priority: 0.70
category: data-validation
language: python
---

# Configuration Constraints and Materialized Views

## Overview

Configuration constraints in Moose provide a way to enforce rules and limitations on your data processing pipeline. They help ensure data quality, control resource usage, and maintain system stability.

## Table Configuration Constraints

### ORDER BY Requirements

- Fields used in `order_by_fields` must exist on the top level schema
- No Optional fields in `order_by_fields` (fields with `Optional` or `None` default)
- When using `order_by_expression`, the expression should reference only top-level, non-optional columns from the schema
- To disable sorting entirely, set `order_by_expression="tuple()"`

### PRIMARY KEY Requirements

- By default, primary key is inferred from `Key[type]` column annotations
- Use `primary_key_expression` to explicitly define primary key with functions or custom ordering
- When `primary_key_expression` is specified, `Key[type]` annotations are ignored for PRIMARY KEY generation
- **CRITICAL**: PRIMARY KEY must be a prefix of ORDER BY (ORDER BY must start with all PRIMARY KEY columns in the same order)

## Schema Design Constraints

- No Optional objects or custom types in `order_by_fields`
- No tuples
- No union types (except `Optional`)
- No mapped types
- No complex Python types
- Large integers must be stored as strings

## Analytics API Constraints

### Function Signature Requirements

- Query functions must follow the exact signature: `def function_name(client, params: QueryModel) -> ResponseModel`
- First parameter must be `client` (database client)
- Second parameter must be typed with your query parameters model
- Return type must be your response model
- No async/await allowed - functions must be synchronous

### Query Execution Requirements

- Always use `client.query.execute(query, variables)` with both arguments
- SQL queries must use parameterized variables with ClickHouse-style syntax
- Variables dictionary must be provided (even if empty)
- ClickHouse uses `{param_name}` syntax for parameters, not Python's `%(param_name)s`

### Parameter Model Requirements

- Must inherit from `pydantic.BaseModel`
- Use proper type hints for all fields
- No complex nested types
- No Optional objects
- Timestamp parameters must be strings in ISO8601 format

### Response Model Requirements

- Must inherit from `pydantic.BaseModel`
- All fields must have default values
- No Optional objects
- No complex nested types

### API Creation Requirements

- Must use generic type parameters: `Api[QueryModel, ResponseModel]`
- Must provide name as first positional parameter
- Must provide query function
- Must provide source table name
- Must use empty `ApiConfig()` for configuration

### Common Issues and Solutions

1. **Function Signature Errors**

   - Problem: Incorrect function signature (e.g., using `utils` instead of `client`)
   - Solution: Use `def function_name(client, params: QueryModel) -> ResponseModel`

2. **Query Execution Errors**

   - Problem: Missing variables dictionary or using Python-style parameter substitution
   - Solution: Always use `client.query.execute(query, variables)` with ClickHouse-style `{param}` syntax

3. **Parameter Type Errors**

   - Problem: Mismatched parameter types or incorrect timestamp formats
   - Solution: Use proper type hints and ensure timestamps are ISO8601 strings

4. **Response Model Errors**

   - Problem: Missing default values or incorrect field types
   - Solution: Provide default values for all fields and use simple types

5. **API Creation Errors**
   - Problem: Incorrect API configuration
   - Solution: Use empty ApiConfig: `config=ApiConfig()`

## Field Naming and Structure

- Similar field names (e.g., ppm1, ppm2, ppm3) must be treated as distinct fields
- Do not collapse similar fields into arrays or objects unless explicitly required
- Each field should be defined individually, even if they follow a naming pattern
- Example of correct field definition:

```python
@dataclass
class SensorData:
    ppm1: float  # Correct: Individual field
    ppm2: float  # Correct: Individual field
    ppm3: float  # Correct: Individual field
    # Incorrect: ppms: List[float]  # Don't collapse similar fields
```

## Pipeline Configuration Constraints

### Stream Configuration

- `parallelism` must be a positive integer (use default unless you have specific scaling requirements)
- `retention_period` must be in seconds (use default unless you have specific data retention needs)
- `destination` must be a valid `OlapTable` instance or name
- Recommended to use `stream=True` instead of custom configuration unless specific requirements exist

### Ingest Configuration

- `destination` must be a valid `Stream` instance or name
- `format` must always be `JSON_ARRAY`

## Type System Constraints

### Supported Types Only

- `str` → String
- `float` → Float64
- `bool` → Boolean
- `datetime` → DateTime
- `dict` → Nested
- `list` → Array
- `Optional[T]` → Nullable (optional fields using `Optional` or `= None`)
- `Enum` → Enum
- `Key[T]` → Same as T

### Unsupported Types -- Do not use

- `Any`
- Union types (except `Optional`)
- `None` as direct type
- `complex`
- `bytes`
- tuples
- custom mapped types
- types not listed in supported types

### Optional Field Restrictions -- Do not use

- Objects
- Nested arrays
- Optional custom types

### Nullable Array Constraints

- Nested arrays cannot be nullable in ClickHouse tables
- For schemas with nullable nested arrays:
  - You must disable table creation in the pipeline (`table=False`)
  - You can still use streams and ingest APIs
  - Create a streaming function to a valid table schema
  - Example error: "Nested type Array(String) cannot be inside Nullable type"

# In-Database Transformations

## Overview

Materialized views in Moose are write-time transformations in ClickHouse. A static SELECT populates a destination table from one or more sources. You query the destination table like any other table. Moose handles DDL ordering, backfills, and migrations automatically.

## MaterializedView

Use `MaterializedView` to create a ClickHouse materialized view that transforms data on write.

```python
from pydantic import BaseModel
from moose_lib import MaterializedView, MaterializedViewOptions, OlapTable, OlapConfig

# Source table
class UserEvent(BaseModel):
    id: str
    user_id: str
    rating: float

source_table = OlapTable[UserEvent]("user_events", OlapConfig(order_by_fields=["id"]))

# Target schema - must match the SELECT output
class UserStats(BaseModel):
    user_id: str
    avg_rating: float
    event_count: int

# Create the materialized view
mv = MaterializedView[UserStats](MaterializedViewOptions(
    select_statement=f"""
        SELECT
            user_id,
            avg(rating) AS avg_rating,
            count(*) AS event_count
        FROM {source_table.name}
        GROUP BY user_id
    """,
    select_tables=[source_table],
    table_name="user_stats",
    order_by_fields=["user_id"],
    materialized_view_name="mv_user_stats",
))
```

### MaterializedViewOptions

```python
class MaterializedViewOptions:
    select_statement: str           # SQL SELECT query for the transformation
    select_tables: list             # Source tables/views the SELECT reads from
    materialized_view_name: str     # Name of the MV object in ClickHouse
    table_name: str                 # Name of the destination table
    order_by_fields: list[str]      # ORDER BY fields for the destination table
    engine: ClickHouseEngines       # Optional: table engine (default: MergeTree)
    metadata: dict                  # Optional: custom metadata
```

### Accessing the Target Table

```python
# The target table is accessible via the target_table property
target = mv.target_table

# Query the destination table in your APIs
query = f"SELECT * FROM {mv.target_table.name} WHERE user_id = 'abc'"
```

## View (Read-time Projection)

Use `View` for read-time projections without write-time transformation.

```python
from moose_lib import View

# Create a view over source tables
active_users_view = View(
    "active_users",
    f"""
    SELECT user_id, name, email
    FROM {users_table.name}
    WHERE active = 1
    """,
    [users_table],
)
```

### View Constructor

```python
View(
    name: str,                      # Name of the view
    select_statement: str,          # SQL SELECT query
    base_tables: list,              # Source tables/views for DDL ordering
)
```

## Basic Constraint Setup

```python
from moose_lib import Constraint, Key
from typing import Dict, Any, Optional

class UserEvent:
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: str

# Create a constraint
rate_limit = Constraint(
    name="rate_limit",
    type="rate",
    config={
        "max_events_per_second": 1000,
        "max_events_per_minute": 50000
    }
)
```

## Constraint Types

### Rate Limiting

```python
# Rate limit by user
user_rate_limit = Constraint(
    name="user_rate_limit",
    type="rate",
    config={
        "max_events_per_second": 100,
        "max_events_per_minute": 5000,
        "group_by": ["user_id"]
    }
)

# Rate limit by event type
event_type_rate_limit = Constraint(
    name="event_type_rate_limit",
    type="rate",
    config={
        "max_events_per_second": 500,
        "max_events_per_minute": 25000,
        "group_by": ["event_type"]
    }
)
```

### Data Validation

```python
# Field validation
field_validation = Constraint(
    name="field_validation",
    type="validation",
    config={
        "rules": {
            "user_id": {
                "required": True,
                "pattern": "^[a-zA-Z0-9_-]{3,50}$"
            },
            "event_type": {
                "required": True,
                "enum": ["click", "view", "purchase"]
            },
            "timestamp": {
                "required": True,
                "format": "iso8601"
            }
        }
    }
)

# Custom validation
custom_validation = Constraint(
    name="custom_validation",
    type="validation",
    config={
        "rules": {
            "value": {
                "required": True,
                "min": 0,
                "max": 1000
            },
            "metadata": {
                "required": False,
                "max_size": 1024
            }
        }
    }
)
```

### Resource Limits

```python
# Memory limits
memory_limit = Constraint(
    name="memory_limit",
    type="resource",
    config={
        "max_memory_mb": 1024,
        "max_memory_per_event_kb": 10
    }
)

# CPU limits
cpu_limit = Constraint(
    name="cpu_limit",
    type="resource",
    config={
        "max_cpu_percent": 80,
        "max_processing_time_ms": 100
    }
)
```

## Constraint Configuration

The `Constraint` class accepts the following configuration:

```python
from typing import TypedDict, Optional, Dict, Any

class ConstraintConfig(TypedDict):
    name: str            # Required: Name of the constraint
    type: str           # Required: Type of constraint (rate, validation, resource)
    config: Dict[str, Any]  # Required: Constraint-specific configuration
    enabled: Optional[bool]  # Optional: Whether the constraint is enabled
    priority: Optional[int]  # Optional: Constraint priority (higher numbers = higher priority)
```

## Constraint Operations

### Managing Constraints

```python
# Enable/disable constraint
await rate_limit.enable()
await rate_limit.disable()

# Update constraint configuration
await rate_limit.update_config({
    "max_events_per_second": 2000,
    "max_events_per_minute": 100000
})

# Get constraint status
status = await rate_limit.get_status()
print("Constraint status:", status)

# Get constraint metrics
metrics = await rate_limit.get_metrics()
print("Constraint metrics:", metrics)
```

### Monitoring Constraints

```python
# Get violation history
violations = await rate_limit.get_violations(
    start_time="2024-03-01T00:00:00Z",
    end_time="2024-03-20T00:00:00Z"
)
print("Violations:", violations)

# Get current limits
limits = await rate_limit.get_limits()
print("Current limits:", limits)

# Get constraint statistics
stats = await rate_limit.get_statistics()
print("Constraint statistics:", stats)
```

## Error Handling

```python
try:
    # Apply constraint
    await rate_limit.apply(event)
except RateLimitExceededError as error:
    print("Rate limit exceeded:", error.message)
    # Handle rate limit exceeded
except ValidationError as error:
    print("Validation failed:", error.message)
    # Handle validation errors
except ResourceLimitExceededError as error:
    print("Resource limit exceeded:", error.message)
    # Handle resource limit exceeded
except Exception as error:
    print("Unexpected error:", error)
    # Handle other errors
```

## Best Practices

1. **Constraint Design**

   - Start with conservative limits
   - Monitor constraint effectiveness
   - Adjust limits based on usage
   - Use appropriate constraint types
   - Consider system resources
   - Plan for growth

2. **Performance**

   - Monitor constraint overhead
   - Use efficient validation rules
   - Optimize rate limits
   - Consider resource usage
   - Test constraint impact
   - Monitor system load

3. **Maintenance**

   - Review constraint effectiveness
   - Update limits regularly
   - Monitor violation patterns
   - Clean up unused constraints
   - Document constraint purposes
   - Track constraint changes

4. **Error Handling**
   - Handle constraint violations
   - Monitor error rates
   - Set up alerts
   - Log violations
   - Implement fallbacks
   - Track error patterns

## Example Usage

### Rate Limiting Example

```python
from moose_lib import Constraint, Key
from typing import Dict, Any

class UserEvent:
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: str

# Create rate limiting constraints
user_rate_limit = Constraint(
    name="user_rate_limit",
    type="rate",
    config={
        "max_events_per_second": 100,
        "max_events_per_minute": 5000,
        "group_by": ["user_id"]
    }
)

event_type_rate_limit = Constraint(
    name="event_type_rate_limit",
    type="rate",
    config={
        "max_events_per_second": 500,
        "max_events_per_minute": 25000,
        "group_by": ["event_type"]
    }
)

# Apply constraints with error handling
try:
    # Apply user rate limit
    await user_rate_limit.apply(event)

    # Apply event type rate limit
    await event_type_rate_limit.apply(event)

    # Process event if constraints pass
    await process_event(event)
except RateLimitExceededError as error:
    print("Rate limit exceeded:", error.message)
    # Handle rate limit exceeded
except Exception as error:
    print("Unexpected error:", error)
    # Handle other errors
```

### Validation Example

```python
# Create validation constraints
field_validation = Constraint(
    name="field_validation",
    type="validation",
    config={
        "rules": {
            "user_id": {
                "required": True,
                "pattern": "^[a-zA-Z0-9_-]{3,50}$"
            },
            "event_type": {
                "required": True,
                "enum": ["click", "view", "purchase"]
            },
            "timestamp": {
                "required": True,
                "format": "iso8601"
            }
        }
    }
)

# Apply validation with error handling
try:
    # Apply field validation
    await field_validation.apply(event)

    # Process event if validation passes
    await process_event(event)
except ValidationError as error:
    print("Validation failed:", error.message)
    # Handle validation errors
except Exception as error:
    print("Unexpected error:", error)
    # Handle other errors
```

### Resource Limiting Example

```python
# Create resource constraints
memory_limit = Constraint(
    name="memory_limit",
    type="resource",
    config={
        "max_memory_mb": 1024,
        "max_memory_per_event_kb": 10
    }
)

# Apply resource constraints with error handling
try:
    # Apply memory limit
    await memory_limit.apply(event)

    # Process event if resource constraints pass
    await process_event(event)
except ResourceLimitExceededError as error:
    print("Resource limit exceeded:", error.message)
    # Handle resource limit exceeded
except Exception as error:
    print("Unexpected error:", error)
    # Handle other errors
```
