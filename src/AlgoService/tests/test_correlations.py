"""The correlations of the measures (factor_analysis/correlations.py): the correlation map of the
suitability step as the API serves it, its figure and its place in the ZIP."""

from __future__ import annotations

import io
import json
import struct
import time
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis import core, correlations, figures, storage
from tests.test_miners import MINERS, _table, _upload

BUNDLED = "comfy-paper-inductive-miner"
LOG = "comfy-log-pdc-training-logs"
#: The settings of the paper: four factors, varimax.
OPTIONS = {"n_factors": 4, "rotation": "varimax", "assignment_rule": "multi"}


def _bundled(client, bundled_id: str = BUNDLED, kind: str = "model") -> str:
    r = client.post("/factor-analysis/datasets", data={"kind": kind, "source": "bundled", "bundled_id": bundled_id})
    assert r.status_code == 200, r.text
    return f"/factor-analysis/datasets/{r.json()['dataset_id']}"


@pytest.fixture
def url(client) -> str:
    return _bundled(client)


def _svg_texts(svg: bytes) -> list[str]:
    root = ET.fromstring(svg)
    return ["".join(t.itertext()) for t in root.iter("{http://www.w3.org/2000/svg}text")]


def _groups(n_groups: int = 3, size: int = 4, rows: int = 60, seed: int = 4) -> pd.DataFrame:
    """Measures that move together in groups, the columns shuffled so that the groups are not together."""
    rng = np.random.default_rng(seed)
    columns: dict[str, np.ndarray] = {}
    for g in range(n_groups):
        base = rng.standard_normal(rows)
        for k in range(size):
            columns[f"g{g}_{k}"] = base + 0.15 * rng.standard_normal(rows)
    names = list(columns)
    rng.shuffle(names)
    return pd.DataFrame({n: columns[n] for n in names}, index=[f"row{i}" for i in range(rows)])


# --- the correlations -----------------------------------------------------------------------


def test_the_matrix_is_the_correlation_the_analysis_starts_from(client, url):
    out = client.post(f"{url}/correlations").json()
    stored = client.get(f"{url}").json()
    assert out["order"] == "dataset" and out["groups"] is None and out["miner"] is None
    assert out["measures"] == stored["measures"]
    r = np.array(out["r"])
    assert r.shape == (len(out["measures"]),) * 2
    assert np.allclose(r, r.T) and np.allclose(np.diag(r), 1.0)
    # The values are the rounded Pearson correlations of the stored matrix.
    session = next(d.name for d in storage.root().iterdir() if (d / stored["id"]).is_dir())
    data = storage.load_matrix(session, stored["id"])
    assert np.allclose(r, np.corrcoef(data.to_numpy(), rowvar=False), atol=1e-6)
    assert out["n_observations"] == stored["n_observations"]


def test_the_closest_partners_and_the_pairs_over_the_limit(client, url):
    out = client.post(f"{url}/correlations").json()
    r = np.array(out["r"])
    names = out["measures"]
    for i, measure in enumerate(names):
        partners = out["top"][measure]
        assert len(partners) == correlations.CLOSEST and all(p["measure"] != measure for p in partners)
        assert [abs(p["r"]) for p in partners] == sorted((abs(p["r"]) for p in partners), reverse=True)
        best = max((abs(r[i, j]), j) for j in range(len(names)) if j != i)[0]
        assert abs(partners[0]["r"]) == pytest.approx(best, abs=1e-6)
    high = out["high"]
    expected = sum(1 for i in range(len(names)) for j in range(i + 1, len(names)) if abs(r[i, j]) >= correlations.HIGH)
    assert high["threshold"] == correlations.HIGH and high["count"] == expected == len(high["pairs"])
    assert all(abs(p["r"]) >= correlations.HIGH for p in high["pairs"])
    assert [abs(p["r"]) for p in high["pairs"]] == sorted((abs(p["r"]) for p in high["pairs"]), reverse=True)


def test_the_clusters_bring_the_measures_that_move_together_next_to_each_other():
    data = _groups()
    out = correlations.build(data, "cluster")
    assert sorted(out["measures"]) == sorted(data.columns)
    # Each group of four stands together, whatever the order of the groups.
    groups = [m.split("_")[0] for m in out["measures"]]
    runs = [groups[i:i + 4] for i in range(0, len(groups), 4)]
    assert all(len(set(run)) == 1 for run in runs), groups
    # The matrix is that of the measures in this order, and the input is not reordered.
    again = np.corrcoef(data[out["measures"]].to_numpy(), rowvar=False)
    assert np.allclose(np.array(out["r"]), again, atol=1e-6)
    assert correlations.build(data, "cluster")["measures"] == out["measures"]
    assert list(data.columns) == list(_groups().columns)


