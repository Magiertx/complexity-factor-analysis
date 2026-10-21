"""The analysis as a LaTeX report, built like the report of ComFy.

ComFy's ``LatexExporter`` (https://github.com/Pati-nets/ComFy, ``LatexExporter.py``) writes
``report-<miner>.tex`` with these sections, which the report keeps in its order and style: the
miners and measures chosen, the validity of the analysis (sample size, Bartlett's test, the MSA
of each measure and the measures the MSA filter removed), the scree plot and the factor count,
the descriptive statistics, the loadings (those that do not count in light grey) and the
communalities. The report adds what the tool knows beyond ComFy: the rounds of the MSA filter,
parallel analysis, the assignment rule (the loadings it assigned in bold), the dimensions it
forms, the factor correlations of an oblique rotation, and the settings and provenance.

Numbers are printed to the decimals of ComFy's report: four for the analysis, six for the
descriptive statistics, so that the report of a bundled dataset under the paper settings shows
the published numbers (tests/test_report.py). The report compiles with pdflatex; it needs
booktabs, longtable, needspace, paralist, pgfplots and amsmath, which TeX Live and MiKTeX include.
Long tables settle their column widths in a second run, so it is compiled with latexmk or
twice (``COMPILE_HINT``).
"""

from __future__ import annotations

import re
from typing import Any

from config import APP_NAME

from . import catalog as cat
from .core import CROSS_LOADING_GAP
from .descriptives import STATISTICS
from .export import ASSIGNMENT_RULE_TEXTS, latex_escape
from .short_codes import short_code

#: Decimals of the analysis and of the descriptive statistics, as in ComFy's report.
DECIMALS = 4
DESCRIPTIVE_DECIMALS = 6

#: Tables with more rows than this break across pages (longtable).
LONG_TABLE = 40
#: A bar chart of the communalities is drawn up to this many measures; beyond, the column h²
#: of the loadings table has them.
MAX_BARS = 40
#: The scree plot shows this many eigenvalues at least, as the UI does, or twice the factors.
MIN_SCREE = 20
#: Factors per loadings table; more are split over several tables, which fit the page.
FACTORS_PER_TABLE = 6
FACTORS_PER_TABLE_SHORT = 7
#: Names longer than this wrap in a column of their own width, e.g. long feeed names.
LONG_NAME = 36

#: The first line of every report, and of the places that point to it.
COMPILE_HINT = (
    "Compile with latexmk -pdf, or run pdflatex twice: long tables settle their column widths in the second run."
)

#: Kept together with what follows, so that a heading and its introduction never end a page
#: with the table on the next one.
_KEEP = "\\needspace{12\\baselineskip}"

#: A paragraph column set ragged right, so that a long URL does not stretch its line.
_RAGGED = ">{\\raggedright\\arraybackslash}"

_REASONS = {
    "non_numeric": "non-numeric values",
    "missing": "missing values",
    "constant": "no variance",
    "duplicate": "perfectly correlated with another measure",
}
_UNASSIGNED = {
    "low_communality": "low communality",
    "low_loading": "no loading counts",
    "cross_loading": "cross-loading",
}


def tex(text: Any) -> str:
    """Text for LaTeX: special characters escaped, and characters beyond the Latin alphabets of
    pdflatex's default fonts replaced, so that any measure name of an upload compiles. Straight
    double quotes become quotation marks: ``x'' for "x"."""
    safe = "".join(ch if ord(ch) < 0x180 else "?" for ch in str(text))
    # A line break in a name of an upload would end a table row. A long feeed name may break
    # after its underscores.
    escaped = latex_escape(" ".join(safe.split())).replace("\\_", "\\_\\allowbreak{}")
    return _CLOSING_QUOTE.sub("''", _OPENING_QUOTE.sub("``", escaped))


_OPENING_QUOTE = re.compile(r'(?:^|(?<=[\s(\[{]))"')
_CLOSING_QUOTE = re.compile(r'"')


