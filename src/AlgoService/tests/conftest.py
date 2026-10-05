"""Shared pytest fixtures.

These tests run with the AlgoService package importable (just like the
production process does it). Each test that touches HTTP gets an isolated
``_JOBS_DIR`` so it cannot pollute the real jobs_store on disk.
"""

from __future__ import annotations

import os
import sys

# Disable rate limiting before any AlgoService module imports happen; the
# Limiter snapshots this flag at construction time in config.py.
os.environ.setdefault("RATE_LIMIT_DISABLED", "1")

# Put src/AlgoService on the path so ``from algorithms import ...`` and
# ``from srv_main import app`` both work when pytest is invoked from any cwd.
_HERE = os.path.dirname(__file__)
_ALGOSERVICE = os.path.abspath(os.path.join(_HERE, ".."))
if _ALGOSERVICE not in sys.path:
    sys.path.insert(0, _ALGOSERVICE)


import pytest


@pytest.fixture(scope="session")
def graphviz_available() -> bool:
    """Whether Petri-net rendering can produce images in this environment.

    The ComFy adapter works without Graphviz: it returns its table and skips the
    image artifacts. Tests that assert on those images must therefore gate on this, or they
    fail on any machine without Graphviz even though nothing is broken. The algoservice
    image installs it (`src/AlgoService/Dockerfile`), a plain local checkout usually has not.

    A fixture rather than a plain function: `from conftest import ...` resolves against an
    unrelated `conftest` module in site-packages on this machine.
    """
    import shutil

    return shutil.which("dot") is not None


@pytest.fixture
def isolated_jobs_dir(monkeypatch, tmp_path):
    """Point ``jobs_db.ARTIFACTS_DIR`` at a per-test temp directory."""
    import jobs_db
    monkeypatch.setattr(jobs_db, "ARTIFACTS_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def clean_db(isolated_jobs_dir):
    """Clear database jobs before each test."""
    import asyncio
    import jobs_db
    try:
        asyncio.run(jobs_db.delete_all_jobs())
    except Exception:
        pass


@pytest.fixture
def client(isolated_jobs_dir):
    from fastapi.testclient import TestClient
    from srv_main import app
    with TestClient(app) as c:
        yield c




@pytest.fixture
def stub_algorithm(monkeypatch) -> str:
    """Register a cheap test-only tool and return its id.

    The only real tool, ComFy, needs the ProM4Py Java service. The HTTP layer (uploads,
    sessions, batch, exports) does not care which tool runs, so its tests use this stub,
    which only reads the log and counts cases and events.
    """
    import algorithms
    from algorithms._log_io import read_event_log
    from algorithms.base import (
        AlgorithmBase, AnalysisResult, ParameterSpec, SecondaryFile, log_file, stat, table, text,
    )

    class StubAlgorithm(AlgorithmBase):
        id = "stub"
        name = "Stub — log counts"
        description = "Counts cases and events of the uploaded log."
        tool_type = "complexity"
        parameters_schema = [
            ParameterSpec("note", "Note", "string", default=""),
            ParameterSpec("top_k", "Rows shown", "int", default=10, min=1, max=100),
            ParameterSpec("fail", "Fail on purpose", "bool", default=False),
        ]
        secondary_files = [SecondaryFile("reference_pnml", "Reference Petri net", ".pnml")]

        def analyze(self, file_path, params, ctx=None):
            import base64

            if params["fail"]:
                raise ValueError("Failing as requested.")
            log = read_event_log(file_path, return_legacy=True)
            events = sum(len(t) for t in log)
            artifacts = [
                stat("Cases", len(log)),
                stat("Events", events),
                table(
                    "Events per case",
                    ["case", "events"],
                    [[t.attributes.get("concept:name"), len(t)] for t in log][: params["top_k"]],
                ),
                text("Note", params["note"] or "-"),
                log_file("Counts", base64.b64encode(f"{len(log)},{events}".encode()).decode(),
                         "counts.csv", mime="text/csv"),
            ]
            if params.get("reference_pnml_path"):
                artifacts.append(stat("Reference net", params["reference_pnml_filename"]))
            return AnalysisResult(artifacts=artifacts, summary=f"{len(log)} cases")

    monkeypatch.setitem(algorithms.REGISTRY, StubAlgorithm.id, StubAlgorithm())
    return StubAlgorithm.id
