from app.datamodels.ProcessedAntHRPacket import ProcessedAntHRPacket
from app.datamodels.UnifiedHRPacket import UnifiedHRPacket
from moose_lib import StreamingFunction, Logger
from typing import Optional
from datetime import datetime, timezone
from pathlib import Path
import json
from moose_lib import Logger


# Load the mock user db and return a dictionary of devices
def load_device_dict():
    json_path = Path(__file__).parents[2] / "mock-user-db.json"
    logger = Logger(action="SF")
    logger.info(
        f"Starting streaming function and loading mock user db from {json_path}"
    )

    with open(json_path) as f:
        device_dict = json.load(f)

    logger.info(f"Device dict: {device_dict}")
    return device_dict


logger = Logger(action="SF")

device_dict = load_device_dict()


def processedAntHRPacket__UNIFIED_HR_PACKET(
    source: ProcessedAntHRPacket,
) -> UnifiedHRPacket:
    device_id = str(source.device_id)
    user_id = device_dict[device_id]["user_id"]
    user_name = device_dict[device_id]["user_name"]
    logger.info(f"Device ID: {device_id}, User ID: {user_id}, User Name: {user_name}")
    return UnifiedHRPacket(
        user_id=user_id,
        user_name=user_name,
        device_id=source.device_id,
        hr_timestamp_seconds=source.last_beat_time,
        hr_value=source.calculated_heart_rate,
        rr_interval_ms=(source.last_beat_time - source.previous_beat_time) * 1000,
        # Time in UTC when data is processed
        processed_timestamp=datetime.now(timezone.utc),
    )
