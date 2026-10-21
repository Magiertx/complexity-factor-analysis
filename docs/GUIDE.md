# User guide

Complexity Factor Analysis runs exploratory factor analyses of complexity measures in the
browser: the model measures of [ComFy](https://github.com/Pati-nets/ComFy) on discovered Petri
nets, and the log measures of [feeed](https://github.com/andreamalhera/feeed) as
[ComFy for log measures](https://github.com/Pati-nets/ComFy-for-Log-Measures) groups them. This
guide shows the common tasks. Everything it describes is also available through the REST API
([API.md](API.md)); the app has the same guide behind the help icon of the toolbar.

## The six steps

*Model complexity* (`/`) and *Log complexity* (`/log`) walk through the same steps: **Data**,
**Dataset**, **Suitability**, **Factors**, **Loadings** and an optional **Interpretation**. One
step is on screen at a time and has its own address (`?step=loadings`). The list of steps (on the
left, on a phone a row at the top) shows what each step found; the settings row above the steps
sums up every choice, marks those that differ from the tool standard and leads to each control.
Every change of a setting runs the analysis again.

## Analyse a bundled dataset

1. Open *Model complexity* or *Log complexity*.
2. In **Data**, choose a dataset of a paper, for example *Important Factors: Inductive miner*.
3. Choose **Paper settings** to analyse it as the paper did, or **Standard** for the defaults of
   ComFy, then **Use dataset**.

With the paper settings, a chip in the settings row says whether the numbers equal the published
ComFy report (Bartlett, KMO, MSA, loadings) and how the tables of the paper relate to it.
**Start here** in the toolbar lists four ways in, two of them published analyses.

## Analyse your own data

In **Data**, choose a source:

- **Event logs** (`.xes`, `.xes.gz`). For model measures, choose miners and measures: every log is
  mined with every miner in ProM, and every net is measured. For log measures, choose feature
  groups; feeed computes them per log.
- **Petri nets** (`.pnml`): every net is measured.
- **CSV file**: one row per observation, one column per measure; a first column of names is
  taken as row labels.

Logs and nets are computed in a job; the jobs drawer shows its progress, and the dataset opens
when it is ready. The data step names the upload limits in force. **My datasets** in the toolbar
reopens a dataset of the session with the settings of its last analysis.

## Read the results

- **Dataset**: the cleaned matrix, what cleaning left out and why, the **descriptive statistics**
  of every measure as ComFy's report prints them (mean, median, standard deviation with n − 1,
  minimum, maximum, over the data before cleaning) and, for a dataset computed from logs or nets,
  the **run times and input sizes** per observation (traces, events, variants, activities, size of
  the net, seconds of reading, discovery and measures). Both tables are folded until opened.
- **Suitability**: Bartlett's test of sphericity, the overall KMO and the MSA of every measure.
  The MSA filter removes measures below the threshold in rounds, as ComFy does; any measure can
  be excluded by hand.
- **Factors**: the scree plot with the Kaiser line and parallel analysis (95th percentile of 100
  samples of random data with a fixed seed), the factor count each criterion suggests, and the
  rotation.
- **Loadings**: the loadings as a matrix (orange for negative loadings, faded where a loading does
  not count) or as one card per dimension, the loading and communality thresholds, and the
  assignment rule: the largest loading as in ComFy's report, multiple membership as in Important
  Factors (Tab. 6–16), or Hair et al. (Tab. 17). Cross-loadings are ringed.
- **Interpretation**: names and summaries for the factors, suggested by a language model only on
  request. It decides nothing; the analysis does not depend on it.

## Take the results into a paper

All downloads are in the **Download** menu of the page header:

- **Analysis (ZIP)**: everything to report and reproduce the analysis: the result, the matrix, the
  tables, `report.tex`, the figures as SVG, the descriptive statistics, the run times of a computed
  dataset, and a manifest with the settings, the versions and the provenance.
- **LaTeX report**: `report.tex`, built like the report of ComFy (validity, MSA with the rounds of
  the filter, scree plot, descriptive statistics, loadings, communalities) plus the dimensions, the
  factor correlations of an oblique rotation and the settings. It compiles with pdflatex.
- **Print view**: the whole analysis on A4 pages in a new tab, to print or to save as PDF.
- **Loadings (CSV, LaTeX)** and **Dataset (CSV)**.

The **image icon** at the scree plot and at the loadings downloads the figure as SVG (the text
stays text) or as PNG (300 dpi), always light, sized for the text width of a CEUR paper.

The **tag icon** in the toolbar names the measures by the **short codes** of the papers (CNC,
dens, C_mag); the full name stays in the tooltip. The figures, the report and the ZIP follow it.

The **link icon** copies a link to the analysis of a bundled dataset with its settings and the
step on screen.

## Use the API

The page *API access* (`/api-access`) lists the endpoints with examples in curl and Python;
[API.md](API.md) describes every request and response, including the report
(`POST /factor-analysis/datasets/{id}/export/report`) and the figures
(`POST /factor-analysis/datasets/{id}/export/figure`).
