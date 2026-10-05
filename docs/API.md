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

- **Rate limits** (per source IP, tunable via `RATE_LIMIT_*` in `.env`): `60/hour` for `POST /algorithms/{id}/analyze`, `60/hour` for `POST /factor-analysis/datasets` (`RATE_LIMIT_DATASETS`), `120/minute` for factor-analysis `analyze` and `export` (`RATE_LIMIT_FA_ANALYZE`), `300/hour` for `POST /log-stats`, `120/minute` for everything else.
- **Job quota:** at most 12 queued or running jobs per session (`MAX_ACTIVE_JOBS_PER_SESSION`).
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
computes, `progress` holds the job percentage.

A CSV may use `,`, `;` or tab as separator and decimal commas. A non-numeric or unnamed
first column holds the row labels; otherwise the rows are numbered.

**Cleaning**, as in ComFy for log measures, runs once when the dataset is stored and is
reported in `dropped`: measures with a non-numeric value (`non_numeric`), with any missing or
infinite value (`missing`), without variance (`constant`), and measures perfectly correlated
with an earlier one (`duplicate`, the first is kept).

For `logs` and `pnml`, `failures` lists the inputs that gave no or incomplete values as
`{"input", "error"}` (for example a miner that failed on one log); such a row is missing from
the matrix.

### Analyse

`POST /factor-analysis/datasets/{id}/analyze` with a JSON body; every field is optional:

```json
{ "excluded": [], "auto_msa_filter": true, "msa_threshold": 0.6, "bartlett_alpha": 0.05,
  "n_factors": null, "rotation": "varimax", "loading_threshold": 0.35 }
```

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
   `loading_threshold`.

The response holds `bartlett`, `kmo` (overall and per measure), `msa_filter.removed`
(`measure`, `msa`, `step`), `eigenvalues`, `suggested_n_factors`, `n_factors`, `loadings`
(measure → one value per factor), `communalities`, `uniquenesses`, `variance`
(`ss_loadings`, `proportion`, `cumulative`), `factors`, `unassigned` and `warnings`
(Bartlett or MSA not passed, fewer than 5 observations per measure, singular correlation
matrix, Heywood case).

Errors are 400 with a `detail`: fewer than 3 measures, fewer observations than measures + 1,
a factor analysis that fails on a singular matrix, or more factors than measures − 1. A
dataset that is not ready answers 409.

`POST /factor-analysis/datasets/{id}/export` takes the same body plus
`"format": "csv" | "latex"` and returns the loadings table as a file: one row per measure
with its loadings and communality; in LaTeX a booktabs `tabular` with loadings at or above
the threshold in bold.

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
