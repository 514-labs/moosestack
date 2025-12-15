"""Tests for metadata handling in OlapTable."""

from moose_lib.dmv2 import OlapTable, OlapConfig
from pydantic import BaseModel


class SampleModel(BaseModel):
    """Sample model for testing metadata."""

    id: str
    name: str


def test_respect_user_provided_source():
    """Test that user-provided source file path is not overwritten."""

    user_provided_path = "custom/path/to/model.py"

    config = OlapConfig(metadata={"source": {"file": user_provided_path}})

    table = OlapTable[SampleModel]("test_user_provided", config=config)

    assert table.metadata is not None
    assert table.metadata["source"]["file"] == user_provided_path


def test_preserve_metadata_with_auto_capture():
    """Test that user metadata is preserved while auto-capturing source."""

    config = OlapConfig(metadata={"description": "A test table"})

    table = OlapTable[SampleModel]("test_preserve_metadata", config=config)

    assert table.metadata is not None
    assert isinstance(table.metadata, dict)
    assert table.metadata["description"] == "A test table"
    assert "test_metadata.py" in table.metadata["source"]["file"]
