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


# --- comparing the miners, and other analyses of the session's datasets ---------------------


def test_compare_the_miners_of_a_dataset(client, three):
    body = {
        "columns": [{"dataset_id": three, "miner": m} for m in MINERS],
        "assignment_rule": "hair",
    }
    r = client.post("/factor-analysis/compare", json=body)
    assert r.status_code == 200, r.text
    comparison = r.json()
    columns = comparison["columns"]
    assert [c["miner"] for c in columns] == MINERS
    assert [c["dataset_id"] for c in columns] == [three] * 3
    assert [c["bundled_id"] for c in columns] == [None] * 3
    assert [c["n_observations"] for c in columns] == [50, 50, 50]
    assert [c["settings"] for c in columns] == ["standard"] * 3
    assert columns[0]["label"] == "miners.csv, Alpha miner"
    # Constant within the miner: dropped for that column only.
    rows = {r["measure"]: r["cells"] for r in comparison["measures"]}
    assert rows["Number of duplicate tasks"][0] == {"status": "dropped", "reason": "constant"}
    assert rows["Number of empty sequence flows"][1] == {"status": "dropped", "reason": "constant"}
    assert rows["Number of empty sequence flows"][0]["status"] != "dropped"
    # The same analysis as on the tab, with the same rows.
    alone = client.post(
        f"/factor-analysis/datasets/{three}/analyze", json={"miner": "Inductive miner", "assignment_rule": "hair"}
    ).json()
    assert columns[1]["kmo"] == alone["kmo"]["overall"]
    assert columns[1]["n_factors"] == alone["n_factors"]


def test_a_pinned_solution_with_four_and_with_six_factors(client, three):
    """The same dataset twice, as "Pin this solution" adds it: the miner, the factor count and the
    rotation of each, on the settings saved with the dataset."""
    url = f"/factor-analysis/datasets/{three}"
    assert client.put(f"{url}/options", json={"excluded": ["Density"], "loading_threshold": 0.4}).status_code == 204
    pin = {"dataset_id": three, "miner": "Alpha miner"}
    body = {
        "columns": [
            {**pin, "options": {"n_factors": 4, "rotation": "varimax"}, "label": "Alpha, k = 4"},
            {**pin, "options": {"n_factors": 6, "rotation": "promax"}, "label": "Alpha, k = 6"},
        ],
        "assignment_rule": "multi",
    }
    comparison = client.post("/factor-analysis/compare", json=body).json()
    four, six = comparison["columns"]
    assert (four["n_factors"], six["n_factors"]) == (4, 6)
    assert (four["rotation"], six["rotation"]) == ("varimax", "promax")
    assert four["settings"] == "saved" and four["label"] == "Alpha, k = 4"
    assert four["options"]["loading_threshold"] == 0.4 and four["options"]["excluded"] == ["Density"]
    assert four["options"]["assignment_rule"] == "multi"
    rows = {r["measure"]: r["cells"] for r in comparison["measures"]}
    assert rows["Density"][0]["status"] == "excluded"
    # "standard" leaves the saved settings aside.
    standard = client.post(
        "/factor-analysis/compare",
        json={"columns": [{**pin, "settings": "standard"}, pin]},
    ).json()["columns"][0]
    assert standard["settings"] == "standard" and standard["options"]["excluded"] == []


def test_bundled_and_own_columns_side_by_side(client, three):
    body = {"columns": [{"bundled_id": "comfy-paper-alpha-miner"}, {"dataset_id": three, "miner": "Alpha miner"}]}
    comparison = client.post("/factor-analysis/compare", json=body).json()
    assert [c["n_observations"] for c in comparison["columns"]] == [288, 50]
    assert comparison["columns"][0]["dataset_id"] is None


def test_a_column_of_a_miner_the_dataset_lacks_carries_its_error(client, three):
    body = {"columns": [{"dataset_id": three, "miner": "Alpha miner"}, {"dataset_id": three, "miner": "Hybrid ILP miner"}]}
    comparison = client.post("/factor-analysis/compare", json=body).json()
    assert comparison["columns"][1]["error"]["code"] == "unknown_miner"


