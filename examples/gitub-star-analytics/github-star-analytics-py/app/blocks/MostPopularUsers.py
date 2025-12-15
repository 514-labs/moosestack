from moose_lib import (
    Blocks,
    TableCreateOptions,
    ClickHouseEngines,
    AggregationCreateOptions,
    create_aggregation,
    AggregationDropOptions,
    drop_aggregation,
)

TABLE_NAME = "MostPopularUsers"
MV_NAME = "MostPopularUsers_MV"

TABLE_OPTIONS = TableCreateOptions(
    name=TABLE_NAME,
    columns={
        "stargazer_login": "String",
        "total_projects": "AggregateFunction(count, Int64)",
        "total_repo_stars": "AggregateFunction(sum, Int64)",
        "avg_repo_stars": "AggregateFunction(avg, Int64)",
        "total_repo_watchers": "AggregateFunction(sum, Int64)",
        "avg_repo_watchers": "AggregateFunction(avg, Int64)",
    },
    engine=ClickHouseEngines.AggregatingMergeTree,
    order_by="stargazer_login",
)

SQL = f"""
SELECT
    stargazer_login,
    countState(*) AS total_projects,
    sumState(repo_stars) AS total_repo_stars,
    avgState(repo_stars) AS avg_repo_stars,
    sumState(repo_watchers) AS total_repo_watchers,
    avgState(repo_watchers) AS avg_repo_watchers
FROM StargazerProjectsDeduped
GROUP BY
    stargazer_login
"""


setup_queries = create_aggregation(
    AggregationCreateOptions(
        materialized_view_name=MV_NAME,
        select=SQL,
        table_create_options=TABLE_OPTIONS,
    )
)

teardown_queries = drop_aggregation(
    AggregationDropOptions(view_name=MV_NAME, table_name=TABLE_NAME)
)
block = Blocks(setup=setup_queries, teardown=teardown_queries)
