"""Shared test fixtures for Voice Dani tests."""

import pytest


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Reset rate limiting state before each test to avoid cross-test pollution."""
    from voice_dani.server import pairing_manager
    pairing_manager.reset_rate_limits()
    yield
