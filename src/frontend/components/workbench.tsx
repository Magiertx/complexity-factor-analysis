"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT, useLocale, localizedAlgoDescription } from "@/lib/i18n";
import {
  AlertCircle,
  Play,
  ExternalLink,
  FileCheck2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  Copy,
  Check,
  Download,
  History,
  Clock,
  LayoutGrid,
  List,
  X,
  HelpCircle,
  FileUp,
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
  fetchSampleLogs,
  SampleLog,
  fetchRecentLogs,
  RecentLog,
  fetchLogStats,
  LogStatsResponse,
  API_BASE,
} from "@/lib/api";
import { AlgorithmList } from "./algorithm-list";
import { FileDrop } from "./file-drop";
import { ParameterForm } from "./parameter-form";
import { SingleRunTour } from "./single-run-tour";
import { AlgorithmExplainerModal } from "./algorithm-explainer-modal";
import { PresetBar } from "./preset-bar";
import { LogOverviewCard } from "./log-overview-card";
import { JobNotesField } from "./job-notes-field";
import { ResultPanel } from "./result-panel";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Segmented } from "./ui/segmented";
import { cn } from "@/lib/utils";
import { formatDateTime, formatKilobytes, formatPercent } from "@/lib/i18n/local-format";

export function Workbench() {
  const t = useT();
  const { locale } = useLocale();
  const [algorithms, setAlgorithms] = useState<AlgorithmManifest[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  // Adapter-declared auxiliary uploads (e.g. a reference PNML), keyed by the
  // manifest's secondary_files[].name.
  const [secondaryFiles, setSecondaryFiles] = useState<Record<string, File>>({});
  
  // Sample Log, Recent Log & Citation States
  const [sampleLogs, setSampleLogs] = useState<SampleLog[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  const [selectedRecentId, setSelectedRecentId] = useState<string | null>(null);
  const [activeSourceTab, setActiveSourceTab] = useState<"upload" | "sample">("upload");
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [recentLayout, setRecentLayout] = useState<"grid" | "list">("grid");
  const [sampleLayout, setSampleLayout] = useState<"grid" | "list">("grid");

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

  // Sidebar Layout States
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);

  // On-demand page tour and algorithm explainer state (see
  // single-run-tour.tsx / algorithm-explainer-modal.tsx).
  const [pageTourOpen, setPageTourOpen] = useState(false);
  const [explainerFor, setExplainerFor] = useState<AlgorithmManifest | null>(null);

  // Derived/Local UI States
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [progress, setProgress] = useState<{ percentage: number; status: string } | null>(null);

  // Escape key listener for closing mobile drawer
  useEffect(() => {
    if (!sidebarOpenMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSidebarOpenMobile(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpenMobile]);

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
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Focus trap for mobile drawer accessibility
  useEffect(() => {
    if (!sidebarOpenMobile || !sidebarRef.current) return;

    // Focus the first interactive element (close button) when drawer opens
    const focusable = sidebarRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const elements = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!elements || elements.length === 0) return;

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpenMobile]);

  // Load algorithms list, sample logs & recent logs
  useEffect(() => {
    let cancelled = false;
    
    fetchAlgorithms()
      .then((res) => {
        if (cancelled) return;
        setAlgorithms(res.algorithms);
        setCategories(res.categories);
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
      })
      .catch((e: Error) => console.error("Failed to load recent logs:", e));

    return () => {
      cancelled = true;
    };
  }, []);

  // Honor a `?job=<id>` query param so deep links from the run-history view
  // (or anywhere else) open the past job directly. Depends on searchParams so
  // it also fires on client-side navigation, e.g. clicking a job in the
  // drawer while already on this page.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const jobParam = searchParams.get("job");
    if (jobParam) setSelectedJobId(jobParam);
  }, [searchParams]);

  // Strip a stale ?job= from the URL whenever the past-job view is left.
  // Without this, re-clicking the same job in the drawer is a same-URL
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
      setError(jobSummary.error || t("workbench.errors.analysis_failed"));
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

  // Load defaults or cached params when switching algorithms (only when configuring a new run)
  const selected = useMemo(() => {
    // When viewing a past job, show that job's algorithm rather than the one selected in
    // the sidebar. Fall back to the job summary while the detail is still loading.
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
      // sync so the drawer highlights it.
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
        setError(e instanceof Error ? e.message : t("workbench.errors.unknown_submission"));
      }
      setProgress(null);
    }
  }

  // A log is chosen in the source tab that is shown.
  const hasLog = activeSourceTab === "sample" ? !!selectedSampleId : !!file || !!selectedRecentId;

  const isJobRunning = selectedJobDetail
    ? selectedJobDetail.status === "running" || selectedJobDetail.status === "pending"
    : false;

  if (loadError) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-6">
          <AlertCircle className="h-5 w-5 text-danger-ink shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{t("workbench.load_error.title")}</div>
            <div className="text-sm text-muted mt-1">{loadError}</div>
            <div className="text-xs text-muted mt-2 font-mono">
              {API_BASE}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full items-start">
      <SingleRunTour run={pageTourOpen} onClose={() => setPageTourOpen(false)} />
      <AlgorithmExplainerModal
        algo={explainerFor}
        onClose={() => setExplainerFor(null)}
      />

      {/* Mobile Drawer Overlay Backdrop */}
      {sidebarOpenMobile && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpenMobile(false)}
        />
      )}

      {/* Sidebar (Normal on desktop, slide-out drawer on mobile) */}
      <aside
        ref={sidebarRef}
        role={sidebarOpenMobile ? "dialog" : undefined}
        aria-modal={sidebarOpenMobile ? "true" : undefined}
        aria-label={t("workbench.sidebar.nav_aria")}
        className={
          "space-y-6 shrink-0 transition-all duration-300 ease-in-out " +
          (sidebarCollapsed ? "lg:w-0 lg:opacity-0 lg:overflow-hidden lg:pointer-events-none lg:mr-0 " : "lg:w-[280px] lg:opacity-100 ") +
          // Mobile Drawer absolute overlay classes
          "fixed inset-y-0 left-0 z-50 w-[290px] bg-surface p-5 shadow-2xl border-r border-border transition-transform duration-300 overflow-y-auto lg:overflow-visible lg:shadow-none lg:p-0 lg:border-none lg:bg-transparent lg:static lg:transform-none " +
          (sidebarOpenMobile ? "translate-x-0" : "-translate-x-full lg:translate-x-0")
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-medium text-muted px-1">
            <span>{t("workbench.sidebar.algorithm_label")}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPageTourOpen(true)}
                aria-label={t("workbench.sidebar.tour_aria")}
                title={t("workbench.sidebar.tour_title")}
                className="h-6 px-1.5 inline-flex items-center gap-1 rounded text-[11px] font-normal text-muted hover:text-fg hover:bg-tile transition appearance-none"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                <span>{t("workbench.sidebar.tour_button")}</span>
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpenMobile(false)}
                aria-label={t("workbench.sidebar.close_sidebar_aria")}
                className="lg:hidden h-6 w-6 grid place-items-center rounded text-muted hover:text-fg hover:bg-tile transition appearance-none"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          </div>
          {algorithms.length === 0 ? (
            <div className="text-sm text-muted p-3">{t("common.loading")}</div>
          ) : (
            <AlgorithmList
              algorithms={algorithms}
              categories={categories}
              selectedId={selectedId}
              onShowExplainer={(algo) => setExplainerFor(algo)}
              onSelect={(id) => {
                setSelectedId(id);
                setSelectedJobId(null); // Clear selected job to configure a new run
                clearJobParam();
                setValidationErrors({}); // Clear validation errors
                setSecondaryFiles({}); // Clear auxiliary uploads (per-algorithm)
                setSelectedSampleId(null); // Clear selected sample
                setSelectedRecentId(null); // Clear selected recent upload
                setFile(null); // Clear uploaded file
                setSidebarOpenMobile(false); // Close mobile drawer
              }}
            />
          )}
        </div>

      </aside>

      {/* Main Workspace Section */}
      <section className="space-y-4 min-w-0 flex-1 w-full">
        {selected && (
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <div className="flex items-center gap-2">
              {/* Mobile Toggle Button */}
              <Button
                variant="outline"
                size="sm"
                className="lg:hidden h-8 w-8 p-0 flex items-center justify-center text-muted hover:text-fg shrink-0"
                onClick={() => setSidebarOpenMobile(true)}
                title={t("workbench.sidebar.show_menu_title")}
              >
                <Menu className="h-4 w-4" />
              </Button>

              {/* Desktop Sidebar Collapse Toggle Button */}
              <Button
                variant="outline"
                size="sm"
                className="hidden lg:flex h-8 w-8 p-0 items-center justify-center text-muted hover:text-fg shrink-0"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                title={sidebarCollapsed ? t("workbench.sidebar.show_sidebar_title") : t("workbench.sidebar.hide_sidebar_title")}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            </div>

            {selectedJobDetail && (
              <span
                className={
                  "text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 " +
                  (selectedJobDetail.status === "completed"
                    ? "bg-success/15 text-success-ink "
                    : "") +
                  (selectedJobDetail.status === "failed"
                    ? "bg-danger/15 text-danger-ink "
                    : "") +
                  (selectedJobDetail.status === "aborted"
                    ? "bg-muted/15 text-muted "
                    : "") +
                  (selectedJobDetail.status === "running" || selectedJobDetail.status === "pending"
                    ? "bg-accent/15 text-accent-ink animate-pulse "
                    : "")
                }
              >
                {t("workbench.job_badge", {
                  id: selectedJobDetail.id.slice(0, 8),
                  status: t(`run_history.status_label_${selectedJobDetail.status}`),
                })}
              </span>
            )}
          </div>
        )}

        {selected && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 flex-1">
                  <CardTitle className="text-lg lg:text-xl font-bold">{selected.name}</CardTitle>
                  <CardDescription className="text-sm text-muted mt-1">{localizedAlgoDescription(selected, locale)}</CardDescription>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0 text-right">
                  {selected.author && (
                    <span
                      className="text-xs text-muted/80 flex items-center gap-1.5 shrink-0"
                      title={t("workbench.algo_card.implemented_by", { author: selected.author ?? "" })}
                    >
                      <User className="h-3.5 w-3.5" />
                      <span>{selected.author}</span>
                    </span>
                  )}
                  {selected.paper_url && (
                    <a
                      href={selected.paper_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted hover:text-fg inline-flex items-center gap-1 shrink-0"
                    >
                      {t("workbench.algo_card.paper_link")} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
              
              {/* Formatted Citation Helper */}
              {(selected.formatted_citation || selected.citation) && (
                <div className="mt-4 bg-tile rounded-lg p-3.5 relative group">
                  <div className="text-xs font-medium text-muted mb-1.5 flex items-center justify-between gap-x-3 gap-y-1 flex-wrap">
                    <span>{t("workbench.algo_card.academic_reference")}</span>
                    {selected.citation && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(selected.citation || "");
                            setCopiedCitation(true);
                            setTimeout(() => setCopiedCitation(false), 2000);
                          }}
                          className="flex items-center gap-1 text-[10px] text-muted hover:text-accent-ink font-semibold transition"
                        >
                          {copiedCitation ? (
                            <>
                              <Check className="h-3 w-3 text-success-ink" />
                              <span className="text-success-ink">{t("workbench.algo_card.copied_bibtex")}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>{t("workbench.algo_card.copy_bibtex")}</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const blob = new Blob([selected.citation || ""], { type: "application/x-bibtex" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `${selected.id}.bib`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          }}
                          className="flex items-center gap-1 text-[10px] text-muted hover:text-accent-ink font-semibold transition"
                          title={t("workbench.algo_card.download_bib_title")}
                        >
                          <Download className="h-3 w-3" />
                          <span>{t("workbench.algo_card.download_bib")}</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted/90 italic leading-relaxed pr-2">
                    {selected.formatted_citation || selected.citation}
                  </p>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-5">
              {selectedJobDetail ? (
                <>
                  <div className="rounded-lg bg-tile p-4 flex items-center justify-between opacity-80">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-md bg-accent/10 grid place-items-center">
                        <FileCheck2 className="h-4 w-4 text-accent-ink" />
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
                        prev.map((j) =>
                          j.id === selectedJobDetail.id ? { ...j, notes } : j,
                        ),
                      );
                    }}
                  />
                </>
              ) : (
                <div className="space-y-4" data-tour="single-logsource">
                  {/* Log Source Tab Selector */}
                  <Segmented
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
                              <div className="text-xs text-muted">{formatKilobytes(uploadDisplayMeta.size, locale)}</div>
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
                            if (f.size > 100 * 1024 * 1024) {
                              setError(t("workbench.errors.file_too_large"));
                              setFile(null);
                              return;
                            }
                            setError(null);
                            // Match against existing recent logs: if a recent has the same name and
                            // size, treat the upload as picking that recent (instead of uploading a
                            // duplicate). This keeps the "selected" highlight in sync with what the
                            // user just dropped.
                            const matching = recentLogs.find(
                              (r) => r.name === f.name && r.size_bytes === f.size,
                            );
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
                              value={recentLayout}
                              onChange={setRecentLayout}
                              options={[
                                { value: "grid", label: <><LayoutGrid className="h-3 w-3" /><span>{t("workbench.layout.grid")}</span></>, title: t("workbench.layout.grid_title") },
                                { value: "list", label: <><List className="h-3 w-3" /><span>{t("workbench.layout.list")}</span></>, title: t("workbench.layout.list_title") },
                              ]}
                            />
                          </div>
                          <div className="max-h-[148px] overflow-y-auto p-1 no-scrollbar">
                            {recentLayout === "grid" ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                                {recentLogs.map((log) => {
                                  const isSelected = selectedRecentId === log.id;
                                  return (
                                    <button
                                      key={log.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedRecentId(log.id);
                                        setError(null);
                                        setFile(null); // Clear file when recent log is chosen
                                      }}
                                      className={cn(
                                        "text-left px-3 py-2.5 rounded-md text-[11px] transition-all duration-200 flex flex-col justify-between min-h-[62px] relative group",
                                        isSelected
                                          ? "bg-accent/[0.45]"
                                          : "bg-tile hover:bg-accent/[0.14]"
                                      )}
                                    >
                                      <div className="flex items-start justify-between gap-2 w-full">
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                          <Clock className="h-3.5 w-3.5 text-muted/40 group-hover:text-muted/70 transition shrink-0" />
                                          <span className="font-medium truncate text-fg" title={log.name}>{log.name}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center justify-between text-[9px] text-muted/50 mt-1 w-full gap-2">
                                        <span className="shrink-0">{formatKilobytes(log.size_bytes, locale)}</span>
                                        <span className="truncate">
                                          {formatDateTime(log.mtime * 1000, locale)}
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                {recentLogs.map((log) => {
                                  const isSelected = selectedRecentId === log.id;
                                  return (
                                    <button
                                      key={log.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedRecentId(log.id);
                                        setError(null);
                                        setFile(null); // Clear file when recent log is chosen
                                      }}
                                      className={cn(
                                        "text-left px-3 py-2 rounded-md text-[11px] transition-all duration-200 flex items-center justify-between relative group w-full",
                                        isSelected
                                          ? "bg-accent/[0.45]"
                                          : "bg-tile hover:bg-accent/[0.14]"
                                      )}
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <Clock className="h-3.5 w-3.5 text-muted/40 group-hover:text-muted/70 transition shrink-0" />
                                        <span className="font-medium truncate text-fg" title={log.name}>{log.name}</span>
                                      </div>
                                      <div className="flex items-center gap-4 text-[9px] text-muted/50 shrink-0 ml-4">
                                        <span>{formatKilobytes(log.size_bytes, locale)}</span>
                                        <span className="hidden sm:inline">
                                          {formatDateTime(log.mtime * 1000, locale)}
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
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
                            value={sampleLayout}
                            onChange={setSampleLayout}
                            options={[
                              { value: "grid", label: <><LayoutGrid className="h-3 w-3" /><span>{t("workbench.layout.grid")}</span></>, title: t("workbench.layout.grid_title") },
                              { value: "list", label: <><List className="h-3 w-3" /><span>{t("workbench.layout.list")}</span></>, title: t("workbench.layout.list_title") },
                            ]}
                          />
                        )}
                      </div>

                      {sampleLayout === "grid" ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                          {sampleLogs.map((log) => {
                            const isSelected = selectedSampleId === log.id;
                            return (
                              <button
                                key={log.id}
                                type="button"
                                onClick={() => {
                                  setSelectedSampleId(log.id);
                                  setError(null);
                                }}
                                className={cn(
                                  "text-left p-3 rounded-lg transition-all duration-200 flex flex-col justify-between h-28 relative group",
                                  isSelected
                                    ? "bg-accent/[0.45]"
                                    : "bg-tile hover:bg-accent/[0.14]"
                                )}
                              >
                                <div>
                                  <div className="font-semibold text-xs">
                                    <span className="truncate">{log.name}</span>
                                  </div>
                                  <p className="text-[11px] text-muted/85 line-clamp-2 mt-1 leading-normal">
                                    {log.description}
                                  </p>
                                </div>
                                <div className="text-[9px] font-mono text-muted/60 mt-1 flex items-center justify-between w-full">
                                  <span className="truncate max-w-[70%]">{log.filename}</span>
                                  <span>{formatKilobytes(log.size_bytes, locale)}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 w-full">
                          {sampleLogs.map((log) => {
                            const isSelected = selectedSampleId === log.id;
                            return (
                              <button
                                key={log.id}
                                type="button"
                                onClick={() => {
                                  setSelectedSampleId(log.id);
                                  setError(null);
                                }}
                                className={cn(
                                  "text-left p-3 rounded-lg transition-all duration-200 flex items-center justify-between relative group w-full gap-4",
                                  isSelected
                                    ? "bg-accent/[0.45]"
                                    : "bg-tile hover:bg-accent/[0.14]"
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-xs text-fg truncate">
                                    {log.name}
                                  </div>
                                  <p className="text-[11px] text-muted/85 line-clamp-1 mt-0.5 leading-normal">
                                    {log.description}
                                  </p>
                                </div>
                                <div className="flex items-center gap-4 text-[9px] text-muted/50 shrink-0 ml-4">
                                  <span className="font-mono">{log.filename}</span>
                                  <span>{formatKilobytes(log.size_bytes, locale)}</span>
                                </div>
                              </button>
                            );
                          })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
              {/* Log overview: descriptive stats about the selected log. */}
              {!selectedJobDetail && logStats && (
                <LogOverviewCard
                  stats={logStats.stats}
                  filename={uploadDisplayMeta?.name ?? null}
                />
              )}

              {!selectedJobDetail && selected.parameters_schema.length > 0 && (
                <PresetBar
                  algorithmId={selected.id}
                  currentParams={params}
                  disabled={!!selectedJobId}
                  defaults={Object.fromEntries(
                    selected.parameters_schema.map((p) => [p.name, p.default]),
                  )}
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
                <div className="flex items-center justify-end gap-2 -mt-2 mb-1">
                  <span className="text-[11px] text-muted">
                    {paramsDiffOnly ? t("workbench.params.showing_modified") : t("workbench.params.showing_all")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setParamsDiffOnly((v) => !v)}
                    className="text-[11px] font-medium text-accent-ink hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 rounded px-1"
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
                            <span className="ml-1.5 font-normal text-muted">
                              · {t("workbench.secondary.optional")}
                            </span>
                          )}
                        </div>
                        {chosen ? (
                          <div className="bg-tile rounded-md px-2.5 py-2 flex items-center gap-2 text-[11px]">
                            <FileCheck2 className="h-3.5 w-3.5 text-accent-ink shrink-0" />
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
                              "flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-muted transition",
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
                        {sf.help && (
                          <p className="text-[11px] text-muted leading-snug">{sf.help}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div data-tour="single-params">
              <ParameterForm
                schema={selected.parameters_schema}
                algorithmId={selected.id}
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
              </div>
            </CardContent>
            <div className="px-5 pb-5 pt-3 border-t border-border flex flex-col gap-3">
              {progress && (
                <div className="w-full space-y-2 mb-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-muted truncate max-w-[80%]">{progress.status}</span>
                    <span className="font-bold text-accent-ink shrink-0">{formatPercent(progress.percentage / 100, locale)}</span>
                  </div>
                  <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-accent h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 w-full">
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
                    <>
                      {isJobRunning ? (
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
                      )}
                    </>
                  ) : (
                    <Button
                      onClick={run}
                      title={t("workbench.run_bar.run_title")}
                      disabled={!hasLog}
                      size="md"
                      data-tour="single-run"
                    >
                      <Play className="h-4 w-4" />
                      {t("common.run_analysis")}
                    </Button>
                  )}

                </div>
              </div>
            </div>
          </Card>
        )}

        {error && (
          <div className="rounded-lg bg-danger/10 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-danger-ink shrink-0 mt-0.5" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        {result && <ResultPanel result={result} runId={selectedJobId} />}
      </section>
    </div>
  );
}
