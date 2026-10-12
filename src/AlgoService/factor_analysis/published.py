"""Numbers the bundled datasets were published with.

``datasets/published/<dataset id>.json`` holds what the upstream reports print, extracted
once by ``scripts/extract_published.py``:

- ``source``: repository, commit and file of the report;
- ``reproduce_with``: the analysis parameters under which the tool reproduces the numbers,
  or None if it cannot yet;
- ``verified``: the fields ``tests/test_published_numbers.py`` checks; only these may be
  compared at runtime;
- ``platform_dependent``: fields that are published but depend on the platform's linear
  algebra, so they are kept for reference and never compared;
- the values themselves (``bartlett``, ``kmo``, ``msa_filter``, ``loadings``, ...), rounded
  as the report prints them (``decimals``), and ``notes`` on how they were read.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .catalog import DATASETS_DIR

PUBLISHED_DIR = DATASETS_DIR / "published"
SCHEMA_VERSION = 1


@lru_cache(maxsize=None)
def published(dataset_id: str) -> dict[str, Any] | None:
    """The published numbers of a bundled dataset, or None if there are none."""
    path = PUBLISHED_DIR / f"{dataset_id}.json"
    if "/" in dataset_id or "\\" in dataset_id or not path.is_file():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)
