import pytest
import os
import sys

# Add the package root to Python path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

@pytest.fixture(autouse=True)
def clear_registries():
    """Clear all global registries before each test to prevent conflicts."""
    from moose_lib.dmv2._registry import (
        _tables,
        _streams,
        _ingest_apis,
        _apis,
        _api_name_aliases,
        _api_path_map,
        _sql_resources,
        _workflows,
    )
    
    # Clear all registries
    _tables.clear()
    _streams.clear()
    _ingest_apis.clear()
    _apis.clear()
    _api_name_aliases.clear()
    _api_path_map.clear()
    _sql_resources.clear()
    _workflows.clear()
    
    yield
    
    # Clean up after test (optional, but good practice)
    _tables.clear()
    _streams.clear()
    _ingest_apis.clear()
    _apis.clear()
    _api_name_aliases.clear()
    _api_path_map.clear()
    _sql_resources.clear()
    _workflows.clear()