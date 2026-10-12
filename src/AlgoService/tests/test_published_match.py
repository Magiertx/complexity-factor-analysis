"""The published settings of the bundled datasets and the comparison with the published
numbers at runtime (``published_match`` of an analysis)."""

from __future__ import annotations

import copy
import io
import json
import zipfile

import pytest

from factor_analysis import catalog as cat
from factor_analysis import published as published_module
from factor_analysis.published import published

IF_DATASETS = [
    "comfy-paper-alpha-miner",
    "comfy-paper-alpha-dollar-miner",
    "comfy-paper-alpha-plus-miner",
    "comfy-paper-directly-follows-miner",
    "comfy-paper-heuristics-miner",
    "comfy-paper-hybrid-ilp-miner",
    "comfy-paper-inductive-miner",
]
LOG_DATASET = "comfy-log-pdc-training-logs"

# Important Factors, section 5: k = 4 a priori, varimax, MSA 0.6, alpha 0.05, |loading| > 0.35,
# communality >= 0.3, cross-loaded measures in every dimension of their cross-loading.
IF_OPTIONS = {
    "excluded": [], "auto_msa_filter": True, "msa_threshold": 0.6, "bartlett_alpha": 0.05,
    "n_factors": 4, "rotation": "varimax", "loading_threshold": 0.35, "communality_threshold": 0.3,
    "assignment_rule": "multi",
}


def _bundled(client, dataset_id: str, **data) -> str:
    kind = "log" if dataset_id == LOG_DATASET else "model"
    r = client.post("/factor-analysis/datasets", data={"kind": kind, "source": "bundled", "bundled_id": dataset_id, **data})
    assert r.status_code == 200, r.text
    return f"/factor-analysis/datasets/{r.json()['dataset_id']}"


# --- the settings in the manifest and the catalog ----------------------------------------


def test_every_dataset_of_important_factors_has_the_published_settings():
    from routes.factor_analysis import AnalyzeRequest

    for dataset_id in IF_DATASETS:
        entry = cat.bundled_entry(dataset_id)
        options = entry["published_options"]
        # Heuristics: four measures are left after the MSA filter, so at most three factors.
        k = 3 if dataset_id == "comfy-paper-heuristics-miner" else 4
        assert options == {**IF_OPTIONS, "n_factors": k}, dataset_id
        assert options["n_factors"] == published(dataset_id)["reproduce_with"]["n_factors"]
        # A complete body of analyze, as a client sends it.
        assert AnalyzeRequest(**options).model_dump() == options
        assert entry["published_source"].startswith(("Important Factors, ATAED 2026, Tab. ", "Settings of Important Factors"))
        assert entry["paper_tables"]["key"] in cat.PAPER_TABLE_NOTES
    assert "published_options" not in cat.bundled_entry(LOG_DATASET)
    assert "paper_tables" not in cat.bundled_entry(LOG_DATASET)


def test_the_catalog_names_the_settings_and_the_tables():
    bundled = {b["id"]: b for b in cat.catalog("model")["bundled"]}
    inductive = bundled["comfy-paper-inductive-miner"]
    assert inductive["published_options"] == IF_OPTIONS
    assert inductive["published_source"] == "Important Factors, ATAED 2026, Tab. 10–12"
    assert inductive["paper_tables"] == {
        "key": "matches", "tables": "Tab. 10–11", "note": "Tab. 10–11 of the paper print the same numbers, rounded.",
    }
    assert bundled["comfy-paper-directly-follows-miner"]["paper_tables"]["key"] == "extra_dup_column"
    assert bundled["comfy-paper-hybrid-ilp-miner"]["paper_tables"]["key"] == "other_data"
    assert bundled["comfy-paper-alpha-plus-miner"]["paper_tables"] == {
        "key": "not_in_paper", "tables": None, "note": cat.PAPER_TABLE_NOTES["not_in_paper"],
    }
    log = cat.catalog("log")["bundled"][0]
    assert not {"published_options", "published_source", "paper_tables"} & set(log)


def test_options_count_as_published_only_if_every_one_is():
    options = dict(IF_OPTIONS)
    assert published_module.uses_published_options(options, dict(IF_OPTIONS))
    assert published_module.uses_published_options(options, {**IF_OPTIONS, "communality_threshold": 0.3 + 1e-15})
    for name, value in [
        ("n_factors", 2), ("rotation", "promax"), ("msa_threshold", 0.5), ("bartlett_alpha", 0.01),
        ("loading_threshold", 0.4), ("communality_threshold", 0.0), ("assignment_rule", "largest"),
        ("excluded", ["Size"]), ("auto_msa_filter", False),
    ]:
        assert not published_module.uses_published_options(options, {**IF_OPTIONS, name: value}), name


# --- the comparison at runtime -----------------------------------------------------------


@pytest.mark.parametrize("dataset_id", IF_DATASETS)
def test_the_published_settings_reproduce_the_comfy_report(client, dataset_id):
    url = _bundled(client, dataset_id)
    options = cat.bundled_entry(dataset_id)["published_options"]
    match = client.post(f"{url}/analyze", json=options).json()["published_match"]
    numbers = published(dataset_id)
    assert match == {
        "status": "match",
        "compared": ["bartlett", "kmo", "msa", "loadings"],
        "differences": [],
        "tolerance": 1e-4,
        "source": f"{numbers['source']['file']} of ComFy, commit 1dd6ea6",
        "report": numbers["source"],
        "paper_tables": cat.bundled_entry(dataset_id)["paper_tables"]["key"],
        "paper_tables_ref": cat.bundled_entry(dataset_id)["paper_tables"]["tables"],
        "paper_tables_note": cat.paper_tables_note(cat.bundled_entry(dataset_id)["paper_tables"]),
    }


