"""Interpretations kept on disk, so the same analysis is never paid for twice.

- Own datasets: next to the dataset in the session directory; they go with it.
- Bundled datasets: in one directory for all sessions, ``<ARTIFACTS_DIR>/interpretations``,
  since their data are public.
- Precomputed: ``datasets/interpretations/<bundled id>[.published].<language>.json``, written
  by ``scripts/precompute_interpretations.py`` for the default parameters and for the published
  options of the dataset ("Paper settings"). Served without an API key, so the offline demo
  has them.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

import jobs_db
from config import logger
from factor_analysis import catalog as cat
from factor_analysis import storage

from . import client

PRECOMPUTED_DIR = cat.DATASETS_DIR / "interpretations"

#: Files kept in the shared directory of the bundled datasets; the oldest go first.
MAX_SHARED_ENTRIES = 500


def cache_key(
    *, kind: str, data_hash: str, params: dict[str, Any], language: str, model: str, effort: str, prompt: str
) -> str:
    """``prompt`` is ``client.PROMPT_DIGEST``."""
    material = json.dumps(
        {
            "kind": kind,
            "data": data_hash,
            "params": params,
            "language": language,
            "model": model,
            "effort": effort,
            "prompt": prompt,
        },
        sort_keys=True,
    )
    # 128 bits are plenty, and short file names stay below the path length limit of Windows.
    return hashlib.sha256(material.encode()).hexdigest()[:32]


def shared_dir() -> Path:
    # Read at call time: tests point jobs_db.ARTIFACTS_DIR at a temp directory.
    return Path(jobs_db.ARTIFACTS_DIR) / "interpretations"


def _cache_dir(session_id: str, meta: dict[str, Any]) -> Path:
    if meta.get("bundled_id"):
        return shared_dir()
    return storage.dataset_dir(session_id, meta["id"]) / "interpretations"


def _read(path: Path) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def read_cached(session_id: str, meta: dict[str, Any], key: str) -> dict[str, Any] | None:
    return _read(_cache_dir(session_id, meta) / f"{key}.json")


def write_cached(session_id: str, meta: dict[str, Any], key: str, entry: dict[str, Any]) -> None:
    """Raises FileNotFoundError for an own dataset deleted since ``meta`` was read: the
    answer arrives long after the request started, and must not bring the dataset back."""
    directory = _cache_dir(session_id, meta)
    shared = directory == shared_dir()
    directory.mkdir(parents=shared, exist_ok=True)
    _write(directory / f"{key}.json", entry)
    if shared:
        _prune(directory)


def _prune(directory: Path, keep: int = MAX_SHARED_ENTRIES) -> None:
    files = sorted(directory.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in files[keep:]:
        path.unlink(missing_ok=True)


#: The settings interpretations are precomputed for: the defaults of the tool, and the
#: published options of the dataset ("Paper settings", where Get started leads).
SETTINGS = ("standard", "published")


def precomputed_path(bundled_id: str, language: str, settings: str = "standard") -> Path:
    if settings == "standard":
        return PRECOMPUTED_DIR / f"{bundled_id}.{language}.json"
    return PRECOMPUTED_DIR / f"{bundled_id}.{settings}.{language}.json"


def read_precomputed(
    bundled_id: str | None, language: str, data_hash: str, params: dict[str, Any], prompt: str
) -> dict[str, Any] | None:
    """The precomputed entry if it was made for exactly this data, these parameters and the
    current prompt. The model and effort it was made with do not matter: it is served
    without a key."""
    if not bundled_id:
        return None
    for settings in SETTINGS:
        path = precomputed_path(bundled_id, language, settings)
        entry = _read(path)
        if not entry or entry.get("data_hash") != data_hash or entry.get("params") != params:
            continue
        if entry.get("prompt_digest") != prompt:
            logger.warning("Precomputed interpretation %s was made for another prompt; rerun the script", path.name)
            continue
        return entry
    return None


def write_precomputed(bundled_id: str, language: str, entry: dict[str, Any], settings: str = "standard") -> Path:
    path = precomputed_path(bundled_id, language, settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    _write(path, entry)
    return path


def has_precomputed() -> bool:
    return any(PRECOMPUTED_DIR.glob("*.json"))


def key_for(meta: dict[str, Any], data_hash: str, params: dict[str, Any], language: str) -> str:
    """The cache key of an analysis of this dataset with the configured model and prompt."""
    return cache_key(
        kind=meta["kind"], data_hash=data_hash, params=params, language=language,
        model=client.MODEL, effort=client.EFFORT, prompt=client.PROMPT_DIGEST,
    )


def lookup(
    session_id: str, meta: dict[str, Any], data_hash: str, params: dict[str, Any], language: str
) -> tuple[dict[str, Any], bool] | None:
    """The precomputed or cached interpretation of exactly this analysis, and whether it was
    precomputed. Never calls the API. ``params`` are ``payload.effective_params``."""
    entry = read_precomputed(meta.get("bundled_id"), language, data_hash, params, client.PROMPT_DIGEST)
    if entry:
        return entry, True
    entry = read_cached(session_id, meta, key_for(meta, data_hash, params, language))
    return (entry, False) if entry else None
