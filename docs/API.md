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
| GET | `/factor-analysis/catalog?kind=model` or `kind=log` | Measures with the `short` codes of the papers and their `source` (the function of ComFy or the method of feeed behind them), miners (model) or feature groups (log), each with `slow: true` where it can take long, defaults, bundled datasets with the settings they were published with, sample inputs, and the upload `limits`. |
| GET | `/factor-analysis/limits` | Files and bytes one dataset request may carry on this server: `{"max_log_files": 50, "max_pnml_files": 200, "max_file_bytes": 104857600, "max_total_bytes": 524288000}`. The two file counts are set by `MAX_LOG_FILES` and `MAX_PNML_FILES`. |
| POST | `/factor-analysis/datasets` | Create a dataset from bundled data or a CSV (ready at once), or from logs or PNML files (background job); a bundled dataset the session has already is opened again. |
| GET | `/factor-analysis/datasets?kind=model` | The datasets of your session, newest first; `kind` is optional. |
| GET | `/factor-analysis/datasets/{id}/descriptives` | The statistics and histograms of the measures, over every row or, with `miner`, over the rows of one miner. |
| GET | `/factor-analysis/datasets/{id}` | Status, progress, inputs, saved options, measures, dropped measures and the first 2000 rows; once ready, the `descriptives` of every measure with the histogram of its values, for a computed dataset its run times and input sizes (`measurement`), and for a model dataset of several miners its `miners`. |
| PUT | `/factor-analysis/datasets/{id}/options` | Keep the parameters of an analysis with the dataset. |
| DELETE | `/factor-analysis/datasets/{id}` | Delete a dataset with its job and cached interpretations. |
| DELETE | `/factor-analysis/datasets?kind=model` | Delete every dataset of your session, or every one of a kind. |
| GET | `/factor-analysis/datasets/{id}/download` | The cleaned matrix as CSV. |
| POST | `/factor-analysis/datasets/{id}/analyze` | Bartlett, KMO with the MSA filter, eigenvalues with the Kaiser criterion and parallel analysis, factor analysis, factor groups by an assignment rule, the comparison with published numbers, and the `timings` of the parts; of all rows or of one `miner`. |
| POST | `/factor-analysis/datasets/{id}/stability?start=true` | The stability of the analysis the body describes (the fields of `analyze`, plus `samples`: 100, 200 (default) or 500) over bootstrap samples of its rows. Answers `{"status": "ready", "key", "stability"}` once computed, `{"status": "computing", "key", "job_id", "percentage"}` while a job runs (listed in the History, stopped by `/progress/{job_id}/abort`), and with `start=false` and nothing computed `{"status": "none", "key"}`. 429 `stability_jobs_busy` when the server runs its limit of stability jobs. The ZIP, report, methods and BibTeX exports include a computed stability when their body names the same `stability_samples`. |
| POST | `/factor-analysis/datasets/{id}/correlations` | The correlations of the measures, the map of the suitability step: the matrix in the order of the dataset, of a clustering or of the dimensions of an analysis, the pairs with \|r\| of 0.95 or more and the five closest partners of each measure. |
| POST | `/factor-analysis/datasets/{id}/export` | The loadings table as CSV or LaTeX. |
| POST | `/factor-analysis/datasets/{id}/export/report` | The analysis as a LaTeX report built like ComFy's (`report.tex`). |
| POST | `/factor-analysis/datasets/{id}/export/methods` | A short methods paragraph of the analysis in LaTeX with cite keys, in English or German, and the keys it cites. `short_set: true` adds a sentence on the short set. |
| POST | `/factor-analysis/datasets/{id}/export/bibtex` | The BibTeX entries of exactly those keys (`references.bib`). |
| POST | `/factor-analysis/datasets/{id}/export/figure` | The scree plot, the loadings heatmap or the correlation map as SVG or PNG (300 dpi) in print style. |
| POST | `/factor-analysis/datasets/{id}/export/zip` | The whole analysis as a ZIP archive: result, matrix, tables, report, figures, descriptive statistics, run times, parameters, library versions and provenance. |
| POST | `/factor-analysis/compare` | The factor structures of 2 to 8 analyses side by side, like Tab. 17 of Important Factors, under one assignment rule: of bundled datasets (no dataset of the session needed) or of the session's own, per miner if they have several. |
| POST | `/factor-analysis/compare/export` | The comparison as CSV, as a LaTeX table like Tab. 17, or as a ZIP with both, the full result and a manifest. |
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
| DELETE | `/jobs/{job_id}` | Delete one job and its artifacts; a dataset job takes its dataset with it. |
| DELETE | `/jobs` | Delete every job visible to your session, with the datasets the dataset jobs computed. |
| PATCH | `/jobs/{job_id}/notes` | Set or clear a free-text note on a job. |

A failed job has its message in `error` and, for a cause the server knows, a code in
`error_code` (else `null`), which the UI shows in its own language: `prom_unavailable` when
ProM4Py could not be reached for any miner of a single run. The wait for a ProM that refuses
the connection is `PROM4PY_START_WAIT` seconds (default 180).

### Diagnostics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Readiness probe — 200 when the DB is reachable. |
| GET | `/session` | 204. Starts the session (`Set-Cookie: session_id`) if the request has no cookie or one the server cannot read. |
| POST | `/feedback` | The feedback form: `{kind: bug\|idea\|other, message, contact?, context?}`. Stored without IP address or session, and mailed to the owner if mail is set up (see DEPLOYMENT.md). Answers `{"ok": true}`; a bad kind or length answers 422 with `code` `feedback_kind`, `feedback_empty`, `feedback_too_long` or `feedback_contact_too_long`. |

## Notes & limits

