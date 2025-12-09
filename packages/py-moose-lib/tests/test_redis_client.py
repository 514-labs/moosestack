import os
import sys
import time
import subprocess
import pytest
from pydantic import BaseModel
from moose_lib import MooseCache


class Config(BaseModel):
    baz: int
    qux: bool


@pytest.mark.integration
def test_cache_strings():
    cache = MooseCache()

    # Test setting and getting strings
    cache.set("test:string", "hello")
    value = cache.get("test:string")
    assert value == "hello"

    # Test with explicit str type hint
    value = cache.get("test:string", str)
    assert value == "hello"

    # Clean up
    cache.clear_keys("test")


@pytest.mark.integration
def test_cache_pydantic():
    cache = MooseCache()

    # Test setting and getting Pydantic models
    config = Config(baz=123, qux=True)
    cache.set("test:config", config)

    retrieved = cache.get("test:config", Config)
    assert retrieved is not None
    assert retrieved.baz == 123
    assert retrieved.qux is True

    # Test invalid JSON
    cache.set("test:invalid", "not json")
    with pytest.raises(ValueError):
        cache.get("test:invalid", Config)

    # Clean up
    cache.clear_keys("test")


@pytest.mark.integration
def test_cache_ttl():
    cache = MooseCache()

    # Test setting and getting with TTL
    cache.set("test:ttl", "hello", ttl_seconds=3)
    value = cache.get("test:ttl")
    assert value == "hello"
    time.sleep(5)
    value = cache.get("test:ttl")
    assert value is None

    # Test negative TTL
    with pytest.raises(ValueError):
        cache.set("test:negative_ttl", "hello", ttl_seconds=-1)

    # Clean up
    cache.clear_keys("test")


@pytest.mark.integration
def test_cache_nonexistent():
    cache = MooseCache()

    # Test getting nonexistent keys
    assert cache.get("nonexistent") is None
    assert cache.get("nonexistent", str) is None
    assert cache.get("nonexistent", Config) is None


@pytest.mark.integration
def test_cache_invalid_type():
    cache = MooseCache()

    # Test invalid type hints
    with pytest.raises(TypeError):
        cache.get("test", int)

    with pytest.raises(TypeError):
        cache.get("test", dict)


@pytest.mark.integration
def test_atexit_cleanup():
    # Create a test script that will be run in a separate process
    test_script = """
import sys
from moose_lib.clients.redis_client import MooseCache

# Create instance
cache = MooseCache()
print("Created cache instance")

# Force exit without calling disconnect
sys.exit(0)
"""

    # Write the test script to a temporary file
    with open("test_atexit.py", "w") as f:
        f.write(test_script)

    try:
        # Run the script and capture output
        result = subprocess.run(
            [sys.executable, "test_atexit.py"], capture_output=True, text=True
        )

        # Check if we see both the connection and disconnection messages
        output = result.stdout + result.stderr
        print("\nTest output:")
        print("------------")
        print(output)
        print("------------")

        assert "Python Redis client connected" in output
        assert "Python Redis client disconnected" in output
        print("\nTest passed! Verified atexit cleanup is working.")

    finally:
        # Clean up the test script
        os.remove("test_atexit.py")
