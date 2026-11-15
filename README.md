# XCom

[![CI](https://github.com/Magiertx/complexity-factor-analysis/actions/workflows/ci.yml/badge.svg)](https://github.com/Magiertx/complexity-factor-analysis/actions/workflows/ci.yml)

XCom is a web tool for the exploration of event log and process model complexity. It finds out
which complexity measures of process models and event logs describe the same underlying
dimension: it collects measures over many models or logs, checks whether a factor analysis is
meaningful, and groups the measures into a few factors, the way
[ComFy](https://github.com/Pati-nets/ComFy) and
[ComFy for log measures](https://github.com/Pati-nets/ComFy-for-Log-Measures) by Patrizia
Schalk do it, but interactively in the browser.

> **For reviewers**
>
> - **Watch:** the [screencast](https://github.com/Magiertx/complexity-factor-analysis/releases/download/v1.0.0/xcom-1.0.0-screencast.mp4) (3 minutes; the link downloads the video).
> - **Try it without installing anything:** take the desktop program for Windows, macOS or Linux from the [release](https://github.com/Magiertx/complexity-factor-analysis/releases/tag/v1.0.0) and start it. The first start needs one extra step per system, which the release page lists. The desktop program has everything except the ProM miners.
> - **Full version with the miners:** Docker with Compose and about 8 GB of RAM for Docker (on Linux, `sudo` or membership in the `docker` group). The first build takes a few minutes; details in the [Quick start](#quick-start).
>   1. `git clone https://github.com/Magiertx/complexity-factor-analysis.git && cd complexity-factor-analysis`
>   2. `cp .env.example .env`, then fill in `POSTGRES_PASSWORD` and `SESSION_SECRET_KEY`
>   3. `docker compose up -d --build`, then open <http://localhost:3000>
> - **Five-minute tour:**
>   1. On the start page, **Get started**, then **Important Factors: Inductive miner** (opens with the paper settings). Walk through the six steps: Data, Dataset, Suitability, Factors, Loadings, Interpretation.
>   2. In Loadings, note the chip **Numbers = ComFy report** and try **Check stability**.
>   3. Open **Compare** with the four miners of Tab. 17 of Important Factors (the card **Important Factors: four miners compared**).
>   4. Open the **Download** menu: **Analysis (ZIP)** and **LaTeX report**.

## Features

- **Two tabs, one workflow.** *Model complexity* works on ComFy's Petri-net measures, *Log
  complexity* on the event-log measures of [feeed](https://github.com/andreamalhera/feeed).
  Both walk through the same six steps: data, dataset, suitability, factors, loadings and an
  optional interpretation.
- **Data from anywhere.** Bundled datasets (the scores of the ComFy paper for seven miners, and
  the measures of 2112 Process Discovery Contest logs), an own CSV, event logs that are mined
  with any of ComFy's nine ProM miners, or PNML models.
- **Suitability first.** Data cleaning with reasons, Bartlett's test of sphericity, KMO with
  ComFy's iterative MSA filter, and a per-measure MSA list with manual exclusion.
- **Factors and loadings.** Scree plot with the Kaiser line and a parallel analysis, five
  choices of rotation, a loading matrix with communalities, and factor groups by one of three
  assignment rules. Every change re-runs the analysis.
- **Same numbers as upstream.** On the bundled paper scores of all seven miners the analysis
  equals ComFy's own reports to the four decimals they print; tests check every published
  number, and a chip in the app says whether an analysis matches its report.
- **Compare miners.** A page puts the factor structures of up to eight bundled datasets side by
  side, with the factors matched across the miners by the measures they share.
- **Stability and a short set.** Bootstrap samples show in how many of them a measure keeps
  its factors; the short set names one representative measure per dimension.
- **Into the paper.** A LaTeX report built like ComFy's, figures as SVG or PNG at the text
  width of a CEUR page, a methods paragraph with its BibTeX entries, tables as CSV or LaTeX,
  and a ZIP of the whole analysis with its provenance.
- **Interpretation by Claude (optional).** Names and short interpretations of the factors. Only
  measure names, their definitions and aggregated results are sent. For the bundled datasets
  the interpretations are precomputed, so they need no API key.
- **And more.** A fact sheet and a correlation map for the measures, the inspection of a single
  log, the history of a session, a feedback form, an HTTP API, and an English and a German UI.

Every feature in detail: [`docs/FEATURES.md`](docs/FEATURES.md). How to use the tool: the user
guide [`docs/GUIDE.md`](docs/GUIDE.md), which the app has behind the Guide link of its header as
well. Discovery runs through [ProM4Py](https://doi.org/10.5281/zenodo.13853660), a bridge to the
ProM plugins.

## Architecture

```
┌──────────────┐  REST   ┌──────────────────┐  queue  ┌───────────────┐
│   frontend   │ ──────▶ │   algoservice    │ ──────▶ │ celery_worker │
│  Next.js 15  │         │     FastAPI      │         │  runs the job │
└──────────────┘         └──────────────────┘         └───────────────┘
                                  │                           │
                    ┌─────────────┼───────────────┬───────────┘
                    ▼             ▼               ▼
              ┌──────────┐  ┌──────────┐   ┌─────────────┐
              │ postgres │  │  redis   │   │   prom4py   │
              │   jobs   │  │  broker  │   │ Java, :4040 │
              └──────────┘  └──────────┘   └─────────────┘
```

Six services. `prom4py` is the Java bridge to ProM that all miners go through. Details in
[`docs/architecture.md`](docs/architecture.md), the HTTP API in [`docs/API.md`](docs/API.md).

## Quick start

Two required secrets have no defaults, so start by creating a `.env`:

```bash
cp .env.example .env
```

Fill in `POSTGRES_PASSWORD` and `SESSION_SECRET_KEY` (the file says how to generate one).
Without them `docker compose` stops with `required variable ... is missing a value`, on
purpose. Then:

```bash
APP_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
```

This one command builds and starts the stack; a `docker compose build` or `docker compose pull`
beforehand is not needed. On Linux, Docker needs root rights or your user in the `docker` group
([post-install steps](https://docs.docker.com/engine/install/linux-postinstall/)); otherwise the
commands fail with a permission error.

`APP_COMMIT` is optional: it puts the commit into the manifest of every export, which says
"unknown" without it. The version (`1.0.0`) is part of the image.

Everything is reached through the frontend on <http://localhost:3000>: the model tab at `/`,
the log tab at `/log`. The API is not published on the host, and the OpenAPI UI lives at
<http://localhost:3000/api/docs>. The first build downloads the ProM bundle (about 430 MB
from Zenodo) and takes a while; after that, a start takes one to two minutes, most of it the
Java bridge booting.

To try it, pick a bundled dataset on either tab, or "Petri nets" and the bundled sample nets
on the model tab. For a demo without network, see [`docs/OFFLINE-DEMO.md`](docs/OFFLINE-DEMO.md).

> To reach the API directly during development, add a `docker-compose.override.yml` with a
> port mapping for `algoservice` rather than editing `docker-compose.yml`. The closed port is
> what keeps requests from bypassing the reverse proxy and its security headers.

### Quick start without building

> **Not available yet.** The images of release 1.0.0 are not on ghcr.io yet, so a pull ends with
> `unauthorized` or `manifest unknown`. Until they are, use the Quick start above, which builds
> the images.

No checkout and no build: two files and the prebuilt images from ghcr.io.

1. Download `docker-compose.release.yml` and `env.example` from the
   [latest release](https://github.com/Magiertx/complexity-factor-analysis/releases/latest).
   Save `env.example` as `.env`.
2. Fill in `POSTGRES_PASSWORD` and `SESSION_SECRET_KEY` in `.env`, as above.
3. Start it:

```bash
docker compose -f docker-compose.release.yml up -d
```

Open <http://localhost:3000>. `CFA_TAG=v1.0.0` pins a release instead of `latest`; the image tags
keep the `v` of the git tag (`v1.0.0`, not `1.0.0`). The images
are `linux/amd64`; on Apple silicon they run under emulation (build from the sources for native
ones). See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#prebuilt-images).

### Desktop app (without Docker)

The tool also runs as one local Python process, which serves the API and the pages on
`127.0.0.1` and opens the browser: SQLite instead of Postgres, jobs in the process, one session
for the installation, no ProM yet. Packaged builds for Windows (`.zip`), macOS on Apple silicon
(`.dmg`) and Linux (`.tar.gz`) are attached to the
[releases](https://github.com/Magiertx/complexity-factor-analysis/releases); nothing to install,
the first-start warnings are in [`docs/DESKTOP.md`](docs/DESKTOP.md#download-and-first-start).

> **macOS: "XCom is damaged and can't be opened".** The download is fine; the app is not
> registered with Apple. Run `xattr -dr com.apple.quarantine /Applications/XCom.app` once in the
> Terminal and start the app again.

From a checkout:

```bash
cd src/frontend && npm ci && npm run build:export
cd ../desktop && python -m desktop_app
```

See [`docs/DESKTOP.md`](docs/DESKTOP.md) for the options, where it keeps its data, the
`settings.env` for an API key, its security checks and how the packages are built.

### Troubleshooting

- `unauthorized` when pulling: the images are still private, or the tag does not exist (see the
  note above). Build from the sources instead (Quick start).
- A permission error on Linux: Docker needs root rights or the group `docker`, see the
  [post-install steps](https://docs.docker.com/engine/install/linux-postinstall/).
- `docker compose up -d --build` is enough; a `build` or `pull` beforehand is not needed.

## Development and tests

```bash
cd src/AlgoService && python -m pytest          # backend
cd src/frontend && npm run lint && npm test     # frontend
```

How to run the services from a checkout, what the tests cover, the end-to-end tests with
Playwright and the smoke test of a running stack: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Operating it

Worker concurrency, the Java heap, the upload limits, the cost of an analysis and the slow
miners are described in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#7-operating-it), next to
reverse proxy, TLS, volumes and backups.

## Project structure

```
├── docs/                      # features, guide, architecture, API, deployment, desktop app, development
├── scripts/smoke.py           # smoke test of a running stack
├── docker-compose.yml
└── src/
    ├── AlgoService/           # FastAPI backend + Celery worker
    │   ├── algorithms/        #   tool adapters (ComFy)
    │   ├── factor_analysis/   #   factor analysis: numerics, datasets, export
    │   ├── interpretation/    #   interpretation of the factors by Claude
    │   ├── scripts/           #   precompute_interpretations.py, extract_published.py
    │   ├── datasets/          #   bundled scores and sample logs/nets, see PROVENANCE.md
    │   ├── vendored/comfy/    #   ComFy sources, see PROVENANCE.md
    │   ├── vendored/comfy_log/ #  ComFy for log measures (constants), MIT
    │   └── tests/
    ├── prom4py/               # Java ProM bridge
    ├── desktop/               # desktop app: the tool as one local process
    └── frontend/              # Next.js frontend
```

## Credits

- [ComFy](https://github.com/Pati-nets/ComFy) by Patrizia Schalk: complexity measures, miner
  wrappers and factor analysis. Related measure code is published under the MIT licence in the
  [Complexity Toolkit](https://github.com/Pati-nets/Complexity-Toolkit).
- [ComFy for log measures](https://github.com/Pati-nets/ComFy-for-Log-Measures) by Patrizia
  Schalk (MIT): the factor analysis over event-log measures, its feature groups and the
  numerically stable Bartlett test.
- [feeed](https://github.com/andreamalhera/feeed) by Andrea Maldonado (MIT): the event-log
  measures.
- [ProM4Py](https://doi.org/10.5281/zenodo.13853660): Python access to the ProM plugins.
- [pm4py](https://processintelligence.solutions/pm4py) for reading logs and handling Petri nets.

The bundled sample log `src/AlgoService/sample_logs/small_example.xes` is a small synthetic log
(six traces over the activities a to e) made for testing. The factor-analysis data in
`src/AlgoService/datasets/` (ComFy paper scores, PDC log measures, four Process Discovery
Contest logs and nets mined from them) is listed with sources and licences in
`datasets/PROVENANCE.md`.

## License

MIT, copyright Jonas Reichle and Patrizia Schalk (see `LICENSE`). The vendored ComFy code and
the ComFy data are MIT licensed by Patrizia Schalk (`src/AlgoService/vendored/comfy/LICENSE`),
ComFy for Log Measures likewise (`src/AlgoService/vendored/comfy_log/LICENSE`). Sources and
licences of all bundled data: `src/AlgoService/datasets/PROVENANCE.md`.
