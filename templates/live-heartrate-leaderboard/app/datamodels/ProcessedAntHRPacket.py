from pydantic import BaseModel
from moose_lib import Key


class ProcessedAntHRPacket(BaseModel):
    device_id: Key[int]
    previous_beat_time: float
    last_beat_time: float
    calculated_heart_rate: float
    heart_beat_count: int
