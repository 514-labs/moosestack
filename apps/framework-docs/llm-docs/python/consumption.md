# Analytics APIs

## Overview

Moose provides one type of API for exposing data:

**Api**:  They are designed to read data from your OLAP database. Out of the box, these APIs provide:

- Automatic type validation and type conversion for your query parameters, which are sent in the URL, and response body
- Managed database client connection
- Automatic OpenAPI documentation generation

## Api Usage

- Powering user-facing analytics, dashboards and other front-end components
- Enabling AI tools to interact with your data
- Building custom APIs for your internal tools

### Features

- Type-safe parameter handling
- Built-in pagination support
- Automatic parameter validation
- SQL query parameterization
- Support for nullable parameters
- Default parameter values

### Best Practices

1. **Parameter Types**

   - Use `Nullable(T)` for optional parameters
   - Specify exact types (e.g., `Float64`, `Int32`)
   - Provide default values when appropriate

2. **SQL Queries**

   - Use parameterized queries for all user input
   - Include proper WHERE clauses for filtering
   - Add ORDER BY for consistent results
   - Use LIMIT for pagination

3. **Error Handling**
   - The API handles parameter validation automatically
   - SQL errors are caught and returned as proper HTTP errors
   - Invalid parameter types are rejected

## Api Usage

The `Api` class requires both input (query) and output (response) type parameters, and must be instantiated with a name as the first positional parameter. Here's the correct pattern:

```python
from moose_lib import Api, ApiConfig
from pydantic import BaseModel
from typing import Dict, Any, Optional

# Define your query parameters model
class HeartRateStatsQuery(BaseModel):
    start_time: str  # ISO8601 string, beginning of the time range
    end_time: str    # ISO8601 string, end of the time range

# Define your response model
class HeartRateStats(BaseModel):
    min_heart_rate: float = 0.0
    max_heart_rate: float = 0.0
    avg_heart_rate: float = 0.0

# Define your query function
def get_heart_rate_stats(client, params: HeartRateStatsQuery) -> HeartRateStats:
    """
    Retrieve the minimum, maximum, and average heart rate for a given time range.

    Args:
        client: Database client for executing queries
        params: Contains start_time and end_time parameters

    Returns:
        HeartRateStats object containing min, max, and avg heart rate values
    """

    # Execute the query with parameterized values
    result = client.query.execute(
        """
        SELECT
            MIN(heart_rate) AS min_heart_rate,
            MAX(heart_rate) AS max_heart_rate,
            AVG(heart_rate) AS avg_heart_rate
        FROM heart_rate_measurement
        WHERE timestamp >= {start_time}
        AND timestamp <= {end_time}
        """,
        {
            "start_time": params.start_time,
            "end_time": params.end_time
        }
    )

    # Handle case when no data is found
    if not result or len(result) == 0:
        return HeartRateStats()

    # Return the first (and only) row of results
    return HeartRateStats(**result[0])

# Create the analytics API
heart_rate_stats_api = Api[HeartRateStatsQuery, HeartRateStats](
    "getHeartRateStats",
    query_function=get_heart_rate_stats,
    source="heart_rate_measurement",
    config=ApiConfig()  # Empty config is valid
)
```

### Required Parameters

1. **Function Signature**

   - Must be synchronous (not async)
   - First parameter must be `client`
   - Second parameter must be typed with your query parameters model
   - Return type must be your response model
   - ❌ Incorrect: `def function_name(params: QueryModel, utils) -> ResponseModel`
   - ✅ Correct: `def function_name(client, params: QueryModel) -> ResponseModel`

2. **Query Execution**

   - Must use `client.query.execute(query, variables)` with both arguments
   - First argument is the SQL query string
   - Second argument is a dictionary of parameter values
   - ❌ Incorrect: `client.query.execute(query)`
   - ✅ Correct: `client.query.execute(query, {"param": value})`

3. **API Creation**
   - Must use generic type parameters: `Api[QueryModel, ResponseModel]`
   - Must provide name as first positional parameter
   - Must provide query function
   - Must provide source table name
   - Must use empty `ApiConfig()` for configuration
   - ❌ Incorrect: `config=ApiConfig(auth={"required": True})`
   - ✅ Correct: `config=ApiConfig()`

### Common Issues and Solutions

