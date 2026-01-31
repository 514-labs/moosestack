import dataclasses
import logging
from datetime import datetime, timezone

import json
import sys
from typing import Optional, Literal, Any, Union, Callable
import os
from kafka import KafkaConsumer, KafkaProducer


class CliLogData:
    INFO = "Info"
    SUCCESS = "Success"
    ERROR = "Error"
    HIGHLIGHT = "Highlight"

    def __init__(
        self,
        action: str,
        message: str,
        message_type: Optional[Literal[INFO, SUCCESS, ERROR, HIGHLIGHT]] = INFO,
    ):
        self.message_type = message_type
        self.action = action
        self.message = message


def cli_log(log: CliLogData) -> None:
    level = (
        "error"
        if log.message_type == CliLogData.ERROR
        else "warn" if log.message_type == "Warning" else "info"
    )

    structured_log = {
        "__moose_structured_log__": True,
        "log_kind": "cli",
        "level": level,
        "message": log.message,
        "resource_type": "runtime",
        "cli_action": log.action,
        "cli_message_type": log.message_type or CliLogData.INFO,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    sys.stderr.write(json.dumps(structured_log) + "\n")
    sys.stderr.flush()


class Logger:
    default_action = "Custom"

    def __init__(self, action: Optional[str] = None, is_moose_task: bool = False):
        self.action = action or Logger.default_action
        self._is_moose_task = is_moose_task

    def _log(self, message: str, message_type: str) -> None:
        if self._is_moose_task:
            # We have a task decorator in the lib that initializes a logger
            # This re-uses the same logger in moose scripts runner
            moose_scripts_logger = logging.getLogger("moose-scripts")
            if message_type == CliLogData.INFO:
                moose_scripts_logger.info(message)
            elif message_type == CliLogData.SUCCESS:
                # Standard Python logger doesn't have .success(), use info instead
                moose_scripts_logger.info(message)
            elif message_type == CliLogData.ERROR:
                moose_scripts_logger.error(message)
            elif message_type == CliLogData.HIGHLIGHT:
                moose_scripts_logger.warning(message)
        else:
            cli_log(
                CliLogData(
                    action=self.action, message=message, message_type=message_type
                )
            )

    def info(self, message: str) -> None:
        self._log(message, CliLogData.INFO)

    def success(self, message: str) -> None:
        self._log(message, CliLogData.SUCCESS)

    def error(self, message: str) -> None:
        self._log(message, CliLogData.ERROR)

    def highlight(self, message: str) -> None:
        self._log(message, CliLogData.HIGHLIGHT)


class EnhancedJSONEncoder(json.JSONEncoder):
    """
    Custom JSON encoder that handles:
    - datetime objects (converts to ISO format with timezone)
    - dataclass instances (converts to dict)
    - Pydantic models (converts to dict)
    """

    def default(self, o):
        if isinstance(o, datetime):
            if o.tzinfo is None:
                o = o.replace(tzinfo=timezone.utc)
            return o.isoformat()
        if hasattr(o, "model_dump"):  # Handle Pydantic v2 models
            # Convert to dict and handle datetime fields
            data = o.model_dump()
            # Handle any datetime fields that might be present
            for key, value in data.items():
                if isinstance(value, datetime):
                    if value.tzinfo is None:
                        value = value.replace(tzinfo=timezone.utc)
                    data[key] = value.isoformat()
            return data
        if dataclasses.is_dataclass(o):
            return dataclasses.asdict(o)
        return super().default(o)


def _build_kafka_kwargs(
    broker: Union[str, list[str]],
    sasl_username: Optional[str] = None,
    sasl_password: Optional[str] = None,
    sasl_mechanism: Optional[str] = None,
    security_protocol: Optional[str] = None,
) -> dict[str, Any]:
    """Builds common Kafka client kwargs from provided parameters."""
    kwargs: dict[str, Any] = {
        "bootstrap_servers": broker,
    }
    if sasl_mechanism:
        kwargs["sasl_mechanism"] = sasl_mechanism
    if sasl_username is not None:
        kwargs["sasl_plain_username"] = sasl_username
    if sasl_password is not None:
        kwargs["sasl_plain_password"] = sasl_password
    if security_protocol is not None:
        kwargs["security_protocol"] = security_protocol
    return kwargs


def get_kafka_consumer(
    *,
    broker: Union[str, list[str]],
    client_id: str,
    group_id: str,
    sasl_username: Optional[str] = None,
    sasl_password: Optional[str] = None,
    sasl_mechanism: Optional[str] = None,
    security_protocol: Optional[str] = None,
    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    **extra_kwargs: Any,
) -> KafkaConsumer:
    """Creates a configured KafkaConsumer with optional SASL/security settings."""
    kwargs = _build_kafka_kwargs(
        broker,
        sasl_username=sasl_username,
        sasl_password=sasl_password,
        sasl_mechanism=sasl_mechanism,
        security_protocol=security_protocol,
    )
    return KafkaConsumer(
        client_id=client_id,
        group_id=group_id,
        value_deserializer=value_deserializer,
        **kwargs,
        **extra_kwargs,
    )


def get_kafka_producer(
    *,
    broker: Union[str, list[str]],
    sasl_username: Optional[str] = None,
    sasl_password: Optional[str] = None,
    sasl_mechanism: Optional[str] = None,
    security_protocol: Optional[str] = None,
    max_request_size: Optional[int] = None,
    value_serializer: Optional[Callable[[Any], bytes]] = None,
    **extra_kwargs: Any,
) -> KafkaProducer:
    """Creates a configured KafkaProducer with optional SASL/security settings."""
    kwargs = _build_kafka_kwargs(
        broker,
        sasl_username=sasl_username,
        sasl_password=sasl_password,
        sasl_mechanism=sasl_mechanism,
        security_protocol=security_protocol,
    )
    if max_request_size is not None:
        kwargs["max_request_size"] = max_request_size
    kwargs["max_in_flight_requests_per_connection"] = 1
    if value_serializer is not None:
        kwargs["value_serializer"] = value_serializer
    # Allow callers to pass through additional Kafka configs like linger_ms, acks, retries, etc.
    kwargs.update(extra_kwargs)
    return KafkaProducer(**kwargs)
