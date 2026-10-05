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
- **Licence:** MIT (`vendored/comfy_log/LICENSE`).

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
