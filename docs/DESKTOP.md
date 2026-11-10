# Desktop app

The whole tool as one local process, without Docker: one Python process serves the API and the
pages on `127.0.0.1` and opens the app in the default browser. A small window shows where it
runs and quits it.

Packaged builds (Windows, macOS, Linux) do not exist yet. This page describes how to run the
desktop app from a checkout; the launcher is `src/desktop/desktop_app`.

## What differs from the Docker stack

| | Docker stack | Desktop app |
|---|---|---|
| Processes | frontend (Next.js), API, Celery worker, Postgres, Redis, ProM4Py | one Python process |
| Pages | Next.js server | the static export (`npm run build:export`), served by the launcher |
| Database | Postgres | SQLite file, WAL mode |
| Jobs | Celery worker | in the process, at most `LOCAL_JOB_SLOTS` (2) at once; jobs that were running when the app ended are marked "interrupted" at the next start |
| Sessions | one per browser, 14 days | one for the installation (`SHARED_SESSION_ID`), kept for good |
| Clean-up | idle datasets after 7 days, more than 30 datasets, runs on a full disk | none: the data are the user's own |
| ProM | ProM4Py container | not yet: everything that mines a log fails after 2 s with the "ProM unavailable" error |

Without ProM the app runs fully offline with the bundled datasets, Petri nets (PNML), log
measures (feeed), factor analysis, stability, comparison, the exports and the precomputed
interpretations. A new interpretation by Claude needs an API key and the network.

## Running from source

Python 3.11 or 3.12 with the backend's requirements, and Node.js 22 for the export of the pages:

```bash
cd src/AlgoService
pip install -r requirements.txt -c constraints.txt

cd ../frontend
npm ci
npm run build:export          # writes src/frontend/out

cd ../desktop
python -m desktop_app
```

The first start creates the data directory, migrates the database and opens
<http://127.0.0.1:8765/>. The status window has "Open in browser", "Open data folder",
"Open log" and "Quit"; closing it quits as well. Where Tk is missing or there is no display, the
app runs in the console and Ctrl+C quits. Quitting lets open requests finish (5 s at most) and
then stops; the page's progress stream is cut.

Starting it a second time while it runs opens the browser on the running app and ends.

| Option | Meaning |
|---|---|
| `--headless` | No browser, no window; for CI and scripts. Ctrl+C (Ctrl+Break on Windows when started in a process group) or SIGTERM quits. |
| `--port N` | Listen on port N, `0` for any free port. Neither remembered nor replaced by another port if it is taken. |
| `--port-file PATH` | Write the port to PATH once the server answers (also when a second start found a running app). |
| `--data-dir PATH` | Keep data, settings and logs (`PATH/logs`) in PATH instead of the user's directories. |
| `--frontend-dir PATH` | Serve another static export. |
| `--separate-sessions` | A session per browser, as on a server, instead of the one shared session. For the end-to-end tests, whose specs compare sessions. |
| `--rate-limits` | Switch the request rate limits on, as on a server. They are off by default (`RATE_LIMIT_DISABLED=1`): they count per address, and here every request comes from 127.0.0.1, so one user would share them with everything else (e.g. 60 new datasets an hour). The daily caps of Claude calls apply either way. |
| `--access-log` | Log every request. |

## Where it keeps its files

The directories are named after `APP_NAME` (`src/AlgoService/config.py`):

| | Data | Settings | Log |
|---|---|---|---|
| Windows | `%LOCALAPPDATA%\<name>` | the same | `%LOCALAPPDATA%\<name>\Logs` |
| macOS | `~/Library/Application Support/<name>` | the same | `~/Library/Logs/<name>` |
| Linux | `~/.local/share/<name>` | `~/.config/<name>` | `~/.local/state/<name>/log` |

On Linux the `XDG_*` variables move them. The directories are created for the owner only
(mode 0700 where the system has modes).

- Data: `app.db` (with `-wal` and `-shm`), `artifacts/` (datasets, runs, interpretations),
  `uploaded_logs/`, `identity.json` (the key that signs the session cookie and the id of the one
  session; mode 0600), `instance.json` and `instance.lock` (the running instance).
- Settings: `launcher.json` (the port), and `settings.env` if you create it.
- Log: `app.log`, everything the process writes, rotated at 2 MB with five old files.

Back up the data directory to keep datasets and runs. Without `identity.json` the next start
makes a new session, and the datasets and runs of the old one are no longer shown (they stay on
disk). A broken `identity.json` stops the start with a message instead.

## settings.env

An optional file in the settings directory, one `NAME=value` per line, `#` for comments.
It may set `ANTHROPIC_API_KEY`, `LOCAL_JOB_SLOTS`, `PRECOMPUTE_BUNDLED` and any
`INTERPRETATION_*` or `PROM4PY_*` setting (see [`DEPLOYMENT.md`](DEPLOYMENT.md)); the launcher
skips other names with a warning in the log. A variable of the process environment with the
same name wins over the file.

```bash
# Live interpretations by Claude (see DEPLOYMENT.md, "Interpretation by Claude")
ANTHROPIC_API_KEY=sk-ant-...
INTERPRETATION_MODEL=claude-opus-5-5
```

