"""Tests for the View class in moose_lib.dmv2.view."""

import pytest
from pydantic import BaseModel

from moose_lib.dmv2.view import View, ViewConfig, _format_table_reference
from moose_lib.dmv2.olap_table import OlapTable, OlapConfig
from moose_lib.dmv2.registry import get_view
from moose_lib.internal import to_infra_map, _map_sql_resource_ref


class SampleModel(BaseModel):
    id: str
    value: int


# ---------------------------------------------------------------------------
# _format_table_reference
# ---------------------------------------------------------------------------


def test_format_table_reference_view_without_database():
    view = View("my_view", ViewConfig(select_statement="SELECT 1", base_tables=[]))
    assert _format_table_reference(view) == "`my_view`"


def test_format_table_reference_view_with_database():
    view = View(
        "my_view",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="analytics"),
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
        "v_no_db",
        ViewConfig(select_statement="SELECT * FROM events", base_tables=[]),
    )
    assert view.database is None
    assert view.name == "v_no_db"
    assert view.select_sql == "SELECT * FROM events"


def test_view_creation_with_database():
    view = View(
        "v_with_db",
        ViewConfig(
            select_statement="SELECT * FROM events",
            base_tables=[],
            database="my_db",
        ),
    )
    assert view.database == "my_db"
    assert view.name == "v_with_db"


def test_view_source_tables_include_database_from_base_view():
    base_view = View(
        "base_view",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="src_db"),
    )
    derived = View(
        "derived_view",
        ViewConfig(
            select_statement="SELECT * FROM `src_db`.`base_view`",
            base_tables=[base_view],
        ),
    )
    assert "`src_db`.`base_view`" in derived.source_tables


def test_view_source_tables_plain_when_base_view_has_no_database():
    base_view = View(
        "plain_base",
        ViewConfig(select_statement="SELECT 1", base_tables=[]),
    )
    derived = View(
        "derived_plain",
        ViewConfig(
            select_statement="SELECT * FROM `plain_base`",
            base_tables=[base_view],
        ),
    )
    assert "`plain_base`" in derived.source_tables


def test_duplicate_view_name_raises():
    View("dup_view", ViewConfig(select_statement="SELECT 1", base_tables=[]))
    with pytest.raises(ValueError, match="already exists"):
        View("dup_view", ViewConfig(select_statement="SELECT 2", base_tables=[]))


def test_deprecated_positional_constructor_forwards_database():
    """database kwarg must be forwarded when using the deprecated positional API."""
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        view = View("legacy_view", "SELECT 1", [], database="legacy_db")
    assert view.database == "legacy_db"
    assert view.name == "legacy_view"


# ---------------------------------------------------------------------------
# Serialization via to_infra_map
# ---------------------------------------------------------------------------


def test_view_serialization_without_database():
    View("ser_no_db", ViewConfig(select_statement="SELECT 1", base_tables=[]))
    infra = to_infra_map()
    views = infra.get("views", {})
    assert "ser_no_db" in views
    assert views["ser_no_db"].get("database") is None


def test_view_serialization_with_database():
    View(
        "ser_with_db",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="prod_db"),
    )
    infra = to_infra_map()
    views = infra.get("views", {})
    # Database-qualified views use a composite key: "database::name"
    registry_key = "prod_db::ser_with_db"
    assert registry_key in views
    assert views[registry_key]["database"] == "prod_db"


# ---------------------------------------------------------------------------
# _map_sql_resource_ref: dependency ID format for View
# ---------------------------------------------------------------------------


def test_map_sql_resource_ref_view_without_database():
    view = View(
        "dep_view_no_db",
        ViewConfig(select_statement="SELECT 1", base_tables=[]),
    )
    sig = _map_sql_resource_ref(view)
    assert sig.id == "dep_view_no_db"
    assert sig.kind == "View"


def test_map_sql_resource_ref_view_with_database():
    """Dependency ID uses '::' separator, matching the views map key for CLI correlation."""
    view = View(
        "dep_view_with_db",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="analytics"),
    )
    sig = _map_sql_resource_ref(view)
    assert sig.id == "analytics::dep_view_with_db"
    assert sig.kind == "View"


# ---------------------------------------------------------------------------
# get_view: registry lookup
# ---------------------------------------------------------------------------


def test_get_view_without_database():
    view = View("lookup_view", ViewConfig(select_statement="SELECT 1", base_tables=[]))
    assert get_view("lookup_view") is view


def test_get_view_with_database():
    view = View(
        "lookup_view_db",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="mydb"),
    )
    assert get_view("lookup_view_db", database="mydb") is view


def test_get_view_returns_none_when_not_found():
    assert get_view("nonexistent") is None
    assert get_view("nonexistent", database="mydb") is None


def test_get_view_without_database_does_not_match_database_qualified_view():
    """A lookup without database should not return a database-qualified view."""
    View(
        "scoped_view",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="mydb"),
    )
    assert get_view("scoped_view") is None


# ---------------------------------------------------------------------------
# Registry: same name in different databases
# ---------------------------------------------------------------------------


def test_same_view_name_different_databases_allowed():
    """Two views with the same name in different databases must not conflict."""
    v1 = View(
        "shared_name",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="db1"),
    )
    v2 = View(
        "shared_name",
        ViewConfig(select_statement="SELECT 2", base_tables=[], database="db2"),
    )
    assert get_view("shared_name", database="db1") is v1
    assert get_view("shared_name", database="db2") is v2


def test_duplicate_view_same_database_raises():
    View(
        "dup_db_view",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="mydb"),
    )
    with pytest.raises(ValueError, match="already exists"):
        View(
            "dup_db_view",
            ViewConfig(select_statement="SELECT 2", base_tables=[], database="mydb"),
        )


# ---------------------------------------------------------------------------
# Registry key vs infrastructure ID
# ---------------------------------------------------------------------------


def test_registry_key_and_infra_id_both_use_double_colon():
    """Registry key and dependency ID both use '::' separator so the CLI can correlate them."""
    view = View(
        "my_view",
        ViewConfig(select_statement="SELECT 1", base_tables=[], database="my_db"),
    )
    # Internal: stored under "my_db::my_view"
    infra = to_infra_map()
    assert "my_db::my_view" in infra.get("views", {})

    # Dependency ID matches the map key so consumers can look it up
    sig = _map_sql_resource_ref(view)
    assert sig.id == "my_db::my_view"
