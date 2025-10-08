"""
Tests for OlapTable versioning functionality.

This test module verifies that multiple versions of OlapTables with the same name
can coexist and that the infrastructure map generation handles versioned keys correctly.
"""

import pytest
from moose_lib import OlapTable, OlapConfig, ClickHouseEngines, MergeTreeEngine, ReplacingMergeTreeEngine
from moose_lib.dmv2.registry import get_tables
from moose_lib.internal import to_infra_map
from pydantic import BaseModel
from typing import Optional


class UserEvent(BaseModel):
    """Sample model for testing OlapTable versioning."""
    user_id: str
    event_type: str
    timestamp: float
    metadata: Optional[str] = None


class UserEventV2(BaseModel):
    """Updated model with additional fields for version testing."""
    user_id: str
    event_type: str
    timestamp: float
    metadata: Optional[str] = None
    session_id: str
    user_agent: Optional[str] = None


def test_multiple_olap_table_versions_can_coexist():
    """Test that multiple versions of the same table can be registered simultaneously."""
    # Create version 1.0 of the table
    table_v1 = OlapTable[UserEvent](
        "UserEvents",
        OlapConfig(
            version="1.0",
            engine=MergeTreeEngine(),
            order_by_fields=["user_id", "timestamp"]
        )
    )
    
    # Create version 2.0 of the table with different configuration
    table_v2 = OlapTable[UserEventV2](
        "UserEvents",
        OlapConfig(
            version="2.0",
            engine=ReplacingMergeTreeEngine(),
            order_by_fields=["user_id", "timestamp", "session_id"]
        )
    )
    
    # Both tables should be registered successfully
    tables = get_tables()
    assert "UserEvents_1.0" in tables
    assert "UserEvents_2.0" in tables
    
    # Verify they are different instances
    assert tables["UserEvents_1.0"] is table_v1
    assert tables["UserEvents_2.0"] is table_v2
    
    # Verify configurations are different
    assert table_v1.config.version == "1.0"
    assert table_v2.config.version == "2.0"
    assert isinstance(table_v1.config.engine, MergeTreeEngine)
    assert isinstance(table_v2.config.engine, ReplacingMergeTreeEngine)


def test_unversioned_and_versioned_tables_can_coexist():
    """Test that unversioned and versioned tables with the same name can coexist."""
    # Create unversioned table
    unversioned_table = OlapTable[UserEvent](
        "EventData",
        OlapConfig(engine=MergeTreeEngine())
    )
    
    # Create versioned table with same name
    versioned_table = OlapTable[UserEvent](
        "EventData", 
        OlapConfig(
            version="1.5",
            engine=MergeTreeEngine()
        )
    )
    
    # Both should be registered
    tables = get_tables()
    assert "EventData" in tables  # Unversioned
    assert "EventData_1.5" in tables  # Versioned
    
    assert tables["EventData"] is unversioned_table
    assert tables["EventData_1.5"] is versioned_table


def test_duplicate_version_registration_fails():
    """Test that registering the same table name and version twice fails."""
    # Create first table
    OlapTable[UserEvent](
        "DuplicateTest",
        OlapConfig(version="1.0", engine=MergeTreeEngine())
    )
    
    # Attempting to create another table with same name and version should fail
    with pytest.raises(ValueError, match="OlapTable with name DuplicateTest and version 1.0 already exists"):
        OlapTable[UserEvent](
            "DuplicateTest",
            OlapConfig(version="1.0", engine=MergeTreeEngine())
        )


def test_infrastructure_map_uses_versioned_keys():
    """Test that infrastructure map generation uses versioned keys for tables."""
    # Create multiple versions of tables
    table_v1 = OlapTable[UserEvent](
        "InfraMapTest",
        OlapConfig(
            version="1.0",
            engine=MergeTreeEngine(),
            order_by_fields=["user_id"]
        )
    )
    
    table_v2 = OlapTable[UserEvent](
        "InfraMapTest",
        OlapConfig(
            version="2.0", 
            engine=ReplacingMergeTreeEngine(),
            order_by_fields=["user_id", "timestamp"]
        )
    )
    
    unversioned_table = OlapTable[UserEvent](
        "UnversionedInfraTest",
        OlapConfig(engine=MergeTreeEngine())
    )
    
    # Generate infrastructure map
    tables_registry = get_tables()
    infra_map = to_infra_map()
    
    # Verify versioned keys are used in infrastructure map
    assert "InfraMapTest_1.0" in infra_map["tables"]
    assert "InfraMapTest_2.0" in infra_map["tables"]
    assert "UnversionedInfraTest" in infra_map["tables"]
    
    # Verify table configurations in infra map
    v1_config = infra_map["tables"]["InfraMapTest_1.0"]
    v2_config = infra_map["tables"]["InfraMapTest_2.0"]
    unversioned_config = infra_map["tables"]["UnversionedInfraTest"]
    
    assert v1_config["name"] == "InfraMapTest"
    assert v1_config["version"] == "1.0"
    assert v1_config["engineConfig"]["engine"] == "MergeTree"
    
    assert v2_config["name"] == "InfraMapTest"
    assert v2_config["version"] == "2.0"
    assert v2_config["engineConfig"]["engine"] == "ReplacingMergeTree"
    
    assert unversioned_config["name"] == "UnversionedInfraTest"
    assert unversioned_config.get("version") is None


def test_version_with_dots_handled_correctly():
    """Test that versions with dots are handled correctly in keys."""
    # Create table with semantic version
    table = OlapTable[UserEvent](
        "SemanticVersionTest",
        OlapConfig(
            version="1.2.3",
            engine=MergeTreeEngine()
        )
    )
    
    # Should be registered with version in key
    tables = get_tables()
    assert "SemanticVersionTest_1.2.3" in tables
    assert tables["SemanticVersionTest_1.2.3"] is table
    
    # Verify in infrastructure map
    infra_map = to_infra_map()
    assert "SemanticVersionTest_1.2.3" in infra_map["tables"]
    
    table_config = infra_map["tables"]["SemanticVersionTest_1.2.3"]
    assert table_config["version"] == "1.2.3"


def test_backward_compatibility_with_legacy_engines():
    """Test that versioning works with legacy enum-based engine configuration."""
    # Create table with legacy enum engine (should show deprecation warning)
    table = OlapTable[UserEvent](
        "LegacyEngineTest",
        OlapConfig(
            version="1.0",
            engine=ClickHouseEngines.ReplacingMergeTree
        )
    )
    
    # Should still be registered correctly
    tables = get_tables()
    assert "LegacyEngineTest_1.0" in tables
    assert tables["LegacyEngineTest_1.0"] is table
    
    # Should work in infrastructure map
    infra_map = to_infra_map()
    assert "LegacyEngineTest_1.0" in infra_map["tables"]
    
    table_config = infra_map["tables"]["LegacyEngineTest_1.0"]
    assert table_config["version"] == "1.0"
    assert table_config["engineConfig"]["engine"] == "ReplacingMergeTree"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])