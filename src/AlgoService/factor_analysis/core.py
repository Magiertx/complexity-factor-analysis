"""Numerics of the factor analysis.

The steps follow ComFy (https://github.com/Pati-nets/ComFy, ``FactorAnalysis.py``) and
ComFy for log measures (https://github.com/Pati-nets/ComFy-for-Log-Measures,
``FactorAnalysis.py``, MIT), both by Patrizia Schalk:

- data cleaning as in ``prepare_data_for_factor_analysis`` of the log version,
- Bartlett's test with the eigenvalue-based log-determinant of the log version,
- the MSA filter of ``repeat_calculate_measure_of_sampling_adequacy``, with the MSA taken
  from the correlation matrix rather than factor_analyzer's covariance matrix (``kmo``; the
  same on regular data, unlike it independent of units and platform on singular data),
- a ``FactorAnalyzer`` fit with factor_analyzer's defaults (minres, SMC start values).

Thresholds come from the vendored log-side ``Constants.py``.
"""

from __future__ import annotations

import hashlib
import inspect
import math
import threading
import time
import warnings
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
import pandas as pd
import factor_analyzer.factor_analyzer as _fa_module
from factor_analyzer.factor_analyzer import FactorAnalyzer
from factor_analyzer.utils import corr as _corr
from scipy.stats import chi2
from sklearn.utils import check_array as _sklearn_check_array

from vendored.comfy_log import Constants as _C

from .short_set import representatives

MIN_MEASURES = 3
#: More measures than this make a single analysis too heavy for a shared server: each round
#: of the MSA filter inverts a p × p matrix, and minres optimises p uniquenesses with a
#: numerical gradient, one p × p eigendecomposition per uniqueness and step.
MAX_MEASURES = 400
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


@dataclass(frozen=True)
class AssignmentRule:
    """How measures are assigned to factors once the loadings are known.

    A loading counts for a factor if its absolute value reaches the loading threshold, or
    exceeds it if ``strict``. A measure is cross-loaded if more than one of its loadings
    counts and lies at most ``CROSS_LOADING_GAP`` below its largest one.
    """

    #: Measures with a lower communality stay unassigned, whatever communality_threshold says.
    min_communality: float
    strict: bool
    #: What a cross-loaded measure gets: "largest" the factor of its largest loading only,
    #: "all" every factor of the cross-loading, "none" no factor.
    cross_loaded: str


#: Loadings at most this far below a measure's largest one count as well (multi) or make it
#: cross-loaded (hair); Important Factors, ATAED 2026, section 5.3.
CROSS_LOADING_GAP = 0.15

ASSIGNMENT_RULES = {
    # The tool's default: the largest absolute loading, if it reaches the threshold (ComFy's report only greys loadings below it).
    "largest": AssignmentRule(min_communality=0.0, strict=False, cross_loaded="largest"),
    # Important Factors, Tab. 6-16, after Lieben et al.: |loading| > 0.35 and communality
    # >= 0.3, a cross-loaded measure belongs to every factor of its cross-loading.
    "multi": AssignmentRule(min_communality=0.3, strict=True, cross_loaded="all"),
    # Important Factors, Tab. 17 (justified there with Hair et al.): communality >= 0.5, cross-loaded measures
    # are left out.
    "hair": AssignmentRule(min_communality=0.5, strict=True, cross_loaded="none"),
}
DEFAULT_ASSIGNMENT_RULE = "largest"

#: Horn's parallel analysis: the eigenvalues of the correlation matrices of this many samples
#: of standard normal data, at this percentile per rank (Glorfeld's variant of Horn), drawn
#: from a fixed seed so that every run suggests the same.
PARALLEL_ANALYSIS_SEED = 20261012
PARALLEL_ANALYSIS_SIMULATIONS = 100
PARALLEL_ANALYSIS_PERCENTILE = 95


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
# about 0.995 rather than 1. The cut stays at 0.9949 (decided for the demo): a lower one would
# flag solutions that are merely well explained, a higher one would miss the bounded case.
HEYWOOD_COMMUNALITY = 1 - FactorAnalyzer().bounds[0] - 1e-4


