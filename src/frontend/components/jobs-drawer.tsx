"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  X,
  Loader2,
  Trash2,
  ChevronRight,
  Play,
  Layers,
  BarChart3,
  History,
  CheckCircle2,
  XCircle,
  CircleSlash,
} from "lucide-react";
import {
  AlgorithmManifest,
  Job,
  deleteAllJobs,
  deleteJob,
  fetchAlgorithms,
  fetchJobs,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// How a job was started, derived from the `algorithm_id` prefix (see
// routes/algorithms.py: batch runs are stored as "_batch:<algo>"). A single
// run has no prefix.
type RunMode = "single" | "batch";

interface RunInfo {
  mode: RunMode;
  innerAlgoId: string | null;
  href: string;
}

function deriveRunInfo(job: Job): RunInfo {
  const aid = job.algorithm_id;
  if (aid.startsWith("_batch:")) {
    return {
      mode: "batch",
      innerAlgoId: aid.slice("_batch:".length),
      href: `/?job=${job.id}`,
    };
  }
  return { mode: "single", innerAlgoId: aid, href: `/?job=${job.id}` };
}

const MODE_META: Record<RunMode, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  single: { label: "Single", icon: Play },
  batch: { label: "Batch", icon: Layers },
};

const TOOL_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  complexity: BarChart3,
};

// ----------------------- Context -----------------------

interface JobsDrawerContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  // Job count for the badge on the mode-bar button. Filled in by the drawer
  // once it has loaded the list (or on an SSE update).
  count: number;
  setCount: (n: number) => void;
}

const JobsDrawerContext = createContext<JobsDrawerContextValue | null>(null);

export function useJobsDrawer() {
  const ctx = useContext(JobsDrawerContext);
  if (!ctx) throw new Error("useJobsDrawer must be used inside <JobsDrawerProvider>");
  return ctx;
}

// Builder routes on which the jobs panel is shown as a layout column. Same as
// MODE_HREFS in mode-bar.tsx, duplicated to avoid a circular import between
// mode-bar and jobs-drawer.
const PANEL_ROUTES = new Set(["/"]);

