"""The idle-session cleanup runs beside requests that delete sessions."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

import jobs_db
from factor_analysis import storage


def _session(base: Path, name: str, age_s: float) -> Path:
    directory = base / name / "dataset"
    directory.mkdir(parents=True)
    meta = directory / "meta.json"
    meta.write_text("{}", encoding="utf-8")
    old = time.time() - age_s
    os.utime(meta, (old, old))
    return base / name


def test_a_session_deleted_during_the_scan_does_not_break_it(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs_db, "ARTIFACTS_DIR", tmp_path)
    base = tmp_path / "datasets"
    vanishing = _session(base, "a-vanishing", 10)
    idle = _session(base, "b-idle", 10_000)
    fresh = _session(base, "c-fresh", 10)

    real_rglob = Path.rglob

    def rglob(self, pattern):
        found = list(real_rglob(self, pattern))
        if self == vanishing:
            # The request that owns the session deletes it after the scan listed its files.
            shutil.rmtree(vanishing)
        return iter(found)

    monkeypatch.setattr(Path, "rglob", rglob)
    storage.cleanup_idle_sessions(max_idle_s=1_000)

    assert not idle.exists()
    assert fresh.exists()
