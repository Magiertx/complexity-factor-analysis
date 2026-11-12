"""Adapter for ComFy (complexity measures of discovered Petri nets).

The user uploads one XES log, picks discovery algorithms and complexity
measures, and gets a table of (miner × measure) scores. The factor analysis
over many logs is in ``factor_analysis/`` and reuses ``discover`` and
``measure_value`` from here.

Talks to the ProM4Py Java server over HTTP (``PROM4PY_URL``).

Original code: https://github.com/Pati-nets/ComFy
Vendored under ``src/AlgoService/vendored/comfy/``; local changes are listed in
``PROVENANCE.md`` there.
"""

from __future__ import annotations

import time
from typing import Any

from vendored.comfy.modelcomplexity import ModelComplexityMeasures as _MCM
from vendored.comfy.discovery import DiscoveryAlgorithms as _DA
from ._log_io import read_event_log
from ._prom4py import (
    CALL_TIMEOUT_S,
    ProMNotRestarted,
    ProMTimeout,
    ProMUnavailable,
    WaitFn,
    call_deadline,
    get_prom4py,
    prom4py_turn,
    wait_for_prom4py,
)

from .base import (
    AlgorithmBase, AnalysisResult, CodedRunError, ParameterSpec, stat, table, text, image, log_file, RunContext,
)
from ._petrinet import render_petri_net_to_base64_png


MEASURES_BY_NAME = {str(m): m for m in _MCM.all_model_complexity_measures}
MINERS_BY_NAME = {str(m): m for m in _DA.analyzed_discovery_algorithms}

# Not selected by default: they enumerate paths or cycles and can take minutes on large nets.
SLOW_MEASURES = {"Cross-Connectivity", "Depth", "Diameter", "Cyclicity"}

# Miners that can run for many minutes on mid-sized logs: Alpha++ was still running after 15
# minutes on a 1000-trace PDC log that the other miners finish in seconds. Such a discovery
# fails for its input after PROM4PY_CALL_TIMEOUT. The ComFy paper leaves both out as well.
SLOW_MINERS = {"Alpha Plus Plus miner", "Alpha Robust miner"}

# Measures that need the initial and final marking.
_MARKING_MEASURES = {"Depth", "Diameter"}

# ProM4Py now and then fails a plugin call with "AcceptingPetriNetImpl cannot be cast to
# ProMFuture" (about one call in seven in our runs); the same call works when repeated. A
# discovery is also repeated when ProM went away during it, e.g. restarted by its watchdog.
DISCOVERY_ATTEMPTS = 3


def discover(
    miner: Any,
    event_log: Any,
    log_name: str | None = None,
    on_wait: WaitFn | None = None,
    timing: dict[str, float] | None = None,
) -> tuple[Any, Any, Any]:
    """Run one ComFy miner; returns (net, initial marking, final marking).

    The discovery has ProM4Py to itself and may take ``CALL_TIMEOUT_S`` seconds there, after
    which it raises :class:`ProMTimeout` naming the miner and ``log_name``. ``on_wait`` is
    called while it waits for ProM and may raise to abort. ``timing`` gets ``run_s``, the
    seconds of the call that succeeded, without the wait for ProM4Py, and ``attempts``.
    """
    for attempt in range(1, DISCOVERY_ATTEMPTS + 1):
        try:
            with prom4py_turn(on_wait), call_deadline(CALL_TIMEOUT_S):
                started = time.perf_counter()
                net_obj = miner.discover_for(event_log)
                if timing is not None:
                    timing.update(run_s=time.perf_counter() - started, attempts=attempt)
            break
        except ProMTimeout:
            # Not repeated: the miner would most likely time out again. ProM goes on with the
            # call until its watchdog restarts it; the next turn waits for that.
            on = f" on {log_name}" if log_name else ""
            raise ProMTimeout(f"ProM took longer than {CALL_TIMEOUT_S} s for {miner}{on}") from None
        except ProMUnavailable as e:
            # Starting or restarted, which also empties ProM's object cache, so the discovery
            # starts over once ProM answers again. Not when the turn already waited for ProM's
            # restart in vain: then ProM is down for longer.
            if attempt == DISCOVERY_ATTEMPTS or isinstance(e, ProMNotRestarted):
                raise
            wait_for_prom4py(on_wait)
        except Exception as e:
            if attempt == DISCOVERY_ATTEMPTS or "ProMFuture" not in str(e):
                raise
    # miners return either (net, im, fm) tuples or a single graph
    if isinstance(net_obj, tuple) and len(net_obj) == 3:
        return net_obj
    return net_obj, None, None


