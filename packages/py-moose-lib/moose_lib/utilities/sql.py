import sys


def quote_identifier(name: str) -> str:
    """Quote a ClickHouse identifier with backticks if not already quoted.

    Backticks allow special characters (e.g., hyphens) in identifiers.
    """
    if name.startswith("`") and name.endswith("`"):
        return name
    return f"`{name}`"


from datetime import datetime
from typing import Any


def clickhouse_param_type_for_value(value: Any) -> str:
    """Infer ClickHouse typed parameter annotation for a Python value.

    Normalized to common scalar types used in placeholders.
    """
    if isinstance(value, bool):
        return "Bool"
    if isinstance(value, int):
        return "Int64"
    if isinstance(value, float):
        return "Float64"
    if isinstance(value, datetime):
        return "DateTime"
    if not isinstance(value, str):
        print(f"unhandled type {type(value)}", file=sys.stderr)
    return "String"

