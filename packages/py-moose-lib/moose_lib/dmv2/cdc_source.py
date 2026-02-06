"""
CDC source definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining CDC sources and CDC tables,
including typed CDC event streams and optional CDC destination tables.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, Generic, Literal, TypeVar, Union, Any

from pydantic import BaseModel, create_model

from .types import TypedMooseResource, T
from .stream import Stream, StreamConfig
from .olap_table import OlapTable, OlapConfig
from .life_cycle import LifeCycle
from ._source_capture import get_source_file_from_stack
from ._registry import _cdc_sources
from ..blocks import ReplacingMergeTreeEngine

CdcOperation = Literal["insert", "update", "delete"]


class CdcEvent(BaseModel, Generic[T]):
    op: CdcOperation
    before: Optional[T] = None
    after: Optional[T] = None
    ts: datetime
    lsn: str
    source: str


class CdcRow(BaseModel, Generic[T]):
    __cdc_op: CdcOperation
    __cdc_lsn: str
    __cdc_ts: datetime
    __cdc_is_deleted: bool


class CdcSourceConfig(BaseModel):
    kind: str
    connection: str
    metadata: Optional[dict] = None
    life_cycle: Optional[LifeCycle] = None


class CdcTableConfig(BaseModel):
    source_table: str
    primary_key: list[str]
    stream: bool | StreamConfig = True
    table: bool | OlapConfig = True
    snapshot: Optional[Literal["initial", "never"]] = None
    version: Optional[str] = None
    metadata: Optional[dict] = None
    life_cycle: Optional[LifeCycle] = None


class CdcSource:
    def __init__(self, name: str, config: CdcSourceConfig):
        self.name = name
        self.config = config
        if config.metadata:
            self.metadata = (
                config.metadata.copy()
                if isinstance(config.metadata, dict)
                else config.metadata
            )
        else:
            self.metadata = {}

        if not isinstance(self.metadata, dict):
            self.metadata = {}

        if "source" not in self.metadata:
            source_file = get_source_file_from_stack()
            if source_file:
                self.metadata["source"] = {"file": source_file}
        self.tables: dict[str, CdcTable[Any]] = {}

        _cdc_sources[name] = self

    def register_table(self, table: "CdcTable[Any]"):
        self.tables[table.name] = table


class CdcTable(TypedMooseResource, Generic[T]):
    stream: Optional[Stream] = None
    changes: Optional[Stream] = None
    table: Optional[OlapTable] = None

    def __init__(self, name: str, source: CdcSource, config: CdcTableConfig, **kwargs):
        super().__init__()
        self._set_type(name, self._get_type(kwargs))

        if not config.primary_key:
            raise ValueError("CdcTable requires a non-empty primary_key list")

        self.name = name
        self.source = source
        self.config = config
        self.source_table = config.source_table
        if config.metadata:
            self.metadata = (
                config.metadata.copy()
                if isinstance(config.metadata, dict)
                else config.metadata
            )
        else:
            self.metadata = {}

        if not isinstance(self.metadata, dict):
            self.metadata = {}

        if "source" not in self.metadata:
            source_file = get_source_file_from_stack()
            if source_file:
                self.metadata["source"] = {"file": source_file}

        source.register_table(self)

        event_model = _create_cdc_event_model(self._t)
        row_model = _create_cdc_row_model(self._t)

        if config.stream is not False:
            stream_config = (
                config.stream
                if isinstance(config.stream, StreamConfig)
                else StreamConfig(life_cycle=config.life_cycle)
            )
            if config.version:
                stream_config.version = config.version
            if config.metadata:
                stream_config.metadata = config.metadata
            self.stream = Stream[event_model](name, stream_config, t=event_model)
            self.changes = self.stream

        if config.table:
            table_config = (
                config.table
                if isinstance(config.table, OlapConfig)
                else OlapConfig(life_cycle=config.life_cycle)
            )
            if table_config.engine is None:
                table_config.engine = ReplacingMergeTreeEngine(
                    ver="__cdc_lsn", is_deleted="__cdc_is_deleted"
                )
            if config.version:
                table_config.version = config.version
            if not table_config.order_by_fields:
                table_config.order_by_fields = config.primary_key
            self.table = OlapTable[row_model](name, table_config, t=row_model)


def _create_cdc_event_model(model: type[BaseModel]) -> type[BaseModel]:
    return create_model(
        f"{model.__name__}CdcEvent",
        op=(CdcOperation, ...),
        before=(Optional[model], None),
        after=(Optional[model], None),
        ts=(datetime, ...),
        lsn=(str, ...),
        source=(str, ...),
    )


def _create_cdc_row_model(model: type[BaseModel]) -> type[BaseModel]:
    return create_model(
        f"{model.__name__}CdcRow",
        __base__=model,
        __cdc_op=(CdcOperation, ...),
        __cdc_lsn=(str, ...),
        __cdc_ts=(datetime, ...),
        __cdc_is_deleted=(bool, ...),
    )
