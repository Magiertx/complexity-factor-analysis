# Vendored research code

This directory holds research code that the adapters in
`src/AlgoService/algorithms/` import. Changes to it are kept to the minimum
needed to run it inside the service, and every change is listed in the
`PROVENANCE.md` of the respective tree, so that it can be re-synced with
upstream.

## comfy/

ComFy by Patrizia Schalk: complexity measures for Petri nets discovered from
event logs, plus a factor analysis over them. Origin and local changes:
[`comfy/PROVENANCE.md`](comfy/PROVENANCE.md).

```
comfy/
├─ Constants.py
├─ FactorAnalysis.py         unused; reimplemented in factor_analysis/core.py
├─ _shared_prom4py.py        one ProM4Py client per process (local addition)
├─ discovery/                miners; all analysed ones run inside ProM4Py
├─ logcomplexity/
│  └─ Complexity.py          upstream placeholder, see PROVENANCE.md
├─ modelcomplexity/          the model complexity measures
└─ prom4py/                  Python client of the ProM4Py Java service
```

Adapter mapping: `algorithms/comfy.py` uses `discovery/DiscoveryAlgorithms.py`
and `modelcomplexity/ModelComplexityMeasures.py`; the factor analysis
(`factor_analysis/`) reuses that adapter for discovery and measures.

## comfy_log/

ComFy for log measures by Patrizia Schalk (MIT): the factor analysis over event-log
measures computed with feeed. Only `Constants.py` is copied, for the thresholds and the
feature groups; the numerics of its `FactorAnalysis.py` are reimplemented in
`factor_analysis/core.py`. Origin and details:
[`comfy_log/PROVENANCE.md`](comfy_log/PROVENANCE.md).
