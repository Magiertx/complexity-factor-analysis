"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  RefreshCw,
  Trash2,
  ExternalLink,
  AlertCircle,
  Check,
  Loader2,
  Layers,
  Filter,
} from "lucide-react";
import {
  Job,
  deleteJob,
  fetchJobs,
} from "@/lib/api";
import { JobNotesField } from "./job-notes-field";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Segmented } from "./ui/segmented";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { datasetJobHref, datasetJobSubtitle, jobDisplayName, jobTitle } from "@/lib/factor-analysis";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type StatusFilter = "all" | "active" | "completed" | "failed" | "aborted";

const STATUS_BADGE: Record<Job["status"], string> = {
  pending: "bg-muted/15 text-muted",
  running: "bg-accent/[0.45] text-fg",
  completed: "bg-success/15 text-success-ink",
  failed: "bg-danger/15 text-danger-ink",
  aborted: "bg-warn/15 text-warn-ink",
};

export function RunHistoryView() {
  const t = useT();

  const STATUS_LABEL: Record<Job["status"], string> = {
    pending: t("run_history.status_label_pending"),
    running: t("run_history.status_label_running"),
    completed: t("run_history.status_label_completed"),
    failed: t("run_history.status_label_failed"),
    aborted: t("run_history.status_label_aborted"),
  };

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [algoFilter, setAlgoFilter] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const list = await fetchJobs();
      setJobs(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("run_history.load_failed_fallback"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  const handleDelete = async (jobId: string) => {
    try {
      await deleteJob(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      setConfirmingDelete(null);
      showToast(t("run_history.toast_run_deleted"));
    } catch {
      showToast(t("run_history.toast_delete_failed"));
    }
  };

  const algorithmOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { id: string; name: string }[] = [];
    for (const j of jobs) {
      if (seen.has(j.algorithm_id)) continue;
      seen.add(j.algorithm_id);
      opts.push({ id: j.algorithm_id, name: jobDisplayName(j, t) });
    }
    opts.sort((a, b) => a.name.localeCompare(b.name));
    return opts;
  }, [jobs, t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (algoFilter && j.algorithm_id !== algoFilter) return false;
      if (statusFilter === "active") {
        if (j.status !== "pending" && j.status !== "running") return false;
      } else if (statusFilter !== "all" && j.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        jobTitle(j, t).toLowerCase().includes(q) ||
        jobDisplayName(j, t).toLowerCase().includes(q) ||
        j.filename.toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q)
      );
    });
  }, [jobs, search, statusFilter, algoFilter, t]);

  const counts = useMemo(() => {
    const out = { all: jobs.length, active: 0, completed: 0, failed: 0, aborted: 0 };
    for (const j of jobs) {
      if (j.status === "running" || j.status === "pending") out.active++;
      else if (j.status === "completed") out.completed++;
      else if (j.status === "failed") out.failed++;
      else if (j.status === "aborted") out.aborted++;
    }
    return out;
  }, [jobs]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="h-9 w-9 grid place-items-center rounded-md bg-tile hover:bg-accent/[0.08] transition text-muted hover:text-fg shrink-0"
            aria-label={t("run_history.back_aria")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">{t("run_history.heading")}</h1>
            <p className="text-xs text-muted mt-0.5">
              {t("run_history.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {t("run_history.refresh_button")}
          </Button>
          {toast && (
            <span className="flex items-center gap-1.5 text-xs text-muted bg-tile rounded-md px-3 py-2">
              <Check className="h-3.5 w-3.5 text-accent-ink" />
              {toast}
            </span>
          )}
        </div>
      </header>

      {loadError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-2 text-sm text-danger-ink">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t("run_history.load_error", { error: loadError })}</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
              <Input
                type="text"
                placeholder={t("run_history.search_placeholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label={t("run_history.search_aria")}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted" aria-hidden />
              <Select
                value={algoFilter}
                onValueChange={setAlgoFilter}
                className="min-w-[180px] w-auto"
                aria-label={t("run_history.filter_algo_aria")}
                options={[
                  { value: "", label: t("run_history.filter_all_algorithms") },
                  ...algorithmOptions.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </div>
          </div>

          <Segmented<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: t("run_history.status_all", { n: counts.all }) },
              { value: "active", label: t("run_history.status_active", { n: counts.active }) },
              { value: "completed", label: t("run_history.status_completed", { n: counts.completed }) },
              { value: "failed", label: t("run_history.status_failed", { n: counts.failed }) },
              { value: "aborted", label: t("run_history.status_aborted", { n: counts.aborted }) },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("run_history.loading_runs")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">
              {jobs.length === 0
                ? t("run_history.no_runs_empty")
                : t("run_history.no_runs_filter")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((job) => {
                const date = new Date(job.created_at * 1000);
                const isBatch = job.algorithm_id.startsWith("_batch");
                const detailHref = datasetJobHref(job) ?? `/inspect?job=${job.id}`;
                const title = jobTitle(job, t);
                const subtitle = datasetJobSubtitle(job, t);
                return (
                  <li key={job.id} className="p-4 flex items-start gap-4 flex-wrap hover:bg-surface/40 transition">
                    <div className="flex-1 min-w-[260px] space-y-1.5">
                      <div className="flex items-center gap-2">
                        {isBatch && (
                          <Layers className="h-3.5 w-3.5 text-muted shrink-0" aria-label={t("jobs.mode.batch")} />
                        )}
                        <span className="text-sm font-medium truncate" title={title}>
                          {title}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded",
                            STATUS_BADGE[job.status],
                          )}
                        >
                          {STATUS_LABEL[job.status]}
                          {(job.status === "running" || job.status === "pending") &&
                            ` ${Math.round(job.percentage)}%`}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted flex items-center gap-2 flex-wrap font-mono">
                        {subtitle ? (
                          <span className="truncate font-sans" title={subtitle}>
                            {subtitle}
                          </span>
                        ) : (
                          <span className="truncate" title={job.filename}>
                            {job.filename}
                          </span>
                        )}
                        <span>·</span>
                        <span>{date.toLocaleString()}</span>
                        {job.error && (
                          <>
                            <span>·</span>
                            <span className="text-danger-ink truncate max-w-[300px]" title={job.error}>
                              {job.error}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="pt-1">
                        <JobNotesField
                          jobId={job.id}
                          initialNotes={job.notes}
                          variant="inline"
                          onSaved={(notes) => {
                            setJobs((prev) =>
                              prev.map((j) => (j.id === job.id ? { ...j, notes } : j)),
                            );
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={detailHref}
                        className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-tile hover:bg-accent/[0.08] transition text-xs font-medium text-muted hover:text-fg"
                        title={t("run_history.open_title")}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t("run_history.open_button")}
                      </Link>
                      {confirmingDelete === job.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            className="bg-danger hover:bg-danger/90"
                            onClick={() => handleDelete(job.id)}
                          >
                            {t("run_history.confirm_delete")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                            {t("common.cancel")}
                          </Button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(job.id)}
                          className="h-8 w-8 grid place-items-center rounded-md text-muted hover:text-danger-ink hover:bg-surface transition"
                          aria-label={t("run_history.delete_run_aria", { id: job.id })}
                          title={t("run_history.delete_run_title")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