class AnalysisError(ValueError):
    """The data cannot be analysed with the given settings; the message says why.

    ``code`` and ``params`` let the UI show the message in its own language.
    """

    def __init__(self, message: str, code: str = "analysis_failed", **params: Any) -> None:
        super().__init__(message)
        self.code = code
        self.params = params


class Superseded(Exception):
    """The analysis was given up because nobody waits for its result any more."""


#: Asked between the steps of an analysis and before every evaluation of the minres
#: objective; True gives the analysis up with ``Superseded``.
StopCheck = Callable[[], bool]


def _check_stop(should_stop: StopCheck | None) -> None:
    if should_stop is not None and should_stop():
        raise Superseded()


@dataclass
class _Flight:
    """A computation in progress, which callers asking for the same result wait for instead
    of running it again."""

    #: The stop checks of everybody waiting for it; None for a caller that always wants it.
    wanted: list[StopCheck | None]
    done: threading.Event = field(default_factory=threading.Event)
    value: Any = None
    error: BaseException | None = None

    def stale(self) -> bool:
        """Given up only once nobody wants it any more."""
        return all(check is not None and check() for check in self.wanted)


#: How often a caller waiting for somebody else's computation asks whether it is still wanted.
_FLIGHT_POLL_S = 0.05


def _computed_once(
    key: Any,
    cache: OrderedDict,
    lock: threading.Lock,
    in_flight: dict,
    size: int,
    compute: Callable[[StopCheck], Any],
    should_stop: StopCheck | None,
) -> Any:
    """``cache[key]``, else ``compute(stale)``, run once for all callers that ask for the same
    key while it runs. The most recently used ``size`` results are kept.

    It runs in a thread of its own, which every caller waits for, the first one included:
    ``should_stop`` gives a caller up with ``Superseded`` within ``_FLIGHT_POLL_S``, so an
    analysis nobody waits for any more frees its slot at once even while the computation goes
    on for somebody else. The computation gets ``stale`` as its stop check: it is given up only
    when every caller waiting for it is, and then nothing is cached."""
    while True:
        with lock:
            if key in cache:
                cache.move_to_end(key)
                return cache[key]
            flight = in_flight.get(key)
            if flight is None:
                flight = in_flight[key] = _Flight(wanted=[should_stop])
                threading.Thread(
                    target=_fly, args=(key, flight, cache, lock, in_flight, size, compute), daemon=True
                ).start()
            else:
                flight.wanted.append(should_stop)
        while not flight.done.wait(_FLIGHT_POLL_S):
            _check_stop(should_stop)
        if flight.error is None:
            return flight.value
        if not isinstance(flight.error, Superseded):
            raise flight.error
        # Given up just before this caller asked for it; it starts the computation again.
        _check_stop(should_stop)


def _fly(
    key: Any,
    flight: _Flight,
    cache: OrderedDict,
    lock: threading.Lock,
    in_flight: dict,
    size: int,
    compute: Callable[[StopCheck], Any],
) -> None:
    """The thread of a computation of ``_computed_once``; its callers get the value or the
    error from ``flight``."""
    try:
        flight.value = compute(flight.stale)
    except BaseException as e:
        flight.error = e
    with lock:
        if flight.error is None:
            cache[key] = flight.value
            if len(cache) > size:
                cache.popitem(last=False)
        del in_flight[key]
    flight.done.set()


# --- cleaning ----------------------------------------------------------------------------


