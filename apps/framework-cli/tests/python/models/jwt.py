from dataclasses import dataclass
from typing import Optional
from .commons import JWT, Key


@dataclass
class JWTPayload:
    iss: str
    aud: str
    exp: int
    context: str


@dataclass
class MyJwtModel:
    name: Key[str]
    value: str
    jwt: JWT[JWTPayload]
