"""Names of the factors (``factor_names``): given by the user, used by the exports, never made
up by the tool. The analysis itself does not change with them."""

from __future__ import annotations

import io
import json
import zipfile

import pandas as pd
import pytest

BUNDLED = "comfy-paper-inductive-miner"
#: The settings of the paper: four factors, varimax.
OPTIONS = {"n_factors": 4, "rotation": "varimax", "assignment_rule": "multi"}
NAMES = ["Größe", None, "Connector variety & mismatch", ""]


@pytest.fixture
def url(client) -> str:
    r = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "bundled", "bundled_id": BUNDLED})
    assert r.status_code == 200, r.text
    return f"/factor-analysis/datasets/{r.json()['dataset_id']}"


def test_the_names_change_nothing_of_the_analysis(client, url):
    plain = client.post(f"{url}/analyze", json=OPTIONS).json()
    named = client.post(f"{url}/analyze", json={**OPTIONS, "factor_names": NAMES}).json()
    for key in ("loadings", "factors", "kmo", "eigenvalues"):
        assert named[key] == plain[key], key


def test_the_loadings_are_headed_by_the_names(client, url):
    csv = client.post(f"{url}/export", json={**OPTIONS, "factor_names": NAMES, "format": "csv"}).text
    assert csv.splitlines()[0] == "measure,Größe,Factor 2,Connector variety & mismatch,Factor 4,communality"
    tex = client.post(f"{url}/export", json={**OPTIONS, "factor_names": NAMES, "format": "latex"}).text
    assert "Measure & Größe & Factor 2 & Connector variety \\& mismatch & Factor 4 & Communality \\\\" in tex
    # Without names, as before.
    plain = client.post(f"{url}/export", json={**OPTIONS, "format": "csv"}).text
    assert plain.splitlines()[0] == "measure,Factor 1,Factor 2,Factor 3,Factor 4,communality"


def test_the_report_names_the_factors_and_says_who_named_them(client, url):
    report = client.post(f"{url}/export/report", json={**OPTIONS, "factor_names": NAMES}).text
    # A short name heads its column; a long one wraps in it.
    assert " & Größe & Factor 2 & \\parbox[b]{2cm}{\\centering Connector variety \\& mismatch} & Factor 4 & $h^2$ \\\\" in report
    assert "Factor 1: Größe" not in report.split("\\section*{Dimensions}")[0]
    dimensions = report.split("\\section*{Dimensions}")[1]
    assert "Größe" in dimensions and "Connector variety \\& mismatch" in dimensions
    assert "were given by whoever ran the analysis" in report
    plain = client.post(f"{url}/export/report", json=OPTIONS).text
    assert "Größe" not in plain and "were given by whoever ran the analysis" not in plain


def test_an_oblique_rotation_names_the_factor_correlations(client, url):
    body = {**OPTIONS, "rotation": "promax", "factor_names": ["Size"]}
    report = client.post(f"{url}/export/report", json=body).text
    correlations = report.split("\\section*{Factor Correlations}")[1]
    assert " & Size & Factor 2 & Factor 3 & Factor 4 \\\\" in correlations
    assert "Size & $1.0000$" in correlations


def test_the_figure_carries_the_names(client, url):
    body = {**OPTIONS, "factor_names": NAMES, "figure": "loadings", "format": "svg"}
    svg = client.post(f"{url}/export/figure", json=body).text
    assert "Größe" in svg and "Connector variety &amp; mismatch" in svg
    plain = client.post(f"{url}/export/figure", json={**body, "factor_names": None}).text
    assert "Größe" not in plain and ">F1<" in plain


def test_the_archive_lists_the_names_in_its_manifest_and_tables(client, url):
    r = client.post(f"{url}/export/zip", json={**OPTIONS, "factor_names": NAMES})
    assert r.status_code == 200, r.text
    with zipfile.ZipFile(io.BytesIO(r.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        loadings = pd.read_csv(io.BytesIO(archive.read("loadings.csv")))
        report = archive.read("report.tex").decode()
        figure = archive.read("figures/loadings.svg").decode()
    assert manifest["factor_names"] == ["Größe", None, "Connector variety & mismatch", None]
    assert "factor_names" not in manifest["analysis_params"]
    assert list(loadings.columns)[1:3] == ["Größe", "Factor 2"]
    assert "Größe" in report and "Größe" in figure
    plain = client.post(f"{url}/export/zip", json=OPTIONS)
    with zipfile.ZipFile(io.BytesIO(plain.content)) as archive:
        assert "factor_names" not in json.loads(archive.read("manifest.json"))


def test_names_are_one_line_of_at_most_forty_characters(client, url):
    spaced = client.post(f"{url}/export", json={**OPTIONS, "factor_names": ["  Size\n of  nets "], "format": "csv"}).text
    assert spaced.splitlines()[0].startswith("measure,Size of nets,Factor 2")
    r = client.post(f"{url}/export", json={**OPTIONS, "factor_names": ["x" * 41]})
    assert r.status_code == 422
    assert client.post(f"{url}/export", json={**OPTIONS, "factor_names": ["x" * 40]}).status_code == 200


def test_more_names_than_factors(client, url):
    r = client.post(f"{url}/export", json={**OPTIONS, "factor_names": ["a", "b", "c", "d", "e"]})
    assert r.status_code == 400
    assert r.json()["code"] == "factor_names_too_many"
    assert r.json()["params"] == {"names": 5, "factors": 4}
    # Empty names at the end count for nothing.
    assert client.post(f"{url}/export", json={**OPTIONS, "factor_names": ["a", None, "", None, ""]}).status_code == 200
    r = client.put(f"{url}/options", json={**OPTIONS, "factor_names": ["a", "b", "c", "d", "e"]})
    assert r.status_code == 400 and r.json()["code"] == "factor_names_too_many"


def test_the_names_are_kept_with_the_options(client, url):
    assert client.put(f"{url}/options", json={**OPTIONS, "factor_names": NAMES}).status_code == 204
    saved = client.get(url).json()["options"]
    assert saved["factor_names"] == ["Größe", None, "Connector variety & mismatch"]
    assert saved["n_factors"] == 4
    client.put(f"{url}/options", json=OPTIONS)
    assert "factor_names" not in client.get(url).json()["options"]