def number(value: float | None, decimals: int = DECIMALS) -> str:
    if value is None:
        return "--"
    text = f"{value:.{decimals}f}"
    # No "-0.0000" for a value that rounds to zero.
    return text[1:] if text.startswith("-") and float(text) == 0 else text


def p_value(value: float | None) -> str:
    if value is None:
        return "--"
    if value == 0:
        return "0"
    if value < 10 ** -DECIMALS:
        mantissa, exponent = f"{value:.2e}".split("e")
        return f"{mantissa} \\cdot 10^{{{int(exponent)}}}"
    return number(value)


class _Labels:
    """How the report names a measure: its name, or its short code with the name in the list
    of measures. Log measures are written as the paper writes them, C with the code as index."""

    def __init__(self, kind: str, short: bool) -> None:
        self.kind = kind
        self.short = short

    def code(self, measure: str) -> str | None:
        return short_code(self.kind, measure) if self.short else None

    def __call__(self, measure: str) -> str:
        code = self.code(measure)
        if code is None:
            return tex(measure)
        return f"$C_{{\\text{{{tex(code)}}}}}$" if self.kind == "log" else tex(code)

    def column(self, measures: list[str]) -> str:
        """The column type of the measures of a table: as wide as the names, or a column of
        fixed width that wraps them when one is long."""
        longest = max((len(self.code(m) or m) for m in measures), default=0)
        return f"{_RAGGED}p{{4.6cm}}" if longest > LONG_NAME else "l"

    def listed(self, measure: str) -> str:
        """In the list of the measures: the code with the name it stands for."""
        code = self.code(measure)
        return f"{self(measure)} ({tex(measure)})" if code else tex(measure)


#: A factor name longer than this wraps in its column of the loadings table.
SHORT_FACTOR_NAME = 12


def _factor_heading(j: int, names: dict[int, str] | None) -> str:
    """The heading of factor ``j`` (from 0) in a table: its name, else "Factor j"."""
    name = (names or {}).get(j)
    if not name:
        return f"Factor {j + 1}"
    if len(name) <= SHORT_FACTOR_NAME:
        return tex(name)
    return f"\\parbox[b]{{2cm}}{{\\centering {tex(name)}}}"


def _items(lines: list[str], env: str = "compactitem") -> list[str]:
    return [f"\\begin{{{env}}}", *(f"\\item {line}" for line in lines), f"\\end{{{env}}}", ""]


def _table(
    spec: str, header: str, rows: list[str], footer: list[str] | None = None, *, breaks: bool = False
) -> list[str]:
    """A booktabs table, centred like ComFy's, or a longtable that breaks across pages: with
    many rows, or with ``breaks`` for rows that may be long themselves."""
    if breaks or len(rows) > LONG_TABLE:
        out = [
            f"\\begin{{longtable}}{{{spec}}}",
            "\\toprule",
            header,
            "\\midrule",
            "\\endhead",
            "\\bottomrule",
            "\\endfoot",
            *rows,
        ]
        if footer:
            out += ["\\midrule", *footer]
        return [*out, "\\end{longtable}", ""]
    out = ["\\begin{center}", f"\\begin{{tabular}}{{{spec}}}", "\\toprule", header, "\\midrule", *rows]
    if footer:
        out += ["\\midrule", *footer]
    return [*out, "\\bottomrule", "\\end{tabular}", "\\end{center}", ""]


def _measures(dataset: dict[str, Any], descriptives: dict[str, Any] | None) -> list[str]:
    """The measures of the dataset as it was made, before cleaning, in their order."""
    if descriptives and descriptives.get("basis") == "input":
        names = [d["measure"] for d in descriptives["measures"]]
    else:
        names = list(dataset["measures"])
    for dropped in dataset.get("dropped", []):
        if dropped["name"] not in names:
            names.append(dropped["name"])
    return names


def _miners(dataset: dict[str, Any]) -> list[str]:
    miners = (dataset.get("inputs") or {}).get("miners")
    if miners:
        return list(miners)
    entry = cat.bundled_entry(dataset.get("bundled_id") or "") or {}
    if dataset["kind"] == "model" and entry.get("collection") == "comfy-paper" and entry.get("label"):
        return [entry["label"]]
    return []


