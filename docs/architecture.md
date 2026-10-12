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
│   routes/  algorithms/  factor_analysis/  jobs_db.py       │
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
| `frontend`       | Next.js (App Router, TS). UI, file upload, parameter forms, charts, artifact rendering. No analysis logic. |
| `algoservice`    | FastAPI app. Tool registry, factor analysis, job orchestration, SSE, ZIP export, input validation.    |
| `celery_worker`  | Same image as `algoservice`; runs single-log analyses and dataset jobs in a separate process.         |
| `prom4py`        | Java 8 HTTP server (`launch.sh`) wrapping a frozen ProM bundle from Zenodo. Runs all ComFy miners; restarts itself when a call is stuck. |
| `postgres`       | Persistent state: `Run`, `Artifact`, `Session`, `User`, `Preset` (see `models.py`).                    |
| `redis`          | Celery broker + result backend, and pub/sub channel `jobs_updates` that drives the SSE stream.        |

Shared volumes:

- `uploaded_logs` (mounted at `/app/uploaded_logs` in `algoservice` and `celery_worker`): uploaded logs, scoped per session, at most the 10 most recent files per session.
- `artifacts_data` (mounted at `/app/artifacts`): large artifact files such as images and downloads, and the factor-analysis datasets under `artifacts/datasets/<session_id>/<dataset_id>/`.
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
  - The Hybrid ILP miner needs the native lp_solve 5.5 libraries; the image installs the
    solver from Ubuntu and compiles its JNI wrapper
    ([`src/prom4py/README.md`](../src/prom4py/README.md#lp_solve)).
  - The `/executor` endpoint runs arbitrary Java expressions, which is why the container is
    never published on the host.
  - ProM4Py serves one request at a time and cannot cancel one, and some miners run for
    very long on some logs (Alpha++ for more than 15 minutes on a 1000-trace PDC log). See
    below how such a call is bounded.

### Bounded ProM calls

One discovery, one miner on one log with all of its requests, may take
`PROM4PY_CALL_TIMEOUT` seconds (default 300, set in `.env` for all three containers below).

- **Client** (`vendored/comfy/_shared_prom4py.py`, `algorithms/_prom4py.py`,
  `algorithms/comfy.py: discover`). Every request of the shared client has a timeout; within
  a discovery the requests share one budget. On expiry `discover` raises `ProMTimeout`
  ("ProM took longer than 300 s for Alpha Plus Plus miner on pdc2025_02001100.xes"). It is
  not repeated. The dataset job lists it as a failed input and goes on, a single run shows
  `ERR: ProMTimeout` cells and the message in its notes (or fails with it if no miner
  worked).
- **Turns.** The worker processes of a container take turns on ProM for a whole discovery
  (file locks under `/tmp`). A call therefore never waits behind another job's call, its
  timeout measures its own work, and the watchdog below never cuts off a call that is still
  awaited. A job that is waiting gets the next turn, before the job that just had it starts
  its next discovery, so two jobs at once alternate per discovery. A process waiting for its
  turn reports "waiting for ProM, another job is using it" as job progress, and can be
  aborted meanwhile.
- **Watchdog** (`src/prom4py/launch.sh`). ProM goes on with a timed-out call. The watchdog
  in the container probes `/isRunning`, which a busy ProM does not answer, and restarts Java
  when no probe has been answered for `PROM4PY_CALL_TIMEOUT` + 30 s, or when Java exited. A
  restart takes about 5 s. Details in [`src/prom4py/README.md`](../src/prom4py/README.md#watchdog).
- **Recovery.** After a timeout, the next discovery waits until ProM answers again ("waiting
  for ProM to restart"), for up to `PROM4PY_CALL_TIMEOUT` + 60 s (at least 180 s): the
  watchdog counts from ProM's last answer before the stuck request, which can come well
  after the discovery started, so the restart can follow the timeout by up to about
  `PROM4PY_CALL_TIMEOUT` + 40 s. If ProM is not back by then, that input fails with "ProM
  did not finish restarting". One that finds ProM refused or the connection dropped
  (starting, restarted, crashed) waits up to 180 s for it and starts the whole discovery
  over, since a restart empties ProM's object cache; at most three attempts. When ProM does
  not come back, the input fails with "ProM4Py is not reachable", and later inputs wait only
  5 s each until ProM answers anything again.
- **Startup.** `algoservice` and `celery_worker` depend on `prom4py` being started, not
  healthy, so a stuck or starting ProM does not hold up `docker compose up`; jobs started
  before ProM is up wait for it as above.

A worker blocked in a ProM call is free again at the latest after `PROM4PY_CALL_TIMEOUT`, also
when its job was aborted, and ProM usually about half a minute later.

Each input that times out costs its job about `PROM4PY_CALL_TIMEOUT` + 40 s, the timeout and
the wait for the restart. Celery kills a job after an hour (`task_time_limit` in
`celery_worker.py`), and a dataset job keeps its rows in memory until the end, so at the default
of 300 s about ten hanging inputs lose the whole dataset (it is marked failed by the 70-minute
rule below). Keep the slow miners out of large dataset jobs, or lower `PROM4PY_CALL_TIMEOUT`.

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

Dataset jobs of the factor analysis (`POST /factor-analysis/datasets` with `source=logs` or
`pnml`) use the same machinery with `celery_worker.build_dataset`; see below. Older runs of the
removed batch mode keep their `algorithm_id = "_batch:<tool id>"` and still show in the history.

The frontend subscribes to `GET /jobs/events` (Server-Sent Events). `srv_main.py` runs a `redis_listener()` background task that bridges the Redis pub/sub channel into the in-process `SSEConnectionManager` (`config.py`), which fans out to all open browser connections.

Cooperative cancellation: `POST /progress/{task_id}/abort` flips `Run.status` to `aborted`; the tool's progress callback raises on the next tick. A ProM call in progress is not interrupted: the worker gets to that tick when the call returns or times out (see [Bounded ProM calls](#bounded-prom-calls)).

## Factor analysis

The main feature. Code in `factor_analysis/`, endpoints in `routes/factor_analysis.py`, the
API in [`API.md`](API.md#factor-analysis).

A **dataset** is a numeric matrix, rows = observations, columns = measures, of one *kind*:

- `model`: ComFy measures of Petri nets. Rows are "log / miner" (logs discovered with the
  ProM4Py miners) or one row per PNML file (read with pm4py).
- `log`: event-log measures computed with [feeed](https://github.com/andreamalhera/feeed),
  grouped as in ComFy for log measures (`vendored/comfy_log/Constants.py`). One row per log.

Sources:

| Source | Ready | Where the values come from |
|---|---|---|
| `bundled` | at once | `datasets/manifest.json`: the scores of the ComFy paper (7 miners × 288 PDC 2025 logs) and the PDC log measures of ComFy for log measures (2112 logs). |
| `csv` | at once | One uploaded CSV; a non-numeric first column holds the row labels. |
| `logs` | job | Up to 50 XES files, or the bundled sample `pdc-sample-logs` (4 PDC logs). |
| `pnml` | job | Up to 200 PNML files, or the bundled sample `pdc-sample-models` (32 nets). |

```
POST /factor-analysis/datasets (logs | pnml)
   │ 1. Validate kind, source, measures/miners/groups; save, decompress and XXE-check the files
   │ 2. Write artifacts/datasets/<session>/<id>/meta.json (status "computing")
   │ 3. Insert Run row with algorithm_id "_dataset:<kind>"; enqueue celery_worker.build_dataset
   ▼
routes.factor_analysis.run_dataset_task → factor_analysis.compute
   │  model/logs: per log and miner: discover via ProM4Py, then each ComFy measure
   │  model/pnml: per net: read with pm4py, then each ComFy measure
   │  log/logs:   per log: feeed features of the chosen groups
   │  progress and abort as for single runs; failed inputs are listed, not fatal
   ▼
storage.store_matrix: clean (core.clean_matrix), write the matrix, status "ready"
```

The **analysis** (`core.analyze`) is synchronous and runs in the API process on every
parameter change:

1. Cleaning, once when the dataset is stored: rows with more than half of their values
   missing go first (an input on which every measure failed); then non-numeric, constant,
   incomplete and perfectly correlated measures are dropped (the first of a duplicate pair is
   kept), as in ComFy for log measures.
2. Bartlett's test of sphericity, with log det R from the eigenvalues (the numerically stable
   variant of ComFy for log measures).
3. KMO/MSA; with the filter on, every measure below the threshold is removed and the MSA is
   recomputed until all remaining measures pass, as ComFy's
   `repeat_calculate_measure_of_sampling_adequacy` does.
4. Eigenvalues of the correlation matrix for the scree plot; the suggestion is the Kaiser
   criterion (eigenvalue > 1).
5. `factor_analyzer` with the chosen rotation, then each measure is assigned to the factor with
   its largest absolute loading if that reaches the loading threshold and its communality the
   communality threshold (defaults per kind: ComFy's 0.35 and none for model measures,
   ComFy for log measures' 0.5 and 0.5 for log measures).

For oblique rotations factor_analyzer's own communalities sum the squared pattern loadings,
which is wrong once the factors correlate; `core` computes them as `rowsum(P * S)` from the
pattern and structure matrices, so they equal the unrotated ones, and returns the structure
matrix and the factor correlations as well. Heywood cases are flagged at a communality of
about 0.995, where minres stops (uniqueness bounded below by 0.005).

A singular correlation matrix (common with log measures, e.g. `iqr = q3 - q1`) is analysed as
upstream does and reported as a warning. KMO then rests on a pseudo-inverse and Bartlett's
chi-square on clamped eigenvalues (`bartlett.regularised`), so measures with an MSA at the
threshold can come out differently on different platforms. Fits are cached by data, factor
count and rotation; at most two run at once per API process. On the bundled Inductive-miner
scores the result equals ComFy's own report to four decimals
(`tests/test_factor_analysis_core.py`); the bundled log measures equal the upstream code run
in the same environment, but not necessarily its published output (see
`datasets/PROVENANCE.md`).

A dataset whose job is still running 70 minutes after it started outlived Celery's time limit
(for example because the worker restarted); reading it marks the job and the dataset failed,
and pruning removes such datasets with their inputs.

### Interpretation by Claude

Optional, in `interpretation/` with the endpoints in `routes/interpretation.py`
([`API.md`](API.md#interpretation-by-claude)). `POST .../interpret` runs the analysis, then:

1. A precomputed file in `datasets/interpretations/` for a bundled dataset is served if its
   data hash, parameters and prompt digest match (no key needed). A lookup with
   `cached_only` and `n_factors` skips the analysis for steps 1 and 2.
2. The cache: `artifacts/interpretations/` for bundled datasets, shared by all sessions, or
   `interpretations/` in the dataset directory for own data. The key hashes the cleaned
   matrix (values and measure names, not row labels), the parameters with the factor count
   used, the language, the model, the effort and `client.PROMPT_DIGEST`, a hash of the
   prompt, the output schema and the payload format.
3. Otherwise, with `ANTHROPIC_API_KEY` set, `payload.build_payload` reduces the result to the
   measure names, their catalog definitions and aggregates, and `client.check_size` refuses
   it if it is too large. Then, one request per cache key at a time, the per-session and
   daily limits are counted (`interpretation/quota.py`, counters in Redis) and
   `client.interpret` calls `client.beta.messages.create` with `output_config` (effort and a
   JSON schema from `schema.Interpretation`) and `fallbacks: "default"`, within the time the
   analysis left of 170 s. It checks `stop_reason` before it reads the answer, validates it,
   trims it to the factors and measures of the analysis and rejects it if a factor is
   missing.

### Dataset lifecycle

A dataset lives in `artifacts/datasets/<session>/<id>/`: `meta.json` (kind, name, source,
status, `inputs`, the results of the cleaning, the saved `options`), `data.csv` once it is
ready, `inputs/` while a job waits for its uploads, and `interpretations/` with the cached
interpretations of an own dataset. Datasets are session-scoped: at most 30 per session (when a
new one is created, the finished ones whose `meta.json` was written longest ago are pruned;
saving options rewrites it), and the datasets of sessions idle for seven days are removed. Both
delete the jobs of the removed datasets as a delete does. Every write of `meta.json` goes to a
temporary file that is then renamed into place.

- **List and reopen.** `GET /factor-analysis/datasets` reads the `meta.json` files of the
  session (`storage.list_metas`), newest first by `created_at`. A computing dataset takes its
  status from its job as in `GET /datasets/{id}`, so a stale job is failed here too. The Data
  step lists the datasets of its kind and opens one the way the `?dataset=` link does.
  `inputs` records what a dataset was made from; datasets stored before it was recorded count
  their files from their observations and failures.
- **Options.** After a successful analysis the UI stores its parameters with
  `PUT .../options` (`options` in `meta.json`) and starts from them when the dataset is
  reopened. They are checked with `core.check_params`, the checks of the analysis that need
  no fit (known exclusions, enough measures and observations, the factor count); the analysis
  does not run again.
- **Delete.** `DELETE /datasets/{id}` marks a still running job `aborted`, as
  `POST /progress/{id}/abort` does, so its worker stops at the next progress tick; then it
  deletes the Run row with its artifact directory and the dataset directory. The ticks come
  between inputs (for logs mined into nets also between miners and measures), so for every
  source a slow input keeps its worker process busy until it is done, at most for Celery's
  time limit of an hour, while the job no longer counts against the limits. Interpretations
  of bundled datasets are in the shared directory and stay. `DELETE /datasets` does this for
  every dataset of the session or of one kind.
- **Hooks.** A dataset job carries `dataset_id` in its params, and `dataset_name` when the
  dataset was named or made from a sample; for a name the server made up (`name_auto` in
  `meta.json`) the UI names job and dataset after the inputs, in its own language.
  `DELETE /jobs/{id}` and `DELETE /jobs` (`routes/jobs.py`) delete the dataset of every
  dataset job they delete, so the run history and the dataset list do not drift apart.
- **ZIP.** `POST .../export/zip` runs the analysis once and packs it with
  `export.analysis_zip`: the result, the matrix as the download writes it, the loadings and
  the other tables, a manifest with the dataset, the parameters (with the factor count and
  rotation the analysis used), the library versions and the provenance (`provenance.py`:
  tool version and commit, upstream commits, feeed and pm4py versions, miners with their
  ProM4Py calls and parameters, recorded in `meta.json` when the dataset is created), and a
  README whose factor_analyzer snippet reproduces the loadings
  (`tests/test_dataset_history.py` runs it). An interpretation is
  added only if `interpretation.store.lookup`, the lookup behind `cached_only`, finds one, so
  an export never leads to a paid call.

## Sessions

Every browser gets an anonymous session via `SessionMiddleware` (cookie `session_id`). The session id scopes:

- `uploaded_logs/<session_id>/`: recent uploads, retrieved via `GET /recent-logs`.
- `artifacts/datasets/<session_id>/`: factor-analysis datasets.
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

The full list is in [`API.md`](API.md). In short: the factor analysis under
`/factor-analysis` (`catalog`, `datasets`, `datasets/{id}`, `.../options`, `.../download`,
`.../analyze`, `.../export`, `.../export/zip`), the single-log endpoints `GET /algorithms`, `GET /sample-logs`,
`GET /recent-logs`, `POST /log-stats`, `POST /algorithms/{id}/analyze`, and the job endpoints
under `/jobs` and `/progress`.

## Frontend flow

The two main tabs, **Model complexity** (`/`) and **Log complexity** (`/log`), are the same
five-step view (`components/factor-analysis/`) for the two kinds:

1. **Data**: the datasets of the session (`GET /factor-analysis/datasets?kind=...`) to reopen
   or delete, and the sources of the catalog (`GET /factor-analysis/catalog?kind=...`):
   bundled datasets, CSV, logs (or the sample logs) and, on the model tab, PNML (or the
   sample nets); miners and measures or feature groups for the computed sources. Submitting
   calls `POST /factor-analysis/datasets`; a job is polled through `GET /datasets/{id}` and can
   be cancelled with the abort endpoint.
2. **Dataset**: size, dropped measures with reasons, a preview, the CSV download.
3. **Suitability**: Bartlett and KMO, the MSA filter and a per-measure MSA table with manual
   exclusion.
4. **Factors**: hand-written SVG scree plot, factor count and rotation.
5. **Loadings**: heatmap table, communalities, variance, factor groups, CSV/LaTeX export and
   the whole analysis as a ZIP (`POST /datasets/{id}/export/zip`, with the options and the
   language on screen).

Every parameter change re-runs `POST /datasets/{id}/analyze`, debounced by 300 ms. The options
of each new analysis are saved with the dataset (`PUT /datasets/{id}/options`, debounced, fire
and forget; a save still waiting is sent when the dataset, the tab or the page is left), and a
dataset opens with its saved options or else the defaults. The id of the last dataset is kept
per tab in `localStorage`. "My datasets", the first source of the data step, reopens a dataset
the same way as a `?dataset=<id>` link or deletes it (`DELETE /datasets/{id}`); a remembered or
linked dataset that answers 404 is reported in the data step instead of being dropped
silently. A dataset without a name of its own (`name_auto`) and its job are called after the
inputs in the UI language. The jobs drawer slides over the two tabs as a modal dialog that
keeps the focus and holds the page still (on `/inspect` it is a column on wide screens), and
dataset jobs there and in the run history link to their tab with `?dataset=<id>`, which also
works while the tab is open. Every delete of a dataset, there included, is confirmed first.
The settings delete all datasets of the session (`DELETE /datasets`) together with their
`localStorage` entries.

The single-log ComFy workbench lives at `/inspect` ("Inspect a single log" on the model tab):

1. On load: `GET /algorithms` → sidebar grouped by `tool_type`; `GET /sample-logs`, `GET /recent-logs` for the log-source picker.
2. The user selects a tool → the parameter form is rendered from its `parameters_schema`.
3. Picking a log fetches `POST /log-stats` for the log overview card.
4. **Run** → `POST /algorithms/{id}/analyze` with `FormData`, which returns a `job_id`.
5. An EventSource subscribes to `/jobs/events`. On each update, the frontend re-fetches `/jobs` (or the specific job).
6. When `status="completed"`, `<ResultPanel>` renders the artifacts; `<Artifacts>` dispatches to one component per artifact `kind`.
7. Optional: ZIP download via `/jobs/{job_id}/download`.

`/runs` lists the session's history, `/settings` holds local preferences and presets,
`/api-access` shows scripting examples.

## Input safety

Every endpoint that accepts a log enforces:

- Extension whitelist: `.xes`, `.xes.gz`, `.xml`, `.json` for single runs; `.xes`, `.xes.gz`
  for dataset logs, `.pnml` for nets, `.csv` for tables.
- Size cap: 100 MB per file; per dataset request at most 50 logs or 200 nets and 500 MB in
  total, counted after decompression. Starlette receives the whole multipart body before the
  route runs, so these checks reject a request after the upload, not during it; the reverse
  proxy's `client_max_body_size` is what stops a larger body early. A CSV may have at most
  100 000 rows and 1000 columns; the header is checked first and at most one row more than
  the limit is parsed.
- A `.xes.gz` may expand to at most 1 GB.
- XML hardening for `.xes` / `.xml` and secondary XML files: `lxml.etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False)`, and any `DOCTYPE` declaration is rejected outright (blocks XXE / billion-laughs / external DTD).

## Rate limiting

`slowapi` middleware, configured in `config.py`. Counter storage is the Redis container when `REDIS_URL` is set (shared across processes), in-memory otherwise. The key comes from `config.rate_limit_key`, which wraps `get_remote_address`.

Every limit is overridable from the environment (`RATE_LIMIT_DEFAULT`, `_LOG_STATS`, `_ANALYZE`, `_DATASETS`, `_DATASET_STATUS`, `_FA_ANALYZE`), read through `env_config.rate_limit`. Defaults per client:

| Endpoint | Default |
|---|---|
| any | `120/minute` |
| `/log-stats` | `300/hour` |
| `/algorithms/{id}/analyze` | `60/hour` |
| `POST /factor-analysis/datasets` | `60/hour` |
| `GET /factor-analysis/datasets/{id}` (polled while a dataset is computed); listing and deleting datasets, `PUT .../options` | `600/minute` |
| `/factor-analysis/datasets/{id}/analyze`, `.../export`, `.../export/zip`, `.../interpret` | `120/minute` |

- Disabled when `RATE_LIMIT_DISABLED=1` or when `PYTEST_CURRENT_TEST` is set; `conftest.py` sets this before the app is imported.

**Request limits are not the load limit.** They cap how often someone *starts* work; one dataset request can be 50 logs times several miners. What bounds the machine is `MAX_ACTIVE_JOBS_PER_SESSION` (`jobs_db`, default 12), which counts what is queued or running. That is the value to lower for a public demo. A client that drops the session cookie gets a new session with every request, so dataset jobs are also capped over all sessions by `MAX_ACTIVE_DATASET_JOBS` (default 4): the miners share one single-CPU `prom4py` and take turns on it, and a ProM4Py call cannot be interrupted, only bounded by `PROM4PY_CALL_TIMEOUT`, so this is what keeps one visitor from blocking the others for long.

A malformed value in any of these stops the service at startup instead of falling back to the default, so a limit an operator believes they lowered cannot silently stay unapplied. Overrides in force are logged once at startup.

**Behind the reverse proxy, forwarding the client IP is only half of it.** nginx sets `X-Forwarded-For` and Next.js passes it through, but uvicorn's `ProxyHeadersMiddleware` only honours the header from peers listed in `forwarded_allow_ips`, whose default is `127.0.0.1`. Requests arrive from the frontend container, so without configuration every user would share one counter. `docker-compose.yml` sets `FORWARDED_ALLOW_IPS` to the compose subnet (both come from `COMPOSE_SUBNET`). Because a wrong value fails as silently as a missing one, `rate_limit_key` also detects the situation by its effect (an `X-Forwarded-For` present but not reflected in the resolved address) and logs one warning per process.

## Folder layout

```
├── docker-compose.yml
├── docs/
└── src/
    ├── prom4py/
    │   ├── Dockerfile           # downloads + de-signs ProM4Py bundle from Zenodo
    │   ├── launch.sh            # portable headless launcher, watchdog and healthcheck
    │   └── README.md
    ├── AlgoService/
    │   ├── srv_main.py          # FastAPI app, CORS, sessions, SSE listener bootstrap, slowapi wiring
    │   ├── config.py            # APP_NAME, logger, SSE manager, Redis pub/sub helpers, Limiter
    │   ├── env_config.py        # operator-tunable limits from the environment
    │   ├── database.py          # SQLAlchemy async engine, AsyncSessionLocal, Base
    │   ├── models.py            # User, Session, Run, Artifact, Preset
    │   ├── jobs_db.py           # repository: CRUD on Runs / Artifacts
    │   ├── celery_worker.py     # Celery app + run_analysis / build_dataset task wrappers
    │   ├── zip_export.py        # /jobs/{id}/download
    │   ├── provenance.py        # tool version and commit, upstream code, miners and parameters
    │   ├── log_stats.py         # descriptive stats behind /log-stats
    │   ├── alembic.ini, alembic/  # schema migrations
    │   ├── routes/
    │   │   ├── health.py        # /health
    │   │   ├── algorithms.py    # /algorithms, /sample-logs, /recent-logs, /log-stats, /analyze
    │   │   ├── factor_analysis.py # /factor-analysis: catalog, datasets, analyze, export
    │   │   ├── interpretation.py  # /factor-analysis/.../interpret and interpretation/status
    │   │   └── jobs.py          # /jobs, /jobs/events (SSE), /progress, /download, /notes
    │   ├── algorithms/
    │   │   ├── base.py          # AlgorithmBase, ParameterSpec, Artifact, AnalysisResult, RunContext
    │   │   ├── __init__.py      # REGISTRY
    │   │   ├── _log_io.py       # reads .xes / .xes.gz / .xml / .json logs
    │   │   ├── _prom4py.py      # shared ProM4Py client, turns on ProM, waiting for it
    │   │   ├── _petrinet.py     # Petri net → base64 PNG
    │   │   └── comfy.py         # ComFy adapter
    │   ├── factor_analysis/
    │   │   ├── core.py          # cleaning, Bartlett, KMO/MSA filter, factor fit, assignment
    │   │   ├── compute.py       # measure values from logs (ProM4Py miners, feeed) or PNML
    │   │   ├── catalog.py       # measures, miners, feature groups, bundled data, samples
    │   │   ├── storage.py       # session-scoped datasets on disk
    │   │   ├── published.py     # the published numbers of the bundled datasets
    │   │   └── export.py        # loadings as CSV / LaTeX, matrix as CSV, analysis as ZIP
    │   ├── interpretation/      # factor names by Claude: payload, prompt, client, cache, limits
    │   ├── scripts/             # precompute_interpretations.py, extract_published.py
    │   ├── datasets/            # bundled scores and sample logs/nets, see PROVENANCE.md
    │   ├── vendored/comfy/      # ComFy sources, see PROVENANCE.md
    │   ├── vendored/comfy_log/  # ComFy for log measures constants, MIT
    │   ├── sample_logs/         # bundled XES samples
    │   ├── tests/
    │   ├── Dockerfile
    │   └── requirements.txt
    └── frontend/
        ├── app/                 # Next.js App Router: /, /log, /inspect, /runs, /settings, /api-access
        ├── components/          # factor-analysis/, workbench, jobs drawer, artifact viewers, ui/
        ├── lib/
        │   ├── api.ts           # typed AlgoService client
        │   ├── factor-analysis.ts # formatting and defaults of the factor analysis view
        │   ├── app-config.ts    # APP_NAME, REPO_URL
        │   └── i18n/            # en/de strings
        ├── Dockerfile
        └── package.json
```
