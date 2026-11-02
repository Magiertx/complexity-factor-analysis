"""Factor analysis over model or log measures: datasets, analysis and export."""

from __future__ import annotations

import asyncio
import csv
import dataclasses
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator

import jobs_db
import provenance
from algorithms._log_io import MAX_DECOMPRESSED_BYTES
from config import MAX_FILE_SIZE, CodedHTTPException, broadcast_jobs_update, get_session_id, limiter, logger
from env_config import positive_int, rate_limit
from factor_analysis import catalog as cat
from factor_analysis import compare, compute, correlations, figures, miners, published, stability, storage
from factor_analysis import methods as methods_text
from factor_analysis import names as factor_names
from factor_analysis.descriptives import describe, describe_cleaned, describe_miner, histogram
from factor_analysis.core import (
    COMMUNALITY_THRESHOLDS,
    LOADING_THRESHOLDS,
    MAX_MEASURES,
    MISSING_MARKERS,
    AnalysisError,
    AnalysisParams,
    Superseded,
    analyze as run_analysis,
    check_excluded,
    check_params,
)
from factor_analysis.export import (
    MEASUREMENT_COLUMNS,
    library_versions,
    analysis_zip,
    loadings_csv,
    loadings_latex,
    matrix_csv,
    measurement_rows,
)
from factor_analysis.report import report_tex
from interpretation import store
from interpretation.payload import data_hash, effective_params
from routes.algorithms import (
    _enforce_job_quota,
    _LoopCalls,
    _make_status_cache,
    _ProgressThrottle,
    _sanitize_filename,
    cleanup_old_jobs,
)

router = APIRouter(prefix="/factor-analysis", tags=["factor analysis"])

SOURCES = ("bundled", "csv", "logs", "pnml")
#: Files per dataset request, for event logs and for PNML nets. Operators raise or lower them
#: with MAX_LOG_FILES and MAX_PNML_FILES; the UI and /factor-analysis/limits report the
#: values in force.
MAX_LOG_FILES = positive_int("MAX_LOG_FILES", 50)
MAX_PNML_FILES = positive_int("MAX_PNML_FILES", 200)
#: Budget over all files of one request, measured on the stored (decompressed) files.
MAX_TOTAL_BYTES = 500 * 1024 * 1024
MAX_CSV_ROWS = 100_000
#: A factor analysis has no use for fewer observations than two; the UI says how many it needs.
MIN_CSV_ROWS = 2
MAX_CSV_COLUMNS = 1_000
PREVIEW_ROWS = 2000

# Factor fits of large datasets take seconds of CPU; at most this many run at once per process.
_ANALYSIS_SLOTS = asyncio.Semaphore(2)

#: Pause after an ASGI message other than a disconnect, while waiting for the client to leave.
_DISCONNECT_POLL_S = 0.25

# Dataset jobs queued or running over all sessions. The session quota alone does not bound
# the load: a client without the session cookie gets a new session with every request.
MAX_ACTIVE_DATASET_JOBS = positive_int("MAX_ACTIVE_DATASET_JOBS", 4)


def _bad(detail: str, code: str | None = None, **params: Any) -> HTTPException:
    """A 400. With a ``code``, the body carries it and ``params`` next to ``detail``, so the UI
    says the cause in its own language and keeps ``detail`` as the technical text."""
    if code is None:
        return HTTPException(status_code=400, detail=detail)
    return CodedHTTPException(400, detail, code, **params)


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


def upload_limits() -> dict[str, int]:
    """The upload limits in force, as the API reports them."""
    return {
        "max_log_files": MAX_LOG_FILES,
        "max_pnml_files": MAX_PNML_FILES,
        "max_file_bytes": MAX_FILE_SIZE,
        "max_total_bytes": MAX_TOTAL_BYTES,
    }


@router.get("/catalog")
def get_catalog(kind: str = "model") -> dict[str, Any]:
    """Measures, miners or feature groups, bundled datasets and sample inputs for one kind."""
    return {**cat.catalog(_check_kind(kind)), "limits": upload_limits()}


@router.get("/limits")
def get_limits() -> dict[str, int]:
    """How many files and bytes one dataset request may carry."""
    return upload_limits()


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
                raise _bad(
                    f"'{upload.filename}' exceeds the {limit // (1024 * 1024)} MB limit.",
                    "file_too_large", file=upload.filename or "", limit_mb=limit // (1024 * 1024),
                )
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
                        f"{limit // (1024 * 1024)} MB are left for it.",
                        "file_too_large", file=source.name, limit_mb=limit // (1024 * 1024),
                    )
                out.write(chunk)
    except (OSError, EOFError) as e:
        raise _bad(f"'{source.name}' is not a valid gzip file: {e}", "gzip_invalid", file=source.name, details=str(e))
    source.unlink()
    return written


def _check_xml(path: Path, label: str, source: str = "logs") -> None:
    """Same XXE/DOCTYPE rule as for the single-log upload. An empty file, a file that is not
    well-formed XML and one with a DOCTYPE are refused with the code of the file type."""
    from lxml import etree

    code = "xes_invalid" if source == "logs" else "pnml_invalid"
    if path.stat().st_size == 0:
        raise _bad(f"'{label}' is empty.", "empty_file", file=label)
    parser = etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False, collect_ids=False)
    try:
        tree = etree.parse(str(path), parser=parser)
    except Exception as e:
        raise _bad(f"Security validation failed or invalid XML in '{label}': {e}", code, file=label, details=str(e))
    if tree.docinfo.doctype:
        raise _bad(
            f"'{label}': XML files containing DOCTYPE declarations are not allowed.",
            code, file=label, details="DOCTYPE declarations are not allowed",
        )


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
        raise _bad(
            f"At most {limit_files} files per request for source '{source}'.", "too_many_files", limit=limit_files
        )
    names = [_sanitize_filename(f.filename or "") for f in files]
    for name in names:
        lower = name.lower()
        ok = lower.endswith((".xes", ".xes.gz")) if source == "logs" else lower.endswith(".pnml")
        if not ok:
            allowed = ".xes, .xes.gz" if source == "logs" else ".pnml"
            raise _bad(f"'{name}' has the wrong file type. Allowed: {allowed}.", "wrong_file_type", file=name, allowed=allowed)

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
                "Split them over several datasets.",
                "files_too_large", limit_mb=MAX_TOTAL_BYTES // (1024 * 1024),
            )
        await run_in_threadpool(_check_xml, path, name, source)
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
    return _bad(
        f"The CSV file is too large; at most {MAX_CSV_ROWS} rows and {MAX_CSV_COLUMNS} columns.",
        "csv_too_large", rows=MAX_CSV_ROWS, columns=MAX_CSV_COLUMNS,
    )


def _read_csv_table(path: Path) -> pd.DataFrame:
    """Parse an uploaded CSV. The first column holds the row labels if it is unnamed, not
    numeric or named like a label column."""
    raw: pd.DataFrame | None = None
    header: list[str] = []
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
        except pd.errors.EmptyDataError as e:
            if not sample.strip():
                raise _bad(f"The CSV file could not be parsed: {e}", "empty_file", details=str(e))
            raise _bad(f"The CSV file could not be parsed: {e}", "csv_unparseable", details=str(e))
        except (pd.errors.ParserError, ValueError, csv.Error) as e:
            raise _bad(f"The CSV file could not be parsed: {e}", "csv_unparseable", details=str(e))
    if raw is None or raw.shape[1] == 0:
        raise _bad("The CSV file could not be parsed or is empty.", "csv_unparseable", details="no columns")
    if len(raw) > MAX_CSV_ROWS or raw.shape[1] > MAX_CSV_COLUMNS + 1:
        raise _too_large()
    if len(raw) < MIN_CSV_ROWS:
        raise _bad(
            f"The CSV file has {len(raw)} data row(s); at least {MIN_CSV_ROWS} are needed.",
            "csv_too_few_rows", rows=len(raw), minimum=MIN_CSV_ROWS,
        )
    # pandas names the second "a" of a header "a,a" a.1; say so rather than rename silently.
    renamed = {str(c): h for h, c in zip(header, raw.columns) if h and str(c) != h}

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
    out = pd.DataFrame(table, index=raw.index)
    out.attrs["renamed"] = {new: old for new, old in renamed.items() if new in out.columns}
    return out


def _relabel(table: pd.DataFrame, style: str | None) -> pd.DataFrame:
    table.index = [cat.format_row_label(str(i), style) for i in table.index]
    return table


def _bundled_table(entry: dict[str, Any]) -> pd.DataFrame:
    """The table of a bundled dataset as its CSV has it, with the rows named as the UI names them."""
    return _relabel(pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0), entry.get("row_labels"))


def _select_columns(table: pd.DataFrame, measures: list[str] | None) -> pd.DataFrame:
    if not measures:
        return table
    _check_known(measures, list(table.columns), "measure(s) for this dataset")
    return table[measures]


