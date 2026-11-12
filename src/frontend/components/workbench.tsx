"use client";

// The single-log page (/inspect): pick a log, set the ComFy parameters, run, and look at past runs (`?job=<id>`).

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useT,
  useLocale,
  localizedAlgoName,
  localizedAlgoText,
  localizedSampleLog,
  localizeCatalog,
} from "@/lib/i18n";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileUp,
  History,
  LayoutGrid,
  List,
  Play,
  Compass,
  X,
} from "lucide-react";
import {
  AlgorithmManifest,
  AnalysisResult,
  analyze,
  fetchAlgorithms,
  abortTask,
  Job,
  fetchJobs,
  fetchJobDetail,
  ValidationError,
  HttpError,
  fetchSampleLogs,
  SampleLog,
  fetchRecentLogs,
  RecentLog,
  fetchLogStats,
  LogStatsResponse,
  API_BASE,
  fetchFactorCatalog,
  FactorCatalog,
} from "@/lib/api";
import { downloadBlob, jobErrorText } from "@/lib/factor-analysis";
import { isSingleRun } from "@/lib/history";
import { FileDrop, LOG_EXTENSIONS } from "./file-drop";
import { ParameterForm, choiceList, type OptionInfo } from "./parameter-form";
import { SingleRunTour } from "./single-run-tour";
import { AlgorithmExplainerModal } from "./algorithm-explainer-modal";
import { PresetBar } from "./preset-bar";
import { LogOverviewCard } from "./log-overview-card";
import { JobNotesField } from "./job-notes-field";
import { ResultPanel } from "./result-panel";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { IconButton, ToolSeparator } from "./ui/icon-button";
import { Menu, type MenuItem } from "./ui/menu";
import { useTip } from "./ui/tip";
import { PageHeader } from "./page-header";
import { useJobs } from "./jobs-provider";
import { RecentSingleRuns } from "./recent-single-runs";
import { Segmented } from "./ui/segmented";
import { Notice } from "./ui/notice";
import { ChoiceMark, choiceTile } from "./ui/choice";
import { cn } from "@/lib/utils";
import { formatDateTime, formatFileSize, formatPercent } from "@/lib/format";

