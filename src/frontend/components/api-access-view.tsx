"use client";

import { useEffect, useState } from "react";
import { Copy, Check, ExternalLink, Code2, FileJson, Terminal } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { PageHeader } from "./page-header";
import { DEFAULT_UPLOAD_LIMITS, fetchUploadLimits, type UploadLimits } from "@/lib/api";

const linkButtonClass =
  "inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-tile hover:bg-accent/[0.08] text-fg text-sm font-medium transition";

const PYTHON_EXAMPLE = `import time
import requests

BASE = "http://localhost:3000/api"  # change to your deployment URL

# 1. Discover available algorithms (and the parameters each one accepts)
algorithms = requests.get(f"{BASE}/algorithms").json()
print([a["id"] for a in algorithms["algorithms"]])

# 2. Submit a log for analysis
with open("event_log.xes", "rb") as f:
    submit = requests.post(
        f"{BASE}/algorithms/comfy/analyze",
        files={"file": f},
        data={
            "discovery_algorithms": ["Inductive miner"],
            "complexity_measures": ["Size", "Density"],
        },
    )
submit.raise_for_status()
job_id = submit.json()["job_id"]

# 3. Poll until the job finishes
while True:
    job = requests.get(f"{BASE}/jobs/{job_id}").json()
    if job["status"] in ("completed", "failed", "aborted"):
        break
    print(f"{job['percentage']:.0f}% — {job['progress_status']}")
    time.sleep(1.5)

# 4. Read the result
if job["status"] == "completed":
    for art in job["result"]["artifacts"]:
        print(art["kind"], art["label"])
else:
    print("Job failed:", job.get("error"))
`;

