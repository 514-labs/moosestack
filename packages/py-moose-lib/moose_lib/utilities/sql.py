def quote_identifier(name: str) -> str:
    """Quote a ClickHouse identifier with backticks if not already quoted.

    Backticks allow special characters (e.g., hyphens) in identifiers.
    """
    if name.startswith("`") and name.endswith("`"):
        return name
    return f"`{name}`"


