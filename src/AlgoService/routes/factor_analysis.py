"""Factor analysis over model or log measures: datasets, analysis and export."""

from __future__ import annotations

import asyncio
import csv
import gzip
import io
import json
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

import jobs_db
import provenance
from algorithms._log_io import MAX_DECOMPRESSED_BYTES
from config import MAX_FILE_SIZE, CodedHTTPException, broadcast_jobs_update, get_session_id, limiter, logger
from env_config import positive_int, rate_limit
from factor_analysis import catalog as cat
from factor_analysis import compute, storage
from factor_analysis.core import (
    COMMUNALITY_THRESHOLDS,
    LOADING_THRESHOLDS,
    MISSING_MARKERS,
    AnalysisError,
    AnalysisParams,
    analyze as run_analysis,
    check_params,
)
from factor_analysis.export import analysis_zip, loadings_csv, loadings_latex, matrix_csv
from interpretation import store
from interpretation.payload import data_hash, effective_params
from routes.algorithms import (
    _enforce_job_quota,
    _make_status_cache,
    _ProgressThrottle,
    _sanitize_filename,
    cleanup_old_jobs,
)

router = APIRouter(prefix="/factor-analysis", tags=["factor analysis"])

SOURCES = ("bundled", "csv", "logs", "pnml")
MAX_LOG_FILES = 50
MAX_PNML_FILES = 200
#: Budget over all files of one request, measured on the stored (decompressed) files.
MAX_TOTAL_BYTES = 500 * 1024 * 1024
MAX_CSV_ROWS = 100_000
MAX_CSV_COLUMNS = 1_000
PREVIEW_ROWS = 2000

# Factor fits of large datasets take seconds of CPU; at most this many run at once per process.
_ANALYSIS_SLOTS = asyncio.Semaphore(2)

# Dataset jobs queued or running over all sessions. The session quota alone does not bound
# the load: a client without the session cookie gets a new session with every request.
MAX_ACTIVE_DATASET_JOBS = positive_int("MAX_ACTIVE_DATASET_JOBS", 4)


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def _check_kind(kind: str | None) -> str:
    if kind not in cat.KINDS:
        raise _bad(f"Unknown kind '{kind}'. Use 'model' or 'log'.")
    return kind


def _json_list(raw: str | None, field: str) -> list[str] | None:
    if raw is None or raw == "":
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise _bad(f"Invalid JSON for '{field}': {e}")
    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise _bad(f"'{field}' must be a JSON array of strings.")
    return data


def _check_known(values: list[str], known: list[str], what: str) -> None:
    unknown = [v for v in values if v not in known]
    if unknown:
        raise _bad(f"Unknown {what}: {', '.join(unknown[:5])}.")


# --- catalog ------------------------------------------------------------------------------


@router.get("/catalog")
def get_catalog(kind: str = "model") -> dict[str, Any]:
    """Measures, miners or feature groups, bundled datasets and sample inputs for one kind."""
    return cat.catalog(_check_kind(kind))


# --- uploads ------------------------------------------------------------------------------


async def _save_upload(upload: UploadFile, target: Path) -> int:
    limit = MAX_FILE_SIZE
    copied = 0
    with open(target, "wb") as out:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            copied += len(chunk)
            if copied > limit:
                raise _bad(f"'{upload.filename}' exceeds the {limit // (1024 * 1024)} MB limit.")
            out.write(chunk)
    return copied


def _gunzip(source: Path, target: Path, limit: int) -> int:
    written = 0
    try:
        with gzip.open(source, "rb") as src, open(target, "wb") as out:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > limit:
                    raise _bad(
                        f"'{source.name}' is too large once decompressed; at most "
                        f"{limit // (1024 * 1024)} MB are left for it."
                    )
                out.write(chunk)
    except (OSError, EOFError) as e:
        raise _bad(f"'{source.name}' is not a valid gzip file: {e}")
    source.unlink()
    return written


def _check_xml(path: Path, label: str) -> None:
    """Same XXE/DOCTYPE rule as for the single-log upload."""
    from lxml import etree

    parser = etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False, collect_ids=False)
    try:
        tree = etree.parse(str(path), parser=parser)
    except Exception as e:
        raise _bad(f"Security validation failed or invalid XML in '{label}': {e}")
    if tree.docinfo.doctype:
        raise _bad(f"'{label}': XML files containing DOCTYPE declarations are not allowed.")


