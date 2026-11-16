"""Every error code the backend gives has a sentence in both languages of the UI (docs/UI.md,
"Error messages"); without one, the UI shows only its generic "could not be ..." line."""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

SERVICE = Path(__file__).resolve().parents[1]
LOCALES = SERVICE.parent / "frontend" / "lib" / "i18n" / "locales"

#: The position of the code among the arguments of each call that carries one.
CODE_ARGUMENT = {"_bad": 1, "CodedHTTPException": 2, "DatasetError": 1, "AnalysisError": 1, "set_job_failed": 2}

#: Codes that rightly have no sentence of their own, and why.
WITHOUT_SENTENCE = {
    # A failed stability job: the stability's own "could not be computed", the cause as details.
    "stability_failed",
    # The UI offers only the rules it knows; another one comes from a hand-made request.
    "unknown_assignment_rule",
}


def _codes() -> dict[str, list[str]]:
    """Each code given as a literal by a call of ``CODE_ARGUMENT``, with where it is given."""
    found: dict[str, list[str]] = {}
    files = [*SERVICE.glob("*.py"), *SERVICE.glob("routes/*.py"), *SERVICE.glob("factor_analysis/*.py")]
    for path in files:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", None)
            if name not in CODE_ARGUMENT:
                continue
            index = CODE_ARGUMENT[name]
            arg = node.args[index] if len(node.args) > index else next(
                (k.value for k in node.keywords if k.arg == "code"), None
            )
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                found.setdefault(arg.value, []).append(f"{path.relative_to(SERVICE)}:{node.lineno}")
    return found


def _text(locale: dict, key: str) -> str | None:
    node = locale
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


@pytest.mark.skipif(not LOCALES.is_dir(), reason="the frontend is not part of this checkout")
def test_every_error_code_has_a_sentence_in_both_languages():
    locales = {name: json.loads((LOCALES / f"{name}.json").read_text(encoding="utf-8")) for name in ("en", "de")}
    codes = _codes()
    assert {"csv_too_few_columns", "dataset_jobs_busy", "stability_jobs_busy", "gzip_invalid"} <= set(codes)
    missing = [
        f"{code} ({', '.join(where)}) in {name}.json"
        for code, where in sorted(codes.items())
        if code not in WITHOUT_SENTENCE
        for name, locale in locales.items()
        if not any(_text(locale, f"{group}.{code}") for group in ("errors", "factor.errors", "factor.warnings"))
    ]
    assert not missing, "codes without a sentence: " + "; ".join(missing)