const FACTOR_EXAMPLE = `import requests

BASE = "http://localhost:3000/api"  # change to your deployment URL
s = requests.Session()  # datasets belong to the session of the cookie

# 1. A dataset: a bundled one here; a CSV, event logs or PNML files work as well
ds = s.post(
    f"{BASE}/factor-analysis/datasets",
    data={"kind": "model", "source": "bundled", "bundled_id": "comfy-paper-inductive-miner"},
).json()

# 2. Suitability, eigenvalues and rotated loadings, here with the settings of the paper
catalog = s.get(f"{BASE}/factor-analysis/catalog", params={"kind": "model"}).json()
paper = next(b for b in catalog["bundled"] if b["id"] == "comfy-paper-inductive-miner")
options = paper["published_options"]  # 4 factors, varimax, assignment_rule "multi", ...
result = s.post(f"{BASE}/factor-analysis/datasets/{ds['dataset_id']}/analyze", json=options).json()
print("KMO", round(result["kmo"]["overall"], 2))
print("Kaiser", result["factor_count"]["kaiser"], "parallel analysis", result["factor_count"]["parallel_analysis"])
print("Same numbers as the report:", (result["published_match"] or {}).get("status"))
for factor in result["factors"]:
    print(factor["index"] + 1, [m["measure"] for m in factor["measures"]])

# 3. For a paper: the LaTeX report like ComFy's, and the loadings heatmap with the short codes
url = f"{BASE}/factor-analysis/datasets/{ds['dataset_id']}/export"
with open("report.tex", "wb") as f:
    f.write(s.post(f"{url}/report", json={**options, "short_codes": True}).content)
figure = {**options, "figure": "loadings", "format": "svg", "short_codes": True}
with open("loadings.svg", "wb") as f:
    f.write(s.post(f"{url}/figure", json=figure).content)

# Names of the factors head them in every download; the analysis does not change with them
named = {**options, "factor_names": ["Size", "Connectors", None, "Separability"], "format": "latex"}
with open("loadings.tex", "wb") as f:
    f.write(s.post(url, json=named).content)

# 4. Tab. 17: the four miners side by side under Hair et al., and the table for LaTeX
miners = ["alpha", "directly-follows", "inductive", "hybrid-ilp"]
body = {"columns": [{"bundled_id": f"comfy-paper-{m}-miner"} for m in miners], "assignment_rule": "hair"}
compared = s.post(f"{BASE}/factor-analysis/compare", json=body).json()
for i, column in enumerate(compared["columns"]):
    print(column["label"], [[m["measure"] for m in d["columns"][i]["measures"]] for d in compared["dimensions"]])
with open("factor-structures.tex", "wb") as f:
    f.write(s.post(f"{BASE}/factor-analysis/compare/export", json={**body, "format": "latex"}).content)

# 5. In how many datasets two measures share a dimension, whatever the numbering of the dimensions
pairs = compared["co_assignment"]
ts, cfc = (pairs["measures"].index(m) for m in ("Token split", "Control flow complexity"))
print("ts and CFC:", pairs["together"][ts][cfc], "of", pairs["both_analysed"][ts][cfc])

# 6. Section 6: the same dataset with 4 and with 6 factors; a column may change its settings
six = {
    "columns": [
        {"bundled_id": "comfy-paper-inductive-miner"},
        {"bundled_id": "comfy-paper-inductive-miner", "options": {"n_factors": 6}, "label": "k = 6"},
    ],
    "assignment_rule": "multi",
}
print([c["n_factors"] for c in s.post(f"{BASE}/factor-analysis/compare", json=six).json()["columns"]])

# 7. Your own nets of several miners (rows "<log> / <miner>"): one miner at a time, and side by side
own = "<dataset_id>"  # a model dataset computed from event logs with several miners
for m in s.get(f"{BASE}/factor-analysis/datasets/{own}").json()["miners"] or []:
    alone = s.post(f"{BASE}/factor-analysis/datasets/{own}/analyze", json={"miner": m["name"]}).json()
    print(m["name"], alone["n_observations"], "observations, KMO", round(alone["kmo"]["overall"], 2))
per_miner = {"columns": [{"dataset_id": own, "miner": m["name"]} for m in
                         s.get(f"{BASE}/factor-analysis/datasets/{own}").json()["miners"] or []]}

# 8. The correlations of the measures: clustered, with the pairs that say almost the same
corr = s.post(f"{BASE}/factor-analysis/datasets/{ds['dataset_id']}/correlations", json={"order": "cluster"}).json()
print(corr["high"]["count"], "pairs with |r| >= 0.95; closest to Size:", corr["top"]["Size"][0])
# ... and as a figure for a paper, in the order of the dimensions
figure = {**options, "figure": "correlations", "format": "svg", "correlation_order": "factor"}
with open("correlations.svg", "wb") as f:
    f.write(s.post(f"{url}/figure", json=figure).content)
`;

const CURL_EXAMPLE = `# List algorithms
curl http://localhost:3000/api/algorithms

# Submit a log for analysis
curl -X POST \\
  -F "file=@event_log.xes" \\
  -F "discovery_algorithms=Inductive miner" \\
  -F "complexity_measures=Size" \\
  http://localhost:3000/api/algorithms/comfy/analyze

# Poll a job
curl http://localhost:3000/api/jobs/<job_id>

# Download the full result ZIP
curl -OJ http://localhost:3000/api/jobs/<job_id>/download

# Factor analysis of a bundled dataset; keep the session cookie
curl -c cookies.txt -b cookies.txt -X POST \\
  -F kind=model -F source=bundled -F bundled_id=comfy-paper-inductive-miner \\
  http://localhost:3000/api/factor-analysis/datasets
curl -c cookies.txt -b cookies.txt -X POST \\
  -H "Content-Type: application/json" -d '{"n_factors": 4}' \\
  http://localhost:3000/api/factor-analysis/datasets/<dataset_id>/analyze
`;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** `key` names the description in api_access.endpoints. */
interface Endpoint {
  method: Method;
  path: string;
  key: string;
}

// The same list as the endpoint tables of docs/API.md; `group` names the heading in api_access.groups.
const ENDPOINTS: { group: string; items: Endpoint[] }[] = [
  {
    group: "catalog",
    items: [
      { method: "GET", path: "/algorithms", key: "algorithms" },
      { method: "GET", path: "/sample-logs", key: "sample_logs" },
      { method: "GET", path: "/recent-logs", key: "recent_logs" },
    ],
  },
  {
    group: "single_log",
    items: [
      { method: "POST", path: "/algorithms/{id}/analyze", key: "analyze" },
      { method: "POST", path: "/log-stats", key: "log_stats" },
    ],
  },
  {
    group: "factor_analysis",
    items: [
      { method: "GET", path: "/factor-analysis/catalog?kind=model|log", key: "fa_catalog" },
      { method: "GET", path: "/factor-analysis/limits", key: "fa_limits" },
      { method: "POST", path: "/factor-analysis/datasets", key: "fa_create" },
      { method: "GET", path: "/factor-analysis/datasets?kind=model|log", key: "fa_list" },
      { method: "GET", path: "/factor-analysis/datasets/{id}", key: "fa_get" },
      { method: "PUT", path: "/factor-analysis/datasets/{id}/options", key: "fa_options" },
      { method: "DELETE", path: "/factor-analysis/datasets/{id}", key: "fa_delete" },
      { method: "DELETE", path: "/factor-analysis/datasets?kind=model|log", key: "fa_delete_all" },
      { method: "GET", path: "/factor-analysis/datasets/{id}/download", key: "fa_download" },
      { method: "POST", path: "/factor-analysis/datasets/{id}/analyze", key: "fa_analyze" },
      { method: "POST", path: "/factor-analysis/datasets/{id}/correlations", key: "fa_correlations" },
      { method: "POST", path: "/factor-analysis/datasets/{id}/export", key: "fa_export" },
      { method: "POST", path: "/factor-analysis/datasets/{id}/export/report", key: "fa_export_report" },
      { method: "POST", path: "/factor-analysis/datasets/{id}/export/figure", key: "fa_export_figure" },
      { method: "POST", path: "/factor-analysis/datasets/{id}/export/zip", key: "fa_export_zip" },
      { method: "POST", path: "/factor-analysis/compare", key: "fa_compare" },
      { method: "POST", path: "/factor-analysis/compare/export", key: "fa_compare_export" },
      { method: "GET", path: "/factor-analysis/interpretation/status", key: "fa_interpretation_status" },
      { method: "POST", path: "/factor-analysis/datasets/{id}/interpret", key: "fa_interpret" },
    ],
  },
  {
    group: "runs",
    items: [
      { method: "GET", path: "/jobs", key: "jobs" },
      { method: "GET", path: "/jobs/{job_id}", key: "job" },
      { method: "GET", path: "/jobs/{job_id}/download", key: "job_download" },
      { method: "GET", path: "/jobs/events", key: "job_events" },
      { method: "GET", path: "/progress/{task_id}", key: "progress" },
      { method: "POST", path: "/progress/{task_id}/abort", key: "abort" },
      { method: "PATCH", path: "/jobs/{job_id}/notes", key: "job_notes" },
      { method: "DELETE", path: "/jobs/{job_id}", key: "job_delete" },
      { method: "DELETE", path: "/jobs", key: "jobs_delete" },
    ],
  },
  {
    group: "diagnostics",
    items: [
      { method: "GET", path: "/health", key: "health" },
      { method: "GET", path: "/session", key: "session_start" },
    ],
  },
];

const NOTES = ["rate_limits", "quota", "uploads", "analysis", "session", "schemas"];

