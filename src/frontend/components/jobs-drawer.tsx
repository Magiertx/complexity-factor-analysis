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
  Database,
  History,
  CheckCircle2,
  XCircle,
  CircleSlash,
  CircleStop,
} from "lucide-react";
import {
  AlgorithmManifest,
  Job,
  abortTask,
  deleteAllJobs,
  deleteJob,
  fetchAlgorithms,
  fetchJobs,
} from "@/lib/api";
import { datasetJobHref, datasetJobSubtitle, jobDisplayName, jobTitle } from "@/lib/factor-analysis";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { formatDateTime, formatPercent } from "@/lib/i18n/local-format";
import { Button } from "./ui/button";

// How a job was started, derived from the `algorithm_id` prefix: runs of the
// removed batch mode are stored as "_batch:<algo>", factor analysis datasets as
// "_dataset:<kind>". A single run has no prefix.
type RunMode = "single" | "batch" | "dataset";

interface RunInfo {
  mode: RunMode;
  innerAlgoId: string | null;
  href: string;
}

function deriveRunInfo(job: Job): RunInfo {
  const aid = job.algorithm_id;
  const datasetHref = datasetJobHref(job);
  if (datasetHref) return { mode: "dataset", innerAlgoId: null, href: datasetHref };
  if (aid.startsWith("_batch:")) {
    return {
      mode: "batch",
      innerAlgoId: aid.slice("_batch:".length),
      href: `/inspect?job=${job.id}`,
    };
  }
  return { mode: "single", innerAlgoId: aid, href: `/inspect?job=${job.id}` };
}

// label is an i18n key.
const MODE_META: Record<RunMode, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  single: { label: "jobs.mode.single", icon: Play },
  batch: { label: "jobs.mode.batch", icon: Layers },
  dataset: { label: "jobs.mode.dataset", icon: Database },
};

// ----------------------- Context -----------------------

