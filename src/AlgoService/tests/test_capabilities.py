"""GET /capabilities: whether mining a log with ProM is possible here."""

from __future__ import annotations

import pytest


def test_prom_is_available_where_its_url_is_set(client, monkeypatch):
    monkeypatch.setenv("PROM4PY_URL", "http://prom4py:4040")
    assert client.get("/capabilities").json() == {"prom": True}


@pytest.mark.parametrize("value", [None, "", "  "])
def test_prom_is_missing_without_its_url(client, monkeypatch, value):
    if value is None:
        monkeypatch.delenv("PROM4PY_URL", raising=False)
    else:
        monkeypatch.setenv("PROM4PY_URL", value)
    assert client.get("/capabilities").json() == {"prom": False}
