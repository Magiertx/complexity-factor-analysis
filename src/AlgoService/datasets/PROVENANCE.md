# Bundled data

`manifest.json` lists every file here with its source, licence and citation; the factor
analysis catalog (`GET /factor-analysis/catalog`) serves it. Files are unchanged copies
unless noted.

## `model/` — ComFy paper scores

- **Files:** `complexity_scores-<miner>-miner.csv` for seven miners, copied from
  `output/paper-results/` of https://github.com/Pati-nets/ComFy, commit
  `1dd6ea610017cbca65bb54735ac6db922af00e8d`.
- **Content:** 13 model complexity measures of the nets each miner discovered from the 288
  training logs of the Process Discovery Contest 2025, as analysed in the paper
  *Important Factors: Complexity Dimensions for Petri Nets* (ATAED 2026). Rows are named
  `(log,miner)`; the service shows them as `log / miner`.
- **Licence:** the ComFy repository has no licence file. Permission of the author
  (Patrizia Schalk) to redistribute the data is pending, as for `vendored/comfy/`.

## `log/` — log measures of the PDC training logs

- **File:** `log_measures_all_pdc_training_logs.csv`, copied from `input/` of
  https://github.com/Pati-nets/ComFy-for-Log-Measures, commit
  `70837cec7f3aff9580f52e78162b433e9e21f473`.
- **Content:** 146 feeed measures of 2112 training logs of the Process Discovery Contests
  2020 to 2025, analysed in the paper *Cleaning Up the Measure Mess: A Factor Analysis on
  Event Log Measures*.
- **feeed version:** the file predates feeed commit `b28fb49`, which removed a dummy `[0]`
  appended to the distinct-activity statistics. Five features therefore differ from what the
  service computes with the feeed it ships: `simple_trace_diversity`,
  `distinct_activities_mean`, `distinct_activities_std`, `event_density` and
  `complexity_factor` (e.g. `event_density` 0.999000999 here, 1.0 now: a mean over 1001
  instead of 1000 entries). The other 141 features match. Do not compare loadings of these
  five between this file and datasets computed by the service.
- **Singular data:** after cleaning, 128 measures remain with exact linear dependencies
  (e.g. `trace_len_q3 - trace_len_q1 = trace_len_iqr`). KMO then rests on a pseudo-inverse
  and Bartlett's chi-square on clamped eigenvalues, so both depend slightly on the platform's
  linear algebra: `trace_len_hist6` has an MSA of about 0.593, at the threshold of 0.6, and
  is removed on some machines and kept on others. The service equals the upstream code run
  in the same environment, not necessarily the published upstream output.
- **Licence:** MIT (`vendored/comfy_log/LICENSE`).

## `published/` — the numbers the bundled datasets were published with

- **Files:** `<dataset id>.json` for every bundled dataset, extracted once by
  `scripts/extract_published.py` from `output/paper-results/report-*-miner.tex` of ComFy and
  `output/paper-results/analysis-info-10-factors-oblimax.tex` of ComFy for log measures, at the
  commits above. `factor_analysis/published.py` describes the fields.
- **Checked by:** `tests/test_published_numbers.py`. The seven ComFy reports reproduce in
  full: Bartlett's chi-square and the overall MSA to 1e-9 relative, every MSA, loading,
  communality and scree value to the four decimals the report prints, and the MSA filter with
  its rounds. The Heuristics report asks for 4 factors with 4 measures left; its last column
  is all 0.0, and the tool reproduces the other three with 3 factors. For the log measures
  only the cleaning and Bartlett's chi-square are checked; KMO and MSA are kept for reference
  and marked platform dependent (see "Singular data" above).

## `samples/logs/` — sample event logs

- **Files:** `pdc_2020_1001010.xes`, `pdc2023_00101000.xes`, `pdc2024_00001100.xes`,
  `pdc2025_02001100.xes`, copied from `input/` of ComFy-for-Log-Measures (same commit).
- **Origin:** training logs of the Process Discovery Contest,
  https://www.tf-pm.org/competitions-awards/discovery-contest.
- **Licence:** MIT, as distributed in ComFy-for-Log-Measures.

## `samples/models/` — sample Petri nets

- **Files:** 32 PNML files, generated from the four sample logs by
  `samples/make_sample_models.py`: pm4py's inductive miner (infrequent variant) at noise
  thresholds 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6 and 0.8, with initial and final marking. Run
  with pm4py 2.7.23.8. To regenerate: `cd src/AlgoService && python datasets/samples/make_sample_models.py`.
- **Licence:** derived from the sample logs.
