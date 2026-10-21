"""What a paper takes from an analysis, through the API: the descriptive statistics and the
run times of a dataset, the timings of an analysis, the figures and the ZIP with all of them.
The LaTeX report has tests of its own (test_report.py)."""

from __future__ import annotations

import io
import json
import zipfile

import pytest

from factor_analysis.export import MEASUREMENT_COLUMNS
from tests.test_factor_analysis_api import _post, _wait_ready
from tests.test_figures import _svg_texts


# --- descriptive statistics ----------------------------------------------------------------


def test_a_dataset_shows_its_descriptives(client):
    r = _post(client, kind="model", source="bundled", bundled_id="comfy-paper-inductive-miner")
    dataset_id = r.json()["dataset_id"]
    d = client.get(f"/factor-analysis/datasets/{dataset_id}").json()
    assert d["descriptives"]["basis"] == "input"
    rows = {x["measure"]: x for x in d["descriptives"]["measures"]}
    # The constant measure the cleaning dropped is described too, as in the report.
    assert rows["Number of empty sequence flows"]["dropped"] == "constant"
    assert rows["Size"]["mean"] == pytest.approx(71.684028, abs=1e-6)
    assert d["measurement"] is None


def test_a_dataset_stored_before_the_statistics_were_kept_still_has_them(client, isolated_jobs_dir):
    r = _post(client, kind="model", source="bundled", bundled_id="comfy-paper-inductive-miner")
    dataset_id = r.json()["dataset_id"]
    for path in isolated_jobs_dir.rglob("descriptives.json"):
        path.unlink()
    d = client.get(f"/factor-analysis/datasets/{dataset_id}").json()
    # Bundled: computed again from the bundled table, with its constant measure.
    assert d["descriptives"]["basis"] == "input"
    assert len(d["descriptives"]["measures"]) == 13

    csv = "observation,x,y,z\n" + "\n".join(f"r{i},{i},{i * i % 7},{(i * 3) % 5}" for i in range(12))
    r = _post(client, kind="model", source="csv", files=[("files", ("own.csv", csv.encode(), "text/csv"))])
    own = r.json()["dataset_id"]
    for path in isolated_jobs_dir.rglob("descriptives.json"):
        path.unlink()
    d = client.get(f"/factor-analysis/datasets/{own}").json()
    # An upload: only the cleaned matrix is left to describe.
    assert d["descriptives"]["basis"] == "cleaned"


# --- run times and input sizes -------------------------------------------------------------


def test_a_computed_dataset_keeps_its_measurement(client):
    measures = ["Size", "Density", "Token split", "Average connector degree", "Coefficient of network connectivity"]
    r = _post(client, kind="model", source="pnml", bundled_id="pdc-sample-models", measures=measures)
    d = _wait_ready(client, r.json()["dataset_id"])
    m = d["measurement"]
    assert m["source"] == "pnml" and [o["observation"] for o in m["observations"]] == d["observations"]
    job = client.get(f"/jobs/{d['job_id']}").json()
    tables = {a["label"]: a for a in job["result"]["artifacts"] if a["kind"] == "table"}
    assert tables["Run times and input sizes"]["columns"] == list(MEASUREMENT_COLUMNS)

    archive = zipfile.ZipFile(io.BytesIO(client.post(f"/factor-analysis/datasets/{d['id']}/export/zip", json={}).content))
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["measurement"] == m
    assert archive.read("inputs.csv").decode().startswith(",".join(MEASUREMENT_COLUMNS))
    assert "stages.csv" in archive.namelist()


def test_an_analysis_reports_its_timings(client):
    r = _post(client, kind="model", source="bundled", bundled_id="comfy-paper-inductive-miner")
    dataset_id = r.json()["dataset_id"]
    body = {"n_factors": 3, "rotation": "promax"}
    first = client.post(f"/factor-analysis/datasets/{dataset_id}/analyze", json=body).json()["timings"]
    again = client.post(f"/factor-analysis/datasets/{dataset_id}/analyze", json=body).json()["timings"]
    assert set(first) == {"suitability_s", "parallel_analysis_s", "parallel_analysis_cached", "fit_s", "fit_cached", "total_s"}
    # The fit is cached; the second analysis reports the time the first one took for it.
    assert again["fit_cached"] is True and again["fit_s"] == first["fit_s"] > 0
    assert again["parallel_analysis_cached"] is True


# --- figures -------------------------------------------------------------------------------


def test_figures_through_the_api(client):
    r = _post(client, kind="model", source="bundled", bundled_id="comfy-paper-inductive-miner")
    dataset_id = r.json()["dataset_id"]
    url = f"/factor-analysis/datasets/{dataset_id}/export/figure"
    r = client.post(url, json={"figure": "loadings", "format": "svg", "short_codes": True, "n_factors": 4})
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
    assert r.headers["content-disposition"].endswith('-loadings.svg"')
    assert "CNC" in _svg_texts(r.content)
    r = client.post(url, json={"figure": "scree", "format": "png"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert client.post(url, json={"figure": "pie"}).status_code == 422
    assert client.post(url, json={"format": "pdf"}).status_code == 422


def test_the_zip_has_the_figures_the_report_and_the_descriptives(client):
    r = _post(client, kind="model", source="bundled", bundled_id="comfy-paper-inductive-miner")
    dataset_id = r.json()["dataset_id"]
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/export/zip", json={"short_codes": True, "n_factors": 4})
    archive = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(archive.namelist())
    assert {"report.tex", "descriptives.csv", "figures/scree.svg", "figures/loadings.svg"} <= names
    assert "inputs.csv" not in names
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["measure_labels"] == "short_codes"
    assert set(manifest["analysis_timings"]) >= {"fit_s", "parallel_analysis_s", "total_s"}
    assert "measurement" not in manifest
    listed = {f["name"] for f in manifest["files"]}
    assert names <= listed
    assert "CNC" in _svg_texts(archive.read("figures/loadings.svg"))
    descriptives = archive.read("descriptives.csv").decode().splitlines()
    assert descriptives[0] == "measure,n,mean,median,std,min,max,dropped"
    assert len(descriptives) == 14
