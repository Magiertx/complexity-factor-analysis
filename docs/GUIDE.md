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

Logs and nets are computed in a job. The tab **Recent runs** says what runs ("1 running · 37%") and has a red
dot for a failed run you have not looked at; a dataset that has been computed raises a notice "… is ready ·
Open" wherever you are, and the dataset opens from it. The data step names the upload limits in force. **My datasets** in the toolbar
reopens a dataset of the session with the settings of its last analysis.

A dataset of nets from several miners has a row per log and miner. The **Dataset** step offers
**All miners together** or one miner at a time, each tile with its observations n and measures:
together, the differences between the miners mix into the dimensions and each log counts once
per miner; one miner, as Important Factors analyses them, has fewer observations. A miner with
no more observations than measures is blocked (the tile says why); below five observations per
measure the tile and the analysis warn. A measure without variance within a miner is left out
for that miner only. The chosen miner stands in the settings row, in the print link and in the
manifest of the ZIP. **Compare the miners** opens their factor structures side by side.

A row of a dataset computed from logs has a **View this log** link in the Dataset step. It opens the page
**Inspect a single log** with that log and, for a row of nets, only the miner of the row chosen, as long as the
log is among the ten newest uploads of the session; the page says when it is not.

## Read the results

- **Dataset**: the cleaned matrix, what cleaning left out and why, the **descriptive statistics**
  of every measure as ComFy's report prints them (mean, median, standard deviation with n − 1,
  minimum, maximum, over the data before cleaning) and, for a dataset computed from logs or nets,
  the **run times and input sizes** per observation (traces, events, variants, activities, size of
  the net, seconds of reading, discovery and measures). Both tables are folded until opened.
- **Suitability**: Bartlett's test of sphericity, the overall KMO and the MSA of every measure.
  The MSA filter removes measures below the threshold in rounds, as ComFy does; any measure can
  be excluded by hand.
- **Correlation map** (in Suitability, folded until it is opened): one cell for each pair of
  measures, orange for a negative and the accent colour for a positive correlation, a pair with
  |r| ≥ 0.95 outlined, ordered by factor or clustered. Point at a cell or move with the arrow
  keys to read the pair and its r; a table under the map has every value. The image icon
  downloads the map like the other figures, and the ZIP holds it as a figure and as
  `correlations.csv`.
- **Fact sheet**: press, or Enter on, the name of a measure wherever it stands to open a panel
  beside the page. It has what the measure is (the description of the tool and the function of
  ComFy or feeed behind it, with a link to its source), a histogram of its values, its MSA and
  the round of the filter that removed it, its communality and uniqueness, its loadings as
  small bars, the five measures it correlates with most, and a button to exclude or include it.
  With a miner chosen, the histogram and the statistics are those of that miner's rows, as the
  analysis is.
  The left and right arrow keys page through the list you came from, Esc closes it, and the
  focus goes back to the name.
- **Factors**: the scree plot with the Kaiser line and parallel analysis (95th percentile of 100
  samples of random data with a fixed seed), the factor count each criterion suggests, and the
  rotation.
- **Loadings**: the loadings as a matrix (orange for negative loadings, faded where a loading does
  not count) or as one card per dimension, the loading and communality thresholds, and the
  assignment rule: the largest loading as in ComFy's report, multiple membership as in Important
  Factors (Tab. 6–16), or Hair et al. (Tab. 17). Cross-loadings are ringed.
- **Names**: press the title of a factor, on its card or at the head of its column, to name it;
  Enter keeps the name (at most 40 characters), Esc leaves it. The names appear in the matrix,
  the cards, the factor correlations, the list of steps and every download (loadings, figures,
  report, ZIP). They belong to the factor count, rotation and rule they were given for: changing
  one of them clears them, and the toast brings settings and names back. With an interpretation,
  **Use the suggested names** takes its names over; nothing is named without a click.
- **Interpretation**: names and summaries for the factors, suggested by a language model only on
  request. It decides nothing; the analysis does not depend on it.

## Compare miners

**Compare miners** puts the factor structures of several published datasets side by side, like
Tab. 17 of Important Factors: which measures form which dimension for which miner. It opens from
the column icon in the toolbar of Model complexity and from Start here, with the four miners of
Tab. 17 (Alpha, Directly Follows, Inductive, Hybrid ILP) under Hair et al.

- **Datasets**: choose 2 to 8 of the miners of Important Factors; each is analysed with the
  settings of its paper. "As in Tab. 17" goes back to the four miners and Hair et al. A link can
  also ask for a dataset with a factor count of its own, such as the Inductive miner with 4 and
  with 6 factors (a Start here entry opens it); that column has a tile of its own.
