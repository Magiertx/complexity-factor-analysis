#!/usr/bin/env python3
"""Checks of a running desktop app that a frozen build can get wrong and the smoke test does not
see (docs/DESKTOP.md, "Packaging"). Start the app with ``--port-file`` first.

    python scripts/check_desktop.py --port-file port.txt [--commit SHA] [--version V]

- the export's manifest names the tool's version and commit, and the KMO of the paper analysis is
  ComFy's 0.7467 (a frozen build has no git; the commit comes from build_info.json);
- the measure sheets have their sources: every model measure points into ComFy, the log measures
  into feeed (read from the source files the bundle has to carry), and a dataset made from PNML
  files names the pm4py version (read from the packages' metadata);
- the pages and the files they load are served with the right type and the page's security
  headers; the API keeps its own.

Standard library only; exits 1 with one line per failed check.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import Client, StepFailed  # noqa: E402

PAPER_DATASET = "comfy-paper-inductive-miner"
JS_TYPES = {"text/javascript", "application/javascript"}


def fetch(base: str, path: str, token: str | None = None) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(base + path, headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read()


def media_type(headers: dict[str, str]) -> str:
    return headers.get("content-type", "").split(";")[0].strip().lower()


class Checks:
    def __init__(self) -> None:
        self.failed: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        print(f"{'ok  ' if ok else 'FAIL'} {name}{': ' + detail if detail else ''}", flush=True)
        if not ok:
            self.failed.append(name)


def manifest_and_kmo(client: Client, checks: Checks, commit: str | None, version: str | None) -> None:
    created = client.request(
        "POST", "/factor-analysis/datasets", form={"kind": "model", "source": "bundled", "bundled_id": PAPER_DATASET}
    )
    dataset_id = created["dataset_id"]
    try:
        archive = client.request(
            "POST", f"/factor-analysis/datasets/{dataset_id}/export/zip", body={"n_factors": 4}, raw=True
        )
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            manifest = json.loads(z.read("manifest.json"))
            analysis = json.loads(z.read("analysis.json"))
    finally:
        client.request("DELETE", f"/factor-analysis/datasets/{dataset_id}")
    tool = manifest.get("tool") or {}
    if commit:
        checks.check("commit in the manifest", tool.get("commit") == commit, f"{tool.get('commit')} (expected {commit})")
    else:
        checks.check("commit in the manifest", bool(tool.get("commit")) and tool["commit"] != "unknown", str(tool.get("commit")))
    if version:
        checks.check("version in the manifest", tool.get("version") == version, f"{tool.get('version')} (expected {version})")
    else:
        checks.check("version in the manifest", bool(tool.get("version")), str(tool.get("version")))
    kmo = analysis["kmo"]["overall"]
    checks.check("KMO of the paper analysis", 0.7466 < kmo < 0.7468, f"{kmo:.4f} (ComFy: 0.7467)")


def sources(client: Client, checks: Checks) -> None:
    model = client.request("GET", "/factor-analysis/catalog?kind=model")["measures"]
    missing = [m["name"] for m in model if not (m.get("source") or {}).get("url")]
    checks.check("sources of the model measures", not missing, f"{len(model) - len(missing)} of {len(model)}" + (f"; none for {missing}" if missing else ""))
    log = client.request("GET", "/factor-analysis/catalog?kind=log")["measures"]
    with_source = [m for m in log if (m.get("source") or {}).get("url")]
    # Derived or summary entries may have none; a bundle without the feeed files has none at all.
    checks.check("sources of the log measures", len(with_source) >= 0.9 * len(log), f"{len(with_source)} of {len(log)}")


def libraries(client: Client, checks: Checks) -> None:
    # Only a model dataset can be exported from the bundled samples (four logs are too few
    # observations for a log analysis); the version of feeed is read the same way as pm4py's.
    for kind, source, bundled, want in (("model", "pnml", "pdc-sample-models", "pm4py"),):
        created = client.request("POST", "/factor-analysis/datasets", form={"kind": kind, "source": source, "bundled_id": bundled})
        dataset_id = created["dataset_id"]
        name = f"{want} version in the manifest ({kind} from {source})"
        try:
            for _ in range(450):
                status = client.request("GET", f"/factor-analysis/datasets/{dataset_id}?rows=0")["status"]
                if status in ("ready", "failed"):
                    break
                time.sleep(2)
            if status != "ready":
                checks.check(name, False, f"the dataset is {status}")
                continue
            archive = client.request(
                "POST", f"/factor-analysis/datasets/{dataset_id}/export/zip", body={"n_factors": 1}, raw=True
            )
            with zipfile.ZipFile(io.BytesIO(archive)) as z:
                provenance = json.loads(z.read("manifest.json"))["dataset"]["provenance"]
            version = (provenance.get("libraries") or {}).get("pm4py") if want == "pm4py" else (provenance.get("features") or {}).get("version")
            checks.check(name, bool(version), str(version))
        except StepFailed as exc:
            checks.check(name, False, str(exc))
        finally:
            client.request("DELETE", f"/factor-analysis/datasets/{dataset_id}")


def access(base: str, checks: Checks, token: str) -> None:
    """Without the token nothing but the health check answers; with it as a query parameter the
    page server sets its cookie and redirects without the token."""
    status, _, body = fetch(base, "/api/factor-analysis/datasets")
    checks.check("API without the token", status == 401, str(status))
    status, headers, body = fetch(base, "/")
    checks.check("page without the token", status == 401 and token.encode() not in body, str(status))
    status, _, _ = fetch(base, "/api/health")
    checks.check("health stays open", status == 200, str(status))


def pages(base: str, checks: Checks, token: str) -> None:
    status, headers, body = fetch(base, "/", token)
    csp = headers.get("content-security-policy", "")
    checks.check("page: status and type", status == 200 and media_type(headers) == "text/html", f"{status} {media_type(headers)}")
    checks.check("page: security headers", "default-src 'self'" in csp and headers.get("x-content-type-options") == "nosniff", csp[:60])
    html = body.decode("utf-8", "replace")
    scripts = sorted(set(re.findall(r'(?:src|href)="(/_next/static/[^"]+\.js)"', html)))
    styles = sorted(set(re.findall(r'href="(/_next/static/[^"]+\.css)"', html)))
    checks.check("page: loads scripts and styles", bool(scripts) and bool(styles), f"{len(scripts)} scripts, {len(styles)} styles")
    bad = []
    for path in scripts:
        _, h, _ = fetch(base, path, token)
        if media_type(h) not in JS_TYPES:
            bad.append(f"{path}: {media_type(h)}")
    for path in styles:
        _, h, _ = fetch(base, path, token)
        if media_type(h) != "text/css":
            bad.append(f"{path}: {media_type(h)}")
    checks.check("scripts are JavaScript, styles CSS", not bad, "; ".join(bad[:3]))
    for route in ("/log", "/runs", "/settings", "/inspect", "/compare", "/guide"):
        status, h, _ = fetch(base, route, token)
        checks.check(f"page {route}", status == 200 and media_type(h) == "text/html", str(status))
    status, h, _ = fetch(base, "/no-such-page", token)
    checks.check("unknown page: 404 as a page", status == 404 and media_type(h) == "text/html", str(status))
    status, h, _ = fetch(base, "/api/health", token)
    checks.check(
        "API keeps its own security headers",
        status == 200 and "default-src 'none'" in h.get("content-security-policy", ""),
        h.get("content-security-policy", "")[:40],
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port-file", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True, help="the access token (--token-file of the app)")
    parser.add_argument("--commit", help="the commit the build was made from")
    parser.add_argument("--version", help="the version the build carries")
    args = parser.parse_args()
    base = f"http://127.0.0.1:{int(args.port_file.read_text(encoding='utf-8').strip())}"
    token = args.token_file.read_text(encoding="utf-8").strip()
    client = Client(base + "/api", 300, token)
    checks = Checks()
    for step in (
        lambda: manifest_and_kmo(client, checks, args.commit, args.version),
        lambda: sources(client, checks),
        lambda: libraries(client, checks),
        lambda: access(base, checks, token),
        lambda: pages(base, checks, token),
    ):
        try:
            step()
        except StepFailed as exc:
            checks.check("step", False, str(exc))
    print("\nFAILED: " + ", ".join(checks.failed) if checks.failed else "\nPASSED")
    return 1 if checks.failed else 0


if __name__ == "__main__":
    sys.exit(main())
