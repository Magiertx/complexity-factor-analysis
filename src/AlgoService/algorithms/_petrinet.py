"""Shared Petri-net rendering helper."""

from __future__ import annotations

from typing import Any
from .base import temp_file_path


def render_petri_net_to_base64_png(
    net: Any,
    im: Any,
    fm: Any,
    dpi: int | None = None,
) -> str | None:
    """Render a Petri net using pm4py's visualizer and return it as a base64 PNG string.

    ``dpi`` injects a Graphviz ``dpi`` graph attribute before piping. Pass e.g.
    ``300`` for print-quality output; leave at ``None`` for Graphviz's default
    (96), which suits inline screen display. Returns ``None`` if rendering
    fails (e.g., Graphviz is not installed).
    """
    if net is None:
        return None
    try:
        from pm4py.visualization.petri_net import visualizer as pn_visualizer
        import base64

        gviz = pn_visualizer.apply(net, im, fm)
        # Transparent background so the frontend can choose the canvas color
        # (grid / light / dark cycle in the lightbox). pm4py defaults to a
        # baked-in white background, which makes that toggle inert.
        gviz.graph_attr["bgcolor"] = "transparent"
        if dpi is not None:
            gviz.graph_attr["dpi"] = str(dpi)

        # Try to pipe directly to avoid disk I/O
        try:
            png_bytes = gviz.pipe(format="png")
            return base64.b64encode(png_bytes).decode("utf-8")
        except Exception:
            # Fallback to tempfile
            with temp_file_path(".png") as tmp_path:
                pn_visualizer.save(gviz, str(tmp_path))
                with open(tmp_path, "rb") as f:
                    return base64.b64encode(f.read()).decode("utf-8")
    except Exception as e:
        import sys
        print(f"Failed to render Petri net to PNG: {e}", file=sys.stderr)
        return None
