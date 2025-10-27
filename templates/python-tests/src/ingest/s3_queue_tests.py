"""
S3Queue table tests for runtime environment variable resolution

These tables test the moose_runtime_env.get() functionality which allows
configuration to be resolved at runtime from environment variables rather
than being embedded at build time.
"""

from moose_lib import Key, OlapTable, OlapConfig, S3QueueEngine, moose_runtime_env
from pydantic import BaseModel
from datetime import datetime


class S3QueueTestData(BaseModel):
    id: Key[str]
    timestamp: datetime
    data: str


# Test S3Queue with runtime environment variable resolution using moose_runtime_env
# This table will only be created if the required environment variables are set
s3_queue_with_secrets = OlapTable[S3QueueTestData](
    "S3QueueWithSecrets",
    OlapConfig(
        engine=S3QueueEngine(
            s3_path="s3://test-bucket/data/*.json",
            format="JSONEachRow",
            # Credentials resolved at runtime from environment variables
            aws_access_key_id=moose_runtime_env.get("TEST_AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=moose_runtime_env.get("TEST_AWS_SECRET_ACCESS_KEY"),
        ),
        settings={
            "mode": "unordered",
            "keeper_path": "/clickhouse/s3queue/test_with_secrets",
        },
    ),
)

# Test S3Queue with public bucket (no credentials needed)
s3_queue_public = OlapTable[S3QueueTestData](
    "S3QueuePublic",
    OlapConfig(
        engine=S3QueueEngine(
            s3_path="s3://public-test-bucket/data/*.csv",
            format="CSV",
        ),
        settings={
            "mode": "ordered",
            "keeper_path": "/clickhouse/s3queue/test_public",
        },
    ),
)
