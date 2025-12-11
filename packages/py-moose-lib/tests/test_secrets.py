"""Tests for the moose_lib.secrets module.

This module tests the runtime environment variable marker functionality,
which allows users to defer secret resolution until runtime rather than
embedding secrets at build time.
"""

import os
import pytest
from moose_lib.secrets import moose_runtime_env, get, MOOSE_RUNTIME_ENV_PREFIX


@pytest.fixture(scope="module", autouse=True)
def set_infra_map_loading_for_secrets_tests():
    """Set IS_LOADING_INFRA_MAP=true for secrets tests so moose_runtime_env.get() returns markers."""
    os.environ["IS_LOADING_INFRA_MAP"] = "true"
    yield
    # Clean up after all tests in this module
    os.environ.pop("IS_LOADING_INFRA_MAP", None)


class TestMooseRuntimeEnvGet:
    """Tests for the moose_runtime_env.get() method."""

    def test_creates_marker_with_correct_prefix(self):
        """Should create a marker string with the correct prefix."""
        var_name = "AWS_ACCESS_KEY_ID"
        result = moose_runtime_env.get(var_name)

        assert result == f"{MOOSE_RUNTIME_ENV_PREFIX}{var_name}"
        assert result == "__MOOSE_RUNTIME_ENV__:AWS_ACCESS_KEY_ID"

    def test_handles_different_variable_names(self):
        """Should handle different environment variable names correctly."""
        test_cases = [
            "AWS_SECRET_ACCESS_KEY",
            "DATABASE_PASSWORD",
            "API_KEY",
            "MY_CUSTOM_SECRET",
        ]

        for var_name in test_cases:
            result = moose_runtime_env.get(var_name)
            assert result == f"{MOOSE_RUNTIME_ENV_PREFIX}{var_name}"
            assert var_name in result

    def test_raises_error_for_empty_string(self):
        """Should raise ValueError for empty string."""
        with pytest.raises(
            ValueError, match="Environment variable name cannot be empty"
        ):
            moose_runtime_env.get("")

    def test_raises_error_for_whitespace_only(self):
        """Should raise ValueError for whitespace-only string."""
        with pytest.raises(
            ValueError, match="Environment variable name cannot be empty"
        ):
            moose_runtime_env.get("   ")

    def test_raises_error_for_tabs_only(self):
        """Should raise ValueError for string with only tabs."""
        with pytest.raises(
            ValueError, match="Environment variable name cannot be empty"
        ):
            moose_runtime_env.get("\t\t")

    def test_allows_underscores_in_variable_names(self):
        """Should allow variable names with underscores."""
        var_name = "MY_LONG_VAR_NAME"
        result = moose_runtime_env.get(var_name)

        assert result == f"{MOOSE_RUNTIME_ENV_PREFIX}{var_name}"

    def test_allows_numbers_in_variable_names(self):
        """Should allow variable names with numbers."""
        var_name = "API_KEY_123"
        result = moose_runtime_env.get(var_name)

        assert result == f"{MOOSE_RUNTIME_ENV_PREFIX}{var_name}"

    def test_preserves_exact_casing(self):
        """Should preserve exact variable name casing."""
        var_name = "MixedCase_VarName"
        result = moose_runtime_env.get(var_name)

        assert var_name in result
        assert var_name.lower() not in result  # Ensure casing wasn't changed

    def test_can_be_used_in_s3queue_config(self):
        """Should create markers that can be used in S3Queue configuration."""
        access_key_marker = moose_runtime_env.get("AWS_ACCESS_KEY_ID")
        secret_key_marker = moose_runtime_env.get("AWS_SECRET_ACCESS_KEY")

        config = {
            "aws_access_key_id": access_key_marker,
            "aws_secret_access_key": secret_key_marker,
        }

        assert "AWS_ACCESS_KEY_ID" in config["aws_access_key_id"]
        assert "AWS_SECRET_ACCESS_KEY" in config["aws_secret_access_key"]


class TestModuleLevelGetFunction:
    """Tests for the module-level get() function."""

    def test_module_level_get_creates_marker(self):
        """The module-level get function should create markers."""
        var_name = "TEST_SECRET"
        result = get(var_name)

        assert result == f"{MOOSE_RUNTIME_ENV_PREFIX}{var_name}"

    def test_module_level_get_matches_class_method(self):
        """Module-level get should produce same result as class method."""
        var_name = "MY_SECRET"

        result_module = get(var_name)
        result_class = moose_runtime_env.get(var_name)

        assert result_module == result_class

    def test_module_level_get_raises_error_for_empty(self):
        """Module-level get should raise ValueError for empty string."""
        with pytest.raises(
            ValueError, match="Environment variable name cannot be empty"
        ):
            get("")