def measure_value(measure: Any, net: Any, im: Any = None, fm: Any = None) -> Any:
    """One ComFy measure on one net."""
    if str(measure) in _MARKING_MEASURES:
        return measure.calculate_for(net, im, fm)
    return measure.calculate_for(net)


class ComFyAlgorithm(AlgorithmBase):
    """Adapter for ComFy: mines a Petri net per chosen miner and computes the chosen complexity measures on each net."""
    id = "comfy"
    name = "ComFy — Petri-net complexity"
    description = (
        "Discover a Petri net from the uploaded event log with the chosen miners, "
        "then compute complexity measures on each resulting net."
    )
    paper_url = "https://github.com/Pati-nets/ComFy"
    author = "Patrizia Schalk"
    tool_type = "complexity"
    citation = (
        "@misc{schalk_comfy,\n"
        "  title={{ComFy: A tool to perform factor analyses on complexity measures}},\n"
        "  author={Schalk, Patrizia},\n"
        "  year={2026},\n"
        "  howpublished={\\url{https://github.com/Pati-nets/ComFy}}\n"
        "}"
    )
    formatted_citation = (
        "Patrizia Schalk. (2026). \"ComFy: A tool to perform factor analyses on complexity measures.\" "
        "GitHub Repository, https://github.com/Pati-nets/ComFy"
    )

    # Filled in ``__init__`` from the vendored measure and miner lists.
    parameters_schema: list[ParameterSpec] = []

    def __init__(self) -> None:
        """Build the parameter schema from the vendored measure and miner lists."""
        self._measures_by_name = MEASURES_BY_NAME
        self._miners_by_name = MINERS_BY_NAME

        measure_names = list(self._measures_by_name)
        miner_names = list(self._miners_by_name)

        default_measures = [m for m in measure_names if m not in SLOW_MEASURES]

        self.parameters_schema = [
            ParameterSpec(
                "discovery_algorithms",
                "Discovery algorithms",
                "multi_enum",
                default=miner_names[:1],
                options=miner_names,
                help="Which miners to run on the uploaded log.",
            ),
            ParameterSpec(
                "complexity_measures",
                "Complexity measures",
                "multi_enum",
                default=default_measures,
                options=measure_names,
                help="Measures to compute on each discovered net. Cross-Connectivity, Depth, Diameter and Cyclicity are slow.",
            ),
        ]

    def analyze(self, file_path: str, params: dict[str, Any], ctx: RunContext | None = None) -> AnalysisResult:
        """Discover a net with each selected miner and compute the selected measures on it.

        Raises ``ValueError`` when no miner or no measure is selected.
        """
        if ctx is None:
            ctx = RunContext()
        ctx.check_aborted()
        ctx.progress(5.0, "Reading event log...")

        miner_names: list[str] = params["discovery_algorithms"]
        measure_names: list[str] = params["complexity_measures"]
        if not miner_names:
            raise ValueError("Pick at least one discovery algorithm.")
        if not measure_names:
            raise ValueError("Pick at least one complexity measure.")

        miners = [self._miners_by_name[n] for n in miner_names if n in self._miners_by_name]
        measures = [self._measures_by_name[n] for n in measure_names if n in self._measures_by_name]
        if not miners or not measures:
            raise ValueError("Unknown miner or measure in the request.")

        # Warm up the shared client so the vendored miners reuse it.
        get_prom4py()
        event_log = read_event_log(file_path)

        # Compute one row per miner. A failure is noted once per message, with where it happened:
        # one error of a measure on every miner is one note, not one per miner.
        failures: dict[str, list[str]] = {}
        columns = ["Miner"] + [str(m) for m in measures]
        rows: list[list[Any]] = []
        pn_images: list[Any] = []
        # Miners whose discovery failed because ProM4Py could not be reached.
        unreachable = 0

        for idx, miner in enumerate(miners):
            ctx.check_aborted()
            pct = 5.0 + (idx / len(miners)) * 95.0
            ctx.progress(pct, f"Analyzing complexity for {miner} ({idx + 1}/{len(miners)})...")

            row: list[Any] = [str(miner)]
            try:
                net, im, fm = discover(
                    miner, event_log, ctx.log_name,
                    on_wait=lambda msg: ctx.progress(pct, f"{miner}: {msg}"),
                )

                # Render Petri Net visualization if available
                if net is not None:
                    img_base64 = render_petri_net_to_base64_png(net, im, fm)
                    if img_base64:
                        pn_images.append(image(f"Petri net ({miner})", img_base64, caption=f"Discovered by {miner}"))
                    # 300 dpi download for print, next to the inline image.
                    hires_base64 = render_petri_net_to_base64_png(net, im, fm, dpi=300)
                    if hires_base64:
                        pn_images.append(log_file(
                            f"Download high-DPI PNG ({miner}, 300 dpi)",
                            hires_base64,
                            f"model_{miner}.png",
                            mime="image/png",
                        ))
            except Exception as e:
                row.extend([f"ERR: {type(e).__name__}"] * len(measures))
                failures.setdefault(f"discovery failed: {e}", []).append(str(miner))
                rows.append(row)
                unreachable += isinstance(e, ProMUnavailable)
                continue

            for measure in measures:
                ctx.check_aborted()
                try:
                    row.append(_round(measure_value(measure, net, im, fm)))
                except Exception as e:
                    row.append(f"ERR: {type(e).__name__}")
                    failures.setdefault(str(e), []).append(f"{miner} × {measure}")
            rows.append(row)

        notes = [_failure_note(message, where) for message, where in failures.items()]

        # Single failures become ERR cells; if nothing computed at all (usually ProM4Py
        # being down), fail the job instead of returning a table of errors.
        computed = sum(
            1 for row in rows for cell in row[1:]
            if not (isinstance(cell, str) and cell.startswith("ERR:"))
        )
        if rows and computed == 0:
            detail = notes[0] if notes else "no measure could be computed"
            if unreachable == len(miners):
                raise CodedRunError(
                    f"ProM4Py could not be reached, so no miner could run. First error: {detail}",
                    "prom_unavailable",
                )
            raise RuntimeError(
                f"ComFy produced no results — every miner/measure combination failed. "
                f"First error: {detail}"
            )

        ctx.progress(100.0, "Analysis complete!")

        summary = f"{len(miners)} miner(s) × {len(measures)} measure(s)"
        if computed < len(miners) * len(measures):
            summary += f" — {computed} of {len(miners) * len(measures)} cells computed"
        artifacts = [
            stat("Miners", len(miners)),
            stat("Measures", len(measures)),
            stat("Cells computed", f"{computed} / {len(miners) * len(measures)}",
                 accent="warn" if computed < len(miners) * len(measures) else "default"),
            table("Complexity scores", columns, rows),
        ] + pn_images
        if notes:
            artifacts.append(text("Notes", "\n\n".join(notes)))
        return AnalysisResult(artifacts=artifacts, summary=summary)


def _failure_note(message: str, where: list[str]) -> str:
    """One note for a failure: where it happened (the first few of many, with their count) and why."""
    shown = ", ".join(where[:3])
    if len(where) > 3:
        shown += f" and {len(where) - 3} more"
    return f"{shown}: {message}"


def _round(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 4)
    return value
