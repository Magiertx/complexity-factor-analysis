"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink, Code2, FileJson, Terminal } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { PageHeader } from "./page-header";

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
`;

interface Endpoint {
  method: "GET" | "POST" | "DELETE";
  path: string;
  description: string;
}

const ENDPOINTS: { group: string; items: Endpoint[] }[] = [
  {
    group: "Catalog",
    items: [
      { method: "GET", path: "/algorithms", description: "List every registered algorithm and its parameter schema." },
      { method: "GET", path: "/sample-logs", description: "Built-in event logs you can analyse without uploading." },
      { method: "GET", path: "/recent-logs", description: "Logs your session has uploaded recently." },
    ],
  },
  {
    group: "Run jobs",
    items: [
      { method: "POST", path: "/algorithms/{id}/analyze", description: "Submit one log to one algorithm. Returns a job_id." },
      { method: "POST", path: "/log-stats", description: "Cheap descriptive statistics of a log (traces, events, variants, time range)." },
    ],
  },
  {
    group: "Factor analysis",
    items: [
      { method: "GET", path: "/factor-analysis/catalog?kind=model|log", description: "Measures, miners or feature groups, bundled datasets, sample inputs and the accepted sources." },
      { method: "POST", path: "/factor-analysis/datasets", description: "Create a dataset from a bundled one, a CSV, event logs or PNML files (multipart). Logs and PNML run as a job." },
      { method: "GET", path: "/factor-analysis/datasets/{id}", description: "Status, progress and the cleaned measure matrix (first 2000 rows)." },
      { method: "GET", path: "/factor-analysis/datasets/{id}/download", description: "The cleaned matrix as CSV." },
      { method: "POST", path: "/factor-analysis/datasets/{id}/analyze", description: "Bartlett, KMO/MSA, eigenvalues and rotated loadings for the given settings (JSON)." },
      { method: "POST", path: "/factor-analysis/datasets/{id}/export", description: "The loadings table as CSV or LaTeX; same body as analyze plus format." },
      { method: "GET", path: "/factor-analysis/interpretation/status", description: "Whether factors can be interpreted by Claude, and with which model." },
      { method: "POST", path: "/factor-analysis/datasets/{id}/interpret", description: "Names and short interpretations of the factors by Claude; same body as analyze plus language. Optional, needs an API key on the server." },
    ],
  },
  {
    group: "Job lifecycle",
    items: [
      { method: "GET", path: "/jobs", description: "All jobs visible to your session." },
      { method: "GET", path: "/jobs/{job_id}", description: "Current status, progress, and (once finished) the full result." },
      { method: "GET", path: "/jobs/{job_id}/download", description: "ZIP archive of every artifact the job produced." },
      { method: "GET", path: "/jobs/events", description: "Server-Sent Events stream that pings whenever job state changes." },
      { method: "GET", path: "/progress/{task_id}", description: "Lower-level SSE stream for a single task." },
      { method: "POST", path: "/progress/{task_id}/abort", description: "Request cooperative cancellation of a running task." },
      { method: "DELETE", path: "/jobs/{job_id}", description: "Delete one job and its artifacts." },
      { method: "DELETE", path: "/jobs", description: "Delete every job visible to your session." },
    ],
  },
  {
    group: "Diagnostics",
    items: [
      { method: "GET", path: "/health", description: "Readiness probe — returns 200 when the database is reachable." },
    ],
  },
];

export function ApiAccessView() {
  const t = useT();
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
          <CodeBlock label="Python (requests)" icon={<Terminal className="h-3.5 w-3.5" />} code={PYTHON_EXAMPLE} />
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
              <div className="text-xs font-medium text-muted">
                {g.group}
              </div>
              <ul className="rounded-md bg-tile/40 overflow-hidden">
                {g.items.map((e) => (
                  <li
                    key={`${e.method} ${e.path}`}
                    className="flex items-start gap-3 px-3 py-2 text-sm border-b border-border last:border-0 bg-tile/30"
                  >
                    <MethodBadge method={e.method} />
                    <code className="font-mono text-[12px] text-fg whitespace-nowrap shrink-0">{e.path}</code>
                    <span className="text-[12px] text-muted leading-snug">{e.description}</span>
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
        <CardContent className="space-y-2 text-sm text-muted">
          <p>
            • Rate limits (per IP): <code className="font-mono text-[11px]">60/hour</code> on{" "}
            <code className="font-mono text-[11px]">/algorithms/&#123;id&#125;/analyze</code>,{" "}
            <code className="font-mono text-[11px]">60/hour</code> on{" "}
            <code className="font-mono text-[11px]">POST /factor-analysis/datasets</code>,{" "}
            <code className="font-mono text-[11px]">600/minute</code> on{" "}
            <code className="font-mono text-[11px]">GET /factor-analysis/datasets/&#123;id&#125;</code>,{" "}
            <code className="font-mono text-[11px]">300/hour</code> on{" "}
            <code className="font-mono text-[11px]">/log-stats</code>; 120/minute everywhere else. Interpretations
            that call Claude: 10/hour per session and 200/day for the server.
          </p>
          <p>
            • Upload limit: 100 MB per file. Allowed extensions:{" "}
            <code className="font-mono text-[11px]">.xes</code>,{" "}
            <code className="font-mono text-[11px]">.xes.gz</code>,{" "}
            <code className="font-mono text-[11px]">.xml</code>,{" "}
            <code className="font-mono text-[11px]">.json</code>.
          </p>
          <p>
            • Session: a signed cookie scopes every endpoint. Reuse the same cookie across requests
            (Python&apos;s <code className="font-mono text-[11px]">requests.Session()</code>) to keep job history visible.
          </p>
          <p>
            • Parameter schemas come from{" "}
            <code className="font-mono text-[11px]">/algorithms</code> — read{" "}
            <code className="font-mono text-[11px]">parameters_schema</code> for each algorithm before submitting.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" | "DELETE" }) {
  const styles = {
    GET: "bg-success/15 text-success-ink",
    POST: "bg-accent/15 text-accent-ink",
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
