"""Tests for OlapDictionary in moose_lib.dmv2.olap_dictionary."""

import pytest
from pydantic import BaseModel, ValidationError

from moose_lib.dmv2.olap_dictionary import (
    CacheLayout,
    ClickHouseRemoteSource,
    ComplexKeyCacheLayout,
    ComplexKeyDirectLayout,
    ComplexKeyHashedArrayLayout,
    ComplexKeyHashedLayout,
    ComplexKeyRangeHashedLayout,
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
    assert sql == "dictGet('local.dict_get', 'value', lookup_id)"


def test_get_composite_key_wraps_tuple():
    table = OlapTable[Lookup](name="tbl_ckg")
    d = OlapDictionary[Lookup](
        name="dict_ck_get",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id", "category"],
            layout=ComplexKeyHashedLayout(),
        ),
    )
    sql = d.get("value", "id1", "cat1")
    assert sql == "dictGet('local.dict_ck_get', 'value', tuple(id1, cat1))"


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
    assert sql == "dictGetOrDefault('local.dict_god', 'value', lookup_id, 'Unknown')"


def test_get_or_default_composite_key():
    table = OlapTable[Lookup](name="tbl_god_ck")
    d = OlapDictionary[Lookup](
        name="dict_god_ck",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id", "region"],
            layout=ComplexKeyHashedLayout(),
        ),
    )
    sql = d.get_or_default("value", "'N/A'", "id1", "r1")
    assert (
        sql == "dictGetOrDefault('local.dict_god_ck', 'value', tuple(id1, r1), 'N/A')"
    )


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
    assert sql == "dictHas('local.dict_has', lookup_id)"


def test_has_composite_key():
    table = OlapTable[Lookup](name="tbl_has_ck")
    d = OlapDictionary[Lookup](
        name="dict_has_ck",
        config=OlapDictionaryConfig(
            source_table=table,
            primary_key=["lookup_id", "region"],
            layout=ComplexKeyHashedLayout(),
        ),
    )
    sql = d.has("id1", "r1")
    assert sql == "dictHas('local.dict_has_ck', tuple(id1, r1))"


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


def test_source_external_serialization():
    config = OlapDictionaryConfig(
        external_source=HttpSource(url="http://api.example.com", format="JSONEachRow"),
        primary_key=["lookup_id"],
        layout=HashedLayout(),
    )
    src = _serialize_dict_source(config)
    assert src["type"] == "EXTERNAL"
    assert src["source"]["type"] == "HTTP"
    assert src["source"]["url"] == "http://api.example.com"
    assert src["source"]["format"] == "JSONEachRow"


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
    assert src["source"]["type"] == "MONGODB"
    assert src["source"]["host"] == "mongo.example.com"
    assert src["source"]["collection"] == "products"


# ─── Layout serialization ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "layout,expected_type",
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
        (ComplexKeyRangeHashedLayout(), "COMPLEX_KEY_RANGE_HASHED"),
        (ComplexKeyCacheLayout(size_in_cells=500), "COMPLEX_KEY_CACHE"),
        (ComplexKeySsdCacheLayout(path="/tmp/ck_ssd"), "COMPLEX_KEY_SSD_CACHE"),
        (ComplexKeyDirectLayout(), "COMPLEX_KEY_DIRECT"),
    ],
)
def test_all_16_layout_types_serialize(layout, expected_type):
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
