"""scripts/check_prom.py, the CI's check that the ProM of the edition with ProM listens on loopback only."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "check_prom.py"


@pytest.fixture(scope="module")
def check_prom():
    spec = importlib.util.spec_from_file_location("check_prom", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1:35083",
        "127.1.2.3:80",
        "[::1]:35083",
        "::1:35083",  # lsof without brackets
        "[::ffff:127.0.0.1]:35083",  # Java's dual-stack socket on Linux (CI, ubuntu-22.04)
        "[::FFFF:127.0.0.2]:1",
    ],
)
def test_loopback_addresses_pass(check_prom, address):
    assert check_prom.is_loopback(address)


@pytest.mark.parametrize(
    "address",
    [
        "0.0.0.0:35083",
        "*:35083",
        "[::]:35083",
        "[::ffff:10.0.0.5]:35083",
        "[::ffff:0.0.0.0]:35083",
        "10.37.29.198:35083",
        "[fe80::1%eth0]:35083",
        "[2001:db8::1]:35083",
        "localhost:35083",
    ],
)
def test_other_addresses_fail(check_prom, address):
    assert not check_prom.is_loopback(address)
