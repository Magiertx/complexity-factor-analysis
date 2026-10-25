"use client";

import { InfoTip } from "@/components/ui/info-tip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CircleSlash,
  CircleStop,
  History as HistoryIcon,
  Loader2,
  Microscope,
  Network,
  ScrollText,
  Search,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  abortTask,
  deleteDataset,
  deleteJob,
  fetchFactorCatalog,
  listDatasets,
  type DatasetSource,
  type FactorCatalog,
  type FactorKind,
} from "@/lib/api";
import {
  datasetJobSubtitle,
  datasetName,
  jobErrorText,
  jobTitle,
  publishedOptions,
} from "@/lib/factor-analysis";
import {
  dayKey,
  historyHref,
  historyRows,
  parseTypeFilter,
  savedSettingsText,
  type HistoryRow,
  type HistoryStatus,
  type HistoryType,
  type TypeFilter,
} from "@/lib/history";
import { formatDate, formatDateTime, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import { localizeCatalog, useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useJobs } from "./jobs-provider";
import { JobNotesField } from "./job-notes-field";
import { PageHeader } from "./page-header";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { Notice } from "./ui/notice";
import { IconButton } from "./ui/icon-button";
import { Input } from "./ui/input";
import { ScrollFade } from "./ui/scroll-fade";
import { Segmented } from "./ui/segmented";
import { useTip } from "./ui/tip";

type StatusFilter = "all" | HistoryStatus;

const TYPE_ICON: Record<HistoryType, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  model: Network,
  log: ScrollText,
  single: Microscope,
};

const SOURCES: DatasetSource[] = ["bundled", "csv", "logs", "pnml"];

/** The datasets are read again this often while the page is open; jobs come with their events. */
const DATASETS_POLL_MS = 15_000;

/**
 * The History of the session, one list for everything, newest first: every dataset of both tabs,
 * with the settings of its last analysis and the job that computed it, and every run of a single
 * log. A row opens where it belongs, can be aborted while it runs, and deleted: a dataset with its
 * job, a job with its dataset. It keeps itself current.
 */