def _miner_lines(miner: dict[str, Any], dataset: dict[str, Any], label: _Labels) -> list[str]:
    """What an analysis of the rows of one miner says about them."""
    out = [
        f"Only the nets of the {tex(miner['name'])} were analysed: ${miner['n_observations']}$ of the "
        f"${dataset['n_observations']}$ observations of the dataset.",
        "",
    ]
    if miner.get("dropped"):
        out += [
            "\\noindent",
            "Within them, the following measures were left out:",
            *_items([f"{label(d['measure'])}: {_REASONS.get(d['reason'], tex(d['reason']))}" for d in miner["dropped"]]),
        ]
    return out


def _data_section(
    dataset: dict[str, Any], names: list[str], label: _Labels, miner: dict[str, Any] | None = None
) -> list[str]:
    miners = _miners(dataset)
    out: list[str] = []
    if miners:
        out += [
            "\\section*{Chosen Discovery Algorithms}",
            "For this factor analysis, the following miners discovered the process models:",
            *_items([tex(m) for m in miners]),
            "This means, for each input event log, a model was discovered with each of the aforementioned "
            "discovery algorithms.",
            "For the resulting Petri nets, the complexity score of each selected measure was calculated, "
            "which formed the population.",
            "",
        ]
        if miner:
            out += _miner_lines(miner, dataset, label)
    else:
        source = dataset.get("source")
        if source == "pnml":
            text = "The complexity scores were calculated on Petri nets read from PNML files."
        elif source == "csv":
            text = "The complexity scores come from an uploaded CSV file; how they were computed is not known to the tool."
        elif dataset["kind"] == "log":
            text = "The measures were computed on event logs with feeed."
        else:
            text = "The complexity scores come from a bundled dataset."
        out += ["\\section*{Data}", text, ""]
        if miner:
            out += _miner_lines(miner, dataset, label)
    out += ["The following complexity measures were analysed:", *_items([label.listed(m) for m in names])]
    dropped = [d for d in dataset.get("dropped", [])]
    if dropped:
        out += [
            "\\noindent",
            "Before the analysis, the following measures were left out:",
            *_items([f"{label(d['name'])}: {_REASONS.get(d['reason'], tex(d['reason']))}" for d in dropped]),
        ]
    return out


def _validity_section(
    result: dict[str, Any], params: dict[str, Any], names: list[str], label: _Labels
) -> list[str]:
    n = result["n_observations"]
    p = len(names)
    bartlett = result["bartlett"]
    out = [
        "\\section*{Validity of the Factor Analysis}",
        f"The sample size in this analysis was ${n}$.",
        f"It is recommended to have a sample size of at least $5 \\cdot {p} = {5 * p}$.",
        "",
    ]
    excluded = params.get("excluded") or []
    if excluded:
        out += [
            "\\noindent",
            "These measures were excluded by hand:",
            *_items([label(m) for m in excluded]),
        ]
    out.append(
        f"Bartlett's test of sphericity returned a $\\chi^2$ value of ${number(bartlett['chi_square'])}$ "
        f"(${bartlett['df']}$ degrees of freedom) and a $p$-value of ${p_value(bartlett['p_value'])}$."
    )
    if bartlett["passed"]:
        out.append("This means, the variables are probably correlated and we can perform a factor analysis.")
    else:
        out.append(
            "This means, the variables are probably not correlated and performing a factor analysis is "
            "\\textbf{not} advised."
        )
    if bartlett.get("regularised"):
        out.append(
            "The correlation matrix is singular; eigenvalues near zero were clamped, so $\\chi^2$ reflects "
            "the clamping more than the data."
        )
    out.append("")
    kmo = result["kmo"]
    out += [
        "\\noindent",
        "The measure of sampling adequacy (MSA) returned the following results:",
        *_items([
            *(f"{label(m)}: ${number(v)}$" for m, v in kmo["per_measure"].items()),
            f"overall MSA: ${number(kmo['overall'])}$",
        ]),
    ]
    removed = result["msa_filter"]["removed"]
    if not result["msa_filter"]["enabled"]:
        out += ["The MSA filter was turned off: no measure was removed for a low MSA.", ""]
    elif removed:
        out += [
            "\\noindent",
            "During the analysis, the MSA values of the following complexity measures were too low "
            f"(below ${number(kmo['threshold'], 2)}$), in the round of the filter that removed them:",
            *_items([f"{label(r['measure'])}: ${number(r['msa'])}$ (round {r['step']})" for r in removed]),
            "These complexity measures were left out of the analysis to produce dependable results.",
            "",
        ]
    return out


