"""Analysing a model dataset per miner (factor_analysis/miners.py, the analysis option ``miner``).

The data are the nets that three miners of Important Factors discovered from the same 50 logs of
the bundled data, uploaded as one CSV with a row per log and miner, "<log> / <miner>", as the tool
names the rows of a dataset it computes from logs. Within one miner a measure can be constant
although it varies over all three: dup for the Alpha miner, esf for the Inductive and the
Heuristics miner.
"""

from __future__ import annotations

import io
import json
import re
import zipfile

import numpy as np
import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis import core, miners, storage

MINERS = ["Alpha miner", "Inductive miner", "Heuristics miner"]
FILES = {"Alpha miner": "alpha", "Inductive miner": "inductive", "Heuristics miner": "heuristics"}
_LABEL = re.compile(r"^\((.*),(.*)\)$")


def _table(n_logs: int = 50) -> pd.DataFrame:
    """The first ``n_logs`` logs every one of the three miners has, a row per log and miner."""
    tables = {}
    for miner, short in FILES.items():
        entry = cat.bundled_entry(f"comfy-paper-{short}-miner")
        table = pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0)
        table.index = [_LABEL.match(str(i)).group(1) for i in table.index]
        tables[miner] = table
    logs = [log for log in tables["Alpha miner"].index if all(log in t.index for t in tables.values())][:n_logs]
    rows = {f"{log} / {miner}": tables[miner].loc[log] for log in logs for miner in MINERS}
    return pd.DataFrame(rows).T


def _upload(client, table: pd.DataFrame) -> str:
    text = table.to_csv(index_label="observation")
    r = client.post(
        "/factor-analysis/datasets",
        data={"kind": "model", "source": "csv"},
        files={"files": ("miners.csv", io.BytesIO(text.encode()), "text/csv")},
    )
    assert r.status_code == 200, r.text
    return r.json()["dataset_id"]


@pytest.fixture
def three(client) -> str:
    return _upload(client, _table())


def _stored(client, dataset_id: str) -> pd.DataFrame:
    session = next(d.name for d in storage.root().iterdir() if (d / dataset_id).is_dir())
    return storage.load_matrix(session, dataset_id)


# --- the rows of a miner --------------------------------------------------------------------


def test_the_miner_of_a_row():
    assert miners.miner_of("pdc2025_02000100.xes / Alpha miner") == "Alpha miner"
    # A log may have " / " in its label; the miner is what follows the last one.
    assert miners.miner_of("a / b.xes / Inductive miner") == "Inductive miner"
    assert miners.miner_of("pdc2025_02000100.xes") is None


def test_miners_only_when_every_row_names_a_known_one():
    known = ["Alpha miner", "Inductive miner"]
    rows = ["a / Inductive miner", "a / Alpha miner", "b / Inductive miner"]
    assert miners.miners_of(rows, known) == ["Inductive miner", "Alpha miner"]
    # The miners the dataset was computed with give the order.
    assert miners.miners_of(rows, known, ["Alpha miner", "Inductive miner"]) == ["Alpha miner", "Inductive miner"]
    assert miners.miners_of([*rows, "c"], known) == []
    assert miners.miners_of(["a / Variant 2"], known) == []


def test_fifty_logs_of_three_miners_give_fifty_rows_per_miner_with_the_same_values(client, three):
    detail = client.get(f"/factor-analysis/datasets/{three}").json()
    assert detail["n_observations"] == 150
    assert [m["name"] for m in detail["miners"]] == MINERS
    assert [m["n_observations"] for m in detail["miners"]] == [50, 50, 50]
    # Constant within the miner, though not over all rows.
    by_name = {m["name"]: m for m in detail["miners"]}
    assert by_name["Alpha miner"]["dropped"] == ["Number of duplicate tasks"]
    assert by_name["Inductive miner"]["dropped"] == ["Number of empty sequence flows"]
    assert by_name["Alpha miner"]["n_measures"] == len(detail["measures"]) - 1

    stored = _stored(client, three)
    for miner in MINERS:
        selection = miners.select(stored, miner)
        rows = [label for label in stored.index if label.endswith(f" / {miner}")]
        assert list(selection.data.index) == rows and len(rows) == 50
        # The same raw values, the columns in the stored order.
        kept = [c for c in stored.columns if c in selection.data.columns]
        assert list(selection.data.columns) == kept
        assert np.array_equal(selection.data.to_numpy(), stored.loc[rows, kept].to_numpy())


def test_the_analysis_of_a_miner_runs_on_its_rows(client, three):
    url = f"/factor-analysis/datasets/{three}/analyze"
    result = client.post(url, json={"miner": "Inductive miner"}).json()
    assert result["n_observations"] == 50
    assert result["miner"] == {
        "name": "Inductive miner",
        "n_observations": 50,
        "n_measures": 12,
        "dropped": [{"measure": "Number of empty sequence flows", "reason": "constant"}],
    }
    assert "Number of empty sequence flows" not in result["loadings"]

    # The same numbers as the analysis of the rows themselves, and the KMO of the stored order.
    stored = _stored(client, three)
    rows = miners.select(stored, "Inductive miner").data
    direct = core.analyze(rows, core.AnalysisParams())
    assert result["kmo"]["overall"] == pytest.approx(direct["kmo"]["overall"], abs=1e-12)
    assert list(result["kmo"]["per_measure"]) == list(direct["kmo"]["per_measure"])
    assert result["used_measures"] == [c for c in stored.columns if c in result["used_measures"]]
    for measure, row in direct["loadings"].items():
        assert result["loadings"][measure] == pytest.approx(row, abs=1e-12)

    together = client.post(url, json={}).json()
    assert together["n_observations"] == 150 and together["miner"] is None


