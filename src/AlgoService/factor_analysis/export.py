"""Loadings table as CSV or LaTeX, and a whole analysis as a ZIP archive."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any

import pandas as pd

import provenance
from config import APP_NAME
from vendored.comfy_log import Constants as _C
from zip_export import csv_cell

_LATEX_SPECIAL = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def latex_escape(text: str) -> str:
    return "".join(_LATEX_SPECIAL.get(ch, ch) for ch in text)


def _factor_names(result: dict[str, Any]) -> list[str]:
    return [f"Factor {i + 1}" for i in range(result["n_factors"])]


def _csv_line(cells: list[Any]) -> str:
    return ",".join(csv_cell(c) for c in cells) + "\n"


def loadings_csv(result: dict[str, Any]) -> str:
    """One row per measure: the loading on each factor, then the communality. For oblique
    rotations the loadings are the pattern matrix."""
    lines = [_csv_line(["measure", *_factor_names(result), "communality"])]
    for measure, row in result["loadings"].items():
        lines.append(_csv_line([measure, *row, result["communalities"][measure]]))
    return "".join(lines)


def matrix_csv(data: pd.DataFrame) -> str:
    """A dataset matrix, observations as rows."""
    lines = [_csv_line(["observation", *data.columns])]
    for label, row in zip(data.index, data.to_numpy()):
        lines.append(_csv_line([label, *(repr(float(v)) for v in row)]))
    return "".join(lines)


def loadings_latex(result: dict[str, Any]) -> str:
    """A booktabs ``tabular``; loadings whose absolute value reaches the loading threshold are
    bold, unless the communality of the measure is below the communality threshold."""
    decimals = _C.number_of_decimals
    names = _factor_names(result)
    threshold = result["loading_threshold"]
    min_communality = result.get("communality_threshold", 0.0)
    matrix = "pattern loadings" if result.get("structure_loadings") else "loadings"

    def cell(value: float, bold: bool = False) -> str:
        number = f"{value:.{decimals}f}"
        return f"$\\mathbf{{{number}}}$" if bold else f"${number}$"

    lines = [
        "% Requires \\usepackage{booktabs}.",
        f"% {result['rotation']} rotation, {matrix}, {result['n_factors']} factor(s), "
        f"{result['n_observations']} observations; bold: |loading| >= {threshold}"
        + (f" and communality >= {min_communality}." if min_communality else "."),
        "\\begin{tabular}{l" + "r" * len(names) + "r}",
        "\\toprule",
        "Measure & " + " & ".join(names) + " & Communality \\\\",
        "\\midrule",
    ]
    for measure, row in result["loadings"].items():
        communality = result["communalities"][measure]
        cells = [cell(v, abs(v) >= threshold and communality >= min_communality) for v in row]
        cells.append(cell(communality))
        lines.append(latex_escape(measure) + " & " + " & ".join(cells) + " \\\\")
    lines += ["\\bottomrule", "\\end{tabular}", ""]
    return "\n".join(lines)


def structure_csv(result: dict[str, Any]) -> str:
    """Oblique rotations: the correlation of each measure with each factor."""
    lines = [_csv_line(["measure", *_factor_names(result)])]
    for measure, row in result["structure_loadings"].items():
        lines.append(_csv_line([measure, *row]))
    return "".join(lines)


def factor_correlations_csv(result: dict[str, Any]) -> str:
    """Oblique rotations: the correlations among the factors."""
    names = _factor_names(result)
    lines = [_csv_line(["factor", *names])]
    for name, row in zip(names, result["factor_correlations"]):
        lines.append(_csv_line([name, *row]))
    return "".join(lines)


def eigenvalues_csv(result: dict[str, Any]) -> str:
    """The eigenvalues of the correlation matrix behind the scree plot, largest first."""
    lines = [_csv_line(["factor", "eigenvalue"])]
    for i, value in enumerate(result["eigenvalues"]):
        lines.append(_csv_line([i + 1, value]))
    return "".join(lines)


def msa_csv(result: dict[str, Any], measures: list[str], excluded: list[str]) -> str:
    """The MSA of each measure of the dataset and what became of it. A removed measure has the
    MSA of the step that removed it; an excluded one has none."""
    removed = {r["measure"]: r for r in result["msa_filter"]["removed"]}
    lines = [_csv_line(["measure", "msa", "status"])]
    for measure in measures:
        if measure in excluded:
            row = [measure, None, "excluded"]
        elif measure in removed:
            row = [measure, removed[measure]["msa"], f"removed in step {removed[measure]['step']}"]
        else:
            row = [measure, result["kmo"]["per_measure"][measure], "used"]
        lines.append(_csv_line(row))
    return "".join(lines)


#: Versions recorded in the manifest; factor_analyzer runs on scikit-learn's check_array.
LIBRARIES = ("factor_analyzer", "numpy", "pandas", "scipy", "scikit-learn")


def _library_versions() -> dict[str, str | None]:
    return {name: provenance.package_version(name) for name in LIBRARIES}


_TABS = {"model": "Model complexity", "log": "Log complexity"}


def _provenance_lines(dataset: dict[str, Any], tool: dict[str, Any]) -> list[str]:
    """The provenance of manifest.json in a few lines."""
    origin = dataset.get("provenance") or {}
    unknown = "not recorded"
    lines = [
        "Provenance (details in manifest.json)",
        f"  {APP_NAME} {tool.get('version') or unknown}, commit {tool.get('commit') or unknown}.",
    ]
    bundled = origin.get("bundled")
    if bundled:
        source = bundled["copied_from"]
        lines.append(
            f"  Data: the bundled dataset {bundled['id']}, copied from {source['repository']}, "
            f"commit {source['commit']}."
        )
    elif origin.get("source") == "csv":
        lines.append("  Data: an uploaded CSV file; how its values were computed is not known to the tool.")
    measures = origin.get("measures")
    if measures:
        lines.append(f"  Measures: {measures['name']}, {measures['repository']}, commit {measures['commit']}.")
    discovery = origin.get("discovery")
    if discovery:
        lines.append(f"  Discovery: {discovery['name']} ({discovery['bundle']}), on every input:")
        for miner in discovery["miners"]:
            parameters = ", ".join(f"{k}={v}" for k, v in miner["parameters"].items()) or "defaults"
            lines.append(f"    {miner['name']}: {miner['prom4py_call']}, {parameters}")
    features = origin.get("features")
    if features:
        lines.append(f"  Features: feeed {features.get('version') or '(an earlier version)'}. {features['note']}")
    libraries = origin.get("libraries") or {}
    if libraries.get("pm4py"):
        lines.append(f"  Inputs read with pm4py {libraries['pm4py']}.")
    analysis = provenance.analysis()
    lines.append(
        f"  Analysis: {analysis['method']} ({analysis['library']}), measures assigned to the factor "
        f"of their largest absolute loading ({analysis['assignment_rule']}), no random seed."
    )
    return lines


def _readme(
    dataset: dict[str, Any],
    params: dict[str, Any],
    result: dict[str, Any],
    files: list[dict[str, str]],
    created_at: str,
    tool: dict[str, Any],
) -> str:
    width = max(len(f["name"]) for f in files) + 2
    rotation = None if result["rotation"] == "none" else result["rotation"]
    lines = [
        f'Factor analysis of "{dataset["name"]}", exported from {APP_NAME} on {created_at}.',
        "",
        "Files",
        *(f"  {f['name']:<{width}}{f['description']}" for f in files),
        "",
        "Reproduce",
        f'  In {APP_NAME}: on the "{_TABS[dataset["kind"]]}" tab, choose the source "CSV file" and',
        "  upload dataset.csv, then set the parameters of analysis_params in manifest.json. The",
        "  matrix is already cleaned, so the analysis runs on the same values.",
        "",
        "  In Python with factor_analyzer (minres, its default method), on the measures msa.csv",
        "  marks as used:",
        "",
        "    import factor_analyzer.factor_analyzer as fa_module",
        "    import pandas as pd",
        "    from factor_analyzer import FactorAnalyzer",
        "    from sklearn.utils import check_array",
        "",
        "    # factor_analyzer 0.5.1 passes force_all_finite, which scikit-learn 1.8 removed;",
        "    # leave this out for a scikit-learn before 1.6.",
        "    fa_module.check_array = lambda x, force_all_finite=True, **kw: check_array(",
        "        x, ensure_all_finite=force_all_finite, **kw)",
        "",
        '    data = pd.read_csv("dataset.csv", index_col=0)',
        '    msa = pd.read_csv("msa.csv")',
        '    data = data[msa.loc[msa["status"] == "used", "measure"]]',
        "    # Pass an array: factor_analyzer copies a DataFrame in another memory order,",
        "    # which moves the minres optimum by about 1e-8.",
        f"    fa = FactorAnalyzer(n_factors={params['n_factors']}, rotation={rotation!r}).fit(data.to_numpy())",
        "    print(fa.loadings_)",
        "",
        "  manifest.json lists the library versions the analysis ran with; with the same versions",
        "  on the same platform the loadings are equal to those in analysis.json.",
        "",
        *_provenance_lines(dataset, tool),
    ]
    if result["structure_loadings"] is not None:
        lines += [
            "  The communalities of an oblique rotation are the row sums of fa.loadings_ * fa.structure_;",
            "  factor_analyzer's get_communalities() sums the squared pattern loadings instead.",
        ]
    return "\n".join(lines) + "\n"


def analysis_zip(
    *,
    dataset: dict[str, Any],
    params: dict[str, Any],
    result: dict[str, Any],
    matrix: str,
    interpretation: tuple[str, dict[str, Any]] | None = None,
) -> bytes:
    """Everything needed to report and reproduce one analysis.

    ``dataset`` describes the dataset for the manifest, ``params`` are the parameters the
    analysis ran with, ``matrix`` is ``matrix_csv`` of its data and ``interpretation`` a
    stored interpretation with its language.
    """
    files = [
        ("analysis.json", json.dumps(result, ensure_ascii=False, indent=2),
         "The full result, as POST /factor-analysis/datasets/{id}/analyze returns it."),
        ("dataset.csv", matrix, "The cleaned matrix the analysis ran on, one row per observation."),
        ("loadings.csv", loadings_csv(result),
         "Loadings per measure and factor with the communality"
         + ("; the pattern matrix." if result["structure_loadings"] is not None else ".")),
        ("loadings.tex", loadings_latex(result), "The loadings as a booktabs tabular for LaTeX."),
    ]
    if result["structure_loadings"] is not None:
        files += [
            ("structure.csv", structure_csv(result),
             "Structure matrix: correlations of measures and factors."),
            ("factor-correlations.csv", factor_correlations_csv(result), "Correlations among the factors."),
        ]
    files += [
        ("eigenvalues.csv", eigenvalues_csv(result), "Eigenvalues of the correlation matrix (scree plot)."),
        ("msa.csv", msa_csv(result, dataset["measures"], params["excluded"]),
         "MSA per measure and whether it was used, removed by the MSA filter or excluded."),
    ]
    if interpretation is not None:
        language, entry = interpretation
        files.append((
            f"interpretation.{language}.json", json.dumps(entry, ensure_ascii=False, indent=2),
            "The stored interpretation of the factors, with the model and parameters it was made for.",
        ))

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    listing = [
        {"name": "manifest.json", "description": "What was analysed, with which parameters, code and libraries."},
        {"name": "README.txt", "description": "This overview and how to reproduce the analysis."},
        *({"name": name, "description": description} for name, _, description in files),
    ]
    tool = provenance.tool()
    manifest = {
        "app": APP_NAME,
        "created_at": created_at,
        "tool": tool,
        "dataset": dataset,
        "analysis_params": params,
        "analysis": provenance.analysis(),
        "libraries": _library_versions(),
        "files": listing,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr("README.txt", _readme(dataset, params, result, listing, created_at, tool))
        for name, content, _ in files:
            archive.writestr(name, content)
    return buffer.getvalue()