def _factor_count_section(result: dict[str, Any]) -> list[str]:
    values = result["eigenvalues"]
    p = len(values)
    counts = result.get("factor_count") or {}
    random = counts.get("eigenvalues_random")
    k = result["n_factors"]
    shown = min(p, max(MIN_SCREE, 2 * k, counts.get("kaiser", 1), counts.get("parallel_analysis", 1)))

    def coordinates(series: list[float]) -> str:
        return " ".join(f"({i + 1},{number(v)})" for i, v in enumerate(series[:shown]))

    # Thirty labels would run together: from 20 eigenvalues on, every fifth one is labelled.
    ticks = "xtick=data" if shown <= 20 else f"xtick={{1,5,10,...,{shown}}}"
    out = [
        "\\section*{Chosen Number of Factors}",
        "\\noindent",
        "The Scree test resulted in the following Eigenvalue plot"
        + (f" (the first {shown} of {p} eigenvalues)" if shown < p else "")
        + ":",
        "\\begin{center}",
        "\\begin{tikzpicture}",
        f"\\begin{{axis}}[{ticks},width=15cm,height=8cm,xlabel={{Factor}},ylabel={{Eigenvalue}},"
        "legend cell align=left,legend style={font=\\small}]",
        f"\\addplot [draw=cyan!50!blue, mark=*] coordinates {{ {coordinates(values)} }};",
        "\\addlegendentry{Eigenvalues of the correlation matrix}",
    ]
    if random:
        out += [
            f"\\addplot [draw=gray, dashed, mark=none] coordinates {{ {coordinates(random)} }};",
            f"\\addlegendentry{{Parallel analysis ({counts.get('percentile', 95)}th percentile)}}",
        ]
    out += [
        f"\\addplot [draw=gray, dotted, mark=none, domain=1:{shown}, samples=2] {{1}};",
        "\\addlegendentry{Kaiser criterion (eigenvalue 1)}",
        "\\end{axis}",
        "\\end{tikzpicture}",
        "\\end{center}",
        "",
        _KEEP,
        "\\noindent",
        "The share of the variance of each component is its eigenvalue divided by the number of measures, "
        f"${p}$, as ComFy plots it:",
    ]
    header = "Factor & Eigenvalue & Share of variance" + (" & Parallel analysis" if random else "") + " \\\\"
    rows = []
    for i, v in enumerate(values[:shown]):
        cells = [str(i + 1), f"${number(v)}$", f"${number(v / p)}$"]
        if random:
            cells.append(f"${number(random[i])}$")
        rows.append(" & ".join(cells) + " \\\\")
    out += _table("r" + "r" * (3 if random else 2), header, rows)
    criteria = [f"the Kaiser criterion suggests ${counts.get('kaiser', result.get('suggested_n_factors'))}$"]
    if "parallel_analysis" in counts:
        criteria.append(
            f"parallel analysis ${counts['parallel_analysis']}$ ({counts.get('simulations')} samples of random "
            f"normal data, seed {counts.get('seed')})"
        )
    rotation = "no rotation" if result["rotation"] == "none" else f"the {tex(result['rotation'])} rotation"
    out += [
        f"The number of expected factors was set to ${k}$; {', '.join(criteria)}. The factors were fitted "
        f"with minres and {rotation}.",
        "",
    ]
    return out


