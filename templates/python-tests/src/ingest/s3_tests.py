"""
S3 table tests for runtime environment variable resolution

These tables test the moose_runtime_env.get() functionality with the S3 engine,
which allows direct read/write from S3 storage. Configuration is resolved at
runtime from environment variables rather than being embedded at build time.
"""

from moose_lib import Key, OlapTable, OlapConfig, S3Engine, moose_runtime_env
from pydantic import BaseModel
from datetime import datetime


class S3TestData(BaseModel):
    id: Key[str]
    timestamp: datetime
    data: str


# Test S3 engine with public bucket (no credentials needed)
# just omit credentials for NOSIGN
s3_public = OlapTable[S3TestData](
    "S3Public",
    OlapConfig(
        engine=S3Engine(
            path="s3://public-test-bucket/data/file.csv",
            format="CSV",
            compression="auto",
        ),
    ),
)

# Test S3 engine with parquet format
s3_parquet = OlapTable[S3TestData](
    "S3Parquet",
    OlapConfig(
        engine=S3Engine(
            path="s3://public-test-bucket/data/*.parquet",
            format="Parquet",
        ),
    ),
)

