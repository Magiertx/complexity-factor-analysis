# ProM4Py service

Java-based process-mining backend used by `algoservice` for algorithms that depend on ProM plugins (ComFy).

## What this is

Bundles the ProM4Py Java backend from <https://zenodo.org/records/13853660> and runs it headless. Exposes the ProM4Py HTTP API on port `4040`:

| Endpoint     | Method | Purpose |
|--------------|--------|---------|
| `/isRunning` | GET    | Liveness probe (used by the [watchdog](#watchdog)) |
| `/executor`  | POST   | Run a Java expression string, returns a cache key |
| `/plugin`    | POST   | Invoke a ProM plugin by name + params |
| `/cache`     | GET/POST/DELETE | Object cache (results live here, accessed by key) |
| `/align`     | POST   | Alignment plugin (uses lp_solve, see [lp_solve](#lp_solve)) |
| `/exit`      | POST   | Shut down the server |

## Why a separate container

- Isolates the Java lifecycle (first boot of a new container about a minute, later starts a
  few seconds; up to `JAVA_HEAP` of memory) from the lightweight Python AlgoService.
- Lets us upgrade / restart / scale either side independently.
- Keeps the AlgoService image small (no JRE).

## Build & run

The bundle is downloaded during build, **not** vendored:
```bash
docker compose build prom4py
docker compose up prom4py
```

To use a local copy instead of the Zenodo download, serve it over HTTP and pass its URL; the
download runs inside the build container, so a `file://` path on the host is not visible to
it:

```bash
python -m http.server 8765 --directory /path/to/folder-with-prom4py.zip
docker compose build --build-arg PROM4PY_ZIP_URL=http://host.docker.internal:8765/prom4py.zip prom4py
```

`host.docker.internal` works with Docker Desktop; on Linux use the host's address on the
Docker bridge (usually `172.17.0.1`).

## Watchdog

ProM4Py serves every request on one thread (the JDK `HttpServer` without an executor), so a
plugin call that runs for long blocks all others, `/isRunning` included, and no endpoint can
cancel it; `/exit` waits behind the call as well. Alpha++, for example, ran for more than
15 minutes on one 1000-trace PDC log. `launch.sh` therefore does not `exec` Java but keeps it
as a child process and watches it:

- If Java exits, it is started again after 2 s.
- While ProM answers, `/isRunning` is probed every 10 s. A busy ProM does not answer, so the
  next probe waits for it. When no probe has been answered for `PROM4PY_CALL_TIMEOUT` + 30 s
  (default 330 s), Java gets `TERM` (`KILL` if it still runs 5 s later) and is started
  again. The backend gives
  up on a call after `PROM4PY_CALL_TIMEOUT`, so this never cuts off a call that a job still
  waits for. Discoveries take turns on ProM, which keeps calls from queueing behind each other.
- A start that does not answer within 600 s is restarted as well.

Every action is logged with a `[watchdog]` prefix:

```text
[watchdog] 2026-10-06T05:53:58Z ProM has not answered for 90 s, a call is stuck; restarting it
[watchdog] 2026-10-06T05:54:04Z ProM answers after 6 s
```

A restart takes about 5 s, because the plugin cache that ProM builds on the first start stays
in the container; the first start of a new container takes about a minute. A restart empties
ProM's object cache, so a discovery that loses its connection starts over (see
`algorithms/comfy.py`, `discover`).

The healthcheck (`launch.sh health`) does not call ProM itself, which would fail during every
long discovery. It checks that the watchdog saw an answer within the last
`PROM4PY_CALL_TIMEOUT` + 40 s, i.e. that ProM answers or is busy for no longer than allowed.
`algoservice` and `celery_worker` wait only for the container to be started, not healthy, so
a ProM that is stuck or starting never holds up `docker compose up`.

`PROM4PY_CALL_TIMEOUT` (seconds, at least 10) comes from `.env` through `docker-compose.yml`
and must be the same for `prom4py`, `algoservice` and `celery_worker`; compose passes the one
value to all three.

## lp_solve

The Hybrid ILP miner solves its ILPs with lp_solve 5.5 through ProM's `LpSolve` package. Its
class `lpsolve.LpSolve` loads two native libraries, and without them discovery fails with
`no lpsolve55 in java.library.path`:

| Library | What it is | Where it comes from |
|---------|------------|---------------------|
| `liblpsolve55.so` | the solver | Ubuntu package `lp-solve` (5.5.2.5), installed to `/usr/lib/lp_solve` |
| `liblpsolve55j.so` | the JNI wrapper for `lpsolve.LpSolve` | not packaged by Ubuntu; compiled from `src/c/` of the official [lp_solve Java distribution](https://sourceforge.net/projects/lpsolve/files/lpsolve/5.5.2.5/) in the `lpsolve-wrapper` build stage, copied to `/usr/lib/lp_solve` |

The build downloads `lp_solve_5.5.2.5_java.zip` (about 460 KB) from SourceForge, checks its
SHA-256 (`LPSOLVE_JAVA_SHA256` in the Dockerfile) and compiles the wrapper against the Ubuntu
solver, so it works on x86-64 and arm64 (e.g. Apple silicon) alike. The wrapper finds
`liblpsolve55.so` through its rpath; `launch.sh` puts `/usr/lib/lp_solve` on
`java.library.path`. For a build without SourceForge, pass a local copy the same way as the
ProM bundle:

```bash
docker compose build --build-arg LPSOLVE_JAVA_URL=http://host.docker.internal:8765/lp_solve_5.5.2.5_java.zip prom4py
```

To check an image: `docker compose logs prom4py` prints `LpSolve Libraries Loaded` on the
first Hybrid ILP run.

## Notes

- ProM only supports **Java 8**. The base image is `eclipse-temurin:8-jre-jammy`.
- Default port is 4040 (configurable via `PROM4PY_PORT`).
- Default heap is 4 GB (configurable via `JAVA_HEAP`).
- `PROM4PY_CALL_TIMEOUT` (default 300) sets when the watchdog restarts a stuck ProM, see
  [Watchdog](#watchdog).
- The Alignment plugin needs the same lp_solve libraries as the Hybrid ILP miner; `/align` itself is not used by the tool and has not been tested.
- The upstream `ProM4Py.sh` is **not used** — it has a hardcoded Debian Java path and a `$LIBDIR` bug. `launch.sh` replaces it and adds the watchdog.