def _descriptives_section(descriptives: dict[str, Any] | None, label: _Labels) -> list[str]:
    if not descriptives:
        return []
    header = " & Mean & Median & Std & Min & Max \\\\"
    cells = [[number(d[s], DESCRIPTIVE_DECIMALS) for s in STATISTICS] for d in descriptives["measures"]]
    rows = [label(d["measure"]) + " & " + " & ".join(c) + " \\\\" for d, c in zip(descriptives["measures"], cells)]
    # Measures in the millions, such as the events of a log, would widen the table beyond the
    # page with six decimals each; a smaller font keeps it on the page.
    widest = max((len(c) for row in cells for c in row), default=0)
    size = "\\footnotesize" if widest >= 13 else "\\small" if widest >= 11 else None
    basis = (
        f"Over all ${descriptives['n_rows']}$ observations of the data as collected, before any measure was "
        "left out; missing values are not counted."
        if descriptives.get("basis") == "input"
        else "Over the observations and measures of the cleaned matrix; the data before cleaning were not kept "
        "for this dataset."
    )
    return [
        "\\section*{Descriptive Statistics}",
        "\\noindent",
        f"{basis} Std is the sample standard deviation ($n - 1$ in the denominator).",
        "",
        *([f"{{{size}"] if size else []),
        *_table(label.column([d["measure"] for d in descriptives["measures"]]) + "rrrrr", header, rows),
        *(["}", ""] if size else []),
    ]


def _loadings_section(result: dict[str, Any], label: _Labels, names: dict[int, str] | None = None) -> list[str]:
    k = result["n_factors"]
    assignment = result.get("assignment") or {
        "rule": "largest", "loading_threshold": result["loading_threshold"], "loading_strict": False,
        "communality_threshold": result.get("communality_threshold", 0.0),
    }
    threshold = assignment["loading_threshold"]
    strict = assignment["loading_strict"]
    assigned = {(m["measure"], f["index"]) for f in result["factors"] for m in f["measures"]}

    def counts(value: float) -> bool:
        return abs(value) > threshold if strict else abs(value) >= threshold

    def cell(measure: str, j: int, value: float) -> str:
        text = f"${number(value)}$"
        if (measure, j) in assigned:
            return f"$\\mathbf{{{number(value)}}}$"
        return text if counts(value) else f"\\textcolor{{lightgray}}{{{text}}}"

    oblique = result.get("structure_loadings") is not None
    variance = result["variance"]
    sums = [("SS loadings", variance["ss_loadings"])]
    if variance.get("proportion"):
        sums += [("Proportion", variance["proportion"]), ("Cumulative", variance["cumulative"])]
    measures = list(result["loadings"])
    # A wide table is split into tables of a few factors each, so that it fits the page.
    per_table = FACTORS_PER_TABLE_SHORT if label.short else FACTORS_PER_TABLE
    blocks = [list(range(first, min(k, first + per_table))) for first in range(0, k, per_table)]
    out = ["\\section*{Results of the Factor Analysis}"]
    for b, block in enumerate(blocks):
        last = b == len(blocks) - 1
        if len(blocks) > 1:
            out += ["\\noindent", f"Factors {block[0] + 1} to {block[-1] + 1}:", ""]
        end = " \\\\"
        header = " & " + " & ".join(_factor_heading(j, names) for j in block) + (" & $h^2$" if last else "") + end
        rows = [
            label(m) + " & " + " & ".join(cell(m, j, result["loadings"][m][j]) for j in block)
            + (f" & ${number(result['communalities'][m])}$" if last else "") + end
            for m in measures
        ]
        footer = [
            f"{name} & " + " & ".join(f"${number(values[j])}$" for j in block) + (" &" if last else "") + end
            for name, values in sums
        ]
        out += _table(label.column(measures) + "c" * (len(block) + (1 if last else 0)), header, rows, footer)
    compare = ">" if strict else "\\geq"
    below = "\\leq" if strict else "<"
    out += [
        "\\noindent",
        ("Pattern loadings of the " if oblique else "Loadings of the ")
        + f"{k} factor(s). Bold: the loadings by which the assignment rule puts a measure on a factor. "
        f"Grey: loadings that do not count, $|\\lambda| {below} {number(threshold, 2)}$; "
        f"a loading counts with $|\\lambda| {compare} {number(threshold, 2)}$. "
        "$h^2$ is the communality"
        + (", the row sum of the pattern loadings times the structure loadings." if oblique else ".")
        + (" SS loadings are the sums of squares of the pattern loadings." if oblique else ""),
        "",
    ]
    return out


