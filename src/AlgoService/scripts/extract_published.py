"""Extract the published numbers of the bundled datasets from the upstream reports.

Reads the seven ``output/paper-results/report-*-miner.tex`` of ComFy and
``output/paper-results/analysis-info-10-factors-oblimax.tex`` of ComFy for log measures, at
the commits ``datasets/manifest.json`` names, and writes one
``datasets/published/<dataset id>.json`` per bundled dataset. The tests in
``tests/test_published_numbers.py`` check the analysis against these files. Run once from
src/AlgoService with both upstream repositories checked out:

    python scripts/extract_published.py ../ComFy ../ComFy-for-Log-Measures

The reports print every value rounded to four decimals with Python's ``round``, except
Bartlett's chi-square and the overall MSA, which they print in full.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import warnings
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd  # noqa: E402
from factor_analyzer.factor_analyzer import calculate_kmo  # noqa: E402

from factor_analysis import catalog as cat  # noqa: E402
from factor_analysis.published import PUBLISHED_DIR, SCHEMA_VERSION  # noqa: E402

#: ComFy's reports, per bundled dataset.
REPORTS = {
    "comfy-paper-alpha-miner": "report-alpha-miner.tex",
    "comfy-paper-alpha-dollar-miner": "report-alpha-dollar-miner.tex",
    "comfy-paper-alpha-plus-miner": "report-alpha-plus-miner.tex",
    "comfy-paper-directly-follows-miner": "report-directly-follows-miner.tex",
    "comfy-paper-heuristics-miner": "report-heuristics-miner.tex",
    "comfy-paper-hybrid-ilp-miner": "report-hybrid-ilp-miner.tex",
    "comfy-paper-inductive-miner": "report-inductive-miner.tex",
}
LOG_DATASET = "comfy-log-pdc-training-logs"
LOG_REPORT = "analysis-info-10-factors-oblimax.tex"

_NUMBER = r"-?\d+(?:\.\d+)?(?:e-?\d+)?"


def _git_head(repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()


def _items(lines: list[str], start: int) -> tuple[list[str], int]:
    """The ``\\item`` lines of the list that begins after line ``start``."""
    out = []
    i = start
    while not lines[i].startswith("\\begin{compact"):
        i += 1
    i += 1
    while not lines[i].startswith("\\end{compact"):
        if lines[i].startswith("\\item "):
            out.append(lines[i][len("\\item "):])
        i += 1
    return out, i


def _after(lines: list[str], text: str, start: int = 0) -> int:
    return next(i for i in range(start, len(lines)) if text in lines[i])


def _value(item: str) -> tuple[str, float]:
    name, _, value = item.rpartition(": $")
    return name, float(value.rstrip("$"))


def _coordinates(line: str) -> list[tuple[str, float]]:
    return [(a, float(b)) for a, b in re.findall(r"\(([^,()]+),(" + _NUMBER + r")\)", line)]


def _msa_rounds(data: pd.DataFrame, threshold: float) -> dict[str, int]:
    """In which round ComFy's ``repeat_calculate_measure_of_sampling_adequacy`` removes each
    measure: all measures below the threshold at once, then the MSA again. The reports list
    the removed measures in this order but do not number the rounds."""
    rounds: dict[str, int] = {}
    round_ = 0
    while True:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            per_measure, _ = calculate_kmo(data)
        low = [c for c, v in zip(data.columns, per_measure) if v < threshold]
        if not low:
            return rounds
        round_ += 1
        rounds.update({c: round_ for c in low})
        data = data.drop(columns=low)


def model_report(dataset_id: str, path: Path, commit: str) -> dict[str, Any]:
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    entry = cat.bundled_entry(dataset_id)
    raw = pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0)

    measures, _ = _items(lines, _after(lines, "following complexity measures"))
    n = int(re.search(r"\$(\d+)\$", lines[_after(lines, "sample size")]).group(1))
    bartlett_line = lines[_after(lines, "Bartlett's test")]
    chi_square, p_value = (float(v) for v in re.findall(r"\$(" + _NUMBER + r")\$", bartlett_line)[:2])

    msa_items, end = _items(lines, _after(lines, "measure of sampling adequacy (MSA) returned"))
    per_measure = dict(_value(item) for item in msa_items)
    overall = per_measure.pop("overall MSA")
    removed_items: list[str] = []
    if any("were too low" in line for line in lines):
        removed_items, _ = _items(lines, _after(lines, "were too low"))
    removed = [_value(item) for item in removed_items]

    ratios = [v for _, v in _coordinates(lines[_after(lines, "\\addplot", _after(lines, "Scree test"))])]
    n_factors = int(re.search(r"factors to \$(\d+)\$", "\n".join(lines)).group(1))

    descriptives: dict[str, dict[str, float]] = {}
    i = _after(lines, "& Mean & Median & Std & Min & Max") + 2
    while lines[i] != "\\bottomrule":
        cells = [c.strip() for c in lines[i].rstrip("\\").split("&")]
        descriptives[cells[0]] = dict(zip(("mean", "median", "std", "min", "max"), map(float, cells[1:])))
        i += 1

    loadings: dict[str, list[float]] = {}
    i = _after(lines, "& Factor 1") + 1
    while not lines[i].startswith("\\bottomrule"):
        cells = [c.strip() for c in lines[i].rstrip("\\ ").split("&")]
        loadings[cells[0]] = [float(re.findall(_NUMBER, c)[-1]) for c in cells[1:]]
        i += 1

    communalities = dict(_coordinates(lines[_after(lines, "\\addplot", _after(lines, "Communalities"))]))

    # Only constant measures are dropped before ComFy's MSA filter.
    kept = raw.loc[:, raw.nunique() > 1]
    rounds = _msa_rounds(kept, 0.6)
    if [m for m, _ in removed] != sorted(rounds, key=lambda m: (rounds[m], list(kept.columns).index(m))):
        raise SystemExit(f"{path.name}: the removed measures are not in the order of ComFy's MSA rounds")

    tool_factors = n_factors
    notes = [
        "Rotation: the report does not name it; the paper uses varimax, and only varimax "
        "reproduces the loadings.",
        "Eigenvalues: the report plots PCA's explained variance ratio, the eigenvalues of the "
        "correlation matrix divided by the number of measures.",
        "MSA rounds: the report lists the removed measures in the order ComFy removed them but "
        "does not number the rounds; the rounds were reconstructed with ComFy's loop.",
    ]
    if any(all(row[j] == 0.0 for row in loadings.values()) for j in range(n_factors)):
        tool_factors = len(loadings) - 1
        notes.append(
            f"The report asks for {n_factors} factors with only {len(loadings)} measures left after "
            f"the MSA filter; its last column is all 0.0. The tool fits at most p - 1 = "
            f"{tool_factors} factors, which reproduce the other columns."
        )

    return {
        "schema": SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "source": {
            "repository": entry["source_url"],
            "commit": commit,
            "file": f"output/paper-results/{path.name}",
        },
        "reproduce_with": {
            "n_factors": tool_factors,
            "rotation": "varimax",
            "msa_threshold": 0.6,
            "bartlett_alpha": 0.05,
            "loading_threshold": 0.35,
        },
        "decimals": 4,
        "verified": [
            "n_observations", "bartlett", "kmo", "msa_filter", "explained_variance_ratio",
            "loadings", "communalities", "descriptives",
        ],
        "n_observations": n,
        "measures": measures,
        "n_factors": n_factors,
        "bartlett": {"chi_square": chi_square, "p_value": p_value},
        "kmo": {"overall": overall, "per_measure": per_measure},
        "msa_filter": {
            "threshold": 0.6,
            "removed": [{"measure": m, "msa": v, "round": rounds[m]} for m, v in removed],
        },
        "explained_variance_ratio": ratios,
        "loadings": loadings,
        "communalities": communalities,
        "descriptives": descriptives,
        "notes": notes,
    }


def _feeed_name(item: str) -> str:
    """``$\\macro$ (trace len skewness)`` is the feeed feature ``trace_len_skewness``."""
    return re.search(r"\(([^()]*)\)\s*$", item).group(1).replace(" ", "_")


def log_report(path: Path, commit: str) -> dict[str, Any]:
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    entry = cat.bundled_entry(LOG_DATASET)
    header = list(pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0, nrows=0).columns)

    all_items, _ = _items(lines, _after(lines, "following complexity measures"))
    # The MSA lists name the measures by their LaTeX macro only.
    by_macro = {_macro(item): _feeed_name(item) for item in all_items}

    def names(text: str) -> list[str]:
        items, _ = _items(lines, _after(lines, text))
        out = [_feeed_name(item) for item in items]
        unknown = [m for m in out if m not in header]
        if unknown:
            raise SystemExit(f"{path.name}: not in the CSV: {unknown}")
        return out

    def msa(item: str) -> tuple[str, float]:
        return by_macro[_macro(item)], float(item.rpartition(": $")[2].rstrip("$"))

    measures = names("following complexity measures")
    analyzed = int(re.search(r"\$(\d+)\$", lines[_after(lines, "total of")]).group(1))
    n = int(re.search(r"\$(\d+)\$", lines[_after(lines, "sample size")]).group(1))
    bartlett_line = lines[_after(lines, "Bartlett's test")]
    chi_square, p_value = (float(v) for v in re.findall(r"\$(" + _NUMBER + r")\$", bartlett_line)[:2])

    msa_items, _ = _items(lines, _after(lines, "measure of sampling adequacy (MSA) returned"))
    overall = float(msa_items[-1].rpartition(": $")[2].rstrip("$"))
    per_measure = dict(msa(item) for item in msa_items[:-1])
    removed_items, _ = _items(lines, _after(lines, "were too low"))
    removed = [msa(item) for item in removed_items]

    return {
        "schema": SCHEMA_VERSION,
        "dataset_id": LOG_DATASET,
        "source": {
            "repository": entry["source_url"],
            "commit": commit,
            "file": f"output/paper-results/{path.name}",
        },
        # No settings to reproduce with: the published loadings use factor_analyzer's oblimax,
        # which the tool does not offer yet.
        "reproduce_with": None,
        "verified": ["n_observations", "cleaning", "bartlett"],
        "platform_dependent": ["kmo", "msa_filter"],
        "n_observations": n,
        "measures": measures,
        "cleaning": {
            "non_numeric": names("returned non-numeric values"),
            "constant": names("variance is $0$"),
            "correlated": names("correlated with other measures"),
            "analyzed": analyzed,
        },
        "bartlett": {"chi_square": chi_square, "p_value": p_value},
        "kmo": {"overall": overall, "per_measure": per_measure},
        "msa_filter": {"threshold": 0.6, "removed": [{"measure": m, "msa": v} for m, v in removed]},
        "notes": [
            "After cleaning, the correlation matrix has six exact linear dependencies; KMO and MSA "
            "then rest on a pseudo-inverse and differ between platforms and column orders "
            "(datasets/PROVENANCE.md). Only the cleaning and Bartlett's chi-square are checked.",
        ],
    }


def _macro(item: str) -> str:
    """``$\\tlmin$ (trace len min)`` and ``$\\tlmin$: $0.9632$`` give ``tlmin``."""
    return re.match(r"\$\\(\w+)\$", item).group(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("comfy", type=Path, help="checkout of https://github.com/Pati-nets/ComFy")
    parser.add_argument("comfy_log", type=Path, help="checkout of https://github.com/Pati-nets/ComFy-for-Log-Measures")
    args = parser.parse_args()

    PUBLISHED_DIR.mkdir(exist_ok=True)
    outputs: dict[str, dict[str, Any]] = {}
    commit = _git_head(args.comfy)
    for dataset_id, report in REPORTS.items():
        expected = cat.bundled_entry(dataset_id)["source_commit"]
        if commit != expected:
            raise SystemExit(f"ComFy is at {commit}, the bundled data come from {expected}")
        outputs[dataset_id] = model_report(dataset_id, args.comfy / "output" / "paper-results" / report, commit)
    commit = _git_head(args.comfy_log)
    expected = cat.bundled_entry(LOG_DATASET)["source_commit"]
    if commit != expected:
        raise SystemExit(f"ComFy for log measures is at {commit}, the bundled data come from {expected}")
    outputs[LOG_DATASET] = log_report(args.comfy_log / "output" / "paper-results" / LOG_REPORT, commit)

    for dataset_id, content in outputs.items():
        with open(PUBLISHED_DIR / f"{dataset_id}.json", "w", encoding="utf-8", newline="\n") as f:
            json.dump(content, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"wrote {dataset_id}.json")


if __name__ == "__main__":
    main()
