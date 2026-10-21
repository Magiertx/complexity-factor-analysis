# Complexity Factor Analysis

[![CI](https://github.com/Magiertx/complexity-factor-analysis/actions/workflows/ci.yml/badge.svg)](https://github.com/Magiertx/complexity-factor-analysis/actions/workflows/ci.yml)

A web tool for finding out which complexity measures of process models and event logs
describe the same underlying dimension. It collects measures over many models or logs, checks
whether a factor analysis is meaningful, and groups the measures into a few factors, the way
[ComFy](https://github.com/Pati-nets/ComFy) and
[ComFy for log measures](https://github.com/Pati-nets/ComFy-for-Log-Measures) by Patrizia
Schalk do it, but interactively in the browser.

## Features

- **Two tabs, one workflow.** *Model complexity* works on ComFy's Petri-net measures (size,
  density, control-flow complexity, separability, ...); *Log complexity* on the event-log
  measures of [feeed](https://github.com/andreamalhera/feeed), grouped as in ComFy for log
  measures. Both walk through the same five steps: data, dataset, suitability, factors,
  loadings, followed by an optional interpretation. One step is on screen at a time, with its
  own address (`?step=loadings`), a step list that shows what each step found, and Back and Next;
  a toolbar of icons holds Start here, My datasets, the short codes, the link, the downloads,
  and the user guide and the tour.
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
  assignment rules: the largest loading as in ComFy's report (default), multiple membership as in
  Important Factors (Tab. 6-16) or Hair et al. (Tab. 17), with cross-loadings reported under
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
  and how the paper's own tables relate to it. "Start here" on the data step opens such an
  analysis directly, and "Copy link" shares an analysis of any bundled dataset with its settings
  and the step on screen.
- **Compare miners.** A page puts the factor structures of up to eight bundled datasets side by
  side, like Tab. 17 of Important Factors: per miner n, the measures after the MSA filter, KMO,
  factors and explained variance, every measure with its dimension under one shared assignment
  rule, and the dimensions per miner as in Tab. 17. The factors are matched across the miners by
  the measures they share, and a third look counts for every pair of measures in how many
  datasets both are in one dimension, which needs no matching. A link can ask for a dataset with
  a factor count of its own, such as the Inductive miner with 4 and with 6 factors. Downloads as
  CSV, as a LaTeX table and as a ZIP with a manifest.
- **Look at the measures.** In the suitability step a folded correlation map shows the correlation of
  every pair of measures, ordered by factor or clustered, with the pairs at |r| of 0.95 or more
  outlined, a pair and its r read with the pointer or the arrow keys, a table as its text and the
  figure for a paper. The name of a measure anywhere opens its fact sheet: what it is (the function
  of ComFy or feeed behind it, with a link to its source), a histogram of its values, its MSA and
  the round of the filter that removed it, communality, uniqueness and loadings, the five measures
  it correlates with most, and the choice to exclude or include it.
- **Come back to a dataset.** The datasets of a session are listed on the data step, reopen
  with the parameters of their last analysis and can be deleted one by one or all at once;
  deleting a dataset job in the run history deletes its dataset too. The tab "Recent runs" says what
  runs and how far, marks a failed run with a red dot, and a dataset that has been computed raises a
  notice with a link to it.
- **Into the paper.** A LaTeX report built like ComFy's (`report.tex`: validity, MSA with the
  rounds of the filter, scree plot, descriptive statistics, loadings with the assigned ones in
  bold, communalities, dimensions, settings and provenance; compiles with latexmk or pdflatex run
  twice, and prints the published numbers under the paper settings), the scree plot and the
  loadings heatmap as SVG or PNG (300 dpi, light, at the text width of a CEUR page), a print
  view of the whole analysis for A4 or PDF, and a switch to the short codes of the papers (CNC,
  dens, C_mag) for lists, figures and report. The dataset step shows the descriptive statistics of every measure
  as ComFy prints them and, for a computed dataset, the run time and input size of every stage.
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
  values, row labels or file names. It needs `ANTHROPIC_API_KEY` on the server, is limited per session and per
  day, and caches every answer; precomputed interpretations of the bundled datasets work
  without a key and offline. Details in [`docs/API.md`](docs/API.md#interpretation-by-claude)
  and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#interpretation-by-claude).
- **Single-log inspection.** "Inspect a single log" (a log, the miners and measures, the run, in
  three sections) runs the chosen miners on one log and shows the measures next to the rendered
  nets. A row of a dataset computed from logs links to it with the log and the miner of the row
  chosen, while the log is among the newest uploads of the session.
- **Scriptable.** Everything the UI does goes through a documented HTTP API
  ([`docs/API.md`](docs/API.md#factor-analysis)); English and German UI.

Discovery runs through [ProM4Py](https://doi.org/10.5281/zenodo.13853660), a bridge to the
ProM plugins.

## Architecture

```
┌──────────────┐  REST   ┌──────────────────┐  queue  ┌───────────────┐
│   frontend   │ ──────▶ │   algoservice    │ ──────▶ │ celery_worker │
│  Next.js 15  │         │     FastAPI      │         │  runs the job │
└──────────────┘         └──────────────────┘         └───────────────┘
                                  │                           │
                    ┌─────────────┼───────────────┬───────────┘
                    ▼             ▼               ▼
              ┌──────────┐  ┌──────────┐   ┌─────────────┐
              │ postgres │  │  redis   │   │   prom4py   │
              │   jobs   │  │  broker  │   │ Java, :4040 │
              └──────────┘  └──────────┘   └─────────────┘
```

Six services. `prom4py` is the Java bridge to ProM that all miners go through. Details in
[`docs/architecture.md`](docs/architecture.md), the HTTP API in [`docs/API.md`](docs/API.md),
and how to use the tool in the user guide [`docs/GUIDE.md`](docs/GUIDE.md), which the app has
behind the help icon of its toolbar as well.

## Quick start

Two required secrets have no defaults, so start by creating a `.env`:

```bash
cp .env.example .env
```

Fill in `POSTGRES_PASSWORD` and `SESSION_SECRET_KEY` (the file says how to generate one).
Without them `docker compose` stops with `required variable ... is missing a value`, on
purpose. Then:

```bash
docker compose up --build
```

Everything is reached through the frontend on <http://localhost:3000>: the model tab at `/`,
the log tab at `/log`. The API is not published on the host, and the OpenAPI UI lives at
<http://localhost:3000/api/docs>. The first build downloads the ProM bundle (about 430 MB
from Zenodo) and takes a while; after that, a start takes one to two minutes, most of it the
Java bridge booting.

To try it, pick a bundled dataset on either tab, or "Petri nets" and the bundled sample nets
on the model tab. For a demo without network, see [`docs/OFFLINE-DEMO.md`](docs/OFFLINE-DEMO.md).

> To reach the API directly during development, add a `docker-compose.override.yml` with a
> port mapping for `algoservice` rather than editing `docker-compose.yml`. The closed port is
> what keeps requests from bypassing the reverse proxy and its security headers.

## Local development

Backend, from `src/AlgoService`:

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt -c constraints.txt
SESSION_SECRET_KEY=dev-only-not-a-deployment uvicorn srv_main:app --reload --port 8000
```

`constraints.txt` pins every package to the version of the Docker image and CI, so the local
environment matches them (how to update it: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#pinned-dependency-versions)).

The service refuses to start without `SESSION_SECRET_KEY`. On PowerShell, set it first with
`$env:SESSION_SECRET_KEY = "dev-only-not-a-deployment"`. Postgres and Redis are needed as
well; `docker compose up -d postgres redis prom4py` starts them together with the Java bridge.

Frontend, from `src/frontend`:

```bash
npm install && npm run dev
```

`npm run start` does not work on Windows because the script expands `${PORT:-3000}`; use
`npx next build && npx next start -p 3000` instead.

## Tests

```bash
cd src/AlgoService
python -m pytest
```

Tests that need the ProM4Py service skip when it is not reachable; start it with
`docker compose up -d prom4py` to include them. The Petri-net rendering test skips without
Graphviz. The factor-analysis tests run offline: model datasets from logs use a stand-in
miner, PNML and log datasets run for real (feeed 2.2 needs no Java). The HTTP layer is tested
with a small stub tool registered by `tests/conftest.py`, so those tests need neither Java nor
a database server.

`tests/test_published_numbers.py` checks the bundled datasets against the numbers they were
published with, extracted once into `datasets/published/` by
`scripts/extract_published.py`: all seven ComFy reports (Bartlett, KMO, every MSA with its
filter round, eigenvalues, loadings, communalities and descriptive statistics) and, for the
log measures, the cleaning and Bartlett's chi-square. `tests/test_column_order.py` checks that
the analysis, the MSA filter and the exports keep the stored column order, on which the KMO of
singular data depends. `tests/test_assignment_rules.py` checks the three assignment rules
against the dimension tables of Important Factors (Tab. 6, 9 and 12 with the two documented
deviations, and two rows of Tab. 17), `tests/test_compare.py` the comparison of the miners
against all four rows of Tab. 17 with its documented deviations, `tests/test_published_match.py` the published settings
and the check against the reports at runtime, `tests/test_parallel_analysis.py` the values of
parallel analysis with its seed, and `tests/test_analysis_load.py` the measure cap and how a
newer request replaces an analysis, with a stand-in fit.

Frontend checks, from `src/frontend`:

```bash
npm run lint
npx tsc --noEmit
npm test               # Vitest: lib/format.ts and lib/factor-analysis.ts
npm run check:i18n     # en.json and de.json alike, every key in the code exists
npx next build
```

### End-to-end tests

Playwright drives the UI in a browser (`src/frontend/e2e/`): a paper dataset through all six
steps with its ZIP, a CSV upload reopened from "My datasets" with its excluded measure, the
PNML and log samples, deleting a dataset, the comparison of the four miners of Tab. 17 with its
pairs of measures, its factor counts per column and its downloads, decimal commas in German, the theme switch, axe on every route in light and dark, and a single run without ProM, which has to fail with the
coded error. They check text, roles and downloads, no pixels.

Against the Docker stack, with a browser installed on the machine (here Microsoft Edge;
Playwright's own browsers are not needed):

```bash
cd src/frontend
BASE_URL=http://localhost:3000 PW_CHANNEL=msedge E2E_PROM=1 npx playwright test
```

`E2E_PROM=1` says that the stack has ProM: it adds the specs tagged `@prom` (the sample logs
mined with the default miner) and skips those tagged `@no-prom`. The `e2e` job in CI runs the
suite without ProM, against `uvicorn` on SQLite (`TESTING=1`, `RATE_LIMIT_DISABLED=1`,
`ARTIFACTS_DIR`, `UPLOADED_LOGS_DIR`, `PROM4PY_START_WAIT=2`) and the standalone Next.js
server; see `.github/workflows/ci.yml` to do the same locally. The data directories need short
paths on Windows, whose paths may not exceed 260 characters.

### Smoke test of a running stack

`scripts/smoke.py` works through every dataset source (the sample logs with the default miner,
the sample nets, the sample logs with feeed), analyses a paper dataset with its published
settings and compares the numbers, also by the server's own check against the report, opens
the same paper dataset again to see the session's copy come back, downloads its ZIP and LaTeX
table, and deletes everything it created. It needs only the standard library and prints a table of the steps with their
times; a failed step makes it exit with 1.

```bash
python scripts/smoke.py --base-url http://localhost:3000
```

## Operating it

All of this is set in `docker-compose.yml`; reverse proxy, TLS, volumes and backups are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

- **Worker concurrency.** `celery_worker` runs with `--concurrency=4`. Each job is a separate
  process holding its own copy of the log, so this multiplies memory.
- **Java heap.** `prom4py` gets `JAVA_HEAP=2G`. Raise it if discovery fails on large logs; the
  symptom is an out-of-memory error from the Java side.
- **Limits.** 100 MB per uploaded file; per factor-analysis dataset 50 logs or 200 PNML
  files and 500 MB in total; a per-session cap on queued jobs. Request rate limits, the job
  cap and the number of files per dataset (`MAX_LOG_FILES`, `MAX_PNML_FILES`, default 50 and
  200) are tunable in `.env` (see `.env.example`). The data step and `/api-access` show the
  values in force, and `GET /api/factor-analysis/limits` reports them.
- **Analysis cost.** A factor fit over about a hundred measures takes a few seconds of CPU
  in the API process. At most two run at once per process; recent fits are cached, and after the
  start the API computes those of the bundled datasets in the background
  (`PRECOMPUTE_BUNDLED`, on in docker-compose), so that opening one for the first time is
  instant. BLAS runs single-threaded (`OPENBLAS_NUM_THREADS=1`), which is many times faster for
  these matrices.
- **Slow miners.** Alpha++ and Alpha Robust are marked slow; Alpha++ can run for many
  minutes on a mid-sized log and ProM4Py cannot interrupt it. Such a discovery fails for its
  input after `PROM4PY_CALL_TIMEOUT` (default 300 s), and the `prom4py` container restarts
  the stuck ProM by itself (see [`docs/OFFLINE-DEMO.md`](docs/OFFLINE-DEMO.md#when-a-miner-hangs)).
  The Hybrid ILP miner needs the
  native lp_solve 5.5 libraries, which the `prom4py` image builds in (see
  [`src/prom4py/README.md`](src/prom4py/README.md#lp_solve)).

## Project structure

```
├── docs/                      # architecture, API, deployment
├── scripts/smoke.py           # smoke test of a running stack
├── docker-compose.yml
└── src/
    ├── AlgoService/           # FastAPI backend + Celery worker
    │   ├── algorithms/        #   tool adapters (ComFy)
    │   ├── factor_analysis/   #   factor analysis: numerics, datasets, export
    │   ├── interpretation/    #   interpretation of the factors by Claude
    │   ├── scripts/           #   precompute_interpretations.py, extract_published.py
    │   ├── datasets/          #   bundled scores and sample logs/nets, see PROVENANCE.md
    │   ├── vendored/comfy/    #   ComFy sources, see PROVENANCE.md
    │   ├── vendored/comfy_log/ #  ComFy for log measures (constants), MIT
    │   └── tests/
    ├── prom4py/               # Java ProM bridge
    └── frontend/              # Next.js frontend
```

## Credits

- [ComFy](https://github.com/Pati-nets/ComFy) by Patrizia Schalk: complexity measures, miner
  wrappers and factor analysis. Related measure code is published under the MIT licence in the
  [Complexity Toolkit](https://github.com/Pati-nets/Complexity-Toolkit).
- [ComFy for log measures](https://github.com/Pati-nets/ComFy-for-Log-Measures) by Patrizia
  Schalk (MIT): the factor analysis over event-log measures, its feature groups and the
  numerically stable Bartlett test.
- [feeed](https://github.com/andreamalhera/feeed) by Andrea Maldonado (MIT): the event-log
  measures.
- [ProM4Py](https://doi.org/10.5281/zenodo.13853660): Python access to the ProM plugins.
- [pm4py](https://processintelligence.solutions/pm4py) for reading logs and handling Petri nets.

The bundled sample log `src/AlgoService/sample_logs/small_example.xes` is a small synthetic log
(six traces over the activities a to e) made for testing. The factor-analysis data in
`src/AlgoService/datasets/` (ComFy paper scores, PDC log measures, four Process Discovery
Contest logs and nets mined from them) is listed with sources and licences in
`datasets/PROVENANCE.md`; redistribution of the ComFy paper scores awaits the author's
permission.

## License

To be decided.