def test_requesting_a_map_changes_nothing_of_the_analysis(client, url):
    before = client.post(f"{url}/analyze", json=OPTIONS).json()
    for order in ("cluster", "factor", "dataset"):
        assert client.post(f"{url}/correlations", json={**OPTIONS, "order": order}).status_code == 200
    after = client.post(f"{url}/analyze", json=OPTIONS).json()
    assert after["kmo"] == before["kmo"] and after["loadings"] == before["loadings"]
    assert after["used_measures"] == before["used_measures"]


def test_the_order_by_factor_groups_the_measures_by_their_dimensions(client, url):
    analysis = client.post(f"{url}/analyze", json=OPTIONS).json()
    out = client.post(f"{url}/correlations", json={**OPTIONS, "order": "factor"}).json()
    assert out["order"] == "factor"
    by_factor = [g for g in out["groups"] if g["factor"] is not None]
    assert [g["factor"] for g in by_factor] == [f["index"] for f in analysis["factors"] if f["measures"]]
    for group in by_factor:
        factor = next(f for f in analysis["factors"] if f["index"] == group["factor"])
        # Strongest loading first, as in the loadings heatmap.
        assert group["measures"] == [m["measure"] for m in factor["measures"] if m["measure"] in group["measures"]]
    # The measures in a group are the map's, in the order of the groups, and the same as the figure's.
    assert out["measures"] == [m for g in out["groups"] for m in g["measures"]]
    assert sorted(out["measures"]) == sorted(client.get(url).json()["measures"])
    order = figures.order_measures(analysis, "factor")
    assert out["measures"][: len(order)] == order


def test_a_measure_the_msa_filter_removes_is_on_the_map_in_the_group_without_a_dimension(client):
    url = _bundled(client, "comfy-paper-hybrid-ilp-miner")
    analysis = client.post(f"{url}/analyze", json={"assignment_rule": "multi"}).json()
    removed = [r["measure"] for r in analysis["msa_filter"]["removed"]]
    assert removed, "the data are expected to have a measure the MSA filter removes"
    out = client.post(f"{url}/correlations", json={"assignment_rule": "multi", "order": "factor"}).json()
    last = out["groups"][-1]
    assert last["factor"] is None and set(removed) <= set(last["measures"])
    assert last["measures"][-len(removed):] == removed
    for measure in removed:
        assert measure in out["measures"]


def test_excluded_measures_leave_the_map_and_unknown_ones_are_refused(client, url):
    measures = client.get(url).json()["measures"]
    out = client.post(f"{url}/correlations", json={"excluded": measures[:2]}).json()
    assert out["measures"] == measures[2:] and len(out["r"]) == len(measures) - 2
    assert all(m not in measures[:2] for partners in out["top"].values() for p in partners for m in [p["measure"]])
    bad = client.post(f"{url}/correlations", json={"excluded": ["nope"]})
    assert bad.status_code == 400 and bad.json()["code"] == "unknown_excluded"
    few = client.post(f"{url}/correlations", json={"excluded": measures[:-1]})
    assert few.status_code == 400 and few.json()["code"] == "too_few_measures_for_map"
    assert few.json()["params"] == {"min": 2, "left": 1}
    assert client.post("/factor-analysis/datasets/not-an-id/correlations").status_code == 400


def test_the_map_of_a_miner_is_that_of_its_rows(client):
    dataset = _upload(client, _table())
    url = f"/factor-analysis/datasets/{dataset}"
    together = client.post(f"{url}/correlations").json()
    one = client.post(f"{url}/correlations", json={"miner": "Alpha miner"}).json()
    assert one["miner"]["name"] == "Alpha miner" and one["n_observations"] == 50
    # A measure without variance within the miner is not on its map.
    assert one["miner"]["dropped"] == [{"measure": "Number of duplicate tasks", "reason": "constant"}]
    assert "Number of duplicate tasks" in together["measures"] and "Number of duplicate tasks" not in one["measures"]
    assert client.post(f"{url}/correlations", json={"miner": "Nope"}).json()["code"] == "unknown_miner"
    assert MINERS[0] == "Alpha miner"


def test_a_map_of_over_a_hundred_measures_is_made_in_well_under_a_second(client):
    url = _bundled(client, LOG, "log")
    started = time.perf_counter()
    out = client.post(f"{url}/correlations", json={"order": "cluster"}).json()
    elapsed = time.perf_counter() - started
    assert len(out["measures"]) > 100 and len(out["r"][0]) == len(out["measures"])
    assert elapsed < 1.0, elapsed


