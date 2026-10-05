# ProM4Py service

Java-based process-mining backend used by `algoservice` for algorithms that depend on ProM plugins (ComFy).

## What this is

Bundles the ProM4Py Java backend from <https://zenodo.org/records/13853660> and runs it headless. Exposes the ProM4Py HTTP API on port `4040`:

| Endpoint     | Method | Purpose |
|--------------|--------|---------|
| `/isRunning` | GET    | Liveness probe (used by healthcheck) |
| `/executor`  | POST   | Run a Java expression string, returns a cache key |
| `/plugin`    | POST   | Invoke a ProM plugin by name + params |
| `/cache`     | GET/POST/DELETE | Object cache (results live here, accessed by key) |
| `/align`     | POST   | Alignment plugin (uses lp_solve, see [lp_solve](#lp_solve)) |
| `/exit`      | POST   | Shut down the server |

## Why a separate container

- Isolates the Java lifecycle (boot ~60s, ~4 GB heap) from the lightweight Python AlgoService.
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

## lp_solve

The Hybrid ILP miner solves its ILPs with lp_solve 5.5 through ProM's `LpSolve` package. Its
class `lpsolve.LpSolve` loads two native libraries, and without them discovery fails with
`no lpsolve55 in java.library.path`:

| Library | What it is | Where it comes from |
|---------|------------|---------------------|
| `liblpsolve55.so` | the solver | Ubuntu package `lp-solve` (5.5.2.5), installed to `/usr/lib/lp_solve` |
| `liblpsolve55j.so` | the JNI wrapper for `lpsolve.LpSolve` | not packaged by Ubuntu; `lib/ux64/` of the official [lp_solve Java distribution](https://sourceforge.net/projects/lpsolve/files/lpsolve/5.5.2.5/), copied to `/usr/lib/lp_solve` |

The build downloads `lp_solve_5.5.2.5_java.zip` (about 460 KB) from SourceForge and checks its
SHA-256 (`LPSOLVE_JAVA_SHA256` in the Dockerfile). `launch.sh` puts `/usr/lib/lp_solve` on
`java.library.path`, and `LD_LIBRARY_PATH` points there as well, because the wrapper links
against `liblpsolve55.so`. For a build without SourceForge, pass a local copy the same way as
the ProM bundle:

```bash
docker compose build --build-arg LPSOLVE_JAVA_URL=http://host.docker.internal:8765/lp_solve_5.5.2.5_java.zip prom4py
```

The prebuilt wrapper exists for x86-64 only. On other architectures (e.g. Apple silicon
without emulation) the build skips it, and the Hybrid ILP miner fails as before; every other
miner works.

To check an image: `docker compose logs prom4py` prints `LpSolve Libraries Loaded` on the
first Hybrid ILP run.

## Notes

- ProM only supports **Java 8**. The base image is `eclipse-temurin:8-jre-jammy`.
- Default port is 4040 (configurable via `PROM4PY_PORT`).
- Default heap is 4 GB (configurable via `JAVA_HEAP`).
- The Alignment plugin needs the same lp_solve libraries as the Hybrid ILP miner; `/align` itself is not used by the tool and has not been tested.
- The upstream `ProM4Py.sh` is **not used** — it has a hardcoded Debian Java path and a `$LIBDIR` bug. `launch.sh` replaces it.
