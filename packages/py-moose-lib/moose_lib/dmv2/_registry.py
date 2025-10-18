"""
Internal registry dictionaries for Moose Data Model v2 (dmv2) resources.

This module maintains the raw dictionaries that store all registered resources.
It has no imports from other dmv2 modules to avoid circular dependencies.
"""
from typing import Dict, Any

# Global registries for all resource types
_tables: Dict[str, Any] = {}
_streams: Dict[str, Any] = {}
_ingest_apis: Dict[str, Any] = {}
_apis: Dict[str, Any] = {}
# Alias map for O(1) fallback of sole versioned APIs: base name -> handler
_api_name_aliases: Dict[str, Any] = {}
# Map from custom paths to API instances for path-based lookup
_api_path_map: Dict[str, Any] = {}
_sql_resources: Dict[str, Any] = {}
_workflows: Dict[str, Any] = {}
_web_apps: Dict[str, Any] = {}