- **Your own data**: **Compare the miners** in the dataset step puts one column per miner,
  **Compare** in My datasets one column per dataset picked, and the **pin** at the loadings keeps
  the solution on screen (dataset, miner, factor count, rotation and rule): pin one with 4
  factors, change to 6, pin again, and **Compare pinned** shows both. Such a column starts from
  the settings saved with its dataset and works in this session only. Where you named the factors
  of exactly that solution (miner, factor count, rotation and the rule of the comparison), the
  column carries the names: in a row of the header, beside the dimension in the matrix and over
  the measures of its dimension, and in the CSV (`D1 (Size)`), the LaTeX table and the ZIP.
  Published datasets keep the numbers; the dimensions stay the same across the columns, each
  column's names are its own.
- **Assignment rule**: one rule for every dataset, so that a difference between two columns is
  one of the data.
- **By measure**: a row per measure, grouped by dimension, and above them per dataset n, the
  measures after the MSA filter, the KMO, the factors, the rotation, the rule and the variance
  explained. A tinted cell is in the dimension of its row; a ring marks a cross-loading, a dashed
  outline a measure the MSA filter removed, and a faded cell says why the rule leaves the measure
  out.
- **By dimension**: a row per dataset with the measures of each dimension, laid out like Tab. 17.
- **Pairs**: a square of the measures; each cell says in how many of the datasets that analysed
  both the two share a dimension, and the tint is that share. It does not depend on how the
  dimensions are numbered, so it shows without matching that, say, ts and CFC always go together
  and CH goes with no other measure.
- **Download**: the matrix as CSV, the dimensions as a LaTeX table like Tab. 17, and both in a ZIP
  with a manifest.

The factors of every analysis are numbered by the analysis, so they are matched first: the first
dataset keeps its numbers, and the factors of every further one go to the dimension with which
they share the most measures; where two are equally good, the one with the more alike loadings
wins. Tab. 17 renumbered its dimensions by hand, so a number can differ from the paper's, and a
match that rests on one shared measure is a guess: the tooltip of a cell in the dimension view
names the measures it rests on. How the measures are grouped within a dataset does not depend on
the numbers. The notes under the table say where the bundled data differ from the paper, e.g. for
the Hybrid ILP miner.

## Take the results into a paper

All downloads are in the **Download** menu of the page header:

- **Analysis (ZIP)**: everything to report and reproduce the analysis: the result, the matrix, the
  tables, `report.tex`, the figures as SVG (English, with the rows of the loadings and the measures of
  the correlation map in the order shown), `correlations.csv`, the descriptive statistics, the run times of a computed dataset, and a manifest with the
  settings, the versions and the provenance.
- **LaTeX report**: `report.tex`, built like the report of ComFy (validity, MSA with the rounds of
  the filter, scree plot, descriptive statistics, loadings, communalities) plus the dimensions, the
  factor correlations of an oblique rotation and the settings. It compiles with pdflatex; compile it with
  latexmk -pdf, or run pdflatex twice, as long tables settle their column widths in the second run.
- **Print view**: the whole analysis on A4 pages in a new tab, to print or to save as PDF. The
  loadings of more than 50 measures are a table that breaks between its rows, as a heatmap of that
  height would not fit a page.
- **Loadings (CSV, LaTeX)** and **Dataset (CSV)**.
- **Copy methods text**: a short, neutral paragraph for the methods section, in the language of the
  app, copied to the clipboard as LaTeX with citation keys. It is a template filled from the
  settings and results on screen and nothing else: the dataset and its size, the measures dropped,
  the tool with version and commit, Bartlett's test and the KMO, the MSA filter, the factor count
  and how it was chosen, minres extraction, the rotation, and the assignment rule with its
  thresholds. **Download BibTeX** gives the entries of exactly the keys the paragraph cites. A
  comment above an entry says what its source does not record (e.g. the authors beyond the one the
  catalog names, or the edition of a textbook), and these you complete from the paper. Lieben et
  al. are named for the rule of multiple membership but not cited, as the repository does not say
  which publication is meant.

The **image icon** at the scree plot, the loadings and the correlation map downloads the figure as SVG (the text
stays text) or as PNG (300 dpi), always light, sized for the text width of a CEUR paper, with its
labels in the language of the app.

The **tag icon** in the toolbar names the measures by the **short codes** of the papers (CNC,
dens, and C with the code as index for log measures); the full name stays in the tooltip. The figures, the report and the ZIP follow it.

The **link icon** copies a link to the analysis of a bundled dataset with its settings and the
step on screen.

## Use the API

The page *API access* (`/api-access`) lists the endpoints with examples in curl and Python;
[API.md](API.md) describes every request and response, including the report
(`POST /factor-analysis/datasets/{id}/export/report`) and the figures
(`POST /factor-analysis/datasets/{id}/export/figure`).
