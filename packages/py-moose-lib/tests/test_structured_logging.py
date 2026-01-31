"""Tests for structured logging utilities."""

import json
import sys
from io import StringIO

from moose_lib.utilities import setup_structured_logging


def test_structured_log_output_format():
    """Test that structured logging outputs correct JSON format to stderr."""
    # Capture stderr
    old_stderr = sys.stderr
    sys.stderr = StringIO()

    try:
        # Setup structured logging with function_name context
        context = setup_structured_logging(
            lambda ctx: ctx["function_name"], "function_name"
        )

        # Log a message with context
        context.run(
            {"function_name": "test_function"},
            lambda: context.log("info", "test message"),
        )

        # Get the output
        output = sys.stderr.getvalue()

        # Parse the JSON
        log_entry = json.loads(output.strip())

        # Verify the structure
        assert log_entry["__moose_structured_log__"] is True
        assert log_entry["level"] == "info"
        assert log_entry["message"] == "test message"
        assert log_entry["function_name"] == "test_function"
        assert "timestamp" in log_entry

    finally:
        sys.stderr = old_stderr


def test_structured_log_without_context():
    """Test that structured logging works without context set."""
    old_stderr = sys.stderr
    sys.stderr = StringIO()

    try:
        context = setup_structured_logging(
            lambda ctx: ctx["function_name"], "function_name"
        )

        # Log without setting context
        context.log("error", "error message")

        output = sys.stderr.getvalue()
        log_entry = json.loads(output.strip())

        # Should have log data but no function_name field
        assert log_entry["__moose_structured_log__"] is True
        assert log_entry["level"] == "error"
        assert log_entry["message"] == "error message"
        assert "function_name" not in log_entry

    finally:
        sys.stderr = old_stderr


def test_context_isolation():
    """Test that context is properly isolated between runs."""
    old_stderr = sys.stderr
    sys.stderr = StringIO()

    try:
        context = setup_structured_logging(
            lambda ctx: ctx["function_name"], "function_name"
        )

        # First context
        context.run(
            {"function_name": "function1"},
            lambda: context.log("info", "message1"),
        )

        # Second context
        context.run(
            {"function_name": "function2"},
            lambda: context.log("info", "message2"),
        )

        output = sys.stderr.getvalue()
        lines = output.strip().split("\n")

        log1 = json.loads(lines[0])
        log2 = json.loads(lines[1])

        assert log1["function_name"] == "function1"
        assert log1["message"] == "message1"
        assert log2["function_name"] == "function2"
        assert log2["message"] == "message2"

    finally:
        sys.stderr = old_stderr
