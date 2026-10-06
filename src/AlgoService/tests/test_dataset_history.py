"""The datasets of a session: list, saved options, deletion with their jobs, ZIP export."""

from __future__ import annotations

import asyncio
import io
import json
import uuid
import zipfile

import numpy as np
import pandas as pd
import pytest

BUNDLED = "comfy-paper-inductive-miner"
SAMPLE = "pdc-sample-models"


def _post(client, **data):
    files = data.pop("files", None)
    for key in ("measures", "miners", "groups"):
        if key in data:
            data[key] = json.dumps(data[key])
    r = client.post("/factor-analysis/datasets", data=data, files=files)
    assert r.status_code == 200, r.text
    return r.json()


def _table(n: int = 60) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    a, b = rng.normal(size=n), rng.normal(size=n)
    columns = {"Size": a, "Density": a, "Diameter": a, "Cyclicity": b, "Separability": b, "Sequentiality": b}
    return pd.DataFrame(
        {name: 100 * (base + 0.4 * rng.normal(size=n)) for name, base in columns.items()},
        index=[f"net{i}" for i in range(n)],
    )


def _csv(client, kind: str = "model", name: str | None = None) -> str:
    text = _table().to_csv(index_label="observation")
    data = {"kind": kind, "source": "csv", **({"name": name} if name else {})}
    return _post(client, **data, files={"files": ("own.csv", io.BytesIO(text.encode()), "text/csv")})["dataset_id"]


def _bundled(client) -> str:
    return _post(client, kind="model", source="bundled", bundled_id=BUNDLED)["dataset_id"]


def _sample(client) -> dict:
    """A dataset computed by a job; the test client runs the job before it answers."""
    return _post(client, kind="model", source="pnml", bundled_id=SAMPLE, measures=["Size", "Density"])


def _session_of(dataset_id: str) -> str:
    from factor_analysis import storage

    return next(d.name for d in storage.root().iterdir() if (d / dataset_id).is_dir())


def _computing_with_job(client, status: str = "running") -> tuple[str, str]:
    """A ready dataset turned back into one whose job still runs."""
    import jobs_db
    from factor_analysis import storage

    dataset_id = _csv(client)
    session_id = _session_of(dataset_id)
    job_id = str(uuid.uuid4())

    async def make_job() -> None:
        await jobs_db.create_job(job_id, "_dataset:model", "x", "x", {"dataset_id": dataset_id}, session_id=session_id)
        await jobs_db.update_job_progress(job_id, 40.0, "Measuring", status=status)

    asyncio.run(make_job())
    storage.update_meta(session_id, dataset_id, status="computing", job_id=job_id)
    return dataset_id, job_id


def _list(client, kind: str | None = None) -> list[dict]:
    r = client.get("/factor-analysis/datasets", params={"kind": kind} if kind else None)
    assert r.status_code == 200, r.text
    return r.json()["datasets"]


@pytest.fixture
def other(isolated_jobs_dir):
    from fastapi.testclient import TestClient
    from srv_main import app

    with TestClient(app) as c:
        yield c


# --- list ---------------------------------------------------------------------------------


def test_list_is_newest_first_and_filters_by_kind(client):
    first = _csv(client, "model")
    second = _csv(client, "log")
    third = _bundled(client)

    assert [d["id"] for d in _list(client)] == [third, second, first]
    assert [d["id"] for d in _list(client, "model")] == [third, first]
    assert [d["id"] for d in _list(client, "log")] == [second]
    assert client.get("/factor-analysis/datasets?kind=process").status_code == 400

    bundled = _list(client)[0]
    assert bundled == {
        "id": third,
        "kind": "model",
        "name": "ComFy paper scores: Inductive miner",
        "source": "bundled",
        "status": "ready",
        "created_at": bundled["created_at"],
        "n_observations": 288,
        "n_measures": 12,
        "bundled_id": BUNDLED,
        "job_id": None,
        "inputs": {"files": 0},
        "has_options": False,
    }
    assert _list(client, "log")[0]["inputs"] == {"files": 1}


def test_other_sessions_see_nothing(client, other):
    dataset_id = _csv(client)
    assert _list(other) == []
    assert other.get(f"/factor-analysis/datasets/{dataset_id}").status_code == 404
    assert other.put(f"/factor-analysis/datasets/{dataset_id}/options", json={}).status_code == 404
    assert other.delete(f"/factor-analysis/datasets/{dataset_id}").status_code == 404
    assert other.delete("/factor-analysis/datasets").json() == {"deleted": 0}
    assert other.post(f"/factor-analysis/datasets/{dataset_id}/export/zip", json={}).status_code == 404
    assert [d["id"] for d in _list(client)] == [dataset_id]


