# Offline demo

How to run the tool on a laptop without network access, for example at a conference. The
images are built once with internet access; after that nothing in the stack needs the
network.

## What needs the network, and when

| Step | Needs the network for |
|---|---|
| `docker compose build` | Base images (Python, Node, Temurin, Postgres, Redis), apt, pip and npm packages, and for `prom4py` the ProM bundle from Zenodo (about 430 MB) and the lp_solve Java wrapper from SourceForge (about 460 KB, for the Hybrid ILP miner). |
| `docker compose up` | Nothing, once all six images are present locally. |
| Running the tool | Nothing, except a new interpretation of factors by Claude, which calls the Anthropic API. |

At runtime the containers only talk to each other: the frontend proxies `/api/*` to
`algoservice`, which reaches `postgres`, `redis` and `prom4py` by service name. Next.js
telemetry is disabled in the frontend image, the UI loads no external fonts or scripts (the
CSP allows only its own origin), and feeed computes the log measures in Python without
downloads. This was checked in the code and by running the stack without a route out (see
[What was verified](#what-was-verified)).

The optional interpretation step is the one exception. Precomputed interpretations of the
bundled datasets, for the default settings and the paper settings, are in
`src/AlgoService/datasets/interpretations/` (made by `scripts/precompute_interpretations.py`);
they are shown offline, with or without an API key.
Any other interpretation needs the Anthropic API and therefore internet; offline, with a key
set, the request fails with "could not reach the Anthropic API" and the rest of the tool is
unaffected. Without a key the button stays disabled. Interpretations requested before, while
online, stay cached and are shown offline as well.

## Preparing the laptop

### Option A: build on the laptop

With internet access, once:

```bash
cp .env.example .env              # fill in POSTGRES_PASSWORD and SESSION_SECRET_KEY
docker compose build
docker compose pull postgres redis
```

`docker compose up -d --build` does both in one go (it builds what is missing and pulls the base
images), so the two commands above are not a precondition of it. On Linux, Docker needs root rights
or the group `docker` ([post-install steps](https://docs.docker.com/engine/install/linux-postinstall/)).
The prebuilt images of `docker-compose.release.yml` are not an option for this yet: they need a
release without a suffix and public packages (see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md#prebuilt-images)).

Start the stack once and open <http://localhost:3000> to check it, then `docker compose down`.
The images stay in the local Docker cache and are all that is needed later.

### Option B: copy the images from another machine

On a machine with internet access and the images built:

```bash
docker save -o cfa-images.tar \
  complexity-factor-analysis-frontend complexity-factor-analysis-algoservice \
  complexity-factor-analysis-celery_worker complexity-factor-analysis-prom4py \
  postgres:15-alpine redis:7-alpine
```

The archive is about 2.8 GB. On the laptop, with a checkout of the repository and a `.env`:

```bash
docker load -i cfa-images.tar
```

The image names come from the compose project name, which defaults to the name of the
checkout directory. If the checkout on the laptop has another name, add
`COMPOSE_PROJECT_NAME=complexity-factor-analysis` to `.env`, otherwise compose looks for
images that do not exist and tries to build them.

### Building without access to Zenodo

The `prom4py` image downloads the ProM bundle during the build. With a local copy of
`prom4py.zip`, serve it over HTTP and pass its URL (the download runs inside the build
container, so a `file://` path on the host does not work):

```bash
python -m http.server 8765 --directory /folder/with/the/zip
docker compose build --build-arg PROM4PY_ZIP_URL=http://host.docker.internal:8765/prom4py.zip prom4py
```

`host.docker.internal` is provided by Docker Desktop. On Linux use the host's address on the
Docker bridge instead. The other images still need their base images and packages, so this
only removes the Zenodo download.

The lp_solve Java wrapper (`lp_solve_5.5.2.5_java.zip`, checked against a pinned SHA-256)
comes from SourceForge in the same build. Serve a local copy next to the ProM bundle and add
`--build-arg LPSOLVE_JAVA_URL=http://host.docker.internal:8765/lp_solve_5.5.2.5_java.zip`
(see [`src/prom4py/README.md`](../src/prom4py/README.md#lp_solve)).

## Running without network

```bash
docker compose up -d --no-build --pull never
```

`--no-build --pull never` makes compose fail at once if an image is missing, instead of trying
to download or build it. Open <http://localhost:3000> when `docker compose ps` shows every
service as healthy. The first start of a new `prom4py` container takes about a minute; jobs
started earlier wait for it.

To make sure nothing in the backend can reach the outside even when the laptop is online, add
the override that puts the backend on an internal network:

```bash
docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d --no-build --pull never
```

If the stack is already running, run `docker compose down` first: `up` keeps an existing network
as it is, without a message, and the backend would stay online.

Only the frontend is attached to a second network, so that its port can be published.

Rate limits count per IP address, and on a demo laptop every browser tab is the same
address. The dataset status that each open tab polls has its own limit of 600 requests per
minute, but creating datasets is limited to 60 per hour, and choosing a bundled dataset
counts too. For a demo with many visitors on one machine, raise it in `.env`, e.g.
`RATE_LIMIT_DATASETS=600/hour`.

A dataset takes up to 50 event logs or 200 PNML nets (the data step shows
the numbers of the running server). On a small demo laptop a smaller number keeps one upload
from occupying the miners for long; set `MAX_LOG_FILES` and `MAX_PNML_FILES` in `.env` and run
`docker compose up -d` again. The bundled sample logs and nets stay available at any limit.

## Bundled data

All of it works without uploads; sources and licences are in
[`src/AlgoService/datasets/PROVENANCE.md`](../src/AlgoService/datasets/PROVENANCE.md).

| Tab | Source | Data | Size |
|---|---|---|---|
| Model | Bundled dataset | ComFy paper scores for seven miners (Inductive, Alpha, Alpha+, Alpha$, Heuristics, Hybrid ILP, Directly Follows) on the 288 PDC 2025 training logs | 288 × 13 each |
| Model | Petri nets, bundled sample | 32 nets mined with pm4py's inductive miner at eight noise thresholds from four PDC logs | 32 × chosen measures |
| Model | Event logs, bundled sample | Four PDC training logs (2020, 2023, 2024, 2025), mined with the chosen miners | 4 × miners rows |
| Log | Bundled dataset | feeed measures of the 2112 PDC training logs 2020 to 2025 (ComFy for log measures) | 2112 × 146 |
| Log | Event logs, bundled sample | The same four PDC logs | 4 rows |

For a demo, the bundled datasets and the sample nets give meaningful results. Four logs are
too few observations for a factor analysis over many measures; they show how a dataset is
computed, not a result. With the sample logs on the model tab, choose several fast miners
(Directly Follows, Alpha, Alpha+, Alpha$, Inductive, Heuristics) to get 24 rows.

## Timings

Measured on Docker Desktop on Windows 11 (12 virtual CPUs), with the images already built.
`prom4py` uses one CPU.

| What | Time |
|---|---|
| `docker compose up -d` until every service is healthy (cold start) | 75 to 120 s |
| Bundled model dataset: create / analyse | 0.2 s / 0.1 s |
| After the start, the analyses of the bundled datasets are computed in the background (15, `PRECOMPUTE_BUNDLED`); requests are answered meanwhile | about 5 s |
| Bundled log dataset (2112 × 128 after cleaning): create / first analysis / repeated analysis | 0.5 s / 0.05 s / 0.05 s |
| The same with `PRECOMPUTE_BUNDLED=0`, or before the 5 s are over: create / first analysis (the fit) / repeated | 0.5 s / 3.5 s / 0.1 s |
| Sample nets: 32 PNML × 12 measures | 6 to 7 s |
| Sample logs, model tab: 4 logs × Inductive miner × 12 measures | 11 to 20 s |
| Sample logs, model tab: 4 logs × 6 fast miners × 12 measures | 52 s |
| Sample logs, model tab: 4 logs × Hybrid ILP miner × 12 measures | 15 s |
| Sample logs, log tab: 4 logs, default feature groups | 105 s |
| Sample logs, log tab: 4 logs, simple statistics only | 3 s |

Alpha++ did not finish within 15 minutes on the largest sample log; leave the miners marked
"slow" out of a live demo (see [README](../README.md#operating-it)). If one is chosen anyway,
that input fails after `PROM4PY_CALL_TIMEOUT` instead of blocking, see below.

## When a miner hangs

Some miners run for very long on some logs, and ProM cannot cancel a running call. Every
discovery, one miner on one log, is therefore limited to `PROM4PY_CALL_TIMEOUT` seconds
(default 300). Nothing has to be done by hand:

- That input fails with "ProM took longer than 300 s for Alpha Plus Plus miner on
  pdc2025_02001100.xes": in a dataset job it is listed under the failed inputs and the job
  goes on, in a single run its cells read `ERR: ProMTimeout`.
- ProM itself goes on with the call. The watchdog in the `prom4py` container restarts it
  usually about half a minute after the timeout; the restart takes about 5 s. Meanwhile the
  next discovery shows "waiting for ProM to restart" and then runs normally.
- Each such input costs its job about `PROM4PY_CALL_TIMEOUT` + 40 s, and a job is killed
  after an hour, losing all its rows. At the default of 300 s about ten hanging inputs do
  that, e.g. Alpha++ over a set of PDC logs: keep the slow miners out of large dataset jobs,
  or lower the limit as below.
- Aborting a job does not stop a running ProM call either; the worker is free once the call
  returns or times out.
- `docker compose up` does not wait for `prom4py` to be healthy, so a stuck or starting ProM
  cannot hold up the stack. Jobs started before ProM is up wait for it.

`docker compose logs prom4py | grep watchdog` shows each restart. To get a hung miner out of
the way sooner, lower the limit in `.env` and run `docker compose up -d` again (it recreates
`prom4py`, `algoservice` and `celery_worker`):

```bash
PROM4PY_CALL_TIMEOUT=60
```

60 s is enough for the bundled sample logs: with all miners except the two slow ones, the
longest discovery took 19 s (Hybrid ILP on `pdc2025_02001100.xes`). Uploaded logs can need
more, which is why the default is higher.

Measured with `PROM4PY_CALL_TIMEOUT=60` (the watchdog then restarts after 90 s without an
answer), Alpha++ on `pdc2025_02001100.xes`:

| Time | What happened |
|---|---|
| 0 s | Single run with Alpha++ starts its discovery |
| 60 s | The run fails: "ProM took longer than 60 s for Alpha Plus Plus miner on pdc2025_02001100.xes" |
| 61 s | A run with the Inductive miner on the same log starts and waits for ProM |
| 90 s | Watchdog: "ProM has not answered for 90 s, a call is stuck; restarting it" |
| 96 s | ProM answers again |
| 106 s | The Inductive run completes with the same values as before the hang |

A dataset job with Alpha++ and the Inductive miner over the four sample logs took 111 s:
Alpha++ finished on three logs within seconds and failed on `pdc2025_02001100.xes`, all
other seven observations were computed. A job aborted while Alpha++ was stuck freed its
worker 60 s after the discovery started, and ProM was answering again 33 s later.

## Memory and disk

| Container | Idle | Observed peak |
|---|---|---|
| `prom4py` | 0.9 GB | 2.2 GB (`JAVA_HEAP=2G`) |
| `celery_worker` | 0.2 GB | 0.65 GB (log measures) |
| `algoservice` | 0.2 GB | 0.5 GB (fit over the bundled log measures) |
| `frontend`, `postgres`, `redis` | 0.1 GB together | |

About 1.5 GB idle and 3.5 GB at peak, so give Docker at least 4 GB, better 6 GB; a laptop with
8 GB of RAM is the minimum. `docker images` lists 4.3 GB for the six images, less in practice
because `algoservice` and `celery_worker` share their layers; the `docker save` archive is
2.8 GB.

## What was verified

- The code: outgoing HTTP calls exist only in the ProM4Py client, against `PROM4PY_URL`
  (`http://prom4py:4040`), and in the frontend, against its own `/api`.
- The stack started with `docker-compose.offline.yml`-style isolation (all containers on an
  internal network): `algoservice` could not resolve or reach `pypi.org`, `zenodo.org` or
  `1.1.1.1`, while catalog, bundled datasets, analysis, LaTeX export, a PNML job, a model job
  over the sample logs with four ProM miners and a log job with feeed all succeeded.
- With `docker-compose.offline.yml` itself, the frontend was reachable on port 3000 and
  `algoservice` still had no route out.
- `docker save` and `docker load` of the six images, and the start with
  `--no-build --pull never`.
- `PROM4PY_ZIP_URL` with an HTTP server on the host (with a stand-in archive).
- A hanging miner with `PROM4PY_CALL_TIMEOUT=60` (timeline in
  [When a miner hangs](#when-a-miner-hangs)), and recreating `algoservice` and
  `celery_worker` while `prom4py` was unhealthy: `docker compose up -d` returned after 5 s and
  both were healthy after 22 s.

Not verified: a machine with the network adapter switched off, the `docker load` on a
different machine, and `PROM4PY_ZIP_URL` on Linux.