# --- the figure and the archive -------------------------------------------------------------


def _figure(client, url: str, **body) -> bytes:
    r = client.post(f"{url}/export/figure", json={**OPTIONS, "figure": "correlations", **body})
    assert r.status_code == 200, r.text
    return r.content


def test_the_figure_is_svg_with_text_and_names_the_dimensions(client, url):
    svg = _figure(client, url, correlation_order="factor", factor_names=["Size", None, "Variety"])
    texts = _svg_texts(svg)
    assert "Coefficient of network connectivity" in texts and "Size" in texts and "F2" in texts and "Variety" in texts
    assert any(t.startswith("Pearson correlations r; outlined: |r| ≥ 0.95; measures grouped by dimension") for t in texts)
    # Up to 17 measures have their r written in the cells.
    assert "1.00" in texts
    german = _svg_texts(_figure(client, url, correlation_order="cluster", language="de"))
    assert any(t.startswith("Pearson-Korrelationen r; umrandet: |r| ≥ 0,95; Maße gruppiert") for t in german)
    # The same analysis and options give the same file.
    assert _figure(client, url, correlation_order="factor", factor_names=["Size", None, "Variety"]) == svg


def test_the_figure_follows_the_exclusions_the_codes_and_the_png_has_300_dpi(client, url):
    measures = client.get(url).json()["measures"]
    kept = _svg_texts(_figure(client, url, excluded=[measures[0]], correlation_order="dataset"))
    assert measures[0] not in kept and measures[1] in kept
    short = _svg_texts(_figure(client, url, short_codes=True, correlation_order="dataset"))
    assert "CNC" in short and "Coefficient of network connectivity" not in short
    png = client.post(f"{url}/export/figure", json={**OPTIONS, "figure": "correlations", "format": "png"}).content
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    at = png.index(b"pHYs")
    assert round(struct.unpack(">I", png[at + 4:at + 8])[0] * 0.0254) == 300


def test_the_figure_of_over_a_hundred_measures_draws_them_all(client):
    url = _bundled(client, LOG, "log")
    started = time.perf_counter()
    svg = _figure(client, url, correlation_order="cluster", n_factors=6)
    elapsed = time.perf_counter() - started
    shown = len(client.get(url).json()["measures"])
    ticks = [t for t in _svg_texts(svg) if t not in ("−1", "0", "1") and not t.startswith("Pearson")]
    assert len(ticks) >= 2 * shown
    assert elapsed < 30, elapsed


def test_the_archive_has_the_correlations_as_table_and_figure(client, url):
    r = client.post(f"{url}/export/zip", json={**OPTIONS, "correlation_order": "cluster"})
    assert r.status_code == 200, r.text
    archive = zipfile.ZipFile(io.BytesIO(r.content))
    names = archive.namelist()
    assert "correlations.csv" in names and "figures/correlations.svg" in names
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["correlation_order"] == "cluster"
    listed = {f["name"]: f["description"] for f in manifest["files"]}
    assert "correlation map" in listed["figures/correlations.svg"]
    assert "correlations.csv" in listed
    rows = archive.read("correlations.csv").decode().splitlines()
    measures = rows[0].split(",")[1:]
    assert [row.split(",")[0] for row in rows[1:]] == measures
    assert set(measures) == set(client.get(url).json()["measures"])
    # The table is the map as /correlations gives it.
    served = client.post(f"{url}/correlations", json={**OPTIONS, "order": "cluster"}).json()
    assert measures == served["measures"]
    assert "correlations.csv" in archive.read("README.txt").decode()


def test_the_archive_orders_the_map_by_factor_unless_told_otherwise(client, url):
    manifest = json.loads(zipfile.ZipFile(io.BytesIO(client.post(f"{url}/export/zip", json=OPTIONS).content)).read("manifest.json"))
    assert manifest["correlation_order"] == "factor"


def test_the_correlation_map_of_a_model_is_unchanged_by_the_core_helpers():
    """correlations.correlation is core.correlation_matrix made symmetric, with 1 on the diagonal."""
    data = _groups()
    assert np.allclose(correlations.correlation(data), core.correlation_matrix(data), atol=1e-12)
    constant = data.assign(flat=1.0)
    r = correlations.correlation(constant)
    assert r[-1, -1] == 1.0 and not np.isnan(r).any() and np.all(r[-1, :-1] == 0.0)
    assert cat.bundled_entry(BUNDLED) is not None
