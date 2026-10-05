# API Access

Run the analyses from your own scripts. There is no authentication —
every request is scoped to the caller's session cookie.

## Interactive reference

The backend serves a fully interactive OpenAPI 3 spec:

- Swagger UI: `https://<host>/api/docs`
- ReDoc: `https://<host>/api/redoc`
- Raw spec: `https://<host>/api/openapi.json`

For local development with the default `docker compose up`:

- `http://localhost:3000/api/docs` (when reaching the backend through the Next.js proxy)
- `http://localhost:8000/docs` (direct backend access — Swagger UI's spec link is wrong in this mode because `FASTAPI_ROOT_PATH=/api` is set for the proxy; use the proxied URL instead)

## Quick start — Python

```python
import time
import requests

BASE = "http://localhost:3000/api"  # change to your deployment URL

# 1. Discover available algorithms (and the parameters each one accepts)
algorithms = requests.get(f"{BASE}/algorithms").json()
print([a["id"] for a in algorithms["algorithms"]])

# 2. Submit a log for analysis
with open("event_log.xes", "rb") as f:
    submit = requests.post(
        f"{BASE}/algorithms/comfy/analyze",
        files={"file": f},
        data={
            "discovery_algorithms": ["Inductive miner"],
            "complexity_measures": ["Size", "Density"],
        },
    )
submit.raise_for_status()
job_id = submit.json()["job_id"]

# 3. Poll until the job finishes
while True:
    job = requests.get(f"{BASE}/jobs/{job_id}").json()
    if job["status"] in ("completed", "failed", "aborted"):
        break
    print(f"{job['percentage']:.0f}% — {job['progress_status']}")
    time.sleep(1.5)

# 4. Read the result
if job["status"] == "completed":
    for art in job["result"]["artifacts"]:
        print(art["kind"], art["label"])
else:
    print("Job failed:", job.get("error"))
```

Use a single `requests.Session()` for multiple calls if you want the server to
treat them as the same caller (consistent job history, recent uploads, …).

## Quick start — curl

```bash
# List algorithms
curl http://localhost:3000/api/algorithms

# Submit a log for analysis
curl -X POST \
  -F "file=@event_log.xes" \
  -F "discovery_algorithms=Inductive miner" \
  -F "complexity_measures=Size" \
  http://localhost:3000/api/algorithms/comfy/analyze

# Poll a job
curl http://localhost:3000/api/jobs/<job_id>

# Download the full result ZIP
curl -OJ http://localhost:3000/api/jobs/<job_id>/download
```

## Endpoint summary

All paths are relative to `/api/` when accessed through the Next.js proxy.

### Catalog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/algorithms` | Every registered algorithm + its parameter schema. |
| GET | `/sample-logs` | Built-in example logs you can use without uploading. |
| GET | `/recent-logs` | Logs your session has uploaded recently. |

### Run jobs

| Method | Path | Description |
|--------|------|-------------|
| POST | `/algorithms/{id}/analyze` | Run one algorithm over one log. |
| POST | `/log-stats` | Cheap descriptive statistics of one log (traces, events, activities, variants, trace lengths, time range, top activities). |

### Factor analysis

Details in [Factor analysis](#factor-analysis) below.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/factor-analysis/catalog?kind=model` or `kind=log` | Measures, miners (model) or feature groups (log), each with `slow: true` where it can take long, defaults, bundled datasets and sample inputs. |
| POST | `/factor-analysis/datasets` | Create a dataset from bundled data or a CSV (ready at once), or from logs or PNML files (background job). |
| GET | `/factor-analysis/datasets/{id}` | Status, progress, measures, dropped measures and the first 2000 rows. |
| GET | `/factor-analysis/datasets/{id}/download` | The cleaned matrix as CSV. |
| POST | `/factor-analysis/datasets/{id}/analyze` | Bartlett, KMO with the MSA filter, eigenvalues, factor analysis and factor groups. |
| POST | `/factor-analysis/datasets/{id}/export` | The loadings table as CSV or LaTeX. |
| GET | `/factor-analysis/interpretation/status` | Whether factors can be interpreted by Claude, and with which model. |
| POST | `/factor-analysis/datasets/{id}/interpret` | Names and short interpretations of the factors by Claude (optional, needs an API key on the server). |

### Job lifecycle

| Method | Path | Description |
|--------|------|-------------|
| GET | `/jobs` | All jobs visible to your session. |
| GET | `/jobs/{job_id}` | Status, progress, and (once finished) the full result. |
| GET | `/jobs/{job_id}/download` | ZIP archive of every artifact the job produced. |
| GET | `/jobs/events` | Server-Sent Events stream — pings whenever job state changes. |
| GET | `/progress/{task_id}` | Lower-level SSE stream for a single task. |
| POST | `/progress/{task_id}/abort` | Request cooperative cancellation. |
| DELETE | `/jobs/{job_id}` | Delete one job and its artifacts. |
| DELETE | `/jobs` | Delete every job visible to your session. |
| PATCH | `/jobs/{job_id}/notes` | Set or clear a free-text note on a job. |

### Diagnostics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Readiness probe — 200 when the DB is reachable. |

## Notes & limits

- **Rate limits** (per source IP, tunable via `RATE_LIMIT_*` in `.env`): `60/hour` for `POST /algorithms/{id}/analyze`, `60/hour` for `POST /factor-analysis/datasets` (`RATE_LIMIT_DATASETS`; choosing a bundled dataset counts too), `600/minute` for `GET /factor-analysis/datasets/{id}`, which the UI polls (`RATE_LIMIT_DATASET_STATUS`), `120/minute` for factor-analysis `analyze`, `export` and `interpret` (`RATE_LIMIT_FA_ANALYZE`), `300/hour` for `POST /log-stats`, `120/minute` for everything else. A 429 carries `detail` and `"code": "rate_limited"`. Interpretations that call Claude are limited further, see [Interpretation by Claude](#interpretation-by-claude).
- **Job quota:** at most 12 queued or running jobs per session (`MAX_ACTIVE_JOBS_PER_SESSION`), and at most 4 dataset jobs over all sessions (`MAX_ACTIVE_DATASET_JOBS`); both answer 429.
- **Upload size:** 100 MB per file. Factor-analysis datasets: at most 50 logs or 200 PNML
  files and 500 MB in total per request, `.xes.gz` counted decompressed.
- **Allowed extensions:** `.xes`, `.xes.gz`, `.xml`, `.json` for single runs; `.xes`,
  `.xes.gz`, `.pnml` and `.csv` for factor-analysis datasets.
- **Session:** a signed cookie is set on the first request. Reuse it (e.g.
  `requests.Session()`) to keep your `recent-logs` and job
  history in sync with the web UI.
- **Parameter validation:** every algorithm's parameter schema lives in
  `/algorithms` under `parameters_schema`. Sending unknown keys returns 400
  with a structured error payload (`detail.type == "validation_error"`,
  `detail.errors` keyed by parameter name).

## Factor analysis

A factor analysis looks for a few latent factors behind many complexity measures. It runs on
a **dataset**: a numeric matrix with one row per observation and one column per measure.
There are two kinds, each with its own catalog:

- `model`: ComFy's Petri-net measures. A row is one net, either `<log> / <miner>` when nets
  are discovered from logs (through ProM4Py) or one uploaded PNML file.
- `log`: event-log measures computed with [feeed](https://github.com/andreamalhera/feeed), in
  the feature groups of ComFy for log measures. A row is one log.

A dataset belongs to the session that created it and is kept on the server next to the job
artifacts (30 per session; a session unused for a week is removed).

### Create a dataset

`POST /factor-analysis/datasets`, multipart form:

| Field | Value |
|-------|-------|
| `kind` | `model` or `log` |
| `source` | `bundled`, `csv`, `logs`, or `pnml` (model only) |
| `bundled_id` | For `bundled`: a dataset id from `catalog.bundled`. For `logs` / `pnml` without files: a sample id from `catalog.samples`. |
| `measures` | Optional JSON array. For `logs` / `pnml`: the measures to compute (default: `catalog.defaults.measures`). For `bundled` / `csv`: the columns to keep. |
| `miners` | Optional JSON array, `kind=model, source=logs` (default: Inductive miner). |
| `groups` | Optional JSON array of feeed feature groups, `kind=log, source=logs`; ignored when `measures` is given. |
| `name` | Optional display name. |
| `files` | Repeated. One `.csv`; up to 50 `.xes` / `.xes.gz`; up to 200 `.pnml`. |

`bundled` and `csv` answer `{"dataset_id", "status": "ready"}`. `logs` and `pnml` answer
`{"dataset_id", "status": "computing", "job_id"}`; the job shows up in `/jobs` like any run.
Poll `GET /factor-analysis/datasets/{id}` until `status` is `ready` or `failed`; while it
computes, `progress` holds the job percentage. `?rows=n` (0 to 2000, default 2000) limits the
preview in `observations` and `values`. A job still running after 70 minutes, longer than the
worker's time limit, is taken as lost and its dataset marked `failed`.

A CSV may use `,`, `;` or tab as separator and decimal commas, with at most 100 000 rows and
1000 columns. The first column holds the row labels if it is unnamed, not numeric, or named
`observation`, `id`, `name` or `label` (so a downloaded dataset can be uploaded again);
otherwise the rows are numbered.

**Cleaning** runs once when the dataset is stored. First, rows with more than half of their
values missing are dropped, e.g. a log on which every measure failed. Then, as in ComFy for log
measures, measures are dropped and reported in `dropped`: with a non-numeric value
(`non_numeric`), with any missing or infinite value left (`missing`), without variance
(`constant`), and perfectly correlated with an earlier one (`duplicate`, the first is kept).
Each entry has an English `detail` and its values in `params`.

For `logs` and `pnml`, `failures` lists the inputs that gave no or incomplete values as
`{"input", "error"}`. An input whose discovery failed, or on which most measures failed, has
no row; a measure that failed on a single input is dropped for the whole dataset as
`missing`. A job whose inputs leave fewer than 2 measures with values fails.

### Analyse

`POST /factor-analysis/datasets/{id}/analyze` with a JSON body; every field is optional:

```json
{ "excluded": [], "auto_msa_filter": true, "msa_threshold": 0.6, "bartlett_alpha": 0.05,
  "n_factors": null, "rotation": "varimax", "loading_threshold": null,
  "communality_threshold": null }
```

`loading_threshold` and `communality_threshold` default by kind, as in the two upstream
tools: 0.35 and 0 for `model` (ComFy), 0.5 and 0.5 for `log` (ComFy for log measures).

The steps match ComFy:

1. Bartlett's test of sphericity on the measures left after `excluded`. The log-determinant
   comes from the eigenvalues, clamped at 1e-10, so it does not become NaN.
2. KMO/MSA. With `auto_msa_filter`, every measure below `msa_threshold` is removed in one
   step and the MSA is recomputed until none is below (ComFy's
   `repeat_calculate_measure_of_sampling_adequacy`).
3. Eigenvalues of the correlation matrix; the suggestion is the number above 1 (Kaiser).
4. `FactorAnalyzer` (minres) with `n_factors` (default: the suggestion) and the rotation
   (`varimax`, `promax`, `oblimin`, `quartimax`, `none`).
5. Each measure goes to the factor with its largest absolute loading if that reaches
   `loading_threshold` and its communality reaches `communality_threshold`; otherwise it is
   `unassigned`.

The response holds `bartlett` (with `regularised: true` when eigenvalues were clamped, so
chi-square reflects the floor more than the data), `kmo` (overall and per measure),
`msa_filter.removed` (`measure`, `msa`, `step`), `eigenvalues`, `suggested_n_factors`,
`n_factors`, the thresholds used, `loadings` (measure → one value per factor),
`communalities`, `uniquenesses`, `variance`, `factors`, `unassigned`, `warnings` and
`warning_details`.

- For orthogonal rotations `loadings` are the loadings and `variance` holds `ss_loadings`,
  `proportion` and `cumulative`. For `promax` and `oblimin`, `loadings` is the pattern matrix,
  `structure_loadings` the structure matrix and `factor_correlations` the factor correlation
  matrix; `proportion` and `cumulative` are `null`, because the shares of correlated factors
  do not add up. `variance.explained` (mean communality) is the share all factors explain
  together, for every rotation. Communalities do not depend on the rotation.
- `factors[].index` counts from 0, like the columns of `loadings`.
- `warnings` are English sentences; `warning_details` gives each as `{code, message, params}`:
  `bartlett_not_significant`, `kmo_low`, `small_sample` (fewer than 5 observations per
  measure), `singular` (linearly dependent measures), `not_identified` (more factors than the
  Ledermann bound allows), `fit_not_converged`, `single_factor_no_rotation` and `heywood`
  (a communality at the optimizer's bound of 0.995, a possible Heywood case).

Errors are 400 with a `detail`, a `code` and `params`: `too_few_measures` (fewer than 3),
`too_few_observations` (fewer than measures + 1), `msa_filter_left` (the MSA filter left fewer
than 3 measures), `n_factors_range` (more factors than measures − 1; a further factor would
stay empty), `unknown_excluded`, `msa_singular`, `fit_failed` and `not_converged`. A dataset
that is not ready answers 409.

On a singular correlation matrix (common with log measures, e.g. `iqr = q3 - q1`) KMO uses a
pseudo-inverse. Measures with an MSA right at the threshold can then be removed on one machine
and kept on another; the bundled log measures show this for `trace_len_hist6`.

`POST /factor-analysis/datasets/{id}/export` takes the same body plus
`"format": "csv" | "latex"` and returns the loadings table as a file: one row per measure
with its loadings (the pattern matrix for oblique rotations) and communality; in LaTeX a
booktabs `tabular` with loadings at or above the threshold in bold, unless the communality is
below `communality_threshold`.

### Interpretation by Claude

Optional. With `ANTHROPIC_API_KEY` set on the server, Claude (Anthropic) proposes a name and a
short interpretation for each factor. Without a key, only the precomputed interpretations of
the bundled datasets are served (see below).

`GET /factor-analysis/interpretation/status` answers
`{"available": bool, "model": str | null, "precomputed_only": bool}`: `available` when a key
is configured, `model` the configured model id, `precomputed_only` when there is no key but
precomputed interpretations exist.

`POST /factor-analysis/datasets/{id}/interpret` takes the body of `analyze` plus
`"language": "en" | "de"` (default `en`) and `"cached_only": bool` (default `false`). It runs
the analysis with these parameters and sends its aggregated result to Claude: the kind,
the number of observations, used and removed measures, Bartlett, KMO with the MSA per measure,
eigenvalues, factor count and rotation, loadings, communalities, explained variance, the
factor groups with their thresholds, the analysis warnings and the catalog definitions of the
measures. Observation labels, dataset and file names and measure values are never sent.

```json
{ "factors": [ { "index": 1, "name": "Size", "summary": "Two or three sentences.",
                 "driving_measures": ["Size", "Token split"], "confidence": "high" } ],
  "overall": "One short paragraph.", "caveats": ["One sentence each."],
  "model": "claude-opus-5-5", "created_at": "2026-10-05T20:56:17+00:00", "language": "en",
  "prompt_version": "1", "cached": false, "precomputed": false }
```

- `factors[].index` counts from 1, as in "Factor 1" (the `factors` of `analyze` count from 0).
  `driving_measures` only names measures of the analysis; `confidence` is `low`, `medium` or
  `high`. `model` is the model that wrote the answer, a fallback model if the requested one
  declined.
- Results are cached by the cleaned data, the parameters (with the factor count the analysis
  used), the language, the model and the prompt version. `cached: true` means no model call
  was made for this request. Own datasets are cached in the session, bundled ones for all
  sessions.
- `precomputed: true` marks an interpretation from
  `src/AlgoService/datasets/interpretations/`, made with
  `scripts/precompute_interpretations.py` for a bundled dataset with all measures and the
  default parameters. It is served without a key.
- With `cached_only: true` the server never calls Claude and answers 204 when nothing is
  stored; the UI uses it to show stored interpretations without spending anything.

Errors carry `detail` and `code`. Analysis errors come first, as for `analyze`. Then: 503
`interpretation_unavailable` (no key), 429 `rate_limited` (more than
`INTERPRETATION_RATE_LIMIT`, default `10/hour`, live calls in this session) or
`interpretation_daily_cap` (more than `INTERPRETATION_DAILY_CAP`, default 200, live calls today
over all sessions), 422 `interpretation_refused` (the model and its fallback declined), 502
`interpretation_auth` (key rejected), `interpretation_incomplete` (answer cut off) or
`interpretation_failed`, 429 `interpretation_upstream_limited` (Anthropic rate
limit), 503 `interpretation_upstream_unavailable` or `interpretation_unreachable`, 504
`interpretation_timeout`. Cache hits and precomputed answers do not count towards the two
limits.

### Example

```python
import requests

BASE = "http://localhost:3000/api"
s = requests.Session()

ds = s.post(f"{BASE}/factor-analysis/datasets",
            data={"kind": "model", "source": "bundled",
                  "bundled_id": "comfy-paper-inductive-miner"}).json()
result = s.post(f"{BASE}/factor-analysis/datasets/{ds['dataset_id']}/analyze",
                json={"n_factors": 4}).json()
for factor in result["factors"]:
    print(factor["index"] + 1, [m["measure"] for m in factor["measures"]])
```
