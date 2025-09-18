"""
Stream definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining and configuring data streams,
including stream transformations, consumers, and dead letter queues.
"""
import dataclasses
import datetime
from typing import Any, Optional, Callable, Union, Literal, Generic
from pydantic import BaseModel, ConfigDict, AliasGenerator
from pydantic.alias_generators import to_camel

from .types import TypedMooseResource, ZeroOrMany, T, U
from .olap_table import OlapTable
from ._registry import _streams
from .life_cycle import LifeCycle


class StreamConfig(BaseModel):
    """Configuration for data streams (e.g., Redpanda topics).

    Attributes:
        parallelism: Number of partitions for the stream.
        retention_period: Data retention period in seconds (default: 7 days).
        destination: Optional `OlapTable` where stream messages should be automatically ingested.
        version: Optional version string for tracking configuration changes.
        metadata: Optional metadata for the stream.
        life_cycle: Determines how changes in code will propagate to the resources.
        default_dead_letter_queue: default dead letter queue used by transforms/consumers
    """
    parallelism: int = 1
    retention_period: int = 60 * 60 * 24 * 7  # 7 days
    destination: Optional[OlapTable] = None
    version: Optional[str] = None
    metadata: Optional[dict] = None
    life_cycle: Optional[LifeCycle] = None
    default_dead_letter_queue: "Optional[DeadLetterQueue]" = None
    # allow DeadLetterQueue
    model_config = ConfigDict(arbitrary_types_allowed=True)


class TransformConfig(BaseModel):
    """Configuration for stream transformations.

    Attributes:
        version: Optional version string to identify a specific transformation.
                 Allows multiple transformations to the same destination if versions differ.
    """
    version: Optional[str] = None
    dead_letter_queue: "Optional[DeadLetterQueue]" = None
    model_config = ConfigDict(arbitrary_types_allowed=True)
    metadata: Optional[dict] = None


class ConsumerConfig(BaseModel):
    """Configuration for stream consumers.

    Attributes:
        version: Optional version string to identify a specific consumer.
                 Allows multiple consumers if versions differ.
    """
    version: Optional[str] = None
    dead_letter_queue: "Optional[DeadLetterQueue]" = None
    model_config = ConfigDict(arbitrary_types_allowed=True)


@dataclasses.dataclass
class _RoutedMessage:
    """Internal class representing a message routed to a specific stream."""
    destination: "Stream[Any]"
    values: ZeroOrMany[Any]


@dataclasses.dataclass
class ConsumerEntry(Generic[T]):
    """Internal class representing a consumer with its configuration."""
    consumer: Callable[[T], None]
    config: ConsumerConfig


@dataclasses.dataclass
class TransformEntry(Generic[T]):
    """Internal class representing a transformation with its configuration."""
    destination: "Stream[Any]"
    transformation: Callable[[T], ZeroOrMany[Any]]
    config: TransformConfig