1. **Function Signature Errors**

   - Problem: Using `utils` instead of `client` or wrong parameter order
   - Solution: Use `def function_name(client, params: QueryModel) -> ResponseModel`

2. **Query Execution Errors**

   - Problem: Missing variables dictionary or using Python-style parameter substitution
   - Solution: Always use `client.query.execute(query, variables)` with ClickHouse-style `{param}` syntax

3. **Configuration Errors**
   - Problem: Passing parameters to ApiConfig
   - Solution: Use empty ApiConfig: `config=ApiConfig()`

### Best Practices

1. **Query Functions**

   - Use proper function signature with `client` first
   - Always provide variables dictionary to execute
   - Use ClickHouse-style parameter syntax
   - Handle empty results with default values

2. **Parameter Models**

   - Use Pydantic BaseModel
   - Document parameter types (especially timestamps)
   - Use proper type hints

3. **Response Models**

   - Use Pydantic BaseModel
   - Provide default values for all fields
   - Match database column names

4. **API Creation**
   - Use proper generic type parameters
   - Provide all required parameters
   - Use empty ApiConfig

## Python-Specific Requirements

When creating Python analytics APIs, you must follow these requirements exactly:

1. **Imports**

   ```python
   from moose_lib import Api
   from pydantic import BaseModel
   from typing import Optional, Dict, Any
   ```

2. **Response Models**

   - Always use Pydantic models
   - Use standard Python types (not Key[str])
   - Use snake_case for field names
   - Define all nested models explicitly

   ```python
   class Accelerometer(BaseModel):
       x: float = 0.0
       y: float = 0.0
       z: float = 0.0

   class Gyroscope(BaseModel):
       x: float = 0.0
       y: float = 0.0
       z: float = 0.0

   class PPM(BaseModel):
       value: float = 0.0

   class BrainData(BaseModel):
       id: str
       timestamp: float
       acc: Accelerometer
       gyro: Gyroscope
       ppm: PPM
   ```

3. **Query Functions**

   - Must be synchronous (not async)
   - Must take params and utils arguments
   - Must return a single instance of the response model
   - Must never return None, a list, or a dict
   - Must handle the case when no data is found
   - Use snake_case for function names

   ```python
   # CORRECT: Returns a single model instance with default values
   def get_brain_data(params: Dict[str, Any], utils) -> BrainData:
       client = utils.client
       sql = utils.sql

       result = client.query.execute(sql"""
           SELECT *
           FROM brain_data
           WHERE id = {params['id']}
           LIMIT 1
       """)

       if not result:
           # Return a default-constructed model with zero values
           return BrainData(
               id="",
               timestamp=0.0,
               acc=Accelerometer(),
               gyro=Gyroscope(),
               ppm=PPM()
           )

       return BrainData(**result[0])

   # CORRECT: Returns a single model instance with custom defaults
   def get_user_event(params: Dict[str, Any], utils) -> UserEvent:
       client = utils.client
       sql = utils.sql

       result = client.query.execute(sql"""
           SELECT *
           FROM UserEventTable
           WHERE user_id = {params['user_id']}
           LIMIT 1
       """)

       if not result:
           # Return a default-constructed model with meaningful defaults
           return UserEvent(
               id="",
               user_id=params['user_id'],
               event_type="unknown",
               timestamp="1970-01-01T00:00:00Z"
           )

       return UserEvent(**result[0])

   # INCORRECT: Returns a list
   def get_brain_data(params: Dict[str, Any], utils) -> list[BrainData]:  # This will cause an error
       client = utils.client
       sql = utils.sql

       result = client.query.execute(sql"""
           SELECT * FROM brain_data
       """)

       return result  # Wrong: returning a list

   # INCORRECT: Returns None
   def get_brain_data(params: Dict[str, Any], utils) -> BrainData:
       client = utils.client
       sql = utils.sql

       result = client.query.execute(sql"""
           SELECT * FROM brain_data
           WHERE id = {params['id']}
           LIMIT 1
       """)

       if not result:
           return None  # Wrong: returning None

       return BrainData(**result[0])

   # INCORRECT: Returns a dict
   def get_brain_data(params: Dict[str, Any], utils) -> BrainData:
       client = utils.client
       sql = utils.sql

       result = client.query.execute(sql"""
           SELECT * FROM brain_data
           WHERE id = {params['id']}
           LIMIT 1
       """)

       if not result:
           return {}  # Wrong: returning a dict

       return result[0]  # Wrong: returning a dict
   ```

