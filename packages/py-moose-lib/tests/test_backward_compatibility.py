"""
Tests ensuring MooseModel doesn't break existing BaseModel usage
"""

from pydantic import BaseModel
from moose_lib.dmv2 import OlapTable, OlapConfig, MooseModel
from moose_lib.data_models import Column


def test_basemodel_olaptable_still_works():
    """Existing code using BaseModel should continue working"""

    class LegacyUser(BaseModel):
        user_id: int
        email: str

    # Old pattern still works
    table = OlapTable[LegacyUser]("legacy_users")

    assert table.name == "legacy_users"
    assert hasattr(table, "cols")
    assert isinstance(table.cols.user_id, Column)


def test_moosemodel_and_basemodel_can_coexist():
    """Projects can mix MooseModel and BaseModel"""

    class NewModel(MooseModel):
        new_field: int

    class OldModel(BaseModel):
        old_field: str

    new_table = OlapTable[NewModel]("new_table")
    old_table = OlapTable[OldModel]("old_table")

    # Both work
    assert new_table.name == "new_table"
    assert old_table.name == "old_table"

    # New model has direct column access
    assert isinstance(NewModel.new_field, Column)

    # Old model doesn't (expected)
    assert (
        not isinstance(OldModel.old_field, Column)
        if hasattr(OldModel, "old_field")
        else True
    )


def test_moosemodel_cols_matches_direct_access():
    """MooseModel.cols.field and MooseModel.field should return same Column"""

    class Analytics(MooseModel):
        event_id: int
        timestamp: str

    # Both access methods return the same Column
    direct = Analytics.event_id
    via_cols = Analytics.cols.event_id

    assert direct.name == via_cols.name
    assert direct.data_type == via_cols.data_type


def test_existing_query_patterns_unchanged():
    """Existing query patterns should work identically"""

    class Metrics(MooseModel):
        metric_id: int
        value: float

    table = OlapTable[Metrics]("metrics")

    # Pattern 1: Using table.cols (existing pattern)
    col_via_table = table.cols.metric_id
    assert isinstance(col_via_table, Column)

    # Pattern 2: Using Model.cols (also existing)
    col_via_model = Metrics.cols.metric_id
    assert isinstance(col_via_model, Column)

    # Both are equivalent
    assert col_via_table.name == col_via_model.name
