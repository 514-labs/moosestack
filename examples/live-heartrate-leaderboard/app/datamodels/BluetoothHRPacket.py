from pydantic import BaseModel
from moose_lib import Key


class BluetoothHRPacket(BaseModel):
    device_id: Key[int]
    timestamp_ns: float
    heart_rate: int
    rr_interval_ms: int
