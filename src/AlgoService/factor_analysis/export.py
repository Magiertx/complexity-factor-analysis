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

from .core import CROSS_LOADING_GAP

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


#: How each rule of core.ASSIGNMENT_RULES assigns measures, for the notes of the exports.
ASSIGNMENT_RULE_TEXTS = {
    "largest": "each measure on the factor of its largest absolute loading (ComFy)",
    "multi": (
        f"each measure on every factor whose absolute loading exceeds the threshold and lies at most "
        f"{CROSS_LOADING_GAP} below its largest (Important Factors, after Lieben et al.)"
    ),
    "hair": (
        f"each measure on the factor of its largest absolute loading; measures with another loading "
        f"at most {CROSS_LOADING_GAP} below it are left out (Important Factors, Tab. 17, after Hair et al.)"
    ),
}


def _assignment(result: dict[str, Any]) -> dict[str, Any]:
    """The assignment block of a result; results stored before it existed used "largest"."""
    return result.get("assignment") or {
        "rule": "largest",
        "loading_threshold": result["loading_threshold"],
        "loading_strict": False,
        "communality_threshold": result.get("communality_threshold", 0.0),
    }


#: Rules that put a measure on factors other than that of its largest loading, or on none
#: although a loading counts. Under them the bold cells are those the rule assigned, as the
#: dimension tables of Important Factors mark them; under "largest" every loading that counts
#: is bold, as ComFy's report leaves only those black.
_BOLD_BY_ASSIGNMENT = {"multi", "hair"}

_UNASSIGNED_REASONS = {
    "low_communality": "low communality",
    "low_loading": "no loading counts",
    "cross_loading": "cross-loading",
}


def loadings_latex(result: dict[str, Any]) -> str:
    """A booktabs ``tabular``. Under the rule "largest", loadings whose absolute value reaches
    the loading threshold are bold, unless the communality of the measure is below the
    communality threshold. Under "multi" and "hair" the loadings by which the rule put a measure
    on a factor are bold, and a comment names the measures it left out."""
    decimals = _C.number_of_decimals
    names = _factor_names(result)
    assignment = _assignment(result)
    threshold = assignment["loading_threshold"]
    strict = assignment["loading_strict"]
    min_communality = assignment["communality_threshold"]
    matrix = "pattern loadings" if result.get("structure_loadings") else "loadings"
    by_assignment = assignment["rule"] in _BOLD_BY_ASSIGNMENT
    assigned = {(m["measure"], f["index"]) for f in result.get("factors", []) for m in f["measures"]}

    def cell(value: float, bold: bool = False) -> str:
        number = f"{value:.{decimals}f}"
        return f"$\\mathbf{{{number}}}$" if bold else f"${number}$"

    def counts(value: float) -> bool:
        return abs(value) > threshold if strict else abs(value) >= threshold

    criterion = f"|loading| {'>' if strict else '>='} {threshold}" + (
        f" and communality >= {min_communality}" if min_communality else ""
    )
    if by_assignment:
        bold = f"bold: the loadings by which the rule puts a measure on a factor ({criterion})."
    else:
        bold = f"bold: {criterion}."
    lines = [
        "% Requires \\usepackage{booktabs}.",
        f"% {result['rotation']} rotation, {matrix}, {result['n_factors']} factor(s), "
        f"{result['n_observations']} observations; {bold}",
        f"% Assignment rule {assignment['rule']}: {ASSIGNMENT_RULE_TEXTS[assignment['rule']]}.",
    ]
    left_out = [u for u in result.get("unassigned_details", []) if u["measure"] in result["loadings"]]
    if by_assignment and left_out:
        lines.append(
            "% In no factor: "
            # One line: a line break in a measure name of an upload would end the comment.
            + "; ".join(f"{' '.join(u['measure'].split())} ({_UNASSIGNED_REASONS.get(u['reason'], u['reason'])})" for u in left_out)
            + "."
        )
    lines += [
        "\\begin{tabular}{l" + "r" * len(names) + "r}",
        "\\toprule",
        "Measure & " + " & ".join(names) + " & Communality \\\\",
        "\\midrule",
    ]
    for measure, row in result["loadings"].items():
        communality = result["communalities"][measure]
        if by_assignment:
            cells = [cell(v, (measure, j) in assigned) for j, v in enumerate(row)]
        else:
            cells = [cell(v, counts(v) and communality >= min_communality) for v in row]
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
    """The eigenvalues of the correlation matrix behind the scree plot, largest first, and
    those of random data that parallel analysis compares them with."""
    random = (result.get("factor_count") or {}).get("eigenvalues_random")
    if random is None:
        lines = [_csv_line(["factor", "eigenvalue"])]
        for i, value in enumerate(result["eigenvalues"]):
            lines.append(_csv_line([i + 1, value]))
        return "".join(lines)
    lines = [_csv_line(["factor", "eigenvalue", "parallel_analysis"])]
    for i, (value, reference) in enumerate(zip(result["eigenvalues"], random)):
        lines.append(_csv_line([i + 1, value, reference]))
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