def test_an_exclusion_of_a_measure_constant_within_the_miner_is_no_error(client, three):
    url = f"/factor-analysis/datasets/{three}/analyze"
    body = {"miner": "Alpha miner", "excluded": ["Number of duplicate tasks", "Density"]}
    result = client.post(url, json=body).json()
    assert result["n_observations"] == 50
    assert "Density" not in result["used_measures"]
    # A measure the dataset does not have stays an error, with a miner as without.
    r = client.post(url, json={"miner": "Alpha miner", "excluded": ["Nope"]})
    assert r.status_code == 400 and r.json()["code"] == "unknown_excluded"


def test_a_miner_the_dataset_does_not_have(client, three):
    url = f"/factor-analysis/datasets/{three}/analyze"
    r = client.post(url, json={"miner": "Hybrid ILP miner"})
    assert r.status_code == 400
    assert r.json()["code"] == "unknown_miner"
    assert r.json()["params"] == {"miner": "Hybrid ILP miner", "miners": ", ".join(MINERS)}


def test_rows_without_miners_have_none(client):
    table = _table(20)
    table.index = [f"log {i}" for i in range(len(table))]
    dataset_id = _upload(client, table)
    assert client.get(f"/factor-analysis/datasets/{dataset_id}").json()["miners"] is None
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/analyze", json={"miner": "Alpha miner"})
    assert r.status_code == 400 and r.json()["code"] == "unknown_miner"


def test_four_logs_per_miner_are_too_few_for_an_analysis(client):
    """The four sample logs: three miners give 12 rows together, 4 per miner, fewer than the
    measures; the UI shows the miner tiles blocked, the API answers like for any small dataset."""
    dataset_id = _upload(client, _table(4))
    detail = client.get(f"/factor-analysis/datasets/{dataset_id}").json()
    assert [m["n_observations"] for m in detail["miners"]] == [4, 4, 4]
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/analyze", json={"miner": "Alpha miner"})
    assert r.status_code == 400
    assert r.json()["code"] == "too_few_observations"
    assert r.json()["params"]["n"] == 4


def test_the_miner_is_kept_with_the_options_and_checked_on_its_rows(client, three):
    url = f"/factor-analysis/datasets/{three}/options"
    assert client.put(url, json={"miner": "Heuristics miner", "n_factors": 3}).status_code == 204
    saved = client.get(f"/factor-analysis/datasets/{three}").json()["options"]
    assert saved["miner"] == "Heuristics miner" and saved["n_factors"] == 3
    # 12 measures vary within the miner: at most 11 factors.
    r = client.put(url, json={"miner": "Heuristics miner", "n_factors": 12})
    assert r.status_code == 400 and r.json()["code"] == "n_factors_range"
    assert client.put(url, json={"miner": "nobody"}).json()["code"] == "unknown_miner"
    # Without a miner the options say nothing of one.
    client.put(url, json={})
    assert "miner" not in client.get(f"/factor-analysis/datasets/{three}").json()["options"]


def test_the_archive_holds_the_rows_of_the_miner_and_names_it(client, three):
    r = client.post(f"/factor-analysis/datasets/{three}/export/zip", json={"miner": "Inductive miner"})
    assert r.status_code == 200, r.text
    with zipfile.ZipFile(io.BytesIO(r.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        matrix = pd.read_csv(io.BytesIO(archive.read("dataset.csv")), index_col=0)
        msa = pd.read_csv(io.BytesIO(archive.read("msa.csv")), keep_default_na=False).set_index("measure")
        report = archive.read("report.tex").decode()
        readme = archive.read("README.txt").decode()
    assert manifest["analysis_params"]["miner"] == "Inductive miner"
    assert manifest["miner"]["n_observations"] == 50
    assert manifest["dataset"]["n_observations"] == 150
    assert len(matrix) == 50 and all(label.endswith(" / Inductive miner") for label in matrix.index)
    assert msa.loc["Number of empty sequence flows", "status"] == "dropped within the miner: constant"
    assert "Only the nets of the Inductive miner were analysed: $50$ of the $150$ observations" in report
    assert "Miner & Inductive miner" in report
    assert "rows of the miner Inductive miner only" in readme

    # The report alone says the same; together, nothing of a miner.
    alone = client.post(f"/factor-analysis/datasets/{three}/export/report", json={"miner": "Inductive miner"}).text
    assert "Only the nets of the Inductive miner" in alone
    together = client.post(f"/factor-analysis/datasets/{three}/export/report", json={}).text
    assert "Only the nets of" not in together

