"""Directories and waits that the end-to-end tests set through the environment."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ALGOSERVICE = Path(__file__).resolve().parent.parent


def _python(code: str, **env: str) -> str:
    environment = {**os.environ, **env}
    # A plain process, not pytest: database.py and config.py behave as in production here.
    environment.pop("PYTEST_CURRENT_TEST", None)
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=ALGOSERVICE, env=environment, capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


def test_artifacts_and_uploads_directories_come_from_the_environment(tmp_path):
    artifacts, uploads = tmp_path / "artifacts", tmp_path / "uploads"
    out = _python(
        "import jobs_db; from routes import algorithms; "
        "print(jobs_db.ARTIFACTS_DIR); print(algorithms.UPLOADED_LOGS_DIR)",
        ARTIFACTS_DIR=str(artifacts),
        UPLOADED_LOGS_DIR=str(uploads),
        RATE_LIMIT_DISABLED="1",
    )
    assert out.splitlines() == [str(artifacts), str(uploads)]
    # The upload directory is created at import, as /app/uploaded_logs is in the image.
    assert uploads.is_dir()


def test_defaults_are_the_directories_of_the_image():
    out = _python(
        "import jobs_db; from routes import algorithms; "
        "print(jobs_db.ARTIFACTS_DIR.as_posix()); print(algorithms.UPLOADED_LOGS_DIR.as_posix())",
        ARTIFACTS_DIR="",
        UPLOADED_LOGS_DIR="",
        RATE_LIMIT_DISABLED="1",
    )
    assert out.splitlines() == ["/app/artifacts", "/app/uploaded_logs"]


def test_the_wait_for_prom_to_start_comes_from_the_environment():
    code = "from algorithms import _prom4py; print(_prom4py.START_WAIT_S)"
    assert _python(code, PROM4PY_START_WAIT="3") == "3.0"
    assert _python(code, PROM4PY_START_WAIT="") == "180.0"
