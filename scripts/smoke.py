"""Smoke test of a running stack: every dataset source, an analysis, the exports.

Works against the frontend (``/api`` is the backend behind it) of the Docker stack, a
deployed instance or the desktop app, and deletes what it created, also when a step fails.
Exits with 1 if a step fails and prints a table of the steps with their times.

    python scripts/smoke.py                                  # http://localhost:3000
    python scripts/smoke.py --base-url https://cfa.example.org
    python scripts/smoke.py --api-url http://localhost:8000  # the backend directly
    python scripts/smoke.py --port-file port.txt --token-file token.txt --no-prom   # the desktop app (docs/DESKTOP.md)

On a server the smoke test has a session of its own. The desktop app has one session for
everybody, so there it works next to the datasets that are already there and leaves them alone.

Steps: catalog of both kinds; a model dataset from the four sample logs with the default
miner (needs ProM; ``--no-prom`` skips it); the sample Petri nets; the sample logs through feeed; a paper dataset,
analysed with the settings its numbers were published with and compared with them, here and
by the server against the report; the session's copy of it handed back instead of a new one;
its ZIP and LaTeX export. Only the standard library, so it runs with any Python 3.10 or later.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable

PUBLISHED = Path(__file__).resolve().parent.parent / "src" / "AlgoService" / "datasets" / "published"
PAPER_DATASET = "comfy-paper-inductive-miner"


class StepFailed(Exception):
    pass


class Client:
    """JSON over HTTP with one session cookie, like a browser tab."""

    def __init__(self, api: str, timeout: float, token: str | None = None) -> None:
        self.api = api.rstrip("/")
        self.timeout = timeout
        self.token = token  # the desktop app wants it as a bearer token
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method: str, path: str, *, form: dict[str, str] | None = None,
                body: Any = None, raw: bool = False) -> Any:
        data, headers = None, {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.api + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                content = response.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            raise StepFailed(f"{method} {path}: HTTP {e.code} {detail}") from None
        except urllib.error.URLError as e:
            raise StepFailed(f"{method} {path}: {e.reason}") from None
        if raw:
            return content
        return json.loads(content) if content else None


class Smoke:
    def __init__(self, client: Client, dataset_timeout: float) -> None:
        self.client = client
        self.dataset_timeout = dataset_timeout
        self.rows: list[tuple[str, float, bool, str]] = []
        self.created: list[str] = []
        # Datasets of the session from before the test (the desktop app's one session).
        self.existing: set[str] = set()

    def step(self, name: str, run: Callable[[], str]) -> bool:
        start = time.monotonic()
        try:
            detail, ok = run(), True
        except StepFailed as e:
            detail, ok = str(e), False
        except Exception as e:  # a bug in a step must not skip the cleanup
            detail, ok = f"{type(e).__name__}: {e}", False
        self.rows.append((name, time.monotonic() - start, ok, detail))
        print(f"{'ok  ' if ok else 'FAIL'} {name}: {detail}", flush=True)
        return ok

    # --- datasets -------------------------------------------------------------------------

    def create(self, form: dict[str, str]) -> dict[str, Any]:
        created = self.client.request("POST", "/factor-analysis/datasets", form=form)
        # A copy the session had already is handed back ("reused"); it is not the test's to delete.
        if created["dataset_id"] not in self.existing:
            self.created.append(created["dataset_id"])
        return self.wait(created["dataset_id"])

    def wait(self, dataset_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self.dataset_timeout
        while True:
            dataset = self.client.request("GET", f"/factor-analysis/datasets/{dataset_id}?rows=0")
            if dataset["status"] == "ready":
                return dataset
            if dataset["status"] == "failed":
                raise StepFailed(f"the dataset failed: {dataset.get('error')}")
            if time.monotonic() > deadline:
                raise StepFailed(f"still computing after {self.dataset_timeout:.0f} s")
            time.sleep(2)

    def analyze(self, dataset_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.client.request("POST", f"/factor-analysis/datasets/{dataset_id}/analyze", body=body or {})

    def computed(self, form: dict[str, str], expected_rows: int) -> str:
        dataset = self.create(form)
        n, p = dataset["n_observations"], len(dataset["measures"])
        if n != expected_rows:
            raise StepFailed(f"{n} observations, expected {expected_rows}")
        shape = f"{n} x {p}"
        # Four logs give four rows, too few to analyse a dozen measures or more.
        if n <= p:
            return f"{shape}, too few observations to analyse"
        result = self.analyze(dataset["id"])
        return f"{shape}, KMO {result['kmo']['overall']:.3f}, {result['n_factors']} factor(s)"

    # --- steps ----------------------------------------------------------------------------

    def health(self) -> str:
        status = self.client.request("GET", "/health")["status"]
        self.existing = {d["id"] for d in self.client.request("GET", "/factor-analysis/datasets")["datasets"]}
        return status + (f", {len(self.existing)} dataset(s) in the session already" if self.existing else "")

    def catalog(self) -> str:
        out = []
        for kind in ("model", "log"):
            cat = self.client.request("GET", f"/factor-analysis/catalog?kind={kind}")
            if not cat["bundled"] or not cat["samples"]:
                raise StepFailed(f"the {kind} catalog has no bundled datasets or samples")
            out.append(f"{kind}: {len(cat['measures'])} measures, {len(cat['bundled'])} bundled")
        return "; ".join(out)

    def model_from_logs(self) -> str:
        default_miners = self.client.request("GET", "/factor-analysis/catalog?kind=model")["defaults"]["miners"]
        return self.computed(
            {"kind": "model", "source": "logs", "bundled_id": "pdc-sample-logs"}, 4 * len(default_miners)
        ) + f", miners {', '.join(default_miners)}"

    def model_from_pnml(self) -> str:
        return self.computed({"kind": "model", "source": "pnml", "bundled_id": "pdc-sample-models"}, 32)

    def log_from_logs(self) -> str:
        return self.computed({"kind": "log", "source": "logs", "bundled_id": "pdc-sample-logs"}, 4)

    def paper(self) -> str:
        published = json.loads((PUBLISHED / f"{PAPER_DATASET}.json").read_text(encoding="utf-8"))
        dataset = self.create({"kind": "model", "source": "bundled", "bundled_id": PAPER_DATASET})
        self.paper_id = dataset["id"]
        self.paper_settings = dict(published["reproduce_with"])
        result = self.analyze(dataset["id"], self.paper_settings)
        for name, ours, theirs in (
            ("Bartlett", result["bartlett"]["chi_square"], published["bartlett"]["chi_square"]),
            ("KMO", result["kmo"]["overall"], published["kmo"]["overall"]),
        ):
            if abs(ours - theirs) > 1e-9 * abs(theirs):
                raise StepFailed(f"{name} {ours} differs from the published {theirs}")
        worst = max(
            abs(ours - theirs)
            for measure, row in published["loadings"].items()
            for ours, theirs in zip(result["loadings"][measure], row)
        )
        if worst > 1e-4:
            raise StepFailed(f"a loading differs by {worst:.1e} from the published one")
        # The settings of the paper as the catalog offers them: the server checks the numbers
        # against the report itself and says so in the answer.
        catalog = self.client.request("GET", "/factor-analysis/catalog?kind=model")
        entry = next((b for b in catalog["bundled"] if b["id"] == PAPER_DATASET), {})
        if not entry.get("published_options"):
            raise StepFailed("the catalog offers no published settings for the paper dataset")
        self.paper_settings = dict(entry["published_options"])
        checked = self.analyze(dataset["id"], self.paper_settings)
        match = checked.get("published_match") or {}
        if match.get("status") != "match":
            raise StepFailed(f"the server's comparison with the report: {match.get('status')} {match.get('differences')}")
        counts = checked["factor_count"]
        return (
            f"KMO {result['kmo']['overall']:.6f} and all loadings as published (largest difference {worst:.1e}); "
            f"server: {match['status']} on {', '.join(match['compared'])}; "
            f"Kaiser {counts['kaiser']}, parallel analysis {counts['parallel_analysis']}"
        )

    def reuse(self) -> str:
        again = self.client.request(
            "POST", "/factor-analysis/datasets", form={"kind": "model", "source": "bundled", "bundled_id": PAPER_DATASET}
        )
        if again["dataset_id"] != self.paper_id or not again.get("reused"):
            self.created.append(again["dataset_id"])
            raise StepFailed(f"a new copy {again['dataset_id']} instead of the session's {self.paper_id}")
        return "the session's copy came back"

    def exports(self) -> str:
        base = f"/factor-analysis/datasets/{self.paper_id}"
        archive = self.client.request("POST", f"{base}/export/zip", body=self.paper_settings, raw=True)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            names = set(z.namelist())
            manifest = json.loads(z.read("manifest.json"))
        missing = {"manifest.json", "README.txt", "analysis.json", "dataset.csv", "loadings.tex"} - names
        if missing:
            raise StepFailed(f"the ZIP lacks {', '.join(sorted(missing))}")
        latex = self.client.request("POST", f"{base}/export", body={**self.paper_settings, "format": "latex"}, raw=True)
        if b"\\begin{tabular}" not in latex:
            raise StepFailed("the LaTeX export has no tabular")
        rule = manifest["analysis"].get("assignment_rule")
        match = ((manifest.get("published") or {}).get("match") or {}).get("status")
        if rule != self.paper_settings.get("assignment_rule") or match != "match":
            raise StepFailed(f"the manifest names the rule {rule} and the match {match}")
        tool = manifest.get("tool") or {}
        return (
            f"ZIP with {len(names)} files ({len(archive) // 1024} kB, tool {tool.get('version') or 'version not recorded'}), "
            f"LaTeX {len(latex)} bytes, rule {rule}, report {match}"
        )

    def cleanup(self) -> str:
        for dataset_id in self.created:
            try:
                self.client.request("DELETE", f"/factor-analysis/datasets/{dataset_id}")
            except StepFailed as e:
                # Gone already is fine; anything else is reported.
                if "HTTP 404" not in str(e):
                    raise
        left = [
            d["id"] for d in self.client.request("GET", "/factor-analysis/datasets")["datasets"]
            if d["id"] not in self.existing
        ]
        if left:
            raise StepFailed(f"{len(left)} dataset(s) left in the session")
        return f"deleted {len(self.created)} dataset(s) with their runs"

    def run(self, prom: bool = True) -> bool:
        if not self.step("health", self.health):
            return False
        self.step("catalog", self.catalog)
        if prom:
            self.step("4 sample logs x default miner (ProM)", self.model_from_logs)
        self.step("sample Petri nets", self.model_from_pnml)
        self.step("sample logs with feeed", self.log_from_logs)
        if self.step("paper dataset as published", self.paper):
            self.step("reuse of the paper dataset", self.reuse)
            self.step("ZIP and LaTeX export", self.exports)
        self.step("cleanup", self.cleanup)
        return all(ok for _, _, ok, _ in self.rows)

    def table(self) -> str:
        width = max(len(name) for name, *_ in self.rows)
        lines = [f"{'step':<{width}}  {'seconds':>8}  result", "-" * (width + 20)]
        lines += [f"{name:<{width}}  {seconds:8.1f}  {'ok' if ok else 'FAILED'}" for name, seconds, ok, _ in self.rows]
        lines.append(f"{'total':<{width}}  {sum(r[1] for r in self.rows):8.1f}")
        return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:3000", help="the frontend; the API is <base-url>/api")
    parser.add_argument("--api-url", help="the backend itself, instead of <base-url>/api")
    parser.add_argument(
        "--port-file", type=Path,
        help="the file the desktop app wrote its port to (--port-file there); the base URL is then http://127.0.0.1:<port>",
    )
    parser.add_argument(
        "--token-file", type=Path,
        help="the file the desktop app wrote its access token to (--token-file there); sent as a bearer token",
    )
    parser.add_argument("--no-prom", action="store_true", help="skip the step that needs ProM (no ProM in the stack)")
    parser.add_argument("--dataset-timeout", type=float, default=900, help="seconds a dataset may take (default 900)")
    parser.add_argument("--request-timeout", type=float, default=300, help="seconds per request (default 300)")
    args = parser.parse_args()

    base_url = args.base_url
    if args.port_file:
        base_url = f"http://127.0.0.1:{int(args.port_file.read_text(encoding='utf-8').strip())}"
    token = args.token_file.read_text(encoding="utf-8").strip() if args.token_file else None
    api = args.api_url or base_url.rstrip("/") + "/api"
    smoke = Smoke(Client(api, args.request_timeout, token), args.dataset_timeout)
    print(f"Smoke test of {api}" + (" without the ProM step" if args.no_prom else ""), flush=True)
    passed = smoke.run(prom=not args.no_prom)
    print()
    print(smoke.table())
    print("\nPASSED" if passed else "\nFAILED")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
