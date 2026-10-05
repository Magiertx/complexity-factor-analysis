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
| POST | `/algorithms/{id}/batch` | Run one algorithm over up to 10 logs. Multipart body with `files[]`, plus optional `sample_log_ids` / `recent_log_ids` JSON arrays. |
| POST | `/log-stats` | Cheap descriptive statistics of one log (traces, events, activities, variants, trace lengths, time range, top activities). |

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

- **Rate limits** (per source IP, tunable via `RATE_LIMIT_*` in `.env`): `60/hour` for `POST /algorithms/{id}/analyze`, `20/hour` for `POST /algorithms/{id}/batch`, `300/hour` for `POST /log-stats`, `120/minute` for everything else.
- **Job quota:** at most 12 queued or running jobs per session (`MAX_ACTIVE_JOBS_PER_SESSION`).
- **Upload size:** 100 MB per file.
- **Allowed extensions:** `.xes`, `.xes.gz`, `.xml`, `.json`.
- **Session:** a signed cookie is set on the first request. Reuse it (e.g.
  `requests.Session()`) to keep your `recent-logs` and job
  history in sync with the web UI.
- **Parameter validation:** every algorithm's parameter schema lives in
  `/algorithms` under `parameters_schema`. Sending unknown keys returns 400
  with a structured error payload (`detail.type == "validation_error"`,
  `detail.errors` keyed by parameter name).
