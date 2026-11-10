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
- **Licence:** MIT, copyright Patrizia Schalk (licence file added upstream in ComFy commit
  `dfdd5d2`, 2026-11-10; copy in `vendored/comfy/LICENSE`). The underlying PDC 2025 logs are
  CC0 at 4TU.ResearchData.

## `log/` — log measures of the PDC training logs

- **File:** `log_measures_all_pdc_training_logs.csv`, copied from `input/` of
  https://github.com/Pati-nets/ComFy-for-Log-Measures, commit
  `70837cec7f3aff9580f52e78162b433e9e21f473`.
- **Content:** 146 feeed measures of 2112 training logs of the Process Discovery Contests
  2020 to 2025, as shipped in that repository.
- **feeed version:** the file predates feeed commit `b28fb49`, which removed a dummy `[0]`
  appended to the distinct-activity statistics. Five features therefore differ from what the
  service computes with the feeed it ships: `simple_trace_diversity`,
  `distinct_activities_mean`, `distinct_activities_std`, `event_density` and
  `complexity_factor` (e.g. `event_density` 0.999000999 here, 1.0 now: a mean over 1001
  instead of 1000 entries). The other 141 features match. Do not compare loadings of these
  five between this file and datasets computed by the service.
- **Singular data:** after cleaning, 128 measures remain with six exact linear dependencies
  (four `iqr = q3 - q1`, `cyclomatic_number_dfg` and `n_edges_dfg`). Bartlett's chi-square
  clamps the six eigenvalues of the correlation matrix below `Constants.eigenvalue_floor` and
  is the same on every platform. KMO and MSA leave the same six directions out of the inverse
  of the correlation matrix (`core.kmo`). Here the tool deviates on purpose from ComFy for Log
  Measures, which calls factor_analyzer's `calculate_kmo`: that inverts the covariance matrix
  and cuts its singular values below 1e-15 of the largest. With variances from 1.6e-6
  (`structure`) to 1.6e11 (`activities_variance`) the cut drops 30 directions, 24 of them
  genuine ones of measures on a small scale, and leaves the rest to rounding. The published
  result (KMO 0.882187; `start_activities_iqr`, `end_activities_iqr`, `structure`,
  `average_affinity` and `sequentiality_ratio_dfg` removed, 123 measures left) comes out in
  the CSV's column order, but other orders remove 5 to 14 measures or fail, the KMO of some
  orders differs between Windows and Linux in the third decimal, and the units decide:
  with `structure` in thousandths its MSA is 0.819 instead of 0.281. Three of the five
  removals (`structure`, `average_affinity`, `sequentiality_ratio_dfg`, among the measures
  with the smallest variances) are such unit artifacts. The tool removes
  `start_activities_iqr` (MSA 0.287), `end_activities_iqr` (0.318) and `trace_len_hist6`
  (0.546) and keeps 125 measures with a KMO of 0.928, the same on every platform, in every
  column order and in any units; with the standard settings Kaiser's criterion gives 16
  factors (parallel analysis 12), 14 of them with measures. `tests/test_msa_invariance.py`
  pins this. On regular data both computations agree: on the seven ComFy reports to 1e-11.
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
  is all 0.0, and the tool reproduces the other three with 3 factors. The paper prints these
  numbers rounded, with two exceptions found: the MSA of Density for the Inductive miner is
  0.7559 in the report and 0.75 in Tab. 10, that of the duplicate tasks for the Heuristics
  miner 0.5965 in the report and 0.59 in Tab. 13. For the log measures
  only the cleaning and Bartlett's chi-square are checked; the published KMO and MSA are kept
  for reference and marked platform dependent, since the tool computes them differently (see
  "Singular data" above).
- **Used at runtime:** the seven datasets of Important Factors carry in `manifest.json` the
  settings of the paper (`published_options`, `published_source`), whether the paper analyses
  the dataset with them or only the report in the ComFy repository does (`published_scope`:
  Alpha Plus, Alpha Dollar and Heuristics are analysed in the reports only), and how the
  paper's tables relate to the reports (`paper_tables`). An analysis with exactly these
  settings compares itself with the numbers here that `verified` lists and reports the result
  as `published_match` (`factor_analysis/published.py`). The log dataset has no settings yet.

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
