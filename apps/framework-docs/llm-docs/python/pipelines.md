# Ingest Pipelines

## Overview
Ingest Pipelines in Moose provide a unified way to define your data ingestion infrastructure. They combine tables, streams, and ingest APIs into a single configuration.

## Basic Pipeline Configuration

```python
from moose_lib import IngestPipeline, Key
from pydantic import BaseModel

# Define your schema
class ExampleSchema(BaseModel):
    id: Key[str]          # Key must specify string as underlying type
    name: str
    value: float

# Basic pipeline configuration with schema type
ExamplePipeline = IngestPipeline[ExampleSchema](
    "ExamplePipeline",
    {
        "table": True,      # Creates a basic table
        "stream": True,     # Creates a basic stream
        "ingest": {
            "format": "JSON_ARRAY"        # Specify ingestion format
        }
    }
)
```

## Pipeline Configuration Options

The `IngestPipeline` class accepts the following configuration options:

```python
from typing import TypedDict, Optional, Union, Literal

class OlapConfig(BaseModel):
    order_by_fields: list[str]                  # Fields to order by
    engine: Optional[ClickHouseEngines] = None  # Enable deduplication with ClickHouseEngines.ReplacingMergeTree 

class StreamConfig(BaseModel):
    parallelism: int           # Number of parallel processing threads
    retention_period: int      # Data retention period in seconds
    destination: str           # Optional destination table

class IngestConfig(BaseModel):
    destination: str           # Required destination stream
    format: Literal["JSON", "JSON_ARRAY"]  # Optional ingestion format

class DataModelConfigV2(TypedDict):
    table: Union[bool, OlapConfig]        # Table configuration
    stream: Union[bool, StreamConfig]     # Stream configuration
    ingest: Union[bool, IngestConfig]     # Ingest configuration
```

## Pipeline Example

Here's a comprehensive example that demonstrates all available configuration options:

```python
from moose_lib import IngestPipeline, Key
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Dict, Any

# Schema with various field types to demonstrate configuration options
class ComprehensiveSchema(BaseModel):
    id: Key[str]          # Required Key field with string type
    timestamp: datetime   # Timestamp for time-series data
    value: float
    tags: Optional[List[str]] = None  # Optional array of tags
    metadata: Dict[str, Any] = Field(
        ...,
        description="Metadata about the record",
        example={
            "source": "api",
            "priority": 1
        }
    )

# Pipeline demonstrating all configuration options
ComprehensivePipeline = IngestPipeline[ComprehensiveSchema](
    "ComprehensivePipeline",
    {
        # Table configuration with all options
        "table": {
            "order_by_fields": ["id", "timestamp"],       # Specify sort order
            engine: ClickHouseEngines.ReplacingMergeTree, # Enable deduplication
        },

        # Stream configuration with all options
        "stream": {
            "parallelism": 4,                       # Number of parallel processing threads
            "retention_period": 86400              # 24 hours retention
        },

        # Ingest configuration with all options
        "ingest": {
            "format": "JSON_ARRAY"                 # Specify ingestion format
        }
    }
)
```

## How It Works

When you create an `IngestPipeline` instance:
1. If `table` is configured:
   - Creates an `OlapTable` with the specified configuration
   - If `table` is `True`, uses default configuration
2. If `stream` is configured:
   - Creates a `Stream` with the specified configuration
   - Automatically connects to the table if one exists
   - If `stream` is `True`, uses default configuration
3. If `ingest_api` is configured:
   - Creates an `IngestApi` with the specified configuration
   - Automatically connects to the stream
   - If `ingest_api` is `True`, uses default configuration

