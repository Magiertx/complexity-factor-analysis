"""Precompute the interpretations of the bundled datasets for the default parameters and for
the published options of each dataset ("Paper settings", where Get started leads).

The API serves these files without an API key, so the offline demo shows interpretations for
the bundled datasets. Needs ANTHROPIC_API_KEY; existing files are skipped unless --force is
given. Run from src/AlgoService:

    python scripts/precompute_interpretations.py
    python scripts/precompute_interpretations.py --force --dataset comfy-paper-inductive-miner --language de --settings published

Writes datasets/interpretations/<dataset id>.<language>.json (default parameters) and
<dataset id>.published.<language>.json (published options; only datasets that have them).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd  # noqa: E402

from factor_analysis import catalog as cat  # noqa: E402
from factor_analysis import storage  # noqa: E402
from factor_analysis.core import AnalysisError, analyze, clean_matrix  # noqa: E402
from interpretation import client, store  # noqa: E402
from interpretation.client import InterpretationError  # noqa: E402
from interpretation.payload import (  # noqa: E402
    build_payload,
    data_hash,
    default_params,
    effective_params,
    params_from_options,
)
from interpretation.prompt import LANGUAGES, PROMPT_VERSION  # noqa: E402


def bundled_matrix(entry: dict[str, Any]) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """The cleaned matrix of a bundled dataset, as the API stores it when it is chosen
    with all measures."""
    cleaned = clean_matrix(pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0))
    return storage.as_stored(cleaned.data), cleaned.dropped


def settings_of(entry: dict[str, Any], wanted: tuple[str, ...] | list[str]) -> list[str]:
    """The wanted settings this dataset has: published options only where the manifest has them."""
    return [s for s in wanted if s == "standard" or entry.get(f"{s}_options")]


async def precompute(entry: dict[str, Any], language: str, key: str, settings: str = "standard") -> dict[str, Any]:
    kind = entry["kind"]
    data, dropped = bundled_matrix(entry)
    params = default_params(kind) if settings == "standard" else params_from_options(kind, entry[f"{settings}_options"])
    result = analyze(data, params)
    payload = build_payload(kind, result, params, dropped)
    client.check_size(payload, language)
    answer = await client.interpret(payload, language, key)
    return {
        "dataset_id": entry["id"],
        "kind": kind,
        "data_hash": data_hash(data),
        "params": effective_params(params, result["n_factors"]),
        "language": language,
        "settings": settings,
        "model": answer.model,
        "prompt_version": PROMPT_VERSION,
        "prompt_digest": client.PROMPT_DIGEST,
        "effort": client.EFFORT,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "interpretation": answer.interpretation.model_dump(),
    }


async def run(
    datasets: list[dict[str, Any]], languages: list[str], force: bool, key: str,
    settings: tuple[str, ...] | list[str] = store.SETTINGS,
) -> int:
    failed = 0
    for entry in datasets:
        for which in settings_of(entry, settings):
            for language in languages:
                path = store.precomputed_path(entry["id"], language, which)
                if path.exists() and not force:
                    print(f"skip  {path.name} (exists; --force to replace)")
                    continue
                try:
                    result = await precompute(entry, language, key, which)
                    store.write_precomputed(entry["id"], language, result, which)
                except InterpretationError as e:
                    failed += 1
                    print(f"FAIL  {path.name}: {e.detail}", file=sys.stderr)
                    continue
                except AnalysisError as e:
                    failed += 1
                    print(f"FAIL  {path.name}: {e}", file=sys.stderr)
                    continue
                print(f"wrote {path.name}")
    return failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--force", action="store_true", help="replace existing files")
    parser.add_argument("--dataset", nargs="+", metavar="ID", help="only these bundled datasets")
    parser.add_argument("--language", nargs="+", choices=sorted(LANGUAGES), default=sorted(LANGUAGES))
    parser.add_argument("--settings", nargs="+", choices=store.SETTINGS, default=list(store.SETTINGS))
    args = parser.parse_args(argv)

    key = client.api_key()
    if key is None:
        print("ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        return 2
    datasets = cat.manifest()["datasets"]
    if args.dataset:
        unknown = set(args.dataset) - {d["id"] for d in datasets}
        if unknown:
            print(f"Unknown dataset(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            return 2
        datasets = [d for d in datasets if d["id"] in args.dataset]
    failed = asyncio.run(run(datasets, args.language, args.force, key, args.settings))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
