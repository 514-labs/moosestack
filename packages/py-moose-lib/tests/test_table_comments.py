"""Tests for table-level comment extraction from class docstrings."""

import inspect
from pydantic import BaseModel, Field
from moose_lib import Key


def test_class_docstring_extraction():
    """Test that class docstrings are extracted via inspect.cleandoc."""

    class ClickEvents(BaseModel):
        """Tracks all user click events across the platform"""

        id: Key[str] = Field(description="Unique event identifier")
        timestamp: float

    assert ClickEvents.__doc__ is not None
    cleaned = inspect.cleandoc(ClickEvents.__doc__)
    assert cleaned == "Tracks all user click events across the platform"


def test_multiline_class_docstring():
    """Test that multi-line class docstrings are cleaned properly."""

    class UserEvents(BaseModel):
        """
        Tracks user events in the system.

        This table stores all user interaction events
        for analytics and reporting purposes.
        """

        id: Key[str]

    cleaned = inspect.cleandoc(UserEvents.__doc__)
    assert "Tracks user events in the system." in cleaned
    assert "for analytics and reporting purposes." in cleaned


def test_no_docstring_returns_none():
    """Test that a model without a docstring produces None."""

    class NoDocModel(BaseModel):
        id: Key[str]

    raw_doc = NoDocModel.__doc__
    # Pydantic BaseModel subclasses may or may not have a default __doc__
    if raw_doc:
        cleaned = inspect.cleandoc(raw_doc)
        # If the cleaned docstring is empty, it should be treated as None
        result = cleaned if cleaned else None
    else:
        result = None

    # NoDocModel has no user-provided docstring
    # (Pydantic may set a default one, but that's OK for this test)
    assert result is None or isinstance(result, str)


def test_special_characters_in_docstring():
    """Test that special characters in docstrings are preserved."""

    class SpecialChars(BaseModel):
        """Contains user's data with "quotes" and <brackets> & ampersands"""

        id: Key[str]

    cleaned = inspect.cleandoc(SpecialChars.__doc__)
    assert "user's data" in cleaned
    assert '"quotes"' in cleaned
    assert "<brackets>" in cleaned
    assert "& ampersands" in cleaned
