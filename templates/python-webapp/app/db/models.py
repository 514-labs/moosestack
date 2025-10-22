# Data Pipeline: Raw Record (Foo) → Processed Record (Bar)
# Raw (Foo) → HTTP → Raw Stream → Transform → Derived (Bar) → Processed Stream → DB Table

from moose_lib import Key, IngestPipeline, IngestPipelineConfig
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

# =======Data Models=========

class FooModel(BaseModel):
    """Raw data ingested via API"""
    primary_key: Key[str]  # Unique ID
    timestamp: float  # Unix timestamp
    optional_text: Optional[str] = None  # Text to analyze


class BarModel(BaseModel):
    """Analyzed text metrics derived from Foo"""
    primary_key: Key[str]  # From Foo.primary_key
    utc_timestamp: datetime  # From Foo.timestamp
    has_text: bool  # From Foo.optional_text?
    text_length: int  # From Foo.optional_text.length


# =======Pipeline Configuration=========

# Raw data ingestion
FooPipeline = IngestPipeline[FooModel](
    "Foo",
    IngestPipelineConfig(
        table=False,  # No table; only stream raw records
        stream=True,  # Buffer ingested records
        ingest_api=True,  # POST /ingest/Foo
        dead_letter_queue=True,  # Enable dead letter queue for failed transformations
    )
)

# Buffering and storing processed records (see transforms.py for transformation logic)
BarPipeline = IngestPipeline[BarModel](
    "Bar",
    IngestPipelineConfig(
        table=True,  # Persist in ClickHouse table "Bar"
        stream=True,  # Buffer processed records
        ingest_api=False,  # No API; only derive from processed Foo records
    )
)
