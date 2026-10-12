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
| GET | `/factor-analysis/catalog?kind=model` or `kind=log` | Measures, miners (model) or feature groups (log), each with `slow: true` where it can take long, defaults, bundled datasets with the settings they were published with, and sample inputs. |
| POST | `/factor-analysis/datasets` | Create a dataset from bundled data or a CSV (ready at once), or from logs or PNML files (background job); a bundled dataset the session has already is opened again. |
| GET | `/factor-analysis/datasets?kind=model` | The datasets of your session, newest first; `kind` is optional. |
| GET | `/factor-analysis/datasets/{id}` | Status, progress, inputs, saved options, measures, dropped measures and the first 2000 rows. |
| PUT | `/factor-analysis/datasets/{id}/options` | Keep the parameters of an analysis with the dataset. |
| DELETE | `/factor-analysis/datasets/{id}` | Delete a dataset with its job and cached interpretations. |
| DELETE | `/factor-analysis/datasets?kind=model` | Delete every dataset of your session, or every one of a kind. |
| GET | `/factor-analysis/datasets/{id}/download` | The cleaned matrix as CSV. |
| POST | `/factor-analysis/datasets/{id}/analyze` | Bartlett, KMO with the MSA filter, eigenvalues with the Kaiser criterion and parallel analysis, factor analysis, factor groups by an assignment rule, and the comparison with published numbers. |
| POST | `/factor-analysis/datasets/{id}/export` | The loadings table as CSV or LaTeX. |
| POST | `/factor-analysis/datasets/{id}/export/zip` | The whole analysis as a ZIP archive: result, matrix, tables, parameters, library versions and provenance. |
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

## Notes & limits