/** The page for analysing one event log with the ComFy miners and measures, and for viewing the runs of earlier analyses. */
export function Workbench() {
  const t = useT();
  const { locale, tMaybe } = useLocale();
  const [algorithms, setAlgorithms] = useState<AlgorithmManifest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The log comes from one of three places: a file just chosen (`file`), an earlier upload
  // (`selectedRecentId`) or a bundled sample (`selectedSampleId`); `activeSourceTab` says which source is shown.
  const [file, setFile] = useState<File | null>(null);
  // The values of the parameter form. They are remembered per algorithm in localStorage (`app.params-<id>`).
  const [params, setParams] = useState<Record<string, unknown>>({});
  // Adapter-declared auxiliary uploads (e.g. a reference PNML), keyed by the
  // manifest's secondary_files[].name.
  const [secondaryFiles, setSecondaryFiles] = useState<Record<string, File>>({});
  
  // The log sources: bundled samples, earlier uploads, and which of the two source tabs is shown.
  const [sampleLogs, setSampleLogs] = useState<SampleLog[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  // The list of recent logs has been read once, so that a log named in the address can be looked for.
  const [recentsLoaded, setRecentsLoaded] = useState(false);
  const [selectedRecentId, setSelectedRecentId] = useState<string | null>(null);
  const [activeSourceTab, setActiveSourceTab] = useState<"upload" | "sample">("upload");
  const [recentLayout, setRecentLayout] = useState<"grid" | "list">("grid");
  const [sampleLayout, setSampleLayout] = useState<"grid" | "list">("grid");

  // The catalog of the model tab lists the same miners and measures ComFy offers here; its
  // definitions and slow marks describe the options of the form.
  const [modelCatalog, setModelCatalog] = useState<FactorCatalog | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchFactorCatalog("model", ctrl.signal)
      .then(setModelCatalog)
      .catch(() => {
        // Only labels the options; the form works without it.
      });
    return () => ctrl.abort();
  }, []);
  const optionInfo = useMemo<OptionInfo | undefined>(() => {
    if (!modelCatalog) return undefined;
    const catalog = localizeCatalog(modelCatalog, locale);
    return Object.fromEntries([
      ...catalog.measures.map((m) => [m.key, { description: m.description, slow: m.slow }] as const),
      ...(catalog.miners ?? []).map((m) => [m.key, { slow: m.slow }] as const),
    ]);
  }, [modelCatalog, locale]);

  // Cheap descriptive stats of the selected log for the overview card.
  // Fetched whenever the user picks a new log source.
  const [logStats, setLogStats] = useState<LogStatsResponse | null>(null);

  // Job History States
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobDetail, setSelectedJobDetail] = useState<Job | null>(null);
  // Past-job view: collapse params to only those that differ from defaults.
  // Defaults to true since for most runs the user only changed 1-2 knobs and
  // wading through the full schema is noise.
  const [paramsDiffOnly, setParamsDiffOnly] = useState(true);
  // Re-collapse when a different job is inspected. Keyed on the id only so job
  // polling does not reset the toggle.
  useEffect(() => {
    setParamsDiffOnly(true);
  }, [selectedJobId]);

  // On-demand page tour and the explanation of the algorithm (see
  // single-run-tour.tsx / algorithm-explainer-modal.tsx).
  const [pageTourOpen, setPageTourOpen] = useState(false);
  const [explainerFor, setExplainerFor] = useState<AlgorithmManifest | null>(null);

  // Derived/Local UI States
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [progress, setProgress] = useState<{ percentage: number; status: string } | null>(null);

  // Ctrl/Cmd+Enter triggers the Run button, as long as we're configuring a new
  // run (i.e. not viewing a past job and not already running one).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      if (selectedJobDetail) return;
      if (!selected) return;
      e.preventDefault();
      void run();
    };
    // Registered again on every render, so that `run` sees the current state.
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Load algorithms list, sample logs & recent logs
  useEffect(() => {
    let cancelled = false;
    
    fetchAlgorithms()
      .then((res) => {
        if (cancelled) return;
        setAlgorithms(res.algorithms);
        if (res.algorithms.length > 0) setSelectedId(res.algorithms[0].id);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));

    fetchSampleLogs()
      .then((res) => {
        if (cancelled) return;
        setSampleLogs(res);
      })
      .catch((e: Error) => console.error("Failed to load sample logs:", e));

    fetchRecentLogs()
      .then((res) => {
        if (cancelled) return;
        setRecentLogs(res);
        setRecentsLoaded(true);
      })
      .catch((e: Error) => {
        console.error("Failed to load recent logs:", e);
        if (!cancelled) setRecentsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Honor a `?job=<id>` query param so deep links from the run-history view
  // (or anywhere else) open the past job directly. Depends on searchParams so
  // it also fires on client-side navigation, e.g. clicking a run in the
  // list of recent runs while already on this page.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const jobParam = searchParams.get("job");
    if (jobParam) setSelectedJobId(jobParam);
  }, [searchParams]);

  // Strip a stale ?job= from the URL whenever the past-job view is left.
  // Without this, re-clicking the same run in the list of recent runs is a same-URL
  // navigation and the effect above never fires again.
  const clearJobParam = useCallback(() => {
    if (searchParams.get("job")) router.replace("/inspect", { scroll: false });
  }, [searchParams, router]);

  // Synchronize jobs list & recent uploads in real-time via Server-Sent Events (SSE)
  // Pauses connection and queries when tab is hidden to conserve server resources.
  // A slow polling fallback covers setups where SSE is buffered (e.g. Next.js
  // standalone rewrites locally) so the UI never gets stuck on "Pending 0%".
  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Skipped while the tab is hidden, except for the first load: a deep link opened in a
    // background tab would otherwise show nothing until it is looked at.
    const loadJobsList = async (always = false) => {
      if (document.hidden && !always) return;
      try {
        const list = await fetchJobs();
        if (active) setJobs(list);

        const recents = await fetchRecentLogs();
        if (active) setRecentLogs(recents);
      } catch {
        // Ignore network hiccups
      }
    };

    const startStreaming = (first = false) => {
      if (eventSource) {
        eventSource.close();
      }
      if (pollTimer) {
        clearInterval(pollTimer);
      }

      // Initial fetch to load historical state
      void loadJobsList(first);

      // Same-origin SSE: goes through Next.js's /api/* rewrite (and any
      // reverse proxy in front of it; the backend sends
      // X-Accel-Buffering: no for nginx). For local dev setups where the
      // rewrite buffers SSE, set NEXT_PUBLIC_SSE_URL to e.g.
      // "http://localhost:8000/jobs/events" to connect directly (requires
      // CORS on the algoservice).
      const sseUrl = process.env.NEXT_PUBLIC_SSE_URL || "/api/jobs/events";

      try {
        eventSource = new EventSource(sseUrl);
        eventSource.onmessage = (event) => {
          // Trigger fetch whenever backend announces an update
          if (event.data === "update" || event.data === "initial") {
            void loadJobsList();
          }
        };
        eventSource.onerror = () => {
          // EventSource automatically retries connection. The polling fallback
          // below makes sure we keep working even if SSE never recovers.
        };
      } catch {
        /* EventSource unsupported, rely on polling */
      }

      // 5s polling as a fallback in case SSE events get buffered upstream
      // (Next.js standalone rewrites do this) or the EventSource silently
      // dies. `/jobs` is a cheap session-scoped query.
      pollTimer = setInterval(() => void loadJobsList(), 5000);
    };

    const stopStreaming = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    // Initialize stream
    startStreaming(true);

    // Pause/Resume based on document visibility
    const handleVisibility = () => {
      if (document.hidden) {
        stopStreaming();
      } else {
        startStreaming();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      stopStreaming();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Sync selected job details, results, error, and progress
  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJobDetail(null);
      setResult(null);
      setError(null);
      setProgress(null);
      return;
    }

    const jobSummary = jobs.find((j) => j.id === selectedJobId);
    if (!jobSummary) return;

    if (jobSummary.status === "completed") {
      fetchJobDetail(selectedJobId)
        .then((detail) => {
          setSelectedJobDetail(detail);
          setResult(detail.result ?? null);
          setError(null);
          setProgress(null);
        })
        .catch(() => setError(t("workbench.errors.load_job_details")));
    } else if (jobSummary.status === "failed") {
      setSelectedJobDetail(jobSummary);
      setResult(null);
      setError(jobErrorText(jobSummary, tMaybe) || t("workbench.errors.analysis_failed"));
      setProgress(null);
    } else if (jobSummary.status === "aborted") {
      setSelectedJobDetail(jobSummary);
      setResult(null);
      setError(t("workbench.errors.aborted"));
      setProgress(null);
    } else {
      // pending or running
      setSelectedJobDetail(jobSummary);
      setResult(null);
      setError(null);
      setProgress({
        percentage: jobSummary.percentage,
        status: jobSummary.progress_status,
      });
    }
  }, [selectedJobId, jobs]);

  // The algorithm on screen.
  const selected = useMemo(() => {
    // When viewing a past job, show that job's algorithm rather than the default one.
    // Fall back to the job summary while the detail is still loading.
    const viewedAlgoId =
      selectedJobDetail?.algorithm_id ??
      (selectedJobId ? jobs.find((j) => j.id === selectedJobId)?.algorithm_id : undefined);
    if (viewedAlgoId) {
      const jobAlgo = algorithms.find((a) => a.id === viewedAlgoId);
      if (jobAlgo) return jobAlgo;
    }
    return algorithms.find((a) => a.id === selectedId) ?? null;
  }, [algorithms, selectedId, selectedJobId, selectedJobDetail, jobs]);

  // Unified display meta for the "selected file" box at the top of the Upload tab.
  // Same visual whether the user just uploaded a file or picked one from the recent list.
  const selectedRecent = useMemo(
    () => (selectedRecentId ? recentLogs.find((r) => r.id === selectedRecentId) ?? null : null),
    [selectedRecentId, recentLogs],
  );
  const uploadDisplayMeta = file
    ? { name: file.name, size: file.size }
    : selectedRecent
      ? { name: selectedRecent.name, size: selectedRecent.size_bytes }
      : null;

  useEffect(() => {
    // Load defaults or cached params when switching algorithms (only when configuring a new run)
    if (!selected || selectedJobId) return;

    const saved = localStorage.getItem(`app.params-${selected.id}`);
    if (saved) {
      try {
        setParams(JSON.parse(saved));
        setResult(null);
        setError(null);
        return;
      } catch {
        // Fall back to defaults on parse error
      }
    }

    const defaults: Record<string, unknown> = {};
    for (const p of selected.parameters_schema) defaults[p.name] = p.default;
    setParams(defaults);
    setResult(null);
    setError(null);
  }, [selected, selectedJobId]);

  // A link from a row of a dataset ("View this log") names the log, and the miner of the row. Both
  // are taken once the recent logs are known; the address is cleaned afterwards, so that choosing
  // another log is not undone by it. A log that is no longer among the newest uploads is said so.
  const linkedLog = searchParams.get("log");
  const linkedMiner = searchParams.get("miner");
  const [prefill, setPrefill] = useState<{ log: string; found: boolean; miner: string | null } | null>(null);
  useEffect(() => {
    if (!linkedLog || !recentsLoaded || !selected) return;
    const found = recentLogs.some((r) => r.id === linkedLog);
    const spec = selected.parameters_schema.find((p) => p.name === "discovery_algorithms");
    const miner = found && linkedMiner && spec?.options?.includes(linkedMiner) ? linkedMiner : null;
    setSelectedJobId(null);
    if (found) {
      setActiveSourceTab("upload");
      setSelectedRecentId(linkedLog);
      setFile(null);
      setError(null);
    }
    if (miner) {
      setParams((p) => {
        const next = { ...p, discovery_algorithms: [miner] };
        try {
          localStorage.setItem(`app.params-${selected.id}`, JSON.stringify(next));
        } catch {
          /* storage blocked */
        }
        return next;
      });
    }
    setPrefill({ log: linkedLog, found, miner });
    router.replace("/inspect", { scroll: false });
  }, [linkedLog, linkedMiner, recentsLoaded, recentLogs, selected, router]);

  // When viewing a past job, hydrate the parameter form with the values that
  // were actually submitted for that job (kept on the server in
  // `Run.params_json`) instead of the cached values from localStorage.
  useEffect(() => {
    if (selectedJobDetail?.params) {
      setParams(selectedJobDetail.params as Record<string, unknown>);
    }
  }, [selectedJobDetail]);

  // Fetch the log overview stats whenever a fresh log source is picked.
  // Skipped when viewing a past job.
  useEffect(() => {
    if (selectedJobId) {
      setLogStats(null);
      return;
    }
    const isSample = activeSourceTab === "sample";
    if (isSample && !selectedSampleId) {
      setLogStats(null);
      return;
    }
    if (activeSourceTab === "upload" && !file && !selectedRecentId) {
      setLogStats(null);
      return;
    }
    const controller = new AbortController();
    fetchLogStats(
      isSample ? null : file,
      isSample ? selectedSampleId : null,
      activeSourceTab === "upload" ? selectedRecentId : null,
      controller.signal,
    )
      .then((res) => setLogStats(res))
      .catch(() => {
        // Informational only: stay silent on failure.
      });
    return () => controller.abort();
  }, [file, selectedSampleId, selectedRecentId, activeSourceTab, selectedJobId]);

  // Abort running job
  const handleAbort = async () => {
    if (selectedJobId) {
      await abortTask(selectedJobId);
      // Fast feedback: update status locally immediately
      setJobs((prev) =>
        prev.map((j) =>
          j.id === selectedJobId
            ? { ...j, status: "aborted", progress_status: t("workbench.errors.aborted_by_user") }
            : j
        )
      );
    }
  };

  // Run new job in background
  async function run() {
    if (!selected) return;

    const isSample = activeSourceTab === "sample";
    const isRecent = activeSourceTab === "upload" && !!selectedRecentId;
    const isUpload = activeSourceTab === "upload" && !selectedRecentId && !!file;

    if (isSample && !selectedSampleId) {
      setError(t("workbench.errors.no_sample"));
      return;
    }
    if (activeSourceTab === "upload" && !selectedRecentId && !file) {
      setError(t("workbench.errors.no_upload"));
      return;
    }

    // Validate parameters against the manifest schema
    const errors: Record<string, string> = {};
    for (const p of selected.parameters_schema) {
      const val = params[p.name];
      // ComFy fails without a miner or a measure; say so before the run starts.
      if (p.type === "multi_enum" && choiceList(val).length === 0) {
        errors[p.name] = t("workbench.errors.choose_one");
      }
      if (p.type === "int" || p.type === "float") {
        const num = Number(val);
        if (val === undefined || val === null || String(val).trim() === "" || isNaN(num)) {
          errors[p.name] = t("workbench.errors.must_be_number");
        } else {
          if (p.min !== undefined && p.min !== null && num < p.min) {
            errors[p.name] = t("workbench.errors.must_be_at_least", { min: p.min });
          }
          if (p.max !== undefined && p.max !== null && num > p.max) {
            errors[p.name] = t("workbench.errors.must_be_at_most", { max: p.max });
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setError(t("workbench.errors.fix_validation"));
      return;
    }

    setValidationErrors({});
    setResult(null);
    setError(null);
    setProgress({ percentage: 0, status: t("workbench.errors.submitting") });

    try {
      // analyze sends request and starts backend background task
      const response = await analyze(
        selected.id,
        isUpload ? file : null,
        isSample ? selectedSampleId : null,
        isRecent ? selectedRecentId : null,
        params,
        undefined,
        secondaryFiles
      );

      // Switch view immediately to the newly spawned job; keep the URL in
      // sync so that a reload or a shared link opens it.
      setSelectedJobId(response.job_id);
      router.replace(`/inspect?job=${response.job_id}`, { scroll: false });

      // Instantly refresh jobs list
      const list = await fetchJobs();
      setJobs(list);

      // Update recent uploads list
      const recents = await fetchRecentLogs();
      setRecentLogs(recents);
    } catch (e: unknown) {
      if (e instanceof ValidationError) {
        setValidationErrors(e.errors);
        setError(t("workbench.errors.fix_validation"));
      } else {
        // Refusals with a code, such as a full run quota, in the language of the UI.
        const coded = e instanceof HttpError && e.code ? tMaybe(`errors.${e.code}`, e.params) : undefined;
        setError(coded ?? (e instanceof Error ? e.message : t("workbench.errors.unknown_submission")));
      }
      setProgress(null);
    }
  }

  // The last runs of single logs are listed beside the page.
  const hasRuns = useJobs().jobs.some(isSingleRun);

  // A log is chosen in the source tab that is shown.
  const hasLog = activeSourceTab === "sample" ? !!selectedSampleId : !!file || !!selectedRecentId;

  const isJobRunning = selectedJobDetail
    ? selectedJobDetail.status === "running" || selectedJobDetail.status === "pending"
    : false;

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("inspect.title")}
          subtitle={t("inspect.subtitle")}
        />
        <Notice tone="error" role="alert" title={t("workbench.load_error.title")}>
          {loadError}
          <span className="mt-1 block font-mono text-xs">{API_BASE}</span>
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <SingleRunTour run={pageTourOpen} onClose={() => setPageTourOpen(false)} />
      <AlgorithmExplainerModal algo={explainerFor} onClose={() => setExplainerFor(null)} />

      <PageHeader
        title={t("inspect.title")}
        subtitle={t("inspect.subtitle")}
        actions={
          selected && (
            <InspectToolbar
              algorithm={selected}
              onAbout={() => setExplainerFor(selected)}
              onTour={() => setPageTourOpen(true)}
            />
          )
        }
      />

      {/* The last runs beside the page on a wide screen, after it on a smaller one. */}
      <div className={cn("space-y-6", hasRuns && "xl:grid xl:grid-cols-[minmax(0,1fr)_17rem] xl:gap-6 xl:items-start xl:space-y-0")}>
      <div className="space-y-4 min-w-0">
        {selected && (
          <>
            {/* 1. The event log: where it comes from, and what is in it. */}
            <InspectSection
              title={t("inspect.section_log")}
              hint={t(selectedJobDetail ? "inspect.section_log_run" : "inspect.section_log_hint")}
              tour="single-logsource"
            >
              {selectedJobDetail ? (
                <>
                  <div className="rounded-lg bg-tile p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-md bg-surface text-muted grid place-items-center">
                        <FileCheck2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{selectedJobDetail.filename}</div>
                        <div className="text-xs text-muted">{t("workbench.algo_card.analyzed_log")}</div>
                      </div>
                    </div>
                  </div>
                  <JobNotesField
                    jobId={selectedJobDetail.id}
                    initialNotes={selectedJobDetail.notes}
                    onSaved={(notes) => {
                      setJobs((prev) =>
                        prev.map((j) => (j.id === selectedJobDetail.id ? { ...j, notes } : j)),
                      );
                    }}
                  />
                </>
              ) : (
                <div className="space-y-4">
                  {/* Where the log comes from */}
                  <Segmented
                    aria-label={t("workbench.log_source.aria")}
                    className="max-w-[420px]"
                    value={activeSourceTab}
                    onChange={(v) => {
                      setActiveSourceTab(v);
                      setError(null);
                    }}
                    options={[
                      { value: "upload", label: t("workbench.log_source.upload_file") },
                      { value: "sample", label: t("workbench.log_source.use_sample") },
                    ]}
                  />

                  {/* A log named by a link from a dataset: opened, or no longer there. */}
                  <div role="status" className="empty:hidden">
                    {prefill && (
                      <Notice size="sm" tone={prefill.found ? "info" : "warn"}>
                        <span className="min-w-0 flex-1 break-words">
                          {prefill.found
                            ? t(prefill.miner ? "inspect.from_dataset_miner" : "inspect.from_dataset", {
                                log: prefill.log,
                                miner: prefill.miner ?? "",
                              })
                            : t("inspect.log_gone", { log: prefill.log })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPrefill(null)}
                          aria-label={t("common.close")}
                          className="shrink-0 rounded text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </Notice>
                    )}
                  </div>

                  {/* Conditional Log Inputs */}
                  {activeSourceTab === "upload" ? (
                    <div className="space-y-4 w-full">
                      {uploadDisplayMeta ? (
                        <div className="rounded-lg bg-tile p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-md bg-success/10 grid place-items-center">
                              <FileCheck2 className="h-4 w-4 text-success-ink" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{uploadDisplayMeta.name}</div>
                              <div className="text-xs text-muted">{formatFileSize(uploadDisplayMeta.size, locale)}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setFile(null);
                              setSelectedRecentId(null);
                              setError(null);
                            }}
                            aria-label={t("file_drop.remove_aria")}
                            className="h-8 w-8 grid place-items-center rounded-md hover:bg-bg transition"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <FileDrop
                          file={null}
                          onChange={(f) => {
                            if (!f) {
                              setFile(null);
                              setSelectedRecentId(null);
                              return;
                            }
                            // The server refuses files above 100 MB (`MAX_FILE_SIZE`); saying so here saves the upload.
                            if (f.size > 100 * 1024 * 1024) {
                              setError(t("workbench.errors.file_too_large"));
                              setFile(null);
                              return;
                            }
                            // A dropped file skips the filter of the file picker.
                            if (!LOG_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))) {
                              setError(t("workbench.errors.wrong_type", { formats: LOG_EXTENSIONS.join(", ") }));
                              setFile(null);
                              return;
                            }
                            setError(null);
                            // Match against existing recent logs: if a recent has the same name and
                            // size, treat the upload as picking that recent (instead of uploading a
                            // duplicate). This keeps the "selected" highlight in sync with what the
                            // user just dropped.
                            const matching = recentLogs.find((r) => r.name === f.name && r.size_bytes === f.size);
                            if (matching) {
                              setSelectedRecentId(matching.id);
                              setFile(null);
                            } else {
                              setFile(f);
                              setSelectedRecentId(null);
                            }
                          }}
                        />
                      )}
                      {recentLogs.length > 0 && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between px-1">
                            <div className="text-xs font-medium text-muted flex items-center gap-1.5">
                              <History className="h-3.5 w-3.5 text-muted/70" />
                              <span>{t("workbench.recent.label")}</span>
                            </div>
                            <Segmented
                              size="sm"
                              aria-label={t("workbench.layout.aria")}
                              value={recentLayout}
                              onChange={setRecentLayout}
                              options={[
                                {
                                  value: "grid",
                                  label: (
                                    <>
                                      <LayoutGrid className="h-3 w-3" />
                                      <span>{t("workbench.layout.grid")}</span>
                                    </>
                                  ),
                                  title: t("workbench.layout.grid_title"),
                                },
                                {
                                  value: "list",
                                  label: (
                                    <>
                                      <List className="h-3 w-3" />
                                      <span>{t("workbench.layout.list")}</span>
                                    </>
                                  ),
                                  title: t("workbench.layout.list_title"),
                                },
                              ]}
                            />
                          </div>
                          {/* A choice of one, with the radio tiles of the data step. */}
                          <div
                            role="radiogroup"
                            aria-label={t("workbench.recent.label")}
                            className="max-h-[156px] overflow-y-auto p-1 no-scrollbar"
                          >
                            <div
                              className={cn(
                                "gap-2",
                                recentLayout === "grid"
                                  ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                                  : "flex flex-col gap-1.5",
                              )}
                            >
                              {recentLogs.map((log) => {
                                const isSelected = selectedRecentId === log.id;
                                return (
                                  <label
                                    key={log.id}
                                    className={cn(
                                      "flex items-start gap-2.5 rounded-md px-3 py-2 text-xs min-w-0",
                                      choiceTile(isSelected),
                                    )}
                                  >
                                    <input
                                      type="radio"
                                      name="recent-log"
                                      className="sr-only"
                                      checked={isSelected}
                                      onChange={() => {
                                        setSelectedRecentId(log.id);
                                        setError(null);
                                        setFile(null); // Clear file when recent log is chosen
                                      }}
                                    />
                                    <ChoiceMark type="radio" checked={isSelected} className="mt-px" />
                                    <span
                                      className={cn(
                                        "min-w-0 flex-1",
                                        recentLayout === "list" && "flex items-center justify-between gap-4",
                                      )}
                                    >
                                      <span className="block font-medium truncate" title={log.name}>
                                        {log.name}
                                      </span>
                                      <span
                                        className={cn(
                                          "flex items-center justify-between gap-3 text-xs text-muted",
                                          recentLayout === "grid" ? "mt-0.5" : "shrink-0",
                                        )}
                                      >
                                        <span className="shrink-0">{formatFileSize(log.size_bytes, locale)}</span>
                                        <span className={cn("truncate", recentLayout === "list" && "hidden sm:inline")}>
                                          {formatDateTime(log.mtime * 1000, locale)}
                                        </span>
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4 w-full">
                      <div className="flex items-center justify-between px-1">
                        <div className="text-xs font-medium text-muted flex items-center gap-1.5">
                          <span>{t("workbench.samples.label")}</span>
                        </div>
                        {sampleLogs.length > 1 && (
                          <Segmented
                            size="sm"
                            aria-label={t("workbench.layout.aria")}
                            value={sampleLayout}
                            onChange={setSampleLayout}
                            options={[
                              {
                                value: "grid",
                                label: (
                                  <>
                                    <LayoutGrid className="h-3 w-3" />
                                    <span>{t("workbench.layout.grid")}</span>
                                  </>
                                ),
                                title: t("workbench.layout.grid_title"),
                              },
                              {
                                value: "list",
                                label: (
                                  <>
                                    <List className="h-3 w-3" />
                                    <span>{t("workbench.layout.list")}</span>
                                  </>
                                ),
                                title: t("workbench.layout.list_title"),
                              },
                            ]}
                          />
                        )}
                      </div>

                      <div
                        role="radiogroup"
                        aria-label={t("workbench.samples.label")}
                        className={cn(
                          "w-full gap-2",
                          sampleLayout === "grid" ? "grid grid-cols-1 md:grid-cols-2" : "flex flex-col",
                        )}
                      >
                        {sampleLogs.map((sample) => {
                          const log = localizedSampleLog(sample, locale);
                          const isSelected = selectedSampleId === log.id;
                          return (
                            <label
                              key={log.id}
                              className={cn("flex items-start gap-2.5 rounded-md p-3 min-w-0", choiceTile(isSelected))}
                            >
                              <input
                                type="radio"
                                name="sample-log"
                                className="sr-only"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedSampleId(log.id);
                                  setError(null);
                                }}
                              />
                              <ChoiceMark type="radio" checked={isSelected} className="mt-px" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium truncate">{log.name}</span>
                                <span
                                  className={cn(
                                    "block text-xs text-muted mt-0.5 leading-normal",
                                    sampleLayout === "grid" ? "line-clamp-2" : "line-clamp-1",
                                  )}
                                >
                                  {log.description}
                                </span>
                                <span className="mt-1 flex items-center justify-between gap-3 text-xs text-muted">
                                  <span className="font-mono truncate">{log.filename}</span>
                                  <span className="shrink-0">{formatFileSize(log.size_bytes, locale)}</span>
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Log overview: descriptive stats about the selected log. */}
                  {logStats && <LogOverviewCard stats={logStats.stats} filename={uploadDisplayMeta?.name ?? null} />}
                </div>
              )}
            </InspectSection>

            {/* 2. The miners that discover the nets and the measures computed on them. */}
            <InspectSection
              title={t("inspect.section_settings")}
              hint={t("inspect.section_settings_hint")}
              tour="single-params"
            >
              {!selectedJobDetail && selected.parameters_schema.length > 0 && (
                <PresetBar
                  algorithmId={selected.id}
                  currentParams={params}
                  disabled={!!selectedJobId}
                  defaults={Object.fromEntries(selected.parameters_schema.map((p) => [p.name, p.default]))}
                  onLoad={(loaded) => {
                    setParams(loaded);
                    try {
                      localStorage.setItem(`app.params-${selected.id}`, JSON.stringify(loaded));
                    } catch {
                      /* ignore quota */
                    }
                    setValidationErrors({});
                  }}
                />
              )}
              {selectedJobDetail && selected.parameters_schema.length > 0 && (
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-muted">
                    {paramsDiffOnly ? t("workbench.params.showing_modified") : t("workbench.params.showing_all")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setParamsDiffOnly((v) => !v)}
                    className="text-xs font-medium text-accent-ink hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 rounded px-1"
                  >
                    {paramsDiffOnly ? t("workbench.params.show_all") : t("workbench.params.show_only_modified")}
                  </button>
                </div>
              )}
              {!selectedJobDetail && (selected.secondary_files?.length ?? 0) > 0 && (
                <div className="space-y-2.5">
                  {selected.secondary_files!.map((sf) => {
                    const chosen = secondaryFiles[sf.name];
                    return (
                      <div key={sf.name} className="space-y-1.5">
                        <div className="text-xs font-medium text-muted">
                          {sf.label}
                          {sf.optional && (
                            <span className="ml-1.5 font-normal text-muted">· {t("workbench.secondary.optional")}</span>
                          )}
                        </div>
                        {chosen ? (
                          <div className="bg-tile rounded-md px-2.5 py-2 flex items-center gap-2 text-xs">
                            <FileCheck2 className="h-3.5 w-3.5 text-muted shrink-0" />
                            <span className="truncate flex-1">{chosen.name}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setSecondaryFiles((prev) => {
                                  const next = { ...prev };
                                  delete next[sf.name];
                                  return next;
                                })
                              }
                              disabled={!!selectedJobId}
                              title={t("file_drop.remove_aria")}
                              aria-label={t("file_drop.remove_aria")}
                              className="text-muted hover:text-danger-ink transition shrink-0 disabled:opacity-50"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <label
                            className={cn(
                              "flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted transition",
                              selectedJobId
                                ? "opacity-50 cursor-not-allowed"
                                : "cursor-pointer hover:border-accent/50 hover:text-fg",
                            )}
                          >
                            <FileUp className="h-3.5 w-3.5 shrink-0" />
                            <span>{t("workbench.secondary.choose", { formats: sf.accept })}</span>
                            <input
                              type="file"
                              accept={sf.accept}
                              disabled={!!selectedJobId}
                              className="sr-only"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  setSecondaryFiles((prev) => ({ ...prev, [sf.name]: f }));
                                }
                                e.target.value = "";
                              }}
                            />
                          </label>
                        )}
                        {sf.help && <p className="text-xs text-muted leading-snug">{sf.help}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
              <ParameterForm
                schema={selected.parameters_schema}
                algorithmId={selected.id}
                optionInfo={optionInfo}
                values={params}
                disabled={!!selectedJobId}
                errors={validationErrors}
                diffOnly={!!selectedJobDetail && paramsDiffOnly}
                onChange={(name, value) => {
                  setParams((p) => {
                    const newParams = { ...p, [name]: value };
                    localStorage.setItem(`app.params-${selected.id}`, JSON.stringify(newParams));
                    return newParams;
                  });
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next[name];
                    return next;
                  });
                }}
              />
            </InspectSection>

            {/* 3. The run: its progress, and the button that starts or stops it. */}
            <InspectSection
              title={t("inspect.section_run")}
              hint={t("inspect.section_run_hint")}
              tour="single-run"
              aside={
                selectedJobDetail && (
                  <span
                    className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
                      selectedJobDetail.status === "completed" && "bg-success/15 text-success-ink",
                      selectedJobDetail.status === "failed" && "bg-danger/15 text-danger-ink",
                      selectedJobDetail.status === "aborted" && "bg-muted/15 text-muted",
                      (selectedJobDetail.status === "running" || selectedJobDetail.status === "pending") &&
                        "bg-surface text-fg animate-pulse",
                    )}
                  >
                    {t("workbench.job_badge", {
                      id: selectedJobDetail.id.slice(0, 8),
                      status: t(`run_history.status_label_${selectedJobDetail.status}`),
                    })}
                  </span>
                )
              }
            >
              {progress && (
                <div className="w-full space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-muted truncate max-w-[80%]">
                      {localizedAlgoText(progress.status, t)}
                    </span>
                    <span className="font-semibold tabular-nums shrink-0">
                      {formatPercent(progress.percentage / 100, locale, 0)}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress.percentage)}
                    aria-label={localizedAlgoText(progress.status, t)}
                    className="w-full bg-border rounded-full h-2 overflow-hidden"
                  >
                    <div
                      className="bg-accent h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 w-full flex-wrap">
                <div className="text-xs text-muted">
                  {selectedJobDetail
                    ? t("workbench.run_bar.job_status", { status: t(`run_history.status_label_${selectedJobDetail.status}`) })
                    : hasLog
                      ? t("workbench.run_bar.ready")
                      : activeSourceTab === "sample"
                        ? t("workbench.run_bar.sample_hint")
                        : t("workbench.run_bar.upload_hint")}
                </div>
                <div className="flex items-center gap-2">
                  {selectedJobDetail ? (
                    isJobRunning ? (
                      <Button
                        onClick={handleAbort}
                        variant="outline"
                        size="md"
                        className="bg-danger/10 text-danger-ink hover:bg-danger/20 hover:text-danger-ink"
                      >
                        {t("workbench.run_bar.abort")}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setSelectedJobId(null);
                          clearJobParam();
                          setResult(null);
                          setError(null);
                        }}
                        size="md"
                      >
                        {t("workbench.run_bar.new_run")}
                      </Button>
                    )
                  ) : (
                    <RunButton disabled={!hasLog} onClick={run} />
                  )}
                </div>
              </div>
            </InspectSection>
          </>
        )}

        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}

        {result && <ResultPanel result={result} runId={selectedJobId} />}
      </div>
      {hasRuns && (
        <aside className="xl:sticky xl:top-6 min-w-0">
          <RecentSingleRuns activeId={selectedJobId} />
        </aside>
      )}
      </div>
    </div>
  );
}

/** One of the three sections of the page: a heading, what it is for, and its content on a card. */
function InspectSection({
  title,
  hint,
  tour,
  aside,
  children,
}: {
  title: string;
  hint: string;
  /** Value of `data-tour`, the anchor of the page tour. */
  tour: string;
  /** Shown at the right of the heading, e.g. the status of the run on screen. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-tour={tour}>
      <Card>
        <div className="px-4 sm:px-5 pt-5 pb-4 flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[12rem]">
            <h2 id={id} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            <p className="text-sm text-muted mt-0.5">{hint}</p>
          </div>
          {aside}
        </div>
        <div className="px-4 sm:px-5 pb-5 space-y-4">{children}</div>
      </Card>
    </section>
  );
}

/** The button that starts the run, with its shortcut in the tooltip. */
function RunButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const t = useT();
  const tip = useTip<HTMLButtonElement>({ more: t("workbench.run_bar.run_title"), keyCap: "Ctrl+Enter" });
  return (
    <Button ref={tip} onClick={onClick} disabled={disabled} size="md">
      <Play className="h-4 w-4" aria-hidden />
      {t("common.run_analysis")}
    </Button>
  );
}

/**
 * The tools of the page in the header, as icons: what ComFy does with the paper and the citation
 * in BibTeX, and the tour of the page.
 */
function InspectToolbar({
  algorithm,
  onAbout,
  onTour,
}: {
  algorithm: AlgorithmManifest;
  onAbout: () => void;
  onTour: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const citation = algorithm.citation;
  const items: MenuItem[] = [
    { id: "about", label: t("inspect.about"), hint: t("inspect.about_hint"), icon: BookOpen, onSelect: onAbout },
    {
      id: "paper",
      label: t("workbench.algo_card.paper_link"),
      hint: algorithm.author ? t("workbench.algo_card.implemented_by", { author: algorithm.author }) : undefined,
      icon: ExternalLink,
      href: algorithm.paper_url ?? undefined,
      newTab: true,
      disabled: !algorithm.paper_url,
      separated: true,
    },
    {
      id: "copy",
      label: copied ? t("workbench.algo_card.copied_bibtex") : t("workbench.algo_card.copy_bibtex"),
      hint: algorithm.formatted_citation ?? undefined,
      icon: copied ? Check : Copy,
      disabled: !citation,
      onSelect: () => {
        void navigator.clipboard.writeText(citation ?? "").then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      },
    },
    {
      id: "bib",
      label: t("workbench.algo_card.download_bib"),
      hint: t("workbench.algo_card.download_bib_title"),
      icon: Download,
      disabled: !citation,
      onSelect: () => {
        const blob = new Blob([citation ?? ""], { type: "application/x-bibtex" });
        downloadBlob(blob, `${algorithm.id}.bib`);
      },
    },
  ];
  return (
    <div role="group" aria-label={t("factor.toolbar.aria")} className="flex items-center gap-0.5">
      <Menu icon={BookOpen} name={t("inspect.about_menu", { name: localizedAlgoName(algorithm, locale) })} items={items} width={320} />
      <ToolSeparator />
      <IconButton icon={Compass} name={t("inspect.tour")} more={t("inspect.tour_more")} onClick={onTour} />
    </div>
  );
}
