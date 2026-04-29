"""Tests for OlapDictionary in moose_lib.dmv2.olap_dictionary."""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from moose_lib.dmv2.olap_dictionary import (
    CacheLayout,
    ClickHouseRemoteSource,
    ComplexKeyCacheLayout,
    ComplexKeyDirectLayout,
    ComplexKeyHashedArrayLayout,
    ComplexKeyHashedLayout,
    ComplexKeySsdCacheLayout,
    ComplexKeySparseHashedLayout,
    DictionaryColumn,
    DictionaryInvalidation,
    DictionaryLifetime,
    DirectLayout,
    ExecutableSource,
    FlatLayout,
    HashedArrayLayout,
    HashedLayout,
    HttpSource,
    IpTrieLayout,
    MongoDbSource,
    MysqlSource,
    OlapDictionary,
    OlapDictionaryConfig,
    PostgresqlSource,
    RangeHashedLayout,
    RedisSource,
    S3Source,
    SparseHashedLayout,
    SsdCacheLayout,
)
from moose_lib.dmv2.olap_table import OlapTable, OlapConfig
from moose_lib.dmv2.life_cycle import LifeCycle
from moose_lib.dmv2.registry import get_olap_dictionaries, get_olap_dictionary
from moose_lib.internal import (
    _serialize_dict_columns,
    _serialize_dict_lifetime,
    _serialize_dict_source,
    to_infra_map,
)


# ─── Test models ─────────────────────────────────────────────────────────────


class Product(BaseModel):
    product_id: str
    product_name: str
    category: str
    price_level: int


class Lookup(BaseModel):
    lookup_id: str
    value: str


class CompositeLookup(BaseModel):
    lookup_id: str
    category: str
    region: str
    value: str


# ─── Construction and field defaults ─────────────────────────────────────────


def test_construction_with_source_table():
    table = OlapTable[Product](name="products")
    d = OlapDictionary[Product](
        name="dict_products",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["product_id"],
            layout=HashedLayout(),
        ),
    )
    assert d.name == "dict_products"
    assert d.config.primary_key == ["product_id"]
    assert d.life_cycle is None
    assert d.source_tables == ["`products`"]


