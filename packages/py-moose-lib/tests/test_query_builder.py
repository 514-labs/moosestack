from datetime import datetime

from moose_lib.query_builder import Query, col
from moose_lib.dmv2 import IngestPipeline, IngestPipelineConfig
from pydantic import BaseModel
from moose_lib.data_models import Key


class Bar(BaseModel):
    primary_key: Key[str]
    utc_timestamp: datetime
    has_text: bool
    text_length: int


def test_simple_select_and_where():
    bar_model = IngestPipeline[Bar]("Bar", IngestPipelineConfig(
        ingest=False,
        stream=True,
        table=True,
        dead_letter_queue=True
    ))
    bar_cols = bar_model.get_table().cols

    q1 = Query().from_(bar_model.get_table()).select(bar_cols.has_text, bar_cols.text_length)
    assert q1.to_sql() == 'SELECT "Bar"."has_text", "Bar"."text_length" FROM Bar'

    q2 = (
        Query()
        .from_(bar_model.get_table())
        .select(bar_cols.has_text, bar_cols.text_length)
        .where(col(bar_cols.has_text).eq(True))
    )
    sql, params = q2.to_sql_and_params()
    assert sql == 'SELECT "Bar"."has_text", "Bar"."text_length" FROM Bar WHERE "Bar"."has_text" = {p0: Bool}'
    assert params == {"p0": True}


