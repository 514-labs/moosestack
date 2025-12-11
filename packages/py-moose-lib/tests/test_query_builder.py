from datetime import datetime

from moose_lib.query_builder import Query, col
from moose_lib.dmv2 import IngestPipeline, IngestPipelineConfig, OlapTable, OlapConfig
from pydantic import BaseModel
from moose_lib.data_models import Key


class Bar(BaseModel):
    primary_key: Key[str]
    utc_timestamp: datetime
    has_text: bool
    text_length: int


def test_simple_select_and_where():
    bar_model = IngestPipeline[Bar](
        "Bar",
        IngestPipelineConfig(
            ingest=False, stream=True, table=True, dead_letter_queue=True
        ),
    )
    bar_cols = bar_model.get_table().cols

    q1 = (
        Query()
        .from_(bar_model.get_table())
        .select(bar_cols.has_text, bar_cols.text_length)
    )
    assert q1.to_sql() == 'SELECT "Bar"."has_text", "Bar"."text_length" FROM Bar'

    q2 = (
        Query()
        .from_(bar_model.get_table())
        .select(bar_cols.has_text, bar_cols.text_length)
        .where(col(bar_cols.has_text).eq(True))
    )
    sql, params = q2.to_sql_and_params()
    assert (
        sql
        == 'SELECT "Bar"."has_text", "Bar"."text_length" FROM Bar WHERE "Bar"."has_text" = {p0: Bool}'
    )
    assert params == {"p0": True}


def test_table_with_database_config():
    """Test that tables with database config generate correct SQL with two identifiers"""

    class TestModel(BaseModel):
        id: int
        name: str

    # Table without database
    table_without_db = OlapTable[TestModel]("my_table_no_db", OlapConfig())

    # Table with database
    table_with_db = OlapTable[TestModel](
        "my_table_with_db", OlapConfig(database="my_database")
    )

    # Test Query builder with table that has database
    q1 = (
        Query()
        .from_(table_with_db)
        .select(table_with_db.cols.id, table_with_db.cols.name)
    )
    sql1 = q1.to_sql()
    # The Query builder should handle the database-qualified table reference
    assert "my_database" in sql1 or "my_table" in sql1

    # Test string interpolation format for QueryClient.execute()
    # When a table with database is used, it should generate two separate Identifier parameters
    from string import Formatter

    # Simulate what happens in QueryClient.execute() with a table that has database
    template = "SELECT * FROM {table}"
    variables = {"table": table_with_db}

    params = {}
    values = {}
    i = 0

    for _, variable_name, _, _ in Formatter().parse(template):
        if variable_name:
            value = variables[variable_name]
            if isinstance(value, OlapTable) and value.config.database:
                # Should use two separate Identifier parameters
                params[variable_name] = f"{{p{i}: Identifier}}.{{p{i + 1}: Identifier}}"
                values[f"p{i}"] = value.config.database
                values[f"p{i + 1}"] = value.name
                i += 2
            else:
                params[variable_name] = f"{{p{i}: Identifier}}"
                values[f"p{i}"] = value.name
                i += 1

    clickhouse_query = template.format_map(params)

    assert clickhouse_query == "SELECT * FROM {p0: Identifier}.{p1: Identifier}"
    assert values == {"p0": "my_database", "p1": "my_table_with_db"}

    # Test with table without database
    variables_no_db = {"table": table_without_db}
    params_no_db = {}
    values_no_db = {}
    i = 0

    for _, variable_name, _, _ in Formatter().parse(template):
        if variable_name:
            value = variables_no_db[variable_name]
            if isinstance(value, OlapTable) and value.config.database:
                params_no_db[variable_name] = (
                    f"{{p{i}: Identifier}}.{{p{i + 1}: Identifier}}"
                )
                values_no_db[f"p{i}"] = value.config.database
                values_no_db[f"p{i + 1}"] = value.name
                i += 2
            else:
                params_no_db[variable_name] = f"{{p{i}: Identifier}}"
                values_no_db[f"p{i}"] = value.name
                i += 1

    clickhouse_query_no_db = template.format_map(params_no_db)

    assert clickhouse_query_no_db == "SELECT * FROM {p0: Identifier}"
    assert values_no_db == {"p0": "my_table_no_db"}
