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
| `/align`     | POST   | Alignment plugin (requires `lpsolve` native lib — not installed here) |
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

To use a local copy instead of the Zenodo download (for offline builds), pass `--build-arg PROM4PY_ZIP_URL=file:///path/to/prom4py.zip`.

## Notes

- ProM only supports **Java 8**. The base image is `eclipse-temurin:8-jre-jammy`.
- Default port is 4040 (configurable via `PROM4PY_PORT`).
- Default heap is 4 GB (configurable via `JAVA_HEAP`).
- The Alignment plugin needs `lpsolve 5.5` as a native library; not installed in this image because ComFy does not need it. Add it if you want `/align` to work.
- The upstream `ProM4Py.sh` is **not used** — it has a hardcoded Debian Java path and a `$LIBDIR` bug. `launch.sh` replaces it.