export function RunHistoryView() {
  const { t, tMaybe, locale } = useLocale();
  const params = useSearchParams();
  const { jobs, loaded: jobsLoaded, refresh } = useJobs();
  const [datasets, setDatasets] = useState<Awaited<ReturnType<typeof listDatasets>> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rawCatalogs, setRawCatalogs] = useState<Partial<Record<FactorKind, FactorCatalog>>>({});
  const [type, setType] = useState<TypeFilter>(() => parseTypeFilter(params.get("type")));
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // The confirmation takes the place of the delete button, and a deleted row takes the focus with
  // it, so the focus is moved by hand: back to the delete button of the row, or to the row that took
  // the place of a deleted one ("" for the list itself).
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);

  // A link from another page can ask for one type, e.g. the single runs (?type=single).
  const asked = params.get("type");
  useEffect(() => setType(parseTypeFilter(asked)), [asked]);
  const chooseType = (next: TypeFilter) => {
    setType(next);
    // In the address, so the way back from the guide or the settings finds the same list.
    window.history.replaceState(null, "", next === "all" ? "/runs" : `/runs?type=${next}`);
  };

  // The names of the bundled datasets in the language of the UI, and the settings of their papers.
  useEffect(() => {
    const ctrl = new AbortController();
    for (const kind of ["model", "log"] as const) {
      fetchFactorCatalog(kind, ctrl.signal).then(
        (catalog) => setRawCatalogs((c) => ({ ...c, [kind]: catalog })),
        () => {
          // Without it the rows keep the server's names.
        },
      );
    }
    return () => ctrl.abort();
  }, []);
  const catalogs = useMemo(
    () => ({
      model: rawCatalogs.model && localizeCatalog(rawCatalogs.model, locale),
      log: rawCatalogs.log && localizeCatalog(rawCatalogs.log, locale),
    }),
    [rawCatalogs, locale],
  );

  const loadDatasets = useCallback(async () => {
    try {
      setDatasets(await listDatasets());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("run_history.load_failed_fallback"));
      setDatasets((d) => d ?? []);
    }
  }, [t]);
  // Again whenever a job comes, goes or changes its status (a dataset is computed, deleted with
  // its job), and every little while for the datasets that come without a job.
  const jobsKey = jobs.map((j) => `${j.id}:${j.status}`).join(",");
  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets, jobsKey]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void loadDatasets();
    }, DATASETS_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void loadDatasets();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadDatasets]);

  const rows = useMemo(() => historyRows(datasets ?? [], jobs), [datasets, jobs]);

  const title = useCallback(
    (row: HistoryRow): string => {
      if (row.dataset) return datasetName(row.dataset, t, catalogs[row.dataset.kind]);
      if (row.job && row.type !== "single") return jobTitle(row.job, t);
      return row.job?.filename ?? "";
    },
    [t, catalogs],
  );

  const ofType = useMemo(() => rows.filter((r) => type === "all" || r.type === type), [rows, type]);
  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = { all: ofType.length, active: 0, completed: 0, failed: 0, aborted: 0 };
    for (const r of ofType) out[r.status]++;
    return out;
  }, [ofType]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ofType.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return [title(r), r.job?.filename, r.job?.id, r.dataset?.id, r.dataset?.name]
        .filter((x): x is string => !!x)
        .some((x) => x.toLowerCase().includes(q));
    });
  }, [ofType, status, search, title]);

  // Grouped by the day they were made: today, yesterday, then the date.
  const days = useMemo(() => {
    const out: { key: string; label: string; rows: HistoryRow[] }[] = [];
    const today = dayKey(Date.now());
    const yesterday = dayKey(Date.now() - 24 * 3600 * 1000);
    for (const row of filtered) {
      const key = dayKey(row.time);
      let day = out.find((d) => d.key === key);
      if (!day) {
        const label =
          key === today ? t("run_history.today") : key === yesterday ? t("run_history.yesterday") : formatDate(row.time, locale);
        day = { key, label, rows: [] };
        out.push(day);
      }
      day.rows.push(row);
    }
    return out;
  }, [filtered, t, locale]);

  useEffect(() => {
    const key = refocus.current;
    if (key === null) return;
    refocus.current = null;
    (deleteButtons.current.get(key) ?? listRef.current)?.focus();
  }, [confirming, rows]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  const remove = async (row: HistoryRow) => {
    try {
      if (row.dataset) await deleteDataset(row.dataset.id);
      else if (row.job) await deleteJob(row.job.id);
      const i = filtered.findIndex((r) => r.key === row.key);
      refocus.current = (filtered[i + 1] ?? filtered[i - 1])?.key ?? "";
      if (row.dataset) setDatasets((list) => list && list.filter((d) => d.id !== row.dataset?.id));
      setConfirming(null);
      showToast(t(row.dataset ? "run_history.toast_dataset_deleted" : "run_history.toast_run_deleted"));
      await refresh();
    } catch {
      showToast(t("run_history.toast_delete_failed"));
    }
  };

  const abort = async (row: HistoryRow) => {
    if (row.job && (await abortTask(row.job.id))) await refresh();
  };

  const loading = datasets === null || !jobsLoaded;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("run_history.heading")}
        subtitle={t("run_history.subtitle_short")}
        info={t("run_history.subtitle")}
        actions={
          // Always rendered, so screen readers announce each toast that appears in it.
          <div role="status">
            {toast && (
              <span className="flex items-center gap-1.5 text-xs text-muted bg-tile rounded-md px-3 py-2">
                <Check className="h-3.5 w-3.5 text-success-ink" aria-hidden />
                {toast}
              </span>
            )}
          </div>
        }
      />

      {loadError && (
        <Notice tone="error" role="alert">
          {t("run_history.load_error", { error: loadError })}
        </Notice>
      )}

      <Card>
        <CardContent className="space-y-3">
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" aria-hidden />
            <Input
              type="search"
              placeholder={t("run_history.search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label={t("run_history.search_aria")}
            />
          </div>
          {/* Each row of filters scrolls on its own on a phone, where it is wider than the page. */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
            <ScrollFade className="min-w-0">
              <Segmented<TypeFilter>
                aria-label={t("run_history.filter_type_aria")}
                className="min-w-max"
                value={type}
                onChange={chooseType}
                options={(["all", "model", "log", "single"] as const).map((v) => ({ value: v, label: t(`run_history.type.${v}`) }))}
              />
            </ScrollFade>
            <ScrollFade className="min-w-0">
              <Segmented<StatusFilter>
                aria-label={t("run_history.filter_status_aria")}
                className="min-w-max"
                value={status}
                onChange={setStatus}
                options={(["all", "active", "completed", "failed", "aborted"] as const).map((v) => ({
                  value: v,
                  label: t(`run_history.status_${v}`, { n: counts[v] }),
                }))}
              />
            </ScrollFade>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("common.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<HistoryIcon className="h-5 w-5" aria-hidden />}>
                {rows.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    {t("run_history.empty")}
                    <InfoTip topic={t("run_history.empty")} text={t("run_history.empty_more")} />
                  </span>
                ) : (
                  t("run_history.none_match")
                )}
              </EmptyState>
            </div>
          ) : (
            <div ref={listRef} tabIndex={-1} className="outline-none">
              {days.map((day) => (
                <section key={day.key} aria-labelledby={`history-day-${day.key}`} className="border-t border-border first:border-t-0">
                  <h2 id={`history-day-${day.key}`} className="px-4 pt-3 pb-1 text-xs font-semibold text-muted">
                    {day.label}
                  </h2>
                  <ul className="divide-y divide-border">
                    {day.rows.map((row) => (
                      <HistoryItem
                        key={row.key}
                        row={row}
                        title={title(row)}
                        catalog={row.dataset ? catalogs[row.dataset.kind] : undefined}
                        confirming={confirming === row.key}
                        onAsk={() => setConfirming(row.key)}
                        onCancel={() => {
                          refocus.current = row.key;
                          setConfirming(null);
                        }}
                        onDelete={() => remove(row)}
                        onAbort={() => abort(row)}
                        onNotes={() => void refresh()}
                        deleteRef={(el) => {
                          if (el) deleteButtons.current.set(row.key, el);
                          else deleteButtons.current.delete(row.key);
                        }}
                        errorText={row.job ? jobErrorText(row.job, tMaybe) : undefined}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryItem({
  row,
  title,
  catalog,
  confirming,
  onAsk,
  onCancel,
  onDelete,
  onAbort,
  onNotes,
  deleteRef,
  errorText,
}: {
  row: HistoryRow;
  title: string;
  catalog: FactorCatalog | undefined;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onDelete: () => Promise<void>;
  onAbort: () => void;
  onNotes: () => void;
  deleteRef: (el: HTMLButtonElement | null) => void;
  errorText: string | undefined;
}) {
  const { t, locale } = useLocale();
  const [deleting, setDeleting] = useState(false);
  const { dataset, job } = row;
  const Icon = TYPE_ICON[row.type];
  const typeTip = useTip<HTMLSpanElement>({ name: t(`run_history.type.${row.type}`) });
  const timeTip = useTip<HTMLElement>({ more: formatDateTime(row.time, locale) });

  // What it is: the tab and source of a dataset with its size, or the miners of a single run.
  const source = dataset && SOURCES.find((s) => s === dataset.source);
  const miners = row.type === "single" && Array.isArray(job?.params?.discovery_algorithms) ? (job.params.discovery_algorithms as string[]) : [];
  const facts = [
    row.type === "single" ? t("mode_bar.inspect_label") : t(`mode_bar.${row.type}_label`),
    source ? t(`factor.data.source.${source}`) : null,
    dataset && dataset.n_observations !== null && dataset.n_measures !== null
      ? `${formatNumber(dataset.n_observations, locale)} × ${formatNumber(dataset.n_measures, locale)}`
      : null,
    !dataset && job && row.type !== "single" ? datasetJobSubtitle(job, t)?.split(" · ").slice(1).join(" · ") || null : null,
    miners.length > 0 ? miners.join(", ") : null,
  ].filter((x): x is string => !!x);
  const settings =
    dataset && dataset.status === "ready"
      ? savedSettingsText(
          dataset.kind,
          dataset.options,
          dataset.n_measures,
          publishedOptions(dataset.kind, dataset.bundled_id ? catalog?.bundled.find((b) => b.id === dataset.bundled_id) : undefined),
          t,
        )
      : null;
  const withJob = !!dataset?.job_id;

  return (
    <li className="px-4 py-3 flex items-start gap-x-4 gap-y-2 flex-wrap">
      <div className="flex-1 min-w-[16rem] space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <span ref={typeTip} className="shrink-0 text-muted">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{t(`run_history.type.${row.type}`)}</span>
          </span>
          <span className="text-sm font-medium truncate" title={title}>
            {title}
          </span>
          <StatusMark row={row} />
        </div>
        <div className="text-[11px] text-muted flex items-center gap-x-1.5 gap-y-0.5 flex-wrap">
          {facts.map((fact, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 min-w-0">
              {i > 0 && <span aria-hidden>·</span>}
              <span className="truncate max-w-[22rem]">{fact}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden>·</span>
            <time ref={timeTip} dateTime={new Date(row.time).toISOString()}>
              {formatRelative(row.time, locale)}
            </time>
          </span>
        </div>
        {settings && (
          <div className="text-[11px] text-muted flex items-start gap-1.5">
            <SlidersHorizontal className="h-3 w-3 mt-px shrink-0" aria-hidden />
            <span>
              <span className="sr-only">{t("run_history.settings_label")}: </span>
              {settings}
            </span>
          </div>
        )}
        {(row.status === "failed" || row.status === "aborted") && errorText && (
          <p className="flex items-start gap-1 text-[11px] text-danger-ink break-words">
            <AlertCircle className="h-3 w-3 mt-px shrink-0" aria-hidden />
            {errorText}
          </p>
        )}
        {job && (
          <div className="pt-0.5">
            <JobNotesField jobId={job.id} initialNotes={job.notes} variant="inline" onSaved={onNotes} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="primary"
              className="bg-danger hover:bg-danger/90"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await onDelete();
                } finally {
                  setDeleting(false);
                }
              }}
              // It replaces the focused delete button.
              autoFocus
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t(dataset ? (withJob ? "factor.data.delete_confirm_run" : "factor.data.delete_confirm") : "run_history.confirm_delete")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={deleting}>
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Link
              href={historyHref(row)}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-tile hover:bg-accent/[0.08] transition text-xs font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t("run_history.open_button")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">: {title}</span>
            </Link>
            {row.status === "active" && job && (
              <IconButton icon={CircleStop} name={t("run_history.abort")} more={t("run_history.abort_more")} onClick={onAbort} className="hover:text-danger-ink" />
            )}
            <IconButton
              ref={deleteRef}
              icon={Trash2}
              name={t(dataset ? "run_history.delete_dataset_aria" : "run_history.delete_run_aria", { name: title })}
              more={dataset ? (withJob ? t("factor.data.delete_with_run") : undefined) : row.type !== "single" ? t("run_history.delete_with_dataset") : undefined}
              onClick={onAsk}
              className="hover:text-danger-ink hover:bg-danger/10"
            />
          </>
        )}
      </div>
    </li>
  );
}

/** The status of a row as a sign and a word; a finished one is quiet, a failed one red. */
function StatusMark({ row }: { row: HistoryRow }) {
  const { t, locale } = useLocale();
  const base = "inline-flex items-center gap-1 text-[11px] font-medium shrink-0";
  if (row.status === "active") {
    const label =
      row.percent === null
        ? t("run_history.status_label_pending")
        : `${t("run_history.status_label_running")} ${formatPercent(row.percent / 100, locale, 0)}`;
    return (
      <span className={cn(base, "text-accent-ink tabular-nums")}>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {label}
      </span>
    );
  }
  if (row.status === "failed")
    return (
      <span className={cn(base, "text-danger-ink")}>
        <XCircle className="h-3 w-3" aria-hidden />
        {t("run_history.status_label_failed")}
      </span>
    );
  if (row.status === "aborted")
    return (
      <span className={cn(base, "text-muted")}>
        <CircleSlash className="h-3 w-3" aria-hidden />
        {t("run_history.status_label_aborted")}
      </span>
    );
  return (
    <span className={cn(base, "text-muted")}>
      <Check className="h-3 w-3 text-success-ink" aria-hidden />
      {t("run_history.status_label_completed")}
    </span>
  );
}