def descriptives_csv(descriptives: dict[str, Any]) -> str:
    """One row per measure: the number of values, mean, median, standard deviation (ddof=1),
    minimum and maximum, and why cleaning dropped it, if it did."""
    from .descriptives import STATISTICS

    lines = [_csv_line(["measure", "n", *STATISTICS, "dropped"])]
    for row in descriptives["measures"]:
        lines.append(_csv_line([row["measure"], row["n"], *(row[s] for s in STATISTICS), row.get("dropped") or ""]))
    return "".join(lines)


#: One row per observation of a computed dataset: its input's size and the seconds of each stage.
MEASUREMENT_COLUMNS = (
    "observation", "input", "miner", "events", "traces", "variants", "activities", "places", "transitions",
    "arcs", "read_s", "discovery_s", "discovery_run_s", "measures_s", "features_s", "error",
)


def measurement_rows(measurement: dict[str, Any]) -> list[list[Any]]:
    """The rows of ``MEASUREMENT_COLUMNS``. A log is read once for all its miners, so each of
    its rows has the same read_s; an input that could not be read has a row of its own."""
    inputs = {i["input"]: i for i in measurement["inputs"]}
    rows = []
    seen = set()
    for observation in measurement["observations"]:
        source = inputs.get(observation["input"], {})
        seen.add(observation["input"])
        net = observation.get("net") or source.get("net") or {}
        merged = {**source, **net, **observation}
        merged["error"] = observation.get("error") or source.get("error")
        rows.append([merged.get(c) for c in MEASUREMENT_COLUMNS])
    for name, source in inputs.items():
        if name not in seen:
            rows.append([{"observation": name, **source}.get(c) for c in MEASUREMENT_COLUMNS])
    return rows


def measurement_csv(measurement: dict[str, Any]) -> str:
    return "".join(_csv_line(row) for row in [list(MEASUREMENT_COLUMNS), *measurement_rows(measurement)])


def stages_csv(measurement: dict[str, Any]) -> str:
    """One row per observation and stage: each measure (model) or feature group (log) with its
    seconds."""
    lines = [_csv_line(["observation", "stage", "seconds"])]
    for observation in measurement["observations"]:
        for stage, seconds in (observation.get("stages") or {}).items():
            lines.append(_csv_line([observation["observation"], stage, seconds]))
    return "".join(lines)


#: Versions recorded in the manifest; factor_analyzer runs on scikit-learn's check_array.
LIBRARIES = ("factor_analyzer", "numpy", "pandas", "scipy", "scikit-learn")


def library_versions() -> dict[str, str | None]:
    return {name: provenance.package_version(name) for name in LIBRARIES}


_TABS = {"model": "Model complexity", "log": "Log complexity"}


def assignment_csv(result: dict[str, Any]) -> str:
    """One row per used measure: the factors the assignment rule put it on (counted from 1,
    as in the loadings table), why it is on none, and the factors of its cross-loading,
    largest absolute loading first."""
    assigned: dict[str, list[int]] = {}
    for factor in result["factors"]:
        for entry in factor["measures"]:
            assigned.setdefault(entry["measure"], []).append(factor["index"] + 1)
    reasons = {u["measure"]: u["reason"] for u in result.get("unassigned_details", [])}
    cross = {c["measure"]: c["factors"] for c in result.get("cross_loadings", [])}
    lines = [_csv_line(["measure", "factors", "reason", "cross_loading"])]
    for measure in result["used_measures"]:
        lines.append(_csv_line([
            measure,
            " ".join(map(str, sorted(assigned.get(measure, [])))),
            reasons.get(measure, ""),
            " ".join(str(i + 1) for i in cross.get(measure, [])),
        ]))
    return "".join(lines)


