"""
Streaming Function Runner for Moose

This module provides functionality to run streaming functions that process data from Kafka topics.
It supports both DMV1 (legacy) and DMV2 streaming function formats, handling the lifecycle of
consuming messages from a source topic, transforming them, and producing to a target topic.

The runner handles:
- Loading and executing streaming functions
- Kafka consumer/producer setup with optional SASL authentication
- Message transformation and routing
- Basic metrics tracking
- Error handling and logging
"""

import argparse
import dataclasses
import traceback
from datetime import datetime, timezone
from importlib import import_module
import io
import json
import signal
import sys
from kafka import KafkaConsumer, KafkaProducer
import requests
import threading
import time
from typing import Optional, Callable, Tuple, Any

from moose_lib.dmv2 import get_streams, DeadLetterModel
from moose_lib import cli_log, CliLogData, DeadLetterQueue
from moose_lib.commons import (
    EnhancedJSONEncoder,
    moose_management_port,
    get_kafka_consumer,
    get_kafka_producer,
)

# Force stdout to be unbuffered
sys.stdout = io.TextIOWrapper(
    open(sys.stdout.fileno(), 'wb', 0),
    write_through=True,
    line_buffering=True
)


@dataclasses.dataclass
class KafkaTopicConfig:
    """
    Configuration for a Kafka topic including namespace support.
    
    Attributes:
        streaming_engine_type: The type of topic (source or target)
        name: Full topic name including namespace if present
        partitions: Number of partitions for the topic
        retention_ms: Message retention period in milliseconds
        max_message_bytes: Maximum size of messages in bytes
        namespace: Optional namespace prefix for the topic
        version: Optional version string for the topic
    """
    streaming_engine_type: str
    name: str
    partitions: int
    retention_ms: int
    max_message_bytes: int
    namespace: Optional[str] = None
    version: Optional[str] = None

    def topic_name_to_stream_name(self) -> str:
        """Returns the topic name with any namespace prefix removed."""

        name = self.name
        if self.version is not None:
            version_suffix = f"_{self.version}".replace(".", "_")
            if name.endswith(version_suffix):
                name = name.removesuffix(version_suffix)
            else:
                raise Exception(f"Version suffix {version_suffix} not found in topic name {name}")

        if self.namespace is not None and self.namespace != "":
            prefix = self.namespace + "."
            if name.startswith(prefix):
                name = name.removeprefix(prefix)
            else:
                raise Exception(f"Namespace prefix {prefix} not found in topic name {name}")

        return name


def load_streaming_function_dmv1(function_file_dir: str, function_file_name: str) -> Tuple[type, Callable]:
    """
    Load a DMV1 (legacy) streaming function from a Python module.
    
    Args:
        function_file_dir: Directory containing the streaming function module
        function_file_name: Name of the module file without .py extension
        
    Returns:
        Tuple of (input_type, run_function) where:
            - input_type is the type annotation of the run function's input parameter
            - run_function is the actual transformation function
            
    Raises:
        SystemExit: If module import fails or if multiple/no streaming functions found
    """
    sys.path.append(function_file_dir)

    try:
        # todo: check the flat naming
        module = import_module(function_file_name)
        streaming_function_def = module.StreamingFunction
    except Exception as e:
        cli_log(CliLogData(action="Function", message=str(e), message_type="Error"))
        sys.exit(1)

    # Get all the named flows in the flow file and make sure the flow is of type StreamingFunction
    streaming_functions = [f for f in dir(module) if isinstance(getattr(module, f), streaming_function_def)]

    # Make sure that there is only one flow in the file
    if len(streaming_functions) != 1:
        cli_log(CliLogData(action="Function",
                           message=f"Expected one streaming function in the file, but got {len(streaming_functions)}",
                           message_type="Error"))
        sys.exit(1)

    # get the flow definition
    streaming_function_def = getattr(module, streaming_functions[0])

    # get the run function
    streaming_function_run = streaming_function_def.run

    # get run input type that doesn't rely on the name of the input parameter
    run_input_type = streaming_function_run.__annotations__[list(streaming_function_run.__annotations__.keys())[0]]

    return run_input_type, streaming_function_run


