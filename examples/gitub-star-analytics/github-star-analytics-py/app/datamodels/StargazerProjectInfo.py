from moose_lib import Key, moose_data_model
from dataclasses import dataclass
from typing import Optional
from datetime import datetime


@moose_data_model
@dataclass
class StargazerProjectInfo:
    starred_at: datetime
    stargazer_login: Key[str]
    repo_name: str
    repo_full_name: str
    description: Optional[str]
    repo_url: str
    repo_stars: int
    repo_watchers: int
    language: str
    repo_size_kb: int
    created_at: datetime
    updated_at: datetime
