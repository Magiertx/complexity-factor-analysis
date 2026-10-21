"""Run times and input sizes of a computed dataset (factor_analysis/compute.py)."""

from __future__ import annotations

import math

import pytest

from factor_analysis import catalog as cat
from factor_analysis import compute
from factor_analysis.export import MEASUREMENT_COLUMNS, measurement_csv, measurement_rows, stages_csv
from tests.test_factor_analysis_api import LOGS, _pnml_bytes, _xes


@pytest.fixture
def xes_paths(tmp_path) -> list[compute.Input]:
    out = []
    for name, traces in LOGS.items():
        path = tmp_path / name
        path.write_bytes(_xes(name, traces))
        out.append(compute.Input(str(path), name))
    return out


def test_log_features_are_feeds_and_timed_per_group(xes_paths):
    from feeed.feature_extractor import extract_features

    features = cat.log_features(["simple_stats", "trace_length", "trace_variant"])
    result = compute.log_from_logs(xes_paths, features, lambda pct, msg: None)
    # The same values as feeed's own extract_features, which reads and loops the same way.
    for item in xes_paths:
        expected = extract_features(item.path, features)
        for f in features:
            ours, theirs = result.table.loc[item.label, f], compute._number(expected.get(f))
            assert (math.isnan(ours) and math.isnan(theirs)) or ours == theirs, (item.label, f)

    m = result.measurement.to_dict()
    assert m["kind"] == "log" and m["unit"] == "seconds" and m["total_s"] > 0
    sizes = {i["input"]: i for i in m["inputs"]}
    assert sizes["seq.xes"]["traces"] == 4 and sizes["seq.xes"]["events"] == 13
    assert sizes["seq.xes"]["variants"] == 2 and sizes["seq.xes"]["activities"] == 4
    assert sizes["loop.xes"]["variants"] == 4 and sizes["loop.xes"]["activities"] == 4
    observation = m["observations"][0]
    assert set(observation["stages"]) == {"simple_stats", "trace_length", "trace_variant"}
    assert observation["features_s"] == pytest.approx(sum(observation["stages"].values()), abs=1e-5)


def test_model_measures_of_pnml_files_are_timed_per_measure(tmp_path):
    inputs = []
    for name, traces in LOGS.items():
        path = tmp_path / f"{name}.pnml"
        path.write_bytes(_pnml_bytes(traces))
        inputs.append(compute.Input(str(path), path.name))
    result = compute.model_from_pnml(inputs, ["Size", "Density"], lambda pct, msg: None)
    m = result.measurement.to_dict()
    observation = m["observations"][0]
    assert set(observation["stages"]) == {"Size", "Density"}
    net = observation["net"]
    # Size counts the places and transitions of the net.
    assert result.table.loc[observation["observation"], "Size"] == net["places"] + net["transitions"]
    assert net["arcs"] > 0


def test_model_measures_of_discovered_nets_record_the_discovery(xes_paths, monkeypatch):
    """Without ProM: a stand-in miner with pm4py's Inductive miner."""
    import pm4py

    from algorithms import _prom4py, comfy

    def discover(miner, log, label, on_wait=None, timing=None):
        timing.update(run_s=0.01, attempts=1)
        return pm4py.discover_petri_net_inductive(log)

    monkeypatch.setattr(comfy, "discover", discover)
    monkeypatch.setattr(_prom4py, "get_prom4py", lambda: None)
    result = compute.model_from_logs(xes_paths[:2], ["Inductive miner", "Alpha miner"], ["Size"], lambda p, m: None)
    m = result.measurement.to_dict()
    assert len(m["inputs"]) == 2 and len(m["observations"]) == 4
    assert m["inputs"][0]["traces"] == 4 and m["inputs"][0]["variants"] == 2
    assert m["observations"][1]["miner"] == "Alpha miner"
    assert m["observations"][0]["discovery_run_s"] == 0.01
    assert set(m["observations"][0]["net"]) == {"places", "transitions", "arcs"}

    rows = measurement_rows(m)
    assert len(rows) == 4 and len(rows[0]) == len(MEASUREMENT_COLUMNS)
    first = dict(zip(MEASUREMENT_COLUMNS, rows[0]))
    # A log is read once for all its miners.
    assert first["read_s"] == dict(zip(MEASUREMENT_COLUMNS, rows[1]))["read_s"]
    assert measurement_csv(m).splitlines()[0] == ",".join(MEASUREMENT_COLUMNS)
    assert stages_csv(m).splitlines()[1].endswith(tuple("0123456789"))


def test_an_input_that_cannot_be_read_has_a_row_with_its_error(tmp_path):
    bad = tmp_path / "bad.pnml"
    bad.write_text("not xml")
    result = compute.model_from_pnml([compute.Input(str(bad), "bad.pnml")], ["Size"], lambda p, m: None)
    rows = [dict(zip(MEASUREMENT_COLUMNS, r)) for r in measurement_rows(result.measurement.to_dict())]
    assert rows[0]["observation"] == "bad.pnml" and rows[0]["error"]