def load_streaming_function_dmv2(function_file_dir: str, function_file_name: str) -> tuple[
    type, list[tuple[Callable, Optional[DeadLetterQueue]]]]:
    """
    Load a DMV2 streaming function by finding the stream transformation that matches
    the source and target topics.
    
    Args:
        function_file_dir: Directory containing the main.py file
        function_file_name: Name of the main.py file (without extension)
        
    Returns:
        Tuple of (input_type, transformation_functions) where:
            - input_type is the Pydantic model type of the source stream
            - transformation_functions is a list of functions that transform source to target data and their dead letter queues
            
    Raises:
        SystemExit: If module import fails or if no matching transformation is found
    """
    sys.path.append(function_file_dir)

    try:
        # todo: check the flat naming
        import_module(function_file_name)
    except Exception as e:
        cli_log(CliLogData(action="Function", message=str(e), message_type="Error"))
        sys.exit(1)

    # Find the stream that has a transformation matching our source/destination
    for source_py_stream_name, stream in get_streams().items():
        if source_py_stream_name != source_topic.topic_name_to_stream_name():
            continue

        if stream.has_consumers() and target_topic is None:
            consumers = [(entry.consumer, entry.config.dead_letter_queue) for entry in stream.consumers]
            if not consumers:
                continue
            return stream.model_type, consumers

        # Check each transformation in the stream
        for dest_stream_py_name, transform_entries in stream.transformations.items():
            # The source topic name should match the stream name
            # The destination topic name should match the destination stream name
            if source_py_stream_name == source_topic.topic_name_to_stream_name() and dest_stream_py_name == target_topic.topic_name_to_stream_name():
                # Found the matching transformation
                transformations = [(entry.transformation, entry.config.dead_letter_queue) for entry in
                                   transform_entries]
                if not transformations:
                    continue
                return stream.model_type, transformations

    # If we get here, no matching transformation was found
    cli_log(CliLogData(
        action="Function",
        message=f"No transformation found from {source_topic.name} to {target_topic.name}",
        message_type="Error"
    ))
    sys.exit(1)


parser = argparse.ArgumentParser(description='Run a streaming function')

parser.add_argument('source_topic_json', type=str, help='The source topic for the streaming function')
# In DMV2 is the dir is the dir of the main.py or index.ts file
# and the function_file_name is the file name of main.py or index.ts
# In DMV1 the dir is the dir of the streaming function file
# and the function_file_name is the file name of the streaming function without the .py extension
parser.add_argument('function_file_dir', type=str, help='The dir of the streaming function file')
parser.add_argument('function_file_name', type=str,
                    help='The file name of the streaming function without the .py extension')
parser.add_argument('broker', type=str, help='The broker to use for the streaming function')
parser.add_argument('--target_topic_json', type=str, help='The target topic for the streaming function')
parser.add_argument('--sasl_username', type=str, help='The SASL username to use for the streaming function')
parser.add_argument('--sasl_password', type=str, help='The SASL password to use for the streaming function')
parser.add_argument('--sasl_mechanism', type=str, help='The SASL mechanism to use for the streaming function')
parser.add_argument('--security_protocol', type=str, help='The security protocol to use for the streaming function')
parser.add_argument('--dmv2', action=argparse.BooleanOptionalAction, type=bool,
                    help='Whether to use the DMV2 format for the streaming function')

args: argparse.Namespace = parser.parse_args()

for arg in vars(args):
    value = getattr(args, arg)
    if 'password' in arg and value is not None:
        value = '******'
    print(arg, value)

source_topic = KafkaTopicConfig(**json.loads(args.source_topic_json))
target_topic = KafkaTopicConfig(**json.loads(args.target_topic_json)) if args.target_topic_json else None
function_file_dir = args.function_file_dir
function_file_name = args.function_file_name
broker = args.broker
sasl_mechanism = args.sasl_mechanism

# Setup SASL config w/ supported mechanisms
if args.sasl_mechanism is not None:
    if args.sasl_mechanism not in ['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512']:
        raise Exception(f"Unsupported SASL mechanism: {args.sasl_mechanism}")
    if args.sasl_username is None or args.sasl_password is None:
        raise Exception("SASL username and password must be provided if a SASL mechanism is specified")
    if args.security_protocol is None:
        raise Exception("Security protocol must be provided if a SASL mechanism is specified")

sasl_config = {
    'username': args.sasl_username,
    'password': args.sasl_password,
    'mechanism': args.sasl_mechanism
}

# We use flow- instead of function- because that's what the ACLs in boreal are linked with
# When migrating - make sure the ACLs are updated to use the new prefix. 
# And make sure the prefixes are the same in the ts-moose-lib and py-moose-lib
streaming_function_id = f'flow-{source_topic.name}-{target_topic.name}' if target_topic else f'flow-{source_topic.name}'
log_prefix = f"{source_topic.name} -> {target_topic.name}" if target_topic else f"{source_topic.name} (consumer)"


def log(msg: str) -> None:
    """Log a message with the source->target topic prefix."""
    print(f"{log_prefix}: {msg}")


def error(msg: str) -> None:
    """Raise an exception with the source->target topic prefix."""
    raise Exception(f"{log_prefix}: {msg}")


