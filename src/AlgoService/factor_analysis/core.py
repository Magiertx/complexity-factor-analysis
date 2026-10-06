"""Numerics of the factor analysis.

The steps follow ComFy (https://github.com/Pati-nets/ComFy, ``FactorAnalysis.py``) and
ComFy for log measures (https://github.com/Pati-nets/ComFy-for-Log-Measures,
``FactorAnalysis.py``, MIT), both by Patrizia Schalk:

- data cleaning as in ``prepare_data_for_factor_analysis`` of the log version,
- Bartlett's test with the eigenvalue-based log-determinant of the log version,
- the MSA filter of ``repeat_calculate_measure_of_sampling_adequacy``,
- a ``FactorAnalyzer`` fit with factor_analyzer's defaults (minres, SMC start values).

Thresholds come from the vendored log-side ``Constants.py``.
"""

from __future__ import annotations

import hashlib
import inspect
import math
import threading
import warnings
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
import factor_analyzer.factor_analyzer as _fa_module
from factor_analyzer.factor_analyzer import FactorAnalyzer, calculate_kmo
from factor_analyzer.utils import corr as _corr
from scipy.stats import chi2
from sklearn.utils import check_array as _sklearn_check_array

from vendored.comfy_log import Constants as _C

MIN_MEASURES = 3
ROTATIONS = ("varimax", "promax", "oblimin", "quartimax", "none")
MISSING_MARKERS = {"", "nan", "none", "null", "na", "n/a", "-"}

# Rows with more than this share of missing values are dropped first, e.g. an input on which
# every measure failed.
MAX_ROW_MISSING_SHARE = 0.5

# Then a measure with more than this share of missing values is dropped, and rows with a
# missing value in the remaining measures. 0 drops every measure with a gap, as ComFy for log
# measures does.
MAX_MISSING_SHARE = 0.0

# Default loading and communality thresholds per kind, as in ComFy and ComFy for log measures.
LOADING_THRESHOLDS = {"model": 0.35, "log": _C.ignore_threshold}
COMMUNALITY_THRESHOLDS = {"model": 0.0, "log": _C.communality_threshold}


def _check_array_compat(x, force_all_finite=None, **kwargs):
    # scikit-learn 1.6 renamed force_all_finite to ensure_all_finite and 1.8 removed the old
    # name; factor_analyzer 0.5.1 still passes it. Same patch as in ComFy for log measures.
    if force_all_finite is not None:
        accepted = inspect.signature(_sklearn_check_array).parameters
        if "ensure_all_finite" in accepted:
            kwargs["ensure_all_finite"] = force_all_finite
        elif "force_all_finite" in accepted:
            kwargs["force_all_finite"] = force_all_finite
    return _sklearn_check_array(x, **kwargs)


_fa_module.check_array = _check_array_compat

# minres bounds every uniqueness below by 0.005, so a Heywood case ends at a communality of
# about 0.995 rather than 1.
HEYWOOD_COMMUNALITY = 1 - FactorAnalyzer().bounds[0] - 1e-4


class AnalysisError(ValueError):
    """The data cannot be analysed with the given settings; the message says why.

    ``code`` and ``params`` let the UI show the message in its own language.
    """

    def __init__(self, message: str, code: str = "analysis_failed", **params: Any) -> None:
        super().__init__(message)
        self.code = code
        self.params = params


# --- cleaning ----------------------------------------------------------------------------


@dataclass
class CleanResult:
    data: pd.DataFrame
    dropped: list[dict[str, Any]] = field(default_factory=list)
    dropped_rows: int = 0
    #: Rows dropped first because most of their values were missing.
    empty_rows: list[str] = field(default_factory=list)