- **Rate limits** (per source IP, tunable via `RATE_LIMIT_*` in `.env`): `60/hour` for `POST /algorithms/{id}/analyze`, `60/hour` for `POST /factor-analysis/datasets` (`RATE_LIMIT_DATASETS`; choosing a bundled dataset counts too), `600/minute` for `GET /factor-analysis/datasets/{id}`, which the UI polls, and for listing datasets, saving their options and deleting them (`RATE_LIMIT_DATASET_STATUS`), `120/minute` for factor-analysis `analyze`, `export`, `export/zip` and `interpret` (`RATE_LIMIT_FA_ANALYZE`), `300/hour` for `POST /log-stats`, `120/minute` for everything else. A 429 carries `detail` and `"code": "rate_limited"`. Interpretations that call Claude are limited further, see [Interpretation by Claude](#interpretation-by-claude).
- **Job quota:** at most 12 queued or running jobs per session (`MAX_ACTIVE_JOBS_PER_SESSION`), and at most 4 dataset jobs over all sessions (`MAX_ACTIVE_DATASET_JOBS`); both answer 429, with `"code": "job_quota"` and `params` `active`, `requested` and `limit`, or `"code": "dataset_jobs_busy"` and `params` `active`.
- **Analyses:** at most 400 measures per analysis, counted after `excluded` (400 with `"code":
  "too_many_measures_for_analysis"`). At most two analyses compute at once; a newer analyze
  request of the same session and dataset replaces an older one (409 `superseded`, see
  [Analyse](#analyse)).
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
artifacts (30 per session; a session unused for a week is removed). A dataset removed for
either reason takes the job that computed it along, as a delete does.

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
| `files` | Repeated. One `.csv`; up to 50 `.xes` / `.xes.gz`; up to 200 `.pnml`. |

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
times thus gives one dataset. The request still counts towards the rate limit. Send
`reuse=false` for a separate copy; the newest copy is the one reused from then on.

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
  "published_source": "Important Factors, ATAED 2026, Tab. 10–12",
  "paper_tables": { "key": "matches", "tables": "Tab. 10–11",
    "note": "Tab. 10–11 of the paper print the same numbers, rounded." } }
```

- `published_options` is a complete body for `analyze`. The paper fixes k = 4 a priori; the
  Heuristics miner has `n_factors` 3, because four measures are left after the MSA filter
  (its report prints a fourth factor of zeros). The defaults of `analyze` stay those of the
  tool; a client applies these options on purpose.
- `published_source` names the tables of the paper; for the Alpha Plus and Alpha Dollar
  miners, which the paper does not analyse, it says so.
- `paper_tables.key` says how the paper's tables relate to the ComFy reports the numbers are
  checked against, with `tables` the tables meant and `note` an English sentence:
  `matches` (Alpha Tab. 4–5, Inductive Tab. 10–11, Heuristics Tab. 13), `extra_dup_column`
  (Directly Follows Tab. 7–8 also have dup without τ, which the bundled data lack),
  `other_data` (Hybrid ILP Tab. 14–16 rest on other data than the bundled CSV) and
  `not_in_paper` (Alpha Plus, Alpha Dollar).
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
    "has_options": true } ] }
```

- `name_auto` is `true` when no name was given and the server made one up from the inputs,
  e.g. `3 log(s)`; the UI shows a name in its own language instead.
- `n_observations` and `n_measures` (after cleaning) are `null` until the dataset is `ready`.
- `inputs` says what the dataset is made from. `files` counts the uploaded or sample files, 1
  for a CSV and 0 for a bundled dataset. `measures`, `miners`, `groups` and `sample_id` are the
  choices made at creation, where they apply; for `bundled` and `csv`, `measures` is only there
  if columns were selected.
- `GET /factor-analysis/datasets/{id}` carries the same `name_auto`, `bundled_id` and
  `inputs`, and `options`: the saved parameters or `null`.

`PUT /factor-analysis/datasets/{id}/options` takes the body of `analyze` and keeps it with the
dataset, every field filled in, so that a client reopening the dataset can start from its last
analysis; the UI saves the parameters after each analysis. The body is checked as `analyze`
checks it, as far as that needs no analysis: 422 for an invalid value, 400 with the `code` of
`analyze` for an excluded measure the dataset does not have (`unknown_excluded`), too few
measures or observations left (`too_few_measures`, `too_few_observations`) or more factors than
the measures left allow (`n_factors_range`). Whether the MSA filter leaves enough measures only
the analysis tells. The answer is 204, or 409 if the dataset is not ready.

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
  "communality_threshold": null, "assignment_rule": "largest" }
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
   - `largest` (default, ComFy's report): the factor of the largest absolute loading, if that
     reaches `loading_threshold` and the communality reaches `communality_threshold`.
   - `multi` (Important Factors, Tab. 6–16, after Lieben et al.): a loading counts if its
     absolute value exceeds `loading_threshold`; the measure goes to every factor whose
     loading counts and lies at most 0.15 below its largest, if its communality is at least
     0.3.
   - `hair` (Important Factors, Tab. 17, after Hair et al.): the factor of the largest
     loading, if it exceeds `loading_threshold` and the communality is at least 0.5; a
     measure with another loading that counts and lies at most 0.15 below is left out.

   A higher `communality_threshold` than the rule's minimum applies instead. A measure is
   *cross-loaded* if more than one of its loadings counts and lies at most 0.15 below its
   largest; this is reported under every rule. With the paper's settings, `multi` gives Tab. 9
   of the paper exactly and Tab. 6 and 12 with one assignment more each (CH also in factor 2,
   acd also in factor 2: their loadings there lie within 0.15 of the largest), and `hair` gives
   the rows of Tab. 17 for the Directly Follows and the Inductive miner.

The response holds `bartlett` (with `regularised: true` when eigenvalues were clamped, so
chi-square reflects the floor more than the data), `kmo` (overall and per measure),
`msa_filter.removed` (`measure`, `msa`, `step`), `eigenvalues`, `suggested_n_factors`,
`factor_count`, `n_factors`, the thresholds used, `loadings` (measure → one value per factor),
`communalities`, `uniquenesses`, `variance`, `assignment_rule`, `assignment`, `factors`,
`unassigned`, `unassigned_details`, `cross_loadings`, `published_match`, `warnings`,
`warning_details` and `elapsed_ms`.

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
booktabs `tabular` with the loadings that count under the assignment rule in bold (at or
above the threshold for `largest`, above it for `multi` and `hair`), unless the communality is
below the one the rule needs, and a comment naming the rule. The CSV keeps its columns; the
assignment of each measure is in `assignment.csv` of the ZIP.

`POST /factor-analysis/datasets/{id}/export/zip` takes the same body plus `"language": "en" |
"de"` (default `en`) and returns `<dataset name>-factor-analysis.zip`, everything needed to
report or reproduce the analysis. Its errors are those of `analyze`.

| File | Content |
|------|---------|
| `manifest.json` | `app`, `created_at`, `tool` (`name`, `version` and `commit` of this tool, `null` where not recorded), `dataset` (`id`, `name`, `kind`, `source`, `bundled_id`; `collection`, `citation` and `license` for a bundled dataset, else `null`; `inputs`, `n_observations`, the `measures` left after cleaning, the `dropped` ones as `{name, reason}` and `provenance`, see below), `analysis_params` (the parameters used, with the factor count and rotation of the analysis, the thresholds of the kind and the `assignment_rule`; a single factor is not rotated), `analysis` (`method` minres of `library` factor_analyzer, the upstream code it `follows` with commits, the `assignment_rule` and the `assignment` as the result has it, the random `seed` 20261012 of parallel analysis, and `factor_count`: the factor count `used`, the `kaiser` and `parallel_analysis` suggestions, `method`, `seed`, `simulations` and `percentile`), `published` (only if the analysis used the `published_options` of a bundled dataset: these `options`, their `source` and the `match`, as `published_match`), `libraries` (versions of factor_analyzer, numpy, pandas, scipy and scikit-learn) and `files` (`{name, description}` of each file). |
| `README.txt` | The files, how to reproduce the analysis in the UI or with factor_analyzer, and the provenance in short. |
| `analysis.json` | The response of `analyze` for these parameters. |
| `dataset.csv` | The cleaned matrix, the same file as `.../download`. |
| `loadings.csv`, `loadings.tex` | The loadings table as `.../export` returns it. |
| `assignment.csv` | `measure`, `factors` (counted from 1, separated by spaces), `reason` (why it is in no factor) and `cross_loading` (the factors of its cross-loading, largest loading first) for every used measure, by the assignment rule of the analysis. |
| `structure.csv`, `factor-correlations.csv` | Oblique rotations only: the structure matrix and the factor correlations. |
| `eigenvalues.csv` | `factor`, `eigenvalue` and `parallel_analysis` (the random eigenvalue it is compared with), largest first. |
| `msa.csv` | `measure`, `msa`, `status` for every measure of the dataset: `used`, `removed in step k` by the MSA filter (with the MSA of that step) or `excluded` (no MSA). |
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
```
