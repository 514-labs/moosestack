"""
Stream definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining and configuring data streams,
including stream transformations, consumers, and dead letter queues.
"""
import dataclasses
import datetime
import json
from typing import Any, Optional, Callable, Union, Literal, Generic
from pydantic import BaseModel, ConfigDict, AliasGenerator, Field
from pydantic.alias_generators import to_camel
from kafka import KafkaProducer

from .types import TypedMooseResource, ZeroOrMany, T, U
from .olap_table import OlapTable
from ._registry import _streams
from .life_cycle import LifeCycle
from ..config.runtime import config_registry, RuntimeKafkaConfig
from ..commons import get_kafka_producer


class SubjectLatest(BaseModel):
    name: str = Field(serialization_alias="subjectLatest")


class SubjectVersion(BaseModel):
    subject: str
    version: int


class SchemaById(BaseModel):
    id: int


class KafkaSchemaConfig(BaseModel):
    kind: Literal["JSON", "AVRO", "PROTOBUF"]
    reference: Union[SubjectLatest, SubjectVersion, SchemaById]


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
    schema_config: Optional[KafkaSchemaConfig] = None


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
    _memoized_producer: Optional[KafkaProducer] = None
    _kafka_config_hash: Optional[str] = None

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

    def _build_full_topic_name(self, namespace: Optional[str]) -> str:
        """Build full topic name with optional namespace and version suffix."""
        version_suffix = f"_{self.config.version.replace('.', '_')}" if self.config.version else ""
        base = f"{self.name}{version_suffix}"
        return f"{namespace}.{base}" if namespace else base

    def _create_kafka_config_hash(self, cfg: RuntimeKafkaConfig) -> str:
        import hashlib
        config_string = ":".join(
            str(x)
            for x in (
                cfg.broker,
                cfg.message_timeout_ms,
                cfg.sasl_username,
                cfg.sasl_password,
                cfg.sasl_mechanism,
                cfg.security_protocol,
                cfg.namespace,
            )
        )
        return hashlib.sha256(config_string.encode()).hexdigest()[:16]

    def _parse_brokers(self, broker_string: str) -> list[str]:
        if not broker_string:
            return []
        return [b.strip() for b in broker_string.split(",") if b.strip()]

    def _get_memoized_producer(self) -> tuple[KafkaProducer, RuntimeKafkaConfig]:
        """Create or reuse a KafkaProducer using runtime configuration."""
        cfg: RuntimeKafkaConfig = config_registry.get_kafka_config()
        current_hash = self._create_kafka_config_hash(cfg)

        if self._memoized_producer is not None and self._kafka_config_hash == current_hash:
            return self._memoized_producer, cfg

        # Close previous producer if config changed
        if self._memoized_producer is not None and self._kafka_config_hash != current_hash:
            try:
                self._memoized_producer.flush()
                self._memoized_producer.close()
            except Exception:
                pass
            finally:
                self._memoized_producer = None

        brokers = self._parse_brokers(cfg.broker)
        if not brokers:
            raise RuntimeError(f"No valid broker addresses found in: '{cfg.broker}'")

        producer = get_kafka_producer(
            broker=brokers,
            sasl_username=cfg.sasl_username,
            sasl_password=cfg.sasl_password,
            sasl_mechanism=cfg.sasl_mechanism,
            security_protocol=cfg.security_protocol,
            value_serializer=lambda v: v.model_dump_json().encode('utf-8'),
            acks="all",
        )

        self._memoized_producer = producer
        self._kafka_config_hash = current_hash
        return producer, cfg

    def close_producer(self) -> None:
        """Closes the memoized Kafka producer if it exists."""
        if self._memoized_producer is not None:
            try:
                self._memoized_producer.flush()
                self._memoized_producer.close()
            except Exception:
                pass
            finally:
                self._memoized_producer = None
                self._kafka_config_hash = None

    def send(self, values: ZeroOrMany[T]) -> None:
        """Send one or more records to this stream's Kafka topic.

        If `schema_registry` (JSON) is configured, resolve schema id and
        send using Confluent wire format (0x00 + 4-byte schema id + JSON bytes).
        Otherwise, values are JSON-serialized.
        """
        # Normalize inputs to a flat list of records
        filtered: list[T] = []
        if isinstance(values, list):
            for v in values:
                if v is None:
                    continue
                else:
                    filtered.append(v)
        elif values is not None:
            filtered.append(values)  # type: ignore[arg-type]

        if len(filtered) == 0:
            return

        # ensure all records are instances of the stream's model type
        model_type = self._t
        for rec in filtered:
            if not isinstance(rec, model_type):
                raise TypeError(
                    f"Stream '{self.name}' expects instances of {model_type.__name__}, "
                    f"got {type(rec).__name__}"
                )

        producer, cfg = self._get_memoized_producer()
        topic = self._build_full_topic_name(cfg.namespace)

        sr = self.config.schema_config
        if sr is not None:
            if sr.kind != "JSON":
                raise NotImplementedError("Currently JSON Schema is supported.")
            try:
                from confluent_kafka.schema_registry import SchemaRegistryClient
                from confluent_kafka.schema_registry.json_schema import JSONSerializer
            except Exception as e:
                raise RuntimeError(
                    "confluent-kafka[json,schemaregistry] is required for Schema Registry JSON"
                ) from e

            sr_url = cfg.schema_registry_url
            if not sr_url:
                raise RuntimeError("Schema Registry URL not configured")
            client = SchemaRegistryClient({"url": sr_url})

            if isinstance(sr.reference, SchemaById):
                schema = client.get_schema(sr.reference.id)
            elif isinstance(sr.reference, SubjectLatest):
                schema = client.get_latest_version(sr.reference.name).schema
            else:
                schema = client.get_version(sr.reference.subject, sr.reference.version).schema

            serializer = JSONSerializer(schema, client)

            for rec in filtered:
                value_bytes = serializer(rec.model_dump())
                producer.send(topic, value=value_bytes)
            producer.flush()
        else:
            for rec in filtered:
                producer.send(topic, value=rec)
            producer.flush()


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
