# Features

The short list is in the [README](../README.md#features); this is the full one.

- **Two tabs, one workflow.** *Model complexity* works on ComFy's Petri-net measures (size,
  density, control-flow complexity, separability, ...); *Log complexity* on the event-log
  measures of [feeed](https://github.com/andreamalhera/feeed), grouped as in ComFy for log
  measures. Both walk through the same six steps: data, dataset, suitability, factors,
  loadings and an optional interpretation. One step is on screen at a time, with its
  own address (`?step=loadings`), a step list that shows what each step found, and Back and Next;
  the toolbar of the analysis holds the short codes, the link, the downloads and the tour. The
  tabs are the same on every page (the two analyses, Compare, Single log and History), and the
  guide and the settings are in the header.
- **Data from anywhere.** Bundled datasets (the scores of the ComFy paper for seven miners,
  and the measures of 2112 Process Discovery Contest logs), an own CSV, up to 50 event logs
  (`.xes`, `.xes.gz`; `MAX_LOG_FILES`) that are mined with any of ComFy's nine ProM miners, or
  up to 200 PNML models (`MAX_PNML_FILES`). Sample logs and nets are bundled, so the demo works without own files and offline.
- **Suitability first.** Data cleaning with reasons, Bartlett's test of sphericity (the
  numerically stable variant), KMO with ComFy's iterative MSA filter, and a per-measure MSA
  list with manual exclusion that shows the measures worth a look first and keeps the others
  folded below them in a long list; it can be searched, sorted and grouped by feature group.
- **Factors and loadings.** Scree plot with the Kaiser line, a parallel analysis with a fixed
  seed and the cumulative share of the eigenvalues; tiles for the factor count of each criterion
  (Kaiser, parallel analysis, and the paper's count chosen a priori, or the ComFy report's for
  the datasets the paper does not analyse); rotation (varimax, promax, oblimin, quartimax, none);
  a loading heatmap with communalities and explained variance; factor groups by one of three
  assignment rules: the largest loading (default; ComFy's report only greys the loadings below its threshold), multiple membership as in
  Important Factors (Tab. 6-16) or without cross-loadings (Tab. 17), with cross-loadings reported under
  each and a note where a table of the paper differs from the rule it states. The loadings show as
  a matrix or as one card per dimension. A long list (from 20 measures) can be searched and
  narrowed to the cross-loaded and unassigned measures; from 30 measures on both looks start
  with those and keep the others folded below them, like the MSA list, until a search or the
  dataset's own order asks for the whole list. A settings row above every step sums up every choice and
  marks those that differ from the standard. Every change re-runs the analysis; a newer change
  replaces the analysis still running for the one before.
- **Same numbers as upstream.** On the bundled paper scores of all seven miners the analysis
  equals ComFy's own reports to the four decimals they print; tests check every published
  number. Oblique rotations report correct communalities, the structure matrix and the factor
  correlations.
- **Published analyses in one click.** The Important Factors datasets open with the tool
  standard or with the paper's settings, and with the paper's settings every analysis checks
  itself against the ComFy report: a chip says whether the numbers are equal, what was compared
  and how the paper's own tables relate to it. "Get started" on the data step loads such an
  analysis in one click and leads to its loadings, and "Copy link" shares an analysis of any bundled dataset
  with its settings and the step on screen.
- **Compare miners.** A page puts the factor structures of up to eight bundled datasets side by
  side, like Tab. 17 of Important Factors: per miner n, the measures after the MSA filter, KMO,
  factors and explained variance, every measure with its dimension under one shared assignment
  rule, and the dimensions per miner as in Tab. 17. The factors are matched across the miners by
  the measures they share, and a third look counts for every pair of measures in how many
  datasets both are in one dimension, which needs no matching. A link can ask for a dataset with
  a factor count of its own, such as the Inductive miner with 4 and with 6 factors. Columns of
  your own datasets carry the names you gave the factors of exactly that solution. Downloads as
  CSV, as a LaTeX table and as a ZIP with a manifest.
- **Look at the measures.** In the suitability step a folded correlation map shows the correlation of
  every pair of measures, ordered by factor or clustered, with the pairs at |r| of 0.95 or more
  outlined, a pair and its r read with the pointer or the arrow keys, a table as its text and the
  figure for a paper. The name of a measure anywhere opens its fact sheet: what it is (the function
  of ComFy or feeed behind it, with a link to its source), a histogram of its values, its MSA and
  the round of the filter that removed it, communality, uniqueness and loadings, the five measures
  it correlates with most, and the choice to exclude or include it.
- **Stability and a short set.** In the loadings step, "Check stability" draws bootstrap samples
  of the rows (100, 200 or 500), refits each with the same measures, factor count and rotation
  and shows for every measure the share of samples in which it keeps its factors. The short set
  names one representative measure per dimension, the one assigned to it with the highest
  purity, ready to copy; a representative with a low stability should be read with care.
  A computed stability goes into the ZIP.
- **Feedback.** A form in the header reports a bug, suggests something or says anything else.
  On a server with mail set up it is mailed, without an account; elsewhere (the desktop app) it
  opens a filled-in issue on GitHub with the label `feedback`.
- **Come back to a dataset.** The datasets of a session are listed on the data step, reopen
  with the parameters of their last analysis and can be deleted one by one or all at once.
  "History" lists every dataset and every run of a single log of the session, newest first, with
  the settings of each dataset's last analysis; deleting a dataset deletes the job that computed
  it, and the other way round. Its tab says what runs and how far and marks a failed run with a
  red dot, and a dataset that has been computed raises a notice with a link to it.
- **Into the paper.** A LaTeX report built like ComFy's (`report.tex`: validity, MSA with the
  rounds of the filter, scree plot, descriptive statistics, loadings with the assigned ones in
  bold, communalities, dimensions, settings and provenance; compiles with latexmk or pdflatex run
  twice, and prints the published numbers under the paper settings), the scree plot and the
  loadings heatmap as SVG or PNG (300 dpi, light, at the text width of a CEUR page), a print
  view of the whole analysis for A4 or PDF, and a switch to the short codes of the papers (CNC,
  dens, C_mag) for lists, figures and report. The dataset step shows the descriptive statistics of every measure
  as ComFy prints them and, for a computed dataset, the run time and input size of every stage.
  "Copy methods text" in the download menu puts a short, neutral methods paragraph on the
  clipboard (English, or German with the UI), read strictly from the settings and results on screen,
  with LaTeX citation keys; "Download BibTeX" gives the entries of exactly those keys, and says in
  a comment what a source does not record.
