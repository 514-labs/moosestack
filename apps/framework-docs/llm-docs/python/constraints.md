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

### Key Requirements

- Schema must have `Key[type]` on a top level field passed into IngestPipeline or OlapTable (unless using `primary_key_expression`)
- If using `order_by_fields`, the first field must be the primary key (`Key[type]`) when present (unless using `primary_key_expression`)
- If using `order_by_expression`, ensure your expression starts with the primary key column when a primary key exists (unless using `primary_key_expression`)
- If using `primary_key_expression`, the expression overrides any `Key[type]` annotations on columns

### ORDER BY Requirements

- Fields used in `order_by_fields` must exist on the top level schema
- No Optional fields in `order_by_fields` (fields with `Optional` or `None` default)
- When using `order_by_expression`, the expression should reference only top-level, non-optional columns from the schema
- To disable sorting entirely, set `order_by_expression="tuple()"`

### PRIMARY KEY Requirements

- By default, primary key is inferred from `Key[type]` column annotations
- Use `primary_key_expression` to explicitly define primary key with functions or custom ordering
- When `primary_key_expression` is specified, `Key[type]` annotations are ignored for PRIMARY KEY generation
- The `primary_key_expression` should reference only top-level, non-optional columns from the schema
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

Materialized views in Moose provide a powerful way to transform and aggregate data directly in your database. They are automatically updated as new data arrives, making them perfect for real-time analytics and reporting.

## Basic View Setup

```python
from moose_lib import MaterializedView, Key
from typing import Dict, Any

class UserEvent:
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: str

# Create a materialized view
user_event_stats = MaterializedView(
    name="user_event_stats",
    query="""
    SELECT
        user_id,
        COUNT(*) as event_count,
        COUNT(DISTINCT event_type) as unique_event_types
    FROM user_event_table
    GROUP BY user_id
    """
)
```

## View Configuration

The `MaterializedView` class accepts the following configuration:

```python
from typing import TypedDict, Optional

class ViewConfig(TypedDict):
    name: str            # Required: Name of the view
    query: str          # Required: SQL query for the view
    refresh_interval: Optional[int]  # Optional: Refresh interval in seconds
    validation: Optional[Dict[str, bool]]  # Optional: Validation settings
```

## View Operations

### Querying Views

```python
# Basic query
results = await user_event_stats.query(
    filter="event_count > 5",
    limit=10
)

# Query with joins
results = await user_event_stats.query(
    select=["s.user_id", "s.event_count", "u.name"],
    from_="user_event_stats s JOIN user_table u ON s.user_id = u.id",
    filter="s.event_count > 5"
)

# Query with aggregations
results = await user_event_stats.query(
    select=["user_id", "SUM(event_count) as total_events"],
    group_by=["user_id"],
    having="total_events > 100"
)

# Query with time-based filtering
results = await user_event_stats.query(
    select=["user_id", "event_count"],
    filter="timestamp >= '2024-03-01' AND timestamp < '2024-03-20'",
    order_by="event_count DESC"
)
```

### View Maintenance

```python
# Check view status
status = await user_event_stats.get_status()
print("View status:", status)

# Refresh view manually
await user_event_stats.refresh()

# Drop view
await user_event_stats.drop()

# Get view metadata
metadata = await user_event_stats.get_metadata()
print("View metadata:", metadata)

# Get view statistics
stats = await user_event_stats.get_statistics()
print("View statistics:", stats)
```

## Error Handling

```python
try:
    # Query the view
    results = await user_event_stats.query(filter="event_count > 5")
except ViewNotFoundError as error:
    print("View not found:", error.message)
    # Create the view if it doesn't exist
    await user_event_stats.create()
except QueryError as error:
    print("Query failed:", error.message)
    # Handle query errors
except RefreshError as error:
    print("View refresh failed:", error.message)
    # Handle refresh errors
except Exception as error:
    print("Unexpected error:", error)
    # Handle other errors
```

## Best Practices

1. **Query Design**

   - Keep queries simple and focused
   - Use appropriate aggregations
   - Consider performance impact
   - Test query performance
   - Use indexes effectively
   - Avoid complex joins when possible

2. **Performance**

   - Set appropriate refresh intervals
   - Monitor view size
   - Optimize query patterns
   - Use appropriate indexes
   - Consider materialization costs
   - Monitor query performance

3. **Maintenance**

   - Monitor view health
   - Check refresh status
   - Clean up unused views
   - Update refresh intervals
   - Monitor disk usage
   - Track view dependencies

4. **Error Handling**
   - Handle query errors
   - Monitor refresh failures
   - Set up alerts
   - Log issues
   - Implement retry logic
   - Track error patterns

## Example Usage

### Event Statistics View

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, List
from moose_lib import MaterializedView, Key

