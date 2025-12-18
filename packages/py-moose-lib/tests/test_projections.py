"""
Tests for OlapTable projection functionality.

This test module verifies that projections can be defined on tables
and are correctly serialized to the infrastructure map.
"""

import pytest
from moose_lib import OlapTable, OlapConfig, ClickHouseEngines, MergeTreeEngine
from moose_lib.dmv2.registry import get_tables
from moose_lib.internal import to_infra_map
from pydantic import BaseModel
from typing import Optional


class UserEvent(BaseModel):
    """Sample model for testing projections."""

    user_id: str
    timestamp: float
    event_type: str
    value: float


def test_simple_field_list_projection():
    """Test projections with simple field lists."""
    table = OlapTable[UserEvent](
        "Events",
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["timestamp"],
            projections=[
                OlapConfig.TableProjection(
                    name="by_user",
                    select=["user_id", "timestamp", "event_type"],
                    order_by=["user_id", "timestamp"],
                )
            ],
        ),
    )

    tables = get_tables()
    assert "Events" in tables

    registered_table = tables["Events"]
    assert len(registered_table.config.projections) == 1
    assert registered_table.config.projections[0].name == "by_user"
    assert registered_table.config.projections[0].select == [
        "user_id",
        "timestamp",
        "event_type",
    ]
    assert registered_table.config.projections[0].order_by == ["user_id", "timestamp"]


def test_multiple_projections():
    """Test table with multiple projections."""
    table = OlapTable[UserEvent](
        "Events2",
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["timestamp"],
            projections=[
                OlapConfig.TableProjection(
                    name="by_user",
                    select=["user_id", "timestamp"],
                    order_by=["user_id"],
                ),
                OlapConfig.TableProjection(
                    name="by_event",
                    select=["event_type", "timestamp"],
                    order_by=["event_type"],
                ),
            ],
        ),
    )

    tables = get_tables()
    registered_table = tables["Events2"]

    assert len(registered_table.config.projections) == 2
    assert registered_table.config.projections[0].name == "by_user"
    assert registered_table.config.projections[1].name == "by_event"


def test_expression_based_projection():
    """Test projections with SQL expressions."""
    table = OlapTable[UserEvent](
        "Events3",
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["timestamp"],
            projections=[
                OlapConfig.TableProjection(
                    name="hourly_metrics",
                    select="toStartOfHour(timestamp) as hour, count() as cnt, sum(value) as total",
                    order_by="hour",
                    group_by="hour",
                )
            ],
        ),
    )

    tables = get_tables()
    registered_table = tables["Events3"]

    assert len(registered_table.config.projections) == 1
    proj = registered_table.config.projections[0]
    assert proj.name == "hourly_metrics"
    assert isinstance(proj.select, str)
    assert "toStartOfHour" in proj.select
    assert proj.group_by == "hour"


def test_mixed_projections():
    """Test table with both field list and expression projections."""
    table = OlapTable[UserEvent](
        "Events5",
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["timestamp"],
            projections=[
                OlapConfig.TableProjection(
                    name="by_user",
                    select=["user_id", "timestamp"],
                    order_by=["user_id"],
                ),
                OlapConfig.TableProjection(
                    name="hourly_agg",
                    select="toStartOfHour(timestamp) as hour, count() as cnt",
                    order_by="hour",
                    group_by="hour",
                ),
            ],
        ),
    )

    tables = get_tables()
    registered_table = tables["Events5"]

    assert len(registered_table.config.projections) == 2

    # First projection uses arrays
    assert isinstance(registered_table.config.projections[0].select, list)

    # Second projection uses expressions
    assert isinstance(registered_table.config.projections[1].select, str)
    assert registered_table.config.projections[1].group_by is not None


def test_table_without_projections():
    """Test that tables without projections serialize correctly."""
    table = OlapTable[UserEvent](
        "Events6",
        OlapConfig(
            engine=MergeTreeEngine(),
            order_by_fields=["timestamp"],
        ),
    )

    tables = get_tables()
    registered_table = tables["Events6"]

    assert isinstance(registered_table.config.projections, list)
    assert len(registered_table.config.projections) == 0


def test_projection_pydantic_validation():
    """Test that Pydantic validates projection configuration."""
    # This should work - valid projection
    proj = OlapConfig.TableProjection(
        name="test",
        select=["field1", "field2"],
        order_by=["field1"],
    )
    assert proj.name == "test"

    # Test with expression strings
    proj_expr = OlapConfig.TableProjection(
        name="test_expr",
        select="count() as cnt",
        order_by="cnt",
    )
    assert isinstance(proj_expr.select, str)