def test_the_archive_of_a_comparison_names_dataset_and_miner(client, three):
    body = {"columns": [{"dataset_id": three, "miner": m} for m in MINERS[:2]], "format": "zip"}
    r = client.post("/factor-analysis/compare/export", json=body)
    with zipfile.ZipFile(io.BytesIO(r.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        readme = archive.read("README.txt").decode()
    assert [(c["dataset_id"], c["miner"]) for c in manifest["columns"]] == [(three, m) for m in MINERS[:2]]
    assert "only that session can post them again" in readme


@pytest.mark.parametrize(
    "column, status, code",
    [
        ({"dataset_id": "not-a-uuid"}, 400, "compare_unknown_dataset"),
        ({"dataset_id": "00000000-0000-0000-0000-000000000000"}, 400, "compare_unknown_dataset"),
        ({"bundled_id": "comfy-paper-alpha-miner", "miner": "Alpha miner"}, 422, None),
        ({"bundled_id": "comfy-paper-alpha-miner", "settings": "saved"}, 422, None),
        ({"dataset_id": "00000000-0000-0000-0000-000000000000", "settings": "paper"}, 422, None),
        ({}, 422, None),
        ({"bundled_id": "comfy-paper-alpha-miner", "dataset_id": "00000000-0000-0000-0000-000000000000"}, 422, None),
    ],
)
def test_bad_columns(client, three, column, status, code):
    body = {"columns": [{"dataset_id": three, "miner": "Alpha miner"}, column]}
    r = client.post("/factor-analysis/compare", json=body)
    assert r.status_code == status, r.text
    if code:
        assert r.json()["code"] == code


def test_a_dataset_of_another_session_is_unknown(client, three):
    from fastapi.testclient import TestClient
    from srv_main import app

    with TestClient(app) as other:
        body = {"columns": [{"dataset_id": three, "miner": m} for m in MINERS[:2]]}
        r = other.post("/factor-analysis/compare", json=body)
    assert r.status_code == 400 and r.json()["code"] == "compare_unknown_dataset"


def test_columns_of_two_kinds(client, three):
    body = {"columns": [{"dataset_id": three, "miner": "Alpha miner"}, {"bundled_id": "comfy-log-pdc-training-logs"}]}
    r = client.post("/factor-analysis/compare", json=body)
    assert r.status_code == 400 and r.json()["code"] == "compare_mixed_kinds"


def test_a_dataset_not_ready_is_a_column_with_its_error(client, three):
    second = _upload(client, _table(30))
    session = next(d.name for d in storage.root().iterdir() if (d / second).is_dir())
    storage.update_meta(session, second, status="computing")
    body = {"columns": [{"dataset_id": three, "miner": "Alpha miner"}, {"dataset_id": second}]}
    comparison = client.post("/factor-analysis/compare", json=body).json()
    assert comparison["columns"][1]["error"]["code"] == "dataset_not_ready"
    assert {r["cells"][1]["status"] for r in comparison["measures"]} == {"failed"}


def test_a_saved_factor_count_stays_with_the_rows_it_was_fixed_for(client, three):
    """The count saved with a dataset and a miner is that miner's: a column of all rows, or of
    another miner, starts from the standard count instead."""
    assert client.put(
        f"/factor-analysis/datasets/{three}/options", json={"miner": "Alpha miner", "n_factors": 5}
    ).status_code == 204
    body = {
        "columns": [
            {"dataset_id": three},
            {"dataset_id": three, "miner": "Alpha miner"},
            {"dataset_id": three, "miner": "Inductive miner"},
        ]
    }
    columns = client.post("/factor-analysis/compare", json=body).json()["columns"]
    assert [c["n_observations"] for c in columns] == [150, 50, 50]
    assert [c["settings"] for c in columns] == ["saved"] * 3
    assert columns[1]["n_factors"] == 5
    standard = client.post(f"/factor-analysis/datasets/{three}/analyze", json={"miner": "Inductive miner"}).json()
    assert columns[2]["n_factors"] == standard["n_factors"] != 5
    assert columns[0]["n_factors"] != 5
    # A count asked for by the column itself is kept.
    asked = {"columns": [{"dataset_id": three, "miner": "Inductive miner", "options": {"n_factors": 3}}, body["columns"][1]]}
    assert client.post("/factor-analysis/compare", json=asked).json()["columns"][0]["n_factors"] == 3


def test_the_report_of_a_miner_counts_the_measures_of_the_miner(client, three):
    report = client.post(f"/factor-analysis/datasets/{three}/export/report", json={"miner": "Inductive miner"}).text
    assert r"5 \cdot 12 = 60" in report
    assert r"5 \cdot 13 = 65" not in report


# --- the names of the factors in a comparison ----------------------------------------------


def _save_named(client, dataset_id, names, **options):
    """Save options and names the way the frontend does: with the factor count on screen."""
    body = {"names_k": options.pop("k"), "factor_names": names, **options}
    r = client.put(f"/factor-analysis/datasets/{dataset_id}/options", json=body)
    assert r.status_code == 204, r.text


def test_the_names_kept_per_solution():
    from factor_analysis import names

    store = names.remember(None, names.solution_key(3, "varimax", "largest", "Alpha miner"), ["Size", None, "Flow"])
    store = names.remember(store, names.solution_key(2, "varimax", "largest", None), ["Control"])
    assert names.for_solution(store, 3, "varimax", "largest", "Alpha miner") == ["Size", None, "Flow"]
    # One entry per factor, whatever the names saved are long.
    assert names.for_solution(store, 2, "varimax", "largest", None) == ["Control", None]
    # Another miner, count, rotation or rule is another solution.
    assert names.for_solution(store, 3, "varimax", "largest", None) is None
    assert names.for_solution(store, 4, "varimax", "largest", "Alpha miner") is None
    assert names.for_solution(store, 3, "promax", "largest", "Alpha miner") is None
    assert names.for_solution(store, 3, "varimax", "hair", "Alpha miner") is None
    # Saved again without names, a solution is forgotten; the oldest go when there are too many.
    assert names.remember(store, names.solution_key(2, "varimax", "largest", None), None) == {
        names.solution_key(3, "varimax", "largest", "Alpha miner"): ["Size", None, "Flow"]
    }
    many: dict = {}
    for k in range(1, names.MAX_SOLUTIONS + 5):
        many = names.remember(many, names.solution_key(k, "varimax", "largest", None), ["x"])
    assert len(many) == names.MAX_SOLUTIONS
    assert names.solution_key(1, "varimax", "largest", None) not in many


def test_a_column_has_the_names_saved_for_its_solution(client, three):
    _save_named(client, three, ["Size", None, "Flow"], k=3, miner="Alpha miner", assignment_rule="largest")
    _save_named(client, three, ["Control & more"], k=2, miner="Inductive miner", assignment_rule="largest")
    body = {
        "columns": [
            {"dataset_id": three, "miner": "Alpha miner", "options": {"n_factors": 3}},
            {"dataset_id": three, "miner": "Inductive miner", "options": {"n_factors": 2}},
            # Another count of the same rows, all rows, and a bundled dataset: no names.
            {"dataset_id": three, "miner": "Alpha miner", "options": {"n_factors": 4}},
            {"dataset_id": three, "options": {"n_factors": 3}},
            {"bundled_id": "comfy-paper-alpha-miner"},
        ],
        "assignment_rule": "largest",
    }
    comparison = client.post("/factor-analysis/compare", json=body).json()
    assert [c["factor_names"] for c in comparison["columns"]] == [
        ["Size", None, "Flow"], ["Control & more", None], None, None, None,
    ]
    # The rule is part of the solution.
    hair = client.post("/factor-analysis/compare", json={**body, "assignment_rule": "hair"}).json()
    assert [c["factor_names"] for c in hair["columns"]] == [None] * 5


def test_the_downloads_of_a_comparison_carry_the_names(client, three):
    _save_named(client, three, ["Size & shape", None, "Flow"], k=3, miner="Alpha miner")
    body = {
        "columns": [
            {"dataset_id": three, "miner": "Alpha miner", "options": {"n_factors": 3}},
            {"dataset_id": three, "miner": "Inductive miner", "options": {"n_factors": 3}},
        ]
    }
    csv = client.post("/factor-analysis/compare/export", json={**body, "format": "csv"}).text
    named = [line for line in csv.splitlines()[1:] if "(Size & shape)" in line]
    assert named and all(line.count("(") == 1 for line in named)
    # Only the named column has them; the other keeps D1, D2, D3.
    assert "(Flow)" in csv and csv.count("(Size & shape)") == csv.count("D1 (Size & shape)")
    tex = client.post("/factor-analysis/compare/export", json={**body, "format": "latex"}).text
    assert r"\emph{Size \& shape}: " in tex and r"\emph{Flow}: " in tex
    assert tex.count(r"\emph{") == 2
    r = client.post("/factor-analysis/compare/export", json={**body, "format": "zip"})
    with zipfile.ZipFile(io.BytesIO(r.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        full = json.loads(archive.read("comparison.json"))
    assert [c["factor_names"] for c in manifest["columns"]] == [["Size & shape", None, "Flow"], None]
    assert full["columns"][0]["factor_names"] == ["Size & shape", None, "Flow"]
    # Without any name the files are as before.
    client.put(f"/factor-analysis/datasets/{three}/options", json={"miner": "Alpha miner", "n_factors": 3, "names_k": 3})
    plain = client.post("/factor-analysis/compare/export", json={**body, "format": "csv"}).text
    assert "D1 (" not in plain and "D3 (" not in plain
    assert r"\emph" not in client.post("/factor-analysis/compare/export", json={**body, "format": "latex"}).text


def test_names_for_more_factors_than_the_count_are_refused(client, three):
    r = client.put(
        f"/factor-analysis/datasets/{three}/options", json={"names_k": 2, "factor_names": ["a", "b", "c"]}
    )
    assert r.status_code == 400 and r.json()["code"] == "factor_names_too_many"
    # The count is not kept with the options.
    client.put(f"/factor-analysis/datasets/{three}/options", json={"names_k": 2, "factor_names": ["a"]})
    assert "names_k" not in client.get(f"/factor-analysis/datasets/{three}").json()["options"]


# --- the descriptive statistics of a miner -----------------------------------------------------


def test_the_descriptives_of_a_miner_are_those_of_its_rows(client, three):
    url = f"/factor-analysis/datasets/{three}/descriptives"
    everything = client.get(url).json()
    assert everything["n_rows"] == 150 and everything["basis"] != "miner"
    assert everything == client.get(f"/factor-analysis/datasets/{three}").json()["descriptives"]

    alpha = client.get(url, params={"miner": "Alpha miner"}).json()
    assert (alpha["basis"], alpha["miner"], alpha["n_rows"]) == ("miner", "Alpha miner", 50)
    data = _stored(client, three)
    rows = [label for label in data.index if miners.miner_of(label) == "Alpha miner"]
    size = next(r for r in alpha["measures"] if r["measure"] == "Size")
    own = data.loc[rows, "Size"]
    assert size["n"] == 50
    assert size["mean"] == pytest.approx(own.mean()) and size["median"] == pytest.approx(own.median())
    assert size["std"] == pytest.approx(own.std(ddof=1))
    assert (size["min"], size["max"]) == (own.min(), own.max())
    assert sum(size["histogram"]["counts"]) == 50
    # Another basis than every row: the numbers differ.
    assert size["mean"] != next(r for r in everything["measures"] if r["measure"] == "Size")["mean"]
    # Every measure of the dataset is described, also one that is constant within the miner.
    assert [r["measure"] for r in alpha["measures"]] == [r["measure"] for r in everything["measures"]]


def test_the_descriptives_of_a_miner_the_dataset_lacks(client, three):
    r = client.get(f"/factor-analysis/datasets/{three}/descriptives", params={"miner": "Hybrid ILP miner"})
    assert r.status_code == 400 and r.json()["code"] == "unknown_miner"


def test_the_methods_paragraph_of_a_miner_names_its_rows_and_counts(client, three):
    url = f"/factor-analysis/datasets/{three}"
    alone = client.post(f"{url}/analyze", json={"miner": "Inductive miner", "assignment_rule": "hair"}).json()
    text = client.post(
        f"{url}/export/methods", json={"miner": "Inductive miner", "assignment_rule": "hair", "language": "de"}
    ).json()["text"]
    assert "(die Zeilen des Miners Inductive miner)" in text
    assert f"hat {alone['n_observations']} Beobachtungen von {alone['miner']['n_measures']} " in text
    assert "(wie in Tabelle 17 von Important Factors, mit den Schwellen von Hair et al.~\\cite{hair_multivariate})" in text
