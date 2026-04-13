"""
OlapDictionary E2E test definitions (Python mirror of dictionaryTests.ts).

Defines a simple integer-keyed lookup dictionary over the existing
index_test_table to exercise the full dictionary lifecycle:
Python definition → Rust parsing → migration DDL → ClickHouse.
"""

from moose_lib.dmv2 import (
    OlapDictionary,
    OlapDictionaryConfig,
    HashedLayout,
    DictionaryLifetime,
)
from src.ingest.models import index_test_table, IndexTest

# A HASHED dictionary over index_test_table.
# UInt64 primary key → HASHED layout (fastest for numeric keys).
# lifetime: static (min=0, max=0) → never auto-reloads.
index_test_lookup_dict = OlapDictionary[IndexTest](
    "dict_index_test_lookup",
    OlapDictionaryConfig(
        source_table=index_test_table,
        primary_key=["u64"],
        layout=HashedLayout(),
        lifetime=DictionaryLifetime(min=0, max=0),
    ),
)