# parse json into the input type
def parse_input(run_input_type: type, json_input: dict) -> Any:
    """
    Parse JSON input data into the appropriate input type for the streaming function.
    
    Handles Pydantic models, nested dataclass structures and lists of dataclasses.
    
    Args:
        run_input_type: The type to parse the JSON into
        json_input: The JSON data as a Python dict
        
    Returns:
        An instance of run_input_type populated with the JSON data
    """

    def deserialize(data, cls):
        if hasattr(cls, "model_validate"):  # Check if it's a Pydantic model
            return cls.model_validate(data)
        elif dataclasses.is_dataclass(cls):
            field_types = {f.name: f.type for f in dataclasses.fields(cls)}
            return cls(**{name: deserialize(data.get(name), field_types[name]) for name in field_types})
        elif isinstance(data, list):
            return [deserialize(item, cls.__args__[0]) for item in data]
        else:
            return data

    return deserialize(json_input, run_input_type)


def create_consumer() -> KafkaConsumer:
    """
    Create a Kafka consumer configured for the source topic.
    
    Handles SASL authentication if configured.
    
    Returns:
        Configured KafkaConsumer instance
    """
    def _sr_json_deserializer(m: bytes):
        if m is None:
            return None
        # Schema Registry JSON envelope: 0x00 + 4-byte schema ID (big-endian) + JSON
        if len(m) >= 5 and m[0] == 0x00:
            m = m[5:]
        return json.loads(m.decode("utf-8"))

    kwargs = dict(
        broker=broker,
        client_id="python_streaming_function_consumer",
        group_id=streaming_function_id,
        value_deserializer=_sr_json_deserializer,
        sasl_username=sasl_config.get("username"),
        sasl_password=sasl_config.get("password"),
        sasl_mechanism=sasl_config.get("mechanism"),
        security_protocol=args.security_protocol,
    )
    consumer = get_kafka_consumer(**kwargs)
    return consumer


def create_producer() -> Optional[KafkaProducer]:
    """
    Create a Kafka producer configured for the target topic.
    
    Handles SASL authentication if configured and sets appropriate message size limits.
    
    Returns:
        Configured KafkaProducer instance
    """
    max_request_size = KafkaProducer.DEFAULT_CONFIG['max_request_size'] if target_topic is None \
        else target_topic.max_message_bytes
    return get_kafka_producer(
        broker=broker,
        sasl_username=sasl_config.get("username"),
        sasl_password=sasl_config.get("password"),
        sasl_mechanism=sasl_config.get("mechanism"),
        security_protocol=args.security_protocol,
        max_request_size=max_request_size,
    )


