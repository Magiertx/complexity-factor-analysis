"""Stability of a solution: does it come back on bootstrap samples of the rows?

The reference is the analysis on screen: its measures after the MSA filter, its factor count,
fit and rotation, and its assignment rule with its thresholds. Each of B samples draws the rows
with replacement from a fixed seed and is fitted with the same measures (no new MSA filter), the
same factor count and the same rotation. Its factors are matched to those of the reference by
Tucker's congruence coefficient phi with the Hungarian algorithm on |phi| (Kuhn 1955), a factor
with a negative phi is mirrored, and the assignment rule is applied to the aligned loadings.

Per measure, the share of samples that give it the same set of factors as the reference, and the
share that give it the same primary factor (its largest absolute loading). Per factor, the mean
and the 5th percentile of |phi|, read after Lorenzo-Seva and ten Berge (2006). Per pair of
measures, the share of samples in which they share a factor. A sample whose fit fails (a measure
without variance in it, a singular matrix, no convergence) is counted by its cause and left out
of the shares. A sample in which a further measure reaches the Heywood bound is kept, since the
reference is a bounded solution as well, and is counted apart.
"""

from __future__ import annotations

import time
from collections import Counter
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy.linalg import eigh
from scipy.optimize import linear_sum_assignment, minimize

from .core import (
    HEYWOOD_COMMUNALITY,
    PARALLEL_ANALYSIS_SEED,
    AnalysisError,
    AnalysisParams,
    StopCheck,
    _check_stop,
    _fit_factors,
    _smc,
    _StoppableFactorAnalyzer,
    assign,
)

#: The numbers of samples one can choose; 200 unless asked otherwise.
SAMPLE_COUNTS = (100, 200, 500)
DEFAULT_SAMPLES = 200
#: The seed of parallel analysis, so that the samples are the same on every run.
SEED = PARALLEL_ANALYSIS_SEED

#: Lorenzo-Seva and ten Berge (2006): from 0.95 two factors can be taken as equal, from 0.85 as
#: fairly similar, below that as not similar.
CONGRUENCE_EQUAL = 0.95
CONGRUENCE_FAIR = 0.85
#: The share of samples from which the summary counts a measure as stable.
STABLE_SHARE = 0.9

#: Why a sample is left out, in the order of the report.
FAILURES = ("constant", "singular", "fit_failed", "not_converged")

ProgressFn = Callable[[float, str], None]


class _GradientFactorAnalyzer(_StoppableFactorAnalyzer):
    """The minres fit of factor_analyzer (SMC start values, its bounds, L-BFGS-B, its
    normalisation) with the gradient of the objective given, so that a step costs one
    eigendecomposition instead of p + 1. The objective is the sum of the squared residuals,
    which is the sum of the squared eigenvalues of the reduced correlation matrix beyond the
    first k; its derivative by the uniqueness of measure j is -2 sum_i lambda_i v_ij^2 over
    those. The optimum is the same; the last digits may differ from the fit of the analysis,
    which keeps the numerical gradient. A bootstrap of the log dataset's 125 measures takes minutes, not an hour."""

    def _fit_factor_analysis(self, corr_mtx):  # type: ignore[override]
        """minres with the analytic gradient of the objective; stores ``converged`` and returns the normalised loadings, like factor_analyzer's own method."""
        k = self.n_factors
        start = (np.diag(corr_mtx) - _smc(corr_mtx).T).squeeze()
        bounds = [self.bounds for _ in range(corr_mtx.shape[0])]
        reduced = corr_mtx.copy()

        def objective(psi: np.ndarray) -> tuple[float, np.ndarray]:
            """The sum of the squared residual eigenvalues for the uniquenesses ``psi``, and its gradient."""
            _check_stop(self.should_stop)
            np.fill_diagonal(reduced, 1 - psi)
            values, vectors = eigh(reduced)
            # Ascending: all but the last k are the residual.
            rest, rest_vectors = values[:-k], vectors[:, :-k]
            return float(np.sum(rest ** 2)), -2 * (rest_vectors ** 2) @ rest

        result = minimize(objective, start, method="L-BFGS-B", jac=True, bounds=bounds, options={"maxiter": 1000})
        # Kept on the analyzer, not sent through the process-wide warnings, which the fits of
        # other threads share while the bootstrap runs.
        self.converged = bool(result.success)
        return self._normalize_uls(result.x, corr_mtx, k)