def _reusable_copy(
    session_id: str, entry: dict[str, Any], measures: list[str] | None, name: str | None
) -> dict[str, Any] | None:
    """The newest ready copy of a bundled dataset in the session with the same selection of
    measures and, if one is given, the same name; it counts as used now."""
    for meta in storage.list_metas(session_id):
        if (
            meta.get("bundled_id") == entry["id"]
            and meta["source"] == "bundled"
            and meta["status"] == "ready"
            and (meta.get("inputs") or {}).get("measures") == (measures or None)
            and (name is None or meta["name"] == name)
        ):
            # Pruning and the idle cleanup go by the time a dataset was last touched.
            storage.touch(session_id, meta["id"])
            return meta
    return None


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
    updates = _LoopCalls(loop)

    def fail_dataset(error: str, code: str | None = None, **params: Any) -> None:
        """The dataset failed: ``error`` is the English text, ``code`` and ``params`` the cause."""
        try:
            storage.update_meta(
                session_id, dataset_id, status="failed", error=error, error_code=code, error_params=params
            )
        except (FileNotFoundError, ValueError):
            pass

    def abort_dataset() -> None:
        """The user stopped the job: not a failure, so the dataset is aborted."""
        try:
            storage.update_meta(
                session_id, dataset_id, status="aborted", error="Aborted by user", error_code="aborted",
                error_params={},
            )
        except (FileNotFoundError, ValueError):
            pass

    try:
        job_state = await jobs_db.read_job(job_id)
        if not job_state or job_state.get("status") == "aborted":
            abort_dataset()
            return
        await jobs_db.update_job_progress(job_id, 0.0, "Starting...", status="running")
        await broadcast_jobs_update()

        check_aborted = _make_status_cache(job_id, loop)
        throttle = _ProgressThrottle()

        def progress_cb(pct: float, msg: str) -> None:
            if check_aborted():
                raise RuntimeError("Task aborted by user")
            if throttle.should_persist(pct):
                updates.submit(jobs_db.update_job_progress(job_id, pct, msg, status="running"))
                updates.submit(broadcast_jobs_update())

        try:
            result = await asyncio.to_thread(_compute, spec, progress_cb)
        finally:
            await updates.settle()
        if len(result.table) and not len(result.table.columns) and result.skipped:
            # The logs were read; every feature group failed, so no measure is left.
            first = result.skipped[0]["error"]
            raise compute.DatasetError(
                f"No measure is left. First error: {first}", "dataset_too_few_measures",
                have=0, need=2, first_error=first,
            )
        if result.table.empty:
            first = (
                result.failures[0][1] if result.failures
                else result.skipped[0]["error"] if result.skipped
                else "no input produced values"
            )
            raise compute.DatasetError(
                f"No observation could be computed. First error: {first}", "no_observation", first_error=first
            )

        if result.measurement is not None:
            # Before the matrix: once the dataset is ready, its measurement is there too.
            await asyncio.to_thread(storage.write_measurement, session_id, dataset_id, result.measurement.to_dict())
        try:
            meta = await asyncio.to_thread(
                storage.store_matrix, session_id, dataset_id, result.table, result.failures, min_measures=2,
                skipped=result.skipped,
            )
        except storage.TooFewMeasures as e:
            first = result.failures[0][1] if result.failures else ""
            note = f" First error: {first}" if first else ""
            raise compute.DatasetError(
                f"{e}{note}", "dataset_too_few_measures", have=e.have, need=e.need, first_error=first
            ) from None

        rows = [
            [label, *(None if pd.isna(v) else round(float(v), 6) for v in values)]
            for label, values in zip(result.table.index, result.table.to_numpy())
        ]
        artifacts = [
            stat("Observations", meta["n_observations"]),
            stat("Measures", len(meta["measures"])),
            table("Measure values", ["observation", *result.table.columns], rows),
        ]
        if result.measurement is not None:
            artifacts.append(table(
                "Run times and input sizes", list(MEASUREMENT_COLUMNS), measurement_rows(result.measurement.to_dict())
            ))
        if result.failures:
            artifacts.append(table("Failures", ["input", "error"], [list(f) for f in result.failures]))
        if meta["dropped"]:
            artifacts.append(text(
                "Dropped measures",
                "\n".join(f"- {d['measure']}: {d['reason']}" for d in meta["dropped"]),
            ))

        js = await jobs_db.read_job(job_id)
        if not js or js.get("status") == "aborted":
            abort_dataset()
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
            abort_dataset()
        elif isinstance(e, compute.DatasetError):
            await jobs_db.set_job_failed(job_id, str(e), e.code)
            fail_dataset(str(e), e.code, **e.params)
        else:
            await jobs_db.set_job_failed(job_id, str(e), "compute_failed")
            fail_dataset(str(e), "compute_failed", details=str(e))
        await broadcast_jobs_update()
    except Exception as e:
        logger.exception(f"Dataset job {job_id} failed")
        await jobs_db.set_job_failed(job_id, f"Dataset computation failed: {e}", "compute_failed")
        fail_dataset(f"Dataset computation failed: {e}", "compute_failed", details=str(e))
        await broadcast_jobs_update()
    finally:
        try:
            storage.remove_inputs(session_id, dataset_id)
        except ValueError:
            pass
        await cleanup_old_jobs()


# --- datasets -----------------------------------------------------------------------------


def _check_source(kind: str, source: str | None) -> None:
    if source not in SOURCES or (source == "pnml" and kind != "model"):
        raise _bad(f"Unknown source '{source}' for kind '{kind}'.")


def _bundled_entry_or_400(kind: str, bundled_id: str | None) -> dict[str, Any]:
    entry = cat.bundled_entry(bundled_id or "")
    if entry is None or entry["kind"] != kind:
        raise _bad(f"Unknown bundled dataset '{bundled_id}' for kind '{kind}'.")
    return entry


def _dataset_name(name: str | None) -> str | None:
    return (name or "").strip()[:200] or None


@router.post("/datasets")
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
    reuse: bool = Form(True),
    files: list[UploadFile] | None = File(None),
    session_id: str = Depends(get_session_id),
) -> dict[str, Any]:
    """Create a dataset from bundled data or a CSV (ready at once), or compute one from
    logs or PNML files in a background job.

    A bundled dataset the session already has, with the same measures and name, is returned
    instead of a new copy (``"reused": true``), unless ``reuse`` is false: links to a paper
    analysis open the copy at hand rather than piling up copies that push out own data. Such a
    request creates nothing, so only new datasets count against the rate limit of this endpoint.
    """
    kind = _check_kind(kind)
    _check_source(kind, source)
    if source == "bundled" and reuse:
        entry = _bundled_entry_or_400(kind, bundled_id)
        existing = await run_in_threadpool(
            _reusable_copy, session_id, entry, _json_list(measures, "measures"), _dataset_name(name)
        )
        if existing is not None:
            return {"dataset_id": existing["id"], "status": "ready", "reused": True}
    return await _create_dataset(
        request=request,
        background_tasks=background_tasks,
        kind=kind,
        source=source,
        bundled_id=bundled_id,
        measures=measures,
        miners=miners,
        groups=groups,
        name=name,
        files=files,
        session_id=session_id,
    )


