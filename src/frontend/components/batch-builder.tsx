"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  X,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileCheck2,
  Clock,
  Sparkles,
  Download,
  BarChart3,
  HelpCircle,
} from "lucide-react";
import { BatchTour } from "./batch-tour";
import { AlgorithmExplainerModal } from "./algorithm-explainer-modal";
import { Button } from "./ui/button";
import { Select } from "./ui/input";
import {
  fetchAlgorithms,
  fetchJobDetail,
  fetchSampleLogs,
  fetchRecentLogs,
  runBatch,
  type AlgorithmManifest,
  type Job,
  type Artifact,
  type SampleLog,
  type RecentLog,
  ValidationError,
  API_BASE,
} from "@/lib/api";
import { ParameterForm } from "./parameter-form";
import { PresetBar } from "./preset-bar";
import { StatRow } from "./artifacts/stat-row";
import { TableView } from "./artifacts/table-view";
import { ImageView } from "./artifacts/image-view";
import { LogDownload } from "./artifacts/log-download";
import { TextView } from "./artifacts/text-view";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { UploadZone } from "./upload-zone";

const MAX_LOGS = 10;

export function BatchBuilder() {
  const t = useT();
  const [algorithms, setAlgorithms] = useState<AlgorithmManifest[]>([]);
  const [algorithmId, setAlgorithmId] = useState<string>("");
  const [tourOpen, setTourOpen] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});

  const [sampleLogs, setSampleLogs] = useState<SampleLog[]>([]);
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);

  const [files, setFiles] = useState<File[]>([]);
  const [sampleIds, setSampleIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);


  useEffect(() => {
    fetchAlgorithms()
      .then((res) => setAlgorithms(res.algorithms))
      .catch((e: Error) => setError(e.message));
    fetchSampleLogs().then(setSampleLogs).catch(() => {});
    fetchRecentLogs().then(setRecentLogs).catch(() => {});
  }, []);

  // Deep-link support: `/batch?job=<id>` opens the past batch run. Depends on
  // searchParams so it also fires on client-side navigation, e.g. clicking a
  // job in the drawer while already on this page.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const jobParam = searchParams.get("job");
    if (jobParam) setJobId(jobParam);
  }, [searchParams]);

  // Strip a stale ?job= when leaving the job view; otherwise re-clicking the
  // same job in the drawer is a same-URL navigation and never re-opens it.
  const clearJobParam = useCallback(() => {
    if (searchParams.get("job")) router.replace("/batch", { scroll: false });
  }, [searchParams, router]);

  // Watch status while a batch is running. Same SSE + slow-polling fallback
  // shape as the Workbench so both behave identically and stop hammering the
  // backend at 1.5s.
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let eventSource: EventSource | null = null;

    const refresh = async () => {
      try {
        const detail = await fetchJobDetail(jobId);
        if (!active) return null;
        setJob(detail);
        return detail.status;
      } catch {
        return null;
      }
    };

    const isTerminal = (status: string | null | undefined) =>
      status === "completed" || status === "failed" || status === "aborted";

    const scheduleFallback = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!active) return;
        const status = await refresh();
        if (!isTerminal(status) && active) scheduleFallback();
      }, 5000);
    };

    (async () => {
      const status = await refresh();
      if (!active || isTerminal(status)) return;

      const sseUrl = process.env.NEXT_PUBLIC_SSE_URL || "/api/jobs/events";
      try {
        eventSource = new EventSource(sseUrl);
        eventSource.onmessage = async (event) => {
          if (event.data === "update" || event.data === "initial") {
            const s = await refresh();
            if (isTerminal(s) && eventSource) {
              eventSource.close();
              eventSource = null;
              if (timer) {
                clearTimeout(timer);
                timer = null;
              }
            }
          }
        };
        eventSource.onerror = () => {
          /* automatic retry; fallback poll catches it if SSE never recovers */
        };
      } catch {
        /* SSE not supported, poll only */
      }

      scheduleFallback();
    })();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (eventSource) eventSource.close();
    };
  }, [jobId]);

  const algorithm = useMemo(
    () => algorithms.find((a) => a.id === algorithmId) ?? null,
    [algorithms, algorithmId],
  );

  // When the algorithm changes, hydrate parameters from the same per-algorithm
  // cache the Workbench uses (`algo-params-<id>`) so a user that just ran an
  // algorithm in /workbench sees their last params here too. Fall back to
  // schema defaults if no cached entry exists.
  useEffect(() => {
    if (!algorithm) {
      setParams({});
      setParamErrors({});
      return;
    }
    setParamErrors({});
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`algo-params-${algorithm.id}`);
      if (saved) {
        try {
          setParams(JSON.parse(saved));
          return;
        } catch {
          /* fall through to defaults */
        }
      }
    }
    const defaults: Record<string, unknown> = {};
    for (const p of algorithm.parameters_schema) defaults[p.name] = p.default;
    setParams(defaults);
  }, [algorithm]);

  const totalSelected = files.length + sampleIds.length + recentIds.length;

  const remainingCapacity = Math.max(0, MAX_LOGS - totalSelected);

  const validationProblems = useMemo(() => {
    const issues: string[] = [];
    if (!algorithmId) issues.push(t("builders.batch.validation_pick_algo"));
    if (totalSelected < 1) issues.push(t("builders.batch.validation_select_log"));
    if (totalSelected > MAX_LOGS) issues.push(t("builders.batch.validation_max_logs", { max: MAX_LOGS }));
    return issues;
  }, [algorithmId, totalSelected, t]);

  const canSubmit = validationProblems.length === 0 && !submitting;

  const handleFilesAdded = (incoming: FileList | File[]) => {
    const list = Array.from(incoming).filter((f) => f && f.size > 0);
    if (list.length === 0) return;
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of list) {
        if (merged.some((e) => e.name === f.name && e.size === f.size)) continue;
        if (merged.length + totalSelected - prev.length >= MAX_LOGS) break;
        merged.push(f);
      }
      return merged;
    });
    setError(null);
  };

  const toggleId = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setter((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (totalSelected >= MAX_LOGS) return prev;
      return [...prev, id];
    });
    setError(null);
  };

  const reset = () => {
    setJobId(null);
    setJob(null);
    setError(null);
    clearJobParam();
  };

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await runBatch(
        algorithmId,
        params,
        files,
        sampleIds,
        recentIds,
      );
      setJobId(res.job_id);
      setJob(null);
      // Keep the URL in sync so the drawer highlights the running job.
      router.replace(`/batch?job=${res.job_id}`, { scroll: false });
    } catch (e) {
      if (e instanceof ValidationError) {
        setParamErrors(e.errors);
        setError(e.message);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(t("builders.batch.submission_failed"));
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, algorithmId, params, files, sampleIds, recentIds, router, t]);

  // Ctrl/Cmd+Enter triggers submit while configuring a new batch.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      if (job || !canSubmit) return;
      e.preventDefault();
      void submit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [submit, canSubmit, job]);

  const runBatchLabel = (() => {
    if (submitting) return t("builders.batch.submitting");
    if (totalSelected === 0) return t("builders.batch.run_button");
    if (totalSelected === 1) return t("builders.batch.run_button_n", { n: totalSelected });
    return t("builders.batch.run_button_n_plural", { n: totalSelected });
  })();

  return (
    <div className="space-y-6">
      <BatchTour run={tourOpen} onClose={() => setTourOpen(false)} />
      <AlgorithmExplainerModal
        algo={explainerOpen ? algorithm ?? null : null}
        onClose={() => setExplainerOpen(false)}
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("builders.batch.heading")}</h1>
          <p className="text-xs text-muted mt-0.5">
            {t("builders.batch.subtitle", { max: MAX_LOGS })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTourOpen(true)}
          className="shrink-0 h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-border hover:bg-tile text-xs text-muted hover:text-fg transition appearance-none"
          title={t("builders.batch.tour_title")}
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span>{t("builders.batch.tour_button")}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!jobId && (
        <>
          {/* Algorithm + Params */}
          <section className="bg-surface rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-xs uppercase tracking-wide text-muted font-medium">
                {t("builders.batch.algorithm_heading")}
              </h2>
              <div className="flex items-center gap-2">
                <Select
                  value={algorithmId}
                  onChange={(e) => setAlgorithmId(e.target.value)}
                  className="min-w-[260px] w-auto"
                  data-tour="batch-algo"
                >
                  <option value="">{t("builders.batch.pick_algorithm")}</option>
                  {algorithms.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name.split(" — ")[0]} ({a.tool_type})
                    </option>
                  ))}
                </Select>
                {algorithm && (
                  <button
                    type="button"
                    onClick={() => setExplainerOpen(true)}
                    className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-accent hover:bg-tile transition appearance-none"
                    aria-label={`Explain ${algorithm.name.split(" — ")[0]}`}
                    title={t("builders.batch.algo_explain_title")}
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {algorithm && algorithm.parameters_schema.length > 0 && (
              <div className="pt-2 border-t border-border/40 space-y-3" data-tour="batch-params">
                <PresetBar
                  algorithmId={algorithm.id}
                  currentParams={params}
                  defaults={Object.fromEntries(
                    algorithm.parameters_schema.map((p) => [p.name, p.default]),
                  )}
                  onLoad={(loaded) => {
                    setParams(loaded);
                    try {
                      localStorage.setItem(`algo-params-${algorithm.id}`, JSON.stringify(loaded));
                    } catch {
                      /* ignore quota */
                    }
                  }}
                />
                <ParameterForm
                  schema={algorithm.parameters_schema}
                  algorithmId={algorithm.id}
                  values={params}
                  onChange={(name, value) =>
                    setParams((prev) => {
                      const next = { ...prev, [name]: value };
                      try {
                        localStorage.setItem(`algo-params-${algorithm.id}`, JSON.stringify(next));
                      } catch {
                        /* ignore quota */
                      }
                      return next;
                    })
                  }
                  errors={paramErrors}
                />
              </div>
            )}
          </section>

          {/* Log sources */}
          <section className="bg-surface rounded-lg p-4 space-y-4" data-tour="batch-logs">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-wide text-muted font-medium">
                {t("builders.batch.logs_heading")}
                <span className="ml-1.5 text-[10px] font-mono text-muted/60 normal-case">
                  ({t("builders.batch.logs_selected", { selected: totalSelected, max: MAX_LOGS })})
                </span>
              </h2>
            </div>

            {/* Uploaded files */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted/80">
                {t("builders.batch.upload_label")}
              </div>
              <UploadZone
                multiple
                accept=".xes,.xes.gz,.xml,.json"
                label={t("builders.batch.drop_label")}
                hint={t("builders.batch.drop_hint_remaining", { remaining: remainingCapacity })}
                onFiles={handleFilesAdded}
              />
              {files.length > 0 && (
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="bg-tile rounded-md px-2.5 py-2 flex items-center gap-2 text-[11px]"
                    >
                      <FileCheck2 className="h-3.5 w-3.5 text-success shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-fg" title={f.name}>
                          {f.name}
                        </div>
                        <div className="text-[9px] text-muted/60">
                          {(f.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setFiles((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        className="h-5 w-5 grid place-items-center rounded hover:bg-danger/10 text-muted hover:text-danger transition"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <LogSourceGroup
              title={t("builders.batch.sample_logs_group")}
              icon={<Sparkles className="h-3 w-3 text-muted/70" />}
              items={sampleLogs.map((s) => ({
                id: s.id,
                primary: s.name,
                secondary: s.description,
                meta: `${(s.size_bytes / 1024).toFixed(1)} KB`,
              }))}
              selectedIds={sampleIds}
              onToggle={(id) => toggleId(id, setSampleIds)}
              capacity={remainingCapacity}
            />

            <LogSourceGroup
              title={t("builders.batch.recently_uploaded_group")}
              icon={<Clock className="h-3 w-3 text-muted/70" />}
              items={recentLogs.map((r) => ({
                id: r.id,
                primary: r.name,
                meta: `${(r.size_bytes / 1024).toFixed(1)} KB`,
              }))}
              selectedIds={recentIds}
              onToggle={(id) => toggleId(id, setRecentIds)}
              capacity={remainingCapacity}
            />
          </section>

          {/* Submit */}
          <section className="bg-surface rounded-lg p-4 space-y-3" data-tour="batch-run">
            {validationProblems.length > 0 && (
              <ul className="text-[11px] text-muted space-y-1">
                {validationProblems.map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertCircle className="h-3 w-3 shrink-0 mt-0.5 text-warn" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              title={t("builders.batch.run_title")}
              size="lg"
              className="w-full"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {runBatchLabel}
            </Button>
          </section>
        </>
      )}

      {jobId && <BatchRunStatus job={job} jobId={jobId} onReset={reset} />}
    </div>
  );
}

interface LogItem {
  id: string;
  primary: string;
  secondary?: string;
  meta?: string;
}

function LogSourceGroup({
  title,
  icon,
  items,
  selectedIds,
  onToggle,
  capacity,
}: {
  title: string;
  icon: React.ReactNode;
  items: LogItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  capacity: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted/80 flex items-center gap-1.5">
        {icon}
        <span>{title}</span>
        <span className="text-muted/50 font-mono normal-case ml-1">({items.length})</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {items.map((item) => {
          const selected = selectedIds.includes(item.id);
          const atLimit = !selected && capacity <= 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              disabled={atLimit}
              className={cn(
                "text-left px-3 py-2.5 rounded-md text-[11px] transition flex flex-col gap-0.5 min-h-[58px]",
                selected
                  ? "bg-accent/[0.45]"
                  : "bg-tile hover:bg-accent/[0.14]",
                atLimit && "opacity-40 cursor-not-allowed hover:bg-tile",
              )}
              title={item.primary}
            >
              <div className="font-medium truncate text-fg">{item.primary}</div>
              {item.secondary && (
                <p className="text-[10px] text-muted/70 truncate">{item.secondary}</p>
              )}
              {item.meta && (
                <div className="text-[9px] font-mono text-muted/50 mt-auto pt-0.5">
                  {item.meta}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BatchRunStatus({
  job,
  jobId,
  onReset,
}: {
  job: Job | null;
  jobId: string;
  onReset: () => void;
}) {
  const t = useT();
  const status = job?.status ?? "pending";
  const pct = job?.percentage ?? 0;

  return (
    <div className="space-y-5">
      <div className="bg-surface rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {status === "running" || status === "pending" ? (
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            ) : status === "completed" ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <XCircle className="h-5 w-5 text-danger" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {job?.algorithm_name ?? "Batch"}
              </div>
              <div className="text-xs text-muted truncate">
                {job?.progress_status ?? t("builders.batch.waiting")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={onReset} size="md">
              {t("builders.batch.new_batch")}
            </Button>
          </div>
        </div>
        {(status === "running" || status === "pending") && (
          <div className="h-1.5 w-full bg-tile rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
        )}
        {status === "failed" && job?.error && (
          <div className="text-xs text-danger bg-danger/5 rounded px-3 py-2">{job.error}</div>
        )}
        <div className="text-[10px] font-mono text-muted/60">{t("builders.batch.job_id", { id: jobId })}</div>
      </div>

      {status === "completed" && job?.result?.artifacts && (
        <BatchArtifacts artifacts={job.result.artifacts} runId={jobId} />
      )}
    </div>
  );
}

function BatchArtifacts({
  artifacts,
  runId,
}: {
  artifacts: Artifact[];
  runId: string;
}) {
  const t = useT();
  type Stat = Extract<Artifact, { kind: "stat" }>;
  type Img = Extract<Artifact, { kind: "image" }>;

  const groups: Array<
    | { kind: "stats"; stats: Stat[] }
    | { kind: "images"; images: Img[] }
    | { kind: "other"; artifact: Artifact }
  > = [];

  let statBucket: Stat[] = [];
  let imageBucket: Img[] = [];

  const flushStats = () => {
    if (statBucket.length) {
      groups.push({ kind: "stats", stats: statBucket });
      statBucket = [];
    }
  };
  const flushImages = () => {
    if (imageBucket.length) {
      groups.push({ kind: "images", images: imageBucket });
      imageBucket = [];
    }
  };

  for (const a of artifacts) {
    if (a.kind === "stat") {
      flushImages();
      statBucket.push(a);
    } else if (a.kind === "image") {
      flushStats();
      imageBucket.push(a);
    } else {
      flushStats();
      flushImages();
      groups.push({ kind: "other", artifact: a });
    }
  }
  flushStats();
  flushImages();

  return (
    <div className="rounded-lg bg-surface">
      <div className="px-5 pt-5 pb-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="h-4 w-4 text-muted shrink-0" />
          <h2 className="text-base font-semibold tracking-tight">{t("builders.batch.result_heading")}</h2>
        </div>
        <Button
          onClick={() => {
            const base = API_BASE;
            const link = document.createElement("a");
            link.href = `${base}/jobs/${runId}/download`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          variant="secondary"
          size="sm"
          className="h-8 px-2.5 flex items-center gap-1.5 shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="text-xs">{t("builders.batch.download_all")}</span>
        </Button>
      </div>
      <div className="p-5 space-y-5">
      {groups.map((g, i) => {
        if (g.kind === "stats") return <StatRow key={i} stats={g.stats} />;
        if (g.kind === "images") {
          return (
            <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {g.images.map((a, idx) => (
                <section key={idx} className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                    {a.label}
                  </h3>
                  <ImageView artifact={a} runId={runId} />
                </section>
              ))}
            </div>
          );
        }
        const a = g.artifact;
        return (
          <section key={i} className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
              {a.label}
            </h3>
            {a.kind === "table" && <TableView artifact={a} runId={runId} />}
            {a.kind === "log" && <LogDownload artifact={a} />}
            {a.kind === "text" && <TextView artifact={a} />}
          </section>
        );
      })}
      </div>
    </div>
  );
}
