from dataclasses import dataclass
from enum import Enum
from typing import Optional
from datetime import datetime
from .commons import JWT, Key


class Status(Enum):
    OK = "ok"
    ERROR = "error"


@dataclass
class MySubModel:
    name: str
    age: int


@dataclass
class MyModel:
    name: Key[str]
    age: int
    flag: bool
    status: Status
    test_key: str
    arr: list[str]
    opt: Optional[str]
    sub: MySubModel
    date: datetime
