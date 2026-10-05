# Architecture

## Overview

Six containerised services. The frontend is the only thing a user ever talks to; everything else is internal.

```
                  ┌──────────────────────┐
   browser ─────▶ │  Next.js frontend    │
                  │  (src/frontend)      │
                  └──────────┬───────────┘
                             │  REST + SSE
                             ▼
┌───────────────────────────────────────────────────────────┐
│                  FastAPI AlgoService                       │
│                  (src/AlgoService)                         │
│                                                            │
│   routes/  algorithms/  jobs_db.py  config.py              │
└──┬──────────────┬───────────────┬───────────────┬──────────┘
   │              │               │               │
   │ imports      │ HTTP /plugin  │ asyncpg       │ Celery
   ▼              ▼               ▼               ▼
vendored/comfy  prom4py        postgres          redis ──▶ celery_worker
(local patch)   (Java 8)       (Runs,            (broker   (re-uses the same
                ProM bundle    Artifacts,        +         AlgoService image,
                from Zenodo    Sessions,         backend,  runs analyses in
                               Users, Presets)   pub/sub)  a separate process)
```

| Container        | Role                                                                                                  |
|------------------|-------------------------------------------------------------------------------------------------------|
| `frontend`       | Next.js (App Router, TS). UI, file upload, parameter form, artifact rendering. No analysis logic.     |
| `algoservice`    | FastAPI app. Tool registry, job orchestration, SSE, ZIP export, input validation.                     |
| `celery_worker`  | Same image as `algoservice`, runs analyses in a separate process so the API stays responsive.         |
| `prom4py`        | Java 8 HTTP server (`launch.sh`) wrapping a frozen ProM bundle from Zenodo. Runs all ComFy miners.    |
| `postgres`       | Persistent state: `Run`, `Artifact`, `Session`, `User`, `Preset` (see `models.py`).                    |
| `redis`          | Celery broker + result backend, and pub/sub channel `jobs_updates` that drives the SSE stream.        |

Shared volumes:

- `uploaded_logs` (mounted at `/app/uploaded_logs` in `algoservice` and `celery_worker`): uploaded logs, scoped per session, at most the 10 most recent files per session.
- `artifacts_data` (mounted at `/app/artifacts`): large artifact files such as images and downloads.
- `postgres_data`: Postgres data directory.

## Tool categories

Each tool declares a `tool_type`; the frontend sidebar groups by it. The categories are data
(`TOOL_CATEGORIES` in `algorithms/base.py`, served by `GET /algorithms`), so a new category
needs no frontend change. Today there is one category, `complexity`, with one tool, `comfy`
(see [`algorithms.md`](algorithms.md)).

## pm4py and ProM4Py

- **pm4py** reads and converts logs, holds Petri nets and renders them.
- **ProM4Py** is an HTTP client (`vendored/comfy/prom4py/`, shared through
  `vendored/comfy/_shared_prom4py.py`) against the `prom4py` container. All miners ComFy
  analyses run there. Caveats:
  - The bundle is a frozen snapshot from `https://zenodo.org/records/13853660`; upgrading
    ProM means rebuilding the image against a new bundle.
  - The `/executor` endpoint runs arbitrary Java expressions, which is why the container is
    never published on the host.

## Job flow

Request → response is asynchronous. The HTTP request that uploads a log returns immediately with a `job_id`; the analysis runs in the background and pushes progress updates over SSE.

```
POST /algorithms/{id}/analyze
   │
   │ 1. Validate file (extension whitelist, 100 MB cap, XXE/DTD-safe XML parse)
   │ 2. Persist file under uploaded_logs/<session_id>/
   │ 3. Insert Run row (status="pending")
   │ 4. Enqueue Celery task (or local BackgroundTask if Redis is unavailable / in tests)
   ▼
celery_worker.run_analysis → routes.algorithms.run_analysis_task
   │
   │  for each progress tick:
   │    - check Run.status == "aborted" → raise if so
   │    - update Run.progress_pct / progress_msg
   │    - publish to Redis "jobs_updates" (throttled: ≥1.0% delta or ≥500 ms)
   │
   │  on completion:
   │    - write Artifact rows + files under artifacts/
   │    - Run.status = "completed" | "failed" | "aborted"
   │    - publish final update
```

`POST /algorithms/{id}/batch` works the same way with `celery_worker.run_batch`: one job
runs the tool over up to 10 logs in sequence, prefixes every artifact with its log's file
name, and puts a summary table of the per-log stats and a table of failed logs on top. A
failing log does not stop the batch. Batch runs are stored with `algorithm_id =
"_batch:<tool id>"`.

