from moose_lib import Blocks


VIEW_NAME = "StargazerProjectsDeduped"
# Drop view query
DROP_DEDUPED_STARGAZER_PROJECT_INFO_VIEW = f"""
DROP VIEW IF EXISTS {VIEW_NAME}
"""

# Create view query
CREATE_DEDUPED_STARGAZER_PROJECT_INFO_VIEW = f"""
CREATE VIEW IF NOT EXISTS {VIEW_NAME} AS
SELECT
    repo_name,
    argMax(repo_full_name, starred_at) as repo_full_name,
    argMax(description, starred_at) as description,
    argMax(repo_url, starred_at) as repo_url,
    argMax(language, starred_at) as language,
    argMax(repo_size_kb, starred_at) as repo_size_kb,
    argMax(created_at, starred_at) as created_at,
    argMax(updated_at, starred_at) as updated_at,
    argMax(stargazer_login, starred_at) as stargazer_login,
    argMax(repo_stars, starred_at) as repo_stars,
    argMax(repo_watchers, starred_at) as repo_watchers
FROM StargazerProjectInfo_0_0
GROUP BY repo_name
"""


DEDUPED_STARGAZER_PROJECT_INFO = Blocks(
    setup=[CREATE_DEDUPED_STARGAZER_PROJECT_INFO_VIEW],
    teardown=[DROP_DEDUPED_STARGAZER_PROJECT_INFO_VIEW],
)
