from dataclasses import dataclass
from typing import Callable


@dataclass
class Flow:
    run: Callable


my_flow = Flow(run=lambda: print("Hello, from the flow, yo!"))


@dataclass
class MyDataModel:
    name: str
    age: int
    flag: bool
    status: str
    test_key: str
    arr: list
    opt: str


@dataclass
class MyDataModel2:
    name: str
    age: int
    flag: bool
    status: str
    test_key: str
    arr: list
    opt: str


def my_func(dm: MyDataModel) -> MyDataModel2:
    print(dm)


my_flow_2 = Flow(run=my_func)