export function JobsDrawerProvider({ children }: { children: React.ReactNode }) {
  // Default `false` for SSR consistency; the effect below switches to `true`
  // after mount on lg+ viewports (or restores the state from localStorage).
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("app.jobs-drawer-open");
      if (stored !== null) {
        setOpen(stored === "true");
      } else if (window.matchMedia("(min-width: 1024px)").matches) {
        setOpen(true);
      }
    } catch {
      if (window.matchMedia("(min-width: 1024px)").matches) {
        setOpen(true);
      }
    }
  }, []);

  const setOpenWithStorage = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setOpen((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      try {
        if (window.matchMedia("(min-width: 1024px)").matches) {
          localStorage.setItem("app.jobs-drawer-open", String(next));
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggle = useCallback(() => setOpenWithStorage((v) => !v), [setOpenWithStorage]);
  const value = useMemo(
    () => ({ open, setOpen: setOpenWithStorage, toggle, count, setCount }),
    [open, setOpenWithStorage, toggle, count],
  );
  return <JobsDrawerContext.Provider value={value}>{children}</JobsDrawerContext.Provider>;
}

// ----------------------- Drawer -----------------------

export function JobsDrawer() {
  const t = useT();
  const { open, setOpen, setCount } = useJobsDrawer();
  const pathname = usePathname();
  // The open job always arrives as a ?job=<id> deep link (that is how job
  // cards and the run history navigate), which lets us highlight the active
  // card, like the algorithm selection in the sidebar.
  const searchParams = useSearchParams();
  const activeJobId = searchParams.get("job");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [algorithms, setAlgorithms] = useState<AlgorithmManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Only shown on builder pages (mode-bar routes). On /runs, /settings and
  // /api-access the page itself manages jobs, so the panel would be redundant.
  const isBuilderRoute = PANEL_ROUTES.has(pathname);

  const algoById = useMemo(() => {
    const m = new Map<string, AlgorithmManifest>();
    for (const a of algorithms) m.set(a.id, a);
    return m;
  }, [algorithms]);

  // Load the manifests once; only needed for tool_type and algorithm names.
  useEffect(() => {
    fetchAlgorithms()
      .then((res) => setAlgorithms(res.algorithms))
      .catch(() => {});
  }, []);

  // Initial load plus SSE updates, with a 10s polling fallback like in
  // workbench.tsx, so a buffering reverse proxy cannot leave the drawer stale.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;

    const refresh = async () => {
      if (document.hidden) return;
      try {
        const list = await fetchJobs();
        if (!active) return;
        setJobs(list);
        setCount(list.length);
        setLoading(false);
      } catch {
        /* ignore */
      }
    };

    refresh();

    const sseUrl = process.env.NEXT_PUBLIC_SSE_URL || "/api/jobs/events";
    try {
      es = new EventSource(sseUrl);
      es.onmessage = (e) => {
        if (e.data === "update" || e.data === "initial") refresh();
      };
      es.onerror = () => {
        /* polling deckt's ab */
      };
    } catch {
      /* SSE not supported */
    }

    timer = setInterval(refresh, 10000);

    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      if (es) es.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [setCount]);

  // Escape closes, like the workbench mobile drawer.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  const handleClearAll = async () => {
    if (!confirm(t("jobs.clear_all_confirm"))) return;
    await deleteAllJobs();
    setJobs([]);
    setCount(0);
  };

  const handleDelete = async (id: string) => {
    await deleteJob(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setCount(jobs.length - 1);
  };

  if (!isBuilderRoute) return null;

  return (
    <>
      {/* Mobile backdrop; the desktop layout column needs no dimming */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/*
        Mobile (default classes): fixed right-side drawer with shadow,
        slides in and out via translate-x.
        lg+: becomes a static layout column; open/close collapses the width
        instead of translating, and shadow and left border go away.
      */}
      <aside
        ref={panelRef}
        role={open ? "dialog" : undefined}
        aria-modal={open ? "true" : undefined}
        aria-label={t("jobs.archive_aria")}
        className={cn(
          "shrink-0 transition-all duration-300 ease-out overflow-hidden",
          // Mobile baseline: fixed drawer, decorations directly on the aside
          "fixed right-0 top-0 h-full w-[360px] max-w-[90vw] bg-surface border-l border-border z-50 shadow-2xl",
          // Desktop: transparent aside, the card is the rounded tile in the
          // inner wrapper. Sticky with a fixed height instead of growing with
          // the column, so the job list scrolls internally and the "View all"
          // footer stays visible. 157px = header (69) + mode bar (88), the
          // column's offset from the viewport top. The aside's own
          // overflow-hidden does not break sticky; only overflow on an
          // ancestor would, and row and body have none.
          "lg:sticky lg:top-0 lg:self-start lg:h-[calc(100vh_-_157px)] lg:max-w-none lg:bg-transparent lg:border-l-0 lg:shadow-none lg:z-auto",
          // Mobile slide (reset on desktop via lg:translate-x-0)
          open ? "translate-x-0" : "translate-x-full",
          "lg:translate-x-0",
          // Desktop collapse animates the width, not the inner card. The inner
          // wrapper has a fixed width, so it is clipped instead of reflowed
          // while the aside shrinks to 0.
          open
            ? "lg:w-[340px] lg:opacity-100"
            : "lg:w-0 lg:opacity-0 lg:pointer-events-none",
        )}
      >
        {/* Fixed-width inner wrapper decouples the content layout from the
            width animation outside, so the cards stay stable. */}
        <div
          className={cn(
            "flex flex-col h-full",
            "w-[360px] max-w-[90vw]",
            "lg:w-[340px] lg:max-w-none lg:py-6 lg:pr-4 lg:pl-2",
            // The wrapper fills the aside, which is fixed to viewport height.
          )}
        >
          {/* Card tile: rounded surface on desktop; on mobile the aside already
              carries these decorations. h-full fills the fixed aside: header
              and footer are shrink-0, the job list (flex-1) scrolls internally
              and the "View all" footer stays pinned at the bottom. */}
          <div
            className={cn(
              "flex flex-col h-full overflow-hidden",
              "lg:bg-surface lg:rounded-lg",
            )}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted" />
                <span className="flex items-baseline gap-1.5">
                  <h2 className="text-sm font-semibold">{t("jobs.heading")}</h2>
                  <span className="text-[10px] font-mono text-muted">({jobs.length})</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {jobs.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    title={t("jobs.clear_all_title")}
                    className="h-6 px-1.5 inline-flex items-center gap-1 rounded text-[10px] font-medium text-muted hover:text-danger hover:bg-danger/10 transition appearance-none"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t("jobs.clear_button")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("jobs.close_drawer_aria")}
                  className="h-6 w-6 grid place-items-center rounded hover:bg-tile text-muted hover:text-fg transition appearance-none"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center gap-2 justify-center py-8 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("jobs.loading")}
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-xs text-muted/60 italic p-3 text-center bg-tile/40 rounded-lg">
              {t("jobs.no_runs_yet")}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  active={job.id === activeJobId}
                  algoById={algoById}
                  onDelete={() => handleDelete(job.id)}
                />
              ))}
            </div>
          )}
            </div>

            {/* Prominent "View all" footer at the bottom, so the full history
                page is easy to find. */}
            <Link
              href="/runs"
              className="shrink-0 border-t border-border px-4 py-3 flex items-center justify-between text-sm font-medium text-fg hover:bg-accent/[0.08] hover:text-accent transition group"
            >
              <span className="flex items-center gap-2">
                <History className="h-4 w-4" />
                {t("jobs.view_all")}
              </span>
              <ChevronRight className="h-4 w-4 text-muted group-hover:text-accent group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}

