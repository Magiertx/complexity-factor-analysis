"use client";

// The stability of the solution over bootstrap samples, and the short set: one representative
// measure per dimension. Nothing is computed until the user asks; a result for other settings is
// stale and never shown as current.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ClipboardCopy, Shuffle } from "lucide-react";
import {
  DEFAULT_STABILITY_SAMPLES,
  STABILITY_SAMPLES,
  abortTask,
  fetchStability,
  type AnalyzeOptions,
  type FactorAnalysis,
  type ShortSetEntry,
  type Stability,
  type StabilityFailure,
  type StabilitySamples,
} from "@/lib/api";
import { formatNumber, formatPercent } from "@/lib/format";
import { countText } from "@/lib/factor-analysis";
import { pairTint } from "@/lib/compare";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { useJobs } from "@/components/jobs-provider";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { TableFrame } from "@/components/ui/table";
import { useToasts } from "@/components/ui/toasts";
import { useTipZone } from "@/components/ui/tip";

/** Below this share a measure's value carries the warning glyph. */
export const LOW_STABILITY = 0.7;
/** The number of samples last chosen, so that a kept stability reopens with it. */
const SAMPLES_KEY = "app.stability-samples";

export interface StabilityView {
  samples: StabilitySamples;
  setSamples: (samples: StabilitySamples) => void;
  /** What is going on for the settings on screen. */
  phase: "idle" | "looking" | "computing" | "ready" | "failed" | "aborted";
  /** How far a running job has come, in percent. */
  percent: number;
  /** The stability of exactly the analysis on screen. */
  result: Stability | null;
  /** A stability computed for other settings, which is not shown as current. */
  stale: boolean;
  error: string | null;
  start: () => void;
  cancel: () => void;
}

/**
 * The stability of the analysis of `options` on dataset `id`: looked up whenever they change (a
 * kept result reopens at once), computed by a job of the History on `start`, followed through
 * the list of jobs until it is done.
 */
