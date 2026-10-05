"""HTTP tests for /factor-analysis: catalog, datasets from every source, analyze, export."""

from __future__ import annotations

import gzip
import io
import json
import time
from datetime import datetime, timedelta

import pytest


def _wait_ready(client, dataset_id: str, timeout: float = 120.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        d = client.get(f"/factor-analysis/datasets/{dataset_id}").json()
        if d["status"] != "computing":
            return d
        time.sleep(0.1)
    pytest.fail(f"dataset {dataset_id} still computing after {timeout}s")


def _xes(name: str, traces: list[list[str]]) -> bytes:
    import pm4py
    from pm4py.objects.log.obj import Event, EventLog, Trace

    log = EventLog()
    base = datetime(2024, 1, 1)
    for i, activities in enumerate(traces):
        trace = Trace()
        trace.attributes["concept:name"] = f"{name}_{i}"
        for j, act in enumerate(activities):
            ev = Event()
            ev["concept:name"] = act
            ev["time:timestamp"] = base + timedelta(hours=i * 10 + j)
            trace.append(ev)
        log.append(trace)
    buf = io.BytesIO()
    import tempfile, os

    fd, path = tempfile.mkstemp(suffix=".xes")
    os.close(fd)
    try:
        pm4py.write_xes(log, path)
        with open(path, "rb") as f:
            buf.write(f.read())
    finally:
        os.remove(path)
    return buf.getvalue()


LOGS = {
    "seq.xes": [["a", "b", "c"]] * 3 + [["a", "b", "c", "d"]],
    "choice.xes": [["a", "b", "d"], ["a", "c", "d"], ["a", "b", "d"], ["a", "c", "d", "e"], ["a", "e"]],
    "loop.xes": [["a", "b", "b", "c"], ["a", "b", "c"], ["a", "b", "b", "b", "c"], ["x", "a"]],
}


@pytest.fixture(scope="module")
def xes_files() -> dict[str, bytes]:
    return {name: _xes(name, traces) for name, traces in LOGS.items()}


def cat_features(groups: list[str]) -> list[str]:
    from factor_analysis.catalog import log_features

    return log_features(groups)


def _post(client, **data):
    files = data.pop("files", None)
    for key in ("measures", "miners", "groups"):
        if key in data:
            data[key] = json.dumps(data[key])
    return client.post("/factor-analysis/datasets", data=data, files=files)


# --- catalog ------------------------------------------------------------------------------


def test_catalog_model(client):
    r = client.get("/factor-analysis/catalog?kind=model")
    assert r.status_code == 200
    cat = r.json()
    assert cat["kind"] == "model"
    assert cat["sources"] == ["bundled", "csv", "logs", "pnml"]
    keys = [m["key"] for m in cat["measures"]]
    assert "Size" in keys and "Depth" in keys
    assert next(m for m in cat["measures"] if m["key"] == "Depth")["slow"] is True
    assert "Depth" not in cat["defaults"]["measures"]
    assert {"key": "Inductive miner", "name": "Inductive miner"} in cat["miners"]
    assert cat["defaults"]["miners"] == ["Inductive miner"]
    bundled = {b["id"]: b for b in cat["bundled"]}
    assert len(bundled) == 7
    assert bundled["comfy-paper-inductive-miner"]["observations"] == 288
    assert bundled["comfy-paper-inductive-miner"]["measures"] == 13
    assert "pending" in bundled["comfy-paper-inductive-miner"]["license"]
    samples = {s["id"]: s for s in cat["samples"]}
    assert samples["pdc-sample-models"]["source"] == "pnml"
    assert len(samples["pdc-sample-models"]["files"]) == 32
    assert samples["pdc-sample-logs"]["source"] == "logs"


def test_catalog_log(client):
    cat = client.get("/factor-analysis/catalog?kind=log").json()
    assert cat["sources"] == ["bundled", "csv", "logs"]
    assert "miners" not in cat
    groups = [g["key"] for g in cat["groups"]]
    assert groups[0] == "simple_stats" and "dfg_based" in groups
    assert "comparison_based" not in cat["defaults"]["groups"]
    measure = next(m for m in cat["measures"] if m["key"] == "n_variants")
    assert measure["group"] == "simple_stats"
    assert [b["id"] for b in cat["bundled"]] == ["comfy-log-pdc-training-logs"]
    assert cat["bundled"][0]["license"] == "MIT"
    assert [s["id"] for s in cat["samples"]] == ["pdc-sample-logs"]


def test_catalog_unknown_kind(client):
    assert client.get("/factor-analysis/catalog?kind=process").status_code == 400


# --- bundled and CSV ----------------------------------------------------------------------


@pytest.fixture
def inductive(client) -> str:
    r = _post(client, kind="model", source="bundled", bundled_id="comfy-paper-inductive-miner")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ready"
    return r.json()["dataset_id"]


def test_bundled_dataset(client, inductive):
    d = client.get(f"/factor-analysis/datasets/{inductive}").json()
    assert d["status"] == "ready" and d["kind"] == "model" and d["source"] == "bundled"
    assert d["name"] == "ComFy paper scores: Inductive miner"
    assert d["n_observations"] == 288 and len(d["observations"]) == 288
    assert d["observations"][0] == "pdc2025_02000100.xes / Inductive miner"
    assert len(d["measures"]) == 12 and len(d["values"][0]) == 12
    assert d["dropped"] == [{"measure": "Number of empty sequence flows", "reason": "constant"}]
    assert d["dropped_rows"] == 0 and d["truncated"] is False
    assert d["created_at"]


def test_bundled_preview_is_truncated(client):
    r = _post(client, kind="log", source="bundled", bundled_id="comfy-log-pdc-training-logs")
    d = client.get(f"/factor-analysis/datasets/{r.json()['dataset_id']}").json()
    assert d["n_observations"] == 2112
    assert len(d["values"]) == 2000 and len(d["observations"]) == 2000
    assert d["truncated"] is True


def test_bundled_measure_selection(client):
    r = _post(client, kind="model", source="bundled", bundled_id="comfy-paper-alpha-miner",
              measures=["Size", "Density", "Separability"])
    d = client.get(f"/factor-analysis/datasets/{r.json()['dataset_id']}").json()
    assert d["measures"] == ["Size", "Density", "Separability"]
    r = _post(client, kind="model", source="bundled", bundled_id="comfy-paper-alpha-miner", measures=["Nope"])
    assert r.status_code == 400


@pytest.mark.parametrize("data, needle", [
    ({"kind": "graph", "source": "bundled"}, "Unknown kind"),
    ({"kind": "model", "source": "ftp"}, "Unknown source"),
    ({"kind": "log", "source": "pnml"}, "Unknown source"),
    ({"kind": "model", "source": "bundled", "bundled_id": "comfy-log-pdc-training-logs"}, "Unknown bundled"),
    ({"kind": "model", "source": "logs", "miners": "not json"}, "Invalid JSON"),
    ({"kind": "model", "source": "logs"}, "Upload at least one file"),
    ({"kind": "model", "source": "logs", "miners": json.dumps(["Nope"])}, "Unknown miner"),
    ({"kind": "log", "source": "logs", "groups": json.dumps(["nope"])}, "Unknown feature group"),
])
def test_create_dataset_errors(client, data, needle):
    r = client.post("/factor-analysis/datasets", data=data)
    assert r.status_code == 400
    assert needle in r.json()["detail"]


def test_csv_upload_with_labels_semicolons_and_decimal_commas(client):
    rows = ["name;a;b;c;text"] + [f"log{i};{i},5;{i * i};{(i * 7) % 5};x" for i in range(8)]
    r = _post(client, kind="log", source="csv", files=[("files", ("scores.csv", "\n".join(rows).encode(), "text/csv"))])
    assert r.status_code == 200, r.text
    d = client.get(f"/factor-analysis/datasets/{r.json()['dataset_id']}").json()
    assert d["name"] == "scores.csv" and d["source"] == "csv"
    assert d["observations"][:2] == ["log0", "log1"]
    assert d["measures"] == ["a", "b", "c"]
    assert d["values"][1] == [1.5, 1.0, 2.0]
    assert d["dropped"] == [{
        "measure": "text", "reason": "non_numeric", "detail": "contains the value 'x'", "params": {"value": "x"},
    }]


def test_csv_without_label_column_uses_row_numbers(client):
    csv_text = "a,b\n1,2\n2,5\n3,1\n"
    r = _post(client, kind="model", source="csv", name="mine", files=[("files", ("m.csv", csv_text.encode(), "text/csv"))])
    d = client.get(f"/factor-analysis/datasets/{r.json()['dataset_id']}").json()
    assert d["name"] == "mine"
    assert d["observations"] == ["1", "2", "3"]


@pytest.mark.parametrize("files, needle", [
    ([("files", ("m.txt", b"a,b\n1,2\n", "text/plain"))], "wrong file type"),
    ([("files", ("m.csv", b"a,b\n1,2\n", "text/csv")), ("files", ("n.csv", b"a,b\n1,2\n", "text/csv"))], "exactly one"),
    ([("files", ("m.csv", b"label,text\nx,y\nz,w\n", "text/csv"))], "fewer than 2 numeric"),
    ([("files", ("m.csv", b"", "text/csv"))], "could not be parsed"),
    ([("files", ("m.csv", b'a,b\n"1,2\n', "text/csv"))], "could not be parsed"),
])
def test_csv_errors(client, files, needle):
    r = _post(client, kind="model", source="csv", files=files)
    assert r.status_code == 400, r.text
    assert needle in r.json()["detail"]


def test_csv_size_limit(client, monkeypatch):
    from routes import factor_analysis as fa

    monkeypatch.setattr(fa, "MAX_FILE_SIZE", 10)
    r = _post(client, kind="model", source="csv", files=[("files", ("m.csv", b"a,b\n1,2\n3,4\n", "text/csv"))])
    assert r.status_code == 400
    assert "exceeds" in r.json()["detail"]


# --- dataset access -----------------------------------------------------------------------


def test_datasets_are_session_scoped(client, inductive):
    from fastapi.testclient import TestClient
    from srv_main import app

    with TestClient(app) as other:
        assert other.get(f"/factor-analysis/datasets/{inductive}").status_code == 404
        assert other.post(f"/factor-analysis/datasets/{inductive}/analyze", json={}).status_code == 404


def test_dataset_id_validation(client):
    assert client.get("/factor-analysis/datasets/..%2F..%2Fetc").status_code in (400, 404)
    assert client.get("/factor-analysis/datasets/not-a-uuid").status_code == 400
    assert client.get("/factor-analysis/datasets/00000000-0000-4000-8000-000000000000").status_code == 404


def test_other_uuid_spellings_reach_the_same_dataset(client, inductive):
    r = client.get(f"/factor-analysis/datasets/{{{inductive.upper()}}}")
    assert r.status_code == 200 and r.json()["id"] == inductive


def test_download(client, inductive):
    r = client.get(f"/factor-analysis/datasets/{inductive}/download")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert 'filename="ComFy-paper-scores-Inductive-miner.csv"' in r.headers["content-disposition"]
    lines = r.text.splitlines()
    assert lines[0].startswith("observation,Size,Connector Mismatch")
    assert len(lines) == 289


def test_download_uploaded_again_keeps_its_measures(client):
    csv_text = "a,b,c\n1,2,0\n2,5,1\n3,1,1\n4,4,0\n"
    first = _post(client, kind="model", source="csv", files=[("files", ("m.csv", csv_text.encode(), "text/csv"))])
    download = client.get(f"/factor-analysis/datasets/{first.json()['dataset_id']}/download").text
    assert download.startswith("observation,a,b,c")
    again = _post(client, kind="model", source="csv", files=[("files", ("m.csv", download.encode(), "text/csv"))])
    d = client.get(f"/factor-analysis/datasets/{again.json()['dataset_id']}").json()
    assert d["measures"] == ["a", "b", "c"]
    assert d["observations"] == ["1", "2", "3", "4"]


def test_csv_row_and_column_limits(client, monkeypatch):
    from routes import factor_analysis as fa

    monkeypatch.setattr(fa, "MAX_CSV_ROWS", 3)
    csv_text = "a,b\n" + "".join(f"{i},{i * i}\n" for i in range(5))
    r = _post(client, kind="model", source="csv", files=[("files", ("m.csv", csv_text.encode(), "text/csv"))])
    assert r.status_code == 400 and "too large" in r.json()["detail"]

    monkeypatch.setattr(fa, "MAX_CSV_COLUMNS", 2)
    csv_text = "name,a,b,c\nx,1,2,3\ny,2,1,0\n"
    r = _post(client, kind="model", source="csv", files=[("files", ("m.csv", csv_text.encode(), "text/csv"))])
    assert r.status_code == 400 and "too large" in r.json()["detail"]


# --- analyze and export -------------------------------------------------------------------


def test_analyze_defaults(client, inductive):
    r = client.post(f"/factor-analysis/datasets/{inductive}/analyze", json={})
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["n_observations"] == 288
    assert a["bartlett"]["passed"] is True and a["bartlett"]["alpha"] == 0.05
    assert a["kmo"]["threshold"] == 0.6 and a["kmo"]["passed"] is True
    assert {x["measure"] for x in a["msa_filter"]["removed"]} == {"Sequentiality", "Control flow complexity"}
    assert a["msa_filter"]["enabled"] is True
    assert a["n_factors"] == a["suggested_n_factors"] == 2
    assert a["rotation"] == "varimax"
    assert len(a["eigenvalues"]) == len(a["used_measures"]) == 10
    assert all(len(v) == 2 for v in a["loadings"].values())
    assert set(a["communalities"]) == set(a["uniquenesses"]) == set(a["used_measures"])
    assert len(a["variance"]["cumulative"]) == 2
    assert a["loading_threshold"] == 0.35 and a["communality_threshold"] == 0.0
    assert a["structure_loadings"] is None and a["factor_correlations"] is None
    assigned = [m["measure"] for f in a["factors"] for m in f["measures"]]
    assert sorted(assigned + a["unassigned"]) == sorted(a["used_measures"])
    assert isinstance(a["warnings"], list)


def test_analyze_parameters(client, inductive):
    r = client.post(f"/factor-analysis/datasets/{inductive}/analyze", json={
        "excluded": ["Density"], "auto_msa_filter": False, "n_factors": 3, "rotation": "promax",
        "loading_threshold": 0.5, "msa_threshold": 0.5, "bartlett_alpha": 0.01,
    })
    assert r.status_code == 200, r.text
    a = r.json()
    assert "Density" not in a["used_measures"] and len(a["used_measures"]) == 11
    assert a["msa_filter"] == {"enabled": False, "removed": []}
    assert a["n_factors"] == 3 and a["rotation"] == "promax"
    assert a["kmo"]["threshold"] == 0.5 and a["bartlett"]["alpha"] == 0.01
    for factor in a["factors"]:
        assert all(abs(m["loading"]) >= 0.5 for m in factor["measures"])


@pytest.mark.parametrize("body, needle", [
    ({"n_factors": 10}, "at most 9"),
    ({"excluded": ["Size", "Density", "Separability", "Token split", "Connector Mismatch",
                   "Connector Heterogeneity", "Average connector degree", "Maximum connector degree",
                   "Coefficient of network connectivity", "Number of duplicate tasks"]}, "At least 3"),
])
def test_analyze_errors(client, inductive, body, needle):
    r = client.post(f"/factor-analysis/datasets/{inductive}/analyze", json=body)
    assert r.status_code == 400
    assert needle in r.json()["detail"]
    assert r.json()["code"] in ("n_factors_range", "too_few_measures")


def test_analyze_oblique_returns_structure_and_factor_correlations(client, inductive):
    r = client.post(f"/factor-analysis/datasets/{inductive}/analyze", json={"n_factors": 3, "rotation": "oblimin"})
    a = r.json()
    assert set(a["structure_loadings"]) == set(a["loadings"])
    assert len(a["factor_correlations"]) == 3
    assert a["variance"]["proportion"] is None and 0 < a["variance"]["explained"] < 1
    varimax = client.post(f"/factor-analysis/datasets/{inductive}/analyze", json={"n_factors": 3}).json()
    assert a["communalities"] == pytest.approx(varimax["communalities"])


def test_log_datasets_default_to_the_thresholds_of_comfy_for_log_measures(client):
    rows = ["name,a,b,c,d"] + [f"log{i},{i},{i * i % 7},{(i * 3) % 5},{i % 4 + i}" for i in range(30)]
    r = _post(client, kind="log", source="csv", files=[("files", ("l.csv", "\n".join(rows).encode(), "text/csv"))])
    a = client.post(f"/factor-analysis/datasets/{r.json()['dataset_id']}/analyze", json={"auto_msa_filter": False}).json()
    assert a["loading_threshold"] == 0.5 and a["communality_threshold"] == 0.5


def test_analyze_rejects_invalid_parameters(client, inductive):
    r = client.post(f"/factor-analysis/datasets/{inductive}/analyze", json={"rotation": "spin"})
    assert r.status_code == 422


def test_analyze_too_few_observations(client):
    csv_text = "a,b,c,d\n1,2,3,1\n2,5,1,0\n3,1,4,2\n"
    r = _post(client, kind="model", source="csv", files=[("files", ("m.csv", csv_text.encode(), "text/csv"))])
    r = client.post(f"/factor-analysis/datasets/{r.json()['dataset_id']}/analyze", json={})
    assert r.status_code == 400
    assert "too few" in r.json()["detail"]
    assert r.json()["code"] == "too_few_observations" and r.json()["params"]["needed"] == 5


def test_export_csv_and_latex(client, inductive):
    body = {"n_factors": 4, "rotation": "varimax"}
    r = client.post(f"/factor-analysis/datasets/{inductive}/export", json={**body, "format": "csv"})
    assert r.status_code == 200
    assert 'filename="ComFy-paper-scores-Inductive-miner-loadings.csv"' in r.headers["content-disposition"]
    lines = r.text.splitlines()
    assert lines[0] == "measure,Factor 1,Factor 2,Factor 3,Factor 4,communality"
    assert len(lines) == 11

    r = client.post(f"/factor-analysis/datasets/{inductive}/export", json={**body, "format": "latex"})
    assert r.status_code == 200
    assert r.headers["content-disposition"].endswith('-loadings.tex"')
    assert "\\begin{tabular}{lrrrrr}" in r.text and "\\mathbf{" in r.text

    r = client.post(f"/factor-analysis/datasets/{inductive}/export", json={"format": "pdf"})
    assert r.status_code == 422


# --- computed datasets --------------------------------------------------------------------


def _pnml_bytes(traces: list[list[str]], noise: float = 0.0) -> bytes:
    import os
    import tempfile

    import pm4py

    with tempfile.TemporaryDirectory() as d:
        xes_path = os.path.join(d, "l.xes")
        with open(xes_path, "wb") as f:
            f.write(_xes("l", traces))
        log = pm4py.read_xes(xes_path)
        net, im, fm = pm4py.discover_petri_net_inductive(log, noise_threshold=noise)
        out = os.path.join(d, "n.pnml")
        pm4py.write_pnml(net, im, fm, out)
        with open(out, "rb") as f:
            return f.read()


def test_pnml_upload_runs_as_job(client):
    files = [("files", (f"{name}.pnml", _pnml_bytes(traces), "application/xml")) for name, traces in LOGS.items()]
    r = _post(client, kind="model", source="pnml", measures=["Size", "Density", "Depth"], files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "computing" and body["job_id"]

    d = _wait_ready(client, body["dataset_id"])
    assert d["status"] == "ready", d
    assert d["job_id"] == body["job_id"]
    assert d["observations"] == ["seq.xes.pnml", "choice.xes.pnml", "loop.xes.pnml"]
    assert set(d["measures"]) <= {"Size", "Density", "Depth"}

    job = client.get(f"/jobs/{body['job_id']}").json()
    assert job["status"] == "completed"
    labels = [a["label"] for a in job["result"]["artifacts"]]
    assert "Measure values" in labels


def test_pnml_sample_bundle(client):
    r = _post(client, kind="model", source="pnml", bundled_id="pdc-sample-models")
    assert r.status_code == 200, r.text
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "ready" and d["n_observations"] == 32
    assert d["name"] == "Petri nets of the four PDC logs"
    a = client.post(f"/factor-analysis/datasets/{d['id']}/analyze", json={}).json()
    assert a["bartlett"]["passed"] is True


def test_pnml_errors(client, monkeypatch):
    from routes import factor_analysis as fa

    doctype = b'<?xml version="1.0"?><!DOCTYPE pnml [<!ENTITY x SYSTEM "file:///etc/passwd">]><pnml/>'
    r = _post(client, kind="model", source="pnml", files=[("files", ("a.pnml", doctype, "application/xml"))])
    assert r.status_code == 400 and "DOCTYPE" in r.json()["detail"]

    r = _post(client, kind="model", source="pnml", files=[("files", ("a.xes", b"<log/>", "application/xml"))])
    assert r.status_code == 400 and "wrong file type" in r.json()["detail"]

    monkeypatch.setattr(fa, "MAX_PNML_FILES", 1)
    files = [("files", (f"{i}.pnml", b"<pnml/>", "application/xml")) for i in range(2)]
    r = _post(client, kind="model", source="pnml", files=files)
    assert r.status_code == 400 and "At most 1" in r.json()["detail"]

    r = _post(client, kind="model", source="pnml", bundled_id="pdc-sample-logs")
    assert r.status_code == 400 and "Unknown sample" in r.json()["detail"]


@pytest.fixture
def fake_miner(monkeypatch):
    """A miner that runs pm4py's inductive miner locally instead of ProM4Py."""
    import algorithms._prom4py
    from algorithms import comfy

    class FakeMiner:
        name = "Fake miner"

        def __str__(self):
            return self.name

        def discover_for(self, event_log):
            import pm4py

            return pm4py.discover_petri_net_inductive(event_log)

    monkeypatch.setitem(comfy.MINERS_BY_NAME, "Fake miner", FakeMiner())
    monkeypatch.setattr(algorithms._prom4py, "get_prom4py", lambda: None)
    return "Fake miner"


def test_failing_inputs_fail_the_dataset(client, monkeypatch, xes_files):
    import algorithms._prom4py
    from algorithms import comfy

    class BrokenMiner:
        def __str__(self):
            return "Broken miner"

        def discover_for(self, event_log):
            raise RuntimeError("ProM4Py is not reachable")

    monkeypatch.setitem(comfy.MINERS_BY_NAME, "Broken miner", BrokenMiner())
    monkeypatch.setattr(algorithms._prom4py, "get_prom4py", lambda: None)
    files = [("files", ("seq.xes", xes_files["seq.xes"], "application/xml"))]
    r = _post(client, kind="model", source="logs", miners=["Broken miner"], files=files)
    assert r.status_code == 200
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "failed"
    assert "ProM4Py is not reachable" in d["error"]
    assert client.get(f"/jobs/{r.json()['job_id']}").json()["status"] == "failed"
    assert client.post(f"/factor-analysis/datasets/{d['id']}/analyze", json={}).status_code == 409


def test_failing_input_is_listed_on_the_dataset(client, fake_miner, monkeypatch, xes_files):
    from algorithms import comfy

    real = comfy.MINERS_BY_NAME[fake_miner]

    class PickyMiner:
        calls = 0

        def __str__(self):
            return fake_miner

        def discover_for(self, event_log):
            PickyMiner.calls += 1
            if PickyMiner.calls == 1:
                raise RuntimeError("no lpsolve55 in java.library.path")
            return real.discover_for(event_log)

    monkeypatch.setitem(comfy.MINERS_BY_NAME, fake_miner, PickyMiner())
    files = [("files", (name, data, "application/xml")) for name, data in xes_files.items()]
    r = _post(client, kind="model", source="logs", miners=[fake_miner], measures=["Size", "Token split"], files=files)
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "ready", d
    failed = [f["input"] for f in d["failures"]]
    assert len(failed) == 1 and failed[0].endswith(f"/ {fake_miner}")
    assert d["n_observations"] == len(xes_files) - 1
    assert not set(failed) & set(d["observations"])
    assert "lpsolve55" in d["failures"][0]["error"]


def test_input_without_any_value_drops_its_row(client, fake_miner, monkeypatch, xes_files):
    from algorithms import comfy

    real = comfy.measure_value
    calls = {"n": 0}

    def first_net_fails(measure, net, im, fm):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise RuntimeError("measure failed")
        return real(measure, net, im, fm)

    monkeypatch.setattr(comfy, "measure_value", first_net_fails)
    files = [("files", (name, data, "application/xml")) for name, data in xes_files.items()]
    r = _post(client, kind="model", source="logs", miners=[fake_miner], measures=["Size", "Token split"], files=files)
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "ready", d
    assert "Size" in d["measures"]
    assert d["observations"] == [f"{name} / Fake miner" for name in list(xes_files)[1:]]
    assert any("row was dropped" in f["error"] for f in d["failures"])


def test_dataset_without_measures_left_fails(client, fake_miner, monkeypatch, xes_files):
    from algorithms import comfy

    def always_fails(measure, net, im, fm):
        raise RuntimeError("measure failed")

    monkeypatch.setattr(comfy, "measure_value", always_fails)
    files = [("files", (name, data, "application/xml")) for name, data in xes_files.items()]
    r = _post(client, kind="model", source="logs", miners=[fake_miner], measures=["Size", "Token split"], files=files)
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "failed"
    assert "measure(s) gave values" in d["error"] and "measure failed" in d["error"]


def test_model_dataset_from_logs(client, fake_miner, xes_files):
    files = [("files", (name, data, "application/xml")) for name, data in xes_files.items()]
    r = _post(client, kind="model", source="logs", miners=[fake_miner], measures=["Size", "Token split"], files=files)
    assert r.status_code == 200, r.text
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "ready", d
    assert d["observations"] == [f"{name} / Fake miner" for name in xes_files]


def test_logs_accept_gzip_and_reject_doctype(client, fake_miner, xes_files):
    gz = gzip.compress(xes_files["seq.xes"])
    files = [("files", ("seq.xes.gz", gz, "application/gzip")), ("files", ("loop.xes", xes_files["loop.xes"], "application/xml"))]
    r = _post(client, kind="model", source="logs", miners=[fake_miner], measures=["Size", "Token split"], files=files)
    assert r.status_code == 200, r.text
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "ready"
    assert d["observations"] == ["seq.xes.gz / Fake miner", "loop.xes / Fake miner"]

    bad = b'<?xml version="1.0"?><!DOCTYPE log [<!ENTITY x SYSTEM "file:///etc/passwd">]><log/>'
    r = _post(client, kind="model", source="logs", files=[("files", ("x.xes.gz", gzip.compress(bad), "application/gzip"))])
    assert r.status_code == 400 and "DOCTYPE" in r.json()["detail"]
    r = _post(client, kind="model", source="logs", files=[("files", ("x.xes.gz", b"not gzip", "application/gzip"))])
    assert r.status_code == 400 and "gzip" in r.json()["detail"]


def test_log_dataset_from_logs_with_feeed(client, xes_files):
    files = [("files", (name, data, "application/xml")) for name, data in xes_files.items()]
    r = _post(client, kind="log", source="logs", groups=["simple_stats", "activities"], files=files)
    assert r.status_code == 200, r.text
    d = _wait_ready(client, r.json()["dataset_id"])
    assert d["status"] == "ready", d
    assert d["observations"] == list(xes_files)
    dropped = [x["measure"] for x in d["dropped"]]
    assert set(d["measures"]) | set(dropped) == set(cat_features(["simple_stats", "activities"]))
    values = dict(zip(d["measures"], d["values"][1]))
    assert values["n_variants"] == 4.0


def test_logs_total_size_budget(client, monkeypatch, xes_files):
    from routes import factor_analysis as fa

    monkeypatch.setattr(fa, "MAX_TOTAL_BYTES", len(xes_files["seq.xes"]) + 10)
    files = [("files", (name, xes_files["seq.xes"], "application/xml")) for name in ("a.xes", "b.xes")]
    r = _post(client, kind="log", source="logs", files=files)
    assert r.status_code == 400
    assert "total limit" in r.json()["detail"]


def test_logs_file_count_limit(client, monkeypatch):
    from routes import factor_analysis as fa

    monkeypatch.setattr(fa, "MAX_LOG_FILES", 2)
    files = [("files", (f"{i}.xes", b"<log/>", "application/xml")) for i in range(3)]
    r = _post(client, kind="log", source="logs", files=files)
    assert r.status_code == 400 and "At most 2" in r.json()["detail"]


def test_dataset_jobs_respect_the_session_quota(client, monkeypatch):
    import jobs_db

    async def _full(_session_id):
        return jobs_db.MAX_ACTIVE_JOBS_PER_SESSION

    monkeypatch.setattr(jobs_db, "count_active_jobs", _full)
    r = _post(client, kind="model", source="pnml", bundled_id="pdc-sample-models")
    assert r.status_code == 429


def test_aborted_job_fails_the_dataset(client, monkeypatch):
    """Deleting or aborting the job shows up as a failed dataset."""
    import jobs_db
    from factor_analysis import storage

    r = _post(client, kind="model", source="pnml", bundled_id="pdc-sample-models")
    body = r.json()
    session_id = next(iter((storage.root()).iterdir())).name
    storage.update_meta(session_id, body["dataset_id"], status="computing")
    import asyncio

    asyncio.run(jobs_db.set_job_failed(body["job_id"], "boom"))
    d = client.get(f"/factor-analysis/datasets/{body['dataset_id']}").json()
    assert d["status"] == "failed" and d["error"] == "boom"