/** A text of the locale files in which `backticks` mark code. */
function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} className="font-mono text-[11px] text-fg">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function ApiAccessView() {
  const t = useT();
  // The numbers of files are set by the operator of the server; the defaults stand in until
  // it has answered, or if it does not.
  const [limits, setLimits] = useState<UploadLimits>(DEFAULT_UPLOAD_LIMITS);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchUploadLimits(ctrl.signal)
      .then(setLimits)
      .catch(() => {
        // The note keeps the defaults.
      });
    return () => ctrl.abort();
  }, []);
  const noteValues = {
    file_mb: limits.max_file_bytes / (1024 * 1024),
    logs: limits.max_log_files,
    pnml: limits.max_pnml_files,
    total_mb: limits.max_total_bytes / (1024 * 1024),
  };
  return (
    // Code and endpoint rows read badly across the whole width.
    <div className="space-y-6 max-w-5xl">
      <PageHeader title={t("api_access.heading")} subtitle={t("api_access.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("api_access.interactive_ref_title")}</CardTitle>
          <CardDescription>{t("api_access.interactive_ref_desc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <a href="/api/docs" target="_blank" rel="noreferrer" className={linkButtonClass}>
            <Code2 className="h-3.5 w-3.5" />
            Swagger UI
            <ExternalLink className="h-3 w-3 opacity-70" />
          </a>
          <a href="/api/redoc" target="_blank" rel="noreferrer" className={linkButtonClass}>
            <Code2 className="h-3.5 w-3.5" />
            ReDoc
            <ExternalLink className="h-3 w-3 opacity-70" />
          </a>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer" className={linkButtonClass}>
            <FileJson className="h-3.5 w-3.5" />
            openapi.json
            <ExternalLink className="h-3 w-3 opacity-70" />
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("api_access.quick_start_title")}</CardTitle>
          <CardDescription>{t("api_access.quick_start_desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CodeBlock
            label={t("api_access.example_single_log")}
            icon={<Terminal className="h-3.5 w-3.5" />}
            code={PYTHON_EXAMPLE}
          />
          <CodeBlock
            label={t("api_access.example_factor_analysis")}
            icon={<Terminal className="h-3.5 w-3.5" />}
            code={FACTOR_EXAMPLE}
          />
          <CodeBlock label="curl" icon={<Terminal className="h-3.5 w-3.5" />} code={CURL_EXAMPLE} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("api_access.endpoint_summary_title")}</CardTitle>
          <CardDescription>
            {t("api_access.endpoint_summary_desc", { base: "/api" })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {ENDPOINTS.map((g) => (
            <div key={g.group} className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted">{t(`api_access.groups.${g.group}`)}</h3>
              <ul className="rounded-md bg-tile/40 overflow-hidden">
                {g.items.map((e) => (
                  // On a phone the description goes below the path, which may break anywhere.
                  <li
                    key={`${e.method} ${e.path}`}
                    className="grid grid-cols-[3.5rem_minmax(0,1fr)] md:grid-cols-[3.5rem_minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 items-start px-3 py-2 border-b border-border last:border-0"
                  >
                    <MethodBadge method={e.method} />
                    <code className="font-mono text-[12px] text-fg break-all md:break-normal md:whitespace-nowrap">{e.path}</code>
                    <span className="col-start-2 md:col-start-auto text-[12px] text-muted leading-snug">
                      <WithCode text={t(`api_access.endpoints.${e.key}`)} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("api_access.notes_title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 space-y-2 text-sm text-muted">
            {NOTES.map((key) => (
              <li key={key}>
                <WithCode text={t(`api_access.notes.${key}`, noteValues)} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function MethodBadge({ method }: { method: Method }) {
  const styles = {
    GET: "bg-success/15 text-success-ink",
    POST: "bg-accent/15 text-accent-ink",
    PUT: "bg-warn/15 text-warn-ink",
    PATCH: "bg-warn/15 text-warn-ink",
    DELETE: "bg-danger/15 text-danger-ink",
  }[method];
  return (
    <span
      className={cn(
        "shrink-0 w-14 text-center font-mono text-[10px] font-semibold rounded px-1 py-0.5",
        styles,
      )}
    >
      {method}
    </span>
  );
}

function CodeBlock({ label, icon, code }: { label: string; icon: React.ReactNode; code: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="rounded-md bg-tile/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-tile/40">
        <div className="text-[11px] font-medium text-muted flex items-center gap-1.5">
          {icon}
          {label}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="h-7 px-2.5 rounded bg-tile hover:bg-accent/[0.08] text-fg text-[11px] transition flex items-center gap-1.5"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? t("api_access.copied") : t("api_access.copy")}
        </button>
      </div>
      <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto bg-bg/60 font-mono text-fg whitespace-pre">
        {code}
      </pre>
    </div>
  );
}
