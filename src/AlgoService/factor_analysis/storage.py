"""Session-scoped datasets on disk, next to the job artifacts.

Layout: ``<ARTIFACTS_DIR>/datasets/<session id>/<dataset id>/`` with ``meta.json``,
``data.csv`` (the cleaned matrix, once ready) and ``inputs/`` (uploads waiting for the job).
"""

from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

import jobs_db

from .core import clean_matrix

#: Datasets kept per session; the oldest finished ones go first.
MAX_DATASETS_PER_SESSION = 30

#: A session directory untouched for this long is removed.
SESSION_MAX_IDLE_S = 7 * 24 * 3600

#: A dataset still computing after this long outlived Celery's time limit of an hour, e.g.
#: because the worker restarted.
STALE_COMPUTING_S = 3600 + 600

_cache: dict[str, tuple[float, pd.DataFrame]] = {}


def root() -> Path:
    # Read at call time: tests point jobs_db.ARTIFACTS_DIR at a temp directory.
    return Path(jobs_db.ARTIFACTS_DIR) / "datasets"


def _check_ids(session_id: str, dataset_id: str) -> None:
    uuid.UUID(session_id)
    uuid.UUID(dataset_id)


def dataset_dir(session_id: str, dataset_id: str) -> Path:
    _check_ids(session_id, dataset_id)
    return root() / session_id / dataset_id


def _write_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def create(
    session_id: str,
    *,
    kind: str,
    name: str,
    source: str,
    status: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    dataset_id = str(uuid.uuid4())
    directory = dataset_dir(session_id, dataset_id)
    directory.mkdir(parents=True)
    meta = {
        "id": dataset_id,
        "kind": kind,
        "name": name,
        "source": source,
        "status": status,
        "params": params or {},
        "n_observations": 0,
        "measures": [],
        "observations": [],
        "dropped": [],
        "dropped_rows": 0,
        "failures": [],
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    _write_json(directory / "meta.json", meta)
    return meta


def read_meta(session_id: str, dataset_id: str) -> dict[str, Any] | None:
    try:
        path = dataset_dir(session_id, dataset_id) / "meta.json"
    except ValueError:
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def update_meta(session_id: str, dataset_id: str, **changes: Any) -> dict[str, Any]:
    meta = read_meta(session_id, dataset_id)
    if meta is None:
        raise FileNotFoundError(dataset_id)
    meta.update(changes)
    _write_json(dataset_dir(session_id, dataset_id) / "meta.json", meta)
    return meta


#: Failed inputs kept in the metadata; the job result lists all of them.
MAX_FAILURES = 200


class TooFewMeasures(ValueError):
    """Fewer measures gave values than a dataset needs."""


def store_matrix(
    session_id: str,
    dataset_id: str,
    raw: pd.DataFrame,
    failures: list[tuple[str, str]] | None = None,
    *,
    min_measures: int = 0,
) -> dict[str, Any]:
    """Clean ``raw`` (rows = observations), save it and mark the dataset ready.

    ``failures`` are (input, error) pairs of inputs that gave no or incomplete values; rows
    dropped for missing most values are added to them.
    """
    cleaned = clean_matrix(raw)
    data = cleaned.data
    # Constant and duplicate measures count: they gave values, the data just has no use for them.
    with_values = 0 if data.empty else data.shape[1] + sum(
        1 for d in cleaned.dropped if d["reason"] in ("constant", "duplicate")
    )
    if with_values < min_measures:
        raise TooFewMeasures(
            f"Only {with_values} measure(s) gave values for every kept input; at least {min_measures} are needed."
        )
    failures = list(failures or [])
    failures += [(row, "most measure values are missing; the row was dropped") for row in cleaned.empty_rows]
    directory = dataset_dir(session_id, dataset_id)
    tmp = directory / "data.csv.tmp"
    data.to_csv(tmp, index_label="observation")
    os.replace(tmp, directory / "data.csv")
    return update_meta(
        session_id,
        dataset_id,
        status="ready",
        n_observations=int(len(data)),
        measures=list(data.columns),
        observations=list(data.index),
        dropped=cleaned.dropped,
        dropped_rows=cleaned.dropped_rows,
        failures=[{"input": i, "error": e} for i, e in failures[:MAX_FAILURES]],
    )


def load_matrix(session_id: str, dataset_id: str) -> pd.DataFrame:
    """The cleaned matrix; cached per file version."""
    path = dataset_dir(session_id, dataset_id) / "data.csv"
    mtime = path.stat().st_mtime
    key = str(path)
    hit = _cache.get(key)
    if hit and hit[0] == mtime:
        return hit[1]
    meta = read_meta(session_id, dataset_id) or {}
    data = pd.read_csv(path, index_col=0, keep_default_na=False).astype(float)
    data.index = meta.get("observations") or [str(i) for i in data.index]
    if len(_cache) > 16:
        _cache.clear()
    _cache[key] = (mtime, data)
    return data


def matrix_path(session_id: str, dataset_id: str) -> Path:
    return dataset_dir(session_id, dataset_id) / "data.csv"


def inputs_dir(session_id: str, dataset_id: str) -> Path:
    path = dataset_dir(session_id, dataset_id) / "inputs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def remove_inputs(session_id: str, dataset_id: str) -> None:
    shutil.rmtree(dataset_dir(session_id, dataset_id) / "inputs", ignore_errors=True)


def prune_session(session_id: str, keep: int = MAX_DATASETS_PER_SESSION) -> None:
    """Drop the oldest finished datasets beyond ``keep``; computing ones are left alone
    unless they are stale."""
    session_root = root() / session_id
    if not session_root.is_dir():
        return
    entries = []
    for directory in session_root.iterdir():
        meta_path = directory / "meta.json"
        if not meta_path.is_file():
            continue
        try:
            with open(meta_path, encoding="utf-8") as f:
                status = json.load(f).get("status")
        except (OSError, json.JSONDecodeError):
            status = None
        entries.append((meta_path.stat().st_mtime, directory, status))
    entries.sort(reverse=True)
    stale = time.time() - STALE_COMPUTING_S
    for i, (mtime, directory, status) in enumerate(entries):
        if (i >= keep and status != "computing") or (status == "computing" and mtime < stale):
            shutil.rmtree(directory, ignore_errors=True)


def cleanup_idle_sessions(max_idle_s: float = SESSION_MAX_IDLE_S) -> int:
    """Remove dataset directories of sessions nobody touched for ``max_idle_s``."""
    base = root()
    if not base.is_dir():
        return 0
    cutoff = time.time() - max_idle_s
    removed = 0
    for session_root in base.iterdir():
        if not session_root.is_dir():
            continue
        newest = max(
            (p.stat().st_mtime for p in session_root.rglob("meta.json")),
            default=session_root.stat().st_mtime,
        )
        if newest < cutoff:
            shutil.rmtree(session_root, ignore_errors=True)
            removed += 1
    return removed
