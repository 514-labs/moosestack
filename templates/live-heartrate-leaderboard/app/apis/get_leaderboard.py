from moose_lib.dmv2 import Api
from moose_lib import MooseClient
from pydantic import BaseModel, Field
from typing import List


# Define the query parameters
class LeaderboardQueryParams(BaseModel):
    time_window_seconds: int = Field(
        default=300,
        gt=0,
        le=86400,  # Max 24 hours
        description="Time window in seconds to calculate stats (default 5 minutes)"
    )
    limit: int = Field(
        default=10,
        gt=0,
        le=100,  # Max 100 users
        description="Number of users to return (default 10)"
    )


# Define the response body
class LeaderboardEntry(BaseModel):
    rank: int
    user_name: str
    avg_heart_rate: float
    max_heart_rate: int
    avg_power: float
    max_power: int
    total_calories: float
    zone1_percentage: float
    zone2_percentage: float
    zone3_percentage: float
    zone4_percentage: float
    zone5_percentage: float


# Define the response wrapper
class LeaderboardResponse(BaseModel):
    entries: List[LeaderboardEntry]


# Define the route handler function
def run(client: MooseClient, params: LeaderboardQueryParams) -> LeaderboardResponse:
    """
    Retrieves a leaderboard of users ranked by their heart rate metrics, power output, and calories burned.
    
    Args:
        client: The MooseClient instance for executing queries
        params: The query parameters including time window and limit
        
    Returns:
        A LeaderboardResponse containing the ranked list of users with their metrics
    """
    query = """
    WITH 
        user_metrics AS (
            SELECT 
                user_name,
                -- Calculate average heart rate
                round(avg(hr_value), 1) as avg_heart_rate,
                -- Calculate max heart rate
                max(hr_value) as max_heart_rate,
                -- Calculate average power (using same formula as live stats)
                round(avg((hr_value - 60) * 2), 1) as avg_power,
                -- Calculate max power
                max((hr_value - 60) * 2) as max_power,
                -- Calculate approximate calories burned (simplified calculation)
                round(
                    sum(((-55.0969 + (0.6309 * hr_value) + (0.1988 * 70) + (0.2017 * 30))/4.184) / 60), 
                    2
                ) as total_calories,
                -- Calculate time in each zone
                round(countIf(hr_value < 120) / count() * 100, 1) as zone1_percentage,
                round(countIf(hr_value >= 120 AND hr_value < 140) / count() * 100, 1) as zone2_percentage,
                round(countIf(hr_value >= 140 AND hr_value < 160) / count() * 100, 1) as zone3_percentage,
                round(countIf(hr_value >= 160 AND hr_value < 180) / count() * 100, 1) as zone4_percentage,
                round(countIf(hr_value >= 180) / count() * 100, 1) as zone5_percentage
            FROM unified_hr_packet
            WHERE hr_timestamp_seconds >= (
                SELECT MAX(hr_timestamp_seconds) - toInt32({time_window_seconds})
                FROM unified_hr_packet
            )
            GROUP BY user_name
        )
    SELECT 
        row_number() OVER (ORDER BY avg_heart_rate DESC) as rank,
        user_name,
        avg_heart_rate,
        max_heart_rate,
        avg_power,
        max_power,
        total_calories,
        zone1_percentage,
        zone2_percentage,
        zone3_percentage,
        zone4_percentage,
        zone5_percentage
    FROM user_metrics
    ORDER BY rank ASC
    LIMIT toInt32({limit})
    """

    # Execute the query with parameterized values
    result = client.query.execute(query, {
        "time_window_seconds": params.time_window_seconds,
        "limit": params.limit
    })

    # Convert the result to our response model
    entries = [LeaderboardEntry(**row) for row in result]
    return LeaderboardResponse(entries=entries)


# Create the API endpoint
get_leaderboard_api = Api[LeaderboardQueryParams, LeaderboardResponse](
    name="getLeaderboard",
    query_function=run
)
