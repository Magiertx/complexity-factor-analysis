# Desktop app

The whole tool as one local process, without Docker: one Python process serves the API and the
pages on `127.0.0.1` and opens the app in the default browser. A small window shows where it
runs and quits it.

It comes as a packaged build for Windows, macOS and Linux (no Python, Node.js or Docker needed)
and runs from a checkout; the launcher is `src/desktop/desktop_app`.

## Download and first start

Take the archive for your system from the
[releases](https://github.com/Magiertx/complexity-factor-analysis/releases). Nothing is
installed; the program is a folder (about 300 MB unpacked, 150 MB to download).

| System | File | Needs |
|---|---|---|
| Windows | `<name>-<version>-windows-x64.zip` | Windows 10 or 11, 64 bit |
| macOS | `<name>-<version>-macos-arm64.dmg` | Apple silicon (M1 or newer), macOS 14 or newer |
| Linux | `<name>-<version>-linux-x64.tar.gz` | 64 bit, glibc 2.35 or newer (Ubuntu 22.04, Debian 12, Fedora 36 or newer) |

`<name>` is `APP_NAME` as a slug (`complexity-factor-analysis`). The program opens the app in the
default browser; the small window it shows says where it runs and quits it. The first start takes
a few seconds longer (the database is made, matplotlib indexes its fonts).

The builds are not signed with a certificate the systems know, so each of them warns once:

- **Windows.** Unzip the whole archive first (right click, Extract All; the program does not run
  from inside the zip), then start `<name>.exe`. SmartScreen says "Windows protected your PC":
  click "More info", then "Run anyway". Unblocking the zip before extracting (right click,
  Properties, tick "Unblock") avoids the warning. The folder also has `<name>-console.exe`,
  which shows a console with the log and quits on Ctrl+C; use it if the normal one does not open.
- **macOS.** Open the `.dmg` and drag the app to Applications. The app is signed ad hoc, not by
  a registered developer, so macOS says it cannot verify it. Right click the app, choose "Open",
  and "Open" again in the dialog; or open System Settings, Privacy & Security, scroll to the
  message about the app and click "Open Anyway" (it asks for your password). Once per downloaded
  version. If macOS says the app "is damaged", run
  `xattr -dr com.apple.quarantine "/Applications/<APP_NAME>.app"` in a terminal and start it again.
- **Linux.** `tar xzf <name>-<version>-linux-x64.tar.gz`, then `./<name>/<name>`; if the file
  manager says it is not executable, `chmod +x <name>/<name>`. Without a display (a server) the
  window is skipped and the log says the address; the app listens on `127.0.0.1` only, so reach
  it through an SSH tunnel.

**Quit** with the window's "Quit" button or by closing it. **Update** by unpacking the new
version; the data are in the user's directories (below), not in the program's folder.
**Uninstall** by deleting the program's folder (Windows, Linux) or the app (macOS), and the
directories of the table below if the data should go too.

An API key for new interpretations by Claude goes into `settings.env` (below). Without it the
app shows the precomputed interpretations only, and it makes no other network calls.

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
| `--token-file PATH` | Write the access token of this start to PATH (owner only), for scripts; they send it as `Authorization: Bearer <token>` (see "Security"). Also written when a second start found a running app. |
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
requests to it, and every other program on the machine, also of another user, can reach it.
Therefore:

- **Access.** Each start makes a random master token (`secrets.token_urlsafe(32)`), kept in
  `instance.json` (owner only) and in the file of `--token-file`, and never logged (the log and
  the console replace `token=...` by `token=***`). The files that hold a secret are written
  through a new owner-only file made with `mkstemp` and moved into place. The master token is for
  programs: `Authorization: Bearer <token>`, the instance check, and asking the running app for
  a code (`/_desktop/login`, which a second start uses). A browser is let in with a
  **one-time code**: the launcher opens `http://127.0.0.1:<port>/?token=<code>` (the command line
  of the browser is visible to other users, so the token is never in it; a code is valid once and
  for 5 minutes, "Open in browser" makes a new one). The page server redeems it for a fresh random
  session value, sets that as the cookie `desktop_access_<port>` (`HttpOnly`, `SameSite=Strict`,
  `Path=/`, no expiry: it goes with the browser session) and redirects to the same address
  without the code. Every page, every file and every API request, the progress stream included,
  needs that cookie or the bearer header. Without them the API answers 401 and a page shows a
  short note to start the app from its icon. Only `/api/health` is open, and says only "ok" and
  whether the database answers. All comparisons take constant time. A new start has new values,
  so an old bookmark of `http://127.0.0.1:8765/` shows the note until the app is opened from its
  icon or window. Browsers share cookies between ports of a host, so another local web server
  could receive the cookie; it holds a value that opens nothing but this app, until it quits.

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
(cd src/desktop && python -m desktop_app --headless --port 0 --port-file /tmp/cfa-port --token-file /tmp/cfa-token \
    --data-dir /tmp/cfa-data --separate-sessions) &

python scripts/smoke.py --port-file /tmp/cfa-port --token-file /tmp/cfa-token --no-prom

cd src/frontend
BASE_URL=http://127.0.0.1:$(cat /tmp/cfa-port) CFA_TOKEN=$(cat /tmp/cfa-token) npx playwright test
```

`CFA_TOKEN` lets a global setup redeem a one-time code once and gives every browser context the session cookie (`e2e/desktop-setup.ts`; `e2e/desktop-access.spec.ts` runs the way in itself). `--separate-sessions` gives each Playwright browser context a session of its own, as the specs
expect of a server. The request limits are off by default, which the specs need: they create far more than 60
datasets within the hour, all from 127.0.0.1. On Windows without Playwright's own Chromium, add
`PW_CHANNEL=msedge`.

## Packaging

`scripts/build_desktop.py` builds what a release contains. The CI (`.github/workflows/desktop.yml`)
runs it on Windows, Linux (Ubuntu 22.04, for the glibc of the binary) and macOS 15, tests the
built program and attaches the archives to a release (a `v*` tag). Locally, with Python 3.11,
Node.js 22 and
`pip install -r src/AlgoService/requirements-dev.txt -r src/desktop/requirements-desktop.txt -c src/AlgoService/constraints.txt`:

```bash
(cd src/frontend && npm ci)
python scripts/build_desktop.py all     # frontend, bundle, pack; output in build/desktop
```

| Step | Does |
|---|---|
| `frontend` | `npm run build:export`, and `src/frontend/npm-licenses.txt` with the licences of the npm packages in the pages |
| `bundle` | writes `build/desktop/stage` (`build_info.json` with `APP_VERSION` from `version.py` and `APP_COMMIT` from git, `LICENSE`, `THIRD-PARTY-LICENSES.txt` from `pip-licenses` and the npm licences), then runs PyInstaller on `src/desktop/desktop.spec` |
| `pack` | Windows: `.zip`; macOS: `.dmg` of `<name>.app` (`hdiutil`); Linux: `.tar.gz` |
| `verify-macos` | no binary of the bundle needs a newer macOS than the stated minimum |
| `exe` | prints the program inside the bundle (for the CI) |

A tag build checks that the tag names the version of `version.py` (`v1.0.0` for `1.0.0`). On
Windows a checkout in a deep directory exceeds the 260 characters of a path; set `CFA_BUILD_DIR`
to a short directory.

What a frozen build carries, and why (`desktop_app/resources.py` is the one place that knows the
layout, `src/desktop/desktop.spec` writes it):

- `multiprocessing.freeze_support()` and the replacement of a missing stdout or stderr happen in
  `desktop_app/__main__.py`, which is the entry script.
- The backend's modules and data files at the bundle root (`sys._MEIPASS`), as their
  `__file__`-relative paths expect: `datasets/`, `sample_logs/`, `alembic/` with its `.py` files.
- The source of the backend's `config` module (the launcher reads `APP_NAME` from it without
  running it), of `vendored` and of `feeed` (`inspect.getsource` and a scan for the code behind
  each measure on its fact sheet). Without them the sheets show no sources, and without `config`
  the app does not start.
- The metadata of every installed package: the exports record versions (pm4py, feeed, NumPy, ...).
- The static export in `frontend/`, `build_info.json` with `APP_VERSION` and `APP_COMMIT` at the
  root (a bundle has no `.git`), `LICENSE` and `THIRD-PARTY-LICENSES.txt` in `licenses/` (and
  next to the program in the archive).
- Left out: Celery, Kombu, Billiard, amqp, asyncpg, uvloop (the Docker stack's), pytest, cvxopt.
  Redis stays, `config.py` imports it. Graphviz is not shipped; it is optional and draws the
  Petri-net images of a ProM run, which the desktop app does not have yet.
- Windows has two programs that share one set of files: `<name>.exe` without a console window,
  and `<name>-console.exe`, which prints the log and quits on Ctrl+C and Ctrl+Break (a program
  without a console cannot receive that signal).

### What the CI checks of the built program

`scripts/run_frozen.py` starts it headless (`--port 0 --port-file --token-file`, own process group), waits for
`/api/health`, runs the commands below and quits it with SIGTERM (Ctrl+Break on Windows), which
must end with exit code 0:

1. `scripts/smoke.py --no-prom`: the paper analysis as published, datasets from PNML files and
   logs, the ZIP export.
2. `scripts/check_desktop.py`: version and commit in the export's manifest (a frozen build has no
   git), ComFy's KMO 0.7467, a source for every measure on the fact sheets, the pm4py version in
   the manifest, `.js` and `.css` served with their types, the page's security headers and the
   API's own.
3. Playwright against it: the whole suite without the specs that need ProM on Windows and Linux,
   the specs for a missing ProM on macOS.

The backend tests that guard the numbers (`test_published_numbers`, `test_msa_invariance`,
`test_factor_analysis_core`, `tests/desktop`) run first on each system, without cvxopt; Linux runs
the whole suite. On Windows the program without a console is started as well and must answer.

### cvxopt

PM4Py imports cvxopt for its linear-programming solvers when it is installed and uses SciPy's
otherwise. The 1.3.3 wheels of cvxopt for Apple silicon need macOS 15; the rest of the bundle
needs macOS 14 (the SciPy 1.17 and NumPy 2.4 wheels). The desktop app leaves cvxopt out on every
system: the same solver everywhere, and macOS 14 instead of 15 as the minimum. The app calls none
of PM4Py's solvers itself (it reads logs and nets and computes measures); the CI runs the tests
above on every system, and the whole backend suite on Linux, with cvxopt uninstalled, and
`verify-macos` checks every binary of the macOS bundle against the stated minimum. The Docker
image still installs cvxopt.

### Licences

The tool is MIT licensed. PM4Py (AGPL-3.0-or-later) and Levenshtein (GPL-2.0-or-later) are part of
the bundle, so a build is a combined work that is also offered under their terms.
`THIRD-PARTY-LICENSES.txt` lists every package with its licence text, names where the source of
the tool and of PM4Py is, and carries the licences of the npm packages in the pages.
