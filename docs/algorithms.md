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
errors.

**Scope**: one log per run, in the `/inspect` workbench. Many logs or nets go into a
factor-analysis dataset instead (`POST /factor-analysis/datasets`, see
[`architecture.md`](architecture.md#factor-analysis)), which reuses this adapter's discovery and
measure helpers. The numerics of the vendored `FactorAnalysis.py` are reimplemented in
`factor_analysis/core.py`.
