# Development and tests

How to run the services from a checkout and what the tests cover.

## Local development

Backend, from `src/AlgoService`:

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt -c constraints.txt
SESSION_SECRET_KEY=dev-only-not-a-deployment uvicorn srv_main:app --reload --port 8000
```

`constraints.txt` pins every package to the version of the Docker image and CI, so the local
environment matches them (how to update it: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md#pinned-dependency-versions)).

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
Graphviz. The factor-analysis tests run offline: model datasets from logs use a stand-in
miner, PNML and log datasets run for real (feeed 2.2 needs no Java). The HTTP layer is tested
with a small stub tool registered by `tests/conftest.py`, so those tests need neither Java nor
a database server.

`tests/test_published_numbers.py` checks the bundled datasets against the numbers they were
published with, extracted once into `datasets/published/` by
`scripts/extract_published.py`: all seven ComFy reports (Bartlett, KMO, every MSA with its
filter round, eigenvalues, loadings, communalities and descriptive statistics) and, for the
log measures, the cleaning and Bartlett's chi-square. `tests/test_column_order.py` checks that
the analysis, the MSA filter and the exports keep the stored column order, on which the last
bits of every number depend. `tests/test_assignment_rules.py` checks the three assignment rules
against the dimension tables of Important Factors (Tab. 6, 9 and 12 with the two documented
deviations, and two rows of Tab. 17), `tests/test_compare.py` the comparison of the miners
against all four rows of Tab. 17 with its documented deviations, `tests/test_published_match.py` the published settings
and the check against the reports at runtime, `tests/test_parallel_analysis.py` the values of
parallel analysis with its seed, and `tests/test_analysis_load.py` the measure cap and how a
newer request replaces an analysis, with a stand-in fit.

Frontend checks, from `src/frontend`:

```bash
npm run lint
npx tsc --noEmit
npm test               # Vitest: lib/format.ts and lib/factor-analysis.ts
npm run check:i18n     # en.json and de.json alike, every key in the code exists
npx next build
```

### End-to-end tests

Playwright drives the UI in a browser (`src/frontend/e2e/`): a paper dataset through all six
steps with its ZIP, a CSV upload reopened from "My datasets" with its excluded measure, the
PNML and log samples, deleting a dataset, the comparison of the four miners of Tab. 17 with its
pairs of measures, its factor counts per column and its downloads, decimal commas in German, the theme switch, axe on every route in light and dark, and a single run without ProM, which the page has to refuse up front
with the reason. They check text, roles and downloads, no pixels. They also run against `npm run dev`
(`BASE_URL=http://localhost:3000`): the fixture lets clicks pass through the tools of the
development server, whose button would otherwise cover Back on a phone (`e2e/fixtures.ts`).

Against the Docker stack, with a browser installed on the machine (here Microsoft Edge;
Playwright's own browsers are not needed):

```bash
cd src/frontend
BASE_URL=http://localhost:3000 PW_CHANNEL=msedge E2E_PROM=1 npx playwright test
```

The suite opens many sessions from one address, so a stack with the default request limits
answers some of them with 429. For a local run, start the stack with the e2e override, which
sets `RATE_LIMIT_DISABLED=1` for the backend and nothing else, and go back to the default file
afterwards:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build   # limits off
docker compose up -d                                                           # limits on again
```

`docker-compose.yml` keeps the limits; the override is for a machine you test on, never for a
deployment.

`E2E_PROM=1` says that the stack has ProM: it adds the specs tagged `@prom` (the sample logs
mined with the default miner) and skips those tagged `@no-prom`. The `e2e` job in CI runs the
suite without ProM, against `uvicorn` on SQLite (`TESTING=1`, `RATE_LIMIT_DISABLED=1`,
`ARTIFACTS_DIR`, `UPLOADED_LOGS_DIR`, `PROM4PY_START_WAIT=2`) and the standalone Next.js
server; see `.github/workflows/ci.yml` to do the same locally. The data directories need short
paths on Windows, whose paths may not exceed 260 characters.

### Smoke test of a running stack

`scripts/smoke.py` works through every dataset source (the sample logs with the default miner,
the sample nets, the sample logs with feeed), analyses a paper dataset with its published
settings and compares the numbers, also by the server's own check against the report, opens
the same paper dataset again to see the session's copy come back, downloads its ZIP and LaTeX
table, and deletes everything it created. It needs only the standard library and prints a table of the steps with their
times; a failed step makes it exit with 1.

```bash
python scripts/smoke.py --base-url http://localhost:3000
```

Against the desktop app, which has no ProM: `--port-file <file> --token-file <file> --no-prom` (see
[`docs/DESKTOP.md`](DESKTOP.md#tests)).
