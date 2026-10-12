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
  loadings, followed by an optional interpretation.
- **Data from anywhere.** Bundled datasets (the scores of the ComFy paper for seven miners,
  and the measures of 2112 Process Discovery Contest logs), an own CSV, up to 50 event logs
  (`.xes`, `.xes.gz`) that are mined with any of ComFy's nine ProM miners, or up to 200 PNML
  models. Sample logs and nets are bundled, so the demo works without own files and offline.
- **Suitability first.** Data cleaning with reasons, Bartlett's test of sphericity (the
  numerically stable variant), KMO with ComFy's iterative MSA filter, and a per-measure MSA
  table with manual exclusion.
- **Factors and loadings.** Scree plot with the Kaiser suggestion and parallel analysis (fixed
  seed), factor count and rotation (varimax, promax, oblimin, quartimax, none), a loading
  heatmap with communalities and explained variance, factor groups by one of three assignment
  rules: the largest loading as in ComFy's report (default), multiple membership as in the
  dimension tables of Important Factors, or Hair's rule as in its Tab. 17, with cross-loadings
  reported under each. Every change re-runs the analysis; a newer change replaces the
  analysis still running for the one before.
- **Same numbers as upstream.** On the bundled paper scores of all seven miners the analysis
  equals ComFy's own reports to the four decimals they print; tests check every published
  number. With the settings the paper published, which the catalog offers per dataset, every
  analysis checks itself against the report and says what it compared. Oblique rotations
  report correct communalities, the structure matrix and the factor correlations.
- **Come back to a dataset.** The datasets of a session are listed on the data step, reopen
  with the parameters of their last analysis and can be deleted one by one or all at once;
  deleting a dataset job in the run history deletes its dataset too.
- **Export.** Loadings as CSV or as a LaTeX `tabular` for the paper, the cleaned matrix as CSV,
  or the whole analysis as a ZIP: result, matrix, tables, the assignment of each measure,
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
- **Single-log inspection.** "Inspect a single log" runs the chosen miners on one log and shows
  the measures next to the rendered nets.
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
[`docs/architecture.md`](docs/architecture.md), the HTTP API in [`docs/API.md`](docs/API.md).

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
pip install -r requirements-dev.txt
SESSION_SECRET_KEY=dev-only-not-a-deployment uvicorn srv_main:app --reload --port 8000
```

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
deviations, and two rows of Tab. 17), `tests/test_published_match.py` the published settings
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
PNML and log samples, deleting a dataset, decimal commas in German, the theme switch, axe on
every route in light and dark, and a single run without ProM, which has to fail with the
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
settings and compares the numbers, downloads its ZIP and LaTeX table, and deletes everything
it created. It needs only the standard library and prints a table of the steps with their
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
  files and 500 MB in total; a per-session cap on queued jobs. Request rate limits and the
  job cap are tunable in `.env` (see `.env.example`).
- **Analysis cost.** A factor fit over about a hundred measures takes a few seconds of CPU
  in the API process. At most two run at once per process; recent fits are cached. BLAS runs
  single-threaded (`OPENBLAS_NUM_THREADS=1`), which is many times faster for these matrices.
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