def _communalities_section(result: dict[str, Any], label: _Labels) -> list[str]:
    communalities = result["communalities"]
    measures = list(result["loadings"])
    threshold = (result.get("assignment") or {}).get("communality_threshold", result.get("communality_threshold", 0))
    out = ["\\section*{Communalities}"]
    if len(measures) > MAX_BARS:
        return [*out, f"The communalities of the {len(measures)} measures are in the column $h^2$ of the loadings table.", ""]
    labels = ",".join("{" + label(m) + "}" for m in measures)
    out += [
        "\\begin{center}",
        "\\begin{tikzpicture}",
        f"\\begin{{axis}}[ybar,ymin=0,xtick=data,xticklabels={{{labels}}},xticklabel style={{rotate=45, anchor=east}},"
        "nodes near coords={\\pgfmathprintnumber{\\pgfplotspointmeta}},every node near coord/.append style={font=\\scriptsize},"
        "width=15cm,height=8cm]",
        "\\addplot [draw=cyan!50!blue, fill=cyan!50!blue] coordinates { "
        + " ".join(f"({i + 1},{number(communalities[m])})" for i, m in enumerate(measures))
        + " };",
    ]
    if threshold:
        out.append(
            f"\\draw [gray, dashed] (axis cs:0.5,{number(threshold, 2)}) -- (axis cs:{len(measures)}.5,{number(threshold, 2)});"
        )
    out += ["\\end{axis}", "\\end{tikzpicture}", "\\end{center}"]
    if threshold:
        out.append(f"The dashed line marks the communality an assigned measure needs, ${number(threshold, 2)}$.")
    return [*out, ""]


def _correlations_section(result: dict[str, Any], names: dict[int, str] | None = None) -> list[str]:
    correlations = result.get("factor_correlations")
    if not correlations:
        return []
    k = len(correlations)
    header = " & " + " & ".join(_factor_heading(j, names) for j in range(k)) + " \\\\"
    rows = [
        f"{_factor_heading(i, names)} & " + " & ".join(f"${number(v)}$" for v in row) + " \\\\"
        for i, row in enumerate(correlations)
    ]
    return [
        _KEEP,
        "\\section*{Factor Correlations}",
        f"The {tex(result['rotation'])} rotation is oblique, so the factors may correlate:",
        "",
        *_table("l" + "c" * k, header, rows),
    ]