The frontend subscribes to `GET /jobs/events` (Server-Sent Events). `srv_main.py` runs a `redis_listener()` background task that bridges the Redis pub/sub channel into the in-process `SSEConnectionManager` (`config.py`), which fans out to all open browser connections.

Cooperative cancellation: `POST /progress/{task_id}/abort` flips `Run.status` to `aborted`; the tool's progress callback raises on the next tick.

## Sessions

Every browser gets an anonymous session via `SessionMiddleware` (cookie `session_id`). The session id scopes:

- `uploaded_logs/<session_id>/`: recent uploads, retrieved via `GET /recent-logs`.
- `Run.owner_session_id`: `GET /jobs`, `GET /jobs/{id}`, `DELETE /jobs[/{id}]` all filter by session.

`User` and `Preset` tables exist in the schema for future authenticated use; no login flow is wired up.

## Backend: AlgorithmBase interface

Every tool adapter implements:

```python
class AlgorithmBase:
    id: str
    name: str
    description: str
    paper_url: str | None
    author: str | None
    citation: str | None
    tool_type: ToolType                       # a category id from TOOL_CATEGORIES
    parameters_schema: list[ParameterSpec]
    secondary_files: list[SecondaryFile]      # optional extra uploads, e.g. a PNML
    def analyze(self, file_path: str, params: dict, ctx: RunContext) -> AnalysisResult: ...
    def coerce_params(self, raw: dict) -> dict: ...     # type-coerce + validate form values
```

`RunContext` is injected by the task runner. Adapters call:

- `ctx.progress(pct: float, message: str)`: emits an SSE update.
- `ctx.check_aborted()`: raises if the user clicked Abort; long-running loops should call it.
- `ctx.logger`: structured JSON logger.

`ParameterSpec` describes one parameter so the frontend can render an input:

```python
ParameterSpec(
    name: str,                       # e.g. "complexity_measures"
    label: str,                      # e.g. "Complexity measures"
    type: "int" | "float" | "bool" | "enum" | "multi_enum" | "string",
    default: Any,
    min: float | None,
    max: float | None,
    options: list[str] | None,       # for type="enum" / "multi_enum"
    help: str | None,
)
```

`AnalysisResult` is a list of typed **artifacts** plus an optional one-line summary.

### Artifact kinds

| `kind`  | `payload` keys                            | Renders as                                  |
|---------|-------------------------------------------|---------------------------------------------|
| `stat`  | `value`, `unit?`, `pct?`, `accent?`       | Number tile in a stats row                  |
| `table` | `columns`, `rows`                         | Sortable data table                         |
| `image` | `data_base64`, `mime`, `caption?`         | Inline image (PNG/SVG plots)                |
| `log`   | `data_base64`, `filename`, `mime?`        | Download tile                               |
| `text`  | `markdown`                                | Lightweight markdown paragraph              |

Adapters use the constructor helpers from `algorithms.base`: `stat`, `table`, `image`, `log_file`, `text`. Consecutive `stat` artifacts are grouped into one row in the frontend.

## REST API

The full list is in [`API.md`](API.md). In short: `GET /algorithms`, `GET /sample-logs`,
`GET /recent-logs`, `POST /log-stats`, `POST /algorithms/{id}/analyze`,
`POST /algorithms/{id}/batch`, and the job endpoints under `/jobs` and `/progress`.

## Frontend flow

1. On load: `GET /algorithms` → sidebar grouped by `tool_type`; `GET /sample-logs`, `GET /recent-logs` for the log-source picker.
2. The user selects a tool → the parameter form is rendered from its `parameters_schema`.
3. Picking a log fetches `POST /log-stats` for the log overview card.
4. **Run** → `POST /algorithms/{id}/analyze` with `FormData`, which returns a `job_id`.
5. An EventSource subscribes to `/jobs/events`. On each update, the frontend re-fetches `/jobs` (or the specific job).
6. When `status="completed"`, `<ResultPanel>` renders the artifacts; `<Artifacts>` dispatches to one component per artifact `kind`.
7. Optional: ZIP download via `/jobs/{job_id}/download`.

The `/batch` page does the same for several logs at once. `/runs` lists the session's history,
`/settings` holds local preferences and presets, `/api-access` shows scripting examples.

## Input safety

Every endpoint that accepts a log enforces:

- Extension whitelist: `.xes`, `.xes.gz`, `.xml`, `.json`.
- Size cap: 100 MB per file (streamed; rejected mid-upload if exceeded), 200 MB per batch.
- A `.xes.gz` may expand to at most 1 GB.
- XML hardening for `.xes` / `.xml` and secondary XML files: `lxml.etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False)`, and any `DOCTYPE` declaration is rejected outright (blocks XXE / billion-laughs / external DTD).

