# This block is used to aggregate the data from the Bar table into a materialized view
from moose_lib.dmv2 import MaterializedView, MaterializedViewOptions
from pydantic import BaseModel

# Import the Bar pipeline to get the table reference
from app.db.models import BarPipeline

# Define the aggregated model
class BarAggregated(BaseModel):
    day_of_month: int
    total_rows: int
    rows_with_text: int
    total_text_length: int
    max_text_length: int


# The query to create the materialized view
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

BarAggregatedMV = MaterializedView[BarAggregated](
    MaterializedViewOptions(
        select_statement=select_query,
        select_tables=[BarPipeline.table],
        table_name="BarAggregated",
        materialized_view_name="BarAggregated_MV",
        order_by_fields=["day_of_month"]
    )
)
