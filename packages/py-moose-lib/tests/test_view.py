"""Tests for the View class in moose_lib.dmv2.view."""

import pytest
from pydantic import BaseModel

from moose_lib.dmv2.view import View, _format_table_reference
from moose_lib.dmv2.olap_table import OlapTable, OlapConfig
from moose_lib.internal import to_infra_map


class SampleModel(BaseModel):
    id: str
    value: int


# ---------------------------------------------------------------------------
# _format_table_reference
# ---------------------------------------------------------------------------


def test_format_table_reference_view_without_database():
    view = View(name="my_view", select_statement="SELECT 1", base_tables=[])
    assert _format_table_reference(view) == "`my_view`"


def test_format_table_reference_view_with_database():
    view = View(
        name="my_view",
        select_statement="SELECT 1",
        base_tables=[],
        database="analytics",
    )
    assert _format_table_reference(view) == "`analytics`.`my_view`"


def test_format_table_reference_olap_table_without_database():
    table = OlapTable[SampleModel](name="events")
    assert _format_table_reference(table) == "`events`"


def test_format_table_reference_olap_table_with_database():
    table = OlapTable[SampleModel](name="events", config=OlapConfig(database="raw"))
    assert _format_table_reference(table) == "`raw`.`events`"


# ---------------------------------------------------------------------------
# View construction
# ---------------------------------------------------------------------------


def test_view_creation_without_database():
    view = View(
        name="v_no_db",
        select_statement="SELECT * FROM events",
        base_tables=[],
    )
    assert view.database is None
    assert view.name == "v_no_db"
    assert view.select_sql == "SELECT * FROM events"


def test_view_creation_with_database():
    view = View(
        name="v_with_db",
        select_statement="SELECT * FROM events",
        base_tables=[],
        database="my_db",
    )
    assert view.database == "my_db"
    assert view.name == "v_with_db"


def test_view_source_tables_include_database_from_base_view():
    base_view = View(
        name="base_view",
        select_statement="SELECT 1",
        base_tables=[],
        database="src_db",
    )
    derived = View(
        name="derived_view",
        select_statement="SELECT * FROM `src_db`.`base_view`",
        base_tables=[base_view],
    )
    assert "`src_db`.`base_view`" in derived.source_tables


def test_view_source_tables_plain_when_base_view_has_no_database():
    base_view = View(
        name="plain_base",
        select_statement="SELECT 1",
        base_tables=[],
    )
    derived = View(
        name="derived_plain",
        select_statement="SELECT * FROM `plain_base`",
        base_tables=[base_view],
    )
    assert "`plain_base`" in derived.source_tables


def test_duplicate_view_name_raises():
    View(name="dup_view", select_statement="SELECT 1", base_tables=[])
    with pytest.raises(ValueError, match="already exists"):
        View(name="dup_view", select_statement="SELECT 2", base_tables=[])


# ---------------------------------------------------------------------------
# Serialization via to_infra_map
# ---------------------------------------------------------------------------


def test_view_serialization_without_database():
    View(name="ser_no_db", select_statement="SELECT 1", base_tables=[])
    infra = to_infra_map()
    views = infra.get("views", {})
    assert "ser_no_db" in views
    assert views["ser_no_db"].get("database") is None


def test_view_serialization_with_database():
    View(
        name="ser_with_db",
        select_statement="SELECT 1",
        base_tables=[],
        database="prod_db",
    )
    infra = to_infra_map()
    views = infra.get("views", {})
    assert "ser_with_db" in views
    assert views["ser_with_db"]["database"] == "prod_db"
