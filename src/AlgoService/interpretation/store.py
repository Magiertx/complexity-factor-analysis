"""Interpretations kept on disk, so the same analysis is never paid for twice.

- Own datasets: next to the dataset in the session directory; they go with it.
- Bundled datasets: in one directory for all sessions, ``<ARTIFACTS_DIR>/interpretations``,
  since their data are public.
- Precomputed: ``datasets/interpretations/<bundled id>[.published].<language>.<model>.<effort>.json``,
  written by ``scripts/precompute_interpretations.py`` for the default parameters and for the
  published options of the dataset ("Paper settings"), one file per model and effort. Served
  without an API key, so the offline demo has them. ``<model>`` is the model that was
  requested, which can differ from the one that answered.
"""

from __future__ import annotations

import glob
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


def precomputed_path(
    bundled_id: str, language: str, settings: str = "standard", model: str | None = None, effort: str | None = None
) -> Path:
    model = client.MODEL if model is None else model
    effort = client.EFFORT if effort is None else effort
    middle = "" if settings == "standard" else f".{settings}"
    return PRECOMPUTED_DIR / f"{bundled_id}{middle}.{language}.{model}.{effort}.json"


def requested_model(entry: dict[str, Any]) -> str | None:
    """The model asked for; entries from before ``requested_model`` was stored have only
    the model that answered."""
    return entry.get("requested_model") or entry.get("model")


def _precomputed_entries(bundled_id: str, language: str, settings: str) -> list[tuple[Path, dict[str, Any]]]:
    """All precomputed files of one dataset, settings and language, whatever model and effort."""
    middle = "" if settings == "standard" else f".{settings}"
    paths = sorted(PRECOMPUTED_DIR.glob(f"{glob.escape(bundled_id)}{middle}.{language}.*.json"))
    return [(p, e) for p in paths if (e := _read(p))]


def _fits(entry: dict[str, Any], data_hash: str, params: dict[str, Any]) -> bool:
    return entry.get("data_hash") == data_hash and entry.get("params") == params


def read_precomputed(
    bundled_id: str | None, language: str, data_hash: str, params: dict[str, Any], prompt: str,
    model: str, effort: str,
) -> dict[str, Any] | None:
    """The precomputed entry if it was made for exactly this data, these parameters, the
    current prompt and the requested model and effort."""
    if not bundled_id:
        return None
    for settings in SETTINGS:
        path = precomputed_path(bundled_id, language, settings, model, effort)
        entry = _read(path)
        if not entry or not _fits(entry, data_hash, params):
            continue
        if requested_model(entry) != model or entry.get("effort") != effort:
            continue
        if entry.get("prompt_digest") != prompt:
            logger.warning("Precomputed interpretation %s was made for another prompt; rerun the script", path.name)
            continue
        return entry
    return None


def write_precomputed(bundled_id: str, language: str, entry: dict[str, Any], settings: str = "standard") -> Path:
    """The file name follows the requested model and the effort stored in ``entry``."""
    path = precomputed_path(bundled_id, language, settings, requested_model(entry), entry["effort"])
    path.parent.mkdir(parents=True, exist_ok=True)
    _write(path, entry)
    return path


def has_precomputed() -> bool:
    return any(PRECOMPUTED_DIR.glob("*.json"))


def key_for(
    meta: dict[str, Any], data_hash: str, params: dict[str, Any], language: str,
    model: str | None = None, effort: str | None = None,
) -> str:
    """The cache key of an analysis of this dataset with the requested (by default the
    configured) model and effort and the current prompt."""
    return cache_key(
        kind=meta["kind"], data_hash=data_hash, params=params, language=language,
        model=client.MODEL if model is None else model, effort=client.EFFORT if effort is None else effort,
        prompt=client.PROMPT_DIGEST,
    )


def lookup(
    session_id: str, meta: dict[str, Any], data_hash: str, params: dict[str, Any], language: str,
    model: str | None = None, effort: str | None = None,
) -> tuple[dict[str, Any], bool] | None:
    """The precomputed or cached interpretation of exactly this analysis made with this
    model and effort, and whether it was precomputed. Never calls the API. ``params`` are
    ``payload.effective_params``."""
    model = client.MODEL if model is None else model
    effort = client.EFFORT if effort is None else effort
    entry = read_precomputed(meta.get("bundled_id"), language, data_hash, params, client.PROMPT_DIGEST, model, effort)
    if entry:
        return entry, True
    entry = read_cached(session_id, meta, key_for(meta, data_hash, params, language, model, effort))
    return (entry, False) if entry else None


def variants(
    session_id: str, meta: dict[str, Any], data_hash: str, params: dict[str, Any], language: str
) -> list[dict[str, Any]]:
    """The model and effort combinations stored for exactly this analysis and the current
    prompt: ``{"model", "effort", "precomputed"}``, models and efforts in the order the server
    offers them. Cached entries are found by their key, for the offered models and efforts
    (and the models of precomputed files), so this never scans a directory."""
    found: dict[tuple[str, str], bool] = {}
    bundled_id = meta.get("bundled_id")
    if bundled_id:
        for settings in SETTINGS:
            for _, entry in _precomputed_entries(bundled_id, language, settings):
                if _fits(entry, data_hash, params) and entry.get("prompt_digest") == client.PROMPT_DIGEST:
                    found[(requested_model(entry) or "", entry.get("effort") or "")] = True
    models = list(client.allowed_models())
    models += [m for m, _ in found if m not in models]
    efforts = list(dict.fromkeys([*client.EFFORTS, *client.allowed_efforts()]))
    for model in models:
        for effort in efforts:
            if (model, effort) not in found and read_cached(
                session_id, meta, key_for(meta, data_hash, params, language, model, effort)
            ):
                found[(model, effort)] = False
    order_m = {m: i for i, m in enumerate(models)}
    order_e = {e: i for i, e in enumerate(efforts)}
    keys = sorted(found, key=lambda k: (order_m.get(k[0], len(order_m)), order_e.get(k[1], len(order_e))))
    return [{"model": m, "effort": e, "precomputed": found[(m, e)]} for m, e in keys]
