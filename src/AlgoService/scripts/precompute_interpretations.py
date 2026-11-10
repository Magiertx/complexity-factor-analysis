"""Precompute the interpretations of the bundled datasets for the default parameters and for
the published options of each dataset ("Paper settings", where Get started leads).

The API serves these files without an API key, so the offline demo shows interpretations for
the bundled datasets. Needs ANTHROPIC_API_KEY; existing files are skipped unless --force is
given. Run from src/AlgoService:

    python scripts/precompute_interpretations.py
    python scripts/precompute_interpretations.py --force --dataset comfy-paper-inductive-miner --language de --settings published

Writes datasets/interpretations/<dataset id>.<language>.<model>.<effort>.json (default
parameters) and <dataset id>.published.<language>.<model>.<effort>.json (published options;
only datasets that have them), one file per variant. Variants are model:effort pairs, by
default PRECOMPUTE_VARIANTS; choose others with --variant (repeatable), e.g.

    python scripts/precompute_interpretations.py --variant claude-sonnet-5-5:medium

Every file stores ``result_fingerprint`` (payload.result_fingerprint), and is served only for an
analysis with the same fingerprint. After a change of the computation that moves measures,
``--backfill-fingerprints`` adds the key to files that lack it, from a local analysis; it makes
no API call, needs no key and never changes a file whose data, parameters or fingerprint
disagree with the current analysis (those need --force).
"""

from __future__ import annotations

import argparse
import asyncio
import json
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
    result_fingerprint,
)
from interpretation.prompt import LANGUAGES, PROMPT_VERSION  # noqa: E402


#: The models and efforts interpretations are shipped for.
PRECOMPUTE_VARIANTS: tuple[tuple[str, str], ...] = (
    ("claude-opus-5-5", "medium"),
    ("claude-opus-5-5", "high"),
    ("claude-opus-5-5", "xhigh"),
)
#: Longer than a live call: the script waits for the high efforts, no browser is waiting.
DEFAULT_TIMEOUT_S = 600.0


def parse_variant(text: str) -> tuple[str, str]:
    model, _, effort = text.partition(":")
    if not client.CHOICE_RE.fullmatch(model) or effort not in client.MAX_TOKENS_BY_EFFORT:
        raise argparse.ArgumentTypeError(
            f"{text!r} is not model:effort; effort is one of {', '.join(client.EFFORTS)}"
        )
    return model, effort


def bundled_matrix(entry: dict[str, Any]) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """The cleaned matrix of a bundled dataset, as the API stores it when it is chosen
    with all measures."""
    cleaned = clean_matrix(pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0))
    return storage.as_stored(cleaned.data), cleaned.dropped


def settings_of(entry: dict[str, Any], wanted: tuple[str, ...] | list[str]) -> list[str]:
    """The wanted settings this dataset has: published options only where the manifest has them."""
    return [s for s in wanted if s == "standard" or entry.get(f"{s}_options")]


def analysis_of(entry: dict[str, Any], settings: str) -> tuple[pd.DataFrame, list[dict[str, Any]], Any, dict[str, Any]]:
    """The matrix, the cleaning drops, the parameters and the result of the analysis of a bundled
    dataset with the default parameters or its published options."""
    kind = entry["kind"]
    data, dropped = bundled_matrix(entry)
    params = default_params(kind) if settings == "standard" else params_from_options(kind, entry[f"{settings}_options"])
    return data, dropped, params, analyze(data, params)


