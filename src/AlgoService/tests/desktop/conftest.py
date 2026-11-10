"""Fixtures of the desktop launcher's tests (src/desktop/desktop_app).

They run with the backend's suite (``python -m pytest`` in src/AlgoService) and under its
conftest: the same test environment, database reset and no Anthropic API.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ._support import INSTANCE, ORIGIN, PORT, TOKEN, make_export


@pytest.fixture
def export_dir(tmp_path) -> Path:
    return make_export(tmp_path / "out")


@pytest.fixture
def desktop_app(export_dir):
    """The desktop app around the backend's app, for a server on :data:`PORT`."""
    from desktop_app.app import build_app
    from srv_main import app as api

    return build_app(api, export_dir, port=PORT, token=TOKEN, instance=INSTANCE)


@pytest.fixture
def desktop_client(desktop_app):
    from fastapi.testclient import TestClient

    with TestClient(desktop_app, base_url=ORIGIN) as client:
        yield client