class TestMooseRuntimeEnvPrefix:
    """Tests for the MOOSE_RUNTIME_ENV_PREFIX constant."""

    def test_has_expected_value(self):
        """Should have the expected prefix value."""
        assert MOOSE_RUNTIME_ENV_PREFIX == "__MOOSE_RUNTIME_ENV__:"

    def test_is_string(self):
        """Should be a string."""
        assert isinstance(MOOSE_RUNTIME_ENV_PREFIX, str)

    def test_is_not_empty(self):
        """Should not be empty."""
        assert len(MOOSE_RUNTIME_ENV_PREFIX) > 0


class TestMarkerFormatValidation:
    """Tests for marker format validation and parsing."""

    def test_creates_easily_detectable_markers(self):
        """Should create markers that are easily detectable."""
        marker = moose_runtime_env.get("TEST_VAR")

        assert marker.startswith("__MOOSE_RUNTIME_ENV__:")

    def test_markers_can_be_split_to_extract_variable_name(self):
        """Should create markers that can be split to extract variable name."""
        var_name = "MY_SECRET"
        marker = moose_runtime_env.get(var_name)

        parts = marker.split(MOOSE_RUNTIME_ENV_PREFIX)
        assert len(parts) == 2
        assert parts[1] == var_name

    def test_markers_are_json_serializable(self):
        """Should create markers that are JSON serializable."""
        import json

        marker = moose_runtime_env.get("TEST_VAR")
        json_str = json.dumps({"secret": marker})
        parsed = json.loads(json_str)

        assert parsed["secret"] == marker

    def test_markers_work_with_dict_serialization(self):
        """Should work correctly with dictionary serialization."""
        marker = moose_runtime_env.get("DATABASE_PASSWORD")

        config = {"password": marker, "other_field": "value"}

        # Verify the marker is preserved in the dict
        assert config["password"] == marker
        assert MOOSE_RUNTIME_ENV_PREFIX in config["password"]


class TestIntegrationScenarios:
    """Integration tests for real-world usage scenarios."""

    def test_s3queue_engine_with_secrets(self):
        """Should work correctly in S3Queue engine configuration."""
        from moose_lib.blocks import S3QueueEngine

        engine = S3QueueEngine(
            s3_path="s3://my-bucket/data/*.json",
            format="JSONEachRow",
            aws_access_key_id=moose_runtime_env.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=moose_runtime_env.get("AWS_SECRET_ACCESS_KEY"),
        )

        # Verify markers were set correctly
        assert engine.aws_access_key_id == "__MOOSE_RUNTIME_ENV__:AWS_ACCESS_KEY_ID"
        assert (
            engine.aws_secret_access_key
            == "__MOOSE_RUNTIME_ENV__:AWS_SECRET_ACCESS_KEY"
        )

    def test_multiple_secrets_in_same_config(self):
        """Should handle multiple secrets in the same configuration."""
        config = {
            "username": moose_runtime_env.get("DB_USERNAME"),
            "password": moose_runtime_env.get("DB_PASSWORD"),
            "api_key": moose_runtime_env.get("API_KEY"),
        }

        # All should have the correct prefix
        for value in config.values():
            assert value.startswith(MOOSE_RUNTIME_ENV_PREFIX)

        # Each should have the correct variable name
        assert "DB_USERNAME" in config["username"]
        assert "DB_PASSWORD" in config["password"]
        assert "API_KEY" in config["api_key"]

    def test_mixed_secret_and_plain_values(self):
        """Should handle mix of secret markers and plain values."""
        config = {
            "region": "us-east-1",  # Plain value
            "access_key": moose_runtime_env.get("AWS_ACCESS_KEY_ID"),  # Secret
            "bucket": "my-bucket",  # Plain value
            "secret_key": moose_runtime_env.get("AWS_SECRET_ACCESS_KEY"),  # Secret
        }

        # Plain values should be unchanged
        assert config["region"] == "us-east-1"
        assert config["bucket"] == "my-bucket"

        # Secrets should have markers
        assert MOOSE_RUNTIME_ENV_PREFIX in config["access_key"]
        assert MOOSE_RUNTIME_ENV_PREFIX in config["secret_key"]
