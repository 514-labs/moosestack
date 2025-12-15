import json
from datetime import datetime, date, time
from decimal import Decimal
from uuid import UUID
from typing import Any


class MooseJSONEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles common Python types."""

    def default(self, obj: Any) -> Any:
        if isinstance(obj, (datetime, date)):
            return {"__type": "datetime", "value": obj.isoformat()}
        if isinstance(obj, time):
            return {"__type": "time", "value": obj.isoformat()}
        if isinstance(obj, Decimal):
            return {"__type": "decimal", "value": str(obj)}
        if isinstance(obj, UUID):
            return {"__type": "uuid", "value": str(obj)}
        if isinstance(obj, set):
            return {"__type": "set", "value": list(obj)}
        if isinstance(obj, bytes):
            return {"__type": "bytes", "value": obj.hex()}
        try:
            # Try to convert to dict for objects with __dict__ attribute
            return obj.__dict__
        except AttributeError:
            pass
        return super().default(obj)


def moose_json_decode(dct: dict) -> Any:
    """Custom JSON decoder that restores special types."""
    if "__type" not in dct:
        return dct

    obj_type = dct["__type"]
    value = dct["value"]

    if obj_type == "datetime":
        return datetime.fromisoformat(value)
    if obj_type == "time":
        return time.fromisoformat(value)
    if obj_type == "decimal":
        return Decimal(value)
    if obj_type == "uuid":
        return UUID(value)
    if obj_type == "set":
        return set(value)
    if obj_type == "bytes":
        return bytes.fromhex(value)

    return dct
