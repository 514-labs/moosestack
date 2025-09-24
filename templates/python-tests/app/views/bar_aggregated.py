# This block is used to aggregate the data from the Bar table into a materialized view
from moose_lib.dmv2 import MaterializedView, MaterializedViewOptions
from app.ingest.models import barModel
from pydantic import BaseModel

class BarAggregated(BaseModel):
    day_of_month: int
    total_rows: int
    rows_with_text: int
    total_text_length: int
    max_text_length: int

# The query to create the materialized view, which is executed when the block is set up
select_query = """
SELECT
  toDayOfMonth(utc_timestamp) as day_of_month,
  count(primary_key) as total_rows,
  countIf(has_text) as rows_with_text,
  sum(text_length) as total_text_length,
  max(text_length) as max_text_length
FROM Bar
GROUP BY toDayOfMonth(utc_timestamp)
"""

barAggregatedMV = MaterializedView[BarAggregated](MaterializedViewOptions(
    select_statement=select_query,
    select_tables=[barModel.table],
    table_name="bar_aggregated",
    materialized_view_name="bar_aggregated_mv",
    order_by_fields=["day_of_month"]
))

