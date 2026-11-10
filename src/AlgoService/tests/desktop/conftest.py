"""Fixtures of the desktop launcher's tests (src/desktop/desktop_app).

They run with the backend's suite (``python -m pytest`` in src/AlgoService) and under its
conftest: the same test environment, database reset and no Anthropic API.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ._support import BEARER, INSTANCE, ORIGIN, PORT, TOKEN, make_export


@pytest.fixture
def export_dir(tmp_path) -> Path:
    return make_export(tmp_path / "out")


@pytest.fixture
def access(tmp_path):
    """What opens the app: the master token, the one-time codes and the sessions."""
    from desktop_app.app import Access

    login_dir = tmp_path / "login"
    login_dir.mkdir()
    return Access(TOKEN, login_dir)


@pytest.fixture
def desktop_app(export_dir, access):
    """The desktop app around the backend's app, for a server on :data:`PORT`."""
    from desktop_app.app import build_app
    from srv_main import app as api

    return build_app(api, export_dir, port=PORT, token=TOKEN, instance=INSTANCE, access=access)


@pytest.fixture
def desktop_client(desktop_app):
    """A client that holds the access token (as a script does), for the tests of everything else."""
    from fastapi.testclient import TestClient

    with TestClient(desktop_app, base_url=ORIGIN, headers=BEARER) as client:
        yield client


@pytest.fixture
def anonymous_client(desktop_app):
    """A client that does not know the token: any other program on the machine."""
    from fastapi.testclient import TestClient

    with TestClient(desktop_app, base_url=ORIGIN) as client:
        yield client
