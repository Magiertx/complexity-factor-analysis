"""Failures of datasets and uploads carry a stable code and its parameters next to the text."""

from __future__ import annotations

import asyncio

import pytest

from factor_analysis import catalog as cat
from factor_analysis import compute, storage
from tests.test_factor_analysis_api import LOGS, _post, _wait_ready, _xes


def _csv(client, text: bytes, name: str = "m.csv"):
    return _post(client, kind="model", source="csv", files=[("files", (name, text, "text/csv"))])


def _small_logs(count: int = 3) -> dict[str, bytes]:
    """Logs as small as those of the end-to-end tests: a few traces of a few events each."""
    activities = ["register", "check", "decide", "pay", "close", "archive"]
    out = {}
    for seed in range(1, count + 1):
        traces = [
            [activities[(i + j * (seed + 1)) % len(activities)] for j in range(3 + ((i + seed) % 4))]
            for i in range(3 + seed)
        ]
        out[f"log{seed}.xes"] = _xes(f"log{seed}", traces)
    return out


@pytest.mark.parametrize("body, code", [
    (b"", "empty_file"),
    (b"a,b\n", "csv_too_few_rows"),
    (b"a,b\n1,2\n", "csv_too_few_rows"),
    (b'a,b\n"1,2\n', "csv_unparseable"),
])
def test_csv_failures_have_a_code(client, body, code):
    r = _csv(client, body)
    assert r.status_code == 400, r.text
    assert r.json()["code"] == code
    assert r.json()["detail"]


def test_a_csv_with_too_few_rows_names_the_count(client):
    r = _csv(client, b"a,b\n1,2\n")
    assert r.json()["params"] == {"rows": 1, "minimum": 2}


@pytest.mark.parametrize("source, name, code", [
    ("logs", "x.xes", "xes_invalid"),
    ("pnml", "x.pnml", "pnml_invalid"),
])
def test_unreadable_xml_is_refused_with_the_code_of_its_type(client, source, name, code):
    kind = "log" if source == "logs" else "model"
    r = _post(client, kind=kind, source=source, files=[("files", (name, b"<log><trace></log>", "application/xml"))])
    assert r.status_code == 400
    body = r.json()
    assert body["code"] == code and body["params"]["file"] == name
    assert "Security validation failed" in body["detail"] and body["params"]["details"]


def test_an_empty_log_file_is_refused_as_empty(client):
    r = _post(client, kind="log", source="logs", files=[("files", ("x.xes", b"", "application/xml"))])
    assert r.status_code == 400 and r.json()["code"] == "empty_file"


def test_wrong_file_types_have_a_code(client):
    r = _post(client, kind="log", source="logs", files=[("files", ("x.txt", b"a", "text/plain"))])
    assert r.json()["code"] == "wrong_file_type" and r.json()["params"]["allowed"] == ".xes, .xes.gz"


def test_infinite_values_are_not_called_missing(client):
    rows = ["name,a,b,c"] + [f"r{i},{i},{i * i % 7},{'inf' if i % 4 else '-inf'}" for i in range(8)]
    r = _csv(client, "\n".join(rows).encode())
    d = client.get(f"/factor-analysis/datasets/{r.json()['dataset_id']}").json()
    assert [(x["measure"], x["reason"]) for x in d["dropped"]] == [("c", "non_finite")]
    assert d["dropped"][0]["params"]["infinite"] == 8


def test_renamed_duplicate_columns_are_said_in_the_statistics(client):
    r = _csv(client, b"name,a,a,b\nx,1,3,5\ny,2,1,4\nz,3,2,9\nw,4,8,1\n")
    d = client.get(f"/factor-analysis/datasets/{r.json()['dataset_id']}").json()
    assert d["measures"] == ["a", "a.1", "b"]
    rows = {m["measure"]: m for m in d["descriptives"]["measures"]}
    assert rows["a.1"]["renamed_from"] == "a"
    assert "renamed_from" not in rows["a"]


def test_features_that_fail_leave_their_group_out_for_every_log(tmp_path):
    inputs = []
    for name, data in _small_logs().items():
        (tmp_path / name).write_bytes(data)
        inputs.append(compute.Input(str(tmp_path / name), name))
    features = cat.log_features(cat.default_log_groups())
    result = compute.log_from_logs(inputs, features, lambda pct, msg: None)
    assert [s["group"] for s in result.skipped] == ["eventropies"]
    skipped = result.skipped[0]
    assert skipped["code"] == "too_few_traces" and skipped["error"].startswith("IndexError")
    assert set(skipped["inputs"]) <= {"log1.xes", "log2.xes", "log3.xes"} and skipped["inputs"]
    # Every log has the same columns: the measures of the group are gone from all of them.
    assert not set(skipped["measures"]) & set(result.table.columns)
    assert list(result.table.columns) == [f for f in features if f not in skipped["measures"]]
    assert result.table.notna().all(axis=None) or result.table.shape[0] == 3


def test_a_dataset_of_small_logs_succeeds_with_skipped_groups(client):
    files = [("files", (name, data, "application/xml")) for name, data in _small_logs().items()]
    r = _post(client, kind="log", source="logs", groups=cat.default_log_groups(), files=files)
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "ready", d
    assert [s["group"] for s in d["skipped"]] == ["eventropies"]
    assert d["n_observations"] == 3 and d["measures"]
    assert not set(d["skipped"][0]["measures"]) & set(d["measures"])


def test_a_dataset_without_any_observation_says_so_in_a_code(client, monkeypatch):
    def nothing(inputs, features, progress):
        return compute.ComputeResult(
            compute._table({}, features), [("a.xes", "ValueError: boom")], compute.Measurement("log", "logs")
        )

    monkeypatch.setattr(compute, "log_from_logs", nothing)
    files = [("files", (name, data, "application/xml")) for name, data in list(_small_logs(2).items())]
    r = _post(client, kind="log", source="logs", groups=["simple_stats"], files=files)
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "failed" and d["error_code"] == "no_observation"
    assert d["error_params"] == {"first_error": "ValueError: boom"}
    assert "No observation could be computed" in d["error"]
    assert client.get(f"/jobs/{r.json()['job_id']}").json()["error_code"] == "no_observation"


def test_a_stopped_job_aborts_the_dataset(client):
    import jobs_db

    r = _post(client, kind="model", source="pnml", bundled_id="pdc-sample-models")
    body = r.json()
    session_id = next(iter(storage.root().iterdir())).name
    storage.update_meta(session_id, body["dataset_id"], status="computing")
    asyncio.run(jobs_db.update_job_progress(body["job_id"], 0.0, "Aborted by user", status="aborted"))
    d = client.get(f"/factor-analysis/datasets/{body['dataset_id']}").json()
    assert d["status"] == "aborted" and d["error_code"] == "aborted"
    listed = {x["id"]: x for x in client.get("/factor-analysis/datasets").json()["datasets"]}
    assert listed[body["dataset_id"]]["status"] == "aborted"
    assert client.post(f"/factor-analysis/datasets/{d['id']}/analyze", json={}).status_code == 409
