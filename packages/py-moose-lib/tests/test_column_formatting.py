"""Tests for Column string formatting and interpolation"""

from moose_lib.data_models import Column


def test_column_str_returns_quoted_identifier():
    """Column.__str__() should return backtick-quoted identifier"""
    col = Column(
        name="user_id",
        data_type="String",
        required=True,
        unique=False,
        primary_key=False,
    )

    assert str(col) == "`user_id`"


def test_column_format_spec_col():
    """Column with :col format spec should return quoted identifier"""
    col = Column(
        name="email", data_type="String", required=True, unique=False, primary_key=False
    )

    result = f"{col:col}"
    assert result == "`email`"


def test_column_format_spec_c():
    """Column with :c format spec should return quoted identifier"""
    col = Column(
        name="timestamp",
        data_type="DateTime",
        required=True,
        unique=False,
        primary_key=False,
    )

    result = f"{col:c}"
    assert result == "`timestamp`"


def test_column_format_spec_empty():
    """Column with no format spec should return quoted identifier"""
    col = Column(
        name="count", data_type="Int64", required=True, unique=False, primary_key=False
    )

    result = f"{col}"
    assert result == "`count`"


def test_column_with_special_chars():
    """Column names with hyphens should be quoted"""
    col = Column(
        name="user-id",
        data_type="String",
        required=True,
        unique=False,
        primary_key=False,
    )

    assert str(col) == "`user-id`"


def test_column_in_fstring_interpolation():
    """Column should work in f-string SQL construction"""
    user_id_col = Column(
        name="user_id",
        data_type="String",
        required=True,
        unique=False,
        primary_key=False,
    )
    email_col = Column(
        name="email", data_type="String", required=True, unique=False, primary_key=False
    )

    query = f"SELECT {user_id_col:col}, {email_col:col} FROM users"
    assert query == "SELECT `user_id`, `email` FROM users"