// ----------------------- Card -----------------------

function JobCard({
  job,
  active,
  algoById,
  onDelete,
}: {
  job: Job;
  active: boolean;
  algoById: Map<string, AlgorithmManifest>;
  onDelete: () => void;
}) {
  const t = useT();
  const info = deriveRunInfo(job);
  const ModeIcon = MODE_META[info.mode].icon;
  const innerAlgo = info.innerAlgoId ? algoById.get(info.innerAlgoId) : null;
  const toolType = innerAlgo?.tool_type ?? null;
  const ToolTypeIcon = toolType ? TOOL_TYPE_ICON[toolType] : null;

  const shortAlgo =
    info.mode === "single"
      ? job.algorithm_name.split(" — ")[0]
      : `${MODE_META[info.mode].label}: ${innerAlgo?.name.split(" — ")[0] ?? info.innerAlgoId}`;

  const dateStr = new Date(job.created_at * 1000).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link
      href={info.href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative rounded-lg transition flex flex-col gap-1.5 p-2.5 overflow-hidden",
        active
          ? "bg-accent/[0.14] pl-3 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r before:bg-accent"
          : "bg-tile hover:bg-accent/[0.10]",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          <span
            className="h-5 w-5 rounded grid place-items-center bg-accent/[0.18] text-accent"
            title={t("jobs.run_mode_title", { mode: MODE_META[info.mode].label })}
          >
            <ModeIcon className="h-3 w-3" />
          </span>
          {ToolTypeIcon && (
            <span
              className="h-5 w-5 rounded grid place-items-center bg-muted/15 text-muted"
              title={t("jobs.tool_type_title", { type: toolType ?? "" })}
            >
              <ToolTypeIcon className="h-3 w-3" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-fg truncate">{shortAlgo}</div>
          <div className="text-[11px] text-muted truncate">{job.filename}</div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          aria-label={t("jobs.delete_job_aria")}
          className="shrink-0 text-muted opacity-0 group-hover:opacity-100 hover:text-danger transition p-0.5 rounded hover:bg-danger/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-between text-[10px] font-medium">
        <StatusBadge job={job} />
        <span className="font-mono text-muted/60">{dateStr}</span>
      </div>
    </Link>
  );
}

function StatusBadge({ job }: { job: Job }) {
  const t = useT();
  if (job.status === "completed")
    return (
      <span className="flex items-center gap-1 text-success">
        <CheckCircle2 className="h-3 w-3" />
        {t("jobs.status_completed")}
      </span>
    );
  if (job.status === "failed")
    return (
      <span className="flex items-center gap-1 text-danger">
        <XCircle className="h-3 w-3" />
        {t("jobs.status_failed")}
      </span>
    );
  if (job.status === "aborted")
    return (
      <span className="flex items-center gap-1 text-muted">
        <CircleSlash className="h-3 w-3" />
        {t("jobs.status_aborted")}
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-accent">
      <Loader2 className="h-3 w-3 animate-spin" />
      {job.status === "running"
        ? t("jobs.status_running", { pct: job.percentage })
        : t("jobs.status_pending")}
    </span>
  );
}