@dataclass
class CleanResult:
    """What ``clean_matrix`` leaves: the numeric matrix, the measures it dropped with the reason
    for each, and how many rows it dropped."""

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
    kept). Infinite values count as missing; a measure dropped for them mostly is dropped as
    ``non_finite``.
    """
    dropped: list[dict[str, Any]] = []
    numeric: dict[str, np.ndarray] = {}
    infinite: dict[str, np.ndarray] = {}

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
        floats = converted.astype(float)
        infinite[str(column)] = np.isinf(floats.to_numpy())
        numeric[str(column)] = floats.replace([np.inf, -np.inf], np.nan).to_numpy()

    data = pd.DataFrame(numeric, index=[str(i) for i in raw.index], dtype=float)
    infinite_rows = pd.DataFrame(infinite, index=data.index)
    before = len(data)
    empty_rows: list[str] = []
    if data.shape[1]:
        empty = (data.isna().mean(axis=1) > MAX_ROW_MISSING_SHARE).to_numpy()
        empty_rows = [str(i) for i in data.index[empty]]
        data = data[~empty]
        infinite_rows = infinite_rows[~empty]

    for column in list(data.columns):
        n_missing = int(data[column].isna().sum())
        if len(data) and n_missing / len(data) > max_missing_share:
            n_infinite = int(infinite_rows[column].sum())
            # Mostly infinite values (inf, -inf) are not "missing": say what they are.
            reason = "non_finite" if 2 * n_infinite > n_missing else "missing"
            dropped.append({
                "measure": column,
                "reason": reason,
                "detail": (
                    f"{n_infinite} of {len(data)} values not finite"
                    if reason == "non_finite"
                    else f"{n_missing} of {len(data)} values missing"
                ),
                "params": (
                    {"infinite": n_infinite, "total": len(data)}
                    if reason == "non_finite"
                    else {"missing": n_missing, "total": len(data)}
                ),
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
    """The correlation matrix of the measures (the columns of ``data``) as an array."""
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
    """Kaiser-Meyer-Olkin measure of sampling adequacy, per measure and overall.

    The formula of factor_analyzer's ``calculate_kmo``, with the partial correlations taken
    from the inverse of the correlation matrix instead of the covariance matrix. Both give the
    same on regular data (the seven ComFy reports agree to 1e-11). On singular data
    factor_analyzer falls back to ``pinv(cov)`` with a cutoff relative to the largest
    variance, which also drops genuine directions of measures on a small scale and leaves the
    MSA to rounding: it changes with the units, the column order and the platform. Here the
    eigenvalues of the correlation matrix below ``Constants.eigenvalue_floor`` count as zero,
    the same ones Bartlett's test clamps and ``singular_measures`` reports.
    """
    correlations = correlation_matrix(data)
    values, vectors = np.linalg.eigh(correlations)
    kept = values >= _C.eigenvalue_floor
    inverse = (vectors[:, kept] / values[kept]) @ vectors[:, kept].T
    with np.errstate(divide="ignore", invalid="ignore"):
        scale = np.sqrt(np.diag(inverse))
        partial = -inverse / np.outer(scale, scale)
    np.fill_diagonal(partial, 0.0)
    np.fill_diagonal(correlations, 0.0)
    r2, p2 = correlations ** 2, partial ** 2
    per_measure = r2.sum(axis=0) / (r2.sum(axis=0) + p2.sum(axis=0))
    overall = r2.sum() / (r2.sum() + p2.sum())
    if not np.all(np.isfinite(per_measure)) or not math.isfinite(overall):
        raise AnalysisError("The MSA could not be computed; the correlation matrix is singular.", "msa_singular")
    return {c: float(v) for c, v in zip(data.columns, per_measure)}, float(overall)


@dataclass
class MsaFilterResult:
    """What ``msa_filter`` leaves: the data without the removed measures, the MSA of each
    remaining measure, the overall MSA, and the removed measures."""

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


_RANDOM_EIGENVALUES: OrderedDict[tuple[int, int], list[float]] = OrderedDict()
_RANDOM_EIGENVALUES_SIZE = 64
_RANDOM_EIGENVALUES_LOCK = threading.Lock()
_RANDOM_IN_FLIGHT: dict[tuple[int, int], _Flight] = {}
#: How long the computation of each cached entry of _RANDOM_EIGENVALUES took, in seconds.
_RANDOM_SECONDS: dict[tuple[int, int], float] = {}


def random_eigenvalues(n: int, p: int, should_stop: StopCheck | None = None) -> list[float]:
    """The eigenvalues parallel analysis compares with, largest first: per rank, the
    ``PARALLEL_ANALYSIS_PERCENTILE``-th percentile over ``PARALLEL_ANALYSIS_SIMULATIONS``
    correlation matrices of n × p standard normal samples.

    They depend on n and p only, so they are cached per (n, p): the bundled log data take
    about half a second, and every analysis of a dataset has the same n and mostly the same p.
    An uploaded CSV of 100,000 rows takes a minute, so callers asking for the same (n, p) at
    the same time wait for one computation, and ``should_stop`` is asked between the samples
    like during a fit (``_computed_once``). The samples come from numpy's default generator
    with ``PARALLEL_ANALYSIS_SEED``, which draws the same samples on any platform with the same
    numpy version. The list is shared by the cache; callers copy it before changing it.
    """

    def compute(stop: StopCheck) -> list[float]:
        started = time.perf_counter()
        rng = np.random.default_rng(PARALLEL_ANALYSIS_SEED)
        samples = np.empty((PARALLEL_ANALYSIS_SIMULATIONS, p))
        for i in range(PARALLEL_ANALYSIS_SIMULATIONS):
            _check_stop(stop)
            # The same correlation as for the data, so that the comparison is like with like.
            samples[i] = np.linalg.eigvalsh(_corr(rng.standard_normal((n, p))))[::-1]
        out = [float(v) for v in np.percentile(samples, PARALLEL_ANALYSIS_PERCENTILE, axis=0)]
        with _RANDOM_EIGENVALUES_LOCK:
            if len(_RANDOM_SECONDS) > 4 * _RANDOM_EIGENVALUES_SIZE:
                _RANDOM_SECONDS.clear()
            _RANDOM_SECONDS[(int(n), int(p))] = time.perf_counter() - started
        return out

    return _computed_once(
        (int(n), int(p)),
        _RANDOM_EIGENVALUES,
        _RANDOM_EIGENVALUES_LOCK,
        _RANDOM_IN_FLIGHT,
        _RANDOM_EIGENVALUES_SIZE,
        compute,
        should_stop,
    )


def parallel_analysis(values: list[float], random: list[float]) -> int:
    """Horn's criterion: the number of leading eigenvalues of the data above those of random
    data of the same size, at least 1 like the Kaiser criterion."""
    count = 0
    for observed, reference in zip(values, random):
        if observed <= reference:
            break
        count += 1
    return max(1, count)


# --- factor analysis ----------------------------------------------------------------------


@dataclass
class FactorFit:
    """A fitted factor model: loadings, communalities and uniquenesses, the variance the
    factors explain, and for oblique rotations the structure matrix and factor correlations."""

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
    #: False when an analyzer that reports it (the bootstrap's) stopped without converging.
    converged: bool = True
    #: How long the fit took when it was computed; a fit from the cache keeps this time.
    seconds: float = 0.0


_FIT_CACHE: OrderedDict[tuple, FactorFit] = OrderedDict()
# Room for the analyses precomputed for the bundled datasets (precompute.py: up to 16) and for
# what visitors fit meanwhile; a fit is a few small matrices.
_FIT_CACHE_SIZE = 64
_FIT_CACHE_LOCK = threading.Lock()


def _fit_key(data: pd.DataFrame, n_factors: int, rotation: str) -> tuple:
    digest = hashlib.sha1(np.ascontiguousarray(data.to_numpy(dtype=float)).tobytes())
    digest.update(repr(list(data.columns)).encode())
    return digest.hexdigest(), n_factors, rotation


_IN_FLIGHT: dict[tuple, _Flight] = {}


def _fit_cached(data: pd.DataFrame, n_factors: int, rotation: str) -> bool:
    """Whether ``fit_factors`` has this fit at hand, for the timings of an analysis."""
    key = _fit_key(data, n_factors, rotation)
    with _FIT_CACHE_LOCK:
        return key in _FIT_CACHE


def fit_factors(
    data: pd.DataFrame, n_factors: int, rotation: str = "varimax", should_stop: StopCheck | None = None
) -> FactorFit:
    """``FactorAnalyzer`` with its defaults. The minres fit takes seconds for a hundred
    measures, so recent fits are cached; a new loading threshold does not refit.

    A caller asking for a fit that is already running waits for it: the same analysis asked
    for twice, e.g. by a double click or by two people opening the same bundled dataset, costs
    one fit. ``should_stop`` gives the caller up with ``Superseded``; the fit itself is given
    up only when every caller waiting for it is, and then it is not cached."""
    return _computed_once(
        _fit_key(data, n_factors, rotation),
        _FIT_CACHE,
        _FIT_CACHE_LOCK,
        _IN_FLIGHT,
        _FIT_CACHE_SIZE,
        lambda stop: _fit_factors(data, n_factors, rotation, stop),
        should_stop,
    )


def max_factors(p: int) -> int:
    """With p measures, a p-th factor would carry no variance; at most p - 1 are fitted."""
    return p - 1


class _StoppableFactorAnalyzer(FactorAnalyzer):
    """``FactorAnalyzer`` that asks ``should_stop`` before each evaluation of the minres
    objective. The optimiser evaluates it p + 1 times per step for its numerical gradient, so
    a fit of a hundred measures stops within milliseconds instead of running on for seconds.
    The objective itself is factor_analyzer's, so the loadings are the same to the last bit."""

    should_stop: StopCheck | None = None

    def _fit_uls_objective(self, psi, corr_mtx, n_factors):  # type: ignore[override]
        _check_stop(self.should_stop)
        return FactorAnalyzer._fit_uls_objective(psi, corr_mtx, n_factors)


