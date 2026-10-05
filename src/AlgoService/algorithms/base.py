"""Common interface every process-mining tool implements.

A tool declares its parameter schema and returns a list of typed
**artifacts** (stats, tables, images, downloadable files, free-form text).
The frontend has one renderer per artifact kind, so adding a new tool that
produces, say, a scree-plot PNG does not require frontend changes.

Adapters live in ``src/AlgoService/algorithms/<id>.py`` and import from the
vendored research code in ``src/AlgoService/vendored/``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional


ParameterType = Literal["int", "float", "bool", "enum", "multi_enum", "string"]
# `ToolType` is an open string; TOOL_CATEGORIES below is the
# data-driven source of truth that the frontend consumes through /algorithms,
# so adding a category requires zero type churn. Adapters still set
# `tool_type` to a string matching one of the registered category ids.
ToolType = str
ArtifactKind = Literal["stat", "table", "image", "log", "text"]

TOOL_CATEGORIES: list[dict[str, str]] = [
    {"id": "complexity", "label": "Complexity analysis"},
]


@dataclass
class ParameterSpec:
    """One parameter exposed to the frontend form.

    Convention for stochastic algorithms: if your adapter uses any random
    number generator (np.random, sklearn shuffles, …), expose a `seed` int
    parameter with a sensible default. In the analyze() body, seed every RNG
    you can reach (`np.random.seed`, `random.seed`, pass `random_state=seed`
    to sklearn constructors that accept it),
    and emit the effective seed value as a stat artifact so reruns are
    reproducible. The vendored research code may not honor every seed
    perfectly; mention that in the parameter help.
    """
    name: str
    label: str
    type: ParameterType
    default: Any
    min: Optional[float] = None
    max: Optional[float] = None
    options: Optional[list[str]] = None
    help: Optional[str] = None
    # Short hint about a sensible value range / paper-recommended default,
    # surfaced in the frontend form as supplementary text. Example:
    # "0.3–0.5 is typical; higher = fewer loadings shown".
    recommended: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "name": self.name,
            "label": self.label,
            "type": self.type,
            "default": self.default,
        }
        if self.min is not None: d["min"] = self.min
        if self.max is not None: d["max"] = self.max
        if self.options is not None: d["options"] = self.options
        if self.help is not None: d["help"] = self.help
        if self.recommended is not None: d["recommended"] = self.recommended
        return d


@dataclass
class SecondaryFile:
    """Declares an optional auxiliary file an adapter accepts alongside the
    main event log. The /analyze route looks at this list, parses each file
    out of the multipart form, saves it to a temp path, and injects that
    path into the adapter's params as ``{name}_path``.

    Example: an adapter that accepts a user-supplied Petri net declares
    ``name="reference_pnml"`` and reads it through
    ``params["reference_pnml_path"]`` instead of mining one from the log.
    """
    name: str
    label: str
    accept: str
    optional: bool = True
    help: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "accept": self.accept,
            "optional": self.optional,
            "help": self.help,
        }


@dataclass
class Artifact:
    """One piece of output to render. ``payload`` shape depends on ``kind``."""
    kind: ArtifactKind
    label: str
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "label": self.label, **self.payload}


# Constructor helpers for adapters.

def stat(
    label: str,
    value: float | int | str,
    *,
    unit: Optional[str] = None,
    pct: bool = False,
    accent: Literal["default", "success", "warn", "danger"] = "default",
) -> Artifact:
    return Artifact("stat", label, {"value": value, "unit": unit, "pct": pct, "accent": accent})


def table(label: str, columns: list[str], rows: list[list[Any]]) -> Artifact:
    return Artifact("table", label, {"columns": columns, "rows": rows})


def image(label: str, data_base64: str, *, mime: str = "image/png", caption: Optional[str] = None) -> Artifact:
    return Artifact("image", label, {"data_base64": data_base64, "mime": mime, "caption": caption})


def log_file(label: str, data_base64: str, filename: str, *, mime: str = "application/xml") -> Artifact:
    return Artifact("log", label, {"data_base64": data_base64, "filename": filename, "mime": mime})


def text(label: str, markdown: str) -> Artifact:
    return Artifact("text", label, {"markdown": markdown})


import logging
from typing import Any, Literal, Optional, Callable


@dataclass
class RunContext:
    """Execution context for running algorithms.
    Provides progress reporting, abortion checks, run identifiers, and logging.
    """
    run_id: str = "dummy"
    _progress_callback: Optional[Callable[[float, str], None]] = None
    _check_aborted_callback: Optional[Callable[[], bool]] = None
    logger: Optional[logging.Logger] = None

    def __post_init__(self) -> None:
        if self.logger is None:
            self.logger = logging.getLogger(f"run_{self.run_id}")

    def progress(self, pct: float, msg: str) -> None:
        """Report progress (0.0 to 100.0) with a message."""
        if self._progress_callback:
            self._progress_callback(pct, msg)

    def check_aborted(self) -> None:
        """Raise a RuntimeError if the run has been aborted by the user/system."""
        if self._check_aborted_callback and self._check_aborted_callback():
            raise RuntimeError("Task aborted by user")


@dataclass
class AnalysisResult:
    artifacts: list[Artifact]
    summary: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "artifacts": [a.to_dict() for a in self.artifacts],
        }


class ParameterValidationError(ValueError):
    def __init__(self, errors: dict[str, str]) -> None:
        self.errors = errors
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))


class AlgorithmBase:
    id: str = ""
    name: str = ""
    description: str = ""
    paper_url: Optional[str] = None
    author: Optional[str] = None
    tool_type: ToolType = "complexity"
    parameters_schema: list[ParameterSpec] = []
    secondary_files: list[SecondaryFile] = []
    citation: Optional[str] = None
    formatted_citation: Optional[str] = None

    def analyze(self, file_path: str, params: dict[str, Any], ctx: Optional[RunContext] = None) -> AnalysisResult:
        raise NotImplementedError

    def manifest(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "paper_url": self.paper_url,
            "author": self.author,
            "tool_type": self.tool_type,
            "parameters_schema": [p.to_dict() for p in self.parameters_schema],
            "secondary_files": [f.to_dict() for f in self.secondary_files],
            "citation": self.citation,
            "formatted_citation": self.formatted_citation,
        }

    def coerce_params(self, raw: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        errors: dict[str, str] = {}

        # Secondary-file paths/filenames are injected by the /analyze route
        # as ``{name}_path`` / ``{name}_filename`` keys after coercion;
        # tolerate them here so a round-trip (e.g. recoercion when
        # re-submitting from history) doesn't trip the unknown-keys check.
        secondary_path_keys = {
            key for f in self.secondary_files for key in (f"{f.name}_path", f"{f.name}_filename")
        }
        known_keys = {spec.name for spec in self.parameters_schema} | secondary_path_keys
        unknown_keys = set(raw.keys()) - known_keys
        if unknown_keys:
            for k in unknown_keys:
                errors[k] = "Unknown parameter key."
        for spec in self.parameters_schema:
            if spec.name not in raw or raw[spec.name] is None or raw[spec.name] == "":
                out[spec.name] = spec.default
                continue
            v = raw[spec.name]
            try:
                if spec.type == "int":
                    try:
                        val = int(v)
                    except (ValueError, TypeError):
                        errors[spec.name] = "Must be a valid integer."
                        continue
                    if spec.min is not None and val < spec.min:
                        errors[spec.name] = f"Must be at least {spec.min}."
                        continue
                    if spec.max is not None and val > spec.max:
                        errors[spec.name] = f"Must be at most {spec.max}."
                        continue
                    out[spec.name] = val
                elif spec.type == "float":
                    try:
                        val = float(v)
                    except (ValueError, TypeError):
                        errors[spec.name] = "Must be a valid number."
                        continue
                    if spec.min is not None and val < spec.min:
                        errors[spec.name] = f"Must be at least {spec.min}."
                        continue
                    if spec.max is not None and val > spec.max:
                        errors[spec.name] = f"Must be at most {spec.max}."
                        continue
                    out[spec.name] = val
                elif spec.type == "bool":
                    out[spec.name] = v if isinstance(v, bool) else str(v).lower() in ("true", "1", "yes", "on")
                elif spec.type == "enum":
                    sv = str(v)
                    if spec.options and sv not in spec.options:
                        errors[spec.name] = f"Value '{sv}' is not one of the allowed options: {', '.join(spec.options)}."
                        continue
                    out[spec.name] = sv
                elif spec.type == "string":
                    sv = str(v).strip()
                    if spec.min is not None and len(sv) < spec.min:
                        errors[spec.name] = f"Must be at least {int(spec.min)} characters."
                        continue
                    if spec.max is not None and len(sv) > spec.max:
                        errors[spec.name] = f"Must be at most {int(spec.max)} characters."
                        continue
                    out[spec.name] = sv
                elif spec.type == "multi_enum":
                    if isinstance(v, list):
                        items = [str(x) for x in v]
                    else:
                        items = [s.strip() for s in str(v).split(",") if s.strip()]
                    if spec.options:
                        invalid_items = [item for item in items if item not in spec.options]
                        if invalid_items:
                            invalid_str = ", ".join(f"'{i}'" for i in invalid_items)
                            errors[spec.name] = f"Values {invalid_str} are not allowed options. Allowed: {', '.join(spec.options)}."
                            continue
                    out[spec.name] = items
                else:
                    out[spec.name] = v
            except Exception as e:
                errors[spec.name] = str(e)
        if errors:
            raise ParameterValidationError(errors)
        return out


from contextlib import contextmanager
from pathlib import Path

@contextmanager
def temp_file_path(suffix: str = ""):
    """Context manager that creates a temporary file path and guarantees its deletion."""
    import tempfile
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        yield tmp_path
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass




