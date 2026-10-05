"""Tests for the ComFy adapter and the vendored ComFy code it wraps.

Runs that discover a model need the ProM4Py Java service. They probe
``/isRunning`` and skip cleanly when it is down, so ``pytest`` without docker
still passes. Everything that works on a given Petri net runs offline.
"""

from __future__ import annotations

import inspect
import os
import urllib.error
import urllib.request

import pytest

SMOKE_PARAMS = {"discovery_algorithms": ["Inductive miner"], "complexity_measures": ["Size"]}

_SAMPLE_LOG = os.path.join(os.path.dirname(__file__), "..", "sample_logs", "sepsis_cases_mini.xes")


def _prom4py_alive() -> bool:
    """Tap /isRunning with a 1-second budget."""
    url = os.environ.get("PROM4PY_URL", "http://localhost:4040")
    try:
        with urllib.request.urlopen(f"{url}/isRunning", timeout=1.0) as r:
            return r.status == 200
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        return False


PROM4PY_UP = _prom4py_alive()


def _sequence_net():
    """A -> B -> C as a workflow net with initial and final marking."""
    from pm4py.objects.petri_net.obj import Marking, PetriNet
    from pm4py.objects.petri_net.utils.petri_utils import add_arc_from_to

    net = PetriNet("sequence")
    places = [PetriNet.Place(f"p{i}") for i in range(4)]
    net.places.update(places)
    for i, label in enumerate("ABC"):
        t = PetriNet.Transition(f"t_{label}", label)
        net.transitions.add(t)
        add_arc_from_to(places[i], t, net)
        add_arc_from_to(t, places[i + 1], net)
    return net, Marking({places[0]: 1}), Marking({places[-1]: 1})


def test_measures_come_from_vendored_comfy():
    from algorithms.comfy import ComFyAlgorithm

    algo = ComFyAlgorithm()
    for measure in algo._measures_by_name.values():
        assert inspect.getmodule(measure).__name__.startswith("vendored.comfy.modelcomplexity")


def test_manifest_lists_miners_and_measures():
    from algorithms.comfy import ComFyAlgorithm

    manifest = ComFyAlgorithm().manifest()
    params = {p["name"]: p for p in manifest["parameters_schema"]}
    assert manifest["tool_type"] == "complexity"
    assert "Inductive miner" in params["discovery_algorithms"]["options"]
    assert "Size" in params["complexity_measures"]["options"]
    # The slow measures are opt-in.
    assert "Depth" not in params["complexity_measures"]["default"]


@pytest.mark.parametrize(
    "measure_name, expected",
    [
        # A pure sequence has no split or join node, so every node has depth 0.
        ("Depth", 0),
        # The longest path from p0 to p3 visits all 4 places and 3 transitions.
        ("Diameter", 7),
    ],
)
def test_marking_dependent_measures_return_a_value(measure_name, expected):
    """Depth and Diameter need markings; given them they must return the value, not None.

    Values computed by hand for the sequence net A -> B -> C.
    """
    from vendored.comfy.modelcomplexity import ModelComplexityMeasures as MCM

    net, im, fm = _sequence_net()
    assert getattr(MCM, measure_name)().calculate_for(net, im, fm) == expected


@pytest.mark.parametrize("measure_name", ["Depth", "Diameter"])
def test_marking_dependent_measures_refuse_missing_markings(measure_name):
    from vendored.comfy.modelcomplexity import ModelComplexityMeasures as MCM

    net, _, _ = _sequence_net()
    with pytest.raises(Exception, match="initial and final marking"):
        getattr(MCM, measure_name)().calculate_for(net)


def test_size_of_sequence_net():
    """Size counts places and transitions: 4 places + 3 transitions, counted by hand."""
    from vendored.comfy.modelcomplexity import ModelComplexityMeasures as MCM

    net, _, _ = _sequence_net()
    assert MCM.Size().calculate_for(net) == 7


def test_factor_analysis_module_imports():
    """The factor analysis is not wired into a route yet, but it has to stay importable."""
    from vendored.comfy import FactorAnalysis

    assert hasattr(FactorAnalysis, "Constants")


@pytest.mark.skipif(PROM4PY_UP, reason="Only meaningful while ProM4Py is down.")
def test_run_fails_loudly_without_prom4py():
    """With ProM4Py down every cell fails; the run must fail instead of reporting a table of errors."""
    from algorithms.comfy import ComFyAlgorithm

    algo = ComFyAlgorithm()
    with pytest.raises(RuntimeError, match="no results"):
        algo.analyze(_SAMPLE_LOG, algo.coerce_params(SMOKE_PARAMS))


@pytest.mark.skipif(not PROM4PY_UP, reason="ProM4Py unreachable, start it with `docker compose up prom4py`.")
def test_run_reports_real_values_not_error_cells():
    from algorithms.comfy import ComFyAlgorithm

    algo = ComFyAlgorithm()
    result = algo.analyze(_SAMPLE_LOG, algo.coerce_params(SMOKE_PARAMS))

    assert result.summary
    tables = [a for a in result.artifacts if a.kind == "table"]
    assert tables, "ComFy produced no table"
    cells = [c for row in tables[0].payload["rows"] for c in row[1:]]
    assert cells, "ComFy table has no value cells"
    assert not any(isinstance(c, str) and c.startswith("ERR:") for c in cells), cells
