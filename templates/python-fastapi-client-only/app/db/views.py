# This block is used to aggregate the data from the Bar table into a materialized view
from moose_lib.dmv2 import MaterializedView, MaterializedViewOptions
from app.db.models import BarTable, BarAggregatedTable

# The query to create the materialized view, which is executed when the block is set up
select_query = f"""
SELECT
  toDayOfMonth({BarTable.columns.utc_timestamp}) as day_of_month,
  count({BarTable.columns.primary_key}) as total_rows,
  countIf({BarTable.columns.has_text}) as rows_with_text,
  sum({BarTable.columns.text_length}) as total_text_length,
  max({BarTable.columns.text_length}) as max_text_length
FROM {BarTable.name}
GROUP BY day_of_month
"""

BarAggregatedMV = MaterializedView[BarAggregatedTable.model_type](MaterializedViewOptions(
    select_statement=select_query,
    select_tables=[BarTable],
    materialized_view_name="mv_bar_to_bar_aggregated",
), target_table=BarAggregatedTable)