def _dimensions_section(
    result: dict[str, Any], label: _Labels, factor_names: dict[int, str] | None
) -> list[str]:
    rule = result.get("assignment_rule", "largest")
    rows = []
    for factor in result["factors"]:
        name = f"Factor {factor['index'] + 1}"
        if factor_names and factor_names.get(factor["index"]):
            name += f": {tex(factor_names[factor['index']])}"
        members = ", ".join(f"{label(m['measure'])} (${number(m['loading'], 2)}$)" for m in factor["measures"]) or "--"
        rows.append(f"{name} & {members} \\\\")
    out = [
        _KEEP,
        "\\section*{Dimensions}",
        "\\noindent",
        f"The assignment rule ``{tex(rule)}'' puts {tex(ASSIGNMENT_RULE_TEXTS[rule])}.",
        "",
        *_table(f"@{{}}{_RAGGED}p{{4.5cm}}{_RAGGED}p{{11cm}}@{{}}", "Factor & Measures (loading) \\\\", rows, breaks=True),
    ]
    details = result.get("unassigned_details") or [{"measure": m, "reason": ""} for m in result.get("unassigned", [])]
    if details:
        out += [
            "\\noindent",
            "In no factor:",
            *_items([
                label(u["measure"]) + (f": {_UNASSIGNED[u['reason']]}" if u.get("reason") in _UNASSIGNED else "")
                for u in details
            ]),
        ]
    if result.get("cross_loadings"):
        cross = [
            label(c["measure"]) + ": " + ", ".join(
                f"Factor {f + 1} (${number(v, 2)}$)" for f, v in zip(c["factors"], c["loadings"])
            )
            for c in result["cross_loadings"]
        ]
        out += [
            "\\noindent",
            f"Cross-loadings, loadings at most ${number(CROSS_LOADING_GAP, 2)}$ below the largest one of a measure:",
            *_items(cross),
        ]
    if factor_names:
        out += [
            "The names of the factors were given by whoever ran the analysis; they interpret the factors and are "
            "not computed.",
            "",
        ]
    return out


def _settings_section(
    dataset: dict[str, Any],
    params: dict[str, Any],
    result: dict[str, Any],
    tool: dict[str, Any],
    libraries: dict[str, str | None],
    published: dict[str, Any] | None,
    short: bool,
) -> list[str]:
    assignment = result.get("assignment") or {}
    counts = result.get("factor_count") or {}
    origin = dataset.get("provenance") or {}
    compare = ">" if assignment.get("loading_strict") else "\\geq"
    rows: list[tuple[str, str]] = [
        ("Dataset", tex(dataset["name"]) + f" ({tex(dataset['kind'])} measures, source {tex(dataset['source'])})"),
        ("Observations", f"${result['n_observations']}$ of the cleaned matrix"),
        *(
            [("Miner", f"{tex(result['miner']['name'])}: only the rows of this miner")]
            if result.get("miner")
            else []
        ),
        ("Measures excluded by hand", ", ".join(tex(m) for m in params.get("excluded") or []) or "none"),
        (
            "MSA filter",
            f"on, threshold ${number(params['msa_threshold'], 2)}$" if params.get("auto_msa_filter", True) else "off",
        ),
        ("Significance level", f"$\\alpha = {number(params['bartlett_alpha'], 2)}$ for Bartlett's test"),
        (
            "Number of factors",
            f"${result['n_factors']}$ "
            + ("(the Kaiser criterion)" if params.get("n_factors") is None else "(set by hand)"),
        ),
        ("Rotation", tex(result["rotation"])),
        (
            "Loading threshold",
            f"$|\\lambda| {compare} "
            f"{number(assignment.get('loading_threshold', result['loading_threshold']), 2)}$",
        ),
        ("Communality threshold", f"$h^2 \\geq {number(assignment.get('communality_threshold', 0), 2)}$"),
        ("Assignment rule", f"{tex(result.get('assignment_rule', 'largest'))}: {tex(ASSIGNMENT_RULE_TEXTS[result.get('assignment_rule', 'largest')])}"),
        ("Method", f"minres with factor\\_analyzer {tex(libraries.get('factor_analyzer') or 'unknown')}"),
    ]
    if counts:
        rows.append((
            "Parallel analysis",
            f"{counts.get('simulations')} samples of random normal data, {counts.get('percentile')}th percentile, "
            f"seed {counts.get('seed')}",
        ))
    rows.append(("Measure names", "short codes of the papers" if short else "full names"))
    bundled = origin.get("bundled")
    if bundled:
        source = bundled["copied_from"]
        rows.append((
            "Data",
            f"bundled dataset {tex(bundled['id'])}, from {tex(source['repository'])}, commit {tex(str(source['commit'])[:7])}",
        ))
    elif origin.get("source") == "csv":
        rows.append(("Data", "an uploaded CSV file"))
    elif origin.get("inputs") is not None:
        rows.append(("Data", f"computed by the tool from {len(origin['inputs'])} input file(s)"))
    measures = origin.get("measures")
    if measures:
        rows.append(("Measures", f"{tex(measures['name'])}, commit {tex(str(measures['commit'])[:7])}"))
    discovery = origin.get("discovery")
    if discovery:
        rows.append(("Discovery", f"{tex(discovery['name'])}: " + ", ".join(tex(m["name"]) for m in discovery["miners"])))
    features = origin.get("features")
    if features:
        rows.append(("Features", f"feeed {tex(features.get('version') or '(an earlier version)')}"))
    if published:
        match = published.get("match") or {}
        found = "they match" if match.get("status") == "match" else f"{len(match.get('differences', []))} differ"
        rows.append((
            "Published numbers",
            f"compared with {tex(match.get('source', ''))} (tolerance {match.get('tolerance')}): {found}",
        ))
    rows.append((
        "Software",
        f"{tex(APP_NAME)} (version {tex(tool.get('version') or 'not recorded')}, "
        f"commit {tex(str(tool.get('commit') or 'not recorded')[:12])}); "
        + ", ".join(f"{tex(name)} {tex(v)}" for name, v in libraries.items() if v),
    ))
    citation = dataset.get("citation")
    if citation:
        rows.append(("Citation", tex(citation)))
    return [
        _KEEP,
        "\\section*{Settings and Provenance}",
        *_table(
            f"@{{}}{_RAGGED}p{{4.2cm}}{_RAGGED}p{{11.3cm}}@{{}}", "Setting & Value \\\\", [f"{k} & {v} \\\\" for k, v in rows]
        ),
    ]