def _fit_factors(
    data: pd.DataFrame,
    n_factors: int,
    rotation: str,
    should_stop: StopCheck | None = None,
    analyzer: type[_StoppableFactorAnalyzer] | None = None,
) -> FactorFit:
    """The fit of ``fit_factors``, uncached; ``analyzer`` replaces ``_StoppableFactorAnalyzer``,
    e.g. by one with the gradient of the objective for the many fits of a bootstrap."""
    started = time.perf_counter()
    if rotation not in ROTATIONS:
        raise AnalysisError(f"Unknown rotation '{rotation}'.", "unknown_rotation", rotation=rotation)
    p = data.shape[1]
    if n_factors < 1 or n_factors > max_factors(p):
        raise _factor_count_error(n_factors, p)
    # factor_analyzer skips the rotation for a single factor; say so in the result.
    used_rotation = "none" if rotation == "none" or n_factors == 1 else rotation

    fa = (analyzer or _StoppableFactorAnalyzer)(
        n_factors=n_factors, rotation=None if used_rotation == "none" else used_rotation
    )
    fa.should_stop = should_stop
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
        converged=bool(getattr(fa, "converged", True)),
        seconds=time.perf_counter() - started,
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


@dataclass
class Assignment:
    """The result of ``assign``: the measures of each factor, the unassigned measures with
    their reason, and the cross-loadings."""

    #: Per factor, ``index`` counting from 0 and its ``measures`` with their loadings, largest
    #: absolute loading first; a measure can be in several factors under "multi".
    factors: list[dict[str, Any]]
    #: Measures in no factor, in the order of the loadings, each with the ``reason``:
    #: low_communality, low_loading or cross_loading.
    unassigned: list[dict[str, str]]
    #: Measures with more than one loading within CROSS_LOADING_GAP of their largest, with the
    #: factors and loadings of the cross-loading, largest absolute loading first.
    cross_loadings: list[dict[str, Any]]
    #: The communality a measure needs: communality_threshold, or the rule's minimum if higher.
    communality_threshold: float