4. **API Creation**

   - Use two type parameters: response model and query function
   - The API name is derived from the variable name, DO NOT specify it in the constructor
   - Configure settings for auth and rate limiting

   ```python
   # CORRECT: API name is derived from the variable name
   BrainDataApi = Api[BrainData, get_brain_data](
       source="brain_data",
       settings={
           "auth": {
               "required": True,
               "roles": ["admin"]
           }
       }
   )

   # INCORRECT: Do not specify name parameter
   BrainDataApi = Api[BrainData, get_brain_data](
       name="BrainDataApi",  # This will cause an error
       source="brain_data"
   )
   ```

5. **Best Practices**
   - Use snake_case for all names
   - Use proper Python type hints
   - Never use dictionary expressions in type annotations
   - Always inherit from BaseModel for response models
   - Use parameterized SQL queries
   - Handle errors appropriately
   - Let the API name be derived from the variable name
   - Use descriptive variable names that match the API's purpose
   - Use synchronous functions (no async/await)
   - Always return a valid model instance (never None, list, or dict)
   - Provide meaningful default values for all fields
   - Handle the case when no data is found
   - Use proper type hints for all parameters and return values

## Common Issues and Solutions

### 1. Return Type Errors

- **Problem**: Function returns a list, None, or dict instead of a model instance
- **Solution**: Always return a valid model instance, even when no data is found
- **Example**:

  ```python
  # Wrong
  if not result:
      return None  # or return [] or return {}

  # Correct
  if not result:
      return BrainData(
          id="",
          timestamp=0.0,
          acc=Accelerometer(),
          gyro=Gyroscope(),
          ppm=PPM()
      )
  ```

### 2. Nested Model Errors

- **Problem**: Missing or invalid nested model definitions
- **Solution**: Define all nested models explicitly with proper defaults
- **Example**:

  ```python
  # Wrong
  class BrainData(BaseModel):
      id: str
      acc: Dict[str, float]  # Using dict instead of proper model

  # Correct
  class Accelerometer(BaseModel):
      x: float = 0.0
      y: float = 0.0
      z: float = 0.0

  class BrainData(BaseModel):
      id: str
      acc: Accelerometer
  ```

### 3. Type Hint Errors

- **Problem**: Incorrect return type hints
- **Solution**: Use proper type hints for the model and function
- **Example**:

  ```python
  # Wrong
  def get_brain_data(params: Dict[str, Any], utils) -> list[BrainData]:

  # Correct
  def get_brain_data(params: Dict[str, Any], utils) -> BrainData:
  ```

## Basic API Setup

```python
from moose_lib import Api
from pydantic import BaseModel
from typing import Optional, Dict, Any

class UserEvent(BaseModel):
    id: str
    user_id: str
    event_type: str
    timestamp: str

# Create a analytics API with a query function
def get_user_events(params: Dict[str, Any], utils) -> list[UserEvent]:
    client = utils.client
    sql = utils.sql

    # Use the SQL helper for type-safe queries
    result = await client.query.execute(sql"""
        SELECT *
        FROM UserEventTable
        WHERE user_id = {params['user_id']}
        ORDER BY timestamp DESC
        LIMIT {params.get('limit', 10)}
    """)

    return result

UserEventApi = Api[UserEvent, get_user_events](
    source="UserEventTable"
)
```

## API Configuration

The `Api` class accepts the following configuration:

```python
from typing import TypedDict, Literal, Optional, Callable, Any

class ApiConfig(TypedDict):
    name: str            # Required: Name of the API
    source: str          # Required: Source table or view
    settings: Optional[dict]  # Additional settings

# Query function signature
QueryFunction = Callable[[Dict[str, Any], Any], list[BaseModel]]
```

## API Operations

### Basic Endpoints

