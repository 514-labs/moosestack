# ============================================================================
# Refreshable Materialized View E2E Tests
# ============================================================================
# Tests both incremental and refreshable materialized views to ensure the
# new refresh configuration API works correctly end-to-end.

from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel

from moose_lib.dmv2 import MaterializedView, MaterializedViewOptions
from moose_lib.dmv2.materialized_view import (
    RefreshableMaterializedView,
    RefreshableMaterializedViewOptions,
    RefreshConfig,
    RefreshIntervalEvery,
    RefreshIntervalAfter,
    Duration,
)
from src.ingest.models import barModel


# ============================================================================
# Target Schemas
# ============================================================================


class HourlyStats(BaseModel):
    """Target schema for hourly aggregated stats."""

    hour: datetime
    total_rows: int
    avg_text_length: float


class DailyStats(BaseModel):
    """Target schema for daily stats with refresh."""

    day: date
    row_count: int
    max_text_length: int


class WeeklyRollup(BaseModel):
    """Target schema for weekly rollup."""

    week_start: date
    total_records: int


class RandomizedStats(BaseModel):
    """Target schema for randomized stats."""

    minute: datetime
    event_count: int


class IncrementalStats(BaseModel):
    """Target schema for incremental MV (control)."""

    primary_key: str
    processed_at: datetime
    text_length_squared: int


# ============================================================================
# Test 1: Refreshable MV with EVERY interval
# ============================================================================
# This MV refreshes every hour, aggregating data from the Bar table

hourly_stats_mv = RefreshableMaterializedView[HourlyStats](
    RefreshableMaterializedViewOptions(
        materialized_view_name="hourly_stats_mv",
        target_table_name="hourly_stats",
        order_by_fields=["hour"],
        select_statement="""
            SELECT
                toStartOfHour(utc_timestamp) as hour,
                count(*) as total_rows,
                avg(text_length) as avg_text_length
            FROM Bar
            GROUP BY hour
        """,
        select_tables=[barModel.table],
        refresh_config=RefreshConfig(
            interval=RefreshIntervalEvery(value=1, unit="hour"),
            offset=Duration(value=5, unit="minute"),  # OFFSET is valid with EVERY
        ),
    )
)


# ============================================================================
# Test 2: Refreshable MV with AFTER interval (no offset - OFFSET only valid with EVERY)
# ============================================================================
# This MV refreshes 30 minutes after the last refresh completed.
# Note: OFFSET is NOT valid with REFRESH AFTER in ClickHouse, only with REFRESH EVERY.

daily_stats_mv = RefreshableMaterializedView[DailyStats](
    RefreshableMaterializedViewOptions(
        materialized_view_name="daily_stats_mv",
        target_table_name="daily_stats",
        order_by_fields=["day"],
        select_statement="""
            SELECT
                toDate(utc_timestamp) as day,
                count(*) as row_count,
                max(text_length) as max_text_length
            FROM Bar
            GROUP BY day
        """,
        select_tables=[barModel.table],
        refresh_config=RefreshConfig(
            interval=RefreshIntervalAfter(value=30, unit="minute"),
            # Note: No offset here - OFFSET is only valid with REFRESH EVERY, not REFRESH AFTER
        ),
    )
)


# ============================================================================
# Test 3: Refreshable MV with DEPENDS ON and APPEND
# ============================================================================
# This MV depends on daily_stats_mv and uses APPEND mode for incremental updates

weekly_rollup_mv = RefreshableMaterializedView[WeeklyRollup](
    RefreshableMaterializedViewOptions(
        materialized_view_name="weekly_rollup_mv",
        target_table_name="weekly_rollup",
        order_by_fields=["week_start"],
        select_statement="""
            SELECT
                toMonday(day) as week_start,
                sum(row_count) as total_records
            FROM daily_stats
            GROUP BY week_start
        """,
        select_tables=[
            daily_stats_mv.target_table
        ],  # Source is another MV's target table
        refresh_config=RefreshConfig(
            interval=RefreshIntervalEvery(value=1, unit="day"),
            depends_on=[daily_stats_mv],  # Type-safe: actual MV objects, not strings
            append=True,
        ),
    )
)


# ============================================================================
# Test 4: Refreshable MV with randomize window
# ============================================================================
# This MV uses randomization to prevent thundering herd on refresh

randomized_stats_mv = RefreshableMaterializedView[RandomizedStats](
    RefreshableMaterializedViewOptions(
        materialized_view_name="randomized_stats_mv",
        target_table_name="randomized_stats",
        order_by_fields=["minute"],
        select_statement="""
            SELECT
                toStartOfMinute(utc_timestamp) as minute,
                count(*) as event_count
            FROM Bar
            GROUP BY minute
        """,
        select_tables=[barModel.table],
        refresh_config=RefreshConfig(
            interval=RefreshIntervalEvery(value=5, unit="minute"),
            randomize=Duration(value=30, unit="second"),
        ),
    )
)


# ============================================================================
# Test 5: Incremental MV (control - no refresh_config)
# ============================================================================
# This is a traditional incremental MV for comparison - no refresh_config means
# it triggers on every insert to the source table

incremental_stats_mv = MaterializedView[IncrementalStats](
    MaterializedViewOptions(
        materialized_view_name="incremental_stats_mv",
        table_name="incremental_stats",
        order_by_fields=["primary_key"],
        select_statement="""
            SELECT
                primary_key,
                now() as processed_at,
                text_length * text_length as text_length_squared
            FROM Bar
        """,
        select_tables=[barModel.table],
        # No refresh_config = incremental MV
    )
)