#: Absolute differences of loadings this small count as equal; keeps a gap of exactly 0.15
#: from turning on the last bit.
_GAP_TOLERANCE = 1e-12


def assign(
    loadings: pd.DataFrame,
    threshold: float,
    communalities: dict[str, float] | None = None,
    communality_threshold: float = 0.0,
    rule: str = DEFAULT_ASSIGNMENT_RULE,
) -> Assignment:
    """Assign each measure to factors by ``rule`` (``ASSIGNMENT_RULES``).

    A measure is checked in this order: communality (``communality_threshold`` or the rule's
    minimum, whichever is higher), then its largest absolute loading against ``threshold``,
    then cross-loadings. Cross-loadings are reported under every rule, so that a client can
    show them; only "multi" and "hair" act on them.
    """
    _check_rule(rule)
    spec = ASSIGNMENT_RULES[rule]
    min_communality = max(communality_threshold, spec.min_communality)

    def counts(value: float) -> bool:
        return value > threshold if spec.strict else value >= threshold

    groups: list[list[tuple[str, float]]] = [[] for _ in loadings.columns]
    unassigned: list[dict[str, str]] = []
    cross_loadings: list[dict[str, Any]] = []
    for measure, row in loadings.iterrows():
        measure = str(measure)
        values = row.to_numpy(dtype=float)
        absolute = np.abs(values)
        largest = float(absolute.max())
        if communalities is not None and communalities[measure] < min_communality:
            unassigned.append({"measure": measure, "reason": "low_communality"})
            continue
        if not counts(largest):
            unassigned.append({"measure": measure, "reason": "low_loading"})
            continue
        # Largest first; a stable sort keeps the lower factor first among equal loadings.
        gap = CROSS_LOADING_GAP + _GAP_TOLERANCE
        close = sorted(
            (j for j in range(len(values)) if counts(absolute[j]) and largest - absolute[j] <= gap),
            key=lambda j: -absolute[j],
        )
        if len(close) > 1:
            cross_loadings.append({
                "measure": measure,
                "factors": close,
                "loadings": [float(values[j]) for j in close],
            })
            if spec.cross_loaded == "none":
                unassigned.append({"measure": measure, "reason": "cross_loading"})
                continue
        for j in close if spec.cross_loaded == "all" else close[:1]:
            groups[j].append((measure, float(values[j])))
    factors = [
        {
            "index": i,
            "measures": [
                {"measure": m, "loading": v} for m, v in sorted(g, key=lambda mv: -abs(mv[1]))
            ],
        }
        for i, g in enumerate(groups)
    ]
    return Assignment(
        factors=factors,
        unassigned=unassigned,
        cross_loadings=cross_loadings,
        communality_threshold=min_communality,
    )


