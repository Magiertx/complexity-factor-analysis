# Tools

Catalogue of the tools exposed by the service. To add one, create an adapter under
`src/AlgoService/algorithms/`, register it in `algorithms/__init__.py`, and append an entry
here.

---

## Complexity

### ComFy — Petri-net complexity

- **ID**: `comfy`
- **Tool type**: `complexity`
- **Adapter**: `src/AlgoService/algorithms/comfy.py`
- **Vendored code**: `src/AlgoService/vendored/comfy/`, see its `PROVENANCE.md`
- **Backend dependency**: the `prom4py` container (Java ProM server, see `src/prom4py/`)
- **Repo**: <https://github.com/Pati-nets/ComFy>

Parameters:

| Name | Type | Notes |
|------|------|-------|
| `discovery_algorithms` | multi_enum | 9 miners, all run inside ProM: Directly Follows, Alpha, Alpha+, Alpha++, Alpha$, Alpha Robust, Inductive, Heuristics, Hybrid ILP. Default: the first one. |
| `complexity_measures`  | multi_enum | 17 measures (Size, Connector Mismatch, Density, …). Cross-Connectivity, Depth, Diameter and Cyclicity are slow and off by default. |

**Result artifacts**: 3× `stat` (miners, measures, cells computed), 1× `table` (one row per
miner, one column per measure), per miner an `image` of the discovered net and a 300 dpi PNG
download, and a `text` with per-cell errors if some computations failed. If no cell could be
computed at all (typically ProM4Py unreachable), the job fails instead of returning a table of
errors. A miner that takes longer than `PROM4PY_CALL_TIMEOUT` (default 300 s) on the log gets
`ERR: ProMTimeout` cells and the note "ProM took longer than 300 s for <miner> on <log>" (see
[`architecture.md`](architecture.md#bounded-prom-calls)).

**Scope**: one log per run, in the `/inspect` workbench. Many logs or nets go into a
factor-analysis dataset instead (`POST /factor-analysis/datasets`, see
[`architecture.md`](architecture.md#factor-analysis)), which reuses this adapter's discovery and
measure helpers. The numerics of the vendored `FactorAnalysis.py` are reimplemented in
`factor_analysis/core.py`.

---

## Factor analysis

### Stability of the solution (bootstrap)

- **Module**: `src/AlgoService/factor_analysis/stability.py`
- **Endpoint**: `POST /factor-analysis/datasets/{id}/stability`, a job `_stability:<kind>`

How robust is the assignment on screen? The reference is the current analysis: its measures
after the MSA filter, its factor count, the minres fit (Harman & Jones, 1966) and rotation, and the assignment rule with
its thresholds. B bootstrap samples (100, 200 or 500; 200 by default) draw the rows with
replacement from the seed of parallel analysis (20261012, kept in the manifest), so a run is
reproducible. Each sample is fitted with the same measures (no new MSA filter), the same factor
count and the same rotation. Its factors are matched to those of the reference by Tucker's
congruence coefficient φ with the Hungarian algorithm on |φ| (`scipy.optimize.linear_sum_assignment`),
a matched factor with a negative φ is mirrored, and the assignment rule is applied to the aligned
loadings.

Results:

| What | Value |
|------|-------|
| per measure | the share of valid samples in which its set of factors equals that of the reference, and in which its primary factor (largest absolute loading) is the same |
| per factor | mean and 5th percentile of \|φ\| with its match, read after Lorenzo-Seva and ten Berge (2006): from 0.95 "equal", from 0.85 "fairly similar", below "not similar" |
| per pair of measures | the share of samples in which the two share at least one factor |

A sample is left out and counted by its cause when a measure has no variance in it, its
correlation matrix is singular, or the fit fails or does not converge. A sample in which a
measure reaches the Heywood bound although it does not reach it in the reference is kept, since
the reference is a bounded solution as well, and is counted apart (`heywood` in the result). The
reference itself may have Heywood cases (the default Inductive solution has two, the published
four-factor one has one).

The samples are fitted with the objective, bounds, start values and normalisation of
factor_analyzer's minres (Harman & Jones, 1966), but with the analytic gradient of the objective, −2 Σ λᵢ vⱼᵢ² over the
eigenvalues beyond the first k; factor_analyzer differentiates numerically, at p + 1
eigendecompositions per step. On the full data both give the same loadings to 3 · 10⁻⁷. B = 200
takes about half a second on Important Factors: Inductive (10 measures, 2 factors) and about
100 s on the PDC log measures (123 measures, 15 factors).

The result is kept with the dataset under a key of its rows, settings, factor count, B and seed,
so it reopens at once; a change of any of them asks for a new one. The exports include it only
when their request names `stability_samples` and it was computed.

References: Efron & Tibshirani (1993), doi:10.1007/978-1-4899-4541-9; Zhang, Preacher & Luo
(2010), doi:10.1080/00273170903504836; Kuhn (1955), doi:10.1002/nav.3800020109; Lorenzo-Seva &
ten Berge (2006), doi:10.1027/1614-2241.2.2.57.

### Short set

- **Module**: `src/AlgoService/factor_analysis/short_set.py`, `short_set` in every analysis

One representative measure per dimension, for reporting fewer, non-redundant measures as
Important Factors motivates. For each factor of the current assignment, the representative is
the measure assigned to it with the highest purity: |loading on the factor| − max |loading on any
other factor|. Ties go to the higher absolute loading; a factor without an assigned measure gets
none. The rule is loading-based; a representative with a low stability should be read with care.