def test_no_comparison_without_the_published_settings(client):
    url = _bundled(client, "comfy-paper-inductive-miner")
    for body in [
        {},
        {**IF_OPTIONS, "n_factors": 2},
        {**IF_OPTIONS, "assignment_rule": "hair"},
        {**IF_OPTIONS, "communality_threshold": None},
        {**IF_OPTIONS, "excluded": ["Size"]},
    ]:
        r = client.post(f"{url}/analyze", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["published_match"] is None, body
    # The order of the options does not matter, nor do defaults spelt out.
    assert client.post(f"{url}/analyze", json=dict(reversed(IF_OPTIONS.items()))).json()["published_match"]


def test_no_comparison_for_other_data(client):
    # A selection of the measures of a bundled dataset is data of its own.
    entry = cat.bundled_entry("comfy-paper-inductive-miner")
    columns = list(cat.bundled_columns(entry["file"]))
    selected = _bundled(client, entry["id"], measures=json.dumps(columns[:-2]))
    assert client.post(f"{selected}/analyze", json=IF_OPTIONS).json()["published_match"] is None
    # ... unless it selects every measure in order.
    every = _bundled(client, entry["id"], measures=json.dumps(columns))
    assert client.post(f"{every}/analyze", json=IF_OPTIONS).json()["published_match"]["status"] == "match"

    # The same values uploaded as a CSV are not the bundled dataset.
    csv = client.get(f"{_bundled(client, entry['id'])}/download").content
    r = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "csv"},
                    files=[("files", ("inductive.csv", csv, "text/csv"))])
    url = f"/factor-analysis/datasets/{r.json()['dataset_id']}"
    assert client.post(f"{url}/analyze", json=IF_OPTIONS).json()["published_match"] is None

    # The log data have no published settings yet.
    log = _bundled(client, LOG_DATASET)
    assert client.post(f"{log}/analyze", json={"n_factors": 1}).json()["published_match"] is None


def test_differences_are_listed(client, monkeypatch):
    numbers = copy.deepcopy(published("comfy-paper-inductive-miner"))
    numbers["loadings"]["Size"][1] += 0.01
    numbers["kmo"]["per_measure"]["Density"] = 0.5
    numbers["bartlett"]["chi_square"] *= 1.001
    monkeypatch.setattr(published_module, "published", lambda dataset_id: numbers)

    url = _bundled(client, "comfy-paper-inductive-miner")
    match = client.post(f"{url}/analyze", json=IF_OPTIONS).json()["published_match"]
    assert match["status"] == "differs"
    differences = {d["what"]: d for d in match["differences"]}
    assert set(differences) == {"Bartlett's chi-square", "MSA of Density", "loading of Size on factor 2"}
    loading = differences["loading of Size on factor 2"]
    assert (loading["key"], loading["code"], loading["measure"], loading["factor"]) == ("loadings", "loading", "Size", 1)
    assert loading["expected"] == pytest.approx(-0.1415) and loading["actual"] == pytest.approx(-0.1515, abs=1e-4)
    assert (differences["MSA of Density"]["key"], differences["MSA of Density"]["code"]) == ("msa", "msa")
    assert differences["Bartlett's chi-square"]["code"] == "bartlett_chi_square"


def test_a_different_set_of_removed_measures_is_one_difference(client, monkeypatch):
    numbers = copy.deepcopy(published("comfy-paper-inductive-miner"))
    numbers["msa_filter"]["removed"][0]["round"] = 2
    monkeypatch.setattr(published_module, "published", lambda dataset_id: numbers)
    url = _bundled(client, "comfy-paper-inductive-miner")
    match = client.post(f"{url}/analyze", json=IF_OPTIONS).json()["published_match"]
    assert [(d["code"], d["what"]) for d in match["differences"]] == [
        ("msa_removed", "measures removed by the MSA filter, with their step"),
    ]


def test_the_zip_names_the_published_settings_when_used(client):
    url = _bundled(client, "comfy-paper-inductive-miner")

    def archive(body: dict) -> tuple[dict, str]:
        with zipfile.ZipFile(io.BytesIO(client.post(f"{url}/export/zip", json=body).content)) as z:
            return json.loads(z.read("manifest.json")), z.read("README.txt").decode()

    manifest, readme = archive(IF_OPTIONS)
    assert manifest["published"]["options"] == IF_OPTIONS
    assert manifest["published"]["source"] == "Important Factors, ATAED 2026, Tab. 10–12"
    assert manifest["published"]["match"]["status"] == "match"
    assert (
        "Published settings: compared with output/paper-results/report-inductive-miner.tex of ComFy, "
        "commit 1dd6ea6 (bartlett, kmo, msa, loadings, tolerance 0.0001): they match."
    ) in readme

    manifest, readme = archive({**IF_OPTIONS, "n_factors": 3})
    assert "published" not in manifest and "Published settings" not in readme