def main():
    """
    Main entry point for the streaming function runner.
    
    This function:
    1. Loads the appropriate streaming function (DMV1 or DMV2)
    2. Sets up metrics reporting thread and message processing thread
    3. Handles graceful shutdown on signals
    """
    log(f"Loading streaming function")

    # Shared state for metrics and control
    running = threading.Event()
    running.set()  # Start in running state
    metrics = {
        'count_in': 0,
        'count_out': 0,
        'bytes_count': 0
    }
    metrics_lock = threading.Lock()

    # Shared references for cleanup
    kafka_refs = {
        'consumer': None,
        'producer': None
    }

    def send_message_metrics():
        while running.is_set():
            time.sleep(1)
            with metrics_lock:
                requests.post(
                    f"http://localhost:{moose_management_port}/metrics-logs",
                    json={
                        'timestamp': datetime.now(timezone.utc).isoformat(),
                        'count_in': metrics['count_in'],
                        'count_out': metrics['count_out'],
                        'bytes': metrics['bytes_count'],
                        'function_name': log_prefix
                    }
                )
                metrics['count_in'] = 0
                metrics['count_out'] = 0
                metrics['bytes_count'] = 0

    def process_messages():
        try:
            streaming_function_input_type = None
            streaming_function_callables = None
            if args.dmv2:
                streaming_function_input_type, streaming_function_callables = load_streaming_function_dmv2(
                    function_file_dir, function_file_name)
            else:
                streaming_function_input_type, streaming_function_callable = load_streaming_function_dmv1(
                    function_file_dir, function_file_name)

                streaming_function_callables = [(streaming_function_callable, None)]

            needs_producer = target_topic is not None or any(
                pair[1] is not None for pair in streaming_function_callables)

            # Initialize Kafka connections in the processing thread
            consumer = create_consumer()
            producer = create_producer() if needs_producer else None

            # Store references for cleanup
            kafka_refs['consumer'] = consumer
            kafka_refs['producer'] = producer

            consumer.subscribe([source_topic.name])

            log("Kafka consumer and producer initialized in processing thread")

            while running.is_set():
                try:
                    # Poll with timeout to allow checking running state
                    messages = consumer.poll(timeout_ms=1000)

                    if not messages:
                        continue

                    # Process each partition's messages
                    for partition_messages in messages.values():
                        for message in partition_messages:
                            if not running.is_set():
                                return

                            # Parse the message into the input type
                            input_data = parse_input(streaming_function_input_type, message.value)

                            # Run the flow
                            all_outputs = []
                            for (streaming_function_callable, dlq) in streaming_function_callables:
                                try:
                                    output_data = streaming_function_callable(input_data)
                                except Exception as e:
                                    traceback.print_exc()
                                    if dlq is not None:
                                        dead_letter = DeadLetterModel(
                                            original_record=message.value,
                                            error_message=str(e),
                                            error_type=e.__class__.__name__,
                                            failed_at=datetime.now(timezone.utc),
                                            source="transform"
                                        )
                                        record = dead_letter.model_dump_json().encode('utf-8')
                                        producer.send(dlq.name, record).get()
                                        cli_log(CliLogData(
                                            action="DeadLetter",
                                            message=f"Sent message to DLQ {dlq.name}: {str(e)}",
                                            message_type=CliLogData.ERROR
                                        ))
                                    else:
                                        cli_log(CliLogData(
                                            action="Function",
                                            message=f"Error processing message (no DLQ configured): {str(e)}",
                                            message_type=CliLogData.ERROR
                                        ))
                                    # Skip to the next transformation or message
                                    continue

                                # For consumers, output_data will be None
                                if output_data is None:
                                    continue

                                # Handle streaming function returning an array or a single object
                                output_data_list = output_data if isinstance(output_data, list) else [output_data]
                                all_outputs.extend(output_data_list)

                                with metrics_lock:
                                    metrics['count_in'] += len(output_data_list)

                                cli_log(CliLogData(action="Received",
                                                   message=f'{log_prefix} {len(output_data_list)} message(s)'))

                            if producer is not None:
                                for item in all_outputs:
                                    # Ignore flow function returning null
                                    if item is not None:
                                        record = json.dumps(item, cls=EnhancedJSONEncoder).encode('utf-8')

                                        producer.send(target_topic.name, record)

                                        with metrics_lock:
                                            metrics['bytes_count'] += len(record)
                                            metrics['count_out'] += 1

                except Exception as e:
                    cli_log(CliLogData(action="Function", message=str(e), message_type="Error"))
                    if not running.is_set():
                        break
                    # Add a small delay before retrying on error
                    time.sleep(1)

        finally:
            # Cleanup Kafka resources
            try:
                if consumer:
                    consumer.close()
                if producer and producer is not None:
                    producer.flush()
                    producer.close()
            except Exception as e:
                log(f"Error during Kafka cleanup: {e}")

    def shutdown(signum, frame):
        """Handle shutdown signals gracefully"""
        log("Received shutdown signal, cleaning up...")
        running.clear()  # This will trigger the main loop to exit

    # Set up signal handlers
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGHUP, shutdown)  # Handle parent process termination
    signal.signal(signal.SIGQUIT, shutdown)  # Handle quit signal from parent

    # Start the metrics thread
    metrics_thread = threading.Thread(target=send_message_metrics)
    metrics_thread.daemon = True
    metrics_thread.start()

    # Start the message processing thread
    processing_thread = threading.Thread(target=process_messages)
    processing_thread.daemon = True
    processing_thread.start()

    log(f"Streaming function Started")

    try:
        # Main thread waits for threads to complete
        while running.is_set():
            time.sleep(1)
    finally:
        # Ensure cleanup happens even if main thread gets interrupted
        running.clear()
        log("Shutting down threads...")

        # Give threads a chance to exit gracefully with timeout
        metrics_thread.join(timeout=5)
        processing_thread.join(timeout=5)

        if metrics_thread.is_alive():
            log("Metrics thread did not exit cleanly")
        if processing_thread.is_alive():
            log("Processing thread did not exit cleanly")

        # Clean up Kafka resources regardless of thread state
        if kafka_refs['consumer']:
            try:
                kafka_refs['consumer'].close()
            except Exception as e:
                log(f"Error closing consumer: {e}")

        if kafka_refs['producer'] and kafka_refs['producer'] is not None:
            try:
                kafka_refs['producer'].flush()
                kafka_refs['producer'].close()
            except Exception as e:
                log(f"Error closing producer: {e}")

        log("Shutdown complete")
        sys.exit(0)


if __name__ == "__main__":
    main()