```python
# Get by ID endpoint
def get_event_by_id(params: Dict[str, Any], utils) -> Optional[UserEvent]:
    client = utils.client
    sql = utils.sql

    result = await client.query.execute(sql"""
        SELECT *
        FROM UserEventTable
        WHERE id = {params['id']}
        LIMIT 1
    """)

    return result[0] if result else None

GetByIdApi = Api[UserEvent, get_event_by_id](
    name="GetByIdApi",
    source="UserEventTable"
)

# List endpoint with filtering
def list_events(params: Dict[str, Any], utils) -> list[UserEvent]:
    client = utils.client
    sql = utils.sql

    result = await client.query.execute(sql"""
        SELECT *
        FROM UserEventTable
        WHERE user_id = {params['user_id']}
        AND timestamp >= {params['start_date']}
        AND timestamp <= {params['end_date']}
        ORDER BY timestamp DESC
        LIMIT {params.get('limit', 10)}
    """)

    return result

ListApi = Api[UserEvent, list_events](
    name="ListApi",
    source="UserEventTable"
)
```

### Advanced Endpoints

```python
class EventStats(BaseModel):
    event_type: str
    count: int
    unique_users: int
    first_seen: str
    last_seen: str

def get_event_stats(params: Dict[str, Any], utils) -> list[EventStats]:
    client = utils.client
    sql = utils.sql

    result = await client.query.execute(sql"""
        SELECT
            event_type,
            count() as count,
            count(distinct user_id) as unique_users,
            min(timestamp) as first_seen,
            max(timestamp) as last_seen
        FROM UserEventTable
        WHERE timestamp >= {params['start_date']}
        AND timestamp <= {params['end_date']}
        GROUP BY event_type
        ORDER BY count DESC
    """)

    return result

StatsApi = Api[EventStats, get_event_stats](
    name="StatsApi",
    source="UserEventTable"
)
```

## Security

### Authentication

```python
def get_secure_events(params: Dict[str, Any], utils) -> list[UserEvent]:
    # Check authentication
    if not utils.jwt:
        raise Exception("Authentication required")

    client = utils.client
    sql = utils.sql

    result = await client.query.execute(sql"""
        SELECT *
        FROM UserEventTable
        WHERE user_id = {params['user_id']}
    """)

    return result

SecureApi = Api[UserEvent, get_secure_events](
    name="SecureApi",
    source="UserEventTable",
    settings={
        "auth": {
            "required": True,
            "roles": ["admin", "analyst"]
        }
    }
)
```

### Rate Limiting

```python
def get_rate_limited_events(params: Dict[str, Any], utils) -> list[UserEvent]:
    client = utils.client
    sql = utils.sql

    result = await client.query.execute(sql"""
        SELECT *
        FROM UserEventTable
        LIMIT {params.get('limit', 10)}
    """)

    return result

RateLimitedApi = Api[UserEvent, get_rate_limited_events](
    name="RateLimitedApi",
    source="UserEventTable",
    settings={
        "rate_limit": {
            "requests": 100,
            "period": 60  # 100 requests per minute
        }
    }
)
```

## Best Practices

1. **API Design**

   - Use meaningful endpoint paths
   - Implement proper error handling
   - Document your APIs
   - Version your APIs

2. **Security**

   - Implement authentication
   - Use rate limiting
   - Validate input parameters
   - Sanitize SQL queries

3. **Performance**

   - Use appropriate caching
   - Optimize queries
   - Monitor API usage
   - Set reasonable limits

4. **Error Handling**
   - Return proper status codes
   - Provide error messages
   - Log errors
   - Monitor failures

## Example Usage

### Basic API

```python
def get_basic_events(params: Dict[str, Any], utils) -> list[UserEvent]:
    client = utils.client
    sql = utils.sql

    result = await client.query.execute(sql"""
        SELECT *
        FROM UserEventTable
        ORDER BY timestamp DESC
        LIMIT {params.get('limit', 10)}
    """)

    return result

BasicApi = Api[UserEvent, get_basic_events](
    name="BasicApi",
    source="UserEventTable"
)
```

### Advanced API

```python
def get_advanced_stats(params: Dict[str, Any], utils) -> list[EventStats]:
    client = utils.client
    sql = utils.sql

    result = await client.query.execute(sql"""
        SELECT
            event_type,
            count() as count,
            count(distinct user_id) as unique_users,
            min(timestamp) as first_seen,
            max(timestamp) as last_seen
        FROM UserEventTable
        WHERE timestamp >= {params['start_date']}
        AND timestamp <= {params['end_date']}
        GROUP BY event_type
        ORDER BY count DESC
    """)

    return result

AdvancedApi = Api[EventStats, get_advanced_stats](
    name="AdvancedApi",
    source="UserEventTable",
    settings={
        "auth": {
            "required": True,
            "roles": ["analyst"]
        },
        "rate_limit": {
            "requests": 100,
            "period": 60
        }
    }
)
```

