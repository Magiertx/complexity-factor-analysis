"""The analyses of the bundled datasets, computed once after the server has started.

A factor fit over the 128 measures of the log data takes seconds, and more on a small machine;
``core.fit_factors`` keeps recent fits. Whoever opens a bundled dataset first would wait for the
fit, so the server computes the analysis of every bundled dataset in the background after it has
started, with the standard settings of the tool and, for the datasets that have them, with the
settings their paper used. The first open then finds the fit in the cache.

The cache is keyed on the bits of the matrix, so the matrix is made as the API makes it when
a bundled dataset is opened with all its measures: ``bundled_matrix``.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Iterable

import pandas as pd
from starlette.concurrency import run_in_threadpool

from config import logger
from env_config import choice
from interpretation.payload import default_params

from . import catalog as cat
from . import storage
from .core import AnalysisParams, clean_matrix

#: The settings an analysis is computed with: those of an analyze request without a body, and
#: those a bundled dataset was published with (``published_options`` of the manifest).
STANDARD = "standard"
PAPER = "paper"


@dataclass(frozen=True)
class Job:
    """One analysis to precompute: a bundled dataset with a set of settings (``STANDARD`` or ``PAPER``) and the parameters that go with them."""
    dataset_id: str
    kind: str
    settings: str
    params: AnalysisParams


def enabled() -> bool:
    """Whether the server computes them: ``PRECOMPUTE_BUNDLED=1``, which docker-compose sets.
    Never under test (``TESTING=1``, or pytest), where it would keep every start from being quick.
    A value other than 0 or 1 stops the service at startup."""
    from database import IS_TESTING

    return not IS_TESTING and choice("PRECOMPUTE_BUNDLED", "0", ("0", "1")) == "1"


def jobs(entries: Iterable[dict[str, Any]] | None = None) -> list[Job]:
    """One analysis per bundled dataset with the standard settings of its kind, and one more with
    the published settings where the dataset has them."""
    out: list[Job] = []
    for entry in cat.manifest()["datasets"] if entries is None else entries:
        kind = entry["kind"]
        out.append(Job(entry["id"], kind, STANDARD, default_params(kind)))
        published = entry.get("published_options")
        if published:
            out.append(Job(entry["id"], kind, PAPER, AnalysisParams(**published)))
    return out


def bundled_matrix(entry: dict[str, Any]) -> pd.DataFrame:
    """The matrix of a bundled dataset as the API has it once the dataset is opened with all its
    measures: rows labelled, cleaned, and after the round trip through the CSV of the store,
    which can change the last bit of a value."""
    table = pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0)
    table.index = [cat.format_row_label(str(i), entry.get("row_labels")) for i in table.index]
    return storage.as_stored(clean_matrix(table).data)


#: Runs one analysis, in one of the slots the analyses of requests share.
Analyze = Callable[[pd.DataFrame, AnalysisParams], Awaitable[dict[str, Any]]]


async def run(analyze: Analyze, selected: list[Job] | None = None) -> tuple[int, int]:
    """Compute the analyses one after the other; returns how many succeeded and how many failed.

    A failure is logged and does not stop the others: what is missing is computed when somebody
    opens that dataset, as without this."""
    started = time.perf_counter()
    entries = {e["id"]: e for e in cat.manifest()["datasets"]}
    matrices: dict[str, pd.DataFrame] = {}
    done = failed = 0
    for job in jobs() if selected is None else selected:
        begun = time.perf_counter()
        try:
            if job.dataset_id not in matrices:
                matrices[job.dataset_id] = await run_in_threadpool(bundled_matrix, entries[job.dataset_id])
            result = await analyze(matrices[job.dataset_id], job.params)
        except Exception:
            failed += 1
            logger.exception("Could not precompute the %s analysis of %s", job.settings, job.dataset_id)
            continue
        done += 1
        logger.info(
            "Precomputed the %s analysis of %s: %d factors, %.1f s",
            job.settings, job.dataset_id, result["n_factors"], time.perf_counter() - begun,
        )
    logger.info(
        "Precomputed %d analyses of the bundled datasets in %.1f s%s",
        done, time.perf_counter() - started, f" ({failed} failed)" if failed else "",
    )
    return done, failed