# --- the whole analysis -------------------------------------------------------------------


@dataclass
class AnalysisParams:
    """The settings of one analysis: measures to exclude, the MSA filter, Bartlett's alpha, the
    factor count (None for the criterion's choice), the rotation, and the assignment thresholds
    and rule."""

    excluded: list[str] = field(default_factory=list)
    auto_msa_filter: bool = True
    msa_threshold: float = _C.msa_threshold
    bartlett_alpha: float = _C.bartlett_p_value_threshold
    n_factors: int | None = None
    rotation: str = "varimax"
    loading_threshold: float = LOADING_THRESHOLDS["model"]
    communality_threshold: float = COMMUNALITY_THRESHOLDS["model"]
    assignment_rule: str = DEFAULT_ASSIGNMENT_RULE


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


def _check_size(n: int, p: int) -> None:
    """Enough measures for a factor analysis but not too many, and more observations than
    measures."""
    if p < MIN_MEASURES:
        raise AnalysisError(
            f"At least {MIN_MEASURES} measures are needed for a factor analysis; {p} are left.",
            "too_few_measures",
            min=MIN_MEASURES,
            left=p,
        )
    if p > MAX_MEASURES:
        raise AnalysisError(
            f"{p} measures are too many for one analysis; at most {MAX_MEASURES} are possible. "
            "Exclude measures.",
            "too_many_measures_for_analysis",
            max=MAX_MEASURES,
            n=p,
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


def _check_rule(rule: str) -> None:
    if rule not in ASSIGNMENT_RULES:
        raise AnalysisError(f"Unknown assignment rule '{rule}'.", "unknown_assignment_rule", rule=rule)


def check_params(measures: list[str], n_observations: int, params: AnalysisParams) -> None:
    """The checks of ``analyze`` that need no fit, with the same errors. The MSA filter can
    still leave too few measures, or too few for the factor count; only the analysis tells."""
    _check_rule(params.assignment_rule)
    check_excluded(measures, params.excluded)
    p = len(measures) - len(set(params.excluded))
    _check_size(n_observations, p)
    if params.n_factors is not None and not 1 <= params.n_factors <= max_factors(p):
        raise _factor_count_error(params.n_factors, p)


def analyze(data: pd.DataFrame, params: AnalysisParams, should_stop: StopCheck | None = None) -> dict[str, Any]:
    """Run all steps on a cleaned matrix and return the result as plain JSON values.

    Bartlett's test runs on the measures before the MSA filter, as in ComFy; the KMO values
    and everything after describe the measures that are left. A singular correlation matrix
    is analysed with its eigenvalues below ``Constants.eigenvalue_floor`` taken as zero
    (clamped in Bartlett's test, left out of the inverse in the MSA) and reported as a
    warning; it is an error only if the factor analysis then fails.

    The measures keep the order of ``data``, which callers take as stored: the results list
    them in this order, and the last bits of every number follow it, so nothing may sort the
    columns on the way here.

    ``should_stop`` is asked between the steps and during the fit; once it says True, the
    analysis is given up with ``Superseded``.
    """
    _check_stop(should_stop)
    started = time.perf_counter()
    _check_rule(params.assignment_rule)
    check_excluded(list(data.columns), params.excluded)
    data = data.drop(columns=list(params.excluded))
    n, p = data.shape
    _check_size(n, p)
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

    _check_stop(should_stop)
    suitability_s = time.perf_counter() - started
    values = eigenvalues(data)
    suggested = min(kaiser_criterion(values), max_factors(p))
    # On the matrix of the scree plot, so the two criteria can be drawn on the same axes.
    random_key = (int(n), int(p))
    with _RANDOM_EIGENVALUES_LOCK:
        random_cached = random_key in _RANDOM_EIGENVALUES
    random = list(random_eigenvalues(n, p, should_stop))
    by_parallel_analysis = min(parallel_analysis(values, random), max_factors(p))
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

    _check_stop(should_stop)
    fit_cached = _fit_cached(data, n_factors, params.rotation)
    fit = fit_factors(data, n_factors, params.rotation, should_stop)
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

    assignment = assign(
        fit.loadings,
        params.loading_threshold,
        fit.communalities,
        params.communality_threshold,
        params.assignment_rule,
    )
    rule = ASSIGNMENT_RULES[params.assignment_rule]

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
        "factor_count": {
            "kaiser": suggested,
            "parallel_analysis": by_parallel_analysis,
            "eigenvalues_random": random,
            "method": "pca",
            "seed": PARALLEL_ANALYSIS_SEED,
            "simulations": PARALLEL_ANALYSIS_SIMULATIONS,
            "percentile": PARALLEL_ANALYSIS_PERCENTILE,
        },
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
        "assignment_rule": params.assignment_rule,
        "assignment": {
            "rule": params.assignment_rule,
            "loading_threshold": params.loading_threshold,
            "loading_strict": rule.strict,
            "communality_threshold": assignment.communality_threshold,
            "cross_loading_gap": CROSS_LOADING_GAP,
            "cross_loaded": rule.cross_loaded,
        },
        "factors": assignment.factors,
        "unassigned": [u["measure"] for u in assignment.unassigned],
        "unassigned_details": assignment.unassigned,
        "cross_loadings": assignment.cross_loadings,
        # One representative measure per factor with measures (short_set.py).
        "short_set": representatives(by_measure(fit.loadings), assignment.factors),
        "warnings": [w["message"] for w in out.items],
        "warning_details": out.items,
        # Wall times in seconds. The fit and the random eigenvalues of parallel analysis are
        # cached; a cached one keeps the time its computation took and says so.
        "timings": {
            "suitability_s": round(suitability_s, 6),
            "parallel_analysis_s": round(_RANDOM_SECONDS.get(random_key, 0.0), 6),
            "parallel_analysis_cached": random_cached,
            "fit_s": round(fit.seconds, 6),
            "fit_cached": fit_cached,
            "total_s": round(time.perf_counter() - started, 6),
        },
    }