def _is_missing_marker(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return isinstance(value, str) and value.strip().lower() in MISSING_MARKERS


def _is_constant(values: pd.Series) -> bool:
    # Relative to the magnitude, so a measure on a tiny scale is not taken for a constant.
    return len(values) == 0 or values.std(ddof=0) <= 1e-12 * max(1.0, abs(values.mean()))


def clean_matrix(raw: pd.DataFrame, *, max_missing_share: float = MAX_MISSING_SHARE) -> CleanResult:
    """Reduce a table to a numeric matrix that a factor analysis can use.

    In this order: drop measures with non-numeric values, drop rows with more than
    ``MAX_ROW_MISSING_SHARE`` missing values, drop measures with more than
    ``max_missing_share`` missing values, drop rows with a missing value in what is left, drop
    constant measures, drop measures perfectly correlated with an earlier one (the first one is
    kept). Infinite values count as missing.
    """
    dropped: list[dict[str, Any]] = []
    numeric: dict[str, np.ndarray] = {}

    for column in raw.columns:
        values = raw[column]
        converted = pd.to_numeric(values, errors="coerce")
        if not pd.api.types.is_numeric_dtype(values):
            bad = [v for v, c in zip(values, converted) if pd.isna(c) and not _is_missing_marker(v)]
            if bad:
                value = str(bad[0])[:40]
                dropped.append({
                    "measure": str(column),
                    "reason": "non_numeric",
                    "detail": f"contains the value {value!r}",
                    "params": {"value": value},
                })
                continue
        numeric[str(column)] = converted.astype(float).replace([np.inf, -np.inf], np.nan).to_numpy()

    data = pd.DataFrame(numeric, index=[str(i) for i in raw.index], dtype=float)
    before = len(data)
    empty_rows: list[str] = []
    if data.shape[1]:
        empty = (data.isna().mean(axis=1) > MAX_ROW_MISSING_SHARE).to_numpy()
        empty_rows = [str(i) for i in data.index[empty]]
        data = data[~empty]

    for column in list(data.columns):
        n_missing = int(data[column].isna().sum())
        if len(data) and n_missing / len(data) > max_missing_share:
            dropped.append({
                "measure": column,
                "reason": "missing",
                "detail": f"{n_missing} of {len(data)} values missing",
                "params": {"missing": n_missing, "total": len(data)},
            })
            data = data.drop(columns=column)

    data = data.dropna(axis=0, how="any")
    dropped_rows = before - len(data)

    constant = [c for c in data.columns if _is_constant(data[c])]
    for column in constant:
        dropped.append({"measure": column, "reason": "constant"})
    data = data.drop(columns=constant)

    duplicates: dict[str, str] = {}
    if data.shape[1] > 1 and len(data) > 1:
        absolute = data.corr().abs()
        columns = list(absolute.columns)
        for i, first in enumerate(columns):
            if first in duplicates:
                continue
            for other in columns[i + 1:]:
                if other not in duplicates and np.isclose(absolute.loc[first, other], 1.0):
                    duplicates[other] = first
    for column, kept in duplicates.items():
        dropped.append({
            "measure": column,
            "reason": "duplicate",
            "detail": f"perfectly correlated with {kept}",
            "params": {"kept": kept},
        })
    data = data.drop(columns=list(duplicates))

    return CleanResult(data=data, dropped=dropped, dropped_rows=dropped_rows, empty_rows=empty_rows)


# --- suitability --------------------------------------------------------------------------


def correlation_matrix(data: pd.DataFrame) -> np.ndarray:
    return _corr(np.asarray(data, dtype=float))


def bartlett_sphericity(data: pd.DataFrame) -> dict[str, float]:
    """Bartlett's test of sphericity with log(det R) taken as the sum of log eigenvalues.

    ``factor_analyzer.calculate_bartlett_sphericity`` takes ``log(det(R))``, which is NaN once
    the determinant underflows. Eigenvalues below ``Constants.eigenvalue_floor`` are clamped to
    it, as in ComFy for log measures; ``clamped`` counts them. With any clamped, chi-square
    depends on the floor rather than on the data.
    """
    n, p = data.shape
    raw = np.linalg.eigvalsh(correlation_matrix(data))
    eigenvalues = np.clip(raw, _C.eigenvalue_floor, None)
    chi_square = -float(np.sum(np.log(eigenvalues))) * (n - 1 - (2 * p + 5) / 6)
    df = p * (p - 1) / 2
    return {
        "chi_square": chi_square,
        "df": df,
        "p_value": float(chi2.sf(chi_square, df)),
        "clamped": int(np.sum(raw < _C.eigenvalue_floor)),
    }


def singular_measures(data: pd.DataFrame) -> list[list[str]]:
    """Groups of measures that are (nearly) linearly dependent, one group per tiny eigenvalue.

    Each group holds the measures with the largest weight in the eigenvector, until their
    squared weights cover ``Constants.eigenvector_loading_coverage_threshold``.
    """
    eigenvalues, eigenvectors = np.linalg.eigh(correlation_matrix(data))
    columns = list(data.columns)
    groups: list[list[str]] = []
    for index in np.where(eigenvalues < _C.eigenvalue_floor)[0]:
        weights = eigenvectors[:, index]
        order = np.argsort(-np.abs(weights))
        covered = np.cumsum(weights[order] ** 2)
        cutoff = int(np.searchsorted(covered, _C.eigenvector_loading_coverage_threshold)) + 1
        groups.append([columns[i] for i in order[:cutoff]])
    return groups


def kmo(data: pd.DataFrame) -> tuple[dict[str, float], float]:
    """Kaiser-Meyer-Olkin measure of sampling adequacy, per measure and overall."""
    # factor_analyzer warns about a pseudo-inverse whenever det(cov) is tiny, which depends on
    # the scale of the measures and fires on regular data too; singular_measures reports
    # actual singularity.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        per_measure, overall = calculate_kmo(np.asarray(data, dtype=float))
    if not np.all(np.isfinite(per_measure)) or not math.isfinite(overall):
        raise AnalysisError("The MSA could not be computed; the correlation matrix is singular.", "msa_singular")
    return {c: float(v) for c, v in zip(data.columns, per_measure)}, float(overall)


@dataclass
class MsaFilterResult:
    data: pd.DataFrame
    per_measure: dict[str, float]
    overall: float
    removed: list[dict[str, Any]]


def msa_filter(data: pd.DataFrame, threshold: float = _C.msa_threshold) -> MsaFilterResult:
    """ComFy's ``repeat_calculate_measure_of_sampling_adequacy``.

    Every measure whose MSA is below the threshold is removed in the same step, then the MSA
    is recomputed, until no measure is below it. Stops early when fewer than
    ``MIN_MEASURES`` measures are left.
    """
    per_measure, overall = kmo(data)
    removed: list[dict[str, Any]] = []
    step = 0
    while True:
        low = sorted((v, c) for c, v in per_measure.items() if v < threshold)
        if not low:
            break
        step += 1
        removed.extend({"measure": c, "msa": v, "step": step} for v, c in low)
        data = data.drop(columns=[c for _, c in low])
        if data.shape[1] < MIN_MEASURES:
            break
        per_measure, overall = kmo(data)
    return MsaFilterResult(data=data, per_measure=per_measure, overall=overall, removed=removed)


def eigenvalues(data: pd.DataFrame) -> list[float]:
    """Eigenvalues of the correlation matrix, largest first (the scree plot)."""
    return [float(v) for v in np.linalg.eigvalsh(correlation_matrix(data))[::-1]]


def kaiser_criterion(values: list[float]) -> int:
    """Number of eigenvalues above 1, at least 1."""
    return max(1, sum(1 for v in values if v > 1.0))


# --- factor analysis ----------------------------------------------------------------------


@dataclass
class FactorFit:
    #: Orthogonal rotations: the loadings. Oblique rotations: the pattern matrix.
    loadings: pd.DataFrame
    communalities: dict[str, float]
    uniquenesses: dict[str, float]
    ss_loadings: list[float]
    #: Shares of variance per factor; None for oblique rotations, where they do not add up.
    proportion: list[float] | None
    cumulative: list[float] | None
    #: Share of the total variance the factors explain together, mean communality.
    explained: float
    rotation: str
    #: Oblique rotations only: correlations of measures and factors, and among the factors.
    structure: pd.DataFrame | None = None
    factor_correlations: list[list[float]] | None = None
    #: Warnings of the fit, e.g. that the optimizer did not converge.
    notes: list[str] = field(default_factory=list)


_FIT_CACHE: OrderedDict[tuple, FactorFit] = OrderedDict()
_FIT_CACHE_SIZE = 32
_FIT_CACHE_LOCK = threading.Lock()


def _fit_key(data: pd.DataFrame, n_factors: int, rotation: str) -> tuple:
    digest = hashlib.sha1(np.ascontiguousarray(data.to_numpy(dtype=float)).tobytes())
    digest.update(repr(list(data.columns)).encode())
    return digest.hexdigest(), n_factors, rotation


def fit_factors(data: pd.DataFrame, n_factors: int, rotation: str = "varimax") -> FactorFit:
    """``FactorAnalyzer`` with its defaults. The minres fit takes seconds for a hundred
    measures, so recent fits are cached; a new loading threshold does not refit."""
    key = _fit_key(data, n_factors, rotation)
    with _FIT_CACHE_LOCK:
        if key in _FIT_CACHE:
            _FIT_CACHE.move_to_end(key)
            return _FIT_CACHE[key]
    fit = _fit_factors(data, n_factors, rotation)
    with _FIT_CACHE_LOCK:
        _FIT_CACHE[key] = fit
        if len(_FIT_CACHE) > _FIT_CACHE_SIZE:
            _FIT_CACHE.popitem(last=False)
    return fit


def max_factors(p: int) -> int:
    """With p measures, a p-th factor would carry no variance; at most p - 1 are fitted."""
    return p - 1


def _fit_factors(data: pd.DataFrame, n_factors: int, rotation: str) -> FactorFit:
    if rotation not in ROTATIONS:
        raise AnalysisError(f"Unknown rotation '{rotation}'.", "unknown_rotation", rotation=rotation)
    p = data.shape[1]
    if n_factors < 1 or n_factors > max_factors(p):
        raise _factor_count_error(n_factors, p)
    # factor_analyzer skips the rotation for a single factor; say so in the result.
    used_rotation = "none" if rotation == "none" or n_factors == 1 else rotation

    fa = FactorAnalyzer(n_factors=n_factors, rotation=None if used_rotation == "none" else used_rotation)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            fa.fit(np.asarray(data, dtype=float))
        except (np.linalg.LinAlgError, ValueError) as e:
            raise AnalysisError(f"The factor analysis failed: {e}", "fit_failed", error=str(e)) from None
    notes = sorted({str(w.message) for w in caught if str(w.message).startswith("Failed to converge")})

    if not np.all(np.isfinite(fa.loadings_)):
        raise AnalysisError(
            "The factor analysis did not converge; the correlation matrix is singular. "
            "Exclude measures that are linear combinations of others.",
            "not_converged",
        )
    columns = [f"Factor {i + 1}" for i in range(n_factors)]
    pattern = np.asarray(fa.loadings_)
    structure = None if fa.structure_ is None else np.asarray(fa.structure_)
    # factor_analyzer sums the squared pattern loadings, which is wrong for oblique rotations;
    # there the communality is diag(P Phi P') = rowsum(P * S), the same as without rotation.
    communalities = (pattern * structure).sum(axis=1) if structure is not None else (pattern ** 2).sum(axis=1)
    ss = (pattern ** 2).sum(axis=0)
    proportion = cumulative = None
    correlations = None
    if structure is None:
        proportion = ss / p
        cumulative = np.cumsum(proportion)
    else:
        # fa.phi_ is not reordered with the factors; S = P Phi gives it in their order.
        phi = np.linalg.lstsq(pattern, structure, rcond=None)[0]
        correlations = [[float(v) for v in row] for row in (phi + phi.T) / 2]
    return FactorFit(
        loadings=pd.DataFrame(pattern, index=list(data.columns), columns=columns),
        communalities=dict(zip(data.columns, map(float, communalities))),
        uniquenesses=dict(zip(data.columns, map(float, 1 - communalities))),
        ss_loadings=[float(v) for v in ss],
        proportion=None if proportion is None else [float(v) for v in proportion],
        cumulative=None if cumulative is None else [float(v) for v in cumulative],
        explained=float(communalities.sum() / p),
        rotation=used_rotation,
        structure=None if structure is None else pd.DataFrame(structure, index=list(data.columns), columns=columns),
        factor_correlations=correlations,
        notes=notes,
    )


def _factor_count_error(n_factors: int, p: int) -> AnalysisError:
    return AnalysisError(
        f"{n_factors} factors requested, but with {p} measures at most {max_factors(p)} are possible; "
        "a further factor would stay empty.",
        "n_factors_range",
        requested=n_factors,
        measures=p,
        max=max_factors(p),
    )


def assign_factors(
    loadings: pd.DataFrame,
    threshold: float,
    communalities: dict[str, float] | None = None,
    communality_threshold: float = 0.0,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Put each measure on the factor with its largest absolute loading, if that reaches the
    threshold and its communality reaches ``communality_threshold``. Within a factor, measures
    are sorted by absolute loading, largest first. ``index`` counts the factors from 0."""
    groups: list[list[tuple[str, float]]] = [[] for _ in loadings.columns]
    unassigned: list[str] = []
    for measure, row in loadings.iterrows():
        values = row.to_numpy()
        best = int(np.argmax(np.abs(values)))
        weak = communalities is not None and communalities[str(measure)] < communality_threshold
        if abs(values[best]) >= threshold and not weak:
            groups[best].append((str(measure), float(values[best])))
        else:
            unassigned.append(str(measure))
    factors = [
        {
            "index": i,
            "measures": [
                {"measure": m, "loading": v} for m, v in sorted(g, key=lambda mv: -abs(mv[1]))
            ],
        }
        for i, g in enumerate(groups)
    ]
    return factors, unassigned


# --- the whole analysis -------------------------------------------------------------------


@dataclass
class AnalysisParams:
    excluded: list[str] = field(default_factory=list)
    auto_msa_filter: bool = True
    msa_threshold: float = _C.msa_threshold
    bartlett_alpha: float = _C.bartlett_p_value_threshold
    n_factors: int | None = None
    rotation: str = "varimax"
    loading_threshold: float = LOADING_THRESHOLDS["model"]
    communality_threshold: float = COMMUNALITY_THRESHOLDS["model"]


def _finite(value: float) -> float | None:
    return value if math.isfinite(value) else None


class _Warnings:
    """English messages for API clients, plus a code and parameters for the UI to translate."""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []

    def add(self, code: str, message: str, **params: Any) -> None:
        self.items.append({"code": code, "message": message, "params": params})


def check_excluded(measures: list[str], excluded: list[str]) -> None:
    """Every measure to exclude must be one of the dataset."""
    unknown = [c for c in excluded if c not in measures]
    if unknown:
        raise AnalysisError(
            f"Unknown measure(s) to exclude: {', '.join(unknown[:5])}.",
            "unknown_excluded",
            measures=", ".join(unknown[:5]),
        )


def analyze(data: pd.DataFrame, params: AnalysisParams) -> dict[str, Any]:
    """Run all steps on a cleaned matrix and return the result as plain JSON values.

    Bartlett's test runs on the measures before the MSA filter, as in ComFy; the KMO values
    and everything after describe the measures that are left. A singular correlation matrix
    is analysed like ComFy for log measures does (clamped eigenvalues, pseudo-inverse in the
    MSA) and reported as a warning; it is an error only if the factor analysis then fails.
    """
    check_excluded(list(data.columns), params.excluded)
    data = data.drop(columns=list(params.excluded))
    n, p = data.shape
    if p < MIN_MEASURES:
        raise AnalysisError(
            f"At least {MIN_MEASURES} measures are needed for a factor analysis; {p} are left.",
            "too_few_measures",
            min=MIN_MEASURES,
            left=p,
        )
    if n < p + 1:
        raise AnalysisError(
            f"{n} observations are too few for {p} measures; at least {p + 1} are needed. "
            "Exclude measures or add observations.",
            "too_few_observations",
            n=n,
            measures=p,
            needed=p + 1,
        )
    out = _Warnings()
    bartlett = bartlett_sphericity(data)
    bartlett_passed = bartlett["p_value"] < params.bartlett_alpha
    if not bartlett_passed:
        out.add(
            "bartlett_not_significant",
            f"Bartlett's test is not significant (p = {bartlett['p_value']:.3g} ≥ "
            f"{params.bartlett_alpha}); the measures may be uncorrelated.",
            p=f"{bartlett['p_value']:.3g}",
            alpha=params.bartlett_alpha,
        )
    if params.auto_msa_filter:
        filtered = msa_filter(data, params.msa_threshold)
        data = filtered.data
        per_measure, overall, removed = filtered.per_measure, filtered.overall, filtered.removed
        if data.shape[1] < MIN_MEASURES:
            raise AnalysisError(
                f"The MSA filter left {data.shape[1]} measure(s); at least {MIN_MEASURES} are "
                "needed. Turn the filter off or lower the MSA threshold.",
                "msa_filter_left",
                left=data.shape[1],
                min=MIN_MEASURES,
            )
    else:
        per_measure, overall = kmo(data)
        removed = []
    dependent = singular_measures(data)
    if dependent:
        groups = "; ".join(", ".join(g) for g in dependent)
        out.add(
            "singular",
            "The correlation matrix is singular; these measures are linearly dependent: "
            f"{groups}. Results rely on clamped eigenvalues and pseudo-inverses; consider "
            "excluding one measure of each group.",
            groups=groups,
        )
    kmo_passed = overall >= params.msa_threshold
    if not kmo_passed:
        out.add(
            "kmo_low",
            f"The overall MSA {overall:.3f} is below {params.msa_threshold}; "
            "a factor analysis is not recommended.",
            overall=f"{overall:.3f}",
            threshold=params.msa_threshold,
        )

    n, p = data.shape
    if n < 5 * p:
        out.add(
            "small_sample",
            f"{n} observations for {p} measures; at least 5 per measure ({5 * p}) are recommended.",
            n=n,
            measures=p,
            recommended=5 * p,
        )

    values = eigenvalues(data)
    suggested = min(kaiser_criterion(values), max_factors(p))
    n_factors = suggested if params.n_factors is None else int(params.n_factors)
    if n_factors < 1 or n_factors > max_factors(p):
        raise _factor_count_error(n_factors, p)
    if (p - n_factors) ** 2 < p + n_factors:
        out.add(
            "not_identified",
            f"{n_factors} factors for {p} measures exceed the Ledermann bound; the solution is "
            "not identified and the loadings are not unique. Use fewer factors.",
            factors=n_factors,
            measures=p,
        )

    fit = fit_factors(data, n_factors, params.rotation)
    for note in fit.notes:
        out.add("fit_not_converged", f"The factor fit: {note}", message=note)
    if fit.rotation != params.rotation:
        out.add("single_factor_no_rotation", "No rotation is applied to a single factor.")
    heywood = [m for m, c in fit.communalities.items() if c >= HEYWOOD_COMMUNALITY]
    if heywood:
        names = ", ".join(heywood)
        out.add(
            "heywood",
            f"Communality at the bound of the fit (uniqueness at most {FactorAnalyzer().bounds[0]}) "
            f"for {names}; possible Heywood case.",
            measures=names,
        )

    factors, unassigned = assign_factors(
        fit.loadings, params.loading_threshold, fit.communalities, params.communality_threshold
    )

    def by_measure(frame: pd.DataFrame) -> dict[str, list[float]]:
        return {m: [float(v) for v in row] for m, row in zip(frame.index, frame.to_numpy())}

    return {
        "n_observations": int(n),
        "used_measures": list(data.columns),
        "bartlett": {
            "chi_square": _finite(bartlett["chi_square"]),
            "df": int(bartlett["df"]),
            "p_value": bartlett["p_value"],
            "alpha": params.bartlett_alpha,
            "passed": bool(bartlett_passed),
            "regularised": bartlett["clamped"] > 0,
        },
        "kmo": {
            "overall": overall,
            "per_measure": per_measure,
            "threshold": params.msa_threshold,
            "passed": bool(kmo_passed),
        },
        "msa_filter": {"enabled": params.auto_msa_filter, "removed": removed},
        "eigenvalues": values,
        "suggested_n_factors": suggested,
        "n_factors": n_factors,
        "rotation": fit.rotation,
        "loading_threshold": params.loading_threshold,
        "communality_threshold": params.communality_threshold,
        "loadings": by_measure(fit.loadings),
        "structure_loadings": None if fit.structure is None else by_measure(fit.structure),
        "factor_correlations": fit.factor_correlations,
        "communalities": fit.communalities,
        "uniquenesses": fit.uniquenesses,
        "variance": {
            "ss_loadings": fit.ss_loadings,
            "proportion": fit.proportion,
            "cumulative": fit.cumulative,
            "explained": fit.explained,
        },
        "factors": factors,
        "unassigned": unassigned,
        "warnings": [w["message"] for w in out.items],
        "warning_details": out.items,
    }
