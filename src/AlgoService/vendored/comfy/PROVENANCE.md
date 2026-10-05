# Provenance of `vendored/comfy`

- **Origin:** https://github.com/Pati-nets/ComFy, commit `1dd6ea6` (2026-04-14).
- **Author:** Patrizia Schalk.
- **Licence:** the ComFy repository has no licence file. Permission from the
  author to publish this copy is still pending. Related measure code is MIT
  licensed in https://github.com/Pati-nets/Complexity-Toolkit, but it is not
  the same code (different entry points, and some definitions differ, e.g.
  Depth).
- The rest of `prom4py/` (`client/`, `model/`, `objects/`, `conformance.py`,
  `util.py`) is the ProM4Py Python client that ComFy's README asks users to
  copy in from the ProM4Py distribution (Zenodo record 13853660). The exact
  version of that copy is not recorded.

## Not copied

- `main.py` and `LatexExporter.py` (command-line front end and LaTeX report).
- `ComplexityCollector.py` (collects measures over a folder of logs; the
  service runs logs through its batch mode instead).
- `logcomplexity/LogComplexityMeasures.py` and `logcomplexity/MoreLogComplexity.py`
  (log measures built on `logcomplexity/Complexity.py`, which upstream ships
  only as a placeholder).
- `requirements.txt`, `input-logs/`, `output/`, `images/`.

## Local modifications

1. **Relative imports.** Internal imports such as `import Constants` or
   `from discovery import ...` were turned into package-relative imports
   (`from .. import Constants`, `from . import ...`) so the tree can be
   imported as `vendored.comfy`. Affects `FactorAnalysis.py`,
   `discovery/DiscoveryAlgorithms.py`, `discovery/DirectlyFollowsGraph.py`,
   `discovery/DirectlyFollowsMiner.py`, `modelcomplexity/ModelComplexityMeasures.py`,
   `prom4py/__init__.py` and `prom4py/discovery.py`.
2. **Shared ProM4Py client.** `_shared_prom4py.py` is new. The ProM-based
   miners in `discovery/DiscoveryAlgorithms.py` call `get_shared_prom4py()`
   instead of starting their own ProM4Py process on port 8000; the client
   connects to the running ProM4Py service at `PROM4PY_URL`.
3. **Depth and Diameter.** In `modelcomplexity/ModelComplexityMeasures.py`,
   `Depth.calculate_for` and `Diameter.calculate_for` had their `return`
   indented under the `if` that raises for missing markings, so they returned
   `None` whenever markings were given. The `return` is now at method level.
   Covered by `tests/test_comfy.py`.
4. Empty `__init__.py` files added to make the directories packages.