def report_tex(
    *,
    dataset: dict[str, Any],
    params: dict[str, Any],
    result: dict[str, Any],
    descriptives: dict[str, Any] | None,
    tool: dict[str, Any],
    libraries: dict[str, str | None],
    created_at: str,
    short: bool = False,
    factor_names: dict[int, str] | None = None,
    published: dict[str, Any] | None = None,
) -> str:
    """The report of one analysis. ``dataset`` is the dataset as the manifest of the ZIP
    describes it, ``params`` the parameters the analysis ran with, ``result`` the analysis,
    ``descriptives`` the statistics kept with the dataset. ``short`` names the measures by the
    short codes of the papers; ``factor_names`` are names of the factors by their index from 0,
    as the request gave them; ``published`` the comparison with the published numbers. An
    analysis of the rows of one miner (``result["miner"]``) says so where the miners are named."""
    label = _Labels(dataset["kind"], short)
    names = _measures(dataset, descriptives)
    lines = [
        f"% {COMPILE_HINT}",
        "\\documentclass[a4paper]{article}",
        "",
        "\\usepackage[margin=1in]{geometry}",
        "\\usepackage[T1]{fontenc}",
        "\\usepackage{graphicx}",
        "\\usepackage{booktabs}",
        "\\usepackage{longtable}",
        "\\usepackage{needspace}",
        "\\usepackage{array}",
        "\\usepackage{amsmath}",
        "\\usepackage{tikz}",
        "\\usepackage{pgfplots}",
        "\\usepackage{paralist}",
        "\\pgfplotsset{compat=1.16}",
        "\\setlength{\\tabcolsep}{4pt}",
        "",
        "\\begin{document}",
        "",
        "\\noindent",
        f"Factor analysis of the dataset ``{tex(dataset['name'])}'', exported from {tex(APP_NAME)} on "
        f"{tex(created_at)}.",
        "",
        *_data_section(dataset, names, label, result.get("miner")),
        *_validity_section(result, params, names, label),
        *_factor_count_section(result),
        *_descriptives_section(descriptives, label),
        *_loadings_section(result, label, factor_names),
        *_communalities_section(result, label),
        *_correlations_section(result, factor_names),
        *_dimensions_section(result, label, factor_names),
        *_settings_section(dataset, params, result, tool, libraries, published, short),
        "\\end{document}",
        "",
    ]
    return "\n".join(lines)
