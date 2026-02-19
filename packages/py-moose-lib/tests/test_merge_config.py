"""Tests for Merge engine validation and serialization."""

import pytest
from moose_lib import OlapTable, OlapConfig
from moose_lib.blocks import MergeEngine
from pydantic import BaseModel


class SampleEvent(BaseModel):
    event_id: str
    user_id: str
    timestamp: str


def test_merge_engine_rejects_empty_source_database():
    with pytest.raises(ValueError, match="Merge engine requires 'source_database'"):
        MergeEngine(source_database="", tables_regexp="^events_.*$")


def test_merge_engine_rejects_empty_tables_regexp():
    with pytest.raises(ValueError, match="Merge engine requires 'tables_regexp'"):
        MergeEngine(source_database="currentDatabase()", tables_regexp="")


@pytest.mark.parametrize(
    ("config_kwargs", "expected_error"),
    [
        ({"order_by_fields": ["event_id"]}, "MergeEngine does not support ORDER BY"),
        (
            {"partition_by": "toYYYYMM(timestamp)"},
            "MergeEngine does not support PARTITION BY",
        ),
        (
            {"sample_by_expression": "event_id"},
            "MergeEngine does not support SAMPLE BY",
        ),
    ],
)
def test_merge_engine_rejects_unsupported_clauses(config_kwargs, expected_error):
    with pytest.raises(ValueError, match=expected_error):
        OlapTable[SampleEvent](
            "merge_table",
            OlapConfig(
                engine=MergeEngine(
                    source_database="currentDatabase()",
                    tables_regexp="^events_.*$",
                ),
                **config_kwargs,
            ),
        )


def test_merge_engine_serialization():
    from moose_lib.internal import _convert_engine_instance_to_config_dict

    engine = MergeEngine(
        source_database="currentDatabase()",
        tables_regexp="^events_\\d+$",
    )
    config_dict = _convert_engine_instance_to_config_dict(engine)

    assert config_dict.engine == "Merge"
    assert config_dict.source_database == "currentDatabase()"
    assert config_dict.tables_regexp == "^events_\\d+$"


def test_merge_engine_ingest_pipeline_guard():
    from moose_lib.dmv2.ingest_pipeline import IngestPipeline, IngestPipelineConfig

    with pytest.raises(ValueError, match="Merge engine is read-only"):
        IngestPipeline[SampleEvent](
            "guarded_pipeline",
            IngestPipelineConfig(
                table=OlapConfig(
                    engine=MergeEngine(
                        source_database="currentDatabase()",
                        tables_regexp="^events_.*$",
                    ),
                ),
                stream=True,
                ingest_api=True,
            ),
        )