## Rate limiting

`slowapi` middleware, configured in `config.py`. Counter storage is the Redis container when `REDIS_URL` is set (shared across processes), in-memory otherwise. The key comes from `config.rate_limit_key`, which wraps `get_remote_address`.

Every limit is overridable from the environment (`RATE_LIMIT_DEFAULT`, `_LOG_STATS`, `_ANALYZE`, `_BATCH`), read through `env_config.rate_limit`. Defaults per client:

| Endpoint | Default |
|---|---|
| any | `120/minute` |
| `/log-stats` | `300/hour` |
| `/algorithms/{id}/analyze` | `60/hour` |
| `/algorithms/{id}/batch` | `20/hour` |

- Disabled when `RATE_LIMIT_DISABLED=1` or when `PYTEST_CURRENT_TEST` is set; `conftest.py` sets this before the app is imported.

**Request limits are not the load limit.** They cap how often someone *starts* work; one batch request is up to 10 runs. What bounds the machine is `MAX_ACTIVE_JOBS_PER_SESSION` (`jobs_db`, default 12), which counts what is queued or running. That is the value to lower for a public demo.

A malformed value in any of these stops the service at startup instead of falling back to the default, so a limit an operator believes they lowered cannot silently stay unapplied. Overrides in force are logged once at startup.

**Behind the reverse proxy, forwarding the client IP is only half of it.** nginx sets `X-Forwarded-For` and Next.js passes it through, but uvicorn's `ProxyHeadersMiddleware` only honours the header from peers listed in `forwarded_allow_ips`, whose default is `127.0.0.1`. Requests arrive from the frontend container, so without configuration every user would share one counter. `docker-compose.yml` sets `FORWARDED_ALLOW_IPS` to the compose subnet (both come from `COMPOSE_SUBNET`). Because a wrong value fails as silently as a missing one, `rate_limit_key` also detects the situation by its effect (an `X-Forwarded-For` present but not reflected in the resolved address) and logs one warning per process.

## Folder layout

```
├── docker-compose.yml
├── docs/
└── src/
    ├── prom4py/
    │   ├── Dockerfile           # downloads + de-signs ProM4Py bundle from Zenodo
    │   ├── launch.sh            # portable headless launcher
    │   └── README.md
    ├── AlgoService/
    │   ├── srv_main.py          # FastAPI app, CORS, sessions, SSE listener bootstrap, slowapi wiring
    │   ├── config.py            # APP_NAME, logger, SSE manager, Redis pub/sub helpers, Limiter
    │   ├── env_config.py        # operator-tunable limits from the environment
    │   ├── database.py          # SQLAlchemy async engine, AsyncSessionLocal, Base
    │   ├── models.py            # User, Session, Run, Artifact, Preset
    │   ├── jobs_db.py           # repository: CRUD on Runs / Artifacts
    │   ├── celery_worker.py     # Celery app + run_analysis / run_batch task wrappers
    │   ├── zip_export.py        # /jobs/{id}/download
    │   ├── log_stats.py         # descriptive stats behind /log-stats
    │   ├── alembic.ini, alembic/  # schema migrations
    │   ├── routes/
    │   │   ├── health.py        # /health
    │   │   ├── algorithms.py    # /algorithms, /sample-logs, /recent-logs, /log-stats, /analyze, /batch
    │   │   └── jobs.py          # /jobs, /jobs/events (SSE), /progress, /download, /notes
    │   ├── algorithms/
    │   │   ├── base.py          # AlgorithmBase, ParameterSpec, Artifact, AnalysisResult, RunContext
    │   │   ├── __init__.py      # REGISTRY
    │   │   ├── _log_io.py       # reads .xes / .xes.gz / .xml / .json logs
    │   │   ├── _prom4py.py      # shared ProM4Py client
    │   │   ├── _petrinet.py     # Petri net → base64 PNG
    │   │   └── comfy.py         # ComFy adapter
    │   ├── vendored/comfy/      # ComFy sources, see PROVENANCE.md
    │   ├── sample_logs/         # bundled XES samples
    │   ├── tests/
    │   ├── Dockerfile
    │   └── requirements.txt
    └── frontend/
        ├── app/                 # Next.js App Router: /, /batch, /runs, /settings, /api-access
        ├── components/          # workbench, batch builder, jobs drawer, artifact viewers, ui/
        ├── lib/
        │   ├── api.ts           # typed AlgoService client
        │   ├── app-config.ts    # APP_NAME, REPO_URL
        │   └── i18n/            # en/de strings
        ├── Dockerfile
        └── package.json
```
