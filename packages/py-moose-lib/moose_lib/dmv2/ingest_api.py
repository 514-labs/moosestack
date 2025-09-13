"""
Ingestion API definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining and configuring ingestion APIs
that receive data and send it to streams.
"""
import dataclasses
from typing import Any, Optional, Generic
from pydantic import BaseModel

from .types import TypedMooseResource, T
from .stream import Stream, DeadLetterQueue
from ._registry import _ingest_apis

class IngestConfig(BaseModel):
    """Basic configuration for an ingestion point.

    Attributes:
        version: Optional version string.
        path: Optional custom path for the ingestion endpoint.
        metadata: Optional metadata for the ingestion point.
    """
    version: Optional[str] = None
    path: Optional[str] = None
    metadata: Optional[dict] = None

@dataclasses.dataclass
class IngestConfigWithDestination[T: BaseModel]:
    """Ingestion configuration that includes the mandatory destination stream.

    Attributes:
        destination: The `Stream` where ingested data will be sent.
        dead_letter_queue: Optional dead letter queue for failed messages.
        version: Optional version string.
        path: Optional custom path for the ingestion endpoint.
        metadata: Optional metadata for the ingestion configuration.
    """
    destination: Stream[T]
    dead_letter_queue: Optional[DeadLetterQueue[T]] = None
    version: Optional[str] = None
    path: Optional[str] = None
    metadata: Optional[dict] = None

class IngestApi(TypedMooseResource, Generic[T]):
    """Represents an Ingestion API endpoint typed with a Pydantic model.

    This endpoint receives data (matching schema `T`) and sends it to a configured
    destination stream.

    Args:
        name: The name of the ingestion API endpoint.
        config: Configuration specifying the destination stream and data format.
        t: The Pydantic model defining the expected input data schema
           (passed via `IngestApi[MyModel](...)`).

    Attributes:
        config (IngestConfigWithDestination[T]): The configuration for this API.
        columns (Columns[T]): Helper for accessing input field names safely.
        name (str): The name of the API.
        model_type (type[T]): The Pydantic model associated with this API's input.
    """
    config: IngestConfigWithDestination[T]

    def __init__(self, name: str, config: IngestConfigWithDestination[T], **kwargs):
        super().__init__()
        self._set_type(name, self._get_type(kwargs))
        self.config = config
        self.metadata = getattr(config, 'metadata', None)
        _ingest_apis[name] = self