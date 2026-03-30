from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel

from moose_lib import Key
from moose_lib.data_models import ClickHouseJson, JsonOptions, _to_columns


def test_dict_str_any_without_annotation():
    """Bare dict[str, Any] should produce a simple 'Json' string data type."""

    class Model(BaseModel):
        id: Key[str]
        data: dict[str, Any]

    columns = _to_columns(Model)
    by_name = {col.name: col for col in columns}

    assert by_name["data"].data_type == "Json"


def test_dict_str_any_with_empty_clickhouse_json():
    """Annotated[dict[str, Any], ClickHouseJson()] with no options should produce 'Json'."""

    class Model(BaseModel):
        id: Key[str]
        data: Annotated[dict[str, Any], ClickHouseJson()]

    columns = _to_columns(Model)
    by_name = {col.name: col for col in columns}

    assert by_name["data"].data_type == "Json"


def test_dict_str_any_with_clickhouse_json_max_dynamic_paths():
    """Annotated[dict[str, Any], ClickHouseJson(max_dynamic_paths=16)] should produce JsonOptions."""

    class Model(BaseModel):
        id: Key[str]
        data: Annotated[dict[str, Any], ClickHouseJson(max_dynamic_paths=16)]

    columns = _to_columns(Model)
    by_name = {col.name: col for col in columns}

    assert isinstance(by_name["data"].data_type, JsonOptions)
    assert by_name["data"].data_type.max_dynamic_paths == 16
    assert by_name["data"].data_type.typed_paths == []


def test_dict_str_any_with_all_clickhouse_json_options():
    """All ClickHouseJson options should be propagated for dict[str, Any]."""

    class Model(BaseModel):
        id: Key[str]
        data: Annotated[
            dict[str, Any],
            ClickHouseJson(
                max_dynamic_paths=256,
                max_dynamic_types=8,
                skip_paths=("skip.me",),
                skip_regexps=("^tmp\\.",),
            ),
        ]

    columns = _to_columns(Model)
    by_name = {col.name: col for col in columns}

    dt = by_name["data"].data_type
    assert isinstance(dt, JsonOptions)
    assert dt.max_dynamic_paths == 256
    assert dt.max_dynamic_types == 8
    assert dt.typed_paths == []
    assert dt.skip_paths == ["skip.me"]
    assert dt.skip_regexps == ["^tmp\\."]