## Troubleshooting

### Common Issues

1. **Parameter Type Errors**

   - Problem: Parameters not matching expected types
   - Solution: Use correct type annotations in query_params

2. **SQL Errors**

   - Problem: Invalid SQL syntax or missing columns
   - Solution: Test SQL queries directly in your database

3. **Performance Issues**

   - Problem: Slow queries or large result sets
   - Solution: Add proper indexes and use LIMIT

4. **Authentication Errors**
   - Problem: Missing or invalid authentication
   - Solution: Check API settings and authentication configuration

### SQL Query Syntax

When writing SQL queries in your query functions, follow these rules:

1. **Query String Format**

   ```python
   # CORRECT: Use triple quotes for multi-line queries
   result = client.query.execute("""
       SELECT * FROM brain_data
       WHERE id = {params.id}
       LIMIT 1
   """)

   # CORRECT: Use single quotes for simple queries
   result = client.query.execute(
       "SELECT * FROM brain_data LIMIT 1"
   )

   # INCORRECT: Do not use sql""" syntax
   result = client.query.execute(sql"""  # This will cause a syntax error
       SELECT * FROM brain_data
   """)
   ```

2. **Parameter Interpolation**

   ```python
   # CORRECT: Use params model attributes
   result = client.query.execute("""
       SELECT * FROM brain_data
       WHERE id = {params.id}
       AND timestamp >= {params.start_time}
       LIMIT {params.limit}
   """)

   # CORRECT: Use get() for optional parameters
   result = client.query.execute("""
       SELECT * FROM brain_data
       WHERE id = {params.id}
       LIMIT {params.get('limit', 100)}
   """)

   # INCORRECT: Do not use f-strings
   result = client.query.execute(f"""  # This is unsafe
       SELECT * FROM brain_data
       WHERE id = {params.id}
   """)
   ```

3. **Query Structure**

   ```python
   # CORRECT: Well-structured query with proper formatting
   result = client.query.execute("""
       SELECT
           id,
           timestamp,
           value
       FROM brain_data
       WHERE id = {params.id}
       ORDER BY timestamp DESC
       LIMIT {params.limit}
   """)

   # CORRECT: Simple query for single record
   result = client.query.execute("""
       SELECT * FROM brain_data
       WHERE id = {params.id}
       LIMIT 1
   """)
   ```

### Common Issues and Solutions

1. **SQL Syntax Errors**

   - Problem: Using incorrect SQL string syntax
   - Solution: Use triple quotes for multi-line queries

   ```python
   # Wrong
   result = client.query.execute(sql"""
       SELECT * FROM brain_data
   """)

   # Correct
   result = client.query.execute("""
       SELECT * FROM brain_data
   """)
   ```

2. **Parameter Interpolation**

   - Problem: Unsafe parameter interpolation
   - Solution: Use the params model attributes

   ```python
   # Wrong
   result = client.query.execute(f"""
       SELECT * FROM brain_data
       WHERE id = {params.id}
   """)

   # Correct
   result = client.query.execute("""
       SELECT * FROM brain_data
       WHERE id = {params.id}
   """)
   ```

3. **Query Structure**

   - Problem: Poorly formatted or unsafe queries
   - Solution: Use proper SQL formatting and parameterization

   ```python
   # Wrong
   result = client.query.execute("""
       SELECT * FROM brain_data WHERE id=" + params.id
   """)

   # Correct
   result = client.query.execute("""
       SELECT * FROM brain_data
       WHERE id = {params.id}
       LIMIT 1
   """)
   ```

## Response Models

When creating an Api, you need to define both the query parameters model and the response model. For list responses, you should create a wrapper model:

