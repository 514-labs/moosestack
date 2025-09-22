import datetime

from moose_lib.dmv2 import Api
from moose_lib import MooseClient
from pydantic import BaseModel, Field
from typing import Optional


# Define the query parameters
class QueryParams(BaseModel):
    user_name: str = Field(..., description="The name of the user to get stats for")
    window_seconds: int = Field(
        default=60,
        gt=0,
        le=3600,  # Max 1 hour of data
        description="The number of seconds of history to return (default 60, max 3600)"
    )


# Define the response body
class HeartRateStats(BaseModel):
    user_name: str
    heart_rate: int
    hr_zone: int
    estimated_power: float
    cumulative_calories_burned: float
    timestamp: float
    processed_timestamp: datetime.datetime


class HeartRateStatsResponse(BaseModel):
    entries: list[HeartRateStats]


def run(client: MooseClient, params: QueryParams) -> HeartRateStatsResponse:
    """
    Retrieves a user's live heart rate data including heart rate, heart rate zone,
    estimated power output, and calories burned.
    
    Args:
        client: The MooseClient instance for executing queries
        params: The query parameters containing user_name and window_seconds
        
    Returns:
        Heart rate statistics for the specified user
    """
    query = """
    WITH 
        user_stats AS (
            SELECT 
                user_name,
                hr_value,
                hr_timestamp_seconds,
                processed_timestamp,
                -- Calculate heart rate zone (1-5)
                CASE 
                    WHEN hr_value < 120 THEN 1
                    WHEN hr_value < 140 THEN 2
                    WHEN hr_value < 160 THEN 3
                    WHEN hr_value < 180 THEN 4
                    ELSE 5
                END as hr_zone,
                -- Estimate power output (watts) based on heart rate
                -- Using a simple formula: power = (hr_value - 60) * 2
                (hr_value - 60) * 2 as estimated_power,
                -- Calculate calories burned per minute based on heart rate
                -- Using formula: calories = ((-55.0969 + (0.6309 x HR) + (0.1988 x 70) + (0.2017 x 30))/4.184) x 60
                -- Where 70 is average weight in kg and 30 is average age
                (((-55.0969 + (0.6309 * hr_value) + (0.1988 * 70) + (0.2017 * 30))/4.184) * 
                 (hr_timestamp_seconds - lagInFrame(hr_timestamp_seconds, 1, hr_timestamp_seconds - 1) OVER (PARTITION BY user_name ORDER BY hr_timestamp_seconds)))/60 as calories_burned
            FROM unified_hr_packet
            WHERE user_name = {user_name}
            AND hr_timestamp_seconds >= (
                SELECT MAX(hr_timestamp_seconds) - {window_seconds}
                FROM unified_hr_packet
                WHERE user_name = {user_name}
            )
        )
    SELECT 
        user_name,
        hr_value as heart_rate,
        hr_zone,
        estimated_power,
        round(sum(calories_burned) OVER (ORDER BY hr_timestamp_seconds), 2) as cumulative_calories_burned,
        hr_timestamp_seconds as timestamp,
        processed_timestamp
    FROM user_stats
    ORDER BY hr_timestamp_seconds DESC
    """

    # Execute the query with parameterized values to prevent SQL injection
    result = client.query.execute(query, {
        "user_name": params.user_name,
        "window_seconds": params.window_seconds
    })
    # print(result)
    return HeartRateStatsResponse(entries=result)


# Create the API endpoint
get_user_live_heart_rate_stats = Api[QueryParams, HeartRateStatsResponse](
    name="getUserLiveHeartRateStats",
    query_function=run
)