@dataclass
class UserEvent:
    id: Key[str]
    user_id: str
    event_type: str
    timestamp: datetime
    value: Optional[float] = None

    @classmethod
    def from_dict(cls, data: dict) -> 'UserEvent':
        """Create a UserEvent from a dictionary."""
        return cls(
            id=data['id'],
            user_id=data['user_id'],
            event_type=data['event_type'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            value=data.get('value')
        )

# Create a view for event statistics
event_stats = MaterializedView(
    name="event_stats",
    query="""
    SELECT
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen,
        AVG(CASE WHEN value IS NOT NULL THEN value ELSE 0 END) as avg_value
    FROM user_event_table
    GROUP BY event_type
    """
)

async def get_event_statistics(min_count: int = 100, limit: int = 10) -> List[dict]:
    """Get event statistics with error handling.

    Args:
        min_count: Minimum count threshold for events
        limit: Maximum number of results to return

    Returns:
        List of event statistics
    """
    try:
        results = await event_stats.query(
            filter=f"count > {min_count}",
            order_by="count DESC",
            limit=limit
        )
        return results
    except Exception as error:
        print(f"Failed to query event statistics: {error}")
        return []

# Usage example
async def main():
    stats = await get_event_statistics(min_count=100, limit=10)
    for stat in stats:
        print(f"Event type: {stat['event_type']}, Count: {stat['count']}")
```

### User Activity View

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional
from moose_lib import MaterializedView, Key

@dataclass
class UserActivity:
    user_id: str
    event_type: str
    date: datetime
    daily_count: int
    unique_events: int
    first_activity: datetime
    last_activity: datetime

    @classmethod
    def from_dict(cls, data: dict) -> 'UserActivity':
        """Create a UserActivity from a dictionary."""
        return cls(
            user_id=data['user_id'],
            event_type=data['event_type'],
            date=datetime.fromisoformat(data['date']),
            daily_count=data['daily_count'],
            unique_events=data['unique_events'],
            first_activity=datetime.fromisoformat(data['first_activity']),
            last_activity=datetime.fromisoformat(data['last_activity'])
        )

# Create a view for user activity
user_activity = MaterializedView(
    name="user_activity",
    query="""
    SELECT
        user_id,
        event_type,
        DATE_TRUNC('day', timestamp) as date,
        COUNT(*) as daily_count,
        COUNT(DISTINCT event_type) as unique_events,
        MIN(timestamp) as first_activity,
        MAX(timestamp) as last_activity
    FROM user_event_table
    GROUP BY user_id, event_type, DATE_TRUNC('day', timestamp)
    """
)

async def get_user_activity(
    start_date: datetime,
    min_total_count: int = 10
) -> List[UserActivity]:
    """Get user activity statistics.

    Args:
        start_date: Start date for activity query
        min_total_count: Minimum total count threshold

    Returns:
        List of UserActivity objects
    """
    try:
        results = await user_activity.query(
            select=[
                "user_id",
                "event_type",
                "SUM(daily_count) as total_count"
            ],
            filter=f"date >= '{start_date.isoformat()}'",
            group_by=["user_id", "event_type"],
            having=f"total_count > {min_total_count}",
            order_by="total_count DESC"
        )
        return [UserActivity.from_dict(result) for result in results]
    except Exception as error:
        print(f"Failed to query user activity: {error}")
        return []

# Usage example
async def main():
    start_date = datetime.now() - timedelta(days=30)
    activities = await get_user_activity(start_date, min_total_count=10)
    for activity in activities:
        print(
            f"User: {activity.user_id}, "
            f"Event: {activity.event_type}, "
            f"Total Count: {activity.daily_count}"
        )
```

### Real-time Analytics View

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional
from moose_lib import MaterializedView, Key

@dataclass
class AnalyticsMetrics:
    hour: datetime
    event_type: str
    event_count: int
    unique_users: int
    avg_duration: float
    max_duration: float
    min_duration: float

    @classmethod
    def from_dict(cls, data: dict) -> 'AnalyticsMetrics':
        """Create an AnalyticsMetrics from a dictionary."""
        return cls(
            hour=datetime.fromisoformat(data['hour']),
            event_type=data['event_type'],
            event_count=data['event_count'],
            unique_users=data['unique_users'],
            avg_duration=data['avg_duration'],
            max_duration=data['max_duration'],
            min_duration=data['min_duration']
        )

# Create a real-time analytics view
analytics_view = MaterializedView(
    name="real_time_analytics",
    query="""
    SELECT
        DATE_TRUNC('hour', timestamp) as hour,
        event_type,
        COUNT(*) as event_count,
        COUNT(DISTINCT user_id) as unique_users,
        AVG(duration) as avg_duration,
        MAX(duration) as max_duration,
        MIN(duration) as min_duration
    FROM user_event_table
    WHERE timestamp >= NOW() - INTERVAL 24 HOUR
    GROUP BY DATE_TRUNC('hour', timestamp), event_type
    """
)

async def get_realtime_analytics(
    hours_ago: int = 1,
    limit: Optional[int] = None
) -> List[AnalyticsMetrics]:
    """Get real-time analytics data.

    Args:
        hours_ago: Number of hours to look back
        limit: Maximum number of results to return

    Returns:
        List of AnalyticsMetrics objects
    """
    try:
        results = await analytics_view.query(
            select=[
                "hour",
                "event_type",
                "event_count",
                "unique_users"
            ],
            filter=f"hour >= NOW() - INTERVAL {hours_ago} HOUR",
            order_by="hour DESC, event_count DESC",
            limit=limit
        )
        return [AnalyticsMetrics.from_dict(result) for result in results]
    except Exception as error:
        print(f"Failed to query real-time analytics: {error}")
        return []

# Usage example
async def main():
    metrics = await get_realtime_analytics(hours_ago=1)
    for metric in metrics:
        print(
            f"Hour: {metric.hour}, "
            f"Event: {metric.event_type}, "
            f"Count: {metric.event_count}, "
            f"Unique Users: {metric.unique_users}"
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