def _provenance_lines(dataset: dict[str, Any], result: dict[str, Any], tool: dict[str, Any]) -> list[str]:
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
    analysis = provenance.analysis(result)
    rule = analysis["assignment_rule"]
    lines.append(
        f"  Analysis: {analysis['method']} ({analysis['library']}), assignment rule {rule}: "
        f"{ASSIGNMENT_RULE_TEXTS[rule]}."
    )
    match = result.get("published_match")
    if match:
        found = "they match" if match["status"] == "match" else f"{len(match['differences'])} differ"
        lines.append(
            f"  Published settings: compared with {match['source']} ({', '.join(match['compared'])}, "
            f"tolerance {match['tolerance']}): {found}."
        )
    counts = analysis["factor_count"]
    if "parallel_analysis" in counts:
        lines.append(
            f"  Factors: {counts['used']} used; the Kaiser criterion suggests {counts['kaiser']}, "
            f"parallel analysis {counts['parallel_analysis']} ({counts['method']}-based, "
            f"{counts['simulations']} simulations, {counts['percentile']}th percentile, seed {counts['seed']})."
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
        *_provenance_lines(dataset, result, tool),
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
    published: dict[str, Any] | None = None,
    descriptives: dict[str, Any] | None = None,
    measurement: dict[str, Any] | None = None,
    figures: dict[str, bytes] | None = None,
    short_codes: bool = False,
) -> bytes:
    """Everything needed to report and reproduce one analysis.

    ``dataset`` describes the dataset for the manifest, ``params`` are the parameters the
    analysis ran with, ``matrix`` is ``matrix_csv`` of its data and ``interpretation`` a
    stored interpretation with its language. ``published`` holds the published options of a
    bundled dataset, their source and the comparison with the published numbers, if the
    analysis ran with these options. ``descriptives`` are the statistics kept with the dataset,
    ``measurement`` the run times and input sizes of a computed one, ``figures`` the figures by
    their path in the archive, e.g. "figures/scree.svg". ``short_codes`` names the measures in
    the report by the codes of the papers, as the figures do.
    """
    from .report import report_tex

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tool = provenance.tool()
    libraries = library_versions()
    factor_names = None
    if interpretation is not None:
        factor_names = {
            f["index"] - 1: f["name"] for f in (interpretation[1].get("interpretation") or {}).get("factors", [])
        }
    files: list[tuple[str, str | bytes, str]] = [
        ("analysis.json", json.dumps(result, ensure_ascii=False, indent=2),
         "The full result, as POST /factor-analysis/datasets/{id}/analyze returns it."),
        ("dataset.csv", matrix, "The cleaned matrix the analysis ran on, one row per observation."),
        ("loadings.csv", loadings_csv(result),
         "Loadings per measure and factor with the communality"
         + ("; the pattern matrix." if result["structure_loadings"] is not None else ".")),
        ("loadings.tex", loadings_latex(result), "The loadings as a booktabs tabular for LaTeX."),
        ("assignment.csv", assignment_csv(result),
         f"The factors each measure is assigned to by the rule {result.get('assignment_rule', 'largest')}, "
         "or why it is on none, and its cross-loadings."),
    ]
    if result["structure_loadings"] is not None:
        files += [
            ("structure.csv", structure_csv(result),
             "Structure matrix: correlations of measures and factors."),
            ("factor-correlations.csv", factor_correlations_csv(result), "Correlations among the factors."),
        ]
    files += [
        ("eigenvalues.csv", eigenvalues_csv(result),
         "Eigenvalues of the correlation matrix (scree plot) and of random data (parallel analysis)."),
        ("msa.csv", msa_csv(result, dataset["measures"], params["excluded"]),
         "MSA per measure and whether it was used, removed by the MSA filter or excluded."),
        ("report.tex", report_tex(
            dataset=dataset, params=params, result=result, descriptives=descriptives, tool=tool,
            libraries=libraries, created_at=created_at, short=short_codes, factor_names=factor_names,
            published=published,
        ), "The analysis as a LaTeX report built like ComFy's report; compile it with latexmk -pdf, or run pdflatex twice."),
    ]
    if descriptives is not None:
        files.append((
            "descriptives.csv", descriptives_csv(descriptives),
            "Mean, median, standard deviation (ddof=1), minimum and maximum of every measure, as ComFy's report "
            + ("prints them, over the data before cleaning." if descriptives.get("basis") == "input"
               else "prints them; over the cleaned matrix, as the data before cleaning were not kept."),
        ))
    if measurement is not None:
        files += [
            ("inputs.csv", measurement_csv(measurement),
             "Per observation: the size of its input and the seconds of reading, discovery and the measures."),
            ("stages.csv", stages_csv(measurement), "Seconds of each measure or feature group per observation."),
        ]
    for name, content in (figures or {}).items():
        what = "scree plot" if "scree" in name else "loadings heatmap"
        files.append((name, content, f"The {what} in print style, as the figure menu in the app downloads it."))
    if interpretation is not None:
        language, entry = interpretation
        files.append((
            f"interpretation.{language}.json", json.dumps(entry, ensure_ascii=False, indent=2),
            "The stored interpretation of the factors, with the model and parameters it was made for.",
        ))

    listing = [
        {"name": "manifest.json", "description": "What was analysed, with which parameters, code and libraries."},
        {"name": "README.txt", "description": "This overview and how to reproduce the analysis."},
        *({"name": name, "description": description} for name, _, description in files),
    ]
    manifest = {
        "app": APP_NAME,
        "created_at": created_at,
        "tool": tool,
        "dataset": dataset,
        "analysis_params": params,
        "analysis": provenance.analysis(result),
        # Wall times of this analysis; a cached fit keeps the time its computation took.
        "analysis_timings": result.get("timings"),
        "measure_labels": "short_codes" if short_codes else "names",
        "libraries": libraries,
        "files": listing,
    }
    if measurement is not None:
        manifest["measurement"] = measurement
    if published is not None:
        manifest["published"] = published
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr("README.txt", _readme(dataset, params, result, listing, created_at, tool))
        for name, content, _ in files:
            archive.writestr(name, content)
    return buffer.getvalue()
