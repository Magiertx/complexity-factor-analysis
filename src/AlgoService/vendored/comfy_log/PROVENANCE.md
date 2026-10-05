# Provenance of `vendored/comfy_log`

- **Origin:** https://github.com/Pati-nets/ComFy-for-Log-Measures, commit
  `70837cec7f3aff9580f52e78162b433e9e21f473` (2026-09-18).
- **Author:** Patrizia Schalk.
- **Licence:** MIT, see [`LICENSE`](LICENSE) (copied from the repository).

## Copied

- `Constants.py`, unchanged. The service reads the factor-analysis thresholds
  (`bartlett_p_value_threshold`, `msa_threshold`, `eigenvalue_floor`,
  `eigenvector_loading_coverage_threshold`, `number_of_decimals`) and the feature
  groups (`all_measures`), which name the feeed features per group.
- `LICENSE`.

## Reimplemented, not copied

`FactorAnalysis.py` prints its progress and calls matplotlib, so its numerics are
reimplemented in `factor_analysis/core.py` and credited there:

- data cleaning (`find_non_numeric_variables`, `find_variables_with_no_variance`,
  `find_perfectly_correlated_variables`), extended by dropping rows with missing
  values instead of the whole measure, unless most of its values are missing;
- Bartlett's test via the eigenvalues of the correlation matrix, clamped at
  `eigenvalue_floor`;
- the MSA loop `repeat_calculate_measure_of_sampling_adequacy`;
- the `check_array` patch for scikit-learn 1.8.

`MeasureEvaluator.collect_log_measure_data` is mirrored in
`factor_analysis/compute.py`: one `feeed.extract_features` call per log with the
selected feature names.

## Not copied

`main.py`, `UserInteraction.py`, `LatexExporter.py`, `MeasureEvaluator.py`,
`gedi/`, `input/`, `output/`, `images/`. The bundled CSV and sample logs from
`input/` are in `datasets/`, see `datasets/PROVENANCE.md`.

## Local modifications

None.