def test_construction_lifetime_default_is_static():
    table = OlapTable[Lookup](name="tbl")
    d = OlapDictionary[Lookup](
        name="dict_default_lifetime",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    assert d.config.lifetime == DictionaryLifetime(min=0, max=0)


def test_construction_with_source_query():
    table = OlapTable[Lookup](name="tbl_query")
    d = OlapDictionary[Lookup](
        name="dict_query",
        config=OlapDictionaryConfig(
            source_query="SELECT lookup_id, value FROM tbl_query",
            source_tables=[table],
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    assert d.config.source_query == "SELECT lookup_id, value FROM tbl_query"
    assert d.source_tables == ["`tbl_query`"]


def test_construction_with_external_source():
    d = OlapDictionary[Lookup](
        name="dict_external",
        config=OlapDictionaryConfig(
            external_source=MongoDbSource(
                host="mongo.example.com",
                user="user",
                password="pass",
                db="catalog",
                collection="products",
            ),
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    assert d.source_tables == []


# ─── Source validation ────────────────────────────────────────────────────────


def test_zero_sources_rejected():
    with pytest.raises(ValidationError, match="Exactly one"):
        OlapDictionaryConfig(
            primary_key=["id"],
            layout=HashedLayout(),
        )


def test_multiple_sources_rejected():
    table = OlapTable[Lookup](name="tbl_multi_src")
    with pytest.raises(ValidationError, match="Exactly one"):
        OlapDictionaryConfig(
            source_table=table,
            external_source=MongoDbSource(
                host="h",
                user="u",
                password="p",
                db="d",
                collection="c",
            ),
            primary_key=["id"],
            layout=HashedLayout(),
        )


def test_source_query_without_source_tables_rejected():
    with pytest.raises(ValidationError, match="source_tables is required"):
        OlapDictionaryConfig(
            source_query="SELECT id FROM t",
            primary_key=["id"],
            layout=HashedLayout(),
        )


# ─── Registration ─────────────────────────────────────────────────────────────


def test_registers_in_global_registry():
    table = OlapTable[Lookup](name="tbl_reg")
    d = OlapDictionary[Lookup](
        name="dict_reg",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    assert get_olap_dictionary("dict_reg") is d
    assert "dict_reg" in get_olap_dictionaries()


def test_duplicate_name_rejected():
    table = OlapTable[Lookup](name="tbl_dup")
    OlapDictionary[Lookup](
        name="dict_dup",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    with pytest.raises(ValueError, match="already registered"):
        OlapDictionary[Lookup](
            name="dict_dup",
            config=OlapDictionaryConfig(
                source_table=table,
                primary_key=["lookup_id"],
                layout=HashedLayout(),
            ),
        )


# ─── SQL helpers ──────────────────────────────────────────────────────────────


def test_get_single_key():
    table = OlapTable[Lookup](name="tbl_get")
    d = OlapDictionary[Lookup](
        name="dict_get",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    sql = d.get("value", "lookup_id")
    assert sql == "dictGet('dict_get', 'value', lookup_id)"


def test_get_composite_key_wraps_tuple():
    table = OlapTable[CompositeLookup](name="tbl_ckg")
    d = OlapDictionary[CompositeLookup](
        name="dict_ck_get",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id", "category"],
            layout=ComplexKeyHashedLayout(),
        ),
    )
    sql = d.get("value", "id1", "cat1")
    assert sql == "dictGet('dict_ck_get', 'value', tuple(id1, cat1))"


def test_get_or_default():
    table = OlapTable[Lookup](name="tbl_god")
    d = OlapDictionary[Lookup](
        name="dict_god",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    sql = d.get_or_default("value", "'Unknown'", "lookup_id")
    assert sql == "dictGetOrDefault('dict_god', 'value', lookup_id, 'Unknown')"


def test_get_or_default_composite_key():
    table = OlapTable[CompositeLookup](name="tbl_god_ck")
    d = OlapDictionary[CompositeLookup](
        name="dict_god_ck",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id", "region"],
            layout=ComplexKeyHashedLayout(),
        ),
    )
    sql = d.get_or_default("value", "'N/A'", "id1", "r1")
    assert sql == "dictGetOrDefault('dict_god_ck', 'value', tuple(id1, r1), 'N/A')"


def test_has_single_key():
    table = OlapTable[Lookup](name="tbl_has")
    d = OlapDictionary[Lookup](
        name="dict_has",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    sql = d.has("lookup_id")
    assert sql == "dictHas('dict_has', lookup_id)"


def test_has_composite_key():
    table = OlapTable[CompositeLookup](name="tbl_has_ck")
    d = OlapDictionary[CompositeLookup](
        name="dict_has_ck",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id", "region"],
            layout=ComplexKeyHashedLayout(),
        ),
    )
    sql = d.has("id1", "r1")
    assert sql == "dictHas('dict_has_ck', tuple(id1, r1))"


def test_get_no_keys_raises():
    table = OlapTable[Lookup](name="tbl_get_nokeys")
    d = OlapDictionary[Lookup](
        name="dict_get_nokeys",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    with pytest.raises(ValueError, match="At least one key argument is required"):
        d.get("value")


def test_get_or_default_no_keys_raises():
    table = OlapTable[Lookup](name="tbl_god_nokeys")
    d = OlapDictionary[Lookup](
        name="dict_god_nokeys",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    with pytest.raises(ValueError, match="At least one key argument is required"):
        d.get_or_default("value", "'Unknown'")


def test_has_no_keys_raises():
    table = OlapTable[Lookup](name="tbl_has_nokeys")
    d = OlapDictionary[Lookup](
        name="dict_has_nokeys",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    with pytest.raises(ValueError, match="At least one key argument is required"):
        d.has()


def test_get_uses_explicit_database():
    table = OlapTable[Lookup](name="tbl_db")
    d = OlapDictionary[Lookup](
        name="dict_db",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            database="analytics",
        ),
    )
    sql = d.get("value", "lookup_id")
    assert sql == "dictGet('analytics.dict_db', 'value', lookup_id)"


# ─── Lifetime serialization ───────────────────────────────────────────────────


def test_lifetime_static_from_zero_int():
    assert _serialize_dict_lifetime(0) == {"type": "STATIC"}


def test_lifetime_static_from_zero_object():
    assert _serialize_dict_lifetime(DictionaryLifetime(min=0, max=0)) == {
        "type": "STATIC"
    }


def test_lifetime_single_from_int():
    assert _serialize_dict_lifetime(3600) == {"type": "SINGLE", "seconds": 3600}


def test_lifetime_single_from_equal_min_max():
    assert _serialize_dict_lifetime(DictionaryLifetime(min=300, max=300)) == {
        "type": "SINGLE",
        "seconds": 300,
    }


def test_lifetime_range():
    assert _serialize_dict_lifetime(DictionaryLifetime(min=60, max=300)) == {
        "type": "RANGE",
        "min": 60,
        "max": 300,
    }


def test_lifetime_bounds_validation_min_greater_than_max():
    with pytest.raises(ValueError, match="0 <= min <= max"):
        DictionaryLifetime(min=300, max=60)


def test_lifetime_bounds_validation_negative_min():
    with pytest.raises(ValueError, match="0 <= min <= max"):
        DictionaryLifetime(min=-1, max=60)


def test_lifetime_bounds_validation_negative_max():
    with pytest.raises(ValueError, match="0 <= min <= max"):
        DictionaryLifetime(min=0, max=-1)


def test_lifetime_int_negative_raises():
    table = OlapTable[Lookup](name="tbl_lt_neg")
    with pytest.raises(ValueError, match="non-negative"):
        OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            lifetime=-5,
        )


# ─── Source serialization ─────────────────────────────────────────────────────


def test_source_table_serialization():
    table = OlapTable[Lookup](name="tbl_src_ser")
    config = OlapDictionaryConfig(
        source_table=table,
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    src = _serialize_dict_source(config)
    assert src["type"] == "TABLE"
    assert src["table"] == "tbl_src_ser"
    assert src.get("database") is None


def test_source_table_with_database():
    table = OlapTable[Lookup](
        name="tbl_with_db", config=OlapConfig(database="analytics")
    )
    config = OlapDictionaryConfig(
        source_table=table,
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    src = _serialize_dict_source(config)
    assert src["type"] == "TABLE"
    assert src["database"] == "analytics"


def test_source_query_serialization():
    config = OlapDictionaryConfig(
        source_query="SELECT a, b FROM t",
        source_tables=[OlapTable[Lookup](name="tbl_sq")],
        primary_key=["a"],
        layout=HashedLayout(),
    )
    src = _serialize_dict_source(config)
    assert src["type"] == "QUERY"
    assert src["query"] == "SELECT a, b FROM t"


def test_serialize_table_source_with_invalidate_query():
    table = OlapTable[Lookup](name="tbl_inv_ser")
    config = OlapDictionaryConfig(
        source_table=table,
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    result = _serialize_dict_source(config, invalidate_query="SELECT max(ts) FROM tbl")
    assert result["type"] == "TABLE"
    assert result["invalidateQuery"] == "SELECT max(ts) FROM tbl"
    assert "invalidate_query" not in result


def test_serialize_query_source_with_invalidate_query():
    config = OlapDictionaryConfig(
        source_query="SELECT a, b FROM t",
        source_tables=[OlapTable[Lookup](name="tbl_sq_inv")],
        primary_key=["a"],
        layout=HashedLayout(),
    )
    result = _serialize_dict_source(config, invalidate_query="SELECT max(ts) FROM tbl")
    assert result["type"] == "QUERY"
    assert result["invalidateQuery"] == "SELECT max(ts) FROM tbl"
    assert "invalidate_query" not in result


def test_serialize_table_source_without_invalidate_query_has_no_key():
    table = OlapTable[Lookup](name="tbl_no_inv_ser")
    config = OlapDictionaryConfig(
        source_table=table,
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    result = _serialize_dict_source(config)
    assert result["type"] == "TABLE"
    assert "invalidateQuery" not in result


def test_source_external_serialization():
    config = OlapDictionaryConfig(
        external_source=HttpSource(url="http://api.example.com", format="JSONEachRow"),
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    src = _serialize_dict_source(config)
    assert src["type"] == "EXTERNAL"
    assert src["externalSource"]["source_type"] == "HTTP"
    assert src["externalSource"]["url"] == "http://api.example.com"
    assert src["externalSource"]["format"] == "JSONEachRow"


def test_source_mongodb_serialization():
    config = OlapDictionaryConfig(
        external_source=MongoDbSource(
            host="mongo.example.com",
            user="user",
            password="pass",
            db="catalog",
            collection="products",
        ),
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    src = _serialize_dict_source(config)
    assert src["type"] == "EXTERNAL"
    assert src["externalSource"]["source_type"] == "MONGODB"
    assert src["externalSource"]["host"] == "mongo.example.com"
    assert src["externalSource"]["collection"] == "products"


def test_external_source_secrets_are_unwrapped():
    """SecretStr credentials must reach Rust as plain strings, not as '**********'.

    Regression test: Pydantic v2's model_dump() serializes SecretStr fields as the
    masked string '**********' in default (json) mode, so isinstance(v, SecretStr)
    is always False and get_secret_value() is never reached.  The fix is to use
    mode='python' so SecretStr objects are preserved through the dump.
    """
    config = OlapDictionaryConfig(
        external_source=MysqlSource(
            host="db.example.com",
            user="admin",
            password="supersecret",
            db="catalog",
            table="products",
        ),
        primary_key=["id"],
        layout=HashedLayout(),
    )
    src = _serialize_dict_source(config)
    assert src["type"] == "EXTERNAL"
    assert (
        src["externalSource"]["password"] == "supersecret"
    ), "SecretStr was not unwrapped — model_dump() likely masked it as '**********'"


# ─── Layout serialization ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("layout", "expected_type"),
    [
        (FlatLayout(), "FLAT"),
        (HashedLayout(), "HASHED"),
        (SparseHashedLayout(), "SPARSE_HASHED"),
        (HashedArrayLayout(), "HASHED_ARRAY"),
        (RangeHashedLayout(), "RANGE_HASHED"),
        (CacheLayout(size_in_cells=1000), "CACHE"),
        (SsdCacheLayout(path="/tmp/ssd"), "SSD_CACHE"),
        (DirectLayout(), "DIRECT"),
        (IpTrieLayout(), "IP_TRIE"),
        (ComplexKeyHashedLayout(), "COMPLEX_KEY_HASHED"),
        (ComplexKeySparseHashedLayout(), "COMPLEX_KEY_SPARSE_HASHED"),
        (ComplexKeyHashedArrayLayout(), "COMPLEX_KEY_HASHED_ARRAY"),
        (ComplexKeyCacheLayout(size_in_cells=500), "COMPLEX_KEY_CACHE"),
        (ComplexKeySsdCacheLayout(path="/tmp/ck_ssd"), "COMPLEX_KEY_SSD_CACHE"),
        (ComplexKeyDirectLayout(), "COMPLEX_KEY_DIRECT"),
    ],
)
def test_all_15_layout_types_serialize(layout, expected_type):
    dumped = layout.model_dump(exclude_none=True)
    assert dumped["type"] == expected_type


def test_hashed_layout_with_params():
    layout = HashedLayout(initial_array_size=512, max_load_factor=0.9)
    d = layout.model_dump(exclude_none=True)
    assert d.get("initial_array_size") == 512
    assert d.get("max_load_factor") == 0.9


def test_cache_layout_requires_size_in_cells():
    layout = CacheLayout(size_in_cells=10000)
    d = layout.model_dump(exclude_none=True)
    assert d.get("size_in_cells") == 10000


# ─── Column serialization ─────────────────────────────────────────────────────


def test_column_serialization_no_overrides():
    table = OlapTable[Lookup](name="tbl_col_no_ov")
    d = OlapDictionary[Lookup](
        name="dict_col_no_ov",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        ),
    )
    cols = _serialize_dict_columns(d._column_list, None)
    names = [c["name"] for c in cols]
    assert "lookup_id" in names
    assert "value" in names
    for c in cols:
        assert "typeString" in c


def test_column_serialization_with_overrides():
    table = OlapTable[Lookup](name="tbl_col_ov")
    d = OlapDictionary[Lookup](
        name="dict_col_ov",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            columns={"value": DictionaryColumn(default="'Unknown'", injective=True)},
        ),
    )
    cols = _serialize_dict_columns(d._column_list, d.config.columns)
    value_col = next(c for c in cols if c["name"] == "value")
    assert value_col.get("defaultValue") == "'Unknown'"
    assert value_col.get("isInjective") is True


# ─── to_infra_map serialization round-trip ───────────────────────────────────


def test_infra_map_includes_dictionary():
    table = OlapTable[Lookup](name="tbl_infra")
    OlapDictionary[Lookup](
        name="dict_infra",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            lifetime=DictionaryLifetime(min=60, max=300),
        ),
    )
    result = to_infra_map()
    assert "dict_infra" in result.get("olapDictionaries", {})
    d = result["olapDictionaries"]["dict_infra"]
    assert d["name"] == "dict_infra"
    assert d["primaryKey"] == ["lookup_id"]
    assert d["source"]["type"] == "TABLE"
    assert d["layout"]["type"] == "HASHED"
    assert d["lifetime"]["type"] == "RANGE"
    assert d["lifetime"]["min"] == 60
    assert d["lifetime"]["max"] == 300


def test_infra_map_camel_case_keys():
    table = OlapTable[Lookup](name="tbl_cc")
    OlapDictionary[Lookup](
        name="dict_cc",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            cluster="my_cluster",
        ),
    )
    result = to_infra_map()
    d = result["olapDictionaries"]["dict_cc"]
    assert "clusterName" in d
    assert d["clusterName"] == "my_cluster"
    assert "primaryKey" in d
    assert "lifeCycle" in d


def test_infra_map_empty_when_no_dictionaries():
    result = to_infra_map()
    # No dictionaries registered — must be present but empty
    assert result.get("olapDictionaries") == {}


# ─── External source types ────────────────────────────────────────────────────


def test_all_external_source_types_have_type_field():
    sources = [
        HttpSource(url="http://x.com", format="CSV"),
        ClickHouseRemoteSource(
            host="h", port=9000, user="u", password="p", db="d", table="t"
        ),
        MysqlSource(host="h", user="u", password="p", db="d", table="t"),
        PostgresqlSource(host="h", user="u", password="p", db="d", table="t"),
        RedisSource(host="h", storage_type="simple"),
        MongoDbSource(host="h", user="u", password="p", db="d", collection="c"),
        ExecutableSource(command="cmd", format="CSV"),
        S3Source(url="s3://bucket/file", format="CSV"),
    ]
    for src in sources:
        assert hasattr(src, "type"), f"{src.__class__.__name__} missing 'type'"
        d = src.model_dump(exclude_none=True)
        assert "type" in d


def test_external_source_discriminant_uses_source_type_key():
    """Regression: Rust's ExternalDictionarySource uses #[serde(tag = "source_type")].

    Python must emit {"source_type": "HTTP", ...} inside source dict — not {"type": "HTTP", ...}
    — so Rust can correctly deserialize the discriminated union variant.
    """
    config = OlapDictionaryConfig(
        external_source=HttpSource(url="http://api.example.com", format="JSONEachRow"),
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    result = _serialize_dict_source(config)
    inner = result["externalSource"]
    assert (
        "source_type" in inner
    ), f"Missing 'source_type' discriminant key — got: {list(inner.keys())}"
    assert inner["source_type"] == "HTTP"
    assert "type" not in inner, "Stale 'type' key must not appear in serialized output"


def test_all_external_source_types_emit_source_type_discriminant():
    """Regression: all 8 external source types must use 'source_type' as the discriminant key."""
    test_cases = [
        (HttpSource(url="http://x.com", format="CSV"), "HTTP"),
        (
            ClickHouseRemoteSource(
                host="h", port=9000, user="u", password="p", db="d", table="t"
            ),
            "CLICK_HOUSE",
        ),
        (MysqlSource(host="h", user="u", password="p", db="d", table="t"), "MYSQL"),
        (
            PostgresqlSource(host="h", user="u", password="p", db="d", table="t"),
            "POSTGRESQL",
        ),
        (RedisSource(host="h", storage_type="simple"), "REDIS"),
        (
            MongoDbSource(host="h", user="u", password="p", db="d", collection="c"),
            "MONGODB",
        ),
        (ExecutableSource(command="cmd", format="CSV"), "EXECUTABLE"),
        (S3Source(url="s3://bucket/file", format="CSV"), "S3"),
    ]
    for ext_src, expected_value in test_cases:
        config = OlapDictionaryConfig(
            external_source=ext_src,
            primary_key=["id"],
            layout=HashedLayout(),
        )
        result = _serialize_dict_source(config)
        inner = result["externalSource"]
        cls = ext_src.__class__.__name__
        assert (
            "source_type" in inner
        ), f"{cls}: missing 'source_type' key — got: {list(inner.keys())}"
        assert (
            inner["source_type"] == expected_value
        ), f"{cls}: expected source_type={expected_value!r}, got {inner.get('source_type')!r}"
        assert "type" not in inner, f"{cls}: stale 'type' key still present"


# ─── Integration: dmv2_serializer subprocess round-trip ──────────────────────
#
# These tests verify that moose_lib.dmv2_serializer (the same entry point the
# Rust CLI calls) can import a real user Python file, build the infra map, and
# produce JSON that correctly represents an OlapDictionary.  The subprocess
# approach mirrors exactly what `moose build` does in production.


def _run_serializer(app_dir: str, moose_lib_root: str) -> dict[str, Any]:
    """Run `python -m moose_lib.dmv2_serializer` and return the parsed infra map."""
    env = {
        **os.environ,
        "PYTHONPATH": f"{moose_lib_root}{os.pathsep}{app_dir}",
        "MOOSE_SOURCE_DIR": "app",
        "IS_LOADING_INFRA_MAP": "true",
    }
    result = subprocess.run(
        [sys.executable, "-u", "-m", "moose_lib.dmv2_serializer"],
        capture_output=True,
        text=True,
        env=env,
        cwd=app_dir,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, (
        f"dmv2_serializer exited with code {result.returncode}.\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )
    marker = "___MOOSE_STUFF___start"
    end_marker = "end___MOOSE_STUFF___"
    assert (
        marker in result.stdout
    ), f"Output marker not found in stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    after_start = result.stdout.split(marker, 1)[1]
    assert end_marker in after_start, (
        f"End marker '{end_marker}' not found after start marker.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    json_str = after_start.split(end_marker, 1)[0].strip()
    return json.loads(json_str)


def _moose_lib_root() -> str:
    """Return the directory that contains the moose_lib package."""
    import moose_lib

    return str(os.path.dirname(os.path.dirname(moose_lib.__file__)))


def test_serializer_parses_olap_dictionary_with_source_table():
    """A Python file that defines an OlapDictionary backed by an OlapTable
    must round-trip through dmv2_serializer with all key fields intact."""
    main_py = textwrap.dedent(
        """\
        from pydantic import BaseModel
        from moose_lib import OlapTable, OlapDictionary, OlapDictionaryConfig
        from moose_lib.dmv2.olap_dictionary import HashedLayout, DictionaryLifetime

        class Product(BaseModel):
            product_id: str
            product_name: str
            price_level: int

        products_table = OlapTable[Product](name="products")

        dict_products = OlapDictionary[Product](
            name="dict_products",
            config=OlapDictionaryConfig(
                source_table=products_table,
                primary_key=["product_id"],
                layout=HashedLayout(),
                lifetime=DictionaryLifetime(min=60, max=300),
            ),
        )
    """
    )

    with tempfile.TemporaryDirectory() as tmp:
        app_pkg = os.path.join(tmp, "app")
        os.makedirs(app_pkg)
        with open(os.path.join(app_pkg, "__init__.py"), "w"):
            pass
        with open(os.path.join(app_pkg, "main.py"), "w") as f:
            f.write(main_py)

        infra_map = _run_serializer(tmp, _moose_lib_root())

    dicts = infra_map.get("olapDictionaries", {})
    assert "dict_products" in dicts, f"Expected dict_products in {list(dicts.keys())}"

    d = dicts["dict_products"]
    assert d["name"] == "dict_products"
    assert d["primaryKey"] == ["product_id"]
    assert d["source"]["type"] == "TABLE"
    assert d["source"]["table"] == "products"
    assert d["layout"]["type"] == "HASHED"
    assert d["lifetime"]["type"] == "RANGE"
    assert d["lifetime"]["min"] == 60
    assert d["lifetime"]["max"] == 300
    # metadata.source must be {"file": "..."}, not a bare string —
    # Rust's SourceLocation struct requires this shape.
    meta_source = d.get("metadata", {}).get("source")
    assert isinstance(
        meta_source, dict
    ), f'metadata.source must be a dict ({{"file": "..."}}), got: {meta_source!r}'
    assert "file" in meta_source, f"metadata.source missing 'file' key: {meta_source}"


def test_serializer_parses_olap_dictionary_with_source_query():
    """An OlapDictionary that uses source_query instead of source_table
    must be recognised and serialised correctly."""
    main_py = textwrap.dedent(
        """\
        from pydantic import BaseModel
        from moose_lib import OlapTable, OlapDictionary, OlapDictionaryConfig
        from moose_lib.dmv2.olap_dictionary import HashedLayout

        class Region(BaseModel):
            region_id: str
            region_name: str

        regions_table = OlapTable[Region](name="regions")

        dict_regions = OlapDictionary[Region](
            name="dict_regions",
            config=OlapDictionaryConfig(
                source_query="SELECT region_id, region_name FROM regions",
                source_tables=[regions_table],
                primary_key=["region_id"],
                layout=HashedLayout(),
            ),
        )
    """
    )

    with tempfile.TemporaryDirectory() as tmp:
        app_pkg = os.path.join(tmp, "app")
        os.makedirs(app_pkg)
        with open(os.path.join(app_pkg, "__init__.py"), "w"):
            pass
        with open(os.path.join(app_pkg, "main.py"), "w") as f:
            f.write(main_py)

        infra_map = _run_serializer(tmp, _moose_lib_root())

    dicts = infra_map.get("olapDictionaries", {})
    assert "dict_regions" in dicts, f"Expected dict_regions in {list(dicts.keys())}"

    d = dicts["dict_regions"]
    assert d["source"]["type"] == "QUERY"
    assert d["source"]["query"] == "SELECT region_id, region_name FROM regions"


def test_serializer_syntax_error_in_user_file_fails_gracefully():
    """A user file with a syntax error must cause dmv2_serializer to exit
    non-zero; the error should appear in stderr and not produce a truncated
    infra map that silently omits resources."""
    bad_main_py = textwrap.dedent(
        """\
        from moose_lib import OlapTable
        this is not valid python !!!
    """
    )

    with tempfile.TemporaryDirectory() as tmp:
        app_pkg = os.path.join(tmp, "app")
        os.makedirs(app_pkg)
        with open(os.path.join(app_pkg, "__init__.py"), "w"):
            pass
        with open(os.path.join(app_pkg, "main.py"), "w") as f:
            f.write(bad_main_py)

        env = {
            **os.environ,
            "PYTHONPATH": f"{_moose_lib_root()}{os.pathsep}{tmp}",
            "MOOSE_SOURCE_DIR": "app",
            "IS_LOADING_INFRA_MAP": "true",
        }
        result = subprocess.run(
            [sys.executable, "-u", "-m", "moose_lib.dmv2_serializer"],
            capture_output=True,
            text=True,
            env=env,
            cwd=tmp,
            check=False,
            timeout=30,
        )

    assert result.returncode != 0, (
        "Expected non-zero exit for a file with a syntax error, "
        f"but got returncode={result.returncode}"
    )
    assert "SyntaxError" in result.stderr or "SyntaxError" in result.stdout


# ─── A. Bug regression: external source camelCase ────────────────────────────


@pytest.mark.parametrize(
    ("source", "snake_key", "camel_key"),
    [
        (
            HttpSource(url="http://x.com", format="CSV", where_clause="id > 0"),
            "where_clause",
            "whereClause",
        ),
        (
            ClickHouseRemoteSource(
                host="h",
                port=9000,
                user="u",
                password="p",
                db="d",
                table="t",
                where_clause="x > 1",
                invalidate_query="SELECT max(ts) FROM t",
            ),
            "where_clause",
            "whereClause",
        ),
        (
            ClickHouseRemoteSource(
                host="h",
                port=9000,
                user="u",
                password="p",
                db="d",
                table="t",
                invalidate_query="SELECT max(ts) FROM t",
            ),
            "invalidate_query",
            "invalidateQuery",
        ),
        (
            MysqlSource(
                host="h",
                user="u",
                password="p",
                db="d",
                table="t",
                where_clause="a=1",
            ),
            "where_clause",
            "whereClause",
        ),
        (
            PostgresqlSource(
                host="h",
                user="u",
                password="p",
                db="d",
                table="t",
                invalidate_query="SELECT 1",
            ),
            "invalidate_query",
            "invalidateQuery",
        ),
        (
            RedisSource(host="h", storage_type="hash_map"),
            "storage_type",
            "storageType",
        ),
        (
            RedisSource(host="h", storage_type="simple", db_index=2),
            "db_index",
            "dbIndex",
        ),
        (
            ExecutableSource(command="/bin/cat", format="CSV", implicit_key=True),
            "implicit_key",
            "implicitKey",
        ),
        (
            S3Source(url="s3://b/f", format="CSV", access_key_id="AK"),
            "access_key_id",
            "accessKeyId",
        ),
        (
            S3Source(url="s3://b/f", format="CSV", secret_access_key="SK"),
            "secret_access_key",
            "secretAccessKey",
        ),
    ],
)
def test_external_source_fields_are_camelcase(source, snake_key, camel_key):
    """Multi-word external source fields must serialize to camelCase so Rust can
    deserialize them (all Rust external source structs use rename_all = "camelCase")."""
    config = OlapDictionaryConfig(
        external_source=source,
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    src = _serialize_dict_source(config)
    inner = src["externalSource"]
    assert camel_key in inner, (
        f"Expected camelCase key '{camel_key}' in serialized source, "
        f"got keys: {list(inner.keys())}"
    )
    assert (
        snake_key not in inner
    ), f"snake_case key '{snake_key}' must not appear in serialized source"


# ─── A. Bug regression: ComplexKeyRangeHashedLayout removed ──────────────────


def test_complex_key_range_hashed_layout_not_exported():
    """ComplexKeyRangeHashedLayout has no Rust counterpart and must be removed."""
    import moose_lib.dmv2.olap_dictionary as mod

    assert not hasattr(
        mod, "ComplexKeyRangeHashedLayout"
    ), "ComplexKeyRangeHashedLayout still exists but Rust has no matching variant"


# ─── A. Bug regression: settings int values → strings ────────────────────────


def test_settings_integer_values_serialized_as_strings():
    """Rust's HashMap<String, String> cannot hold int values; they must be
    coerced to strings during serialization."""
    table = OlapTable[Lookup](name="tbl_settings_int")
    OlapDictionary[Lookup](
        name="dict_settings_int",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            settings={"max_threads": 4, "timeout": 30, "label": "ok"},
        ),
    )
    result = to_infra_map()
    d = result["olapDictionaries"]["dict_settings_int"]
    settings = d["settings"]
    assert settings["max_threads"] == "4", "int value must be coerced to string"
    assert settings["timeout"] == "30"
    assert settings["label"] == "ok"
    for v in settings.values():
        assert isinstance(v, str), f"All settings values must be str, got {type(v)}"


# ─── B. External source serialization — all 8 sources ────────────────────────


def test_serialize_clickhouse_remote_source():
    src = ClickHouseRemoteSource(
        host="ch.host",
        port=9000,
        user="user",
        password="pass",
        db="mydb",
        table="mytable",
        query="SELECT 1",
        where_clause="id > 0",
        invalidate_query="SELECT max(ts) FROM mytable",
    )
    config = OlapDictionaryConfig(
        external_source=src, primary_key=["id"], layout=HashedLayout()
    )
    result = _serialize_dict_source(config)
    inner = result["externalSource"]
    assert result["type"] == "EXTERNAL"
    assert inner["source_type"] == "CLICK_HOUSE"
    assert inner["host"] == "ch.host"
    assert inner["whereClause"] == "id > 0"
    assert inner["invalidateQuery"] == "SELECT max(ts) FROM mytable"
    assert "where_clause" not in inner
    assert "invalidate_query" not in inner


def test_serialize_mysql_source():
    src = MysqlSource(
        host="mysql.host",
        user="u",
        password="p",
        db="d",
        table="t",
        where_clause="active=1",
        invalidate_query="SELECT max(updated_at) FROM t",
    )
    config = OlapDictionaryConfig(
        external_source=src, primary_key=["id"], layout=HashedLayout()
    )
    result = _serialize_dict_source(config)
    inner = result["externalSource"]
    assert inner["source_type"] == "MYSQL"
    assert inner["whereClause"] == "active=1"
    assert inner["invalidateQuery"] == "SELECT max(updated_at) FROM t"


def test_serialize_postgresql_source():
    src = PostgresqlSource(
        host="pg.host",
        user="u",
        password="p",
        db="d",
        table="t",
        where_clause="status='active'",
        invalidate_query="SELECT max(rev) FROM t",
    )
    config = OlapDictionaryConfig(
        external_source=src, primary_key=["id"], layout=HashedLayout()
    )
    result = _serialize_dict_source(config)
    inner = result["externalSource"]
    assert inner["source_type"] == "POSTGRESQL"
    assert inner["whereClause"] == "status='active'"
    assert inner["invalidateQuery"] == "SELECT max(rev) FROM t"


def test_serialize_redis_source():
    src = RedisSource(host="redis.host", storage_type="hash_map", db_index=3)
    config = OlapDictionaryConfig(
        external_source=src, primary_key=["id"], layout=HashedLayout()
    )
    result = _serialize_dict_source(config)
    inner = result["externalSource"]
    assert inner["source_type"] == "REDIS"
    assert inner["storageType"] == "hash_map"
    assert inner["dbIndex"] == 3
    assert "storage_type" not in inner
    assert "db_index" not in inner


def test_serialize_executable_source():
    src = ExecutableSource(
        command="/usr/bin/cat data.csv", format="CSV", implicit_key=True
    )
    config = OlapDictionaryConfig(
        external_source=src, primary_key=["id"], layout=HashedLayout()
    )
    result = _serialize_dict_source(config)
    inner = result["externalSource"]
    assert inner["source_type"] == "EXECUTABLE"
    assert inner["implicitKey"] is True
    assert "implicit_key" not in inner


def test_serialize_s3_source():
    src = S3Source(
        url="s3://bucket/data.csv",
        format="CSV",
        access_key_id="AKIAIOSFODNN7",
        secret_access_key="wJalrXUtnFEMI",
    )
    config = OlapDictionaryConfig(
        external_source=src, primary_key=["id"], layout=HashedLayout()
    )
    result = _serialize_dict_source(config)
    inner = result["externalSource"]
    assert inner["source_type"] == "S3"
    assert inner["accessKeyId"] == "AKIAIOSFODNN7"
    assert inner["secretAccessKey"] == "wJalrXUtnFEMI"
    assert "access_key_id" not in inner
    assert "secret_access_key" not in inner


# ─── C. Layout params through to_infra_map ───────────────────────────────────


def test_infra_map_cache_layout_params():
    table = OlapTable[Lookup](name="tbl_cache_params")
    OlapDictionary[Lookup](
        name="dict_cache_params",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=CacheLayout(size_in_cells=50000, max_threads_for_updates=2),
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_cache_params"]
    assert d["layout"]["size_in_cells"] == 50000
    assert d["layout"]["max_threads_for_updates"] == 2


def test_infra_map_ssd_cache_layout_params():
    table = OlapTable[Lookup](name="tbl_ssd_params")
    OlapDictionary[Lookup](
        name="dict_ssd_params",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=SsdCacheLayout(
                path="/mnt/ssd/dict", block_size=4096, file_size=1048576
            ),
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_ssd_params"]
    assert d["layout"]["path"] == "/mnt/ssd/dict"
    assert d["layout"]["block_size"] == 4096
    assert d["layout"]["file_size"] == 1048576


def test_infra_map_range_hashed_layout_params():
    table = OlapTable[Lookup](name="tbl_range_params")
    OlapDictionary[Lookup](
        name="dict_range_params",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=RangeHashedLayout(range_lookup_strategy="min"),
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_range_params"]
    assert d["layout"]["range_lookup_strategy"] == "min"


def test_infra_map_hashed_array_layout_params():
    table = OlapTable[Lookup](name="tbl_harray_params")
    OlapDictionary[Lookup](
        name="dict_harray_params",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedArrayLayout(shards=8),
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_harray_params"]
    assert d["layout"]["shards"] == 8


def test_infra_map_ip_trie_layout_params():
    table = OlapTable[Lookup](name="tbl_ip_params")
    OlapDictionary[Lookup](
        name="dict_ip_params",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=IpTrieLayout(access_to_key_from_attributes=True),
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_ip_params"]
    assert d["layout"]["access_to_key_from_attributes"] is True


@pytest.mark.parametrize(
    ("layout", "param_key", "param_val"),
    [
        (
            ComplexKeyHashedLayout(initial_array_size=1024, max_load_factor=0.8),
            "initial_array_size",
            1024,
        ),
        (
            ComplexKeySparseHashedLayout(initial_array_size=256),
            "initial_array_size",
            256,
        ),
        (ComplexKeyHashedArrayLayout(shards=4), "shards", 4),
        (
            ComplexKeyCacheLayout(size_in_cells=2000, max_threads_for_updates=1),
            "size_in_cells",
            2000,
        ),
        (ComplexKeySsdCacheLayout(path="/tmp/ck", block_size=8192), "block_size", 8192),
    ],
)
def test_infra_map_complex_key_layout_params(layout, param_key, param_val):
    table = OlapTable[Lookup](name=f"tbl_ck_{layout.type.lower()}")
    OlapDictionary[Lookup](
        name=f"dict_ck_{layout.type.lower()}",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id", "value"],
            layout=layout,
        ),
    )
    d = to_infra_map()["olapDictionaries"][f"dict_ck_{layout.type.lower()}"]
    assert d["layout"][param_key] == param_val


# ─── D. Remaining untested fields through to_infra_map ───────────────────────


def test_infra_map_invalidate_query():
    table = OlapTable[Lookup](name="tbl_inv")
    OlapDictionary[Lookup](
        name="dict_inv",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            invalidate=DictionaryInvalidation(column="updated_at", fn="max"),
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_inv"]
    iq = d.get("invalidateQuery")
    assert iq is not None, "invalidateQuery must be set when invalidate is configured"
    assert "max" in iq
    assert "updated_at" in iq
    assert "tbl_inv" in iq
    # invalidateQuery must also appear inside the source dict so Rust emits
    # INVALIDATE_QUERY inside SOURCE(CLICKHOUSE(...))
    src_iq = d["source"].get("invalidateQuery")
    assert src_iq is not None, "invalidateQuery must be present inside source dict"
    assert "max" in src_iq
    assert "updated_at" in src_iq
    assert "tbl_inv" in src_iq


def test_infra_map_comment():
    table = OlapTable[Lookup](name="tbl_comment")
    OlapDictionary[Lookup](
        name="dict_comment",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            comment="Product lookup dict",
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_comment"]
    assert d["comment"] == "Product lookup dict"


def test_infra_map_settings():
    table = OlapTable[Lookup](name="tbl_cfg_settings")
    OlapDictionary[Lookup](
        name="dict_cfg_settings",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            settings={"max_threads": "2", "query_wait_timeout_milliseconds": "500"},
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_cfg_settings"]
    assert d["settings"]["max_threads"] == "2"
    assert d["settings"]["query_wait_timeout_milliseconds"] == "500"


def test_infra_map_database_field():
    table = OlapTable[Lookup](name="tbl_dbfield")
    OlapDictionary[Lookup](
        name="dict_dbfield",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            database="analytics",
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_dbfield"]
    assert d["database"] == "analytics"


def test_infra_map_life_cycle_deletion_protected():
    table = OlapTable[Lookup](name="tbl_dp")
    OlapDictionary[Lookup](
        name="dict_dp",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            life_cycle=LifeCycle.DELETION_PROTECTED,
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_dp"]
    assert d["lifeCycle"] == "DELETION_PROTECTED"


def test_column_expression_override():
    table = OlapTable[Lookup](name="tbl_expr")
    OlapDictionary[Lookup](
        name="dict_expr",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            columns={"value": DictionaryColumn(expression="upper(value)")},
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_expr"]
    value_col = next(c for c in d["columns"] if c["name"] == "value")
    assert value_col.get("expression") == "upper(value)"


def test_column_hierarchical_override():
    table = OlapTable[Lookup](name="tbl_hier")
    OlapDictionary[Lookup](
        name="dict_hier",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            columns={"value": DictionaryColumn(hierarchical=True)},
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_hier"]
    value_col = next(c for c in d["columns"] if c["name"] == "value")
    assert value_col.get("isHierarchical") is True


def test_column_is_object_id_override():
    table = OlapTable[Lookup](name="tbl_objid")
    OlapDictionary[Lookup](
        name="dict_objid",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id"],
            layout=HashedLayout(),
            columns={"value": DictionaryColumn(is_object_id=True)},
        ),
    )
    d = to_infra_map()["olapDictionaries"]["dict_objid"]
    value_col = next(c for c in d["columns"] if c["name"] == "value")
    assert value_col.get("isObjectId") is True


# ─── E. Integration (subprocess) — remaining gaps ────────────────────────────


def test_serializer_external_source_end_to_end():
    """A Python file using an external HttpSource must produce EXTERNAL/HTTP
    in the subprocess-serialized infra map."""
    main_py = textwrap.dedent(
        """\
        from pydantic import BaseModel
        from moose_lib import OlapDictionary, OlapDictionaryConfig
        from moose_lib.dmv2.olap_dictionary import HashedLayout, HttpSource

        class Item(BaseModel):
            item_id: str
            label: str

        dict_items = OlapDictionary[Item](
            name="dict_items_ext",
            config=OlapDictionaryConfig(
                external_source=HttpSource(
                    url="http://api.example.com/items",
                    format="JSONEachRow",
                    where_clause="active=1",
                ),
                primary_key=["item_id"],
                layout=HashedLayout(),
            ),
        )
    """
    )
    with tempfile.TemporaryDirectory() as tmp:
        app_pkg = os.path.join(tmp, "app")
        os.makedirs(app_pkg)
        with open(os.path.join(app_pkg, "__init__.py"), "w"):
            pass
        with open(os.path.join(app_pkg, "main.py"), "w") as f:
            f.write(main_py)
        infra_map = _run_serializer(tmp, _moose_lib_root())

    dicts = infra_map.get("olapDictionaries", {})
    assert "dict_items_ext" in dicts
    src = dicts["dict_items_ext"]["source"]
    assert src["type"] == "EXTERNAL"
    assert src["externalSource"]["source_type"] == "HTTP"
    assert src["externalSource"]["url"] == "http://api.example.com/items"
    # camelCase must be used, not snake_case
    assert "whereClause" in src["externalSource"]
    assert "where_clause" not in src["externalSource"]


def test_serializer_layout_with_params():
    """CacheLayout params must survive the full subprocess round-trip."""
    main_py = textwrap.dedent(
        """\
        from pydantic import BaseModel
        from moose_lib import OlapTable, OlapDictionary, OlapDictionaryConfig
        from moose_lib.dmv2.olap_dictionary import CacheLayout

        class Item(BaseModel):
            item_id: str
            label: str

        t = OlapTable[Item](name="items_cache")
        d = OlapDictionary[Item](
            name="dict_items_cache",
            config=OlapDictionaryConfig(
                source_table=t,
                primary_key=["item_id"],
                layout=CacheLayout(size_in_cells=10000, max_threads_for_updates=4),
            ),
        )
    """
    )
    with tempfile.TemporaryDirectory() as tmp:
        app_pkg = os.path.join(tmp, "app")
        os.makedirs(app_pkg)
        with open(os.path.join(app_pkg, "__init__.py"), "w"):
            pass
        with open(os.path.join(app_pkg, "main.py"), "w") as f:
            f.write(main_py)
        infra_map = _run_serializer(tmp, _moose_lib_root())

    d = infra_map["olapDictionaries"]["dict_items_cache"]
    assert d["layout"]["type"] == "CACHE"
    assert d["layout"]["size_in_cells"] == 10000
    assert d["layout"]["max_threads_for_updates"] == 4


def test_serializer_all_optional_fields():
    """invalidate, comment, settings, database, cluster all round-trip correctly."""
    main_py = textwrap.dedent(
        """\
        from pydantic import BaseModel
        from moose_lib import OlapTable, OlapDictionary, OlapDictionaryConfig
        from moose_lib.dmv2.olap_dictionary import HashedLayout, DictionaryInvalidation

        class Item(BaseModel):
            item_id: str
            label: str

        t = OlapTable[Item](name="items_optional")
        d = OlapDictionary[Item](
            name="dict_items_optional",
            config=OlapDictionaryConfig(
                source_table=t,
                primary_key=["item_id"],
                layout=HashedLayout(),
                comment="Test dictionary",
                database="mydb",
                cluster="my_cluster",
                settings={"max_threads": 2},
                invalidate=DictionaryInvalidation(column="updated_at", fn="max"),
            ),
        )
    """
    )
    with tempfile.TemporaryDirectory() as tmp:
        app_pkg = os.path.join(tmp, "app")
        os.makedirs(app_pkg)
        with open(os.path.join(app_pkg, "__init__.py"), "w"):
            pass
        with open(os.path.join(app_pkg, "main.py"), "w") as f:
            f.write(main_py)
        infra_map = _run_serializer(tmp, _moose_lib_root())

    d = infra_map["olapDictionaries"]["dict_items_optional"]
    assert d["comment"] == "Test dictionary"
    assert d["database"] == "mydb"
    assert d["clusterName"] == "my_cluster"
    assert d["settings"]["max_threads"] == "2"
    iq = d.get("invalidateQuery")
    assert iq is not None, "invalidateQuery must be set"
    assert "max" in iq, f"expected 'max' in invalidateQuery, got: {iq}"
    assert "updated_at" in iq, f"expected 'updated_at' in invalidateQuery, got: {iq}"


def test_serializer_top_level_keys_are_camelcase():
    """Top-level dictionary JSON keys must use camelCase (no snake_case keys)
    so Rust's #[serde(rename_all = \"camelCase\")] on OlapDictionary can parse them."""
    main_py = textwrap.dedent(
        """\
        from pydantic import BaseModel
        from moose_lib import OlapTable, OlapDictionary, OlapDictionaryConfig
        from moose_lib.dmv2.olap_dictionary import HashedLayout
        from moose_lib.dmv2.life_cycle import LifeCycle

        class Item(BaseModel):
            item_id: str
            label: str

        t = OlapTable[Item](name="items_cc")
        d = OlapDictionary[Item](
            name="dict_items_cc",
            config=OlapDictionaryConfig(
                source_table=t,
                primary_key=["item_id"],
                layout=HashedLayout(),
                cluster="cl",
                life_cycle=LifeCycle.DELETION_PROTECTED,
            ),
        )
    """
    )
    with tempfile.TemporaryDirectory() as tmp:
        app_pkg = os.path.join(tmp, "app")
        os.makedirs(app_pkg)
        with open(os.path.join(app_pkg, "__init__.py"), "w"):
            pass
        with open(os.path.join(app_pkg, "main.py"), "w") as f:
            f.write(main_py)
        infra_map = _run_serializer(tmp, _moose_lib_root())

    d = infra_map["olapDictionaries"]["dict_items_cc"]
    # These snake_case keys must NOT appear at top level
    for bad_key in ("primary_key", "cluster_name", "life_cycle", "invalidate_query"):
        assert bad_key not in d, f"snake_case key '{bad_key}' must not appear in output"
    # These camelCase keys must be present
    assert "primaryKey" in d
    assert "clusterName" in d
    assert "lifeCycle" in d


# ─── F. Validation edge cases ────────────────────────────────────────────────


def test_blank_source_query_rejected():
    """An empty/whitespace-only source_query must be rejected at config instantiation."""
    table = OlapTable[Lookup](name="tbl_blank_query")
    with pytest.raises(ValidationError, match="blank"):
        OlapDictionaryConfig(
            source_query="   ",
            source_tables=[table],
            primary_key=["lookup_id"],
            layout=HashedLayout(),
        )


def test_empty_primary_key_rejected():
    """An empty primary_key list must be rejected at config instantiation."""
    table = OlapTable[Lookup](name="tbl_empty_pk")
    with pytest.raises(ValidationError, match="primary_key"):
        OlapDictionaryConfig(
            source_table=table,
            primary_key=[],
            layout=HashedLayout(),
        )


@pytest.mark.parametrize(
    "source_factory,field",
    [
        (
            lambda: HttpSource(url="http://x.com", format="CSV", where_clause=""),
            "where_clause",
        ),
        (
            lambda: ClickHouseRemoteSource(
                host="h",
                port=9000,
                user="u",
                password="p",
                db="d",
                table="t",
                query="",
            ),
            "query",
        ),
        (
            lambda: ClickHouseRemoteSource(
                host="h",
                port=9000,
                user="u",
                password="p",
                db="d",
                table="t",
                where_clause="   ",
            ),
            "where_clause",
        ),
        (
            lambda: MysqlSource(
                host="h",
                port=3306,
                user="u",
                password="p",
                db="d",
                table="t",
                invalidate_query="",
            ),
            "invalidate_query",
        ),
        (
            lambda: PostgresqlSource(
                host="h",
                port=5432,
                user="u",
                password="p",
                db="d",
                table="t",
                query="  ",
            ),
            "query",
        ),
    ],
)
def test_blank_external_source_fields_rejected(source_factory, field):
    """Blank strings for query/where_clause/invalidate_query in external sources are rejected."""
    with pytest.raises(ValidationError, match="blank"):
        source_factory()


def test_complex_key_layout_accepts_single_column_key():
    """COMPLEX_KEY_* layouts allow a single-column string key (not just multi-column)."""
    table = OlapTable[Lookup](name="tbl_ck_single")
    # Should not raise — one string column is valid for COMPLEX_KEY_HASHED.
    config = OlapDictionaryConfig(
        source_table=table,
        primary_key=["lookup_id"],
        layout=ComplexKeyHashedLayout(),
    )
    assert config.primary_key == ["lookup_id"]


def test_invalidate_with_external_source_raises():
    """Setting invalidate on an external-source config must be rejected at construction time."""
    with pytest.raises(ValidationError, match="external_source"):
        OlapDictionaryConfig(
            external_source=HttpSource(url="http://x.com", format="CSV"),
            primary_key=["id"],
            layout=HashedLayout(),
            invalidate=DictionaryInvalidation(column="updated_at", fn="max"),
        )


def test_dictionary_column_comment_serialized():
    """DictionaryColumn.comment is passed through to the Rust wire format."""
    table = OlapTable[Lookup](name="tbl_col_comment")
    config = OlapDictionaryConfig(
        source_table=table,
        primary_key=["lookup_id"],
        layout=HashedLayout(),
        columns={"lookup_id": DictionaryColumn(comment="primary lookup key")},
    )
    d = OlapDictionary[Lookup](name="dict_col_comment", config=config)
    cols = _serialize_dict_columns(d._column_list, config.columns)
    pk_col = next(c for c in cols if c["name"] == "lookup_id")
    assert pk_col.get("comment") == "primary lookup key"
