from typing import Generic, TypeVar

type Key[T: (str, int)] = T

T = TypeVar("T", bound=object)


class JWT(Generic[T]):
    def __init__(self, payload: T):
        self.payload = payload
