from dataclasses import dataclass
from enum import Enum
from typing import Optional
from datetime import datetime


type Key[T: (str, int)] = T


class Status(Enum):
    OK = "ok"
    ERROR = "error"


class MySubModel:
    name: str
    age: int


@dataclass
class ComplexModel:
    name: Key[str]
    age: int
    flag: bool
    status: Status
    test_key: str
    arr: list[str]
    opt: Optional[str]
    list_sub: list[MySubModel]
    date: datetime
