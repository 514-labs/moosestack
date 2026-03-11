from pydantic import BaseModel
from moose_lib import Key


class RawAntHRPacket(BaseModel):
    device_id: Key[int]
    packet_count: int
    ant_hr_packet: list[int]