class Stream(TypedMooseResource, Generic[T]):
    """Represents a data stream (e.g., a Redpanda topic) typed with a Pydantic model.

    Allows defining transformations to other streams and adding consumers.

    Args:
        name: The name of the stream.
        config: Configuration options for the stream (parallelism, retention, destination).
        t: The Pydantic model defining the stream message schema (passed via `Stream[MyModel](...)`).

    Attributes:
        config (StreamConfig): Configuration settings for this stream.
        transformations (dict[str, list[TransformEntry[T]]]): Dictionary mapping destination stream names
                                                            to lists of transformation functions.
        consumers (list[ConsumerEntry[T]]): List of consumers attached to this stream.
        columns (Columns[T]): Helper for accessing message field names safely.
        name (str): The name of the stream.
        model_type (type[T]): The Pydantic model associated with this stream.
    """
    config: StreamConfig
    transformations: dict[str, list[TransformEntry[T]]]
    consumers: list[ConsumerEntry[T]]
    _multipleTransformations: Optional[Callable[[T], list[_RoutedMessage]]] = None
    default_dead_letter_queue: "Optional[DeadLetterQueue[T]]" = None

    def __init__(self, name: str, config: "StreamConfig" = None, **kwargs):
        super().__init__()
        self._set_type(name, self._get_type(kwargs))
        self.config = config if config is not None else StreamConfig()
        self.metadata = self.config.metadata
        self.consumers = []
        self.transformations = {}
        self.default_dead_letter_queue = self.config.default_dead_letter_queue
        _streams[name] = self

    def add_transform(self, destination: "Stream[U]", transformation: Callable[[T], ZeroOrMany[U]],
                      config: TransformConfig = None):
        """Adds a transformation step from this stream to a destination stream.

        The transformation function receives a record of type `T` and should return
        a record of type `U`, a list of `U` records, or `None` to filter.

        Args:
            destination: The target `Stream` for the transformed records.
            transformation: A callable that performs the transformation.
            config: Optional configuration, primarily for setting a version.
        """
        config = config or TransformConfig()
        if (
                self.default_dead_letter_queue is not None
                and config.dead_letter_queue is None
        ):
            config = config.model_copy()
            config.dead_letter_queue = self.default_dead_letter_queue
        if destination.name in self.transformations:
            existing_transforms = self.transformations[destination.name]
            # Check if a transform with this version already exists
            has_version = any(t.config.version == config.version for t in existing_transforms)
            if not has_version:
                existing_transforms.append(
                    TransformEntry(destination=destination, transformation=transformation, config=config))
        else:
            self.transformations[destination.name] = [
                TransformEntry(destination=destination, transformation=transformation, config=config)]

    def add_consumer(self, consumer: Callable[[T], None], config: ConsumerConfig = None):
        """Adds a consumer function to be executed for each record in the stream.

        Consumers are typically used for side effects like logging or triggering external actions.

        Args:
            consumer: A callable that accepts a record of type `T`.
            config: Optional configuration, primarily for setting a version.
        """
        config = config or ConsumerConfig()
        if (
                self.default_dead_letter_queue is not None
                and config.dead_letter_queue is None
        ):
            config = config.model_copy()
            config.dead_letter_queue = self.default_dead_letter_queue
        has_version = any(c.config.version == config.version for c in self.consumers)
        if not has_version:
            self.consumers.append(ConsumerEntry(consumer=consumer, config=config))

    def has_consumers(self) -> bool:
        """Checks if any consumers have been added to this stream.

        Returns:
            True if the stream has one or more consumers, False otherwise.
        """
        return len(self.consumers) > 0

    def routed(self, values: ZeroOrMany[T]) -> _RoutedMessage:
        """Creates a `_RoutedMessage` for use in multi-transform functions.

        Wraps the value(s) to be sent with this stream as the destination.

        Args:
            values: A single record, a list of records, or None.

        Returns:
            A `_RoutedMessage` object.
        """
        return _RoutedMessage(destination=self, values=values)

    def set_multi_transform(self, transformation: Callable[[T], list[_RoutedMessage]]):
        """Sets a transformation function capable of routing records to multiple streams.

        The provided function takes a single input record (`T`) and must return a list
        of `_RoutedMessage` objects, created using the `.routed()` method of the
        target streams.

        Example:
            def my_multi_transform(record: InputModel) -> list[_RoutedMessage]:
                output1 = transform_for_stream1(record)
                output2 = transform_for_stream2(record)
                return [
                    stream1.routed(output1),
                    stream2.routed(output2)
                ]
            input_stream.set_multi_transform(my_multi_transform)

        Note: Only one multi-transform function can be set per stream.

        Args:
            transformation: The multi-routing transformation function.
        """
        self._multipleTransformations = transformation


class DeadLetterModel(BaseModel, Generic[T]):
    """Model for dead letter queue messages.

    Attributes:
        original_record: The original record that failed processing.
        error_message: Description of the error that occurred.
        error_type: Type of error (e.g., "ValidationError").
        failed_at: Timestamp when the error occurred.
        source: Source of the error ("api", "transform", or "table").
    """
    model_config = ConfigDict(alias_generator=AliasGenerator(
        serialization_alias=to_camel,
    ))
    original_record: Any
    error_message: str
    error_type: str
    failed_at: datetime.datetime
    source: Literal["api", "transform", "table"]

    def as_typed(self) -> T:
        return self._t.model_validate(self.original_record)


class DeadLetterQueue(Stream, Generic[T]):
    """A specialized Stream for handling failed records.

    Dead letter queues store records that failed during processing, along with
    error information to help diagnose and potentially recover from failures.

    Attributes:
        All attributes inherited from Stream.
    """

    _model_type: type[T]

    def __init__(self, name: str, config: "StreamConfig" = None, **kwargs):
        """Initialize a new DeadLetterQueue.

        Args:
            name: The name of the dead letter queue stream.
            config: Configuration for the stream.
        """
        self._model_type = self._get_type(kwargs)
        kwargs["t"] = DeadLetterModel[self._model_type]
        super().__init__(name, config if config is not None else StreamConfig(), **kwargs)

    def add_transform(self, destination: Stream[U], transformation: Callable[[DeadLetterModel[T]], ZeroOrMany[U]],
                      config: TransformConfig = None):
        def wrapped_transform(record: DeadLetterModel[T]):
            record._t = self._model_type
            return transformation(record)

        config = config or TransformConfig()
        super().add_transform(destination, wrapped_transform, config)

    def add_consumer(self, consumer: Callable[[DeadLetterModel[T]], None], config: ConsumerConfig = None):
        def wrapped_consumer(record: DeadLetterModel[T]):
            record._t = self._model_type
            return consumer(record)

        config = config or ConsumerConfig()
        super().add_consumer(wrapped_consumer, config)

    def set_multi_transform(self, transformation: Callable[[DeadLetterModel[T]], list[_RoutedMessage]]):
        def wrapped_transform(record: DeadLetterModel[T]):
            record._t = self._model_type
            return transformation(record)

        super().set_multi_transform(wrapped_transform)