export function useStability(id: string | null, options: AnalyzeOptions | null): StabilityView {
  const t = useT();
  const { jobs } = useJobs();
  const [samples, setSamplesState] = useState<StabilitySamples>(DEFAULT_STABILITY_SAMPLES);
  useEffect(() => {
    try {
      const kept = Number(localStorage.getItem(SAMPLES_KEY));
      if ((STABILITY_SAMPLES as readonly number[]).includes(kept)) setSamplesState(kept as StabilitySamples);
    } catch {
      // Without storage the default stays.
    }
  }, []);
  const setSamples = useCallback((n: StabilitySamples) => {
    setSamplesState(n);
    try {
      localStorage.setItem(SAMPLES_KEY, String(n));
    } catch {
      // Remembered for this page only.
    }
  }, []);
  const [phase, setPhase] = useState<StabilityView["phase"]>("idle");
  const [result, setResult] = useState<Stability | null>(null);
  const [stale, setStale] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = id && options ? JSON.stringify([id, options, samples]) : null;
  const keyRef = useRef(key);
  keyRef.current = key;

  const look = useCallback(
    async (start: boolean, signal?: AbortSignal) => {
      if (!id || !options) return;
      const asked = keyRef.current;
      try {
        const state = await fetchStability(id, options, samples, start, signal);
        if (keyRef.current !== asked) return;
        if (state.status === "ready") {
          setResult(state.stability);
          setStale(false);
          setPhase("ready");
          setJobId(null);
        } else if (state.status === "computing") {
          setJobId(state.job_id);
          setPhase("computing");
        } else {
          setPhase("idle");
        }
      } catch {
        if (signal?.aborted || keyRef.current !== asked) return;
        setError(t("factor.stability.failed"));
        setPhase("failed");
      }
    },
    [id, options, samples, t],
  );

  // Other settings: what was shown is stale until the stability of these is found.
  useEffect(() => {
    setJobId(null);
    setError(null);
    setResult((shown) => {
      if (shown) setStale(true);
      return null;
    });
    if (!key) {
      setPhase("idle");
      return;
    }
    setPhase("looking");
    const controller = new AbortController();
    void look(false, controller.signal);
    return () => controller.abort();
    // `look` changes with the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The job of the History: done, failed or stopped.
  const job = jobId ? jobs.find((j) => j.id === jobId) : undefined;
  useEffect(() => {
    if (!job) return;
    if (job.status === "completed") void look(false);
    else if (job.status === "failed") {
      setError(t("factor.stability.failed"));
      setPhase("failed");
      setJobId(null);
    } else if (job.status === "aborted") {
      setPhase("aborted");
      setJobId(null);
    }
  }, [job, look, t]);

  return {
    samples,
    setSamples,
    phase,
    percent: job?.status === "running" ? Math.round(job.percentage) : 0,
    result,
    stale: stale && !result,
    error,
    start: () => {
      setError(null);
      setPhase("computing");
      void look(true);
    },
    cancel: () => {
      if (jobId) void abortTask(jobId);
    },
  };
}

/** "97 %", as the cards show a share. */
function percent(share: number, locale: string): string {
  return formatPercent(share, locale, 0);
}

/** The measures of a stability by name. */
export function stabilityByMeasure(result: Stability | null): Map<string, Stability["measures"][number]> {
  return new Map((result?.measures ?? []).map((m) => [m.measure, m]));
}

/**
 * The action and the state of the stability above the cards: a quiet secondary button with the
 * number of samples, the progress of its job, then the one-line summary with what was dropped.
 */
export function StabilityBar({ view }: { view: StabilityView }) {
  const t = useT();
  const { locale } = useLocale();
  const { result, phase } = view;
  const running = phase === "computing" || phase === "looking";
  const help = t("factor.stability.help", { n: view.samples });
  return (
    <div className="space-y-2" data-testid="stability">
      <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <p className="text-xs text-muted min-w-0" aria-live="polite">
          {phase === "computing" ? (
            t("factor.stability.computing", { pct: view.percent })
          ) : result ? (
            <StabilitySummary result={result} />
          ) : null}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented<string>
            size="sm"
            aria-label={t("factor.stability.samples_label")}
            value={String(view.samples)}
            onChange={(v) => view.setSamples(Number(v) as StabilitySamples)}
            options={STABILITY_SAMPLES.map((n) => ({ value: String(n), label: formatNumber(n, locale, 0) }))}
          />
          {phase === "computing" ? (
            <Button variant="secondary" size="sm" onClick={view.cancel}>
              {t("factor.stability.cancel")}
            </Button>
          ) : (
            !result && (
              <Button variant="secondary" size="sm" onClick={view.start} disabled={running}>
                <Shuffle className="h-3.5 w-3.5" aria-hidden />
                {view.stale ? t("factor.stability.again") : t("factor.stability.action")}
              </Button>
            )
          )}
          <InfoTip size="xs" topic={t("factor.stability.action")} text={help} align="end" />
        </div>
      </div>
      {phase === "computing" && (
        <div className="h-1 rounded-full bg-tile overflow-hidden" aria-hidden>
          <div className="h-full bg-accent transition-[width]" style={{ width: `${view.percent}%` }} />
        </div>
      )}
      {view.stale && phase !== "computing" && <Notice tone="info">{t("factor.stability.stale")}</Notice>}
      {phase === "failed" && <Notice tone="error">{view.error ?? t("factor.stability.failed")}</Notice>}
      {phase === "aborted" && <Notice tone="info">{t("factor.stability.aborted")}</Notice>}
      {result && result.valid === 0 && <Notice tone="warn">{t("factor.stability.none_valid", { samples: result.samples })}</Notice>}
    </div>
  );
}

function StabilitySummary({ result }: { result: Stability }) {
  const t = useT();
  const { locale } = useLocale();
  const failed = Object.entries(result.failed) as [StabilityFailure, number][];
  const dropped = result.samples - result.valid;
  return (
    <>
      {result.valid > 0 &&
        t("factor.stability.summary", {
          n: formatNumber(result.valid, locale, 0),
          stable: result.summary.stable,
          measures: result.summary.measures,
          threshold: Math.round(result.summary.threshold * 100),
        })}
      {dropped > 0 && (
        <>
          {result.valid > 0 && " · "}
          {t("factor.stability.dropped", {
            n: dropped,
            samples: result.samples,
            causes: failed.map(([cause, n]) => t(`factor.stability.failure.${cause}`, { n })).join(", "),
          })}
        </>
      )}
    </>
  );
}

/** The share of samples in which a measure keeps its factors, beside its name; a glyph below 70 %. */
export function MeasureStability({ entry }: { entry: Stability["measures"][number] | undefined }) {
  const t = useT();
  const { locale } = useLocale();
  if (!entry || entry.assignment === null) return null;
  const low = entry.assignment < LOW_STABILITY;
  const more = [
    t("factor.stability.value_tip", { pct: percent(entry.assignment, locale) }),
    entry.primary !== null ? t("factor.stability.primary_tip", { pct: percent(entry.primary, locale) }) : null,
    low ? t("factor.stability.low", { threshold: Math.round(LOW_STABILITY * 100) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 font-mono tabular-nums text-xs", low ? "text-warn-ink" : "text-muted")}
      data-tip={t("factor.stability.action")}
      data-tip-more={more}
      data-testid="measure-stability"
    >
      {low && <AlertTriangle className="h-3 w-3" aria-label={t("factor.stability.low", { threshold: Math.round(LOW_STABILITY * 100) })} />}
      {percent(entry.assignment, locale)}
    </span>
  );
}

/** "φ 0,98" of a dimension card, with its reading after Lorenzo-Seva and ten Berge in the tip. */
export function FactorCongruence({ factor }: { factor: Stability["factors"][number] | undefined }) {
  const t = useT();
  const { locale } = useLocale();
  if (!factor || factor.phi_mean === null || !factor.reading) return null;
  const low = factor.reading === "different";
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs tabular-nums shrink-0", low ? "text-warn-ink" : "text-muted")}
      data-tip={t(`factor.stability.reading.${factor.reading}`)}
      data-tip-more={t("factor.stability.phi_tip", { p5: formatNumber(factor.phi_p5 ?? NaN, locale, 2) })}
      data-testid="factor-congruence"
    >
      {low && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {t("factor.stability.phi", { value: formatNumber(factor.phi_mean, locale, 2) })}
    </span>
  );
}

/** The small neutral badge of the representative of a dimension. */
export function RepresentativeBadge({ entry }: { entry: ShortSetEntry }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <span
      className="inline-block rounded px-1.5 py-px text-xs bg-bg/80 text-muted align-middle"
      data-tip={t("factor.short_set.badge")}
      data-tip-more={t("factor.short_set.badge_tip", { purity: formatNumber(entry.purity, locale, 2) })}
      data-testid="representative"
    >
      {t("factor.short_set.badge")}
    </span>
  );
}

function latexEscape(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (c) => (c === "\\" ? "\\textbackslash{}" : c === "~" ? "\\textasciitilde{}" : c === "^" ? "\\textasciicircum{}" : `\\${c}`));
}

function csvCell(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The short set as a compact card: one representative per dimension with its loading, and its
 * stability where it was computed, copied as a list, a LaTeX table or CSV.
 */
export function ShortSetCard({
  analysis,
  measureName,
  dimensionName,
  stability,
}: {
  analysis: FactorAnalysis;
  measureName: (key: string) => string;
  /** The name of a dimension by its index from 0, as its card shows it. */
  dimensionName: (index: number) => string;
  stability: Stability | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { notify } = useToasts();
  const zone = useTipZone<HTMLDivElement>();
  const entries = useMemo(() => analysis.short_set ?? [], [analysis.short_set]);
  const byMeasure = stabilityByMeasure(stability);
  if (entries.length === 0) return null;
  const share = (m: string) => {
    const s = byMeasure.get(m)?.assignment;
    return s === null || s === undefined ? null : s;
  };

  const copy = async (format: "list" | "latex" | "csv") => {
    const rows = entries.map((e) => ({ dim: dimensionName(e.index), name: measureName(e.measure), e, s: share(e.measure) }));
    let text: string;
    if (format === "list") {
      text = rows.map((r) => `${r.dim}: ${r.name}`).join("\n");
    } else if (format === "csv") {
      const head = ["dimension", "measure", "loading", "purity", ...(stability ? ["stability"] : [])];
      text = [head, ...rows.map((r) => [r.dim, r.name, r.e.loading.toFixed(3), r.e.purity.toFixed(3), ...(stability ? [r.s?.toFixed(3) ?? ""] : [])])]
        .map((cells) => cells.map(csvCell).join(","))
        .join("\n");
    } else {
      const cols = stability ? "llrr" : "llr";
      const head = [t("factor.short_set.col_dimension"), t("factor.short_set.col_measure"), t("factor.short_set.col_loading"), ...(stability ? [t("factor.short_set.col_stability")] : [])];
      const body = rows.map(
        (r) =>
          [latexEscape(r.dim), latexEscape(r.name), `$${r.e.loading.toFixed(2)}$`, ...(stability ? [r.s === null ? "--" : `${Math.round(r.s * 100)}\\,\\%`] : [])].join(" & ") + " \\\\",
      );
      text = [`\\begin{tabular}{${cols}}`, "\\toprule", head.join(" & ") + " \\\\", "\\midrule", ...body, "\\bottomrule", "\\end{tabular}"].join("\n");
    }
    try {
      await navigator.clipboard.writeText(text);
      notify({ key: "short-set-copied", message: t("factor.short_set.copied"), tone: "success" });
    } catch {
      notify({ key: "short-set-copy-failed", message: t("factor.short_set.copy_failed"), tone: "info" });
    }
  };

  return (
    <div ref={zone} className="rounded-lg bg-tile p-3.5 space-y-2" data-testid="short-set">
      <div className="flex items-center justify-between gap-x-3 gap-y-1 flex-wrap">
        <h4 className="text-sm font-semibold flex items-center gap-1">
          {countText(t, "factor.short_set.heading", entries.length)}
          <InfoTip size="xs" topic={countText(t, "factor.short_set.heading", entries.length)} text={t("factor.short_set.help")} />
        </h4>
        <div className="flex items-center gap-1 flex-wrap" role="group" aria-label={t("factor.short_set.copy_label")}>
          <ClipboardCopy className="h-3.5 w-3.5 text-muted" aria-hidden />
          {(["list", "latex", "csv"] as const).map((format) => (
            <Button key={format} variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void copy(format)}>
              {t(`factor.short_set.copy_${format}`)}
            </Button>
          ))}
        </div>
      </div>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map((e) => (
          <li key={e.index} className="flex items-baseline justify-between gap-2 text-xs min-w-0">
            <span className="min-w-0 break-words">
              <span className="text-muted">{dimensionName(e.index)}: </span>
              {measureName(e.measure)}
            </span>
            <span className="flex items-baseline gap-2 shrink-0">
              <MeasureStability entry={byMeasure.get(e.measure)} />
              <span className="font-mono tabular-nums">{formatNumber(e.loading, locale, 2)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * How often two measures share a factor over the samples, as the comparison shows its pairs: a
 * matrix in the order of the cards, tinted by the share; a ring marks the pairs of the solution.
 */
export function StabilityPairs({
  result,
  order,
  measureName,
}: {
  result: Stability;
  /** The measures in the order of the cards. */
  order: string[];
  measureName: (key: string) => string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const zone = useTipZone<HTMLTableElement>();
  const { measures, shares, reference } = result.pairs;
  if (!shares) return null;
  const position = new Map(measures.map((m, i) => [m, i]));
  const rows = order.filter((m) => position.has(m));
  return (
    <div className="space-y-2" data-testid="stability-pairs">
      <p className="flex items-center gap-1 text-xs text-muted">
        {t("factor.stability.pairs_legend_short")}
        <InfoTip size="xs" topic={t("factor.stability.pairs_label")} text={t("factor.stability.pairs_legend")} />
      </p>
      <TableFrame label={t("factor.stability.pairs_label")} className="w-fit max-w-full">
        <table ref={zone} className="data-table w-auto">
          <caption className="sr-only">{t("factor.stability.pairs_label")}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky-col">
                {t("factor.loadings.col_measure")}
              </th>
              {rows.map((m) => (
                <th key={m} scope="col" data-tip={measureName(m)} className="text-center !px-2 min-w-[3rem] max-w-[6rem] truncate">
                  {measureName(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a}>
                <th scope="row" className="sticky-col font-medium">
                  {measureName(a)}
                </th>
                {rows.map((b) => {
                  const i = position.get(a)!;
                  const j = position.get(b)!;
                  const self = i === j;
                  const share = shares[i][j];
                  const together = reference[i][j] && !self;
                  const alpha = self ? 0 : pairTint(share, 1);
                  return (
                    <td
                      key={b}
                      data-tip={self ? measureName(a) : t("factor.stability.pairs_cell", { a: measureName(a), b: measureName(b) })}
                      data-tip-more={t(together ? "factor.stability.pairs_cell_together" : "factor.stability.pairs_cell_more", {
                        pct: percent(share, locale),
                      })}
                      className={cn("text-center tabular-nums !px-2", self ? "text-muted" : "text-fg", together && "ring-1 ring-inset ring-border-strong")}
                      style={alpha > 0 ? { backgroundColor: `rgb(var(--fg) / ${alpha.toFixed(3)})` } : undefined}
                    >
                      {self ? "–" : Math.round(share * 100)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