def test_computed_dataset_records_its_inputs(client):
    body = _sample(client)
    d = client.get(f"/factor-analysis/datasets/{body['dataset_id']}").json()
    assert d["status"] == "ready", d
    assert d["inputs"] == {"files": 32, "measures": ["Size", "Density"], "sample_id": SAMPLE}
    assert d["options"] is None
    (summary,) = _list(client)
    assert summary["job_id"] == body["job_id"] and summary["inputs"] == d["inputs"]

    job = client.get(f"/jobs/{body['job_id']}").json()
    assert job["params"]["dataset_id"] == body["dataset_id"]
    assert job["params"]["dataset_name"] == "Petri nets of the four PDC logs"


def test_inputs_of_a_dataset_stored_before_they_were_recorded(client):
    from factor_analysis import storage

    dataset_id = _csv(client)
    session_id = _session_of(dataset_id)
    meta = storage.read_meta(session_id, dataset_id)
    del meta["inputs"]
    meta.update(
        source="logs",
        params={"miners": ["Inductive miner", "Alpha miner"], "measures": ["Size"]},
        observations=["a.xes / Inductive miner", "a.xes / Alpha miner", "b.xes / Inductive miner"],
        failures=[{"input": "b.xes / Alpha miner", "error": "x"}, {"input": "c.xes", "error": "unreadable"}],
    )
    storage._write_json(storage.dataset_dir(session_id, dataset_id) / "meta.json", meta)
    assert _list(client)[0]["inputs"] == {
        "files": 3, "miners": ["Inductive miner", "Alpha miner"], "measures": ["Size"],
    }


def test_list_fails_stale_computing_datasets(client, monkeypatch):
    from factor_analysis import storage

    dataset_id, job_id = _computing_with_job(client)
    (d,) = _list(client)
    assert d["status"] == "computing" and d["n_observations"] is None and d["n_measures"] is None

    monkeypatch.setattr(storage, "STALE_COMPUTING_S", 0)
    assert _list(client)[0]["status"] == "failed"
    assert client.get(f"/jobs/{job_id}").json()["status"] == "failed"
    assert "time limit" in client.get(f"/factor-analysis/datasets/{dataset_id}").json()["error"]


# --- options ------------------------------------------------------------------------------


def test_options_round_trip(client):
    dataset_id = _csv(client)
    options = {"excluded": ["Size"], "rotation": "promax", "n_factors": 2, "loading_threshold": 0.4}
    r = client.put(f"/factor-analysis/datasets/{dataset_id}/options", json=options)
    assert r.status_code == 204, r.text

    assert client.get(f"/factor-analysis/datasets/{dataset_id}").json()["options"] == {
        "excluded": ["Size"],
        "auto_msa_filter": True,
        "msa_threshold": 0.6,
        "bartlett_alpha": 0.05,
        "n_factors": 2,
        "rotation": "promax",
        "loading_threshold": 0.4,
        "communality_threshold": None,
    }
    assert _list(client)[0]["has_options"] is True

    client.put(f"/factor-analysis/datasets/{dataset_id}/options", json={})
    assert client.get(f"/factor-analysis/datasets/{dataset_id}").json()["options"]["excluded"] == []


def test_options_are_checked_like_an_analysis(client):
    dataset_id = _csv(client)
    url = f"/factor-analysis/datasets/{dataset_id}"
    body = {"excluded": ["Size", "Nope"]}
    r = client.put(f"{url}/options", json=body)
    assert r.status_code == 400
    assert r.json() == client.post(f"{url}/analyze", json=body).json()
    assert r.json()["code"] == "unknown_excluded"

    assert client.put(f"{url}/options", json={"rotation": "spin"}).status_code == 422
    assert client.put(f"{url}/options", json={"msa_threshold": 2}).status_code == 422
    assert client.get(url).json()["options"] is None

    missing = "00000000-0000-4000-8000-000000000000"
    assert client.put(f"/factor-analysis/datasets/{missing}/options", json={}).status_code == 404
    assert client.put("/factor-analysis/datasets/not-a-uuid/options", json={}).status_code == 400


def test_options_need_a_ready_dataset(client):
    dataset_id, _ = _computing_with_job(client)
    r = client.put(f"/factor-analysis/datasets/{dataset_id}/options", json={})
    assert r.status_code == 409


# --- delete -------------------------------------------------------------------------------


