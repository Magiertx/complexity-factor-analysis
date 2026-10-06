"""The datasets of a session: the list and what each was made from."""

from __future__ import annotations

import asyncio
import io
import json
import uuid

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
    assert [d["id"] for d in _list(client)] == [dataset_id]


def test_computed_dataset_records_its_inputs(client):
    body = _sample(client)
    d = client.get(f"/factor-analysis/datasets/{body['dataset_id']}").json()
    assert d["status"] == "ready", d
    assert d["inputs"] == {"files": 32, "measures": ["Size", "Density"], "sample_id": SAMPLE}
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