def _unique_labels(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for name in names:
        seen[name] = seen.get(name, 0) + 1
        out.append(name if seen[name] == 1 else f"{name} ({seen[name]})")
    return out


async def _store_inputs(files: list[UploadFile], source: str, target_dir: Path) -> list[dict[str, str]]:
    """Save, decompress and check uploaded logs or nets; returns [{path, label}]."""
    limit_files = MAX_LOG_FILES if source == "logs" else MAX_PNML_FILES
    if len(files) > limit_files:
        raise _bad(f"At most {limit_files} files per request for source '{source}'.")
    names = [_sanitize_filename(f.filename or "") for f in files]
    for name in names:
        lower = name.lower()
        ok = lower.endswith((".xes", ".xes.gz")) if source == "logs" else lower.endswith(".pnml")
        if not ok:
            allowed = ".xes, .xes.gz" if source == "logs" else ".pnml"
            raise _bad(f"'{name}' has the wrong file type. Allowed: {allowed}.")

    total = 0
    inputs = []
    for i, (upload, name, label) in enumerate(zip(files, names, _unique_labels(names))):
        if name.lower().endswith(".xes.gz"):
            packed = target_dir / f"{i:03d}.xes.gz"
            await _save_upload(upload, packed)
            path = target_dir / f"{i:03d}.xes"
            limit = min(MAX_DECOMPRESSED_BYTES, MAX_TOTAL_BYTES - total)
            total += await run_in_threadpool(_gunzip, packed, path, limit)
        else:
            path = target_dir / f"{i:03d}{'.xes' if source == 'logs' else '.pnml'}"
            total += await _save_upload(upload, path)
        if total > MAX_TOTAL_BYTES:
            raise _bad(
                f"The files exceed the total limit of {MAX_TOTAL_BYTES // (1024 * 1024)} MB. "
                "Split them over several datasets."
            )
        await run_in_threadpool(_check_xml, path, name)
        inputs.append({"path": str(path), "label": label})
    return inputs


def _sniff_separator(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t").delimiter
    except csv.Error:
        return ","


#: First-column names that mark row labels even if the labels are numbers, e.g. our own download.
LABEL_COLUMNS = {"observation", "id", "name", "label"}


def _too_large() -> HTTPException:
    return _bad(f"The CSV file is too large; at most {MAX_CSV_ROWS} rows and {MAX_CSV_COLUMNS} columns.")


def _read_csv_table(path: Path) -> pd.DataFrame:
    """Parse an uploaded CSV. The first column holds the row labels if it is unnamed, not
    numeric or named like a label column."""
    raw: pd.DataFrame | None = None
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            with open(path, encoding=encoding) as f:
                sample = f.read(64 * 1024)
            sep = _sniff_separator(sample)
            header = next(csv.reader(io.StringIO(sample), delimiter=sep), [])
            if len(header) > MAX_CSV_COLUMNS + 1:
                raise _too_large()
            raw = pd.read_csv(
                path, sep=sep, encoding=encoding, dtype=str, keep_default_na=False, nrows=MAX_CSV_ROWS + 1
            )
            break
        except UnicodeDecodeError:
            continue
        except (pd.errors.ParserError, pd.errors.EmptyDataError, ValueError, csv.Error) as e:
            raise _bad(f"The CSV file could not be parsed: {e}")
    if raw is None or raw.empty or raw.shape[1] == 0:
        raise _bad("The CSV file could not be parsed or is empty.")
    if len(raw) > MAX_CSV_ROWS or raw.shape[1] > MAX_CSV_COLUMNS + 1:
        raise _too_large()

    def numeric(col: pd.Series) -> pd.Series | None:
        values = col.str.strip()
        present = values[~values.str.lower().isin(MISSING_MARKERS)]
        for convert in (lambda s: s, lambda s: s.str.replace(",", ".", regex=False)):
            if pd.to_numeric(convert(present), errors="coerce").notna().all():
                return pd.to_numeric(convert(values), errors="coerce")
        return None

    first = raw.columns[0]
    if (
        str(first).strip() == ""
        or str(first).startswith("Unnamed")
        or str(first).strip().lower() in LABEL_COLUMNS
        or numeric(raw[first]) is None
    ):
        raw = raw.set_index(first)
        raw.index = [str(i) for i in raw.index]
    else:
        raw.index = [str(i + 1) for i in range(len(raw))]

    if raw.shape[1] > MAX_CSV_COLUMNS:
        raise _too_large()
    table = {}
    for column in raw.columns:
        parsed = numeric(raw[column])
        table[str(column)] = parsed if parsed is not None else raw[column]
    return pd.DataFrame(table, index=raw.index)


def _relabel(table: pd.DataFrame, style: str | None) -> pd.DataFrame:
    table.index = [cat.format_row_label(str(i), style) for i in table.index]
    return table


def _select_columns(table: pd.DataFrame, measures: list[str] | None) -> pd.DataFrame:
    if not measures:
        return table
    _check_known(measures, list(table.columns), "measure(s) for this dataset")
    return table[measures]


# --- dataset jobs -------------------------------------------------------------------------


def _compute(spec: dict[str, Any], progress: compute.ProgressFn) -> compute.ComputeResult:
    inputs = [compute.Input(i["path"], i["label"]) for i in spec["inputs"]]
    if spec["kind"] == "log":
        return compute.log_from_logs(inputs, spec["measures"], progress)
    if spec["source"] == "pnml":
        return compute.model_from_pnml(inputs, spec["measures"], progress)
    return compute.model_from_logs(inputs, spec["miners"], spec["measures"], progress)


async def run_dataset_task(job_id: str, session_id: str, dataset_id: str, spec: dict[str, Any]) -> None:
    """Background job computing the measure values of a dataset."""
    from algorithms.base import stat, table, text

    loop = asyncio.get_running_loop()

    def fail_dataset(error: str) -> None:
        try:
            storage.update_meta(session_id, dataset_id, status="failed", error=error)
        except (FileNotFoundError, ValueError):
            pass

    try:
        job_state = await jobs_db.read_job(job_id)
        if not job_state or job_state.get("status") == "aborted":
            fail_dataset("Aborted by user")
            return
        await jobs_db.update_job_progress(job_id, 0.0, "Starting...", status="running")
        await broadcast_jobs_update()

        check_aborted = _make_status_cache(job_id, loop)
        throttle = _ProgressThrottle()

        def progress_cb(pct: float, msg: str) -> None:
            if check_aborted():
                raise RuntimeError("Task aborted by user")
            if throttle.should_persist(pct):
                asyncio.run_coroutine_threadsafe(
                    jobs_db.update_job_progress(job_id, pct, msg, status="running"), loop
                )
                asyncio.run_coroutine_threadsafe(broadcast_jobs_update(), loop)

        result = await asyncio.to_thread(_compute, spec, progress_cb)
        if result.table.empty:
            first = result.failures[0][1] if result.failures else "no input produced values"
            raise RuntimeError(f"No observation could be computed. First error: {first}")

        try:
            meta = await asyncio.to_thread(
                storage.store_matrix, session_id, dataset_id, result.table, result.failures, min_measures=2
            )
        except storage.TooFewMeasures as e:
            first = f" First error: {result.failures[0][1]}" if result.failures else ""
            raise RuntimeError(f"{e}{first}") from None

        rows = [
            [label, *(None if pd.isna(v) else round(float(v), 6) for v in values)]
            for label, values in zip(result.table.index, result.table.to_numpy())
        ]
        artifacts = [
            stat("Observations", meta["n_observations"]),
            stat("Measures", len(meta["measures"])),
            table("Measure values", ["observation", *result.table.columns], rows),
        ]
        if result.failures:
            artifacts.append(table("Failures", ["input", "error"], [list(f) for f in result.failures]))
        if meta["dropped"]:
            artifacts.append(text(
                "Dropped measures",
                "\n".join(f"- {d['measure']}: {d['reason']}" for d in meta["dropped"]),
            ))

        js = await jobs_db.read_job(job_id)
        if not js or js.get("status") == "aborted":
            fail_dataset("Aborted by user")
            return
        await jobs_db.set_job_completed(job_id, {
            "artifacts": [a.to_dict() for a in artifacts],
            "summary": f"{meta['n_observations']} observations × {len(meta['measures'])} measures",
        })
        await broadcast_jobs_update()
    except RuntimeError as e:
        js = await jobs_db.read_job(job_id)
        if js and ("Task aborted by user" in str(e) or js.get("status") == "aborted"):
            await jobs_db.update_job_progress(job_id, js.get("percentage", 0.0), "Aborted by user", status="aborted")
            fail_dataset("Aborted by user")
        else:
            await jobs_db.set_job_failed(job_id, str(e))
            fail_dataset(str(e))
        await broadcast_jobs_update()
    except Exception as e:
        logger.exception(f"Dataset job {job_id} failed")
        await jobs_db.set_job_failed(job_id, f"Dataset computation failed: {e}")
        fail_dataset(f"Dataset computation failed: {e}")
        await broadcast_jobs_update()
    finally:
        try:
            storage.remove_inputs(session_id, dataset_id)
        except ValueError:
            pass
        await cleanup_old_jobs()


# --- datasets -----------------------------------------------------------------------------


@router.post("/datasets")
@limiter.limit(rate_limit("datasets", "60/hour"))
async def create_dataset(
    request: Request,
    background_tasks: BackgroundTasks,
    kind: str | None = Form(None),
    source: str | None = Form(None),
    bundled_id: str | None = Form(None),
    measures: str | None = Form(None),
    miners: str | None = Form(None),
    groups: str | None = Form(None),
    name: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    session_id: str = Depends(get_session_id),
) -> dict[str, Any]:
    """Create a dataset from bundled data or a CSV (ready at once), or compute one from
    logs or PNML files in a background job."""
    kind = _check_kind(kind)
    if source not in SOURCES or (source == "pnml" and kind != "model"):
        raise _bad(f"Unknown source '{source}' for kind '{kind}'.")
    measure_list = _json_list(measures, "measures")
    miner_list = _json_list(miners, "miners")
    group_list = _json_list(groups, "groups")
    uploads = [f for f in (files or []) if f is not None and (f.filename or "").strip()]
    name = (name or "").strip()[:200] or None

    # Datasets over the limit and those of idle sessions go with their jobs, as on a delete.
    pruned = await run_in_threadpool(storage.prune_session, session_id)
    expired = await run_in_threadpool(storage.cleanup_idle_sessions)
    for job_id in pruned:
        await _delete_job(job_id, session_id)
    for job_id in expired:
        await _delete_job(job_id, None)
    if pruned or expired:
        await broadcast_jobs_update()

    if source in ("bundled", "csv"):
        if source == "bundled":
            entry = cat.bundled_entry(bundled_id or "")
            if entry is None or entry["kind"] != kind:
                raise _bad(f"Unknown bundled dataset '{bundled_id}' for kind '{kind}'.")
            bundled_id = entry["id"]
            table = await run_in_threadpool(
                lambda: _relabel(pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0), entry.get("row_labels"))
            )
            display = name or entry["name"]
        else:
            if len(uploads) != 1:
                raise _bad("Upload exactly one CSV file.")
            filename = _sanitize_filename(uploads[0].filename or "")
            if not filename.lower().endswith(".csv"):
                raise _bad(f"'{filename}' has the wrong file type. Allowed: .csv.")
            fd, tmp_name = tempfile.mkstemp(suffix=".csv")
            os.close(fd)
            try:
                await _save_upload(uploads[0], Path(tmp_name))
                table = await run_in_threadpool(_read_csv_table, Path(tmp_name))
            finally:
                os.remove(tmp_name)
            display = name or filename
            bundled_id = None
        table = _select_columns(table, measure_list)
        inputs: dict[str, Any] = {"files": 0 if source == "bundled" else 1}
        if measure_list:
            inputs["measures"] = measure_list
        origin = provenance.dataset(
            kind, source,
            bundled=entry if source == "bundled" else None,
            filename=None if source == "bundled" else filename,
        )
        meta = storage.create(
            session_id, kind=kind, name=display, source=source, status="computing",
            inputs=inputs, bundled_id=bundled_id, provenance=origin,
        )
        try:
            meta = await run_in_threadpool(storage.store_matrix, session_id, meta["id"], table)
        except Exception:
            shutil.rmtree(storage.dataset_dir(session_id, meta["id"]), ignore_errors=True)
            raise
        numeric = len(meta["measures"]) + sum(1 for d in meta["dropped"] if d["reason"] != "non_numeric")
        if numeric < 2:
            shutil.rmtree(storage.dataset_dir(session_id, meta["id"]), ignore_errors=True)
            raise _bad("The CSV file has fewer than 2 numeric columns.")
        return {"dataset_id": meta["id"], "status": "ready"}

    # logs or pnml: validate the selection, then hand the files to a job.
    spec: dict[str, Any] = {"kind": kind, "source": source}
    if kind == "model":
        spec["measures"] = measure_list or cat.catalog("model")["defaults"]["measures"]
        _check_known(spec["measures"], cat.model_measure_keys(), "measure(s)")
        if source == "logs":
            spec["miners"] = miner_list or list(cat.DEFAULT_MINERS)
            _check_known(spec["miners"], cat.model_miner_keys(), "miner(s)")
    else:
        if group_list is not None:
            _check_known(group_list, list(cat.LOG_GROUPS), "feature group(s)")
        all_features = cat.log_features(list(cat.LOG_GROUPS))
        if measure_list:
            _check_known(measure_list, all_features, "measure(s)")
            spec["measures"] = measure_list
        else:
            spec["measures"] = cat.log_features(group_list or cat.default_log_groups())
        spec["groups"] = group_list or cat.default_log_groups()
    if not spec["measures"] or (kind == "model" and source == "logs" and not spec["miners"]):
        raise _bad("Select at least one measure" + (" and one miner." if source == "logs" and kind == "model" else "."))

    sample = None
    if bundled_id and not uploads:
        sample = cat.sample_entry(bundled_id)
        if sample is None or sample["source"] != source or kind not in sample["kinds"]:
            raise _bad(f"Unknown sample '{bundled_id}' for source '{source}'.")
    elif not uploads:
        raise _bad("Upload at least one file or choose a sample.")

    await _enforce_job_quota(session_id)
    active = await jobs_db.count_active_jobs_by_prefix("_dataset:")
    if active >= MAX_ACTIVE_DATASET_JOBS:
        raise CodedHTTPException(
            429,
            (
                f"The server is computing {active} datasets already, the most it runs at once. "
                "Try again in a few minutes."
            ),
            "dataset_jobs_busy",
            active=active,
        )

    n_inputs = len(sample["files"]) if sample else len(uploads)
    noun = "log(s)" if source == "logs" else "net(s)"
    given = name or (sample["name"] if sample else None)
    display = given or f"{n_inputs} {noun}"
    chosen = {k: v for k, v in spec.items() if k in ("measures", "miners", "groups")}
    names = [Path(f).name for f in sample["files"]] if sample else _unique_labels(
        [_sanitize_filename(f.filename or "") for f in uploads]
    )
    origin = provenance.dataset(kind, source, inputs=names, miners=spec.get("miners"))
    meta = storage.create(
        session_id, kind=kind, name=display, source=source, status="computing",
        inputs={"files": n_inputs, **chosen, **({"sample_id": sample["id"]} if sample else {})},
        params=chosen, name_auto=given is None, provenance=origin,
    )
    dataset_id = meta["id"]
    try:
        if sample:
            spec["inputs"] = [{"path": str(p), "label": p.name} for p in cat.sample_paths(sample)]
        else:
            spec["inputs"] = await _store_inputs(uploads, source, storage.inputs_dir(session_id, dataset_id))
    except Exception:
        shutil.rmtree(storage.dataset_dir(session_id, dataset_id), ignore_errors=True)
        raise

    job_params = {"dataset_id": dataset_id, "source": source, **chosen}
    if given:
        # Without one, the UI names the job like the dataset, in its own language.
        job_params["dataset_name"] = given
    job_id = str(uuid.uuid4())
    await jobs_db.create_job(
        job_id=job_id,
        algorithm_id=f"_dataset:{kind}",
        algorithm_name=f"Factor analysis dataset ({kind} measures)",
        filename=f"{n_inputs} {noun}",
        params=job_params,
        session_id=session_id,
    )
    storage.update_meta(session_id, dataset_id, job_id=job_id)
    await broadcast_jobs_update()

    from database import IS_TESTING

    if os.environ.get("REDIS_URL") and not IS_TESTING:
        try:
            from celery_worker import celery_app

            celery_app.send_task("celery_worker.build_dataset", args=[job_id, session_id, dataset_id, spec])
        except Exception:
            logger.exception("Failed to enqueue dataset job via Celery, falling back to local task")
            background_tasks.add_task(run_dataset_task, job_id, session_id, dataset_id, spec)
    else:
        background_tasks.add_task(run_dataset_task, job_id, session_id, dataset_id, spec)

    return {"dataset_id": dataset_id, "status": "computing", "job_id": job_id}


def _validate_dataset_id(dataset_id: str) -> str:
    """The canonical form of the id; other spellings of the same UUID map to it."""
    try:
        return str(uuid.UUID(dataset_id))
    except ValueError:
        raise _bad("Invalid dataset ID format.")


async def _meta_or_404(dataset_id: str, session_id: str) -> dict[str, Any]:
    dataset_id = _validate_dataset_id(dataset_id)
    meta = storage.read_meta(session_id, dataset_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    return meta


async def _fail_stale_job(meta: dict[str, Any], session_id: str, job: dict[str, Any]) -> bool:
    """Mark a dataset failed whose job outlived the time limit; True if it did."""
    # created_at is a naive UTC time turned into a timestamp; compare like with like.
    now = jobs_db._utcnow_naive().timestamp()
    if now - float(job.get("created_at") or now) < storage.STALE_COMPUTING_S:
        return False
    error = "The job did not finish within the time limit; the worker may have restarted."
    await jobs_db.set_job_failed(meta["job_id"], error)
    storage.update_meta(session_id, meta["id"], status="failed", error=error)
    storage.remove_inputs(session_id, meta["id"])
    return True


async def _job_state(meta: dict[str, Any], session_id: str) -> dict[str, Any]:
    """Status and error of a computing dataset as its job has it, or the job's progress."""
    job = await jobs_db.read_job(meta["job_id"], session_id)
    if job is None:
        return {"status": "failed", "error": "The job computing this dataset was deleted."}
    if job["status"] in ("failed", "aborted"):
        return {"status": "failed", "error": job.get("error") or "Aborted by user"}
    if await _fail_stale_job(meta, session_id, job):
        await broadcast_jobs_update()
        return {"status": "failed", "error": storage.read_meta(session_id, meta["id"])["error"]}
    return {"progress": job.get("percentage", 0.0)}


def _inputs(meta: dict[str, Any]) -> dict[str, Any]:
    """What the dataset is made from. Datasets stored before this was recorded count their
    files from the observations and failures."""
    if "inputs" in meta:
        return meta["inputs"]
    if meta["source"] in ("bundled", "csv"):
        return {"files": 0 if meta["source"] == "bundled" else 1}
    labels = [*meta.get("observations", []), *(f["input"] for f in meta.get("failures", []))]
    if meta["kind"] == "model" and meta["source"] == "logs":
        # Rows are "<log> / <miner>"; file names cannot contain a slash.
        labels = [label.split(" / ")[0] for label in labels]
    return {"files": len(set(labels)), **meta.get("params", {})}


def _summary(meta: dict[str, Any], status: str) -> dict[str, Any]:
    ready = status == "ready"
    return {
        "id": meta["id"],
        "kind": meta["kind"],
        "name": meta["name"],
        "name_auto": bool(meta.get("name_auto")),
        "source": meta["source"],
        "status": status,
        "created_at": meta["created_at"],
        "n_observations": meta["n_observations"] if ready else None,
        "n_measures": len(meta["measures"]) if ready else None,
        "bundled_id": meta.get("bundled_id"),
        "job_id": meta.get("job_id"),
        "inputs": _inputs(meta),
        "has_options": meta.get("options") is not None,
    }


def _session_metas(session_id: str, kind: str | None) -> list[dict[str, Any]]:
    if kind is not None:
        _check_kind(kind)
    return [m for m in storage.list_metas(session_id) if kind is None or m["kind"] == kind]


@router.get("/datasets")
@limiter.limit(rate_limit("dataset_status", "600/minute"))
async def list_datasets(
    request: Request,
    kind: str | None = None,
    session_id: str = Depends(get_session_id),
) -> dict[str, Any]:
    """The session's datasets, newest first, optionally of one kind."""
    out = []
    for meta in await run_in_threadpool(_session_metas, session_id, kind):
        status = meta["status"]
        if status == "computing" and meta.get("job_id"):
            status = (await _job_state(meta, session_id)).get("status", status)
        out.append(_summary(meta, status))
    return {"datasets": out}


@router.get("/datasets/{dataset_id}")
@limiter.limit(rate_limit("dataset_status", "600/minute"))
async def get_dataset(
    request: Request,
    dataset_id: str,
    rows: int = Query(PREVIEW_ROWS, ge=0, le=PREVIEW_ROWS),
    session_id: str = Depends(get_session_id),
) -> dict[str, Any]:
    """Status, measures and the first ``rows`` rows of the cleaned matrix. Polled while the
    dataset is computed, hence its own, higher rate limit."""
    meta = await _meta_or_404(dataset_id, session_id)
    out: dict[str, Any] = {
        "id": meta["id"],
        "kind": meta["kind"],
        "name": meta["name"],
        "name_auto": bool(meta.get("name_auto")),
        "source": meta["source"],
        "status": meta["status"],
        "bundled_id": meta.get("bundled_id"),
        "n_observations": meta["n_observations"],
        "measures": meta["measures"],
        "observations": [],
        "values": [],
        "truncated": False,
        "dropped": meta["dropped"],
        "dropped_rows": meta["dropped_rows"],
        "failures": meta.get("failures", []),
        "created_at": meta["created_at"],
        "inputs": _inputs(meta),
        "options": meta.get("options"),
    }
    if meta.get("job_id"):
        out["job_id"] = meta["job_id"]
    if meta.get("error"):
        out["error"] = meta["error"]

    if meta["status"] == "computing" and meta.get("job_id"):
        out.update(await _job_state(meta, session_id))
    elif meta["status"] == "ready":
        data = await run_in_threadpool(storage.load_matrix, session_id, meta["id"])
        head = data.iloc[:rows]
        out["observations"] = list(head.index)
        out["values"] = head.to_numpy().tolist()
        out["truncated"] = len(data) > rows
    return out


async def _delete_job(job_id: str, session_id: str | None) -> None:
    """Delete the job that computed a dataset with its artifacts, aborting it if it still runs."""
    job = await jobs_db.read_job(job_id, session_id)
    if job and job["status"] in ("pending", "running"):
        await jobs_db.update_job_progress(
            job["id"], job.get("percentage", 0.0), "Aborted by user", status="aborted"
        )
    await jobs_db.delete_job_file(job_id, session_id)


async def _delete_dataset(meta: dict[str, Any], session_id: str) -> bool:
    """Delete a dataset and the job that computed it, aborting the job if it still runs.
    True if there was a job."""
    if meta.get("job_id"):
        await _delete_job(meta["job_id"], session_id)
    await run_in_threadpool(storage.delete, session_id, meta["id"])
    return bool(meta.get("job_id"))


@router.delete("/datasets/{dataset_id}", status_code=204)
@limiter.limit(rate_limit("dataset_status", "600/minute"))
async def delete_dataset(
    request: Request,
    dataset_id: str,
    session_id: str = Depends(get_session_id),
) -> Response:
    """Delete a dataset with its matrix, cached interpretations and job."""
    meta = await _meta_or_404(dataset_id, session_id)
    if await _delete_dataset(meta, session_id):
        await broadcast_jobs_update()
    return Response(status_code=204)


@router.delete("/datasets")
@limiter.limit(rate_limit("dataset_status", "600/minute"))
async def delete_datasets(
    request: Request,
    kind: str | None = None,
    session_id: str = Depends(get_session_id),
) -> dict[str, int]:
    """Delete every dataset of the session, optionally of one kind, each with its job."""
    metas = await run_in_threadpool(_session_metas, session_id, kind)
    had_jobs = [await _delete_dataset(meta, session_id) for meta in metas]
    if any(had_jobs):
        await broadcast_jobs_update()
    return {"deleted": len(metas)}


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")[:80] or "dataset"


async def _ready_meta(dataset_id: str, session_id: str) -> dict[str, Any]:
    meta = await _meta_or_404(dataset_id, session_id)
    if meta["status"] != "ready":
        raise HTTPException(status_code=409, detail=f"The dataset is {meta['status']}, not ready.")
    return meta


async def _ready_matrix(dataset_id: str, session_id: str) -> tuple[dict[str, Any], pd.DataFrame]:
    meta = await _ready_meta(dataset_id, session_id)
    return meta, await run_in_threadpool(storage.load_matrix, session_id, meta["id"])


def _attachment(content: str | bytes, filename: str, media_type: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/datasets/{dataset_id}/download")
async def download_dataset(dataset_id: str, session_id: str = Depends(get_session_id)) -> Response:
    """The cleaned matrix as CSV."""
    meta, data = await _ready_matrix(dataset_id, session_id)
    content = await run_in_threadpool(matrix_csv, data)
    return _attachment(content, f"{_slug(meta['name'])}.csv", "text/csv; charset=utf-8")


class AnalyzeRequest(BaseModel):
    excluded: list[str] = Field(default_factory=list, max_length=MAX_CSV_COLUMNS)
    auto_msa_filter: bool = True
    msa_threshold: float = Field(0.6, ge=0.0, le=1.0)
    bartlett_alpha: float = Field(0.05, gt=0.0, lt=1.0)
    n_factors: int | None = Field(None, ge=1)
    rotation: Literal["varimax", "promax", "oblimin", "quartimax", "none"] = "varimax"
    #: Defaults depend on the kind: 0.35 and 0 for model, 0.5 and 0.5 for log measures.
    loading_threshold: float | None = Field(None, ge=0.0, le=1.0)
    communality_threshold: float | None = Field(None, ge=0.0, le=1.0)

    def params(self, kind: str) -> AnalysisParams:
        values = self.model_dump(include=set(AnalysisParams.__dataclass_fields__))
        if values["loading_threshold"] is None:
            values["loading_threshold"] = LOADING_THRESHOLDS[kind]
        if values["communality_threshold"] is None:
            values["communality_threshold"] = COMMUNALITY_THRESHOLDS[kind]
        return AnalysisParams(**values)


class ExportRequest(AnalyzeRequest):
    format: Literal["csv", "latex"] = "csv"


class _AnalysisFailed(Exception):
    def __init__(self, error: AnalysisError) -> None:
        self.response = JSONResponse(
            status_code=400,
            content={"detail": str(error), "code": error.code, "params": error.params},
        )


async def _analyze(data: pd.DataFrame, params: AnalysisParams) -> dict[str, Any]:
    try:
        async with _ANALYSIS_SLOTS:
            return await run_in_threadpool(run_analysis, data, params)
    except AnalysisError as e:
        raise _AnalysisFailed(e) from None


@router.post("/datasets/{dataset_id}/analyze")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def analyze_dataset(
    request: Request,
    dataset_id: str,
    body: AnalyzeRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> dict[str, Any]:
    """Bartlett, KMO with the MSA filter, eigenvalues, the factor analysis and factor groups.

    A 400 for data that cannot be analysed carries ``code`` and ``params`` next to ``detail``.
    """
    meta, data = await _ready_matrix(dataset_id, session_id)
    try:
        return await _analyze(data, (body or AnalyzeRequest()).params(meta["kind"]))
    except _AnalysisFailed as e:
        return e.response


@router.put("/datasets/{dataset_id}/options", status_code=204)
@limiter.limit(rate_limit("dataset_status", "600/minute"))
async def save_options(
    request: Request,
    dataset_id: str,
    body: AnalyzeRequest,
    session_id: str = Depends(get_session_id),
) -> Response:
    """Keep the parameters of an analysis with the dataset, so reopening it starts from them.

    Checked like ``analyze`` checks them as far as that needs no fit: unknown excluded
    measures, too few measures or observations left, or more factors than they allow are a
    400 with ``code`` and ``params``.
    """
    meta = await _ready_meta(dataset_id, session_id)
    try:
        check_params(meta["measures"], meta["n_observations"], body.params(meta["kind"]))
    except AnalysisError as e:
        return _AnalysisFailed(e).response
    storage.update_meta(session_id, meta["id"], options=body.model_dump())
    return Response(status_code=204)


@router.post("/datasets/{dataset_id}/export")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_loadings(
    request: Request,
    dataset_id: str,
    body: ExportRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Response:
    """The loadings table of the analysis as CSV or LaTeX."""
    body = body or ExportRequest()
    meta, data = await _ready_matrix(dataset_id, session_id)
    try:
        result = await _analyze(data, body.params(meta["kind"]))
    except _AnalysisFailed as e:
        return e.response
    stem = f"{_slug(meta['name'])}-loadings"
    if body.format == "latex":
        return _attachment(loadings_latex(result), f"{stem}.tex", "application/x-latex; charset=utf-8")
    return _attachment(loadings_csv(result), f"{stem}.csv", "text/csv; charset=utf-8")


class ArchiveRequest(AnalyzeRequest):
    #: Language of the stored interpretation to include.
    language: Literal["en", "de"] = "en"


def _provenance(meta: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    """How the dataset was made: as recorded when it was created, or for a dataset stored
    before that was recorded, what its metadata still tell, with today's versions."""
    if meta.get("provenance"):
        return meta["provenance"]
    inputs = _inputs(meta)
    return {
        **provenance.dataset(
            meta["kind"], meta["source"], miners=inputs.get("miners"), bundled=entry or None,
        ),
        "recorded_at_creation": False,
    }


def _dataset_record(meta: dict[str, Any]) -> dict[str, Any]:
    """The dataset as the manifest of an archive describes it."""
    entry = (cat.bundled_entry(meta["bundled_id"]) if meta.get("bundled_id") else None) or {}
    return {
        "id": meta["id"],
        "name": meta["name"],
        "kind": meta["kind"],
        "source": meta["source"],
        "bundled_id": meta.get("bundled_id"),
        "collection": entry.get("collection"),
        "citation": entry.get("citation"),
        "license": entry.get("license"),
        "inputs": _inputs(meta),
        "n_observations": meta["n_observations"],
        "measures": meta["measures"],
        "dropped": [{"name": d["measure"], "reason": d["reason"]} for d in meta["dropped"]],
        "provenance": _provenance(meta, entry),
    }


@router.post("/datasets/{dataset_id}/export/zip")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_archive(
    request: Request,
    dataset_id: str,
    body: ArchiveRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Response:
    """The analysis as a ZIP archive: result, matrix, tables, parameters and library versions,
    with an interpretation of exactly this analysis if one is stored. Never calls the API for
    an interpretation."""
    body = body or ArchiveRequest()
    meta, data = await _ready_matrix(dataset_id, session_id)
    params = body.params(meta["kind"])
    try:
        result = await _analyze(data, params)
    except _AnalysisFailed as e:
        return e.response
    used = effective_params(params, result["n_factors"])
    digest = await run_in_threadpool(data_hash, data)
    stored = store.lookup(session_id, meta, digest, used, body.language)
    archive = await run_in_threadpool(
        lambda: analysis_zip(
            dataset=_dataset_record(meta),
            # A single factor is not rotated, whatever was asked for.
            params={**used, "rotation": result["rotation"]},
            result=result,
            matrix=matrix_csv(data),
            interpretation=(body.language, stored[0]) if stored else None,
        )
    )
    return _attachment(archive, f"{_slug(meta['name'])}-factor-analysis.zip", "application/zip")
