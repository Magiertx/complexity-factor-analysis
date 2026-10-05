# Complexity Factor Analysis

A web tool for analysing the complexity of process models. Upload an event log (`.xes`,
`.xes.gz`, `.xml`, `.json`), pick one or more discovery algorithms, and the tool discovers a
Petri net with each of them and computes structural complexity measures on every net: size,
density, control-flow complexity, depth, diameter, cyclicity and more. Results come back as a
miner × measure table plus the rendered nets.

The measures and miners are [ComFy](https://github.com/Pati-nets/ComFy) by Patrizia Schalk.
Discovery runs through [ProM4Py](https://doi.org/10.5281/zenodo.13853660), a bridge to the
ProM plugins. Batch mode runs the same analysis over up to ten logs in one job. A factor
analysis across the measures of many logs is the next step and not exposed yet.

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

Everything is reached through the frontend on <http://localhost:3000>; the API is not
published on the host, and the OpenAPI UI lives at <http://localhost:3000/api/docs>. The first
start builds the ProM4Py image, which downloads the ProM bundle and takes a while.

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
Graphviz. The HTTP layer is tested with a small stub tool registered by
`tests/conftest.py`, so those tests need neither Java nor a database server.

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
- **Limits.** 100 MB per uploaded file, 10 logs per batch, and a per-session cap on queued
  jobs. Request rate limits and the job cap are tunable in `.env` (see `.env.example`).

## Project structure

```
├── docs/                      # architecture, API, deployment
├── docker-compose.yml
└── src/
    ├── AlgoService/           # FastAPI backend + Celery worker
    │   ├── algorithms/        #   tool adapters (ComFy)
    │   ├── vendored/comfy/    #   ComFy sources, see PROVENANCE.md
    │   └── tests/
    ├── prom4py/               # Java ProM bridge
    └── frontend/              # Next.js frontend
```

## Credits

- [ComFy](https://github.com/Pati-nets/ComFy) by Patrizia Schalk: complexity measures, miner
  wrappers and factor analysis. Related measure code is published under the MIT licence in the
  [Complexity Toolkit](https://github.com/Pati-nets/Complexity-Toolkit).
- [ProM4Py](https://doi.org/10.5281/zenodo.13853660): Python access to the ProM plugins.
- [pm4py](https://processintelligence.solutions/pm4py) for reading logs and handling Petri nets.

The bundled sample log `src/AlgoService/sample_logs/small_example.xes` is a small synthetic log
(six traces over the activities a to e) made for testing.

## License

To be decided.