def test_delete_removes_the_dataset_its_job_and_its_interpretations(client, isolated_jobs_dir):
    from factor_analysis import storage
    from interpretation import store

    body = _sample(client)
    dataset_id, job_id = body["dataset_id"], body["job_id"]
    session_id = _session_of(dataset_id)
    meta = storage.read_meta(session_id, dataset_id)
    store.write_cached(session_id, meta, "0" * 32, {"interpretation": {}})
    cached = storage.dataset_dir(session_id, dataset_id) / "interpretations" / f"{'0' * 32}.json"
    assert cached.is_file()
    (isolated_jobs_dir / job_id).mkdir()
    (isolated_jobs_dir / job_id / "artifact.bin").write_bytes(b"x")

    assert client.delete(f"/factor-analysis/datasets/{dataset_id}").status_code == 204
    assert not storage.dataset_dir(session_id, dataset_id).exists() and not cached.exists()
    assert not (isolated_jobs_dir / job_id).exists()
    assert client.get(f"/jobs/{job_id}").status_code == 404
    assert client.get(f"/factor-analysis/datasets/{dataset_id}").status_code == 404
    assert client.delete(f"/factor-analysis/datasets/{dataset_id}").status_code == 404
    assert _list(client) == []


def test_deleting_a_computing_dataset_aborts_its_job(client, monkeypatch):
    import jobs_db

    dataset_id, job_id = _computing_with_job(client)
    updates = []
    real = jobs_db.update_job_progress

    async def spy(job, pct, msg, status="running"):
        updates.append((job, status))
        await real(job, pct, msg, status=status)

    monkeypatch.setattr(jobs_db, "update_job_progress", spy)
    assert client.delete(f"/factor-analysis/datasets/{dataset_id}").status_code == 204
    assert updates == [(job_id, "aborted")]
    assert client.get(f"/jobs/{job_id}").status_code == 404


def test_finished_jobs_are_not_aborted(client, monkeypatch):
    import jobs_db

    dataset_id, job_id = _computing_with_job(client, status="failed")
    updates = []

    async def spy(*args, **kwargs):
        updates.append(args)

    monkeypatch.setattr(jobs_db, "update_job_progress", spy)
    assert client.delete(f"/factor-analysis/datasets/{dataset_id}").status_code == 204
    assert updates == [] and client.get(f"/jobs/{job_id}").status_code == 404


def test_delete_all_counts_and_filters_by_kind(client, other, isolated_jobs_dir):
    kept = _csv(other)
    _csv(client, "model")
    _csv(client, "log")
    _bundled(client)
    job_id = _sample(client)["job_id"]
    (isolated_jobs_dir / job_id).mkdir()

    assert client.delete("/factor-analysis/datasets?kind=process").status_code == 400
    assert client.delete("/factor-analysis/datasets?kind=log").json() == {"deleted": 1}
    assert [d["kind"] for d in _list(client)] == ["model", "model", "model"]
    assert client.get(f"/jobs/{job_id}").status_code == 200
    assert client.delete("/factor-analysis/datasets").json() == {"deleted": 3}
    assert _list(client) == []
    assert client.get(f"/jobs/{job_id}").status_code == 404
    assert not (isolated_jobs_dir / job_id).exists()
    assert [d["id"] for d in _list(other)] == [kept]


def test_deleting_the_job_deletes_its_dataset(client):
    from factor_analysis import storage

    body = _sample(client)
    session_id = _session_of(body["dataset_id"])
    assert client.delete(f"/jobs/{body['job_id']}").status_code == 200
    assert client.get(f"/factor-analysis/datasets/{body['dataset_id']}").status_code == 404
    assert not storage.dataset_dir(session_id, body["dataset_id"]).exists()


def test_clearing_the_job_history_deletes_the_computed_datasets_only(client, other):
    computed = _sample(client)["dataset_id"]
    own = _csv(client)
    theirs = _sample(other)["dataset_id"]

    assert client.delete("/jobs").status_code == 200
    assert [d["id"] for d in _list(client)] == [own]
    assert client.get(f"/factor-analysis/datasets/{computed}").status_code == 404
    assert [d["id"] for d in _list(other)] == [theirs]


# --- ZIP export ---------------------------------------------------------------------------


def _read_csv(archive: zipfile.ZipFile, name: str, **kwargs) -> pd.DataFrame:
    # The default parser of pandas can be off in the last digit.
    return pd.read_csv(io.BytesIO(archive.read(name)), float_precision="round_trip", **kwargs)


def _zip(client, dataset_id: str, **body) -> zipfile.ZipFile:
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/export/zip", json=body)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    return zipfile.ZipFile(io.BytesIO(r.content))


