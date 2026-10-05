"""Adapter for ComFy (complexity measures of discovered Petri nets).

Single-file MVP: the user uploads one XES log, picks discovery algorithms and
complexity measures, and gets a table of (miner × measure) scores. Factor
analysis itself (Bartlett/KMO/scree/loadings) needs many logs and isn't
exposed yet.

Talks to the ProM4Py Java server over HTTP — URL via env var ``PROM4PY_URL``.

Original code: https://github.com/Pati-nets/ComFy
Vendored under ``src/AlgoService/vendored/comfy/`` (read-only).
"""

from __future__ import annotations

import os
from typing import Any

from vendored.comfy.modelcomplexity import ModelComplexityMeasures as _MCM
from vendored.comfy.discovery import DiscoveryAlgorithms as _DA
from ._log_io import read_event_log
from ._prom4py import get_prom4py

from .base import AlgorithmBase, AnalysisResult, ParameterSpec, stat, table, text, image, log_file, RunContext
from ._petrinet import render_petri_net_to_base64_png



class ComFyAlgorithm(AlgorithmBase):
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
        "@misc{schalk2024comfy,\n"
        "  title={{ComFy: Complexity and Factor Analysis of Discovered Process Models}},\n"
        "  author={Schalk, Patrizia},\n"
        "  year={2024},\n"
        "  howpublished={\\url{https://github.com/Pati-nets/ComFy}}\n"
        "}"
    )
    formatted_citation = (
        "Patrizia Schalk. (2024). \"ComFy: Complexity and Factor Analysis of Discovered Process Models.\" "
        "GitHub Repository, https://github.com/Pati-nets/ComFy"
    )

    # Options are populated lazily so module import doesn't depend on vendor sys.path
    # being set up. ``parameters_schema`` is filled in ``__init__``.
    parameters_schema: list[ParameterSpec] = []

    def __init__(self) -> None:
        self._measures_by_name = {str(m): m for m in _MCM.all_model_complexity_measures}
        self._miners_by_name = {str(m): m for m in _DA.analyzed_discovery_algorithms}

        measure_names = list(self._measures_by_name)
        miner_names = list(self._miners_by_name)

        # Sensible defaults — exclude the very-slow measures from the default selection.
        slow = {"Cross-Connectivity", "Depth", "Diameter", "Cyclicity"}
        default_measures = [m for m in measure_names if m not in slow]

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
        if ctx is None:
            ctx = RunContext()
        ctx.check_aborted()
        ctx.progress(5.0, "Reading event log...")

        import pm4py
        MCM = _MCM

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

        depth_diameter = {MCM.Depth(), MCM.Diameter()}
        depth_diameter_keys = {str(m) for m in depth_diameter}

        # Compute one row per miner.
        notes: list[str] = []
        columns = ["Miner"] + [str(m) for m in measures]
        rows: list[list[Any]] = []
        pn_images: list[Any] = []

        for idx, miner in enumerate(miners):
            ctx.check_aborted()
            pct = 5.0 + (idx / len(miners)) * 95.0
            ctx.progress(pct, f"Analyzing complexity for {miner} ({idx + 1}/{len(miners)})...")

            row: list[Any] = [str(miner)]
            try:
                net_obj = miner.discover_for(event_log)
                # miners return either (net, im, fm) tuples or a single graph
                if isinstance(net_obj, tuple) and len(net_obj) == 3:
                    net, im, fm = net_obj
                else:
                    net, im, fm = net_obj, None, None

                # Render Petri Net visualization if available
                if net is not None:
                    img_base64 = render_petri_net_to_base64_png(net, im, fm)
                    if img_base64:
                        pn_images.append(image(f"Petri net ({miner})", img_base64, caption=f"Discovered by {miner}"))
                    # High-DPI publication download, parallel to the screen-DPI inline image.
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
                notes.append(f"{miner}: discovery failed — {e}")
                rows.append(row)
                continue

            for measure in measures:
                ctx.check_aborted()
                try:
                    if str(measure) in depth_diameter_keys:
                        value = measure.calculate_for(net, im, fm)
                    else:
                        value = measure.calculate_for(net)
                    row.append(_round(value))
                except Exception as e:
                    row.append(f"ERR: {type(e).__name__}")
                    notes.append(f"{miner} × {measure}: {e}")
            rows.append(row)

        # Individual failures degrade to an ERR cell so one broken miner does not lose the
        # rest of the table. But if *nothing* computed, reporting a completed job with a
        # table full of error strings misrepresents the run — fail loudly instead. The most
        # common cause by far is ProM4Py being unreachable.
        computed = sum(
            1 for row in rows for cell in row[1:]
            if not (isinstance(cell, str) and cell.startswith("ERR:"))
        )
        if rows and computed == 0:
            detail = notes[0] if notes else "no measure could be computed"
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


def _round(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 4)
    return value
