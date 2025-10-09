"""
OLAP table definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining and configuring OLAP tables,
particularly for ClickHouse.
"""
import json
import warnings
from clickhouse_connect import get_client
from clickhouse_connect.driver.client import Client
from clickhouse_connect.driver.exceptions import ClickHouseError
from dataclasses import dataclass
from pydantic import BaseModel
from typing import List, Optional, Any, Literal, Union, Tuple, TypeVar, Generic, Iterator
from ..blocks import ClickHouseEngines, EngineConfig
from ..commons import Logger
from ..config.runtime import RuntimeClickHouseConfig
from ..utilities.sql import quote_identifier
from .types import TypedMooseResource, T, Cols
from ._registry import _tables
from ..data_models import Column, is_array_nested_type, is_nested_type, _to_columns
from .life_cycle import LifeCycle


@dataclass
class InsertOptions:
    """Options for insert operations.

    Attributes:
        allow_errors: Maximum number of bad records to tolerate before failing.
        allow_errors_ratio: Maximum ratio of bad records to tolerate (0.0 to 1.0).
        strategy: Error handling strategy ("fail-fast", "discard", or "isolate").
        validate: Whether to validate data against schema before insertion.
        skip_validation_on_retry: Whether to skip validation for individual records during retries.
    """
    allow_errors: Optional[int] = None
    allow_errors_ratio: Optional[float] = None
    strategy: Literal["fail-fast", "discard", "isolate"] = "fail-fast"
    validate: bool = True
    skip_validation_on_retry: bool = False


@dataclass
class FailedRecord(Generic[T]):
    """Represents a failed record during insertion with error details.

    Attributes:
        record: The original record that failed to insert.
        error: The error message describing why the insertion failed.
        index: Optional index of this record in the original batch.
    """
    record: T
    error: str
    index: Optional[int] = None


@dataclass
class ValidationError:
    """Validation error for a record with detailed error information.

    Attributes:
        record: The original record that failed validation.
        error: Detailed validation error message.
        index: Optional index of this record in the original batch.
        path: Optional path to the field that failed validation.
    """
    record: Any
    error: str
    index: Optional[int] = None
    path: Optional[str] = None


@dataclass
class ValidationResult(Generic[T]):
    """Result of data validation with success/failure breakdown.

    Attributes:
        valid: Records that passed validation.
        invalid: Records that failed validation with detailed error information.
        total: Total number of records processed.
    """
    valid: List[T]
    invalid: List[ValidationError]
    total: int


@dataclass
class InsertResult(Generic[T]):
    """Result of an insert operation with detailed success/failure information.

    Attributes:
        successful: Number of records successfully inserted.
        failed: Number of records that failed to insert.
        total: Total number of records processed.
        failed_records: Detailed information about failed records (if record isolation was used).
    """
    successful: int
    failed: int
    total: int
    failed_records: Optional[List[FailedRecord[T]]] = None


class OlapConfig(BaseModel):
    model_config = {"extra": "forbid"}  # Reject unknown fields for a clean API

    """Configuration for OLAP tables (e.g., ClickHouse tables).

    Attributes:
        order_by_fields: List of column names to use for the ORDER BY clause.
                       Crucial for `ReplacingMergeTree` and performance.
        order_by_expression: An arbitrary ClickHouse expression for ORDER BY. Example:
                             `order_by_expression="(id, name)"` is equivalent to order_by_fields=["id", "name"], or
                             "tuple()" for no sorting.
        partition_by: Optional PARTITION BY expression (single ClickHouse SQL expression).
        engine: The ClickHouse table engine to use. Can be either a ClickHouseEngines enum value
                (for backward compatibility) or an EngineConfig instance (recommended).
        version: Optional version string for tracking configuration changes.
        metadata: Optional metadata for the table.
        life_cycle: Determines how changes in code will propagate to the resources.
        settings: Optional table-level settings that can be modified with ALTER TABLE MODIFY SETTING.
                  These are alterable settings that can be changed without recreating the table.
    """
    order_by_fields: list[str] = []
    order_by_expression: Optional[str] = None
    partition_by: Optional[str] = None
    engine: Optional[Union[ClickHouseEngines, EngineConfig]] = None
    version: Optional[str] = None
    metadata: Optional[dict] = None
    life_cycle: Optional[LifeCycle] = None
    settings: Optional[dict[str, str]] = None

    def model_post_init(self, __context):
        has_fields = bool(self.order_by_fields)
        has_expr = isinstance(self.order_by_expression, str) and len(self.order_by_expression) > 0
        if has_fields and has_expr:
            raise ValueError("Provide either order_by_fields or order_by_expression, not both.")


