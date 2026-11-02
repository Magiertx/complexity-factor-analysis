"""Provenance in the ZIP of an analysis: tool, upstream code, libraries, miners and their
parameters, assignment rule and seed."""

from __future__ import annotations

import io
import json
import time
import zipfile
from datetime import datetime, timedelta

import pytest

import provenance


@pytest.fixture(autouse=True)
def fixed_tool(monkeypatch):
    """A tool version and commit as the Docker build sets them."""
    monkeypatch.setenv("APP_VERSION", "v0.9")
    monkeypatch.setenv("APP_COMMIT", "0123456789abcdef0123456789abcdef01234567")
    provenance.tool.cache_clear()
    yield
    provenance.tool.cache_clear()


def _wait_ready(client, dataset_id: str, timeout: float = 120.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        d = client.get(f"/factor-analysis/datasets/{dataset_id}?rows=0").json()
        if d["status"] != "computing":
            return d
        time.sleep(0.1)
    pytest.fail(f"dataset {dataset_id} still computing after {timeout}s")


def _archive(client, dataset_id: str, **body) -> tuple[dict, str]:
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/export/zip", json=body)
    assert r.status_code == 200, r.text
    with zipfile.ZipFile(io.BytesIO(r.content)) as archive:
        return json.loads(archive.read("manifest.json")), archive.read("README.txt").decode()


def _session_of(dataset_id: str) -> str:
    from factor_analysis import storage

    return next(d.name for d in storage.root().iterdir() if (d / dataset_id).is_dir())


def _xes(traces: list[list[str]]) -> bytes:
    import os
    import tempfile

    import pm4py
    from pm4py.objects.log.obj import Event, EventLog, Trace

    log = EventLog()
    for i, activities in enumerate(traces):
        trace = Trace()
        trace.attributes["concept:name"] = f"case{i}"
        for j, activity in enumerate(activities):
            trace.append(Event({"concept:name": activity, "time:timestamp": datetime(2024, 1, 1) + timedelta(hours=10 * i + j)}))
        log.append(trace)
    fd, path = tempfile.mkstemp(suffix=".xes")
    os.close(fd)
    try:
        pm4py.write_xes(log, path)
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.remove(path)


def _random_traces(seed: int) -> list[list[str]]:
    import random

    rng = random.Random(seed)
    return [[rng.choice("abcdefg"[: 3 + seed % 5]) for _ in range(rng.randint(1, 4 + seed))] for _ in range(3 + seed)]


LOGS = {f"log{i}.xes": _random_traces(i) for i in range(8)}
FEATURES = ["n_variants", "n_events", "trace_len_max", "n_unique_activities"]


def _check_tool_and_analysis(manifest: dict) -> None:
    assert manifest["tool"] == {
        "name": "Complexity Factor Analysis",
        "version": "v0.9",
        "commit": "0123456789abcdef0123456789abcdef01234567",
    }
    analysis = manifest["analysis"]
    assert analysis["method"] == "minres" and analysis["library"] == "factor_analyzer"
    assert analysis["assignment_rule"] == "largest"
    assert analysis["seed"] == 20261012
    assert {k: analysis["factor_count"][k] for k in ("method", "seed", "simulations", "percentile")} == {
        "method": "pca", "seed": 20261012, "simulations": 100, "percentile": 95,
    }
    assert "eigenvalues_random" not in analysis["factor_count"]
    assert [f["name"] for f in analysis["follows"]] == ["ComFy", "ComFy for log measures"]
    assert analysis["follows"][0]["commit"] == "1dd6ea610017cbca65bb54735ac6db922af00e8d"
    assert analysis["follows"][1]["commit"] == "70837cec7f3aff9580f52e78162b433e9e21f473"
    assert set(manifest["libraries"]) == {"factor_analyzer", "numpy", "pandas", "scipy", "scikit-learn"}


def test_paper_dataset(client):
    r = client.post("/factor-analysis/datasets", data={
        "kind": "model", "source": "bundled", "bundled_id": "comfy-paper-inductive-miner",
    })
    manifest, readme = _archive(client, r.json()["dataset_id"], n_factors=4)

    _check_tool_and_analysis(manifest)
    assert manifest["dataset"]["provenance"] == {
        "kind": "model",
        "source": "bundled",
        "bundled": {
            "id": "comfy-paper-inductive-miner",
            "file": "datasets/model/complexity_scores-inductive-miner.csv",
            "copied_from": {
                "repository": "https://github.com/Pati-nets/ComFy",
                "commit": "1dd6ea610017cbca65bb54735ac6db922af00e8d",
            },
        },
    }
    assert "Complexity Factor Analysis v0.9, commit 0123456789abcdef0123456789abcdef01234567." in readme
    assert "the bundled dataset comfy-paper-inductive-miner, copied from https://github.com/Pati-nets/ComFy" in readme
    assert "assignment rule largest: each measure on the factor of its largest absolute loading." in readme
    assert (
        "Factors: 4 used; the Kaiser criterion suggests 2, parallel analysis 2 (pca-based, 100 simulations, "
        "95th percentile, seed 20261012)."
    ) in readme


def test_bundled_log_dataset_names_the_older_feeed(client):
    r = client.post("/factor-analysis/datasets", data={
        "kind": "log", "source": "bundled", "bundled_id": "comfy-log-pdc-training-logs",
    })
    manifest, readme = _archive(client, r.json()["dataset_id"], n_factors=1)
    origin = manifest["dataset"]["provenance"]
    assert origin["bundled"]["copied_from"]["commit"] == "70837cec7f3aff9580f52e78162b433e9e21f473"
    assert origin["features"] == {"name": "feeed", "version": None, "note": provenance.FEEED_NOTE}
    assert "feeed (an earlier version)" in readme and "event_density" in readme


def test_log_dataset_computed_with_feeed(client):
    files = [("files", (name, _xes(traces), "application/xml")) for name, traces in LOGS.items()]
    r = client.post(
        "/factor-analysis/datasets",
        data={"kind": "log", "source": "logs", "measures": json.dumps(FEATURES)},
        files=files,
    )
    assert r.status_code == 200, r.text
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "ready", d
    manifest, readme = _archive(client, d["id"], n_factors=1, auto_msa_filter=False)

    _check_tool_and_analysis(manifest)
    origin = manifest["dataset"]["provenance"]
    assert origin["kind"] == "log" and origin["source"] == "logs"
    assert origin["inputs"] == list(LOGS)
    assert origin["features"]["name"] == "feeed"
    assert origin["features"]["version"] == provenance.package_version("feeed")
    assert "complexity_factor" in origin["features"]["note"]
    assert origin["libraries"]["pm4py"] == provenance.package_version("pm4py")
    assert "discovery" not in origin and "measures" not in origin
    assert f"Features: feeed {provenance.package_version('feeed')}." in readme


def test_model_dataset_from_logs_names_each_miner_with_its_parameters(client, monkeypatch):
    """Every input goes through every miner; the manifest names the ProM4Py call and the
    parameters of each, read from the vendored ComFy code."""
    from routes import factor_analysis as fa

    # No ProM in the tests: the job is not run, the record is made when the dataset is created.
    monkeypatch.setattr(fa, "run_dataset_task", lambda *args, **kwargs: None)
    miners = ["Inductive miner", "Alpha miner", "Heuristics miner"]
    files = [("files", (name, _xes(traces), "application/xml")) for name, traces in list(LOGS.items())[:2]]
    r = client.post(
        "/factor-analysis/datasets",
        data={"kind": "model", "source": "logs", "miners": json.dumps(miners), "measures": json.dumps(["Size"])},
        files=files,
    )
    assert r.status_code == 200, r.text

    from factor_analysis import storage

    meta = storage.read_meta(_session_of(r.json()["dataset_id"]), r.json()["dataset_id"])
    origin = meta["provenance"]
    assert origin["inputs"] == ["log0.xes", "log1.xes"]
    assert origin["measures"] == provenance.COMFY
    assert origin["discovery"]["name"] == "ProM4Py"
    assert origin["discovery"]["bundle"] == "https://zenodo.org/records/13853660"
    assert origin["discovery"]["miners"] == [
        {"name": "Inductive miner", "prom4py_call": "mine_petri_net_with_inductive_miner_with_parameters",
         "parameters": {"noise_threshold": 0}},
        {"name": "Alpha miner", "prom4py_call": "mine_petri_net_with_alpha_miner_versions",
         "parameters": {"version": "CLASSIC"}},
        {"name": "Heuristics miner", "prom4py_call": "mine_petri_net_with_heuristics_miner", "parameters": {}},
    ]
    assert origin["libraries"]["pm4py"] == provenance.package_version("pm4py")


def test_dataset_stored_before_provenance_was_recorded(client):
    from factor_analysis import storage

    r = client.post("/factor-analysis/datasets", data={
        "kind": "model", "source": "bundled", "bundled_id": "comfy-paper-alpha-miner",
    })
    key = r.json()["dataset_id"]
    session = _session_of(key)
    meta = storage.read_meta(session, key)
    del meta["provenance"]
    storage._write_json(storage.dataset_dir(session, key) / "meta.json", meta)

    manifest, _ = _archive(client, key, n_factors=4)
    origin = manifest["dataset"]["provenance"]
    assert origin["recorded_at_creation"] is False
    assert origin["bundled"]["id"] == "comfy-paper-alpha-miner"


def test_tool_version_from_git_without_the_environment(monkeypatch):
    monkeypatch.delenv("APP_VERSION")
    monkeypatch.delenv("APP_COMMIT")
    monkeypatch.setattr(provenance, "_git", lambda *args: "abc123" if args[0] == "rev-parse" else "v0.9-3-gabc123")
    provenance.tool.cache_clear()
    assert provenance.tool() == {"name": "Complexity Factor Analysis", "version": "v0.9-3-gabc123", "commit": "abc123"}


def test_run_zip_names_the_tool(client):
    import asyncio
    import uuid

    import jobs_db

    r = client.post("/factor-analysis/datasets", data={
        "kind": "model", "source": "bundled", "bundled_id": "comfy-paper-alpha-miner",
    })
    session = _session_of(r.json()["dataset_id"])
    job_id = str(uuid.uuid4())

    async def seed() -> None:
        await jobs_db.create_job(job_id, algorithm_id="comfy", algorithm_name="ComFy", filename="a.xes",
                                 params={}, session_id=session)
        await jobs_db.set_job_completed(job_id, {"summary": "", "artifacts": []})

    asyncio.run(seed())
    body = client.get(f"/jobs/{job_id}/download")
    assert body.status_code == 200, body.text
    with zipfile.ZipFile(io.BytesIO(body.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["tool"]["version"] == "v0.9"
    assert manifest["tool"]["commit"] == "0123456789abcdef0123456789abcdef01234567"


def test_the_version_is_one_constant_for_the_backend_and_the_frontend():
    import json
    from pathlib import Path

    from version import REPOSITORY_URL, VERSION

    package = Path(__file__).resolve().parents[2] / "frontend" / "package.json"
    assert json.loads(package.read_text(encoding="utf-8"))["version"] == VERSION == "1.0.0-dev"
    assert REPOSITORY_URL == "https://github.com/Magiertx/complexity-factor-analysis"


def test_without_the_environment_or_a_tag_the_version_is_the_constant_and_the_commit_unknown(monkeypatch):
    from version import VERSION

    monkeypatch.delenv("APP_VERSION")
    monkeypatch.delenv("APP_COMMIT")
    monkeypatch.setattr(provenance, "_git", lambda *args: None)
    provenance.tool.cache_clear()
    assert provenance.tool() == {"name": "Complexity Factor Analysis", "version": VERSION, "commit": "unknown"}
    provenance.tool.cache_clear()


def test_the_exports_cite_the_version_and_the_address(client):
    from factor_analysis import methods
    from version import REPOSITORY_URL

    tool = {"name": "Complexity Factor Analysis", "version": "1.0.0-dev", "commit": "unknown"}
    entry = methods._tool_reference(tool, 2026)
    fields = dict(entry["fields"])
    assert "Version 1.0.0-dev" in fields["note"] and fields["url"] == REPOSITORY_URL
