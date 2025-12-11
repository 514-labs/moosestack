from dataclasses import dataclass
from datetime import datetime
from moose_lib import Key, moose_data_model, DataModelConfig

# Configuration for batch loading stargazer data from JSON
# Specifies that the input will be in JSON array format
batch_load_config = DataModelConfig(ingestion=True)


@moose_data_model(batch_load_config)  # Apply the batch loading config to this model
@dataclass
class HistoricalStargazer:
    starred_at: datetime
    login: Key[str]  # login is marked as a key field for uniqueness
    avatar_url: str
    repos_url: str
