# Import your Moose data models to use in the streaming function
from app.datamodels.HistoricalStargazer import HistoricalStargazer
from app.datamodels.StargazerProjectInfo import StargazerProjectInfo
from moose_lib import StreamingFunction, cli_log, CliLogData
from typing import Optional
from datetime import datetime
import requests


# Helper function to make GitHub API calls
# Takes a URL and returns the JSON response
# Raises an exception if the request fails
def call_github_api(url: str) -> dict:
    response = requests.get(url)
    response.raise_for_status()
    return response.json()


# Main processing function that takes a HistoricalStargazer event and returns StargazerProjectInfo objects
# Returns a list of StargazerProjectInfo objects, one for each repository owned by the stargazer
# Returns None if there's an error processing the event
def fn(source: HistoricalStargazer) -> Optional[list[StargazerProjectInfo]]:
    # Fetch all repositories for the user who starred the project
    repositories = call_github_api(source.repos_url)
    cli_log(
        CliLogData(
            action="Got repositories",
            message=f"{len(repositories)}",
            message_type="Info",
        )
    )

    # For each repository owned by the stargazer, create a StargazerProjectInfo object
    # This includes metadata about:
    # - When they starred our project
    # - Their GitHub username
    # - Repository details (name, description, URL)
    # - Repository stats (stars, watchers, language, size)
    # - Repository timestamps (created, updated)
    return [
        StargazerProjectInfo(
            starred_at=source.starred_at,
            stargazer_login=source.login,
            repo_name=repo["name"],
            repo_full_name=repo["full_name"],
            description=repo["description"],
            repo_url=repo["html_url"],
            repo_stars=repo["stargazers_count"],
            repo_watchers=repo["watchers_count"],
            language=repo["language"],
            repo_size_kb=repo["size"],
            created_at=repo["created_at"],
            updated_at=repo["updated_at"],
        )
        for repo in repositories
    ]


# Create a StreamingFunction that will execute our processing function
my_function = StreamingFunction(run=fn)
