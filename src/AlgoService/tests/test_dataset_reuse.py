"""A bundled dataset the session already has is opened again instead of copied."""

from __future__ import annotations

import json
import os
import time

from factor_analysis import storage

INDUCTIVE = "comfy-paper-inductive-miner"


def _create(client, **data) -> dict:
    body = {"kind": "model", "source": "bundled", "bundled_id": INDUCTIVE, **data}
    r = client.post("/factor-analysis/datasets", data=body)
    assert r.status_code == 200, r.text
    return r.json()


def _ids(client) -> list[str]:
    return [d["id"] for d in client.get("/factor-analysis/datasets").json()["datasets"]]


def test_opening_a_bundled_dataset_ten_times_gives_one_dataset(client):
    first = _create(client)
    assert first == {"dataset_id": first["dataset_id"], "status": "ready", "reused": False}
    for _ in range(9):
        assert _create(client) == {"dataset_id": first["dataset_id"], "status": "ready", "reused": True}
    assert _ids(client) == [first["dataset_id"]]


def test_a_reused_dataset_counts_as_used_now(client, isolated_jobs_dir):
    first = _create(client)["dataset_id"]
    meta = next(isolated_jobs_dir.glob(f"datasets/*/{first}/meta.json"))
    # A minute ago; older than a week, the idle cleanup would remove the session.
    earlier = time.time() - 60
    os.utime(meta, (earlier, earlier))
    assert _create(client)["dataset_id"] == first
    assert meta.stat().st_mtime > earlier + 30


def test_other_selections_names_and_kinds_get_their_own_copy(client):
    plain = _create(client)["dataset_id"]
    selected = _create(client, measures=json.dumps(["Size", "Density", "Separability", "Token split"]))
    assert not selected["reused"] and selected["dataset_id"] != plain
    assert _create(client, measures=json.dumps(["Size", "Density", "Separability", "Token split"])) == {
        **selected, "reused": True,
    }
    named = _create(client, name="My copy")
    assert not named["reused"]
    assert _create(client, name="My copy")["dataset_id"] == named["dataset_id"]
    # The name a copy got by default counts like no name.
    assert _create(client, name="Important Factors: Inductive miner")["dataset_id"] == plain
    other = _create(client, bundled_id="comfy-paper-alpha-miner")
    assert not other["reused"]
    assert len(_ids(client)) == 4


def test_reuse_false_makes_a_new_copy(client):
    first = _create(client)["dataset_id"]
    second = _create(client, reuse="false")
    assert second["reused"] is False and second["dataset_id"] != first
    # The newest copy is the one opened from then on.
    assert _create(client)["dataset_id"] == second["dataset_id"]


def test_a_deleted_or_unready_copy_is_not_reused(client, isolated_jobs_dir):
    first = _create(client)["dataset_id"]
    client.delete(f"/factor-analysis/datasets/{first}")
    second = _create(client)["dataset_id"]
    assert second != first

    session = next(isolated_jobs_dir.glob(f"datasets/*/{second}")).parent.name
    storage.update_meta(session, second, status="failed", error="broken")
    assert _create(client)["dataset_id"] != second


def test_copies_are_reused_within_a_session_only(client):
    from fastapi.testclient import TestClient
    from srv_main import app

    mine = _create(client)["dataset_id"]
    with TestClient(app) as other:
        theirs = other.post("/factor-analysis/datasets", data={
            "kind": "model", "source": "bundled", "bundled_id": INDUCTIVE,
        }).json()
    assert theirs["reused"] is False and theirs["dataset_id"] != mine


def test_a_csv_is_never_reused(client):
    csv = b"name,a,b,c\nx,1,2,3\ny,2,1,5\nz,3,7,1\nw,4,4,4\n"
    files = [("files", ("m.csv", csv, "text/csv"))]
    first = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "csv"}, files=files).json()
    second = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "csv"}, files=files).json()
    assert first["reused"] is False and second["reused"] is False
    assert first["dataset_id"] != second["dataset_id"]


def test_only_a_new_copy_counts_against_the_rate_limit(client, monkeypatch):
    """Links to a paper analysis open the copy at hand. Behind a proxy that does not pass on
    the client's address every visitor shares the 60 new datasets an hour, so opening a copy,
    which creates nothing, must not use them up."""
    from config import limiter

    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()
    try:
        first = _create(client)["dataset_id"]
        for _ in range(65):
            assert _create(client) == {"dataset_id": first, "status": "ready", "reused": True}
        limiter.reset()
        body = {"kind": "model", "source": "bundled", "bundled_id": INDUCTIVE, "reuse": "false"}
        codes = [client.post("/factor-analysis/datasets", data=body).status_code for _ in range(61)]
        assert codes == [200] * 60 + [429]
        assert _create(client)["reused"]
    finally:
        limiter.reset()