def backfill_fingerprints(directory: Path | None = None) -> tuple[int, int]:
    """Add ``result_fingerprint`` to the files that lack it, from a local analysis; no API call.
    The key goes after ``params``, the rest of a file stays as it is. A file whose data hash,
    parameters or fingerprint disagree with the current analysis is left alone and counted as
    a failure. Returns (written, failed)."""
    directory = store.PRECOMPUTED_DIR if directory is None else directory
    analyses: dict[tuple[str, str], tuple[str, dict[str, Any], str]] = {}
    written = failed = 0
    for path in sorted(directory.glob("*.json")):
        entry = json.loads(path.read_text(encoding="utf-8"))
        bundled = cat.bundled_entry(entry.get("dataset_id") or "")
        settings = entry.get("settings", "standard")
        if bundled is None or (settings != "standard" and not bundled.get(f"{settings}_options")):
            failed += 1
            print(f"FAIL  {path.name}: no such dataset or settings", file=sys.stderr)
            continue
        if (bundled["id"], settings) not in analyses:
            data, _, params, result = analysis_of(bundled, settings)
            analyses[(bundled["id"], settings)] = (
                data_hash(data), effective_params(params, result["n_factors"]), result_fingerprint(result)
            )
        digest, effective, fingerprint = analyses[(bundled["id"], settings)]
        if entry.get("data_hash") != digest or entry.get("params") != effective:
            failed += 1
            print(f"FAIL  {path.name}: data or parameters differ from the current analysis; rerun with --force",
                  file=sys.stderr)
            continue
        if "result_fingerprint" in entry:
            if entry["result_fingerprint"] != fingerprint:
                failed += 1
                print(f"FAIL  {path.name}: fingerprint differs from the current analysis; rerun with --force",
                      file=sys.stderr)
            continue
        updated: dict[str, Any] = {}
        for key, value in entry.items():
            updated[key] = value
            if key == "params":
                updated["result_fingerprint"] = fingerprint
        store._write(path, updated)
        written += 1
        print(f"wrote {path.name} (result_fingerprint)")
    return written, failed


async def precompute(
    entry: dict[str, Any], language: str, key: str, settings: str = "standard",
    *, model: str | None = None, effort: str | None = None, timeout: float = DEFAULT_TIMEOUT_S,
) -> dict[str, Any]:
    """``model`` and ``effort`` default to the server's."""
    model = client.MODEL if model is None else model
    effort = client.EFFORT if effort is None else effort
    kind = entry["kind"]
    data, dropped, params, result = analysis_of(entry, settings)
    payload = build_payload(kind, result, params, dropped)
    client.check_size(payload, language)
    answer = await client.interpret(
        payload, language, key, timeout=timeout, model=model, effort=effort, sdk_timeout=timeout - 10
    )
    return {
        "dataset_id": entry["id"],
        "kind": kind,
        "data_hash": data_hash(data),
        "params": effective_params(params, result["n_factors"]),
        "result_fingerprint": result_fingerprint(result),
        "language": language,
        "settings": settings,
        "model": answer.model,
        "requested_model": model,
        "prompt_version": PROMPT_VERSION,
        "prompt_digest": client.PROMPT_DIGEST,
        "effort": effort,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "interpretation": answer.interpretation.model_dump(),
    }


async def run(
    datasets: list[dict[str, Any]], languages: list[str], force: bool, key: str,
    settings: tuple[str, ...] | list[str] = store.SETTINGS,
    variants: tuple[tuple[str, str], ...] | list[tuple[str, str]] | None = None,
    timeout: float = DEFAULT_TIMEOUT_S,
) -> int:
    failed = 0
    for entry in datasets:
        for which in settings_of(entry, settings):
            for language in languages:
                for model, effort in PRECOMPUTE_VARIANTS if variants is None else variants:
                    path = store.precomputed_path(entry["id"], language, which, model, effort)
                    if path.exists() and not force:
                        print(f"skip  {path.name} (exists; --force to replace)")
                        continue
                    try:
                        result = await precompute(
                            entry, language, key, which, model=model, effort=effort, timeout=timeout
                        )
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
    parser.add_argument(
        "--variant", action="append", type=parse_variant, metavar="MODEL:EFFORT",
        help="a model and effort to make files for; repeatable (default: "
             + ", ".join(f"{m}:{e}" for m, e in PRECOMPUTE_VARIANTS) + ")",
    )
    parser.add_argument(
        "--backfill-fingerprints", action="store_true",
        help="add result_fingerprint to existing files from a local analysis; no API call, no key needed",
    )
    parser.add_argument(
        "--timeout", type=float, default=DEFAULT_TIMEOUT_S, metavar="SECONDS",
        help=f"limit of one call (default {DEFAULT_TIMEOUT_S:.0f}; a live call has {client.TIMEOUT_S:.0f})",
    )
    args = parser.parse_args(argv)
    if args.timeout <= 10:
        parser.error("--timeout must be more than 10 seconds")

    if args.backfill_fingerprints:
        written, failed = backfill_fingerprints()
        print(f"{written} file(s) written, {failed} failed")
        return 1 if failed else 0
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
    failed = asyncio.run(run(datasets, args.language, args.force, key, args.settings, args.variant, args.timeout))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
