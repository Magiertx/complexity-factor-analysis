"""Offline unit tests for `algorithms/_petrinet.py`.

The ComFy end-to-end test covers this module only when ProM4Py is reachable.
These tests hit the renderer directly with a hand-rolled Petri net and skip
themselves only when Graphviz `dot` is missing.
"""

from __future__ import annotations

import base64
import shutil

import pytest


def _has_graphviz() -> bool:
    return shutil.which("dot") is not None


def _toy_net():
    """Build a minimal Petri net (A → B) with initial + final markings."""
    from pm4py.objects.petri_net.obj import PetriNet, Marking
    from pm4py.objects.petri_net.utils.petri_utils import add_arc_from_to

    net = PetriNet("toy")
    src = PetriNet.Place("src")
    mid = PetriNet.Place("mid")
    snk = PetriNet.Place("snk")
    net.places.update({src, mid, snk})

    t_a = PetriNet.Transition("t_a", "A")
    t_b = PetriNet.Transition("t_b", "B")
    net.transitions.update({t_a, t_b})

    add_arc_from_to(src, t_a, net)
    add_arc_from_to(t_a, mid, net)
    add_arc_from_to(mid, t_b, net)
    add_arc_from_to(t_b, snk, net)

    im = Marking({src: 1})
    fm = Marking({snk: 1})
    return net, im, fm


@pytest.mark.skipif(not _has_graphviz(), reason="Graphviz `dot` not on PATH")
def test_render_plain_net_returns_base64_png():
    """Sanity: a plain net renders to a non-empty PNG."""
    from algorithms._petrinet import render_petri_net_to_base64_png

    net, im, fm = _toy_net()
    out = render_petri_net_to_base64_png(net, im, fm)
    assert out is not None
    raw = base64.b64decode(out)
    assert raw.startswith(b"\x89PNG"), "decoded output is not a PNG"


def test_render_returns_none_for_none_net():
    """Sentinel value: a None net short-circuits to None (no exception)."""
    from algorithms._petrinet import render_petri_net_to_base64_png

    assert render_petri_net_to_base64_png(None, None, None) is None
