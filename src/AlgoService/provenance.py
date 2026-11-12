"""Where the numbers of a dataset and an analysis come from.

The ZIP export of an analysis carries this in its manifest and README: the tool's version
and commit, the upstream code and data the numbers rest on, the versions of the libraries
that computed them, and how each input was turned into a row.

The tool's version and commit come from ``APP_VERSION`` and ``APP_COMMIT``, which the Docker
build sets from build arguments (docs/DEPLOYMENT.md). Without them, as in a checkout or in
CI, they come from git; a version git does not name (no tag) is the one in ``version.py``,
and a commit that is not passed and cannot be read is "unknown", never None.
"""

from __future__ import annotations

import ast
import inspect
import os
import subprocess
import textwrap
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from config import APP_NAME
from version import VERSION

#: The ComFy code in vendored/comfy (vendored/comfy/PROVENANCE.md).
COMFY = {
    "name": "ComFy",
    "repository": "https://github.com/Pati-nets/ComFy",
    "commit": "1dd6ea610017cbca65bb54735ac6db922af00e8d",
}

#: The thresholds and feature groups in vendored/comfy_log (vendored/comfy_log/PROVENANCE.md).
COMFY_LOG = {
    "name": "ComFy for log measures",
    "repository": "https://github.com/Pati-nets/ComFy-for-Log-Measures",
    "commit": "70837cec7f3aff9580f52e78162b433e9e21f473",
}

#: The ProM bundle the prom4py image downloads (src/prom4py/Dockerfile). It has no version of
#: its own; the Zenodo record is what identifies it.
PROM4PY = {
    "name": "ProM4Py",
    "bundle": "https://zenodo.org/records/13853660",
}

#: The feeed repository at the commit of release 2.2.0, which computes the log measures; the sources of
#: the measures in the catalog point into it.
FEEED = {
    "name": "feeed",
    "repository": "https://github.com/andreamalhera/feeed",
    "commit": "b28fb49",
}

FEEED_NOTE = (
    "feeed 2.2.0 (commit b28fb49) changed five features: simple_trace_diversity, "
    "distinct_activities_mean, distinct_activities_std, event_density and complexity_factor. "
    "Values of these five computed with an earlier feeed, such as the bundled log dataset, "
    "differ from those of later versions."
)

_REPO = Path(__file__).resolve().parent.parent.parent


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(_REPO), *args], capture_output=True, text=True, timeout=5, check=True
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None


@lru_cache(maxsize=1)
def tool() -> dict[str, Any]:
    """Name, version and commit of this tool."""
    commit = os.environ.get("APP_COMMIT", "").strip() or _git("rev-parse", "HEAD") or "unknown"
    tag = os.environ.get("APP_VERSION", "").strip() or _git("describe", "--tags", "--dirty") or VERSION
    return {"name": APP_NAME, "version": tag, "commit": commit}


def package_version(name: str) -> str | None:
    """Installed version of the distribution ``name``, or ``None`` when it is not installed."""
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def _literal(node: ast.expr) -> Any:
    try:
        return ast.literal_eval(node)
    except ValueError:
        return ast.unparse(node)


@lru_cache(maxsize=None)
def miner_call(miner_name: str) -> dict[str, Any]:
    """The ProM4Py call a ComFy miner makes and the parameters it passes, read from its
    ``discover_for``, so the record follows the vendored code."""
    from algorithms.comfy import MINERS_BY_NAME

    miner = MINERS_BY_NAME[miner_name]
    try:
        tree = ast.parse(textwrap.dedent(inspect.getsource(type(miner).discover_for)))
    except (OSError, TypeError, SyntaxError):
        return {"name": miner_name, "prom4py_call": None, "parameters": {}}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr.startswith("mine_"):
            return {
                "name": miner_name,
                "prom4py_call": node.func.attr,
                "parameters": {k.arg: _literal(k.value) for k in node.keywords if k.arg},
            }
    return {"name": miner_name, "prom4py_call": None, "parameters": {}}


def dataset(
    kind: str,
    source: str,
    *,
    inputs: list[str] | None = None,
    miners: list[str] | None = None,
    bundled: dict[str, Any] | None = None,
    filename: str | None = None,
) -> dict[str, Any]:
    """How a dataset was made, recorded when it is created.

    ``inputs`` are the names of the uploaded or sample files; each of them went through every
    miner in ``miners`` with the parameters listed there.
    """
    out: dict[str, Any] = {"kind": kind, "source": source}
    if source == "bundled" and bundled:
        # datasets/PROVENANCE.md says where in the repository each file lies.
        out["bundled"] = {
            "id": bundled["id"],
            "file": f"datasets/{bundled['file']}",
            "copied_from": {"repository": bundled.get("source_url"), "commit": bundled.get("source_commit")},
        }
        if kind == "log":
            out["features"] = {"name": "feeed", "version": None, "note": FEEED_NOTE}
        return out
    if source == "csv":
        out["file"] = filename
        return out

    out["inputs"] = list(inputs or [])
    # pm4py reads the logs and the PNML files.
    out["libraries"] = {"pm4py": package_version("pm4py")}
    if kind == "log":
        out["features"] = {"name": "feeed", "version": package_version("feeed"), "note": FEEED_NOTE}
        return out
    out["measures"] = dict(COMFY)
    if source == "logs":
        out["discovery"] = {**PROM4PY, "miners": [miner_call(m) for m in miners or []]}
    return out


def analysis(result: dict[str, Any]) -> dict[str, Any]:
    """How the analysis turns the matrix into factors, beyond its parameters; ``result`` is
    the analysis as ``core.analyze`` returns it."""
    counts = result.get("factor_count") or {}
    return {
        "method": "minres",
        "library": "factor_analyzer",
        # factor_analysis/core.py follows the factor analysis of both, with their thresholds.
        "follows": [dict(COMFY), dict(COMFY_LOG)],
        "assignment_rule": result.get("assignment_rule", "largest"),
        # The rule with the thresholds it applied, e.g. the communality "multi" asks for.
        "assignment": result.get("assignment"),
        # Parallel analysis is the only step that draws random numbers.
        "seed": counts.get("seed"),
        # The criteria for the number of factors and the one used; the random eigenvalues
        # are in eigenvalues.csv.
        "factor_count": {
            "used": result.get("n_factors"),
            **{k: v for k, v in counts.items() if k != "eigenvalues_random"},
        },
    }
