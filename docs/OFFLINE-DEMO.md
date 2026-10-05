# Offline demo

How to run the tool on a laptop without network access, for example at a conference. The
images are built once with internet access; after that nothing in the stack needs the
network.

## What needs the network, and when

| Step | Needs the network for |
|---|---|
| `docker compose build` | Base images (Python, Node, Temurin, Postgres, Redis), apt, pip and npm packages, and the ProM bundle from Zenodo (about 430 MB) for `prom4py`. |
| `docker compose up` | Nothing, once all six images are present locally. |
| Running the tool | Nothing. |

At runtime the containers only talk to each other: the frontend proxies `/api/*` to
`algoservice`, which reaches `postgres`, `redis` and `prom4py` by service name. Next.js
telemetry is disabled in the frontend image, the UI loads no external fonts or scripts (the
CSP allows only its own origin), and feeed computes the log measures in Python without
downloads. This was checked in the code and by running the stack without a route out (see
[What was verified](#what-was-verified)).

## Preparing the laptop

### Option A: build on the laptop

With internet access, once:

```bash
cp .env.example .env              # fill in POSTGRES_PASSWORD and SESSION_SECRET_KEY
docker compose build
docker compose pull postgres redis
```

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

## Running without network

```bash
docker compose up -d --no-build --pull never
```

`--no-build --pull never` makes compose fail at once if an image is missing, instead of trying
to download or build it. Open <http://localhost:3000> when `docker compose ps` shows every
service as healthy.

To make sure nothing in the backend can reach the outside even when the laptop is online, add
the override that puts the backend on an internal network:

```bash
docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d --no-build --pull never
```

Only the frontend is attached to a second network, so that its port can be published.

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
| Bundled log dataset (2112 × 128 after cleaning): create / first fit / cached fit | 2 s / 3 to 6 s / 0.2 s |
| Sample nets: 32 PNML × 12 measures | 6 to 7 s |
| Sample logs, model tab: 4 logs × Inductive miner × 12 measures | 11 to 20 s |
| Sample logs, model tab: 4 logs × 6 fast miners × 12 measures | 52 s |
| Sample logs, log tab: 4 logs, default feature groups | 105 s |
| Sample logs, log tab: 4 logs, simple statistics only | 3 s |

Alpha++ did not finish within 15 minutes on the largest sample log; leave the miners marked
"slow" out of a live demo. The Hybrid ILP miner fails in this image (see
[README](../README.md#operating-it)).

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

Not verified: a machine with the network adapter switched off, the `docker load` on a
different machine, and `PROM4PY_ZIP_URL` on Linux.
