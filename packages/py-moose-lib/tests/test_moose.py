import datetime
from dataclasses import dataclass
from typing import Optional
from pydantic import BaseModel

from moose_lib.query_param import (
    convert_pydantic_definition,
    QueryField,
    ArrayType,
    map_params_to_class,
    convert_dataclass_definition,
)


@dataclass
class QueryParamDataClass:
    optional_field: Optional[int]
    date_field: datetime.datetime
    list_field: list[str]
    int_field: int = 1


class QueryParamPydantic(BaseModel):
    optional_field: Optional[int]
    date_field: datetime.datetime
    list_field: list[str]
    int_field: int = 1


query_fields = [
    QueryField(
        name="optional_field",
        data_type="Int64",
        has_default=False,
        required=False,
    ),
    QueryField(
        name="date_field",
        data_type="DateTime",
        has_default=False,
        required=True,
    ),
    QueryField(
        name="list_field",
        data_type=ArrayType(
            element_type="String",
        ),
        has_default=False,
        required=True,
    ),
    QueryField(
        name="int_field",
        data_type="Int64",
        has_default=True,
        required=False,
    ),
]

datestr = "2024-02-12T17:37:56.78Z"
parsed_date = datetime.datetime.fromisoformat(datestr)


def test_pydantic():
    assert convert_pydantic_definition(QueryParamPydantic) == query_fields
    assert map_params_to_class(
        {"date_field": [datestr], "list_field": ["123"], "int_field": ["1"]},
        query_fields,
        QueryParamPydantic,
    ) == QueryParamPydantic(
        optional_field=None, date_field=parsed_date, list_field=["123"], int_field=1
    )


def test_dataclass():
    assert convert_dataclass_definition(QueryParamDataClass) == query_fields
    assert map_params_to_class(
        {"date_field": [datestr], "list_field": ["123"], "int_field": ["1"]},
        query_fields,
        QueryParamDataClass,
    ) == QueryParamDataClass(
        optional_field=None, date_field=parsed_date, list_field=["123"], int_field=1
    )
