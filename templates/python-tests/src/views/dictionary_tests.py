"""
OlapDictionary E2E Test Resources (Python)

These resources test OlapDictionary lifecycle and DDL generation:
- HASHED layout with TABLE source (simple lookup)
- COMPLEX_KEY_HASHED layout (composite key)
- LIFETIME(0) static dictionary
- dictGet usage in a MaterializedView
- DELETION_PROTECTED lifecycle
"""

from pydantic import BaseModel
from typing import Optional
from moose_lib import OlapTable, OlapConfig, MergeTreeEngine, Key
from moose_lib.dmv2 import (
    OlapDictionary,
    MaterializedView,
    MaterializedViewOptions,
    LifeCycle,
)

# ─── Source tables ────────────────────────────────────────────────────────────


class Product(BaseModel):
    """Product catalog — source table for dictionary lookups."""

    product_id: Key[str]
    product_name: str
    category: str
    price_level: int
    version: int


products_table = OlapTable[Product](
    "dict_test_products_py",
    OlapConfig(
        order_by_fields=["product_id"],
        engine=MergeTreeEngine(),
    ),
)


class Region(BaseModel):
    """Region metadata — source for composite key dictionary."""

    country_code: Key[str]
    region_code: Key[str]
    region_name: str
    timezone: str


regions_table = OlapTable[Region](
    "dict_test_regions_py",
    OlapConfig(
        order_by_fields=["country_code", "region_code"],
        engine=MergeTreeEngine(),
    ),
)


# ─── Simple HASHED dictionary (single key) ────────────────────────────────────


class ProductLookup(BaseModel):
    """Attribute columns for the product dictionary (excludes primary key)."""

    product_name: str
    category: str
    price_level: int


product_dict = OlapDictionary[ProductLookup](
    "dict_test_products_dict_py",
    source_table=products_table,
    primary_key=["product_id"],
    layout={"type": "HASHED"},
    lifetime={"min": 10, "max": 60},
    defaults={"category": "Unknown", "price_level": 0},
)

# ─── COMPLEX_KEY_HASHED dictionary (composite key) ───────────────────────────


class RegionLookup(BaseModel):
    """Attribute columns for the region dictionary."""

    region_name: str
    timezone: str


region_dict = OlapDictionary[RegionLookup](
    "dict_test_regions_dict_py",
    source_table=regions_table,
    primary_key=["country_code", "region_code"],
    layout={"type": "COMPLEX_KEY_HASHED"},
    lifetime={"min": 60, "max": 300},
    defaults={"region_name": "Unknown", "timezone": "UTC"},
)

# ─── STATIC (LIFETIME 0) dictionary ──────────────────────────────────────────


class StatusCode(BaseModel):
    """Source table for the static dictionary."""

    status_code: Key[str]
    label: str
    severity: int


status_codes_table = OlapTable[StatusCode](
    "dict_test_status_codes_py",
    OlapConfig(
        order_by_fields=["status_code"],
        engine=MergeTreeEngine(),
    ),
)


class StatusLookup(BaseModel):
    """Attribute columns for the status codes dictionary."""

    label: str
    severity: int


status_dict = OlapDictionary[StatusLookup](
    "dict_test_status_codes_dict_py",
    source_table=status_codes_table,
    primary_key=["status_code"],
    layout={"type": "FLAT"},
    lifetime=0,
)

# ─── DELETION_PROTECTED dictionary ───────────────────────────────────────────

protected_dict = OlapDictionary[ProductLookup](
    "dict_test_protected_py",
    source_table=products_table,
    primary_key=["product_id"],
    layout={"type": "HASHED"},
    lifetime=3600,
    life_cycle=LifeCycle.DELETION_PROTECTED,
)

# ─── MaterializedView using dictGet ──────────────────────────────────────────


class RawClick(BaseModel):
    """Raw click events source table."""

    click_id: Key[str]
    product_id: str
    clicked_at: str


raw_clicks_table = OlapTable[RawClick](
    "dict_test_raw_clicks_py",
    OlapConfig(
        order_by_fields=["click_id"],
        engine=MergeTreeEngine(),
    ),
)


class EnrichedClick(BaseModel):
    """Click events enriched with product names via dictionary lookup."""

    click_id: Key[str]
    product_id: str
    product_name: str
    category: str
    clicked_at: str


enriched_clicks_mv = MaterializedView[EnrichedClick](
    MaterializedViewOptions(
        select_statement=f"""
    SELECT
      click_id,
      product_id,
      {product_dict.get("product_name", "product_id")} AS product_name,
      {product_dict.get("category", "product_id")} AS category,
      clicked_at
    FROM {raw_clicks_table.name}
    """,
        select_tables=[raw_clicks_table],
        table_name="dict_test_enriched_clicks_py",
        materialized_view_name="dict_test_enriched_clicks_mv_py",
        order_by_fields=["click_id"],
    )
)