- **Rate limits** (per source IP, tunable via `RATE_LIMIT_*` in `.env`): `60/hour` for `POST /algorithms/{id}/analyze`, `60/hour` for new datasets from `POST /factor-analysis/datasets` (`RATE_LIMIT_DATASETS`; a new copy of a bundled dataset counts too, the copy a session already has does not), `600/minute` for `GET /factor-analysis/datasets/{id}`, which the UI polls, and for listing datasets, saving their options and deleting them (`RATE_LIMIT_DATASET_STATUS`), `120/minute` for factor-analysis `analyze`, `export`, `export/zip`, `compare`, `compare/export` and `interpret` (`RATE_LIMIT_FA_ANALYZE`), `300/hour` for `POST /log-stats`, `5/hour` for `POST /feedback` (`RATE_LIMIT_FEEDBACK`), `120/minute` for everything else. A 429 carries `detail` and `"code": "rate_limited"`. Interpretations that call Claude are limited further, see [Interpretation by Claude](#interpretation-by-claude).
- **Job quota:** at most 12 queued or running jobs per session (`MAX_ACTIVE_JOBS_PER_SESSION`), and at most 4 dataset jobs over all sessions (`MAX_ACTIVE_DATASET_JOBS`); both answer 429, with `"code": "job_quota"` and `params` `active`, `requested` and `limit`, or `"code": "dataset_jobs_busy"` and `params` `active`.
- **Analyses:** at most 400 measures per analysis, counted after `excluded` (400 with `"code":
  "too_many_measures_for_analysis"`). At most two analyses compute at once; a newer analyze
  request of the same session and dataset replaces an older one (409 `superseded`, see
  [Analyse](#analyse)).
- **Upload size:** 100 MB per file. Factor-analysis datasets: at most 50 logs or 200 PNML
  files and 500 MB in total per request, `.xes.gz` counted decompressed. The operator sets
  the numbers of files (`MAX_LOG_FILES`, `MAX_PNML_FILES`); `GET /factor-analysis/limits`
  and `limits` in the catalog report the values in force.
- **Allowed extensions:** `.xes`, `.xes.gz`, `.xml`, `.json` for single runs; `.xes`,
  `.xes.gz`, `.pnml` and `.csv` for factor-analysis datasets.
- **Session:** a signed cookie is set on the first request. Reuse it (e.g.
  `requests.Session()`) to keep your `recent-logs` and job
  history in sync with the web UI. A client that sends several requests at once without a
  cookie gets a session per request and keeps only the last cookie: call `GET /session` first.
  The web UI does not need to: the frontend asks for the cookie when it serves a page.
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

Every measure of the catalog has a `short` code, as the papers print it in tables and
figures: the codes of Important Factors for the model measures (`CNC`, `dens`, `mcd`, ...; the
four measures the paper leaves out have codes of the tool in the same style: `CC`, `depth`,
`diam`, `cyc`), and the codes of the LaTeX macros of ComFy for log measures for the 146 feeed
features (`mag` for `n_events`, `TL-min` for `trace_len_min`, ...). The report and the figures
use them with `"short_codes": true`; the UI switches between them and the names.

A dataset belongs to the session that created it and is kept on the server next to the job
artifacts (30 per session; a session unused for a week is removed). A dataset removed for
either reason takes the job that computed it along, as a delete does.

Each measure of the catalog has a `source`: where it is implemented, as `name` (`ComFy` or `feeed`), `function` (`measure_size` of ComFy's `modelcomplexity/ModelComplexity.py`, or `TraceLength.trace_len_min` of feeed), `file`, `commit` and a `url` to that file at that commit. The fact sheet of a measure shows it in place of a definition of its own; a log measure also has its feeed `group`.

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
| `reuse` | `bundled` only, default `true`: return the session's copy of the same bundled dataset instead of a new one, see below. |
| `files` | Repeated. One `.csv`; up to `limits.max_log_files` (50) `.xes` / `.xes.gz`; up to `limits.max_pnml_files` (200) `.pnml`. |

`bundled` and `csv` answer `{"dataset_id", "status": "ready", "reused": false}`. `logs` and `pnml` answer
`{"dataset_id", "status": "computing", "job_id"}`; the job shows up in `/jobs` like any run.
Poll `GET /factor-analysis/datasets/{id}` until `status` is `ready` or `failed`; while it
computes, `progress` holds the job percentage. `?rows=n` (0 to 2000, default 2000) limits the
preview in `observations` and `values`. A job still running after 70 minutes, longer than the
worker's time limit, is taken as lost and its dataset marked `failed`.

If the session has a `ready` copy of the same bundled dataset with the same `measures` (both
none, or the same list) and, when `name` is given, the same name, a `bundled` request returns
that copy, `{"dataset_id", "status": "ready", "reused": true}`, and marks it as used now for
the pruning of the 30 datasets and the idle cleanup. Opening a link to a paper analysis ten
times thus gives one dataset. Such a request creates nothing and does not count towards the
rate limit of 60 new datasets an hour, only towards the general one. Send
`reuse=false` for a separate copy; the newest copy is the one reused from then on.

The logs of a dataset computed from logs are also kept among the recent uploads of your session
(`GET /recent-logs`), under the names of its rows (a packed `x.xes.gz` as `x.xes`), for as long as
they are among the ten newest uploads; the page of a single log opens one with
`/inspect?log=<name>`, and with `&miner=<name>` for the miner of a row of nets. A log renamed to be unique
(`x.xes (2)`) or whose name begins with `tmp` is not kept.

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

### Published settings

The bundled datasets of "Important Factors: Complexity Dimensions for Petri Nets" (ATAED 2026)
carry, in `catalog.bundled`, the settings the paper analysed them with and where they come from:

```json
{ "id": "comfy-paper-inductive-miner", "...": "...",
  "published_options": { "excluded": [], "auto_msa_filter": true, "msa_threshold": 0.6,
    "bartlett_alpha": 0.05, "n_factors": 4, "rotation": "varimax", "loading_threshold": 0.35,
    "communality_threshold": 0.3, "assignment_rule": "multi" },
  "published_source": "Important Factors, ATAED 2026, Tab. 10–12", "published_scope": "paper",
  "paper_tables": { "key": "matches", "tables": "Tab. 10–11",
    "note": "Tab. 10–11 of the paper print the same numbers, rounded." } }
```

- `published_options` is a complete body for `analyze`. The paper fixes k = 4 a priori. The
  defaults of `analyze` stay those of the tool; a client applies these options on purpose.
- `published_source` is a plain citation: the paper with the tables of its analysis, or the
  paper alone where `published_scope` is `report`.
- `published_scope` says where the analysis with these settings is published: `paper` if the
  paper analyses the dataset with them (Alpha, Directly Follows, Inductive, Hybrid ILP);
  `report` if it does not, and the settings are the paper's as the reports in the ComFy
  repository apply them (Alpha Plus and Alpha Dollar, which the paper leaves out, and
  Heuristics, whose factor analysis the paper does not describe). The Heuristics report asks
  for 4 factors with 4 measures left after the MSA filter and prints a fourth factor of zeros;
  its `n_factors` is 3, the most these measures allow.
- `paper_tables.key` says how the paper's tables relate to the ComFy reports the numbers are
  checked against, with `tables` the tables meant and `note` an English sentence:
  `matches` (Alpha Tab. 4–5, Inductive Tab. 10–11), `msa_only` (Heuristics: Tab. 13 prints
  only the MSA values, the text Bartlett's p-value and the overall MSA), `extra_dup_column`
  (Directly Follows Tab. 7–8 also have dup without τ, which the bundled data lack, so Bartlett's
  chi-square, the KMO, the MSA values and the loadings differ), `other_data` (Hybrid ILP
  Tab. 14–16 rest on other data than the bundled CSV) and `not_in_paper` (Alpha Plus, Alpha
  Dollar).
- The bundled log measures have none of these fields yet.

### The datasets of a session

`GET /factor-analysis/datasets` lists the datasets of your session, newest first; `?kind=model`
or `?kind=log` keeps one kind, any other value is a 400. A dataset whose job outlived the time
limit is marked `failed` here too.

```json
{ "datasets": [
  { "id": "0c5b0f8e-…", "kind": "model", "name": "Petri nets of the four PDC logs",
    "name_auto": false, "source": "pnml", "status": "ready",
    "created_at": "2026-10-06T09:12:44.512+00:00",
    "n_observations": 32, "n_measures": 2, "bundled_id": null, "job_id": "a3e04d71-…",
    "inputs": { "files": 32, "measures": ["Size", "Density"], "sample_id": "pdc-sample-models" },
    "has_options": true, "options_miner": null,
    "options": { "excluded": [], "auto_msa_filter": true, "msa_threshold": 0.6,
                 "bartlett_alpha": 0.05, "n_factors": null, "rotation": "varimax",
                 "loading_threshold": 0.35, "communality_threshold": null,
                 "assignment_rule": "largest" } } ] }
```

- `name_auto` is `true` when no name was given and the server made one up from the inputs,
  e.g. `3 log(s)` or the name of the sample; the UI shows a name in its own language instead.
- `n_observations` and `n_measures` (after cleaning) are `null` until the dataset is `ready`.
- `inputs` says what the dataset is made from. `files` counts the uploaded or sample files, 1
  for a CSV and 0 for a bundled dataset. `measures`, `miners`, `groups` and `sample_id` are the
  choices made at creation, where they apply; for `bundled` and `csv`, `measures` is only there
  if columns were selected.
- `options_miner` is the miner whose rows the saved options analyse, `null` for all rows.
- `options` are the saved parameters of the last analysis, as `GET /factor-analysis/datasets/{id}`
  has them, or `null` before the first one.
- `GET /factor-analysis/datasets/{id}` carries the same `name_auto`, `bundled_id` and
  `inputs`, and `options`: the saved parameters or `null`. A ready dataset also has
  `descriptives`, `measurement` and `miners`, see below.

`descriptives` describes every measure as ComFy's report does (`FactorAnalysis.perform_factor_analysis`):
pandas' mean, median, standard deviation with ddof = 1, minimum and maximum over every
observation of the data as collected, before cleaning, with missing values left out. A
measure that cleaning drops for a non-numeric value is left out; one it drops for another
reason is described, with the reason in `dropped`. `basis` is `input`, or `cleaned` for an
uploaded dataset stored before the statistics were kept, of which only the cleaned matrix is
left to describe.

```json
{ "basis": "input", "n_rows": 288, "measures": [
  { "measure": "Size", "n": 288, "mean": 71.684028, "median": 56.0, "std": 36.639797,
    "min": 34.0, "max": 197.0, "dropped": null },
  { "measure": "Number of empty sequence flows", "n": 288, "mean": 0.0, "median": 0.0,
    "std": 0.0, "min": 0.0, "max": 0.0, "dropped": "constant" } ] }
```

Each measure also has its `histogram`, which the fact sheet of a measure draws: `min` and `max`
and `counts`, the number of its values in equal-width bins from the smallest to the largest value
(at most 12 bins, one per value for a measure with fewer distinct values; a single value has one
bin; `null` for a measure without values), e.g. `"histogram": {"min": 34.0, "max": 197.0,
"counts": [96, 61, 28, "…"]}`. Statistics stored before the histograms were kept get them from the cleaned
matrix, for the measures it still has.

`GET /factor-analysis/datasets/{id}/descriptives` serves the same object without the rest of the
dataset. With `?miner=<name>` on a model dataset of several miners it describes the rows of that
miner only, from the cleaned matrix: `basis` is `miner`, `miner` names it and `n_rows` counts its
rows. Every measure of the dataset is listed, also one that is constant within the miner (an
analysis of the miner leaves it out). The fact sheet of a measure shows these statistics and the
histogram while a miner is chosen. A miner the dataset does not have is a 400 `unknown_miner`,
a dataset that is not ready a 409.

`measurement` is `null` for a bundled or uploaded matrix. For a dataset the tool computed from
logs or PNML files it holds the wall time (seconds, `time.perf_counter`) of every stage and the
size of every input, measured while the job ran: `inputs` with `read_s` and, for a log,
`events`, `traces`, `variants` and `activities`, for a net its `net` (`places`, `transitions`,
`arcs`); `observations`, one per row of the dataset, with `discovery_s` (including the wait
for ProM4Py while other jobs use it) and `discovery_run_s` (the call alone) for a mined net,
its `net`, the seconds of each measure (model) or feature group (log) in `stages` and their
sum in `measures_s` or `features_s`; and `total_s`. An input or observation that failed has an
`error`. A log is read once for all its miners. The sizes come from the log as read, so nothing
is read twice; feeed's features are computed one by one as its `extract_features` does.

```json
{ "kind": "model", "source": "logs", "unit": "seconds", "total_s": 41.2,
  "inputs": [ { "input": "pdc2025_02001100.xes", "read_s": 0.31, "events": 13784,
    "traces": 1000, "variants": 412, "activities": 14 } ],
  "observations": [ { "observation": "pdc2025_02001100.xes / Inductive miner",
    "input": "pdc2025_02001100.xes", "miner": "Inductive miner", "discovery_s": 2.4,
    "discovery_run_s": 2.1, "net": { "places": 21, "transitions": 30, "arcs": 70 },
    "stages": { "Size": 0.0004, "…": 0.01 }, "measures_s": 0.52 } ] }
```

`miners` is `null` unless the dataset holds model measures and every row is labelled
`<log> / <miner>` with a miner the tool knows, as the rows of a dataset computed from event logs
are (and those of a CSV made from such a dataset). Then it lists each miner, in the order the
dataset was computed with, with its `n_observations`, the `n_measures` that vary within its rows
and the measures that do not (`dropped`). The analysis option `miner` analyses the rows of one
of them; see [Analyse](#analyse).

```json
{ "miners": [
  { "name": "Alpha miner", "n_observations": 50, "n_measures": 12,
    "dropped": ["Number of duplicate tasks"] },
  { "name": "Inductive miner", "n_observations": 50, "n_measures": 12,
    "dropped": ["Number of empty sequence flows"] } ] }
```

`PUT /factor-analysis/datasets/{id}/options` takes the body of `analyze` and keeps it with the
dataset, every field filled in, so that a client reopening the dataset can start from its last
analysis; the UI saves the parameters after each analysis. The body is checked as `analyze`
checks it, as far as that needs no analysis: 422 for an invalid value, 400 with the `code` of
`analyze` for an excluded measure the dataset does not have (`unknown_excluded`), too few
measures or observations left (`too_few_measures`, `too_few_observations`; with a `miner`, of
its rows), more factors than the measures left allow (`n_factors_range`), a miner the dataset
does not have (`unknown_miner`) or more `factor_names` than factors (`factor_names_too_many`).
Whether the MSA filter leaves enough measures only the analysis tells. `miner` and
`factor_names` are kept only when given. The answer is 204, or 409 if the dataset is not ready.

`names_k` (optional, the factor count of the analysis on screen) says which solution the
`factor_names` belong to, however the count was chosen (also by the Kaiser criterion). With it the
names are kept for that solution, that is for its miner, `names_k`, `rotation` and
`assignment_rule`, besides the options themselves: a dataset keeps the names of up to 40
solutions, the one saved last is the newest, and saving a solution without names forgets its
names. `names_k` is not part of the saved options. Without it (and without `n_factors`) the names
stay with the options only. More names than `names_k` is a 400 `factor_names_too_many`.

```python
s.put(f"{BASE}/factor-analysis/datasets/{dataset_id}/options",
      json={"n_factors": 3, "rotation": "promax", "excluded": ["Density"]})
s.get(f"{BASE}/factor-analysis/datasets/{dataset_id}").json()["options"]
# {"excluded": ["Density"], "auto_msa_filter": True, "msa_threshold": 0.6,
#  "bartlett_alpha": 0.05, "n_factors": 3, "rotation": "promax",
#  "loading_threshold": None, "communality_threshold": None, "assignment_rule": "largest"}
```

`DELETE /factor-analysis/datasets/{id}` answers 204 and removes the dataset: its matrix, its
metadata and the interpretations cached for it (those of bundled datasets are shared by all
sessions and stay). The job that computed it is aborted if it still runs and deleted with its
artifacts. `DELETE /factor-analysis/datasets` does the same for every dataset of the session, or
of `?kind=`, and answers `{"deleted": n}`. The other way round, deleting a dataset job with
`DELETE /jobs/{job_id}` or `DELETE /jobs` deletes the dataset it computed; bundled and CSV
datasets have no job and stay.

A dataset of another session answers 404 everywhere, like one that does not exist.

### Analyse

`POST /factor-analysis/datasets/{id}/analyze` with a JSON body; every field is optional:

```json
{ "excluded": [], "auto_msa_filter": true, "msa_threshold": 0.6, "bartlett_alpha": 0.05,
  "n_factors": null, "rotation": "varimax", "loading_threshold": null,
  "communality_threshold": null, "assignment_rule": "largest",
  "miner": null, "factor_names": null }
```

`loading_threshold` and `communality_threshold` default by kind, as in the two upstream
tools: 0.35 and 0 for `model` (ComFy), 0.5 and 0.5 for `log` (ComFy for log measures).

`miner` analyses the rows of one miner of a dataset with `miners` (see above), as Important
Factors analyses every miner on its own; `null` analyses every row, so the differences between
the miners mix into the dimensions and every log counts once per miner. No dataset is made of
the rows: nothing is stored, and the limits of new datasets are not touched. The rows keep their
values and the measures their stored order, on which the KMO of singular data depends. A
measure without variance within the miner's rows, or perfectly correlated with another there,
is left out for that miner only, as cleaning leaves it out of a dataset; an `excluded` measure
the miner leaves out anyway is no error. The response then has `miner`: its `name`,
`n_observations`, `n_measures` and the measures left out (`dropped`, with `measure` and
`reason`); without a miner `miner` is `null`. An analysis of one miner has no `published_match`.
A miner the dataset does not have is a 400 with the code `unknown_miner` (`params` `miner` and
`miners`, the ones it has). More measures than observations of the miner is the usual
`too_few_observations`; fewer than 5 observations per measure is the warning `small_sample`.

`factor_names` names the factors, the first name for factor 1, each at most 40 characters on one
line (a longer one is a 422); `null` or `""` keeps `Factor i`. The analysis does not change with
them: they head the factors in the downloads (`export`, `export/figure`, `export/report`,
`export/zip`, whose manifest lists them), and `options` keeps them with the dataset. More names
than factors is a 400 `factor_names_too_many` (`params` `names` and `factors`). The tool never
names a factor by itself; the UI offers the names of an interpretation only on a click.

The steps match ComFy:

1. Bartlett's test of sphericity on the measures left after `excluded`. The log-determinant
   comes from the eigenvalues, clamped at 1e-10, so it does not become NaN.
2. KMO/MSA. With `auto_msa_filter`, every measure below `msa_threshold` is removed in one
   step and the MSA is recomputed until none is below (ComFy's
   `repeat_calculate_measure_of_sampling_adequacy`).
3. Eigenvalues of the correlation matrix; the suggestion is the number above 1 (Kaiser).
   Next to it, Horn's parallel analysis on the same matrix: the eigenvalues of the
   correlation matrices of 100 samples of standard normal data of the same size, their 95th
   percentile per rank, drawn by numpy's default generator from the fixed seed 20261012 and
   cached per size; requests for the same size at the same time share one computation. It
   suggests the number of leading eigenvalues above their random counterpart, at least 1.
   Like the scree plot it is PCA-based, so on large samples it lies close to Kaiser. On the
   bundled data it takes well under a second, on an upload of 100,000 rows about a minute,
   which `elapsed_ms` then includes.
4. `FactorAnalyzer` (minres) with `n_factors` (default: the Kaiser suggestion) and the rotation
   (`varimax`, `promax`, `oblimin`, `quartimax`, `none`).
5. Measures go to factors by `assignment_rule`:
   - `largest` (default, the tool's own rule; ComFy's report assigns nothing, it only greys loadings below its threshold): the factor of the largest absolute loading, if that
     reaches `loading_threshold` and the communality reaches `communality_threshold`.
   - `multi` (Important Factors, Tab. 6–16, after Lieben et al.): a loading counts if its
     absolute value exceeds `loading_threshold`; the measure goes to every factor whose
     loading counts and lies at most 0.15 below its largest, if its communality is at least
     0.3.
   - `hair` (Important Factors, Tab. 17; shown as "Without cross-loadings", its two criteria are justified in the paper with Hair et al.): the factor of the largest
     loading, if it exceeds `loading_threshold` and the communality is at least 0.5; a
     measure with another loading that counts and lies at most 0.15 below is left out.

   A higher `communality_threshold` than the rule's minimum applies instead. A measure is
   *cross-loaded* if more than one of its loadings counts and lies at most 0.15 below its
   largest; this is reported under every rule. With the paper's settings, `multi` gives Tab. 9
   of the paper exactly and Tab. 6 and 12 with one assignment more each (CH also in factor 2,
   acd also in factor 2: their loadings there lie within 0.15 of the largest), and `hair` gives
   the rows of Tab. 17 for the Directly Follows and the Inductive miner. The Alpha row of
   Tab. 17 keeps MM (communality 0.37) and the cross-loaded CH, which `hair` leaves out, so
   factor 4 stays empty there. The UI notes these differences next to the rules for the
   bundled datasets.

The response holds `bartlett` (with `regularised: true` when eigenvalues were clamped, so
chi-square reflects the floor more than the data), `kmo` (overall and per measure),
`msa_filter.removed` (`measure`, `msa`, `step`), `eigenvalues`, `suggested_n_factors`,
`factor_count`, `n_factors`, the thresholds used, `loadings` (measure → one value per factor),
`communalities`, `uniquenesses`, `variance`, `assignment_rule`, `assignment`, `factors`,
`unassigned`, `unassigned_details`, `cross_loadings`, `published_match`, `warnings`,
`warning_details`, `timings` and `elapsed_ms`.

```json
{ "factor_count": { "kaiser": 2, "parallel_analysis": 2, "eigenvalues_random": [1.404, 1.264, "…"],
    "method": "pca", "seed": 20261012, "simulations": 100, "percentile": 95 },
  "assignment_rule": "multi",
  "assignment": { "rule": "multi", "loading_threshold": 0.35, "loading_strict": true,
    "communality_threshold": 0.3, "cross_loading_gap": 0.15, "cross_loaded": "all" },
  "factors": [ { "index": 0, "measures": [ { "measure": "Number of duplicate tasks", "loading": 0.9721 }, "…" ] }, "…" ],
  "unassigned": ["Connector Mismatch"],
  "unassigned_details": [ { "measure": "Connector Mismatch", "reason": "low_communality" } ],
  "cross_loadings": [ { "measure": "Average connector degree", "factors": [2, 0, 1],
    "loadings": [0.583, -0.4835, 0.4608] } ],
  "published_match": { "status": "match", "compared": ["bartlett", "kmo", "msa", "loadings"],
    "differences": [], "tolerance": 0.0001,
    "source": "output/paper-results/report-inductive-miner.tex of ComFy, commit 1dd6ea6",
    "report": { "repository": "https://github.com/Pati-nets/ComFy", "commit": "1dd6ea6…",
      "file": "output/paper-results/report-inductive-miner.tex" },
    "paper_tables": "matches", "paper_tables_ref": "Tab. 10–11",
    "paper_tables_note": "Tab. 10–11 of the paper print the same numbers, rounded." },
  "elapsed_ms": 41.3 }
```

- For orthogonal rotations `loadings` are the loadings and `variance` holds `ss_loadings`,
  `proportion` and `cumulative`. For `promax` and `oblimin`, `loadings` is the pattern matrix,
  `structure_loadings` the structure matrix and `factor_correlations` the factor correlation
  matrix; `proportion` and `cumulative` are `null`, because the shares of correlated factors
  do not add up. `variance.explained` (mean communality) is the share all factors explain
  together, for every rotation. Communalities do not depend on the rotation.
- `factors[].index` counts from 0, like the columns of `loadings`. Within a factor the
  largest absolute loading comes first; under `multi` a measure can be in several factors.
- `factor_count`: `kaiser` is `suggested_n_factors`; `parallel_analysis` the suggestion of
  parallel analysis; `eigenvalues_random` one value per eigenvalue, largest first. Both
  suggestions are at most measures − 1. `n_factors` stays the Kaiser suggestion unless the
  request sets it.
- `assignment` is the rule as applied: whether a loading must exceed the threshold
  (`loading_strict`), the communality it needed (the rule's minimum or `communality_threshold`,
  whichever is higher), the gap and what became of cross-loaded measures (`largest`: the
  largest loading only, `all`: every factor of the cross-loading, `none`: left out).
  `communality_threshold` at the top level stays the value of the request.
- `unassigned` lists the measures in no factor, as before; `unassigned_details` gives each
  with its `reason`: `low_communality`, `low_loading` (no loading counts) or `cross_loading`
  (`hair` only), checked in this order.
- `cross_loadings` lists every cross-loaded measure with the factors (from 0) and loadings of
  its cross-loading, largest absolute loading first.
- `published_match` is `null` unless the dataset is a whole copy of a bundled dataset with
  `published_options` and verified published numbers, and the request used exactly these
  options (`n_factors` as the analysis used it, the order of `excluded` aside). Then
  `status` is `match` or `differs`, `compared` names what was compared (Bartlett's
  chi-square and p-value, the overall KMO, the MSA of every measure left and of every removed
  one with its step, and the loadings of the report's factors with the communalities) and
  `differences` lists each value off by more than `tolerance` (times the value for values
  above 1) as `{key, code, what, expected, actual}`, with `measure` and `factor` (from 0) where
  they apply. `code` names the value for a client that words it itself (`bartlett_chi_square`,
  `bartlett_p_value`, `kmo`, `msa`, `msa_at_removal`, `loading`, `communality`, or, where a set
  rather than a number differs, `msa_measures`, `msa_removed` and `loadings_shape`, whose
  `expected` and `actual` are lists or objects); `what` says it in English. Only numbers are compared, never the factor groups. `paper_tables` and its `_ref` and
  `_note` are those of the catalog.
- `elapsed_ms` is the time the server spent on the request, the wait for a free slot
  included.
- `timings` gives the wall time in seconds of the parts of the analysis: `suitability_s`
  (cleaning of the exclusions, Bartlett, KMO and the MSA filter), `parallel_analysis_s`,
  `fit_s` and `total_s`. The random eigenvalues of parallel analysis and the fit are cached;
  `parallel_analysis_cached` and `fit_cached` say whether this request took them from the
  cache, in which case their seconds are those of the computation that filled it.
- `warnings` are English sentences; `warning_details` gives each as `{code, message, params}`:
  `bartlett_not_significant`, `kmo_low`, `small_sample` (fewer than 5 observations per
  measure), `singular` (linearly dependent measures), `not_identified` (more factors than the
  Ledermann bound allows), `fit_not_converged`, `single_factor_no_rotation` and `heywood`
  (a communality at the optimizer's bound of 0.995, a possible Heywood case).

Errors are 400 with a `detail`, a `code` and `params`: `too_few_measures` (fewer than 3),
`too_many_measures_for_analysis` (more than 400 measures after `excluded`; `params` `max` and
`n`; checked before anything is computed),
`too_few_observations` (fewer than measures + 1), `msa_filter_left` (the MSA filter left fewer
than 3 measures), `n_factors_range` (more factors than measures − 1; a further factor would
stay empty), `unknown_excluded`, `msa_singular`, `fit_failed` and `not_converged`. A dataset
that is not ready answers 409.

**Latest wins.** The UI sends an analyze request on every change and drops the answer to the
one before. So the server gives up an analysis once a newer analyze request of the same
session and dataset arrives with other parameters, and one whose client closed the
connection: before and after waiting for one of the two analysis slots, and while it waits
for parallel analysis and the fit, which stop once nobody waits for them any more. Such a
request answers 409 with `"code": "superseded"` at once and frees its slot. A
newer request with the same parameters replaces nothing; requests for the same fit, of any
session, wait for the one that is running instead of fitting again. Clients that run several
analyses of one dataset at once send `?latest_wins=false`; their requests are then given up
only when their connection closes. `export` and `export/zip` are given up only then, too.

On a singular correlation matrix (common with log measures, e.g. `iqr = q3 - q1`) KMO uses a
pseudo-inverse. Measures with an MSA right at the threshold can then be removed on one machine
and kept on another; the bundled log measures show this for `trace_len_hist6`.

`POST /factor-analysis/datasets/{id}/export` takes the same body plus
`"format": "csv" | "latex"` and returns the loadings table as a file: one row per measure
with its loadings (the pattern matrix for oblique rotations) and communality; in LaTeX a
booktabs `tabular` and a comment naming the rule. In bold are, for `largest`, the loadings at
or above the threshold of measures whose communality reaches the communality threshold, as
ComFy's report leaves loadings at or above its threshold black; for `multi` and `hair`, the loadings by which the rule put a
measure on a factor, as the dimension tables of Important Factors list them, with a comment
naming the measures in no factor and why. The CSV keeps its columns; the assignment of each
measure is in `assignment.csv` of the ZIP. A factor with a name in `factor_names` is headed by
it in both, e.g. `Measure & Size & Factor 2 & …` instead of `Factor 1`.

`POST /factor-analysis/datasets/{id}/export/report` takes the same body plus `"language":
"en" | "de"` and `"short_codes": true | false` (default `false`) and returns
`<dataset name>-report.tex`, a LaTeX report built like `report-<miner>.tex` of ComFy's
`LatexExporter`, in its order and table style: the miners (or the source) and the measures,
the validity of the analysis (sample size, Bartlett's chi-square and p-value, the MSA of every
measure left and of every removed one with the round of the filter), the scree plot with
parallel analysis and the Kaiser line and a table of the eigenvalues with their share of the
variance (eigenvalue / p, the series ComFy plots), the descriptive statistics with six
decimals, the loadings with four (light grey where a loading does not count, bold where the
assignment rule put the measure, with the communality and the sums of squares), the
communalities as a bar chart (up to 40 measures), the factor correlations of an oblique
rotation, the dimensions the rule forms, and the settings and provenance. With `short_codes`
the measures are named by the codes of the papers, for log measures as C with the code as
index. The factors carry the `factor_names` of the request: a name heads its column of the
loadings and of the factor correlations (a long one wraps in a box of 2 cm) and follows the
number in the dimensions, with a sentence that the names were given by whoever ran the analysis.
Without names the factors are numbered; the report never names them by itself and never asks for
an interpretation. With a `miner`, the report says which miner's nets it analysed and how many
of the observations of the dataset, and lists the measures without variance within them. It
compiles with pdflatex
(booktabs, longtable, needspace, array, amsmath, tikz, pgfplots and paralist). Compile it with
`latexmk -pdf`, or run pdflatex twice: long tables settle their column widths in the second run.
Under the paper settings, the report of a bundled Important Factors dataset prints the numbers
of the published ComFy report to the decimals it prints them with (`tests/test_report.py`).

`POST /factor-analysis/datasets/{id}/export/methods` takes the body of `analyze` plus `"language":
"en" | "de"` (default `en`) and answers `{"language", "text", "citation_keys"}`: one neutral
paragraph in LaTeX (`\cite` keys, `$\chi^2$` and `$p$` in math mode, `\%`, special characters of
names escaped) for the methods section of a paper. It is a template, not a generator: every
number and setting is read from the analysis and its parameters, nothing is said that the analysis
did not do, and the numbers are those of the user interface (KMO to two decimals, Bartlett's
chi-square to one, the p-value to three, the share of variance to one). It names the dataset with its
size (the rows of one miner with `miner`), the measures dropped in cleaning, the tool with its
version and commit and `factor_analyzer` with its version, minres extraction, Bartlett's test and
the KMO with the MSA filter (measures removed, rounds, or that it was off), the factor count and
how it was chosen (set, or the Kaiser criterion; parallel analysis with simulations, percentile and
seed), the variance explained (not for oblique rotations), the rotation, and the assignment rule
with the thresholds it applied and the number of measures it left out. The text and the keys
are the same for every request of one analysis and language, apart from the version and commit of
the running tool.

`POST /factor-analysis/datasets/{id}/export/bibtex` takes the same body and returns
`<dataset>-references.bib` with the entries of the `citation_keys` of `export/methods`, in their
order, and no others. Kaiser (1960, 1974), Bartlett (1950) and Horn (1965) are given with their
DOIs, checked against Crossref. The data of the bundled datasets, ComFy and ComFy for log measures
come from `datasets/manifest.json` of this repository, and the author and address of
`factor_analyzer` from its package metadata. The tool's own entry has its name, version and commit
from the running service, the author from its git history, and the year of the export. What a
source does not record (the authors of a paper beyond the one the catalog names, the pages of the
paper "Important Factors", the version of ComFy) is not filled in: a comment above the entry says
what to complete. Harman and Jones (1966) are cited for minres, Kaiser (1958) for the varimax rotation
(and for no other rotation) and Lieben et al. (2018) for the rule `multi`.

`POST /factor-analysis/datasets/{id}/export/figure` takes the same body plus `"figure":
"scree" | "loadings" | "correlations"`, `"format": "svg" | "png"`, `"short_codes"`, `"order": "factor" |
"dataset"` (the rows of the heatmap: grouped by factor as the UI shows them, or in the order of
the dataset), `"correlation_order": "factor" | "cluster" | "dataset"` (default `factor`: the order
of the measures of the correlation map, as `order` of `correlations`) and `"language": "en" | "de"` (default `en`: the words of the axes, the legend and
the caption, with the decimal comma in German) and returns `<dataset name>-<figure>.svg` or
`.png`. With `short_codes`, a log measure is written as the paper writes it, C with its code as
index. Both are drawn by matplotlib
in a print style, whatever the theme of the UI: white background, 8 pt text at the text width
of a CEUR page (15.9 cm), the loadings shaded in one blue by their absolute value (the sign stands in the number), the loadings that
do not count left white, the assigned ones bold. With `factor_names` the heatmap heads a named
factor by its name, set at a slant, instead of `F1`. The correlation map has a cell for each pair of
the measures left in (those `excluded` are gone, those the MSA filter removes are there), blue for a
positive and slate for a negative r, the pairs with |r| of 0.95 or more outlined, and under the order
`factor` a line between the dimensions, each named at the right of the map; up to 17 measures have their
r written in the cells, more are read from the colour and the labels, which shrink to keep every
measure named. The SVG keeps its text as text and is the
same file for the same analysis; the PNG has 300 dpi.

`POST /factor-analysis/datasets/{id}/export/zip` takes the same body plus `"language": "en" |
"de"` (default `en`, the language of the stored interpretation), `"short_codes"` (default
`false`, for the report and the figures), `"order": "factor" | "dataset"` (the rows of the
loadings heatmap, as of the figure), `"correlation_order": "factor" | "cluster" | "dataset"` (default
`factor`: the order of the correlation map and of `correlations.csv`) and `"figure_language": "en" | "de"` (default `en`, as the
paper is written in English; the labels of the figures), and returns `<dataset name>-factor-analysis.zip`, everything needed to report or reproduce the
analysis. The errors of these exports are those of `analyze`.

| File | Content |
|------|---------|
| `manifest.json` | `app`, `created_at`, `tool` (`name`, `version` and `commit` of this tool, `null` where not recorded), `dataset` (`id`, `name`, `kind`, `source`, `bundled_id`; `collection`, `citation` and `license` for a bundled dataset, else `null`; `inputs`, `n_observations`, the `measures` left after cleaning, the `dropped` ones as `{name, reason}` and `provenance`, see below), `analysis_params` (the parameters used, with the factor count and rotation of the analysis, the thresholds of the kind and the `assignment_rule`; a single factor is not rotated; `miner` only for the rows of one miner), `miner` (only then: its `name`, `n_observations`, `n_measures` and `dropped` measures, as `analyze` returns it), `factor_names` (only if given: one name or `null` per factor), `analysis` (`method` minres of `library` factor_analyzer, the upstream code it `follows` with commits, the `assignment_rule` and the `assignment` as the result has it, the random `seed` 20261012 of parallel analysis, and `factor_count`: the factor count `used`, the `kaiser` and `parallel_analysis` suggestions, `method`, `seed`, `simulations` and `percentile`), `analysis_timings` (the `timings` of the analysis), `measure_labels` (`names` or `short_codes`, as the report and the figures name the measures), `figure_order` (`factor` or `dataset`), `correlation_order` (`factor`, `cluster` or `dataset`) and `figure_language` (`en` or `de`) of the figures, `measurement` (only for a computed dataset: its run times and input sizes, as the dataset has them), `published` (only if the analysis used the `published_options` of a bundled dataset: these `options`, their `source` and `scope` and the `match`, as `published_match`), `libraries` (versions of factor_analyzer, numpy, pandas, scipy and scikit-learn) and `files` (`{name, description}` of each file). |
| `README.txt` | The files, how to reproduce the analysis in the UI or with factor_analyzer, and the provenance in short. |
| `analysis.json` | The response of `analyze` for these parameters. |
| `dataset.csv` | The cleaned matrix, the same file as `.../download`; with a `miner`, its rows only. |
| `loadings.csv`, `loadings.tex` | The loadings table as `.../export` returns it. |
| `assignment.csv` | `measure`, `factors` (counted from 1, separated by spaces), `reason` (why it is in no factor) and `cross_loading` (the factors of its cross-loading, largest loading first) for every used measure, by the assignment rule of the analysis. |
| `structure.csv`, `factor-correlations.csv` | Oblique rotations only: the structure matrix and the factor correlations. |
| `eigenvalues.csv` | `factor`, `eigenvalue` and `parallel_analysis` (the random eigenvalue it is compared with), largest first. |
| `msa.csv` | `measure`, `msa`, `status` for every measure of the dataset: `used`, `removed in step k` by the MSA filter (with the MSA of that step), `excluded` (no MSA) or, with a `miner`, `dropped within the miner: <reason>` (no MSA). |
| `report.tex` | The LaTeX report as `.../export/report` returns it. |
| `correlations.csv` | The correlations of the measures left in, as a square table with `measure` and a column for each measure, in the `correlation_order`; the same numbers as `.../correlations`. |
| `figures/scree.svg`, `figures/loadings.svg`, `figures/correlations.svg` | The figures as `.../export/figure` returns them as SVG. |
| `descriptives.csv` | `measure`, `n`, `mean`, `median`, `std`, `min`, `max` and `dropped` for every measure, as `descriptives` of the dataset. |
| `inputs.csv` | Only for a computed dataset: one row per observation with `observation`, `input`, `miner`, `events`, `traces`, `variants`, `activities`, `places`, `transitions`, `arcs`, `read_s`, `discovery_s`, `discovery_run_s`, `measures_s` or `features_s`, and `error`. |
| `stages.csv` | Only for a computed dataset: `observation`, `stage` (a measure or a feature group) and `seconds`. |
| `interpretation.<language>.json` | Only if an interpretation of exactly these parameters is cached or precomputed in that language: the stored entry with its model, prompt version and parameters. The export never asks for a new one. |

`dataset.provenance` says how the dataset was made, as recorded when it was created: `kind`
and `source`; for a bundled dataset `bundled` (`id`, `file` in `datasets/` and `copied_from`
with repository and commit); for a CSV upload its `file` name; for logs or PNML files the
`inputs` (file names) and `libraries.pm4py`, which read them; for model measures `measures`
(ComFy with repository and commit) and, from logs, `discovery` (ProM4Py, the Zenodo `bundle`,
and per miner its `prom4py_call` and `parameters`, the same for every input); for log measures
`features` (feeed with its `version`, `null` for the bundled data, and a `note` on the five
features feeed 2.2.0 changed). Datasets stored before this was recorded carry what their
metadata tell, with today's versions, and `"recorded_at_creation": false`. The ZIP of a run
(`GET /jobs/{id}/download`) names the `tool` as well.

### Correlations of the measures

`POST /factor-analysis/datasets/{id}/correlations` returns the Pearson correlations of the
measures: the matrix the factor analysis starts from, which the correlation map of the suitability
step draws. The body is that of `analyze` (every field optional) plus `"order"`, which says in what
order the measures are listed:

| `order` | The measures are |
|---------|------------------|
| `dataset` (default) | in the stored order of the columns |
| `cluster` | in the leaf order of an average-linkage tree on 1 − \|r\|, so that measures that move together stand together, whatever the analysis makes of them |
| `factor` | grouped by the dimensions of the analysis the other fields describe (this runs it), the strongest loading first; then the measures without a dimension: those it kept but no factor has, then those the MSA filter removed |

The measures are those of the dataset, or of the rows of one `miner`, without the `excluded` ones.
The MSA filter takes none away, so the map shows why it removes them. Only what is shown is in
that order: the analysis always gets the columns as stored, and requesting a map changes nothing
of it.

```json
{ "n_observations": 288, "order": "cluster", "miner": null,
  "measures": ["Size", "Number of duplicate tasks", "Token split", "…"],
  "r": [[1.0, 0.994, 0.968, "…"], "…"],
  "groups": null,
  "high": { "threshold": 0.95, "count": 4,
            "pairs": [{ "a": "Number of duplicate tasks", "b": "Size", "r": 0.994 }, "…"] },
  "top": { "Size": [{ "measure": "Number of duplicate tasks", "r": 0.994 }, "…"] } }
```

- `r` is the matrix, rounded to six decimals, rows and columns in the order of `measures`.
- `groups` is `null` unless the order is `factor`; then it lists `{"factor": 0, "measures": [...]}`
  for each dimension that has measures, in the order of the factors, and last the group with
  `"factor": null` for the measures without one.
- `high` lists the pairs with |r| of 0.95 or more, strongest first (at most 200; `count` says how
  many there are). Such measures say almost the same and make the correlation matrix nearly
  singular.
- `top` has for every measure its five closest partners by |r|, strongest first. The fact sheet of
  a measure shows them.
- `miner` is as in `analyze`: the rows the correlations rest on, or `null`.

An unknown `excluded` measure or miner is a 400 with `code` and `params`, as in `analyze`
(`unknown_excluded`, `unknown_miner`); fewer than two measures left is the code
`too_few_measures_for_map`.

### Compare factor structures

`POST /factor-analysis/compare` puts the factor structures of 2 to 8 analyses side by side,
like Tab. 17 of Important Factors: which measures form which dimension for which miner. A column
of a bundled dataset is analysed on the bundled CSV itself, with the fit cache, so it makes no
dataset of the session and counts against no dataset limit; a column of a dataset of the session
on its stored matrix, also with the fit cache. JSON body:

```json
{ "columns": [
    { "bundled_id": "comfy-paper-alpha-miner" },
    { "bundled_id": "comfy-paper-directly-follows-miner" },
    { "bundled_id": "comfy-paper-inductive-miner" },
    { "bundled_id": "comfy-paper-hybrid-ilp-miner" } ],
  "assignment_rule": "hair" }
```

- `columns`: 2 to 8 (422 otherwise), all of one kind. A column has `bundled_id`, `settings`
  (`"paper"`, default: the `published_options` of the dataset, or the standard of its kind if it
  has none; `"standard"`: the standard of its kind), `options` (changes to those settings, the
  fields of `analyze` without `assignment_rule`; only what is given changes, and
  `"n_factors": null` follows the Kaiser criterion) and `label` (the title of the column, at
  most 80 characters; the label of the dataset without one). The same dataset may appear twice
  with other options, e.g. with 4 and 6 factors as in section 6 of the paper.
- Instead of `bundled_id`, a column may name a dataset of the session by `dataset_id`, with
  `settings` `"saved"` (default: the options saved with the dataset, else the standard of its
  kind) or `"standard"`, `options` as above, and `miner` (the rows of one miner, as the
  analysis option of the same name). One column each of `bundled_id` and `dataset_id` is a 422,
  as are `"saved"` or a `miner` for a bundled dataset and `"paper"` for one of the session.
  The saved factor count was fixed for the rows of the miner saved with it (`miner` of the saved
  options, none for all rows): a `"saved"` column of other rows starts from the standard count.
  This is how the UI compares the miners of a dataset, datasets picked in My datasets, and
  solutions pinned in the loadings step (dataset, miner, factor count and rotation). The header
  of such a column has `factor_names`: the names saved with the dataset for exactly the solution
  the column came to (its miner, factor count, rotation and the request's `assignment_rule`; see
  `names_k` of the saved options), one entry per factor and `null` where a factor has none, or
  `null` without any name; bundled datasets never have names:

```json
{ "columns": [
    { "dataset_id": "0c5b0f8e-…", "miner": "Alpha miner" },
    { "dataset_id": "0c5b0f8e-…", "miner": "Inductive miner", "options": { "n_factors": 4 } } ],
  "assignment_rule": "largest" }
```
- `assignment_rule`: `largest` (default), `multi` or `hair`, the same for every column. Tab. 17
  follows `hair`, which the web page starts with.

An unknown dataset, bundled or of the session (also one of another session), is a 400 with
`"code": "compare_unknown_dataset"`, columns of two kinds a 400 with `"code":
"compare_mixed_kinds"`. A column whose analysis fails, e.g. with more factors than its measures
allow, a dataset of the session that is not ready (`dataset_not_ready`) or a miner it does not
have (`unknown_miner`), carries `error` (`code`, `message`, `params`, as an analysis error) and
the others are compared without it; if none can be analysed, there is nothing to compare, and the
answer is a 400 with `"code": "compare_nothing_analysed"` (`params.reasons` lists the codes of
their errors), from `compare/export` as well.

The factors of every analysis are numbered by the analysis, so they are matched first: the first
column keeps the numbers of its factors, and the factors of each further column are matched one
to one to the dimensions of the columns before it, so that the most measures fall into the same
dimension (the Hungarian method on the number of shared measures). Where two matches share as
many measures, the one whose loadings are more alike wins (Tucker's congruence with the factors
before it in the dimension), and only if that does not tell them apart too does a factor keep its
own number. Each measure counts for the factor of its largest absolute loading, whatever the
rule, so switching the rule never renumbers the dimensions. Tab. 17 renumbered its dimensions by
hand "for easier comparability"; the tool's numbers can differ from the paper's, and a match that
rests on a single shared measure is a guess, which `matched_by` shows. The grouping of the
measures within a column does not depend on the numbers.

The response has:

- `kind`, `assignment_rule`, `cross_loading_gap` and `alignment` (`method`
  `shared_measures`, `reference` 0, a `description`, and the number of `dimensions`: the most
  factors of a column);
- `columns`, one header per column: `bundled_id` (`null` for a dataset of the session),
  `dataset_id` and `miner` (`null` for a bundled dataset), `label`, `name`, `collection`,
  `settings` (`paper`, `saved` or `standard`, as used), `options` (the parameters of the analysis, with the factor
  count it used), `published_source`, `paper_tables` (the key of the manifest, e.g.
  `other_data`), `n_measures` (of the CSV), `n_observations`, `used_measures`, `msa_removed`,
  `kmo`, `n_factors`, `rotation`, `assignment` (what the rule applied: `rule`,
  `loading_threshold`, `loading_strict`, the `communality_threshold` it used and
  `cross_loading_gap`, `cross_loaded`; the communality threshold is the higher of the parameter
  and the rule's own minimum, so 0.5 under `hair` whatever `options` say), `cumulative_variance`
  (`null` for an oblique rotation),
  `explained_variance`, `factor_count` (`kaiser`, `parallel_analysis`), `warnings` (as
  `warning_details` of `analyze`), `timings`, `factor_dimensions` (the dimension of each factor,
  from 0), `shared_measures` (how many measures each factor shares with its dimension in the
  columns before it), `matched_by` (those measures per factor, in the order of the data),
  `congruence` (Tucker's congruence of each factor with the factors before it in its dimension,
  from 0 to 1, averaged; `null` in the first column and where there are none) and `same_as` (an earlier column with the same loadings, e.g. the Alpha
  Dollar miner of the Alpha miner, else `null`);
- `measures`, one row per measure of any column, grouped by `dimension` (the one most columns
  put it in first, the leftmost column deciding a tie; `null` for none, last), with `short`,
  `agreement` (how many columns put it there) and one `cell` per column: `status` `assigned`
  (`dimensions`, `factors` and `loadings`, largest absolute loading first, `communality`,
  `cross_loading`), `unassigned` (`reason` `low_communality`, `low_loading` or `cross_loading`,
  the `factor`, `dimension` and `loading` of its largest loading, `communality`,
  `cross_loading`), `msa_removed` (`msa`, `step`), `dropped` (`reason` of the cleaning, e.g.
  `constant`; for a column of one miner also a measure without variance within its rows),
  `excluded`, `absent` (not in the dataset) or `failed`. A cross-loaded cell also
  has `cross_dimensions` and `cross_loadings`;
- `co_assignment`, for every pair of measures in how many columns both are in the same
  dimension, which needs no matching of the dimensions: `measures` (the keys, in the order of
  `measures` above) and three square, symmetric matrices indexed by them. `together` counts the
  columns in which both are in one dimension (under `multi`, in one they have in common),
  `both_assigned` those in which both are in some dimension, so that the difference to
  `together` is where they are apart, and `both_analysed` those that analysed both, in a
  dimension or not. A column that dropped, excluded or MSA-removed one of them, lacks it or
  failed, counts for none. On the diagonal a measure is paired with itself: the columns that put
  it in a dimension, and the columns that analysed it. With the paper settings and `hair`, ts and
  CFC share a dimension wherever both are in one (2 of 2), as do mcd and CNC (3 of 3, in 4
  columns that analysed both), and CH shares one with no other measure (section 6 of the paper);
- `dimensions`, per dimension and column the `factor` of the column (or `null`) and its
  `measures` with their loadings, in the order of the data, as Tab. 17 lists them (`null` for a
  column that failed);
- `unassigned`, per column the measures in no dimension with their `reason`;
- `elapsed_ms`.

With the paper settings and `hair`, the groups of the Directly Follows and the Inductive miner
are those of Tab. 17 (the bundled data have one dup column where the paper lists two). The Alpha
row of Tab. 17 also keeps MM (communality 0.37) and the cross-loaded CH. Tab. 14–16 of the
Hybrid ILP miner rest on other data: here MM is in dimension 1, sep goes with size, and CH is
in no dimension (communality below 0.5). `tests/test_compare.py` checks all of this.

`POST /factor-analysis/compare/export` takes the same body plus `"format": "csv" | "latex" |
"zip"` (default `csv`) and `"short_codes"` (default `true`: the LaTeX table names the measures
by the codes of the papers, as Tab. 17 does) and returns `factor-structures.csv`, `.tex` or
`.zip`:

- CSV: `measure`, `code`, `dimension` (of the row) and one column per dataset with `D1` (or
  `D1 D3` under `multi`), `unassigned:<reason>`, `msa_removed`, `excluded`, `dropped:<reason>`,
  `failed`, or nothing for a measure the dataset does not have. Where the analysis of a column
  named the factor, the name follows its dimension in parentheses: `D1 (Size)`.
- LaTeX: a booktabs `tabularx` (needs `booktabs`, `array` and `tabularx`) as wide as the line
  (`\linewidth`), so it fits a one- or a two-column page without a width to set: the names of the
  datasets take what they need and the dimensions share the rest. One row per dataset and one
  column per dimension, laid out like Tab. 17; comments name the rule, the thresholds it
  applied, how the dimensions were matched and the measures in no dimension. Where the analysis
  of a row named the factor, its name in italics and a colon precede the measures of the cell.
- ZIP: `comparison.json` (the response of `compare`), `membership.csv`, `dimensions.tex`,
  `co_assignment.csv` (one row per pair of measures, each once: `measure_a`, `code_a`,
  `measure_b`, `code_b`, `together`, `both_assigned`, `both_analysed`), `README.txt` and
  `manifest.json` with `app`, `created_at`, `tool`, the `request` as sent (with the rule and
  `short_codes`), `assignment_rule`, `alignment`, `columns` (per column the `bundled_id`,
  `dataset_id`, `miner`, `label`, `settings`, `analysis_params`, `factor_names`, `assignment`, `published_source`,
  `citation`, `license`, `source_url` and `source_commit`), `measure_labels`, `libraries` and
  `files`. Columns with a `dataset_id` can only be posted again in the session that has them.

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
factor groups with their thresholds, the analysis warnings, and the measure names with their
catalog definitions. The measure names are the column headers of an own CSV, so they are sent
as they are. Observation labels, dataset and file names and measure values are never sent.

```json
{ "factors": [ { "index": 1, "name": "Size", "summary": "Two or three sentences.",
                 "driving_measures": ["Size", "Token split"], "confidence": "high" } ],
  "overall": "One short paragraph.", "caveats": ["One sentence each."],
  "model": "claude-opus-5-5", "created_at": "2026-10-05T20:56:17+00:00", "language": "en",
  "prompt_version": "2", "cached": false, "precomputed": false }
```

- `factors[].index` counts from 1, as in "Factor 1" (the `factors` of `analyze` count from 0).
  `driving_measures` only names measures of the analysis; `confidence` is `low`, `medium` or
  `high`. `model` is the model that wrote the answer, a fallback model if the requested one
  declined.
- Results are cached by the cleaned data, the parameters (with the factor count the analysis
  used), the language, the model, the effort and a hash of the prompt, the output schema and
  the payload format. `cached: true` means no model call was made for this request. Own
  datasets are cached in the session, bundled ones for all sessions.
- `precomputed: true` marks an interpretation from
  `src/AlgoService/datasets/interpretations/`, made with
  `scripts/precompute_interpretations.py` for a bundled dataset with all measures and the
  default parameters. It is served without a key.
- With `cached_only: true` the server never calls Claude and answers 204 when nothing is
  stored; the UI uses it to show stored interpretations without spending anything. Given
  `n_factors` as well (the UI sends the count of the analysis on screen), it skips the
  analysis and only looks the parameters up.

Errors carry `detail` and `code`. Analysis errors come first, as for `analyze`. Then: 503
`interpretation_unavailable` (no key), 422 `interpretation_too_large` (more than 150 used
measures or 20 factors, a measure name longer than 120 characters, or a message over 80,000
characters; `params` names the limits; checked before any limit counts), 429 `interpretation_rate_limited`
(more than `INTERPRETATION_RATE_LIMIT`, default `10/hour`, live calls in this session) or
`interpretation_daily_cap` (more than `INTERPRETATION_DAILY_CAP`, default 200, live calls today
over all sessions), 503 `interpretation_limits_unavailable` (the counters cannot be reached,
e.g. Redis is down; no call is made), 422 `interpretation_refused` (the model and its fallback declined, or the
category is not retried on a fallback), 503 `interpretation_fallback_unavailable` (the model
declined and the fallback could not run; a later try may succeed), 502
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

# The settings of the paper, with the dimensions of its Tab. 12 and the check of the numbers
entry = next(b for b in s.get(f"{BASE}/factor-analysis/catalog?kind=model").json()["bundled"]
             if b["id"] == "comfy-paper-inductive-miner")
paper = s.post(f"{BASE}/factor-analysis/datasets/{ds['dataset_id']}/analyze",
               json=entry["published_options"]).json()
print(paper["published_match"]["status"], paper["factor_count"])

# Tab. 17: the four miners side by side without cross-loadings; no dataset of the session needed
miners = ["alpha", "directly-follows", "inductive", "hybrid-ilp"]
compared = s.post(f"{BASE}/factor-analysis/compare",
                  json={"columns": [{"bundled_id": f"comfy-paper-{m}-miner"} for m in miners],
                        "assignment_rule": "hair"}).json()
for i, column in enumerate(compared["columns"]):
    print(column["label"], [[m["measure"] for m in d["columns"][i]["measures"]]
                            for d in compared["dimensions"]])
```