def test_zip_of_a_bundled_dataset(client):
    from config import APP_NAME
    from factor_analysis import catalog as cat

    dataset_id = _bundled(client)
    url = f"/factor-analysis/datasets/{dataset_id}"
    body = {"n_factors": 3, "excluded": ["Density"]}
    r = client.post(f"{url}/export/zip", json=body)
    assert 'filename="ComFy-paper-scores-Inductive-miner-factor-analysis.zip"' in r.headers["content-disposition"]
    archive = zipfile.ZipFile(io.BytesIO(r.content))

    names = archive.namelist()
    assert set(names) == {
        "manifest.json", "README.txt", "analysis.json", "dataset.csv", "loadings.csv", "loadings.tex",
        "eigenvalues.csv", "msa.csv",
    }
    analysis = client.post(f"{url}/analyze", json=body).json()
    assert json.loads(archive.read("analysis.json")) == analysis
    assert archive.read("dataset.csv") == client.get(f"{url}/download").content
    assert archive.read("loadings.csv") == client.post(f"{url}/export", json={**body, "format": "csv"}).content
    assert archive.read("loadings.tex") == client.post(f"{url}/export", json={**body, "format": "latex"}).content

    manifest = json.loads(archive.read("manifest.json"))
    entry = cat.bundled_entry(BUNDLED)
    detail = client.get(url).json()
    assert manifest["app"] == APP_NAME and manifest["created_at"].endswith("+00:00")
    assert manifest["dataset"] == {
        "id": dataset_id,
        "name": "ComFy paper scores: Inductive miner",
        "kind": "model",
        "source": "bundled",
        "bundled_id": BUNDLED,
        "collection": "comfy-paper",
        "citation": entry["citation"],
        "license": entry["license"],
        "inputs": {"files": 0},
        "n_observations": 288,
        "measures": detail["measures"],
        "dropped": [{"name": "Number of empty sequence flows", "reason": "constant"}],
    }
    assert manifest["analysis_params"] == {
        "excluded": ["Density"], "auto_msa_filter": True, "msa_threshold": 0.6, "bartlett_alpha": 0.05,
        "n_factors": 3, "rotation": "varimax", "loading_threshold": 0.35, "communality_threshold": 0.0,
    }
    assert set(manifest["libraries"]) >= {"factor_analyzer", "numpy", "pandas", "scipy"}
    assert all(manifest["libraries"].values())
    assert [f["name"] for f in manifest["files"]] == names
    readme = archive.read("README.txt").decode()
    assert all(name in readme for name in names)

    eigenvalues = _read_csv(archive, "eigenvalues.csv")
    assert list(eigenvalues.columns) == ["factor", "eigenvalue"]
    assert eigenvalues["eigenvalue"].tolist() == analysis["eigenvalues"]
    msa = _read_csv(archive, "msa.csv", keep_default_na=False).set_index("measure")
    assert list(msa.index) == detail["measures"]
    assert msa.loc["Density", "status"] == "excluded" and msa.loc["Density", "msa"] == ""
    removed = {m["measure"]: m for m in analysis["msa_filter"]["removed"]}
    assert removed
    for measure, step in removed.items():
        assert msa.loc[measure, "status"] == f"removed in step {step['step']}"
        assert float(msa.loc[measure, "msa"]) == step["msa"]
    for measure in analysis["used_measures"]:
        assert msa.loc[measure, "status"] == "used"
        assert float(msa.loc[measure, "msa"]) == analysis["kmo"]["per_measure"][measure]


def test_zip_of_an_oblique_rotation(client):
    dataset_id = _csv(client)
    body = {"rotation": "oblimin", "n_factors": 2, "auto_msa_filter": False}
    archive = _zip(client, dataset_id, **body)
    assert {"structure.csv", "factor-correlations.csv"} <= set(archive.namelist())
    analysis = json.loads(archive.read("analysis.json"))

    structure = _read_csv(archive, "structure.csv", index_col=0)
    assert list(structure.columns) == ["Factor 1", "Factor 2"]
    assert structure.to_numpy().tolist() == list(analysis["structure_loadings"].values())
    correlations = _read_csv(archive, "factor-correlations.csv", index_col=0)
    assert correlations.to_numpy().tolist() == analysis["factor_correlations"]
    assert "get_communalities" in archive.read("README.txt").decode()

    assert "structure.csv" not in _zip(client, dataset_id, n_factors=2).namelist()


