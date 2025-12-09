# This file is where you can define your SQL queries to shape and manipulate batches
# of data using Blocks. Blocks can also manage materialized views to store the results of
# your queries for improved performance. A materialized view is the recommended approach for aggregating
# data. For more information on the types of aggregate functions you can run on your existing data,
# consult the Clickhouse documentation: https://clickhouse.com/docs/en/sql-reference/aggregate-functions

from moose_lib import (
    AggregationCreateOptions,
    AggregationDropOptions,
    Blocks,
    ClickHouseEngines,
    TableCreateOptions,
    create_aggregation,
    drop_aggregation,
)


# Names for the materialized view and underlying table that will store aggregated language stats
MV_NAME = "TopLanguages_MV"
TABLE_NAME = "TopLanguages"

# Define the schema for the aggregation table
# - language: Programming language name
# - total_projects: Count of repos using this language (using ClickHouse's AggregateFunction)
# - total_repo_size_kb: Sum of repo sizes in KB for this language
# - avg_repo_size_kb: Average repo size in KB for this language
# Uses AggregatingMergeTree engine which is optimized for aggregation operations
TABLE_OPTIONS = TableCreateOptions(
    name=TABLE_NAME,
    columns={
        "language": "String",
        "total_projects": "AggregateFunction(count, Int64)",
        "total_repo_size_kb": "AggregateFunction(sum, Int64)",
        "avg_repo_size_kb": "AggregateFunction(avg, Int64)",
    },
    engine=ClickHouseEngines.AggregatingMergeTree,
    order_by="language",
)

# SQL query that powers the materialized view
# Aggregates data from StargazerProjectInfo_0_0 table by:
# - Grouping by programming language
# - Counting total projects per language
# - Summing total KB of code per language
# - Calculating average KB per repo per language
# Uses *State functions which store partial aggregation results
SQL = f"""
SELECT
    language,
    countState(*) AS total_projects,
    sumState(repo_size_kb) AS total_repo_size_kb,
    avgState(repo_size_kb) AS avg_repo_size_kb
FROM StargazerProjectInfo_0_0
GROUP BY language
"""

# Cleanup queries to remove the materialized view and table when needed
teardown_queries = drop_aggregation(
    AggregationDropOptions(view_name=MV_NAME, table_name=TABLE_NAME)
)

# Setup queries to create the materialized view and underlying table
# The view will automatically stay up-to-date as new data arrives
setup_queries = create_aggregation(
    AggregationCreateOptions(
        materialized_view_name=MV_NAME,
        select=SQL,
        table_create_options=TABLE_OPTIONS,
    )
)

# Create a Blocks instance with our setup and teardown queries
block = Blocks(teardown=teardown_queries, setup=setup_queries)