def congruence(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Tucker's phi of every column of ``a`` with every column of ``b`` (rows: measures):
    phi_ij = a_i . b_j / (|a_i| |b_j|); 0 where a column is all zero."""
    products = a.T @ b
    norms = np.outer(np.linalg.norm(a, axis=0), np.linalg.norm(b, axis=0))
    return np.divide(products, norms, out=np.zeros_like(products, dtype=float), where=norms > 0)


def align(sample: np.ndarray, reference: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The columns of ``sample`` in the order of the factors of ``reference`` they match, by the
    Hungarian algorithm on |phi|, each mirrored where its phi is negative; and |phi| per factor
    of the reference."""
    phi = congruence(reference, sample)
    rows, cols = linear_sum_assignment(-np.abs(phi))
    order = cols[np.argsort(rows)]
    matched = phi[np.arange(phi.shape[0]), order]
    signs = np.where(matched < 0, -1.0, 1.0)
    return sample[:, order] * signs, np.abs(matched)


def reading(phi: float | None) -> str | None:
    """Lorenzo-Seva and ten Berge's reading of a congruence: equal, fair or different."""
    if phi is None:
        return None
    if phi >= CONGRUENCE_EQUAL:
        return "equal"
    return "fair" if phi >= CONGRUENCE_FAIR else "different"


def _membership(factors: list[dict[str, Any]], measures: list[str], k: int) -> np.ndarray:
    """Which measure is on which factor, as a measures × factors matrix of booleans."""
    position = {m: i for i, m in enumerate(measures)}
    member = np.zeros((len(measures), k), dtype=bool)
    for factor in factors:
        for m in factor["measures"]:
            member[position[m["measure"]], factor["index"]] = True
    return member


def _failure(error: AnalysisError) -> str:
    """The cause of a failed sample as counted in the result: ``singular`` or ``fit_failed``."""
    # core._fit_factors says "not_converged" for loadings that are not finite, which a singular
    # correlation matrix gives.
    return "singular" if error.code == "not_converged" else "fit_failed"


def _share(count: np.ndarray | float, valid: int) -> Any:
    """``count`` as a share of ``valid`` samples, rounded to 6 places; ``None`` if no sample was valid."""
    if valid == 0:
        return None
    return np.round(np.asarray(count, dtype=float) / valid, 6)


def bootstrap(
    data: pd.DataFrame,
    params: AnalysisParams,
    reference: dict[str, Any],
    samples: int = DEFAULT_SAMPLES,
    seed: int = SEED,
    progress: ProgressFn | None = None,
    should_stop: StopCheck | None = None,
) -> dict[str, Any]:
    """The stability of ``reference`` (the result of ``core.analyze`` with ``params``) over
    ``samples`` bootstrap samples of the rows of ``data``, which must hold its used measures.

    ``progress`` is told the share done after every sample; ``should_stop`` is asked before
    every sample and during each fit, and gives up with ``Superseded``.
    """
    started = time.perf_counter()
    measures = list(reference["used_measures"])
    x = data[measures].to_numpy(dtype=float)
    n, p = x.shape
    k = int(reference["n_factors"])
    rotation = reference["rotation"]
    columns = [f"Factor {i + 1}" for i in range(k)]
    loadings = np.array([reference["loadings"][m] for m in measures], dtype=float)
    member = _membership(reference["factors"], measures, k)
    primary = np.argmax(np.abs(loadings), axis=1)
    bounded = {m for m, c in reference["communalities"].items() if c >= HEYWOOD_COMMUNALITY}

    rng = np.random.default_rng(seed)
    same = np.zeros(p)
    same_primary = np.zeros(p)
    together = np.zeros((p, p))
    phis: list[np.ndarray] = []
    failed: Counter[str] = Counter()
    heywood = 0
    for b in range(samples):
        _check_stop(should_stop)
        sample = x[rng.integers(0, n, size=n)]
        cause = None
        if np.any(np.ptp(sample, axis=0) == 0):
            # A measure without variance in the sample has no correlation.
            cause = "constant"
        else:
            try:
                fit = _fit_factors(
                    pd.DataFrame(sample, columns=measures), k, rotation, should_stop, _GradientFactorAnalyzer
                )
            except AnalysisError as e:
                cause = _failure(e)
            else:
                if not fit.converged:
                    cause = "not_converged"
                elif any(c >= HEYWOOD_COMMUNALITY and m not in bounded for m, c in fit.communalities.items()):
                    # A flag, not a failure: the reference is a bounded solution as well, so a
                    # sample that reaches the bound is as valid as the reference is.
                    heywood += 1
        if cause is None:
            aligned, phi = align(fit.loadings.to_numpy(dtype=float), loadings)
            assignment = assign(
                pd.DataFrame(aligned, index=measures, columns=columns),
                params.loading_threshold,
                fit.communalities,
                params.communality_threshold,
                params.assignment_rule,
            )
            got = _membership(assignment.factors, measures, k)
            same += np.all(got == member, axis=1)
            same_primary += np.argmax(np.abs(aligned), axis=1) == primary
            as_int = got.astype(float)
            together += (as_int @ as_int.T) > 0
            phis.append(phi)
        else:
            failed[cause] += 1
        if progress is not None:
            progress((b + 1) / samples * 100, f"Sample {b + 1} of {samples}")

    valid = len(phis)
    shares = _share(same, valid)
    primary_shares = _share(same_primary, valid)
    pairs = _share(together, valid)
    stacked = np.array(phis) if phis else np.empty((0, k))
    reference_pairs = (member.astype(float) @ member.astype(float).T) > 0
    stable = int(np.sum(shares >= STABLE_SHARE)) if shares is not None else 0
    return {
        "samples": int(samples),
        "seed": int(seed),
        "valid": valid,
        "failed": {cause: failed[cause] for cause in FAILURES if failed[cause]},
        # Valid samples in which a measure reaches the Heywood bound that is not at it in the
        # reference.
        "heywood": heywood,
        "measures": [
            {
                "measure": m,
                "factors": [int(j) for j in np.flatnonzero(member[i])],
                "primary_factor": int(primary[i]),
                "assignment": None if shares is None else float(shares[i]),
                "primary": None if primary_shares is None else float(primary_shares[i]),
            }
            for i, m in enumerate(measures)
        ],
        "factors": [
            {
                "index": j,
                "phi_mean": float(round(stacked[:, j].mean(), 6)) if valid else None,
                "phi_p5": float(round(np.percentile(stacked[:, j], 5), 6)) if valid else None,
                "reading": reading(float(stacked[:, j].mean())) if valid else None,
            }
            for j in range(k)
        ],
        # Shares of the samples in which two measures share a factor, as a matrix in the order of
        # ``measures``, and whether they share one in the reference.
        "pairs": {
            "measures": measures,
            "shares": None if pairs is None else [[float(v) for v in row] for row in pairs],
            "reference": [[bool(v) for v in row] for row in reference_pairs],
        },
        "summary": {"stable": stable, "measures": p, "threshold": STABLE_SHARE},
        "seconds": round(time.perf_counter() - started, 3),
    }