def test_readme_reproduces_the_loadings(client, tmp_path, monkeypatch):
    import factor_analyzer.factor_analyzer as fa_module

    archive = _zip(client, _csv(client), n_factors=2, excluded=["Diameter"])
    archive.extractall(tmp_path)
    readme = archive.read("README.txt").decode().splitlines()
    start = next(i for i, line in enumerate(readme) if line.startswith("  In Python"))
    code = "\n".join(line[4:] for line in readme[start:] if line.startswith("    ") or not line.strip())

    # The snippet patches factor_analyzer the way core.py does; undo it after the test.
    monkeypatch.setattr(fa_module, "check_array", fa_module.check_array)
    monkeypatch.chdir(tmp_path)
    scope: dict = {}
    exec(code, scope)
    loadings = json.loads(archive.read("analysis.json"))["loadings"]
    assert list(scope["data"].columns) == list(loadings)
    # Same libraries, same process: not close, but equal.
    assert scope["fa"].loadings_.tolist() == list(loadings.values())


def test_zip_includes_a_stored_interpretation_only(client):
    from factor_analysis import storage
    from interpretation import store
    from interpretation.payload import data_hash, effective_params
    from routes.factor_analysis import AnalyzeRequest

    dataset_id = _csv(client)
    body = {"n_factors": 2, "auto_msa_filter": False}
    assert not any(n.startswith("interpretation") for n in _zip(client, dataset_id, **body).namelist())

    session_id = _session_of(dataset_id)
    meta = storage.read_meta(session_id, dataset_id)
    digest = data_hash(storage.load_matrix(session_id, dataset_id))
    params = effective_params(AnalyzeRequest(**body).params("model"), 2)
    entry = {
        "kind": "model", "data_hash": digest, "params": params, "language": "de", "model": "test-model",
        "prompt_version": "2", "created_at": "2026-10-06T10:00:00+00:00",
        "interpretation": {"factors": [], "overall": "Zwei Faktoren.", "caveats": []},
    }
    store.write_cached(session_id, meta, store.key_for(meta, digest, params, "de"), entry)
    # The interpret endpoint finds the same entry without calling the API.
    url = f"/factor-analysis/datasets/{dataset_id}/interpret"
    assert client.post(url, json={**body, "language": "de", "cached_only": True}).status_code == 200

    archive = _zip(client, dataset_id, **body, language="de")
    assert json.loads(archive.read("interpretation.de.json")) == entry
    assert "interpretation.de.json" in [f["name"] for f in json.loads(archive.read("manifest.json"))["files"]]
    assert "interpretation.en.json" not in _zip(client, dataset_id, **body).namelist()
    other = _zip(client, dataset_id, **body, language="de", rotation="promax").namelist()
    assert not any(n.startswith("interpretation") for n in other)


def test_zip_includes_a_precomputed_interpretation(client, monkeypatch, tmp_path):
    from factor_analysis import storage
    from interpretation import client as claude_client
    from interpretation import store
    from interpretation.payload import data_hash, default_params, effective_params

    monkeypatch.setattr(store, "PRECOMPUTED_DIR", tmp_path / "precomputed")
    dataset_id = _bundled(client)
    session_id = _session_of(dataset_id)
    analysis = client.post(f"/factor-analysis/datasets/{dataset_id}/analyze", json={}).json()
    entry = {
        "dataset_id": BUNDLED, "kind": "model",
        "data_hash": data_hash(storage.load_matrix(session_id, dataset_id)),
        "params": effective_params(default_params("model"), analysis["n_factors"]),
        "language": "en", "model": "test-model", "prompt_version": "2",
        "prompt_digest": claude_client.PROMPT_DIGEST, "created_at": "2026-10-06T10:00:00+00:00",
        "interpretation": {"factors": [], "overall": "Two factors.", "caveats": []},
    }
    store.write_precomputed(BUNDLED, "en", entry)
    assert json.loads(_zip(client, dataset_id).read("interpretation.en.json")) == entry


def test_zip_errors_match_the_analysis(client):
    dataset_id = _bundled(client)
    url = f"/factor-analysis/datasets/{dataset_id}"
    r = client.post(f"{url}/export/zip", json={"n_factors": 12})
    assert r.status_code == 400
    assert r.json() == client.post(f"{url}/analyze", json={"n_factors": 12}).json()
    assert r.json()["code"] == "n_factors_range"
    assert client.post(f"{url}/export/zip", json={"language": "fr"}).status_code == 422
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.post(f"/factor-analysis/datasets/{missing}/export/zip", json={}).status_code == 404

    computing, _ = _computing_with_job(client)
    assert client.post(f"/factor-analysis/datasets/{computing}/export/zip", json={}).status_code == 409
