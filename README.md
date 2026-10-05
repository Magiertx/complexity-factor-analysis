# Complexity Factor Analysis

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
- **Factors and loadings.** Scree plot with the Kaiser suggestion, factor count and rotation
  (varimax, promax, oblimin, quartimax, none), a loading heatmap with communalities and
  explained variance, factor groups by loading threshold. Every change re-runs the analysis.
- **Same numbers as upstream.** On the bundled Inductive-miner scores the analysis equals
  ComFy's own report to four decimals; a test checks it. Oblique rotations report correct
  communalities, the structure matrix and the factor correlations.
- **Export.** Loadings as CSV or as a LaTeX `tabular` for the paper, the cleaned matrix as CSV.
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
miner, PNML and log datasets run for real (feeed 2.2 needs no Java). One test compares the
analysis of the bundled Inductive-miner scores with the values in ComFy's own report. The
HTTP layer is tested with a small stub tool registered by `tests/conftest.py`, so those tests
need neither Java nor a database server.

Frontend checks, from `src/frontend`:

```bash
npm run lint
npx tsc --noEmit
npx next build
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
- **Slow and broken miners.** Alpha++ and Alpha Robust are marked slow; Alpha++ can run for
  many minutes on a mid-sized log and ProM4Py cannot interrupt it. The Hybrid ILP miner needs
  the native lp_solve 5.5 library, which the `prom4py` image does not contain, so it fails.

## Project structure

```
├── docs/                      # architecture, API, deployment
├── docker-compose.yml
└── src/
    ├── AlgoService/           # FastAPI backend + Celery worker
    │   ├── algorithms/        #   tool adapters (ComFy)
    │   ├── factor_analysis/   #   factor analysis: numerics, datasets, export
    │   ├── interpretation/    #   interpretation of the factors by Claude
    │   ├── scripts/           #   precompute_interpretations.py
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