@limiter.limit(rate_limit("datasets", "60/hour"))
async def _create_dataset(
    *,
    request: Request,
    background_tasks: BackgroundTasks,
    kind: str,
    source: str,
    bundled_id: str | None,
    measures: str | None,
    miners: str | None,
    groups: str | None,
    name: str | None,
    files: list[UploadFile] | None,
    session_id: str,
) -> dict[str, Any]:
    """A new dataset, for ``create_dataset``; ``request`` is the one the rate limit counts."""
    measure_list = _json_list(measures, "measures")
    miner_list = _json_list(miners, "miners")
    group_list = _json_list(groups, "groups")
    uploads = [f for f in (files or []) if f is not None and (f.filename or "").strip()]
    name = _dataset_name(name)

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
            entry = _bundled_entry_or_400(kind, bundled_id)
            bundled_id = entry["id"]
            table = await run_in_threadpool(_bundled_table, entry)
            display = name or entry["name"]
            renamed: dict[str, str] = {}
        else:
            if len(uploads) != 1:
                raise _bad("Upload exactly one CSV file.", "one_csv_file")
            filename = _sanitize_filename(uploads[0].filename or "")
            if not filename.lower().endswith(".csv"):
                raise _bad(f"'{filename}' has the wrong file type. Allowed: .csv.", "wrong_file_type", file=filename, allowed=".csv")
            fd, tmp_name = tempfile.mkstemp(suffix=".csv")
            os.close(fd)
            try:
                await _save_upload(uploads[0], Path(tmp_name))
                table = await run_in_threadpool(_read_csv_table, Path(tmp_name))
            finally:
                os.remove(tmp_name)
            display = name or filename
            bundled_id = None
            renamed = table.attrs.get("renamed", {})
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
            meta = await run_in_threadpool(storage.store_matrix, session_id, meta["id"], table, renamed=renamed)
        except Exception:
            shutil.rmtree(storage.dataset_dir(session_id, meta["id"]), ignore_errors=True)
            raise
        numeric = len(meta["measures"]) + sum(1 for d in meta["dropped"] if d["reason"] != "non_numeric")
        if numeric < 2:
            shutil.rmtree(storage.dataset_dir(session_id, meta["id"]), ignore_errors=True)
            raise _bad("The CSV file has fewer than 2 numeric columns.")
        return {"dataset_id": meta["id"], "status": "ready", "reused": False}

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
    # Without a name of its own a dataset is called after its sample or its inputs; the name is
    # made up then (name_auto), so the UI names it in its own language.
    display = name or (sample["name"] if sample else f"{n_inputs} {noun}")
    chosen = {k: v for k, v in spec.items() if k in ("measures", "miners", "groups")}
    names = [Path(f).name for f in sample["files"]] if sample else _unique_labels(
        [_sanitize_filename(f.filename or "") for f in uploads]
    )
    origin = provenance.dataset(kind, source, inputs=names, miners=spec.get("miners"))
    meta = storage.create(
        session_id, kind=kind, name=display, source=source, status="computing",
        inputs={"files": n_inputs, **chosen, **({"sample_id": sample["id"]} if sample else {})},
        params=chosen, name_auto=name is None, provenance=origin,
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

    if source == "logs":
        await run_in_threadpool(_keep_as_recent_logs, session_id, spec["inputs"])

    job_params = {"dataset_id": dataset_id, "source": source, **chosen}
    if sample:
        job_params["sample_id"] = sample["id"]
    if name:
        # Without one, the UI names the job like the dataset, in its own language.
        job_params["dataset_name"] = name
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


def _same_content(a: Path, b: Path) -> bool:
    """Whether two files are one file, or have the same bytes."""
    try:
        if os.path.samefile(a, b):
            return True
        if a.stat().st_size != b.stat().st_size:
            return False
        return hashlib.sha256(a.read_bytes()).digest() == hashlib.sha256(b.read_bytes()).digest()
    except OSError:
        return False


def _keep_as_recent_logs(session_id: str, inputs: list[dict[str, str]]) -> None:
    """Keep the logs of a dataset among the recent logs of the session, where the page of a single
    log (/inspect) finds them: a log of a dataset can be looked at as long as it is one of the
    newest uploads (``routes.algorithms.cleanup_uploaded_logs`` keeps ten). A log gets its own
    name, without the ".gz" of a packed one, which is the name of the row of the dataset too;
    one that was renamed to be unique ("a.xes (2)") or whose name the list hides is not kept.
    Best effort: the dataset does not depend on it."""
    from routes import algorithms

    try:
        user_dir = algorithms.UPLOADED_LOGS_DIR / session_id
        user_dir.mkdir(parents=True, exist_ok=True)
        for item in inputs:
            name = item["label"][:-3] if item["label"].lower().endswith(".xes.gz") else item["label"]
            if not name.lower().endswith(".xes") or name.startswith("tmp"):
                continue
            target = user_dir / name
            source = Path(item["path"])
            if target.exists():
                # A different upload of the same name stays; the same log is renewed below,
                # which makes it one of the newest again.
                if not _same_content(source, target):
                    continue
                target.unlink()
            # A link costs no space, but it shares the time of the file, which for a bundled sample
            # is old: the cleanup of the newest ten would drop it first. Samples are copied.
            if not source.resolve().is_relative_to(cat.DATASETS_DIR.resolve()):
                try:
                    os.link(source, target)
                    continue
                except OSError:
                    pass
            shutil.copyfile(source, target)
        algorithms.cleanup_uploaded_logs(session_id)
    except Exception:
        logger.exception("Could not keep the logs of a dataset among the recent logs")


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
    storage.update_meta(
        session_id, meta["id"], status="failed", error=error, error_code="job_timeout", error_params={}
    )
    storage.remove_inputs(session_id, meta["id"])
    return True


async def _job_state(meta: dict[str, Any], session_id: str) -> dict[str, Any]:
    """Status and error of a computing dataset as its job has it, or the job's progress."""
    job = await jobs_db.read_job(meta["job_id"], session_id)
    if job is None:
        return {
            "status": "failed", "error": "The job computing this dataset was deleted.",
            "error_code": "job_deleted", "error_params": {},
        }
    if job["status"] == "aborted":
        return {"status": "aborted", "error": "Aborted by user", "error_code": "aborted", "error_params": {}}
    if job["status"] == "failed":
        # The dataset records the cause as soon as it has failed; the job may be a moment ahead.
        stored = storage.read_meta(session_id, meta["id"]) or {}
        return {
            "status": "failed",
            "error": job.get("error") or "Dataset computation failed.",
            "error_code": stored.get("error_code") or job.get("error_code") or "compute_failed",
            "error_params": stored.get("error_params") or {},
        }
    if await _fail_stale_job(meta, session_id, job):
        await broadcast_jobs_update()
        stored = storage.read_meta(session_id, meta["id"])
        return {
            "status": "failed", "error": stored["error"],
            "error_code": stored.get("error_code"), "error_params": stored.get("error_params") or {},
        }
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
    summary = {
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
        # The rows of this miner were analysed last; null for all rows.
        "options_miner": (meta.get("options") or {}).get("miner"),
        # The settings of its last analysis, as GET /datasets/{id} has them; null before one.
        "options": meta.get("options"),
    }
    if status in ("failed", "aborted"):
        # Why, for the UI to say it in its language; the text is in GET /datasets/{id}.
        summary["error_code"] = meta.get("error_code")
        summary["error_params"] = meta.get("error_params") or {}
    return summary


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
    dataset is computed, hence its own, higher rate limit. A ready dataset also has the
    descriptive statistics of its measures (``descriptives``), if the tool computed it from
    logs or nets, the run times and input sizes (``measurement``, else null), and for a model
    dataset whose rows are "<log> / <miner>" its ``miners``: per miner the rows, the measures
    that vary within them and those that do not (else null)."""
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
        # Feature groups left out for every log because feeed failed on one of them.
        "skipped": meta.get("skipped", []),
        "created_at": meta["created_at"],
        "inputs": _inputs(meta),
        "options": meta.get("options"),
        "miners": None,
    }
    if meta.get("job_id"):
        out["job_id"] = meta["job_id"]
    if meta.get("error"):
        out["error"] = meta["error"]
        out["error_code"] = meta.get("error_code")
        out["error_params"] = meta.get("error_params") or {}

    if meta["status"] == "computing" and meta.get("job_id"):
        out.update(await _job_state(meta, session_id))
    elif meta["status"] == "ready":
        data = await run_in_threadpool(storage.load_matrix, session_id, meta["id"])
        head = data.iloc[:rows]
        out["observations"] = list(head.index)
        out["values"] = head.to_numpy().tolist()
        out["truncated"] = len(data) > rows
        out["descriptives"] = await run_in_threadpool(_descriptives, meta, session_id)
        out["measurement"] = await run_in_threadpool(storage.read_measurement, session_id, meta["id"])
        found = miners.dataset_miners(meta)
        if found:
            out["miners"] = await run_in_threadpool(miners.summary, data, found)
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


@router.get("/datasets/{dataset_id}/descriptives")
@limiter.limit(rate_limit("dataset_status", "600/minute"))
async def get_descriptives(
    request: Request,
    dataset_id: str,
    miner: str | None = Query(None, max_length=200),
    session_id: str = Depends(get_session_id),
) -> Any:
    """The descriptive statistics of the measures of a ready dataset, with the histogram of each
    (the ``descriptives`` of ``GET /datasets/{id}``). With a ``miner`` of a model dataset
    discovered with several miners they are those of that miner's rows, taken from the cleaned
    matrix (``basis`` "miner", with the ``miner`` and its ``n_rows``): the distribution a fact
    sheet of the miner's analysis should show. A miner the dataset does not have is a 400
    ``unknown_miner``; a dataset that is not ready a 409."""
    meta = await _ready_meta(dataset_id, session_id)
    if miner is None:
        return await run_in_threadpool(_descriptives, meta, session_id)
    available = miners.dataset_miners(meta)
    if miner not in available:
        listed = f" Its miners: {', '.join(available)}." if available else " Its rows name no miner."
        return _AnalysisFailed(
            AnalysisError(
                f"The dataset has no rows of the miner '{miner}'.{listed}",
                "unknown_miner",
                miner=miner,
                miners=", ".join(available),
            )
        ).response
    data = await run_in_threadpool(storage.load_matrix, session_id, meta["id"])
    return await run_in_threadpool(describe_miner, data, miner)


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


#: The longest name of a factor.
FACTOR_NAME_MAX = 40


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
    #: core.ASSIGNMENT_RULES: "largest" as the default of the tool, "multi" and "hair" as Important Factors.
    assignment_rule: Literal["largest", "multi", "hair"] = "largest"
    #: The rows of one miner of a model dataset discovered with several miners, whose rows are
    #: "<log> / <miner>" (factor_analysis/miners.py); null analyses every row.
    miner: str | None = Field(None, max_length=200)
    #: Names of the factors, the first for factor 1; null or "" keeps "Factor i". The exports
    #: (loadings, figures, report, ZIP) use them; the analysis does not change with them.
    factor_names: list[str | None] | None = Field(None, max_length=MAX_MEASURES)

    @field_validator("factor_names")
    @classmethod
    def _names(cls, names: list[str | None] | None) -> list[str | None] | None:
        if names is None:
            return None
        out: list[str | None] = []
        for name in names:
            # One line, without spaces at either end, so that a name fits a table header.
            text = " ".join(name.split()) if name is not None else ""
            if len(text) > FACTOR_NAME_MAX:
                raise ValueError(f"A factor name has at most {FACTOR_NAME_MAX} characters: '{text[:50]}…'.")
            out.append(text or None)
        while out and out[-1] is None:
            out.pop()
        return out or None

    def params(self, kind: str) -> AnalysisParams:
        values = self.model_dump(include=set(AnalysisParams.__dataclass_fields__))
        if values["loading_threshold"] is None:
            values["loading_threshold"] = LOADING_THRESHOLDS[kind]
        if values["communality_threshold"] is None:
            values["communality_threshold"] = COMMUNALITY_THRESHOLDS[kind]
        return AnalysisParams(**values)

    @model_serializer(mode="wrap")
    def _dump(self, handler: Any) -> dict[str, Any]:
        # The miner and the names only where there are: the parameters of a request without
        # them, e.g. the published options of a bundled dataset, stay as they were.
        values = handler(self)
        for key in ("miner", "factor_names"):
            if values.get(key) is None:
                values.pop(key, None)
        return values

    def saved(self) -> dict[str, Any]:
        """The options as kept with a dataset."""
        return self.model_dump()


def _select(
    meta: dict[str, Any], data: pd.DataFrame, miner: str | None, params: AnalysisParams
) -> tuple[pd.DataFrame, AnalysisParams, miners.Selection | None]:
    """The rows an analysis runs on: every row, or with a ``miner`` those of one miner. A
    measure without variance within the miner leaves the analysis and the exclusions with it;
    an exclusion that names no measure of the dataset is an error, as without a miner."""
    if miner is None:
        return data, params, None
    available = miners.dataset_miners(meta)
    if miner not in available:
        listed = f" Its miners: {', '.join(available)}." if available else " Its rows name no miner."
        raise AnalysisError(
            f"The dataset has no rows of the miner '{miner}'.{listed}",
            "unknown_miner",
            miner=miner,
            miners=", ".join(available),
        )
    check_excluded(list(data.columns), params.excluded)
    selection = miners.select(data, miner)
    kept = set(selection.data.columns)
    return selection.data, dataclasses.replace(params, excluded=[m for m in params.excluded if m in kept]), selection


def _named(body: AnalyzeRequest, n_factors: int) -> dict[int, str] | None:
    """The names of the factors by their index from 0, for an analysis of ``n_factors``."""
    names = body.factor_names or []
    if len(names) > n_factors:
        raise AnalysisError(
            f"{len(names)} factor names for {n_factors} factor(s).",
            "factor_names_too_many",
            names=len(names),
            factors=n_factors,
        )
    return {i: name for i, name in enumerate(names) if name} or None


class ExportRequest(AnalyzeRequest):
    format: Literal["csv", "latex"] = "csv"


class SaveOptionsRequest(AnalyzeRequest):
    """The options of ``AnalyzeRequest`` as saved with a dataset, and with them the factor count
    of the solution on screen: the names are kept for that solution (miner, count, rotation and
    rule), whichever way the count was chosen."""

    names_k: int | None = Field(None, ge=1, le=MAX_MEASURES)

    def saved(self) -> dict[str, Any]:
        return self.model_dump(exclude={"names_k"})


def _published_match(meta: dict[str, Any], params: AnalysisParams, result: dict[str, Any]) -> dict[str, Any] | None:
    """``published.match`` for a whole copy of a bundled dataset; a selection of its measures
    has numbers of its own."""
    entry = cat.bundled_entry(meta.get("bundled_id") or "")
    if entry is None:
        return None
    selected = _inputs(meta).get("measures")
    if selected and list(selected) != list(cat.bundled_columns(entry["file"])):
        return None
    used = {**dataclasses.asdict(params), "n_factors": result["n_factors"]}
    return published.match(entry["id"], used, result)


class _AnalysisFailed(Exception):
    def __init__(self, error: AnalysisError) -> None:
        self.error = error
        self.response = JSONResponse(
            status_code=400,
            content={"detail": str(error), "code": error.code, "params": error.params},
        )


class _Latest:
    """The newest analyze request per session and dataset. The UI sends a new request on
    every change of a parameter and drops the answer to the one before; the server stops
    working on that one as soon as the next arrives, so that clicking through rotations
    costs one fit rather than one per click. A newer request for the same parameters does
    not replace an older one: both wait for the same fit (core.fit_factors)."""

    def __init__(self) -> None:
        #: Per session and dataset: the number and the parameters of the newest request.
        self._newest: dict[tuple[str, str], tuple[int, str]] = {}
        #: Per session and dataset: how many requests are still being answered.
        self._open: dict[tuple[str, str], int] = {}
        self._count = 0

    def take(self, key: tuple[str, str], parameters: str) -> int:
        # Called on the event loop only, so the counts need no lock.
        self._count += 1
        self._newest[key] = (self._count, parameters)
        self._open[key] = self._open.get(key, 0) + 1
        return self._count

    def is_newest(self, key: tuple[str, str], number: int, parameters: str) -> bool:
        # Also read from the thread of the fit; a dict lookup is atomic.
        newest = self._newest.get(key)
        return newest is not None and (newest[0] == number or newest[1] == parameters)

    def release(self, key: tuple[str, str]) -> None:
        # The newest entry stays while any request of the key is open: an older one with the
        # same parameters, still on its way to the fit, would else count as replaced.
        left = self._open.get(key, 0) - 1
        if left > 0:
            self._open[key] = left
        else:
            self._open.pop(key, None)
            self._newest.pop(key, None)


_LATEST = _Latest()


class _Watch:
    """Whether anybody still waits for an analysis: its client is connected and, with a
    ``key``, no newer analyze request of the same session and dataset has come in for other
    ``parameters``."""

    def __init__(self, request: Request, key: tuple[str, str] | None = None, parameters: str = "") -> None:
        self.request = request
        self.key = key
        self.parameters = parameters
        self.number = _LATEST.take(key, parameters) if key else 0
        self._gone = threading.Event()

    def stale(self) -> bool:
        """Safe to call from the thread of the fit."""
        if self._gone.is_set():
            return True
        return self.key is not None and not _LATEST.is_newest(self.key, self.number, self.parameters)

    async def listen(self) -> None:
        """Wait until the client closes the connection. ``Request.is_disconnected`` only
        peeks at the next message and misses it behind Starlette's BaseHTTPMiddleware, which
        slowapi and srv_main use; waiting for the message sees it. Behind a proxy that keeps
        the connection open this never returns; then only a newer request stops the analysis."""
        while True:
            message = await self.request.receive()
            if message["type"] == "http.disconnect":
                self._gone.set()
                return
            # The body, if nothing read it; the next message can only be the disconnect.
            await asyncio.sleep(_DISCONNECT_POLL_S)

    def close(self) -> None:
        if self.key:
            _LATEST.release(self.key)


async def _analyze(data: pd.DataFrame, params: AnalysisParams, watch: _Watch | None = None) -> dict[str, Any]:
    """Run the analysis in one of the slots. With a ``watch``, an analysis nobody waits for
    any more is given up before and after waiting for a slot and during the fit, with
    ``Superseded``."""
    if watch is None:
        try:
            async with _ANALYSIS_SLOTS:
                return await run_in_threadpool(run_analysis, data, params)
        except AnalysisError as e:
            raise _AnalysisFailed(e) from None
    # Cancelled before the response goes out, so it never takes a message the server needs.
    listening = asyncio.create_task(watch.listen())
    try:
        # One turn of the loop, so that a client gone already is noticed.
        await asyncio.sleep(0)
        if watch.stale():
            raise Superseded()
        async with _ANALYSIS_SLOTS:
            if watch.stale():
                raise Superseded()
            return await run_in_threadpool(run_analysis, data, params, watch.stale)
    except AnalysisError as e:
        raise _AnalysisFailed(e) from None
    finally:
        listening.cancel()


async def precompute_bundled() -> None:
    """Compute the analyses of the bundled datasets in the background (factor_analysis.precompute),
    in the slots of the requests so that it never runs more analyses than they may."""
    from factor_analysis import precompute

    async def analyze(data: pd.DataFrame, params: AnalysisParams) -> dict[str, Any]:
        async with _ANALYSIS_SLOTS:
            return await run_in_threadpool(run_analysis, data, params)

    await precompute.run(analyze)


def _superseded() -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": "A newer analysis of this dataset replaced this one, or the client left.",
            "code": "superseded",
            "params": {},
        },
    )


@router.post("/datasets/{dataset_id}/analyze")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def analyze_dataset(
    request: Request,
    dataset_id: str,
    body: AnalyzeRequest | None = None,
    latest_wins: bool = Query(
        True,
        description="Give this analysis up with a 409 once a newer one of the same session and dataset "
        "arrives. False for clients that run several analyses of one dataset at once.",
    ),
    session_id: str = Depends(get_session_id),
) -> dict[str, Any]:
    """Bartlett, KMO with the MSA filter, eigenvalues, the factor analysis and factor groups.

    A 400 for data that cannot be analysed carries ``code`` and ``params`` next to ``detail``.
    A 409 with the code ``superseded`` answers a request that a newer one of the same session
    and dataset replaced, or whose client left; it was not computed to the end.

    With ``miner`` the analysis runs on the rows of that miner (``miner`` in the result: its
    name, rows, measures and the measures without variance within it); ``factor_names`` changes
    nothing here.
    """
    started = time.perf_counter()
    body = body or AnalyzeRequest()
    # Numbered on arrival, before anything is awaited, so that the newest request wins. The
    # names of the factors do not change the analysis.
    key = (session_id, _validate_dataset_id(dataset_id))
    asked = {**body.model_dump(exclude={"factor_names"}), "excluded": sorted(body.excluded)}
    parameters = json.dumps(asked, sort_keys=True)
    watch = _Watch(request, key if latest_wins else None, parameters)
    try:
        meta, data = await _ready_matrix(dataset_id, session_id)
        params = body.params(meta["kind"])
        data, params, selection = await run_in_threadpool(_select, meta, data, body.miner, params)
        result = await _analyze(data, params, watch)
    except AnalysisError as e:
        return _AnalysisFailed(e).response
    except _AnalysisFailed as e:
        return e.response
    except Superseded:
        return _superseded()
    finally:
        watch.close()
    result["miner"] = selection.describe() if selection else None
    # The rows of one miner have numbers of their own.
    result["published_match"] = None if selection else _published_match(meta, params, result)
    result["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return result


class CorrelationRequest(AnalyzeRequest):
    #: correlations.ORDERS; "factor" runs the analysis these options describe, to group the
    #: measures by its dimensions.
    order: Literal["dataset", "cluster", "factor"] = "dataset"


@router.post("/datasets/{dataset_id}/correlations")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def dataset_correlations(
    request: Request,
    dataset_id: str,
    body: CorrelationRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Any:
    """The correlations of the measures, the map of the suitability step: ``measures`` and the
    matrix ``r`` in the ``order`` asked for ("dataset", "cluster" by average linkage on 1 - |r|,
    or "factor" by the dimensions of the analysis the options describe, with ``groups`` where they
    begin), the pairs with |r| of 0.95 or more (``high``) and for every measure its five closest
    partners (``top``).

    The measures are those of the dataset, or of the rows of one ``miner``, without the
    ``excluded`` ones; the MSA filter does not take any away, so the map shows why it removes
    them. The other options matter only for the order "factor". A 400 carries ``code`` and
    ``params`` like the analysis does."""
    body = body or CorrelationRequest()
    meta, data = await _ready_matrix(dataset_id, session_id)
    params = body.params(meta["kind"])
    try:
        data, params, selection = await run_in_threadpool(_select, meta, data, body.miner, params)
        check_excluded(list(data.columns), params.excluded)
        shown = data.drop(columns=params.excluded)
        if shown.shape[1] < 2:
            raise AnalysisError(
                f"At least 2 measures are needed for a correlation map; {shown.shape[1]} are left.",
                "too_few_measures_for_map",
                min=2,
                left=shown.shape[1],
            )
        result = await _analyze(data, params, _Watch(request)) if body.order == "factor" else None
    except AnalysisError as e:
        return _AnalysisFailed(e).response
    except _AnalysisFailed as e:
        return e.response
    except Superseded:
        return _superseded()
    out = await run_in_threadpool(correlations.build, shown, body.order, result)
    out["miner"] = selection.describe() if selection else None
    return out


@router.put("/datasets/{dataset_id}/options", status_code=204)
@limiter.limit(rate_limit("dataset_status", "600/minute"))
async def save_options(
    request: Request,
    dataset_id: str,
    body: SaveOptionsRequest,
    session_id: str = Depends(get_session_id),
) -> Response:
    """Keep the parameters of an analysis with the dataset, so reopening it starts from them.
    ``names_k`` is the factor count of the analysis on screen; with it the ``factor_names`` are
    also kept for that solution (miner, count, rotation, rule), which the dataset's columns of a
    comparison are headed with.

    Checked like ``analyze`` checks them as far as that needs no fit: unknown excluded
    measures, too few measures or observations left (of the ``miner``, if one is given), more
    factors than they allow, or more ``factor_names`` than factors are a 400 with ``code`` and
    ``params``.
    """
    meta = await _ready_meta(dataset_id, session_id)
    params = body.params(meta["kind"])
    try:
        if body.miner is None:
            check_params(meta["measures"], meta["n_observations"], params)
        else:
            data = await run_in_threadpool(storage.load_matrix, session_id, meta["id"])
            data, params, _ = await run_in_threadpool(_select, meta, data, body.miner, params)
            check_params(list(data.columns), len(data), params)
        solution_k = body.names_k or body.n_factors
        if solution_k is not None:
            _named(body, solution_k)
    except AnalysisError as e:
        return _AnalysisFailed(e).response
    changes: dict[str, Any] = {"options": body.saved()}
    if solution_k is not None:
        key = factor_names.solution_key(solution_k, body.rotation, body.assignment_rule, body.miner)
        changes["solution_names"] = factor_names.remember(meta.get("solution_names"), key, body.factor_names)
    storage.update_meta(session_id, meta["id"], **changes)
    return Response(status_code=204)


@router.post("/datasets/{dataset_id}/export")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_loadings(
    request: Request,
    dataset_id: str,
    body: ExportRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Response:
    """The loadings table of the analysis as CSV or LaTeX, its columns named by
    ``factor_names`` where given."""
    body = body or ExportRequest()
    exported = await _exported(request, dataset_id, body, session_id)
    if isinstance(exported, Response):
        return exported
    result, names = exported.result, exported.names
    stem = f"{_slug(exported.meta['name'])}-loadings"
    if body.format == "latex":
        return _attachment(loadings_latex(result, names), f"{stem}.tex", "application/x-latex; charset=utf-8")
    return _attachment(loadings_csv(result, names), f"{stem}.csv", "text/csv; charset=utf-8")


class ArchiveRequest(AnalyzeRequest):
    #: Language of the stored interpretation to include.
    language: Literal["en", "de"] = "en"
    #: Name the measures of the report and the figures by the short codes of the papers.
    short_codes: bool = False
    #: The rows of the loadings heatmap in the ZIP: grouped by factor as the UI shows them, or as
    #: in the dataset (the same option as of the figure).
    order: Literal["factor", "dataset"] = "factor"
    #: The language of the labels of the figures in the ZIP; the paper's is English.
    figure_language: Literal["en", "de"] = "en"
    #: The order of the measures of the correlation map in the ZIP (correlations.ORDERS).
    correlation_order: Literal["dataset", "cluster", "factor"] = "factor"
    #: The stability computed over this many samples (POST .../stability) goes into the export
    #: if it is kept for exactly this analysis; null leaves it out.
    stability_samples: Literal[100, 200, 500] | None = None


class FigureRequest(AnalyzeRequest):
    figure: Literal["scree", "loadings", "correlations"] = "scree"
    format: Literal["svg", "png"] = "svg"
    #: Name the measures by the short codes of the papers (loadings and correlations).
    short_codes: bool = False
    #: The rows of the loadings: grouped by factor as the UI shows them, or as in the dataset.
    order: Literal["factor", "dataset"] = "factor"
    #: The order of the measures of the correlation map (correlations.ORDERS).
    correlation_order: Literal["dataset", "cluster", "factor"] = "factor"
    #: The language of the labels, the axes and the caption.
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


def _with_histograms(descriptives: dict[str, Any], meta: dict[str, Any], session_id: str) -> dict[str, Any]:
    """Statistics stored before the histograms were kept get them from the cleaned matrix, for the
    measures it still has; the others have none."""
    if all("histogram" in row for row in descriptives["measures"]):
        return descriptives
    data = storage.load_matrix(session_id, meta["id"])
    rows = [
        row if "histogram" in row
        else {**row, "histogram": histogram(data[row["measure"]]) if row["measure"] in data.columns else None}
        for row in descriptives["measures"]
    ]
    return {**descriptives, "measures": rows}


def _descriptives(meta: dict[str, Any], session_id: str) -> dict[str, Any]:
    """The statistics kept with the dataset; for one stored before they were kept, those of
    its bundled table, or of the cleaned matrix if it has none."""
    stored = storage.read_descriptives(session_id, meta["id"])
    if stored is not None:
        return _with_histograms(stored, meta, session_id)
    entry = cat.bundled_entry(meta.get("bundled_id") or "")
    if entry is not None:
        return describe(_select_columns(_bundled_table(entry), _inputs(meta).get("measures")))
    return describe_cleaned(storage.load_matrix(session_id, meta["id"]))


class _Exported:
    """What the exports of one analysis share: the dataset, the analysis and its context."""

    def __init__(
        self,
        meta: dict[str, Any],
        data: pd.DataFrame,
        params: AnalysisParams,
        result: dict[str, Any],
        selection: miners.Selection | None = None,
        names: dict[int, str] | None = None,
    ) -> None:
        self.meta = meta
        #: The rows the analysis ran on: all of the dataset, or those of one miner.
        self.data = data
        self.params = params
        self.result = result
        self.selection = selection
        #: The names of the factors by their index from 0, as the request gave them.
        self.names = names
        result["miner"] = selection.describe() if selection else None
        self.match = None if selection else _published_match(meta, params, result)
        result["published_match"] = self.match
        #: The parameters the analysis ran with; a single factor is not rotated, whatever was asked for.
        self.used = {**effective_params(params, result["n_factors"]), "rotation": result["rotation"]}
        if selection:
            self.used["miner"] = selection.miner

    def factor_names(self) -> list[str | None] | None:
        """The names as a list for the manifest, one per factor."""
        if not self.names:
            return None
        return [self.names.get(i) for i in range(self.result["n_factors"])]

    def published(self) -> dict[str, Any] | None:
        if self.match is None:
            return None
        entry = cat.bundled_entry(self.meta.get("bundled_id") or "") or {}
        return {
            "options": entry["published_options"],
            "source": entry.get("published_source"),
            "scope": entry.get("published_scope"),
            "match": self.match,
        }


async def _exported(request: Request, dataset_id: str, body: AnalyzeRequest, session_id: str) -> _Exported | Response:
    """The analysis an export is made of, or the response that says why there is none."""
    meta, data = await _ready_matrix(dataset_id, session_id)
    params = body.params(meta["kind"])
    try:
        data, params, selection = await run_in_threadpool(_select, meta, data, body.miner, params)
        result = await _analyze(data, params, _Watch(request))
        names = _named(body, result["n_factors"])
    except AnalysisError as e:
        return _AnalysisFailed(e).response
    except _AnalysisFailed as e:
        return e.response
    except Superseded:
        return _superseded()
    return _Exported(meta, data, params, result, selection, names)


async def _interpretation(exported: _Exported, session_id: str, language: str) -> dict[str, Any] | None:
    """The interpretation stored for exactly this analysis, if any; never calls the API."""
    digest = await run_in_threadpool(data_hash, exported.data)
    stored = store.lookup(
        session_id, exported.meta, digest, effective_params(exported.params, exported.result["n_factors"]), language
    )
    return stored[0] if stored else None


def _correlation_map(exported: _Exported, order: str) -> dict[str, Any]:
    """The correlations of the measures of the analysis, those the user left out excluded."""
    shown = exported.data.drop(columns=exported.params.excluded)
    return correlations.build(shown, order, exported.result)


def _figure(
    exported: _Exported, name: str, fmt: str, short: bool, order: str = "factor", language: str = "en",
    correlation_order: str = "factor",
) -> bytes:
    return figures.figure(
        name, fmt, exported.result, exported.meta["kind"], short=short, order=order, language=language,
        names=exported.names,
        correlations=_correlation_map(exported, correlation_order) if name == "correlations" else None,
    )


@router.post("/datasets/{dataset_id}/export/figure")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_figure(
    request: Request,
    dataset_id: str,
    body: FigureRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Response:
    """The scree plot, the loadings heatmap or the correlation map of the analysis as SVG (text kept
    as text) or PNG (300 dpi), in a print style: white background, 8 pt text at the width of a
    CEUR page. The correlation map shows the measures the user left in, in the ``correlation_order``."""
    body = body or FigureRequest()
    exported = await _exported(request, dataset_id, body, session_id)
    if isinstance(exported, Response):
        return exported
    content = await run_in_threadpool(
        _figure, exported, body.figure, body.format, body.short_codes, body.order, body.language,
        body.correlation_order,
    )
    stem = f"{_slug(exported.meta['name'])}-{body.figure}"
    return _attachment(content, f"{stem}.{body.format}", figures.MEDIA_TYPES[body.format])


@router.post("/datasets/{dataset_id}/export/report")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_report(
    request: Request,
    dataset_id: str,
    body: ArchiveRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Response:
    """The analysis as a LaTeX report built like ComFy's (report.tex): measures, validity
    (sample size, Bartlett, MSA with the rounds of the filter), factor count, descriptive
    statistics, loadings, communalities, dimensions, settings and provenance. The factors carry
    the ``factor_names`` of the request; nothing names them by itself."""
    body = body or ArchiveRequest()
    exported = await _exported(request, dataset_id, body, session_id)
    if isinstance(exported, Response):
        return exported
    stored = await _stored_stability(exported, session_id, body.stability_samples)

    def build() -> str:
        return report_tex(
            dataset=_dataset_record(exported.meta),
            params=exported.used,
            result=exported.result,
            descriptives=_descriptives(exported.meta, session_id),
            tool=provenance.tool(),
            libraries=library_versions(),
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            short=body.short_codes,
            factor_names=exported.names,
            published=exported.published(),
            stability=stored,
        )

    content = await run_in_threadpool(build)
    return _attachment(content, f"{_slug(exported.meta['name'])}-report.tex", "application/x-latex; charset=utf-8")


class MethodsRequest(AnalyzeRequest):
    #: The language of the paragraph.
    language: Literal["en", "de"] = "en"
    #: The stability computed over this many samples (POST .../stability) goes into the export
    #: if it is kept for exactly this analysis; null leaves it out.
    stability_samples: Literal[100, 200, 500] | None = None
    #: Add the sentence on the short set, one representative measure per factor.
    short_set: bool = False


def _methods(
    exported: _Exported, language: str, stability: dict[str, Any] | None = None, short_set: bool = False
) -> methods_text.Methods:
    """The methods paragraph of the analysis an export is made of."""
    meta = exported.meta
    return methods_text.methods(
        language=language,
        dataset=_dataset_record(meta),
        result=exported.result,
        requested_factors=exported.params.n_factors,
        excluded=list(exported.params.excluded),
        tool=provenance.tool(),
        libraries=library_versions(),
        entry=cat.bundled_entry(meta["bundled_id"]) if meta.get("bundled_id") else None,
        stability=stability,
        short_set=short_set,
    )


@router.post("/datasets/{dataset_id}/export/methods")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_methods(
    request: Request,
    dataset_id: str,
    body: MethodsRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Any:
    """A short, neutral methods paragraph of the analysis, in LaTeX with cite keys, in English
    or German (``language``). Every number and setting in it is read from the analysis and its
    parameters; nothing is said that the analysis did not do. ``citation_keys`` are the keys it
    cites, in the order of their first citation; ``export/bibtex`` gives their entries."""
    body = body or MethodsRequest()
    exported = await _exported(request, dataset_id, body, session_id)
    if isinstance(exported, Response):
        return exported
    stored = await _stored_stability(exported, session_id, body.stability_samples)
    built = _methods(exported, body.language, stored, body.short_set)
    return {"language": built.language, "text": built.text, "citation_keys": built.keys}


@router.post("/datasets/{dataset_id}/export/bibtex")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_bibtex(
    request: Request,
    dataset_id: str,
    body: MethodsRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Response:
    """The BibTeX entries of exactly the keys ``export/methods`` cites for this analysis
    (references.bib). What the repository or the entry does not record, e.g. the authors beyond the
    one a catalog names or the edition of a textbook, is said in a comment above the entry and left
    out, not filled in."""
    body = body or MethodsRequest()
    exported = await _exported(request, dataset_id, body, session_id)
    if isinstance(exported, Response):
        return exported
    stored = await _stored_stability(exported, session_id, body.stability_samples)
    built = _methods(exported, body.language, stored, body.short_set)
    content = methods_text.bibtex(built.keys, provenance.tool(), library_versions(), datetime.now(timezone.utc).year)
    return _attachment(content, f"{_slug(exported.meta['name'])}-references.bib", "application/x-bibtex; charset=utf-8")


@router.post("/datasets/{dataset_id}/export/zip")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_archive(
    request: Request,
    dataset_id: str,
    body: ArchiveRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Response:
    """The analysis as a ZIP archive: result, matrix, tables, report.tex, the figures as SVG
    (rows in the ``order`` and labels in the ``figure_language``, both kept in the manifest),
    the correlations of the measures (``correlations.csv`` in the ``correlation_order``, also
    kept in the manifest), the descriptive statistics, the run times of a computed dataset,
    parameters and library versions, with an interpretation of exactly this analysis if one is
    stored. Never calls the
    API for an interpretation. With ``miner`` the matrix holds the rows of that miner and the
    manifest names it; ``factor_names`` name the factors of the tables, figures and report."""
    body = body or ArchiveRequest()
    exported = await _exported(request, dataset_id, body, session_id)
    if isinstance(exported, Response):
        return exported
    interpretation = await _interpretation(exported, session_id, body.language)
    stored = await _stored_stability(exported, session_id, body.stability_samples)
    meta = exported.meta

    def build() -> bytes:
        return analysis_zip(
            dataset=_dataset_record(meta),
            params=exported.used,
            result=exported.result,
            matrix=matrix_csv(exported.data),
            interpretation=(body.language, interpretation) if interpretation else None,
            published=exported.published(),
            descriptives=_descriptives(meta, session_id),
            measurement=storage.read_measurement(session_id, meta["id"]),
            figures={
                f"figures/{name}.svg": _figure(
                    exported, name, "svg", body.short_codes, body.order, body.figure_language, body.correlation_order
                )
                for name in figures.FIGURES
            },
            correlation_map=_correlation_map(exported, body.correlation_order),
            short_codes=body.short_codes,
            figure_order=body.order,
            figure_language=body.figure_language,
            factor_names=exported.names,
            stability=stored,
        )

    archive = await run_in_threadpool(build)
    return _attachment(archive, f"{_slug(meta['name'])}-factor-analysis.zip", "application/zip")


# --- stability of the solution ------------------------------------------------------------


class StabilityRequest(AnalyzeRequest):
    #: The number of bootstrap samples (stability.SAMPLE_COUNTS).
    samples: Literal[100, 200, 500] = stability.DEFAULT_SAMPLES


#: Changes with the method, so that a stability computed before is computed again.
STABILITY_VERSION = 2
STABILITY_PREFIX = "_stability:"
#: Stabilities computed at once on the server, of all sessions.
MAX_ACTIVE_STABILITY_JOBS = positive_int("MAX_ACTIVE_STABILITY_JOBS", 2)


def _stability_key(
    meta: dict[str, Any], data: pd.DataFrame, params: AnalysisParams, n_factors: int, samples: int
) -> str:
    """The key of a stability: the rows of the analysis, its settings with the factor count it
    used, the samples and the seed; a change of any of them is another stability."""
    material = json.dumps(
        {
            "kind": meta["kind"],
            "data": data_hash(data),
            "params": effective_params(params, n_factors),
            "samples": samples,
            "seed": stability.SEED,
            "version": STABILITY_VERSION,
        },
        sort_keys=True,
    )
    return hashlib.sha256(material.encode()).hexdigest()[:32]


async def _stability_job(session_id: str, dataset_id: str, key: str) -> dict[str, Any] | None:
    """The job of the session computing this stability, if one is queued or running."""
    for job in await jobs_db.list_jobs(session_id):
        params = job.get("params") or {}
        if (
            job["algorithm_id"].startswith(STABILITY_PREFIX)
            and job.get("status") in ("pending", "running")
            and params.get("dataset_id") == dataset_id
            and params.get("key") == key
        ):
            return job
    return None


def _stability_summary(result: dict[str, Any]) -> str:
    summary = result["summary"]
    if not result["valid"]:
        return f"No valid sample of {result['samples']}"
    return (
        f"{summary['stable']} of {summary['measures']} measures ≥ {round(summary['threshold'] * 100)} % "
        f"over {result['valid']} samples"
    )


async def _stored_stability(
    exported: _Exported, session_id: str, samples: int | None
) -> dict[str, Any] | None:
    """The stability computed for exactly the analysis of an export, if asked for and kept."""
    if samples is None:
        return None
    key = await run_in_threadpool(
        _stability_key, exported.meta, exported.data, exported.params, exported.result["n_factors"], samples
    )
    return await run_in_threadpool(storage.read_stability, session_id, exported.meta["id"], key)


async def run_stability_task(job_id: str, session_id: str, dataset_id: str, request: dict[str, Any]) -> None:
    """Background job bootstrapping the stability of one analysis of a dataset; the result is
    kept with the dataset under its key."""
    from algorithms.base import stat, table

    loop = asyncio.get_running_loop()
    updates = _LoopCalls(loop)
    try:
        job_state = await jobs_db.read_job(job_id)
        if not job_state or job_state.get("status") == "aborted":
            return
        await jobs_db.update_job_progress(job_id, 0.0, "Starting...", status="running")
        await broadcast_jobs_update()

        check_aborted = _make_status_cache(job_id, loop)
        throttle = _ProgressThrottle()

        def progress_cb(pct: float, msg: str) -> None:
            if throttle.should_persist(pct):
                updates.submit(jobs_db.update_job_progress(job_id, pct, msg, status="running"))
                updates.submit(broadcast_jobs_update())

        body = StabilityRequest(**request)
        try:
            meta, data = await _ready_matrix(dataset_id, session_id)
            params = body.params(meta["kind"])
            data, params, _ = await run_in_threadpool(_select, meta, data, body.miner, params)
            reference = await _analyze(data, params)
            key = await run_in_threadpool(_stability_key, meta, data, params, reference["n_factors"], body.samples)
            result = await asyncio.to_thread(
                stability.bootstrap, data, params, reference, body.samples, stability.SEED, progress_cb, check_aborted
            )
        finally:
            await updates.settle()
        js = await jobs_db.read_job(job_id)
        if not js or js.get("status") == "aborted":
            return
        await asyncio.to_thread(storage.write_stability, session_id, dataset_id, key, result)
        rows = [[m["measure"], m["assignment"], m["primary"]] for m in result["measures"]]
        artifacts = [
            stat("Valid samples", f"{result['valid']} of {result['samples']}"),
            stat("Seconds", result["seconds"]),
            table("Stability per measure", ["measure", "same assignment", "same primary factor"], rows),
        ]
        await jobs_db.set_job_completed(job_id, {
            "artifacts": [a.to_dict() for a in artifacts],
            "summary": _stability_summary(result),
        })
        await broadcast_jobs_update()
    except Superseded:
        # The user stopped the job: not a failure.
        js = await jobs_db.read_job(job_id)
        if js:
            await jobs_db.update_job_progress(job_id, js.get("percentage", 0.0), "Aborted by user", status="aborted")
        await broadcast_jobs_update()
    except AnalysisError as e:
        await jobs_db.set_job_failed(job_id, str(e), e.code)
        await broadcast_jobs_update()
    except _AnalysisFailed as e:
        await jobs_db.set_job_failed(job_id, str(e.error), e.error.code)
        await broadcast_jobs_update()
    except (HTTPException, FileNotFoundError):
        # The dataset was deleted meanwhile, or is not ready.
        await jobs_db.set_job_failed(job_id, "The dataset of the stability is gone.", "dataset_gone")
        await broadcast_jobs_update()
    except Exception as e:
        logger.exception(f"Stability job {job_id} failed")
        await jobs_db.set_job_failed(job_id, f"The stability could not be computed: {e}", "stability_failed")
        await broadcast_jobs_update()
    finally:
        await cleanup_old_jobs()


@router.post("/datasets/{dataset_id}/stability")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def dataset_stability(
    request: Request,
    dataset_id: str,
    background_tasks: BackgroundTasks,
    body: StabilityRequest | None = None,
    start: bool = Query(True, description="Start a job if the stability was not computed; false only looks."),
    session_id: str = Depends(get_session_id),
) -> Any:
    """The stability of the analysis these options describe over ``samples`` bootstrap samples
    of its rows (factor_analysis/stability.py), computed once per dataset, settings and samples
    and kept. ``status`` is "ready" with the ``stability``; "computing" with the ``job_id`` of
    the job that computes it, which the History lists and /progress/{job_id}/abort stops; or
    "none" if it was not computed and ``start`` is false. The exports include it when their
    request names the same ``stability_samples``."""
    body = body or StabilityRequest()
    try:
        meta, data = await _ready_matrix(dataset_id, session_id)
        params = body.params(meta["kind"])
        data, params, _ = await run_in_threadpool(_select, meta, data, body.miner, params)
        reference = await _analyze(data, params, _Watch(request))
    except AnalysisError as e:
        return _AnalysisFailed(e).response
    except _AnalysisFailed as e:
        return e.response
    except Superseded:
        return _superseded()
    key = await run_in_threadpool(_stability_key, meta, data, params, reference["n_factors"], body.samples)
    stored = await run_in_threadpool(storage.read_stability, session_id, meta["id"], key)
    if stored is not None:
        return {"status": "ready", "key": key, "stability": stored}
    running = await _stability_job(session_id, meta["id"], key)
    if running is not None:
        return {"status": "computing", "key": key, "job_id": running["id"], "percentage": running.get("percentage", 0.0)}
    if not start:
        return {"status": "none", "key": key}

    await _enforce_job_quota(session_id)
    active = await jobs_db.count_active_jobs_by_prefix(STABILITY_PREFIX)
    if active >= MAX_ACTIVE_STABILITY_JOBS:
        raise CodedHTTPException(
            429,
            f"The server is computing {active} stabilities already, the most it runs at once. "
            "Try again in a few minutes.",
            "stability_jobs_busy",
            active=active,
        )
    job_id = str(uuid.uuid4())
    await jobs_db.create_job(
        job_id=job_id,
        algorithm_id=f"{STABILITY_PREFIX}{meta['kind']}",
        algorithm_name=f"Stability of a factor analysis ({meta['kind']} measures)",
        filename=f"{body.samples} samples",
        params={
            "dataset_id": meta["id"],
            "dataset_name": meta["name"],
            "key": key,
            "samples": body.samples,
            "n_factors": reference["n_factors"],
        },
        session_id=session_id,
    )
    await broadcast_jobs_update()
    values = body.model_dump()

    from database import IS_TESTING

    if os.environ.get("REDIS_URL") and not IS_TESTING:
        try:
            from celery_worker import celery_app

            celery_app.send_task("celery_worker.compute_stability", args=[job_id, session_id, meta["id"], values])
        except Exception:
            logger.exception("Failed to enqueue stability job via Celery, falling back to local task")
            background_tasks.add_task(run_stability_task, job_id, session_id, meta["id"], values)
    else:
        background_tasks.add_task(run_stability_task, job_id, session_id, meta["id"], values)
    return {"status": "computing", "key": key, "job_id": job_id, "percentage": 0.0}


# --- comparing analyses -------------------------------------------------------------------


class ColumnOptions(BaseModel):
    """Changes to the settings a column of a comparison starts from. Only what is given
    changes; ``"n_factors": null`` follows the Kaiser criterion. The assignment rule is the
    comparison's."""

    model_config = ConfigDict(extra="forbid")

    excluded: list[str] | None = Field(None, max_length=MAX_CSV_COLUMNS)
    auto_msa_filter: bool | None = None
    msa_threshold: float | None = Field(None, ge=0.0, le=1.0)
    bartlett_alpha: float | None = Field(None, gt=0.0, lt=1.0)
    n_factors: int | None = Field(None, ge=1)
    rotation: Literal["varimax", "promax", "oblimin", "quartimax", "none"] | None = None
    loading_threshold: float | None = Field(None, ge=0.0, le=1.0)
    communality_threshold: float | None = Field(None, ge=0.0, le=1.0)

    def changes(self) -> dict[str, Any]:
        given = self.model_dump(exclude_unset=True)
        return {k: v for k, v in given.items() if v is not None or k == "n_factors"}


class CompareColumn(BaseModel):
    """One column of a comparison: a bundled dataset (``bundled_id``) with the settings its paper
    published ("paper", the default; the standard ones of its kind if it has none) or the
    standard ones; or a dataset of the session (``dataset_id``) with the settings saved with it
    ("saved", the default; the standard ones if none are) or the standard ones, optionally of the
    rows of one ``miner``."""

    bundled_id: str | None = Field(None, max_length=200)
    dataset_id: str | None = Field(None, max_length=64)
    #: Of a model dataset of the session discovered with several miners: the rows of this one.
    miner: str | None = Field(None, max_length=200)
    settings: Literal["paper", "standard", "saved"] | None = None
    options: ColumnOptions | None = None
    #: The title of the column; the label of the dataset without one.
    label: str | None = Field(None, max_length=80)

    @model_validator(mode="after")
    def _one_source(self) -> "CompareColumn":
        if (self.bundled_id is None) == (self.dataset_id is None):
            raise ValueError("A column names a bundled dataset (bundled_id) or one of the session (dataset_id).")
        if self.bundled_id is not None and (self.settings == "saved" or self.miner is not None):
            raise ValueError("A bundled dataset has the settings 'paper' or 'standard', and no miner to choose.")
        if self.dataset_id is not None and self.settings == "paper":
            raise ValueError("A dataset of the session has the settings 'saved' or 'standard'.")
        return self


class CompareRequest(BaseModel):
    columns: list[CompareColumn] = Field(..., min_length=compare.MIN_COLUMNS, max_length=compare.MAX_COLUMNS)
    #: core.ASSIGNMENT_RULES, for every column; Tab. 17 of Important Factors follows "hair".
    assignment_rule: Literal["largest", "multi", "hair"] = "largest"


class CompareExportRequest(CompareRequest):
    format: Literal["csv", "latex", "zip"] = "csv"
    #: Name the measures in the LaTeX table by the short codes of the papers, as Tab. 17 does.
    short_codes: bool = True


def _compare_error(code: str, message: str, **params: Any) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": message, "code": code, "params": params})


def _saved_params(meta: dict[str, Any], settings: str | None) -> tuple[AnalysisParams, str]:
    """The parameters a column of a dataset of the session starts from: those saved with it
    ("saved"), else, or for "standard", the standard ones of its kind."""
    from interpretation.payload import default_params

    saved = meta.get("options") if settings != "standard" else None
    if saved:
        try:
            return AnalyzeRequest.model_validate(saved).params(meta["kind"]), "saved"
        except ValueError:
            # Saved in a form this version does not read: the standard instead.
            pass
    return default_params(meta["kind"]), "standard"


def _own_column(
    meta: dict[str, Any], session_id: str, column: CompareColumn, rule: str
) -> tuple[pd.DataFrame | None, AnalysisParams, dict[str, Any]]:
    """The data, the parameters and the spec of a column of a dataset of the session; no data,
    and the spec with its ``error``, when the dataset is not ready or has no such miner."""
    base, settings = _saved_params(meta, column.settings)
    if settings == "saved" and column.miner != (meta.get("options") or {}).get("miner"):
        # The count of factors saved was fixed for the rows of the miner saved with it (or for
        # all rows); on other rows it would be a count for other factors: the standard one.
        base = dataclasses.replace(base, n_factors=None)
    changes = column.options.changes() if column.options else {}
    params = dataclasses.replace(base, **changes, assignment_rule=rule)
    # Every measure of the dataset: those cleaning kept, then those it dropped.
    kept = list(meta["measures"])
    measures = [*kept, *(d["measure"] for d in meta["dropped"] if d["measure"] not in kept)]
    spec: dict[str, Any] = {
        "entry": {"id": None, "kind": meta["kind"], "name": meta["name"]},
        "dataset": {
            "id": meta["id"], "name": meta["name"], "source": meta["source"], "bundled_id": meta.get("bundled_id"),
        },
        "miner": column.miner,
        "settings": settings,
        "options": dataclasses.asdict(params),
        "measures": measures,
        "dropped": {d["measure"]: d["reason"] for d in meta["dropped"]},
        "label": column.label or (f"{meta['name']}, {column.miner}" if column.miner else meta["name"]),
    }
    if meta["status"] != "ready":
        spec["error"] = {
            "code": "dataset_not_ready",
            "message": f"The dataset is {meta['status']}, not ready.",
            "params": {"status": meta["status"]},
        }
        return None, params, spec
    data = storage.load_matrix(session_id, meta["id"])
    try:
        data, params, selection = _select(meta, data, column.miner, params)
    except AnalysisError as e:
        spec["error"] = {"code": e.code, "message": str(e), "params": e.params}
        return None, params, spec
    if selection:
        spec["dropped"].update({d["measure"]: d["reason"] for d in selection.dropped})
        spec["options"] = dataclasses.asdict(params)
    return data, params, spec


async def _comparison(request: Request, body: CompareRequest) -> dict[str, Any] | JSONResponse:
    """The comparison of the columns of ``body``, or the response that says why there is none.

    A column of a bundled dataset is analysed on the bundled CSV directly, so no dataset of a
    session is made; a column of a dataset of the session on its stored matrix, or on the rows
    of one miner of it. Both run in the slots of the analyses and with the fit cache. A column
    whose analysis fails carries its error; the others are compared without it.
    """
    # Only a column of the session's own data needs the session.
    session_id = await get_session_id(request) if any(c.dataset_id for c in body.columns) else None
    sources: list[dict[str, Any]] = []
    for column in body.columns:
        if column.bundled_id is not None:
            entry = cat.bundled_entry(column.bundled_id)
            if entry is None:
                return _compare_error(
                    "compare_unknown_dataset", f"Unknown bundled dataset '{column.bundled_id}'.", dataset=column.bundled_id
                )
            sources.append({"kind": entry["kind"], "entry": entry})
            continue
        try:
            dataset_id: str | None = str(uuid.UUID(column.dataset_id or ""))
        except ValueError:
            dataset_id = None
        meta = storage.read_meta(session_id, dataset_id) if session_id and dataset_id else None
        if meta is None:
            return _compare_error(
                "compare_unknown_dataset", f"The session has no dataset '{column.dataset_id}'.", dataset=column.dataset_id
            )
        sources.append({"kind": meta["kind"], "meta": meta})
    kinds = sorted({s["kind"] for s in sources})
    if len(kinds) > 1:
        return _compare_error(
            "compare_mixed_kinds", "All columns of a comparison must be of one kind, model or log measures.",
            kinds=", ".join(kinds),
        )
    watch = _Watch(request)
    # One listener for all columns: it is cancelled before the response goes out.
    listening = asyncio.create_task(watch.listen())
    specs: list[dict[str, Any]] = []
    try:
        for column, source in zip(body.columns, sources):
            if "entry" in source:
                entry = source["entry"]
                data, measures, dropped = await run_in_threadpool(compare.bundled_data, entry["id"])
                changes = column.options.changes() if column.options else {}
                params, settings = compare.column_params(
                    entry, column.settings or "paper", changes, body.assignment_rule
                )
                spec: dict[str, Any] = {
                    "entry": entry,
                    "settings": settings,
                    "options": dataclasses.asdict(params),
                    "measures": list(measures),
                    "dropped": dict(dropped),
                    "label": column.label,
                }
            else:
                own, params, spec = await run_in_threadpool(
                    _own_column, source["meta"], session_id, column, body.assignment_rule
                )
                if own is None:
                    specs.append(spec)
                    continue
                data = own
            await asyncio.sleep(0)
            if watch.stale():
                raise Superseded()
            try:
                async with _ANALYSIS_SLOTS:
                    if watch.stale():
                        raise Superseded()
                    result = await run_in_threadpool(run_analysis, data, params, watch.stale)
            except AnalysisError as e:
                spec["error"] = {"code": e.code, "message": str(e), "params": e.params}
            else:
                spec["result"] = result
                spec["options"] = effective_params(params, result["n_factors"])
                if "meta" in source:
                    # The names saved for the solution this column came to; bundled ones have none.
                    spec["factor_names"] = factor_names.for_solution(
                        source["meta"].get("solution_names"), result["n_factors"], params.rotation,
                        params.assignment_rule, column.miner,
                    )
            specs.append(spec)
    finally:
        listening.cancel()
    if all("error" in spec for spec in specs):
        # Nothing to compare, and nothing a download could say.
        return _compare_error(
            "compare_nothing_analysed",
            "None of the columns could be analysed with these settings.",
            reasons=", ".join(sorted({spec["error"]["code"] for spec in specs if spec["error"].get("code")})),
        )
    return await run_in_threadpool(compare.build, specs, body.assignment_rule)


@router.post("/compare")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def compare_analyses(request: Request, body: CompareRequest) -> Any:
    """The factor structures of 2 to 8 analyses side by side, like Tab. 17 of Important
    Factors, of bundled datasets or of datasets of the session (``dataset_id``, optionally with a
    ``miner``): a header per column (n, measures after the MSA filter, KMO, factors,
    rotation, cumulative variance), every measure with the dimensions the shared assignment
    rule puts it in per column, the dimensions per column, and for every pair of measures in
    how many columns both are in the same dimension (``co_assignment``). The factors of the
    columns are matched by the measures they share, so that most measures in common get the same
    number.

    Bundled datasets need no dataset of the session; a column of one names it by ``dataset_id``
    and starts from the settings saved with it. A 400 with ``code`` names an unknown dataset,
    columns of two kinds, or that no column could be analysed; a column whose analysis fails
    (also a dataset not ready, or a miner it does not have) has its ``error`` and the others are
    compared without it.
    """
    started = time.perf_counter()
    try:
        result = await _comparison(request, body)
    except Superseded:
        return _superseded()
    if isinstance(result, JSONResponse):
        return result
    result["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return result


@router.post("/compare/export")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def export_comparison(request: Request, body: CompareExportRequest) -> Response:
    """The comparison as CSV (one row per measure, one column per analysis), as a LaTeX
    tabular laid out like Tab. 17 of Important Factors, or as a ZIP with both, the pairs of
    measures that share a dimension, the full result and a manifest."""
    try:
        result = await _comparison(request, body)
    except Superseded:
        return _superseded()
    if isinstance(result, JSONResponse):
        return result
    stem = "factor-structures"
    if body.format == "latex":
        content = compare.dimensions_latex(result, body.short_codes)
        return _attachment(content, f"{stem}.tex", "application/x-latex; charset=utf-8")
    if body.format == "zip":
        # The request as sent, so that posting it again gives the same comparison; the rule and
        # the labels with their defaults.
        query = {
            **body.model_dump(exclude_unset=True, exclude={"format"}),
            "assignment_rule": body.assignment_rule,
            "short_codes": body.short_codes,
        }
        archive = await run_in_threadpool(compare.comparison_zip, result, query, body.short_codes)
        return _attachment(archive, f"{stem}.zip", "application/zip")
    return _attachment(compare.membership_csv(result), f"{stem}.csv", "text/csv; charset=utf-8")