```python
from moose_lib import Api, ApiConfig
from pydantic import BaseModel
from typing import List, Optional

# Define your base data model
class BrainData(BaseModel):
    id: str
    timestamp: float
    value: float

# Define your list response model
class BrainDataListResponse(BaseModel):
    items: List[BrainData]
    total: int = 0

# Define your query parameters model
class BrainDataQuery(BaseModel):
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    limit: Optional[int] = 100

# Define your query function
def get_brain_data(params: BrainDataQuery, utils) -> BrainDataListResponse:
    client = utils.client
    sql = utils.sql

    result = client.query.execute("""
        SELECT * FROM brain_data
        WHERE ({params.start_time} IS NULL OR timestamp >= {params.start_time})
        AND ({params.end_time} IS NULL OR timestamp <= {params.end_time})
        ORDER BY timestamp DESC
        LIMIT {params.limit}
    """)

    if not result:
        return BrainDataListResponse(items=[])

    return BrainDataListResponse(
        items=[BrainData(**item) for item in result],
        total=len(result)
    )

# CORRECT: Use proper response model and ApiConfig
brain_data_api = Api[BrainDataQuery, BrainDataListResponse](
    "get_brain_data",
    query_function=get_brain_data,
    source="brain_data",
    config=ApiConfig()  # Empty config is valid
)

# INCORRECT: Using base model for list response
brain_data_api = Api[BrainDataQuery, BrainData](  # Wrong: should use list response model
    "get_brain_data",
    query_function=get_brain_data,
    source="brain_data",
    config=ApiConfig()
)

# INCORRECT: Invalid ApiConfig parameters
brain_data_api = Api[BrainDataQuery, BrainDataListResponse](
    "get_brain_data",
    query_function=get_brain_data,
    source="brain_data",
    config=ApiConfig(
        auth={"required": True}  # Wrong: invalid config parameter
    )
)
```

### Response Model Structure

1. **Base Data Model**

   - Define your core data structure
   - Use proper Python types
   - Match your database schema

   ```python
   class BrainData(BaseModel):
       id: str
       timestamp: float
       value: float
   ```

2. **List Response Model**

   - Wrap your base model in a list response
   - Include total count if needed
   - Use proper type hints

   ```python
   class BrainDataListResponse(BaseModel):
       items: List[BrainData]
       total: int = 0
   ```

3. **Query Function Return Type**
   - Must match the response model
   - Handle empty results properly
   - Convert database results to models
   ```python
   def get_brain_data(params: BrainDataQuery, utils) -> BrainDataListResponse:
       # ... query execution ...
       if not result:
           return BrainDataListResponse(items=[])
       return BrainDataListResponse(
           items=[BrainData(**item) for item in result],
           total=len(result)
       )
   ```

### ApiConfig Usage

1. **Basic Configuration**

   - Empty config is valid
   - Use only supported parameters
   - Follow configuration guidelines

   ```python
   # CORRECT
   config=ApiConfig()  # Empty config is valid

   # INCORRECT
   config=ApiConfig(
       auth={"required": True}  # Wrong: invalid parameter
   )
   ```

2. **Supported Parameters**

   - Check documentation for supported options
   - Use proper parameter types
   - Follow configuration patterns

   ```python
   # CORRECT
   config=ApiConfig(
       # Add supported parameters here
   )

   # INCORRECT
   config=ApiConfig(
       unsupported_param=True  # Wrong: unsupported parameter
   )
   ```

### Common Issues and Solutions

1. **Incorrect Response Model**

   - Problem: Using base model for list response
   - Solution: Create proper list response model

   ```python
   # Wrong
   def get_brain_data(params: BrainDataQuery, utils) -> List[BrainData]:
       # ...

   # Correct
   def get_brain_data(params: BrainDataQuery, utils) -> BrainDataListResponse:
       # ...
   ```

2. **Invalid ApiConfig**

   - Problem: Using unsupported parameters
   - Solution: Use only supported parameters

   ```python
   # Wrong
   config=ApiConfig(
       auth={"required": True}  # Wrong: invalid parameter
   )

   # Correct
   config=ApiConfig()  # Empty config is valid
   ```

3. **Empty Results**

   - Problem: Not handling empty results properly
   - Solution: Return empty list response

   ```python
   # Wrong
   if not result:
       return None  # Wrong: should return empty list response

   # Correct
   if not result:
       return BrainDataListResponse(items=[])
   ```

### Best Practices

1. **Response Models**

   - Create proper list response models
   - Include total count when needed
   - Use proper type hints

2. **Configuration**

   - Use empty ApiConfig if no settings needed
   - Follow configuration guidelines
   - Use only supported parameters

3. **Query Functions**

   - Return proper response model
   - Handle empty results
   - Convert database results to models

4. **Type Safety**
   - Use proper type hints
   - Match function signatures
   - Validate response structure
