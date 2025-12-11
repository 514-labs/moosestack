# This file is where you can define your API templates for consuming your data
# All query_params are passed in as strings, and are used within the sql tag to parameterize you queries

from moose_lib import MooseClient
from dataclasses import dataclass


# Define the expected query parameters for this API endpoint
# rank_by: Determines how to sort the results, defaults to sorting by total number of projects
@dataclass
class QueryParams:
    rank_by: str = "total_projects"


def run(client: MooseClient, params: QueryParams):
    # Extract the rank_by parameter from the request
    rank_by = params.rank_by

    # Validate that rank_by is one of the allowed values
    # Can sort by:
    # - total_projects: Number of repos using each language
    # - total_repo_size_kb: Total KB of code in each language
    # - avg_repo_size_kb: Average KB per repo for each language
    if rank_by not in ["total_projects", "total_repo_size_kb", "avg_repo_size_kb"]:
        raise ValueError(
            "Invalid rank_by value. Must be one of: total_projects, total_repo_size_kb, avg_repo_size_kb"
        )

    # Build and execute query to get ranked programming languages
    # Uses aggregate functions to:
    # - countMerge: Get final count of projects per language
    # - sumMerge: Get total KB of code per language
    # - avgMerge: Get average KB per repo per language
    query = f"""
    SELECT 
        language, 
        countMerge(total_projects) AS total_projects, 
        sumMerge(total_repo_size_kb) AS total_repo_size_kb, 
        avgMerge(avg_repo_size_kb) AS avg_repo_size_kb 
    FROM 
        TopLanguages 
    GROUP BY 
        language 
    ORDER BY 
        {rank_by} DESC
    """
    # Execute the query, passing rank_by as a parameter for safety
    return client.query(query, {"rank_by": rank_by})
