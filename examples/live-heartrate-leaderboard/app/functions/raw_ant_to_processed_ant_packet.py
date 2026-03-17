from app.datamodels.RawAntHRPacket import RawAntHRPacket
from app.datamodels.ProcessedAntHRPacket import ProcessedAntHRPacket
from moose_lib import StreamingFunction
from typing import Optional
from datetime import datetime


# Maintain the state of the device
# This is used to handle byte rollovers
device_dict = {}


def RawAntHRPacket__ProcessedAntHRPacket(
    source: RawAntHRPacket,
) -> Optional[ProcessedAntHRPacket]:
    # Track the number of times the time byte has been incremented
    # 2 Bytes ==> 16 bits ==> 65536 values of 1/1024 seconds ==> 64 seconds
    device_id_str = str(source.device_id)
    if device_id_str not in device_dict:
        device_dict[device_id_str] = {
            "previous_beat_time_rollover": 0,
            "last_beat_time_rollover": 0,
            "heart_beat_rollover": 0,
        }

    # Merges the 2 bytes based on the LSB and MSB - building a 16 bit integer representing when the last heart beat occurred
    # The 16 bit integer is then divided by 1024 to get the time in seconds
    previous_beat_time_seconds = (
        float((source.ant_hr_packet[3] << 8) | source.ant_hr_packet[2])
        + (device_dict[device_id_str]["previous_beat_time_rollover"] * 65536)
    ) / 1024
    last_beat_time_seconds = (
        float((source.ant_hr_packet[5] << 8) | source.ant_hr_packet[4])
        + (device_dict[device_id_str]["last_beat_time_rollover"] * 65536)
    ) / 1024
    calculated_heart_rate = source.ant_hr_packet[7]

    heart_beat_count = source.ant_hr_packet[6] + (
        device_dict[device_id_str]["heart_beat_rollover"] * 256
    )
    if heart_beat_count > 256:
        device_dict[device_id_str]["heart_beat_rollover"] += 1

    return ProcessedAntHRPacket(
        device_id=source.device_id,
        previous_beat_time=previous_beat_time_seconds,
        last_beat_time=last_beat_time_seconds,
        heart_beat_count=heart_beat_count,
        calculated_heart_rate=calculated_heart_rate,
    )
