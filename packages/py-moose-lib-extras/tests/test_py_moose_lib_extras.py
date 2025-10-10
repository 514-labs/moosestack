"""
Tests for py-moose-lib-extras
"""

import pytest
import moose_lib_extras


def test_version():
    """Test that version is defined."""
    assert hasattr(moose_lib_extras, '__version__')
    assert moose_lib_extras.__version__ is not None


def test_import():
    """Test that the package can be imported."""
    assert moose_lib_extras is not None