- **Export.** Loadings as CSV or as a LaTeX `tabular` for the paper, the cleaned matrix as CSV,
  or the whole analysis as a ZIP: result, matrix, tables, the assignment of each measure, the
  report and the figures, the descriptive statistics, the run times of a computed dataset,
  parameters, provenance (tool version and commit, upstream commits, feeed, pm4py and ProM,
  miners with their parameters, assignment rule, the seed of parallel analysis, the published
  settings if used) and a README on how to reproduce it.
- **Interpretation by Claude (optional).** A button after the loadings asks Claude (Anthropic)
  for a name and a short interpretation of each factor, with the measures it rests on, a
  confidence and caveats such as cross-loadings or a failed Bartlett or KMO test. Only the
  measure (column) names, their definitions and aggregated results are sent, never measure
  values, row labels or file names. Model (Opus 5.5 or Sonnet 5.5) and effort are chosen in the
  step. It needs `ANTHROPIC_API_KEY` on the server, is limited per session and per
  day, and caches every answer. Without a key the step is marked as unavailable, unless an
  interpretation was precomputed for the settings: the repository holds them for the bundled
  datasets with the default and the paper settings, at several efforts (`scripts/precompute_interpretations.py`),
  and the step offers those. With a key, follow-up questions about a shown interpretation can be
  asked in a small chat; each question is one live call. Details in [`docs/API.md`](API.md#interpretation-by-claude)
  and [`docs/DEPLOYMENT.md`](DEPLOYMENT.md#interpretation-by-claude).
- **Single-log inspection.** "Inspect a single log" (a log, the miners and measures, the run, in
  three sections) runs the chosen miners on one log and shows the measures next to the rendered
  nets. A row of a dataset computed from logs links to it with the log and the miner of the row
  chosen, while the log is among the newest uploads of the session.
- **Scriptable.** Everything the UI does goes through an HTTP API; for scripting it is documented in
  [`docs/API.md`](API.md#factor-analysis) and interactively at `/api/docs`. English and German UI.

Discovery runs through [ProM4Py](https://doi.org/10.5281/zenodo.13853660), a bridge to the
ProM plugins.