interface JobsDrawerContextValue {
  open: boolean;
  /** The drawer slides over the page instead of being a column next to it. */
  overlay: boolean;
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

// What Tab reaches inside the drawer while it is a dialog.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

// Routes on which the jobs panel is shown as a layout column: the single-log workbench.
export const PANEL_ROUTES = new Set(["/inspect"]);
// Routes on which it slides over the page instead, at every width: the factor analysis tabs,
// whose step layout a column would squeeze.
export const OVERLAY_ROUTES = new Set(["/", "/log"]);

export function hasJobsPanel(pathname: string) {
  return PANEL_ROUTES.has(pathname) || OVERLAY_ROUTES.has(pathname);
}

export function JobsDrawerProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const overlay = OVERLAY_ROUTES.has(pathname);
  // Default `false` for SSR consistency; the effect below switches to `true`
  // after mount on lg+ viewports (or restores the state from localStorage).
  const [panelOpen, setPanelOpen] = useState(false);
  // The overlay is neither remembered nor opened by default: open on load it would cover the
  // page. It closes when the page changes.
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    setOverlayOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("app.jobs-drawer-open");
      if (stored !== null) {
        setPanelOpen(stored === "true");
      } else if (window.matchMedia("(min-width: 1024px)").matches) {
        setPanelOpen(true);
      }
    } catch {
      if (window.matchMedia("(min-width: 1024px)").matches) {
        setPanelOpen(true);
      }
    }
  }, []);

  const setOpenWithStorage = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setPanelOpen((prev) => {
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

  const open = overlay ? overlayOpen : panelOpen;
  const setOpen = overlay ? setOverlayOpen : setOpenWithStorage;
  const toggle = useCallback(() => setOpen((v) => !v), [setOpen]);
  const value = useMemo(
    () => ({ open, overlay, setOpen, toggle, count, setCount }),
    [open, overlay, setOpen, toggle, count],
  );
  return <JobsDrawerContext.Provider value={value}>{children}</JobsDrawerContext.Provider>;
}

// ----------------------- Drawer -----------------------

export function JobsDrawer() {
  const t = useT();
  const { open, overlay, setOpen, setCount } = useJobsDrawer();
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
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Rendered on the client only: the drawer starts closed anyway, and its texts would follow
  // the stored language before React hydrates this Suspense boundary, which then mismatches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Only shown where jobs are started. Elsewhere the run history page lists the jobs.
  const shown = hasJobsPanel(pathname) && mounted;

  const algoById = useMemo(() => {
    const m = new Map<string, AlgorithmManifest>();
    for (const a of algorithms) m.set(a.id, a);
    return m;
  }, [algorithms]);

  // Load the manifests once; only needed for the algorithm names of old batch runs.
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

    // Only the updates wait while the tab is hidden; the first load does not, or a page opened
    // in a background tab would show nothing until it is looked at.
    const refresh = async (always = false) => {
      if (document.hidden && !always) return;
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

    refresh(true);

    const sseUrl = process.env.NEXT_PUBLIC_SSE_URL || "/api/jobs/events";
    try {
      es = new EventSource(sseUrl);
      es.onmessage = (e) => {
        if (e.data === "update" || e.data === "initial") void refresh();
      };
      es.onerror = () => {
        /* polling deckt's ab */
      };
    } catch {
      /* SSE not supported */
    }

    timer = setInterval(() => void refresh(), 10000);

    const onVisible = () => {
      if (!document.hidden) void refresh();
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

  // Over the page, the drawer is a modal dialog while it is open: it takes the focus, keeps Tab
  // inside, holds the page behind it still and hands the focus back when it closes. As a column
  // next to the page it leaves the focus where it is.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel || !(overlay || !window.matchMedia("(min-width: 1024px)").matches)) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const elements = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const inside = panel.contains(document.activeElement);
      if (e.shiftKey ? !inside || document.activeElement === first : !inside || document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", trap);

    // The padding takes the place of the scrollbar, so the page does not shift sideways.
    const body = document.body.style;
    const locked = { overflow: body.overflow, paddingRight: body.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.overflow = "hidden";
    if (scrollbar > 0) body.paddingRight = `${scrollbar}px`;

    return () => {
      window.removeEventListener("keydown", trap);
      body.overflow = locked.overflow;
      body.paddingRight = locked.paddingRight;
      const focus = document.activeElement;
      if (!focus || focus === document.body || panel.contains(focus)) previous?.focus();
    };
  }, [open, shown, overlay]);

  const handleClearAll = async () => {
    if (!confirm(t("jobs.clear_all_confirm"))) return;
    await deleteAllJobs();
    setJobs([]);
    setCount(0);
  };

  // A deleted card takes the focus with it; the drawer keeps it.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (document.activeElement === document.body) closeRef.current?.focus();
  }, [jobs]);

  const handleDelete = async (id: string) => {
    await deleteJob(id);
    refocus.current = true;
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setCount(jobs.length - 1);
  };

  const handleAbort = async (id: string) => {
    if (await abortTask(id)) {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "aborted" } : j)));
    }
  };

  if (!shown) return null;

  return (
    <>
      {/* Backdrop below lg and wherever the drawer is an overlay; a column needs no dimming */}
      {open && (
        <div
          className={cn("fixed inset-0 bg-black/40 z-40 transition-opacity", !overlay && "lg:hidden")}
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/*
        Mobile (default classes): fixed right-side drawer with shadow,
        slides in and out via translate-x. The overlay routes keep this at
        every width.
        lg+ elsewhere: becomes a static layout column; open/close collapses
        the width instead of translating, and shadow and left border go away.
        Closed, it is inert, so its links cannot be reached with Tab.
      */}
      <aside
        id="jobs-drawer"
        ref={panelRef}
        role={open ? "dialog" : undefined}
        aria-modal={open ? "true" : undefined}
        aria-label={t("jobs.archive_aria")}
        inert={!open}
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
          !overlay &&
            "lg:sticky lg:top-0 lg:self-start lg:h-[calc(100vh_-_157px)] lg:max-w-none lg:bg-transparent lg:border-l-0 lg:shadow-none lg:z-auto",
          // Mobile slide (reset on desktop via lg:translate-x-0)
          open ? "translate-x-0" : "translate-x-full",
          !overlay && "lg:translate-x-0",
          // Desktop collapse animates the width, not the inner card. The inner
          // wrapper has a fixed width, so it is clipped instead of reflowed
          // while the aside shrinks to 0.
          !overlay && (open ? "lg:w-[340px] lg:opacity-100" : "lg:w-0 lg:opacity-0 lg:pointer-events-none"),
        )}
      >
        {/* Fixed-width inner wrapper decouples the content layout from the
            width animation outside, so the cards stay stable. */}
        <div
          className={cn(
            "flex flex-col h-full",
            "w-[360px] max-w-[90vw]",
            !overlay && "lg:w-[340px] lg:max-w-none lg:py-6 lg:pr-4 lg:pl-2",
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
              !overlay && "lg:bg-surface lg:rounded-lg",
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
                    className="h-6 px-1.5 inline-flex items-center gap-1 rounded text-[10px] font-medium text-muted hover:text-danger-ink hover:bg-danger/10 transition appearance-none"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t("jobs.clear_button")}</span>
                  </button>
                )}
                <button
                  ref={closeRef}
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
                  onAbort={() => handleAbort(job.id)}
                  // The page under the overlay is where the link leads; uncover it.
                  onOpen={overlay ? () => setOpen(false) : undefined}
                />
              ))}
            </div>
          )}
            </div>

            {/* Prominent "View all" footer at the bottom, so the full history
                page is easy to find. */}
            <Link
              href="/runs"
              className="shrink-0 border-t border-border px-4 py-3 flex items-center justify-between text-sm font-medium text-fg hover:bg-accent/[0.08] hover:text-accent-ink transition group"
            >
              <span className="flex items-center gap-2">
                <History className="h-4 w-4" />
                {t("jobs.view_all")}
              </span>
              <ChevronRight className="h-4 w-4 text-muted group-hover:text-accent-ink group-hover:translate-x-0.5 transition-transform" />
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
  onAbort,
  onOpen,
}: {
  job: Job;
  active: boolean;
  algoById: Map<string, AlgorithmManifest>;
  onDelete: () => Promise<void>;
  onAbort: () => void;
  onOpen?: () => void;
}) {
  const { t, locale } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const info = deriveRunInfo(job);
  // A dataset job takes its dataset along, maybe the result of a long computation, so its
  // delete is confirmed like the other deletes of a dataset. Other jobs go at once.
  const confirmDelete = info.mode === "dataset";
  // The buttons sit inside the card's link.
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };
  const ModeIcon = MODE_META[info.mode].icon;
  const innerAlgo = info.innerAlgoId ? algoById.get(info.innerAlgoId) : null;
  const activeJob = job.status === "pending" || job.status === "running";

  const shortAlgo =
    info.mode === "batch"
      ? `${t(MODE_META[info.mode].label)}: ${innerAlgo?.name.split(" — ")[0] ?? info.innerAlgoId}`
      : info.mode === "dataset"
        ? jobTitle(job, t)
        : jobDisplayName(job, t).split(" — ")[0];
  const subtitle = datasetJobSubtitle(job, t) ?? job.filename;

  const dateStr = formatDateTime(job.created_at * 1000, locale);

  return (
    <Link
      href={info.href}
      onClick={onOpen}
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
            className="h-5 w-5 rounded grid place-items-center bg-accent/[0.18] text-accent-ink"
            title={t("jobs.run_mode_title", { mode: t(MODE_META[info.mode].label) })}
          >
            <ModeIcon className="h-3 w-3" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-fg truncate" title={shortAlgo}>
            {shortAlgo}
          </div>
          <div className="text-[11px] text-muted truncate" title={subtitle}>
            {subtitle}
          </div>
        </div>
        {/* Visible without hovering: the job limit tells users to abort jobs here. */}
        {activeJob && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAbort();
            }}
            aria-label={t("jobs.abort_job_aria")}
            title={t("jobs.abort_job_aria")}
            className="shrink-0 text-muted hover:text-danger-ink transition p-0.5 rounded hover:bg-danger/10"
          >
            <CircleStop className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          ref={askRef}
          type="button"
          onClick={(e) => {
            stop(e);
            if (confirmDelete) setConfirming((c) => !c);
            else onDelete();
          }}
          aria-label={t(confirmDelete ? "jobs.delete_dataset_job_aria" : "jobs.delete_job_aria")}
          aria-expanded={confirmDelete ? confirming : undefined}
          title={confirmDelete ? t("jobs.delete_dataset_job_aria") : undefined}
          className={cn(
            // Without hover, as on a touch screen, it is always shown.
            "shrink-0 text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 hover:text-danger-ink transition p-0.5 rounded hover:bg-danger/10",
            confirming && "opacity-100",
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {confirming && (
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button
            size="sm"
            variant="primary"
            className="h-7 px-2.5 text-xs bg-danger hover:bg-danger/90"
            onClick={(e) => {
              stop(e);
              remove();
            }}
            disabled={deleting}
            autoFocus
          >
            {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
            {t("jobs.delete_dataset_job_confirm")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-xs"
            onClick={(e) => {
              stop(e);
              setConfirming(false);
              askRef.current?.focus();
            }}
            disabled={deleting}
          >
            {t("common.cancel")}
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between text-[10px] font-medium">
        <StatusBadge job={job} />
        <span className="font-mono text-muted/60">{dateStr}</span>
      </div>
    </Link>
  );
}

function StatusBadge({ job }: { job: Job }) {
  const { t, locale } = useLocale();
  if (job.status === "completed")
    return (
      <span className="flex items-center gap-1 text-success-ink">
        <CheckCircle2 className="h-3 w-3" />
        {t("jobs.status_completed")}
      </span>
    );
  if (job.status === "failed")
    return (
      <span className="flex items-center gap-1 text-danger-ink">
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
    <span className="flex items-center gap-1 text-accent-ink">
      <Loader2 className="h-3 w-3 animate-spin" />
      {job.status === "running"
        ? t("jobs.status_running", { pct: formatPercent(job.percentage / 100, locale) })
        : t("jobs.status_pending")}
    </span>
  );
}