The key is never logged; the log says whether interpretation is on and where the key came from.
The limits on interpretations apply as on a server. `PRECOMPUTE_BUNDLED=1` computes the analyses
of the bundled datasets after each start, as the Docker stack does; it is off, since it would
take the analysis slots right when the app opens.

## What the launcher sets

Before it imports the backend, which reads its settings at import time:

| Setting | Value |
|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///<data>/app.db`; migrated with `db_migrate.upgrade_to_head()` before the server starts |
| `ARTIFACTS_DIR`, `UPLOADED_LOGS_DIR` | `<data>/artifacts`, `<data>/uploaded_logs` |
| `SESSION_SECRET_KEY`, `SHARED_SESSION_ID` | from `identity.json`, made on the first start |
| `SESSION_MAX_AGE`, `DATA_MAX_IDLE_DAYS`, `MAX_DATASETS_PER_SESSION`, `LOW_DISK_CLEANUP_FREE_PCT` | `never` |
| `OPENBLAS_NUM_THREADS`, `VECLIB_MAXIMUM_THREADS` | `1`, as in the Docker image |
| `FASTAPI_ROOT_PATH` | `/api` |
| `PROM4PY_START_WAIT` | `2` unless set |
| `APP_VERSION`, `APP_COMMIT` | from `build_info.json` of a packaged build, unless set; from a checkout git answers |
| removed | `REDIS_URL`, `RATE_LIMIT_DISABLED`, `TESTING`, `TEST_DATABASE_URL` |

The rate limits stay on. They count per client address, which is `127.0.0.1` for every request
here, so they apply to the installation as a whole: for example 60 datasets an hour
(`RATE_LIMIT_DATASETS`; opening a bundled dataset counts, also when the session's copy comes
back) and 60 single runs an hour (`RATE_LIMIT_ANALYZE`). Past a limit the app answers 429 until
the hour is over.

## Security

The server listens on `127.0.0.1` only, but every web page open in the browser can send
requests to it. Therefore:

- **Host check.** Only `Host: 127.0.0.1:<port>` and `localhost:<port>`; anything else gets 400.
  A foreign domain that resolves to 127.0.0.1 (DNS rebinding) arrives with its own name.
- **Origin check.** POST, PUT, PATCH and DELETE need the app's own `Origin` (or `Referer` where
  there is no `Origin`); others get 403. A form post or multipart upload of another site is a
  "simple" request that CORS does not stop. Requests without either header come from programs
  (the smoke test, curl), not from web pages, and pass.
- **No CORS.** No `Access-Control-*` header leaves the app, and preflights of other origins get
  403, so no other site can read an answer.
- **Headers.** Pages carry the headers of `out/_headers.json` (the same list as the Docker
  build's, from `src/frontend/security-headers.mjs`); the API keeps its own
  `default-src 'none'`. MIME types are set by the launcher, not read from the Windows registry,
  which can name `.js` `text/plain` (the page would stay white under `nosniff`).
- **No proxy headers.** Uvicorn ignores `X-Forwarded-*`; nothing stands in front of it.

## Port and single instance

The first start takes port 8765 and remembers it in `launcher.json`. If another program has it,
the app takes a free port and remembers that one: the browser keeps the app's settings (theme,
language, tour) per origin, so a new port starts with fresh ones.

The process that serves a data directory holds a lock on `instance.lock`, which the system
releases when the process ends, also after a crash. A second start on the same data directory
finds the lock taken, asks the port in `instance.json` with the token there whether the app
answers, opens the browser on it and ends. Two processes on one SQLite file, each running its
own jobs, cannot happen.

## Tests

The launcher's tests are in `src/AlgoService/tests/desktop` and run with the backend's suite
(`python -m pytest` in `src/AlgoService`). One of them starts `python -m desktop_app` as a
process, starts it a second time on the same data directory, quits it and starts it again.

Against the running app, from the root of the repository, with the port from a file:

```bash
(cd src/desktop && python -m desktop_app --headless --port 0 --port-file /tmp/cfa-port \
    --data-dir /tmp/cfa-data --separate-sessions) &

python scripts/smoke.py --port-file /tmp/cfa-port --no-prom

cd src/frontend
BASE_URL=http://127.0.0.1:$(cat /tmp/cfa-port) npx playwright test
```

`--separate-sessions` gives each Playwright browser context a session of its own, as the specs
expect of a server. The request limits are off by default, which the specs need: they create far more than 60
datasets within the hour, all from 127.0.0.1. On Windows without Playwright's own Chromium, add
`PW_CHANNEL=msedge`.

## Packaging

Comes with the packaged builds. What the launcher expects of a frozen build
(`desktop_app/resources.py` is the one place that knows the layout):

- `multiprocessing.freeze_support()` and the replacement of a missing stdout or stderr happen in
  `desktop_app/__main__.py`, which is the entry script.
- The backend's modules and data files at the bundle root (`sys._MEIPASS`), as their
  `__file__`-relative paths expect: `datasets/`, `sample_logs/`, `alembic/` with its `.py` files.
- The source of the backend's `config` module: the launcher reads `APP_NAME` from it without
  running it.
- The static export in `frontend/`, `build_info.json` with `APP_VERSION` and `APP_COMMIT` at the
  root.