class OlapTable(TypedMooseResource, Generic[T]):
    """Represents an OLAP table (e.g., a ClickHouse table) typed with a Pydantic model.

    Args:
        name: The name of the OLAP table.
        config: Configuration options for the table engine, ordering, etc.
        t: The Pydantic model defining the table schema (passed via `OlapTable[MyModel](...)`).

    Attributes:
        config (OlapConfig): The configuration settings for this table.
        columns (Columns[T]): Helper for accessing column names safely.
        name (str): The name of the table.
        model_type (type[T]): The Pydantic model associated with this table.
        kind: The kind of the table (e.g., "OlapTable").
    """
    config: OlapConfig
    kind: str = "OlapTable"
    _memoized_client: Optional[Client] = None
    _config_hash: Optional[str] = None
    _cached_table_name: Optional[str] = None
    _column_list: list[Column]
    _cols: Cols

    def __init__(self, name: str, config: OlapConfig = OlapConfig(), **kwargs):
        super().__init__()
        self._set_type(name, self._get_type(kwargs))
        self.config = config
        self.metadata = config.metadata
        self._column_list = _to_columns(self._t)
        self._cols = Cols(self._column_list)
        registry_key = f"{name}_{config.version}" if config.version else name
        if registry_key in _tables:
            raise ValueError(
                f"OlapTable with name {name} and version {config.version or 'unversioned'} already exists"
            )
        _tables[registry_key] = self

        # Check if using legacy enum-based engine configuration
        if config.engine and isinstance(config.engine, ClickHouseEngines):
            logger = Logger(action="OlapTable")

            # Special case for S3Queue - more detailed migration message
            if config.engine == ClickHouseEngines.S3Queue:
                logger.highlight(
                    f"Table '{name}' uses legacy S3Queue configuration. "
                    "Please migrate to the new API:\n"
                    "  Old: engine=ClickHouseEngines.S3Queue\n"
                    "  New: engine=S3QueueEngine(s3_path='...', format='...')\n"
                    "See documentation for complete S3Queue configuration options."
                )
            else:
                # Generic message for other engines
                engine_name = config.engine.value
                logger.highlight(
                    f"Table '{name}' uses legacy engine configuration. "
                    f"Consider migrating to the new API:\n"
                    f"  Old: engine=ClickHouseEngines.{engine_name}\n"
                    f"  New: from moose_lib.blocks import {engine_name}Engine; engine={engine_name}Engine()\n"
                    "The new API provides better type safety and configuration options."
                )

            # Also emit a Python warning for development environments
            warnings.warn(
                f"Table '{name}' uses deprecated ClickHouseEngines enum. "
                f"Please migrate to engine configuration classes (e.g., {config.engine.value}Engine).",
                DeprecationWarning,
                stacklevel=2
            )

    @property
    def cols(self):
        return self._cols

    def _generate_table_name(self) -> str:
        """Generate the versioned table name following Moose's naming convention.

        Format: {tableName}_{version_with_dots_replaced_by_underscores}

        Returns:
            The versioned table name.
        """
        if self._cached_table_name:
            return self._cached_table_name

        table_version = self.config.version
        if not table_version:
            self._cached_table_name = self.name
        else:
            version_suffix = table_version.replace(".", "_")
            self._cached_table_name = f"{self.name}_{version_suffix}"

        return self._cached_table_name

    def _create_config_hash(self, clickhouse_config: RuntimeClickHouseConfig) -> str:
        """Create a fast hash of the ClickHouse configuration.

        Args:
            clickhouse_config: The ClickHouse configuration to hash.

        Returns:
            A 16-character hex hash of the configuration.
        """
        import hashlib
        config_string = (
            f"{clickhouse_config.host}:{clickhouse_config.port}:"
            f"{clickhouse_config.username}:{clickhouse_config.password}:"
            f"{clickhouse_config.database}:{clickhouse_config.use_ssl}"
        )
        return hashlib.sha256(config_string.encode()).hexdigest()[:16]

    def _get_memoized_client(self) -> Client:
        """Get or create a memoized ClickHouse client.

        The client is cached and reused across multiple insert calls for better performance.
        If the configuration changes, a new client will be created.

        Returns:
            A ClickHouse client instance.
        """
        from ..config.runtime import config_registry

        # Get configuration from registry (with fallback to file)
        clickhouse_config = config_registry.get_clickhouse_config()

        # Create a fast hash of the current configuration to detect changes
        current_config_hash = self._create_config_hash(clickhouse_config)

        # If we have a cached client and the config hasn't changed, reuse it
        if self._memoized_client and self._config_hash == current_config_hash:
            return self._memoized_client

        # Close existing client if config changed
        if self._memoized_client and self._config_hash != current_config_hash:
            try:
                self._memoized_client.close()
            except Exception:
                # Ignore errors when closing old client
                pass

        try:
            # Create new client with standard configuration
            interface = 'https' if clickhouse_config.use_ssl else 'http'
            client = get_client(
                interface=interface,
                host=clickhouse_config.host,
                port=int(clickhouse_config.port),
                username=clickhouse_config.username,
                password=clickhouse_config.password,
                database=clickhouse_config.database,
            )

            # Cache the new client and config hash
            self._memoized_client = client
            self._config_hash = current_config_hash

            return client
        except Exception as e:
            raise RuntimeError(f"Failed to create ClickHouse client: {e}")

    def close_client(self) -> None:
        """Close the memoized ClickHouse client if it exists.

        This is useful for cleaning up connections when the table instance is no longer needed.
        The client will be automatically recreated on the next insert call if needed.
        """
        if self._memoized_client:
            try:
                self._memoized_client.close()
            except Exception:
                # Ignore errors when closing
                pass
            finally:
                self._memoized_client = None
                self._config_hash = None

    def validate_record(self, record: Any) -> Tuple[Optional[T], Optional[str]]:
        """Validate a single record using Pydantic validation.

        Args:
            record: The record to validate.

        Returns:
            Tuple of (validated_data, error_message). If validation succeeds,
            validated_data will be the validated record and error_message will be None.
            If validation fails for any reason, validated_data will be None and error_message 
            will contain the error details.
        """
        try:
            validated = self._t.model_validate(record)
            return validated, None
        except Exception as e:
            return None, str(e)

    def validate_records(self, data: List[Any]) -> ValidationResult[T]:
        """Validate an array of records with comprehensive error reporting.

        Args:
            data: Array of records to validate.

        Returns:
            ValidationResult containing valid and invalid records.
        """
        valid: List[T] = []
        invalid: List[ValidationError] = []

        for i, record in enumerate(data):
            validated, error = self.validate_record(record)
            if validated is not None:
                valid.append(validated)
            else:
                invalid.append(ValidationError(
                    record=record,
                    error=error or "Validation failed",
                    index=i,
                    path="root"
                ))

        return ValidationResult(
            valid=valid,
            invalid=invalid,
            total=len(data)
        )

    def _validate_insert_parameters(
            self,
            data: Union[List[T], Iterator[T]],
            options: Optional[InsertOptions]
    ) -> Tuple[bool, str, bool]:
        """Validate input parameters and strategy compatibility.

        Args:
            data: The data to insert (array or iterator).
            options: Optional insert options.

        Returns:
            Tuple of (is_stream, strategy, should_validate).
        """
        is_stream = not isinstance(data, list)
        strategy = options.strategy if options else "fail-fast"
        should_validate = options.validate if options else True

        if is_stream and strategy == "isolate":
            raise ValueError(
                "The 'isolate' error strategy is not supported with stream input. "
                "Use 'fail-fast' or 'discard' instead."
            )

        if is_stream and should_validate:
            print("Warning: Validation is not supported with stream input. Validation will be skipped.")

        return is_stream, strategy, should_validate

    def _perform_pre_insertion_validation(
            self,
            data: List[T],
            should_validate: bool,
            strategy: str,
            options: Optional[InsertOptions] = None
    ) -> Tuple[List[T], List[ValidationError]]:
        """Perform pre-insertion validation for array data.

        Args:
            data: The data to validate.
            should_validate: Whether to perform validation.
            strategy: The error handling strategy.
            options: Optional insert options.

        Returns:
            Tuple of (validated_data, validation_errors).
        """
        if not should_validate:
            return data, []

        try:
            validation_result = self.validate_records(data)
            validated_data = validation_result.valid
            validation_errors = validation_result.invalid

            if validation_errors:
                self._handle_validation_errors(
                    validation_errors,
                    strategy,
                    data,
                    options
                )

                if strategy == "discard":
                    return validated_data, validation_errors
                elif strategy == "isolate":
                    return data, validation_errors
                else:  # fail-fast
                    return validated_data, validation_errors

            return validated_data, validation_errors

        except Exception as validation_error:
            if strategy == "fail-fast":
                raise ValueError(f"Validation failed: {validation_error}")
            print(f"Validation error: {validation_error}")
            return data, []

    def _handle_validation_errors(
            self,
            validation_errors: List[ValidationError],
            strategy: str,
            data: List[T],
            options: Optional[InsertOptions]
    ) -> None:
        """Handle validation errors based on the specified strategy.

        Args:
            validation_errors: List of validation errors.
            strategy: The error handling strategy.
            data: The original data.
            options: Optional insert options.
        """
        if strategy == "fail-fast":
            first_error = validation_errors[0]
            raise ValueError(
                f"Validation failed for record at index {first_error.index}: {first_error.error}"
            )
        elif strategy == "discard":
            self._check_validation_thresholds(
                validation_errors,
                len(data),
                options
            )

    def _check_validation_thresholds(
            self,
            validation_errors: List[ValidationError],
            total_records: int,
            options: Optional[InsertOptions]
    ) -> None:
        """Check if validation errors exceed configured thresholds.

        Args:
            validation_errors: List of validation errors.
            total_records: Total number of records processed.
            options: Optional insert options.
        """
        validation_failed_count = len(validation_errors)
        validation_failed_ratio = validation_failed_count / total_records

        if (options and options.allow_errors is not None and
                validation_failed_count > options.allow_errors):
            raise ValueError(
                f"Too many validation failures: {validation_failed_count} > {options.allow_errors}. "
                f"Errors: {', '.join(e.error for e in validation_errors)}"
            )

        if (options and options.allow_errors_ratio is not None and
                validation_failed_ratio > options.allow_errors_ratio):
            raise ValueError(
                f"Validation failure ratio too high: {validation_failed_ratio:.3f} > "
                f"{options.allow_errors_ratio}. Errors: {', '.join(e.error for e in validation_errors)}"
            )

    def _to_json_each_row(self, records: list[dict]) -> bytes:
        return "\n".join(json.dumps(r, default=str) for r in records).encode("utf-8")

    def _with_wait_end_settings(self, settings: dict) -> dict:
        """Add wait_end_of_query setting to ensure at least once delivery for INSERT operations.
        
        Args:
            settings: Base settings dictionary
            
        Returns:
            Settings dictionary with wait_end_of_query added
        """
        return {**settings, "wait_end_of_query": 1}

    def _prepare_insert_options(
            self,
            table_name: str,
            data: Union[List[T], Iterator[T]],
            validated_data: List[T],
            is_stream: bool,
            strategy: str,
            options: Optional[InsertOptions]
    ) -> tuple[str, bytes, dict]:
        """Prepare insert options for JSONEachRow raw SQL insert, returning settings dict."""
        # Base settings for all inserts
        base_settings = {
            "date_time_input_format": "best_effort",
            "max_insert_block_size": 100000 if is_stream else min(len(validated_data), 100000),
            "max_block_size": 65536,
            "async_insert": 1 if len(validated_data) > 1000 else 0,
            "wait_for_async_insert": 1,
        }
        settings = self._with_wait_end_settings(base_settings)
        if (strategy == "discard" and options and
                (options.allow_errors is not None or options.allow_errors_ratio is not None)):
            if options.allow_errors is not None:
                settings["input_format_allow_errors_num"] = options.allow_errors
            if options.allow_errors_ratio is not None:
                settings["input_format_allow_errors_ratio"] = options.allow_errors_ratio

        if is_stream:
            return quote_identifier(table_name), data, settings

        if not isinstance(validated_data, list):
            validated_data = [validated_data]
        dict_data = []
        for record in validated_data:
            if hasattr(record, 'model_dump'):
                record_dict = record.model_dump()
            else:
                record_dict = record
            preprocessed_record = self._map_to_clickhouse_record(record_dict)
            dict_data.append(preprocessed_record)
        if not dict_data:
            return quote_identifier(table_name), b"", settings
        json_lines = self._to_json_each_row(dict_data)
        return quote_identifier(table_name), json_lines, settings

    def _create_success_result(
            self,
            data: Union[List[T], Iterator[T]],
            validated_data: List[T],
            validation_errors: List[ValidationError],
            is_stream: bool,
            should_validate: bool,
            strategy: str
    ) -> InsertResult[T]:
        """Create appropriate result based on input type.

        Args:
            data: The original data (array or stream).
            validated_data: Validated data for array input.
            validation_errors: List of validation errors.
            is_stream: Whether the input is a stream.
            should_validate: Whether validation was performed.
            strategy: The error handling strategy.

        Returns:
            InsertResult with appropriate counts and error information.
        """
        if is_stream:
            return InsertResult(
                successful=-1,
                failed=0,
                total=-1
            )

        inserted_count = len(validated_data)
        total_processed = len(data) if not is_stream else inserted_count

        result = InsertResult(
            successful=inserted_count,
            failed=len(validation_errors) if should_validate else 0,
            total=total_processed
        )

        if (should_validate and validation_errors and strategy == "discard"):
            result.failed_records = [
                FailedRecord(
                    record=ve.record,
                    error=f"Validation error: {ve.error}",
                    index=ve.index
                ) for ve in validation_errors
            ]

        return result

    def _retry_individual_records(
            self,
            client: Client,
            records: List[T],
            options: InsertOptions
    ) -> InsertResult[T]:
        successful: List[T] = []
        failed: List[FailedRecord[T]] = []
        table_name = quote_identifier(self._generate_table_name())
        records_dict = []
        for record in records:
            if hasattr(record, 'model_dump'):
                record_dict = record.model_dump()
            else:
                record_dict = record
            preprocessed_record = self._map_to_clickhouse_record(record_dict)
            records_dict.append(preprocessed_record)

        RETRY_BATCH_SIZE = 10
        for i in range(0, len(records_dict), RETRY_BATCH_SIZE):
            batch = records_dict[i:i + RETRY_BATCH_SIZE]
            try:
                sql = f"INSERT INTO {table_name} FORMAT JSONEachRow"
                base_settings = {
                    "date_time_input_format": "best_effort",
                    "max_insert_block_size": RETRY_BATCH_SIZE,
                    "max_block_size": RETRY_BATCH_SIZE,
                    "async_insert": 0
                }
                settings = self._with_wait_end_settings(base_settings)
                json_lines = self._to_json_each_row(batch)
                client.command(sql, data=json_lines, settings=settings)
                successful.extend(records[i:i + RETRY_BATCH_SIZE])
            except ClickHouseError as batch_error:
                for j, record_dict in enumerate(batch):
                    try:
                        sql = f"INSERT INTO {table_name} FORMAT JSONEachRow"
                        individual_settings = self._with_wait_end_settings({
                            "date_time_input_format": "best_effort",
                            "async_insert": 0
                        })
                        json_line = self._to_json_each_row([record_dict])
                        client.command(sql, data=json_line, settings=individual_settings)
                        successful.append(records[i + j])
                    except ClickHouseError as error:
                        failed.append(FailedRecord(
                            record=records[i + j],
                            error=str(error),
                            index=i + j
                        ))
        return InsertResult(
            successful=len(successful),
            failed=len(failed),
            total=len(records),
            failed_records=failed if failed else None
        )

    def _insert_array_data(
            self,
            client: Client,
            table_name: str,
            data: List[T],
            should_validate: bool,
            strategy: str,
            options: Optional[InsertOptions]
    ) -> InsertResult[T]:
        """Insert array data into the table with validation and error handling.

        Args:
            client: The ClickHouse client to use.
            table_name: The name of the table to insert into.
            data: The original data array.
            should_validate: Whether validation was performed.
            strategy: The error handling strategy.
            options: Optional insert options.

        Returns:
            InsertResult with detailed success/failure information.
        """
        validated_data, validation_errors = self._perform_pre_insertion_validation(
            data,
            should_validate,
            strategy,
            options
        )
        try:
            table_name, json_lines, settings = self._prepare_insert_options(
                table_name,
                data,
                validated_data,
                False,
                strategy,
                options
            )
            sql = f"INSERT INTO {table_name} FORMAT JSONEachRow"
            client.command(sql, data=json_lines, settings=settings)
            return self._create_success_result(
                data,
                validated_data,
                validation_errors,
                False,
                should_validate,
                strategy
            )
        except ClickHouseError as e:
            if strategy == "fail-fast":
                raise ValueError(f"Insert failed: {e}")
            elif strategy == "discard":
                raise ValueError(f"Too many errors during insert: {e}")
            else:  # isolate
                return self._retry_individual_records(
                    client,
                    validated_data if not options.skip_validation_on_retry else data,
                    options
                )

    def _insert_stream(
            self,
            client: Client,
            table_name: str,
            data: Iterator[T],
            strategy: str,
            options: Optional[InsertOptions]
    ) -> InsertResult[T]:
        """Insert data from an iterator into the table.

        Args:
            client: The ClickHouse client to use.
            table_name: The name of the table to insert into.
            data: An iterator that yields objects to insert.
            strategy: The error handling strategy.

        Returns:
            InsertResult with detailed success/failure information.
        """
        try:
            batch = []
            total_inserted = 0

            _, _, settings = self._prepare_insert_options(
                table_name,
                data,
                [],
                True,
                strategy,
                options
            )

            for record in data:
                # Convert record to dict using model_dump if available
                if hasattr(record, 'model_dump'):
                    batch.append(record.model_dump())
                else:
                    batch.append(record)

                if len(batch) >= 1000:  # Batch size
                    json_lines = self._to_json_each_row(batch)
                    quoted = quote_identifier(table_name)
                    sql = f"INSERT INTO {quoted} FORMAT JSONEachRow"
                    # Add wait_end_of_query to batch settings using helper function
                    batch_settings = self._with_wait_end_settings(settings)
                    client.command(sql, data=json_lines, settings=batch_settings)
                    total_inserted += len(batch)
                    batch = []

            if batch:  # Insert any remaining records
                json_lines = self._to_json_each_row(batch)
                quoted = quote_identifier(table_name)
                sql = f"INSERT INTO {quoted} FORMAT JSONEachRow"
                # Add wait_end_of_query to final batch settings using helper function
                final_settings = self._with_wait_end_settings(settings)
                client.command(sql, data=json_lines, settings=final_settings)
                total_inserted += len(batch)

            return InsertResult(
                successful=total_inserted,
                failed=0,
                total=total_inserted
            )
        except ClickHouseError as e:
            if strategy == "fail-fast":
                raise ValueError(f"Stream insert failed: {e}")
            raise ValueError(f"Too many errors during stream insert: {e}")

    def insert(
            self,
            data: Union[List[T], Iterator[T]],
            options: Optional[InsertOptions] = None
    ) -> InsertResult[T]:
        """Insert data into the table with validation and error handling.

        This method provides a typed interface for inserting data into the ClickHouse table,
        with comprehensive validation and error handling strategies.

        Args:
            data: Either an array of objects conforming to the table schema, or an iterator
                 that yields objects to insert (e.g., a generator function).
            options: Optional configuration for error handling, validation, and insertion behavior.

        Returns:
            InsertResult with detailed success/failure information.

        Example:
            ```python
            # Create an OlapTable instance
            user_table = OlapTable[User]('users')

            # Insert with validation
            result1 = user_table.insert([
                {'id': 1, 'name': 'John', 'email': 'john@example.com'},
                {'id': 2, 'name': 'Jane', 'email': 'jane@example.com'}
            ])

            # Insert with a generator (validation not available for streams)
            def user_stream():
                for i in range(10):
                    yield User(
                        id=i,
                        name=f'User {i}',
                        email=f'user{i}@example.com'
                    )

            result2 = user_table.insert(user_stream(), options=InsertOptions(strategy='fail-fast'))

            # Insert with validation disabled
            result3 = user_table.insert(data, options=InsertOptions(validate=False))

            # Insert with error handling strategies
            result4 = user_table.insert(mixed_data, options=InsertOptions(
                strategy='discard',
                allow_errors_ratio=0.1,
                validate=True
            ))

            # Optional: Clean up connection when done
            user_table.close_client()
            ```
        """
        options = options or InsertOptions()
        is_stream, strategy, should_validate = self._validate_insert_parameters(data, options)
        if (is_stream and not data) or (not is_stream and not data):
            return InsertResult(successful=0, failed=0, total=0)

        client = self._get_memoized_client()
        table_name = self._generate_table_name()

        if is_stream:
            return self._insert_stream(client, table_name, data, strategy, options)
        else:
            return self._insert_array_data(
                client,
                table_name,
                data,
                should_validate,
                strategy,
                options
            )

    def _map_to_clickhouse_record(self, record: dict, columns: Optional[List[Column]] = None) -> dict:
        """
        Recursively transforms a record to match ClickHouse's JSONEachRow requirements.

        - For every Array(Nested(...)) field at any depth, each item is wrapped in its own array and recursively processed.
        - For every Nested struct (not array), it recurses into the struct.
        - This ensures compatibility with kafka_clickhouse_sync

        Args:
            record: The input record to transform (may be deeply nested)
            columns: The schema columns for this level (defaults to model columns at the top level)

        Returns:
            The transformed record, ready for ClickHouse JSONEachRow insertion
        """
        if columns is None:
            columns = _to_columns(self._t)

        result = record.copy()

        for col in columns:
            if col.name not in record:
                continue

            value = record[col.name]
            data_type = col.data_type

            if is_array_nested_type(data_type):
                # For Array(Nested(...)), wrap each item in its own array and recurse
                if (isinstance(value, list) and
                        (len(value) == 0 or isinstance(value[0], dict))):
                    nested_columns = data_type.element_type.columns
                    result[col.name] = [
                        [self._map_to_clickhouse_record(item, nested_columns)]
                        for item in value
                    ]
            elif is_nested_type(data_type):
                # For Nested struct (not array), recurse into it
                if value and isinstance(value, dict):
                    result[col.name] = self._map_to_clickhouse_record(value, data_type.columns)
            # All other types: leave as is

        return result
