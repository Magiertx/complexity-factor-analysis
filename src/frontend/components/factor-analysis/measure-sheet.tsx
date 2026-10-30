"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, ChevronLeft, ChevronRight, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { fetchDescriptives, type Descriptives, type FactorAnalysis, type FactorDataset, type FactorMeasure } from "@/lib/api";
import { assignedCells, factorName, signColor, type AnalysisOptions, type FactorNames } from "@/lib/factor-analysis";
import { MIN_MEASURES } from "@/lib/factor-analysis";
import { NO_VALUE, formatNumber, formatStatistic } from "@/lib/format";
import type { MeasureInfo } from "@/lib/measure-list";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import { useTip } from "@/components/ui/tip";
import { InfoTip } from "@/components/ui/info-tip";
import { Notice } from "@/components/ui/notice";
import type { CorrelationsState } from "./correlation-map";
import { Histogram } from "./histogram";

export interface MeasureSheetProps {
  /** The measure shown; null while the sheet is closed. */
  measure: string | null;
  /** The measures of the list it was opened from, in its order; the arrow keys page through them. */
  list: readonly string[];
  /** The element it was opened from, where the focus returns. */
  from: HTMLElement | null;
  /** Shows another measure, by paging or from the list of the closest ones. */
  onMeasure: (measure: string) => void;
  onClose: () => void;
  dataset: FactorDataset;
  analysis: FactorAnalysis | null;
  options: AnalysisOptions;
  /** What became of each measure of the dataset in the analysis on screen. */
  info: Map<string, MeasureInfo>;
  /** The catalog entry of each measure: its name, description, group and source. */
  catalog: Map<string, FactorMeasure>;
  /** The name of a feature group of the catalog, e.g. "Trace length". */
  groupName: (group: string) => string | undefined;
  /** How a measure is named on screen, a short code where the switch of the toolbar says so. */
  measureName: (key: string) => string;
  correlations: CorrelationsState;
  names: FactorNames;
  /** At least `MIN_MEASURES` have to stay in the analysis. */
  locked: boolean;
  onToggleExcluded: (measure: string) => void;
}

/**
 * The fact sheet of a measure, a panel at the side of the page: what it is (the description of the
 * tool and, for the definition, the function of ComFy or feeed behind it with a link to its file), the
 * distribution of its values, what became of it in the analysis (MSA and the round of the filter,
 * communality and uniqueness, its loadings), the five measures that correlate with it most, and the
 * choice to exclude or include it. The left and right arrow keys page through the list it was
 * opened from.
 */
export function MeasureSheet(props: MeasureSheetProps) {
  const { measure, list, from, onMeasure, onClose } = props;
  const t = useT();
  const titleId = useId();
  const [announce, setAnnounce] = useState("");
  const open = measure !== null;
  // With a miner chosen, the distribution is that of the miner's rows, from the server.
  const { dataset, options } = props;
  const miner = options.miner ?? null;
  const minerKey = open && miner ? `${dataset.id}|${miner}` : null;
  const [minerStats, setMinerStats] = useState<{ key: string; data: Descriptives | null } | null>(null);
  useEffect(() => {
    if (!minerKey || !miner) return;
    const ctrl = new AbortController();
    fetchDescriptives(dataset.id, miner, ctrl.signal).then(
      (data) => setMinerStats({ key: minerKey, data }),
      () => {
        if (!ctrl.signal.aborted) setMinerStats({ key: minerKey, data: null });
      },
    );
    return () => ctrl.abort();
  }, [minerKey, dataset.id, miner]);
  const ownStats = minerStats && minerStats.key === minerKey ? minerStats : null;
  const descriptives = miner ? (ownStats?.data ?? null) : (dataset.descriptives ?? null);
  const statsLoading = !!miner && !ownStats;
  const at = measure !== null ? list.indexOf(measure) : -1;
  const previous = at > 0 ? list[at - 1] : null;
  const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;

  const go = (to: string | null) => {
    if (!to) return;
    onMeasure(to);
    setAnnounce(
      t("factor.sheet.announce", { measure: props.measureName(to), i: list.indexOf(to) + 1, n: list.length }),
    );
  };

  return (
    <Sheet
      open={open}
      labelledBy={titleId}
      onClose={onClose}
      from={from}
      returnFocus={() => (measure ? document.querySelector<HTMLElement>(`[data-measure-link="${CSS.escape(measure)}"]`) : null)}
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const el = e.target as HTMLElement;
        if (el.closest("input, textarea, select, [contenteditable=true]")) return;
        e.preventDefault();
        go(e.key === "ArrowLeft" ? previous : next);
      }}
    >
      {measure !== null && (
        <SheetBody
          {...props}
          measure={measure}
          descriptives={descriptives}
          statsLoading={statsLoading}
          titleId={titleId}
          position={at >= 0 ? { i: at + 1, n: list.length } : null}
          previous={previous}
          next={next}
          onPage={go}
          announce={announce}
          onAnnounce={setAnnounce}
        />
      )}
    </Sheet>
  );
}

function SheetBody({
  measure,
  descriptives,
  statsLoading,
  titleId,
  position,
  previous,
  next,
  onPage,
  announce,
  onAnnounce,
  onClose,
  dataset,
  analysis,
  options,
  info,
  catalog,
  groupName,
  measureName,
  correlations,
  names,
  locked,
  onToggleExcluded,
}: MeasureSheetProps & {
  measure: string;
  /** The statistics the distribution shows; null where the chosen miner's are not there (yet). */
  descriptives: Descriptives | null;
  statsLoading: boolean;
  titleId: string;
  position: { i: number; n: number } | null;
  previous: string | null;
  next: string | null;
  onPage: (measure: string | null) => void;
  announce: string;
  onAnnounce: (text: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const entry = catalog.get(measure);
  const fullName = entry?.name ?? measure;
  const row = descriptives?.measures.find((m) => m.measure === measure);
  const dropped = dataset.dropped.find((d) => d.measure === measure)?.reason ?? row?.dropped ?? null;
  const known = info.get(measure);
  const excluded = options.excluded.includes(measure);
  const inDataset = dataset.measures.includes(measure);
  const scroller = useRef<HTMLDivElement>(null);
  // Another measure starts at the top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [measure]);

  const status: { text: string; tone: "ok" | "warn" | "muted" } = (() => {
    if (!inDataset) return { text: t("factor.sheet.status.dropped"), tone: "muted" };
    switch (known?.status) {
      case "removed":
        return { text: t("factor.sheet.status.removed", { step: known.round ?? 1 }), tone: "warn" };
      case "excluded":
        return { text: t("factor.sheet.status.excluded"), tone: "muted" };
      case "dependent":
        return { text: t("factor.sheet.status.dependent"), tone: "warn" };
      case "below":
        return { text: t("factor.sheet.status.below", { threshold: formatNumber(analysis?.kmo.threshold ?? options.msa_threshold, locale) }), tone: "warn" };
      case "miner":
        return { text: t("factor.sheet.status.miner"), tone: "muted" };
      case "used":
        return { text: t("factor.sheet.status.used"), tone: "ok" };
      default:
        return { text: t("factor.sheet.status.pending"), tone: "muted" };
    }
  })();

  const prevTip = previous === null ? t("factor.sheet.first") : undefined;
  const nextTip = next === null ? t("factor.sheet.last") : undefined;

  return (
    <>
      <div className="flex items-start gap-1.5 px-4 pt-4 pb-3 border-b border-border shrink-0">
        <div className="min-w-0 flex-1">
          {position && (
            <p className="flex items-center gap-1 text-xs text-muted tabular-nums">
              {t("factor.sheet.position", position)}
              <InfoTip size="xs" topic={t("factor.sheet.position", position)} text={t("factor.sheet.paging_more")} />
            </p>
          )}
          <h2
            id={titleId}
            tabIndex={-1}
            data-autofocus
            className="mt-0.5 text-base font-semibold leading-snug break-words rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fullName}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {entry?.short && (
              <span className="rounded bg-tile px-1.5 py-0.5 font-mono" aria-label={measureName(measure)}>
                {entry.short}
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
                status.tone === "ok" && "bg-success/10 text-success-ink",
                status.tone === "warn" && "bg-warn/10 text-warn-ink",
                status.tone === "muted" && "bg-tile text-muted",
              )}
            >
              {/* A warning is a glyph as well as a colour. */}
              {status.tone === "warn" && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
              {status.text}
            </span>
          </div>
        </div>
        <IconButton
          icon={ChevronLeft}
          name={t("factor.sheet.prev")}
          keyCap="←"
          size="sm"
          reason={prevTip}
          onClick={() => onPage(previous)}
        />
        <IconButton
          icon={ChevronRight}
          name={t("factor.sheet.next")}
          keyCap="→"
          size="sm"
          reason={nextTip}
          onClick={() => onPage(next)}
        />
        <IconButton icon={X} name={t("factor.sheet.close")} keyCap="Esc" size="sm" onClick={onClose} />
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <Definition measure={measure} entry={entry} groupName={groupName} />

        {statsLoading && (
          <section className="space-y-2" aria-labelledby={`${titleId}-values`} aria-busy>
            <h3 id={`${titleId}-values`} className="text-sm font-semibold">
              {t("factor.sheet.values")}
            </h3>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t("common.loading")}
            </p>
          </section>
        )}
        {row && (
          <section className="space-y-2" aria-labelledby={`${titleId}-values`}>
            <h3 id={`${titleId}-values`} className="text-sm font-semibold">
              {t("factor.sheet.values")}
            </h3>
            {row.histogram ? (
              <Histogram histogram={row.histogram} median={row.median} measure={fullName} />
            ) : (
              <p className="text-xs text-muted">{t("factor.sheet.hist_none")}</p>
            )}
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="n" value={formatNumber(row.n, locale)} />
              <Stat label={t("factor.dataset.col_mean")} value={statistic(row.mean, locale)} />
              <Stat label={t("factor.dataset.col_median")} value={statistic(row.median, locale)} />
              <Stat label={t("factor.dataset.col_sd")} value={statistic(row.std, locale)} />
              <Stat label={t("factor.dataset.col_min")} value={statistic(row.min, locale)} />
              <Stat label={t("factor.dataset.col_max")} value={statistic(row.max, locale)} />
            </dl>
            <p className="text-xs text-muted">
              {descriptives?.basis === "input"
                ? t("factor.sheet.values_input", { n: formatNumber(descriptives.n_rows, locale) })
                : descriptives?.basis === "miner"
                  ? t("factor.sheet.values_miner", { n: formatNumber(descriptives.n_rows, locale), miner: descriptives.miner ?? "" })
                  : t("factor.sheet.values_cleaned")}
            </p>
          </section>
        )}

        <section className="space-y-3" aria-labelledby={`${titleId}-analysis`}>
          <h3 id={`${titleId}-analysis`} className="text-sm font-semibold">
            {t("factor.sheet.analysis")}
          </h3>
          {!inDataset ? (
            <p className="text-xs text-muted">
              {t("factor.sheet.dropped_note", { reason: dropped ? t(`factor.dataset.reason.${dropped}`) : NO_VALUE })}
            </p>
          ) : excluded ? (
            <p className="text-xs text-muted">{t("factor.sheet.excluded_note")}</p>
          ) : (
            <InAnalysis measure={measure} analysis={analysis} options={options} info={known} names={names} />
          )}
        </section>

        <Closest
          measure={measure}
          correlations={correlations}
          measureName={measureName}
          onPick={(m) => onPage(m)}
          titleId={titleId}
        />
      </div>

      {inDataset && (
        <div className="shrink-0 border-t border-border px-4 py-3">
          <ExcludeButton
            excluded={excluded}
            locked={locked && !excluded}
            onClick={() => {
              onToggleExcluded(measure);
              onAnnounce(t(excluded ? "factor.sheet.included_done" : "factor.sheet.excluded_done", { measure: measureName(measure) }));
            }}
          />
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
    </>
  );
}

function statistic(value: number | null, locale: string): string {
  return value === null ? NO_VALUE : formatStatistic(value, locale);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-tile/60 px-2.5 py-1.5 min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono tabular-nums text-sm [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

/**
 * What the measure is. No definition of this tool's own for a log measure: its feature group and
 * the function of feeed that computes it, with a link. A model measure has the tool's description
 * and the function of ComFy.
 */
function Definition({
  measure,
  entry,
  groupName,
}: {
  measure: string;
  entry: FactorMeasure | undefined;
  groupName: (group: string) => string | undefined;
}) {
  const t = useT();
  const source = entry?.source;
  const logMeasure = !!entry?.group;
  const link = useTip<HTMLAnchorElement>({ name: t("factor.sheet.source_open"), more: t("factor.sheet.source_open_more") });
  return (
    <section className="space-y-2" aria-label={t("factor.sheet.definition")}>
      <h3 className="text-sm font-semibold">{t("factor.sheet.definition")}</h3>
      {!logMeasure && (
        <>
          <p className="text-sm">{entry?.description || t("factor.sheet.no_description")}</p>
          {entry?.description && <p className="text-xs text-muted">{t("factor.sheet.description_note")}</p>}
        </>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {logMeasure && entry?.group && (
          <>
            <dt className="text-muted">{t("factor.sheet.group_label")}</dt>
            <dd>{groupName(entry.group) ?? entry.group}</dd>
          </>
        )}
        {source && (
          <>
            <dt className="text-muted">{t("factor.sheet.function_label")}</dt>
            <dd className="font-mono break-all">{source.function}</dd>
            <dt className="text-muted">{t("factor.sheet.source_label")}</dt>
            <dd className="min-w-0">
              {/* Only a link the server gives as https; the file the function lives in, at that commit. */}
              {source.url.startsWith("https://") ? (
                <a
                  ref={link}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="break-all">
                    {t("factor.sheet.source_commit", { tool: source.name, commit: source.commit })}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="sr-only">({t("factor.sheet.source_new_tab")})</span>
                </a>
              ) : (
                <span>{t("factor.sheet.source_commit", { tool: source.name, commit: source.commit })}</span>
              )}
            </dd>
          </>
        )}
        {!source && !entry && (
          <>
            <dt className="text-muted">{t("factor.sheet.function_label")}</dt>
            <dd className="font-mono break-all">{measure}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** MSA, communality, uniqueness and the loadings of a measure the analysis uses (or removed). */
function InAnalysis({
  measure,
  analysis,
  options,
  info,
  names,
}: {
  measure: string;
  analysis: FactorAnalysis | null;
  options: AnalysisOptions;
  info: MeasureInfo | undefined;
  names: FactorNames;
}) {
  const t = useT();
  const { locale } = useLocale();
  const assigned = useMemo(() => (analysis ? assignedCells(analysis) : new Set<string>()), [analysis]);
  if (!analysis) {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t("factor.sheet.status.pending")}
      </p>
    );
  }
  const threshold = analysis.kmo.threshold ?? options.msa_threshold;
  const msa = info?.msa ?? null;
  const h2 = analysis.communalities[measure];
  const u = analysis.uniquenesses[measure];
  const loadings = analysis.loadings[measure];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-tile/60 px-2.5 py-1.5 min-w-0">
          <div className="flex items-center gap-0.5 text-xs text-muted">
            {t("factor.sheet.msa")}
            <InfoTip size="xs" topic={t("factor.sheet.msa")} text={t("factor.sheet.msa_more", { threshold: formatNumber(threshold, locale) })} />
          </div>
          <div
            className={cn(
              "font-mono tabular-nums text-sm",
              (info?.status === "removed" || info?.status === "below") && "text-warn-ink",
            )}
          >
            {msa === null ? NO_VALUE : formatNumber(msa, locale, 2)}
          </div>
          {info?.status === "removed" && msa !== null && (
            <div className="text-xs text-muted leading-tight mt-0.5">{t("factor.sheet.msa_removed", { msa: formatNumber(msa, locale, 2) })}</div>
          )}
        </div>
        <ShareTile label={t("factor.sheet.communality")} value={h2} />
        <ShareTile label={t("factor.sheet.uniqueness")} value={u} more={t("factor.sheet.uniqueness_more")} />
      </div>
      {loadings && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted">{t("factor.sheet.loadings")}</h4>
          <ul className="space-y-1.5">
            {loadings.map((value, i) => {
              const bold = assigned.has(`${measure}:${i}`);
              const label = factorName(names, i) ?? `F${i + 1}`;
              return (
                <li key={i} className="grid grid-cols-[minmax(3rem,6rem)_1fr_3rem] items-center gap-2 text-xs">
                  <span className={cn("truncate", bold && "font-semibold")} title={label}>
                    {label}
                  </span>
                  <span aria-hidden className="relative block h-2 rounded-full bg-tile">
                    <span className="absolute inset-y-[-2px] left-1/2 w-px bg-strong" />
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        background: signColor(value),
                        opacity: bold ? 1 : 0.6,
                        width: `${Math.min(1, Math.abs(value)) * 50}%`,
                        left: value >= 0 ? "50%" : `${50 - Math.min(1, Math.abs(value)) * 50}%`,
                      }}
                    />
                  </span>
                  <span className={cn("text-right font-mono tabular-nums", bold && "font-bold")}>
                    {formatNumber(value, locale, 2)}
                    {bold && <span className="sr-only"> ({t("factor.sheet.loading_assigned")})</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">{t("factor.sheet.loadings_note")}</p>
        </div>
      )}
    </div>
  );
}

/** A share between 0 and 1 as a number with a thin bar under it. */
function ShareTile({ label, value, more }: { label: string; value: number | undefined; more?: string }) {
  const { locale } = useLocale();
  return (
    <div className="rounded-md bg-tile/60 px-2.5 py-1.5 min-w-0">
      <div className="flex items-center gap-0.5 text-xs text-muted">
        {label}
        {more && <InfoTip size="xs" topic={label} text={more} />}
      </div>
      <div className="font-mono tabular-nums text-sm">{value === undefined ? NO_VALUE : formatNumber(value, locale, 2)}</div>
      {value !== undefined && (
        <div aria-hidden className="mt-1 h-1 rounded-full bg-bg/70 overflow-hidden">
          <div className="h-full rounded-full bg-muted/60" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** The five measures that correlate most with this one; a click shows the sheet of one of them. */
function Closest({
  measure,
  correlations,
  measureName,
  onPick,
  titleId,
}: {
  measure: string;
  correlations: CorrelationsState;
  measureName: (key: string) => string;
  onPick: (measure: string) => void;
  titleId: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const partners = correlations.data?.top[measure];
  return (
    <section className="space-y-2" aria-labelledby={`${titleId}-closest`}>
      <div className="flex items-center gap-1">
        <h3 id={`${titleId}-closest`} className="text-sm font-semibold">
          {t("factor.sheet.closest")}
        </h3>
        <InfoTip topic={t("factor.sheet.closest")} text={t("factor.sheet.closest_more")} />
      </div>
      {correlations.error ? (
        <Notice tone="error" size="sm">
          {t("factor.sheet.closest_failed")}
        </Notice>
      ) : !correlations.data ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {t("factor.sheet.closest_loading")}
        </p>
      ) : !partners || partners.length === 0 ? (
        <p className="text-xs text-muted">{t("factor.sheet.closest_none")}</p>
      ) : (
        <ul className="space-y-0.5">
          {partners.map((p) => (
            <li key={p.measure}>
              <button
                type="button"
                onClick={() => onPick(p.measure)}
                aria-label={t("factor.sheet.closest_open", { measure: measureName(p.measure), r: formatNumber(p.r, locale, 2) })}
                className="grid w-full grid-cols-[1fr_5rem_2.5rem] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="min-w-0 break-words">{measureName(p.measure)}</span>
                <span aria-hidden className="relative block h-1.5 rounded-full bg-tile">
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      background: signColor(p.r),
                      width: `${Math.min(1, Math.abs(p.r)) * 100}%`,
                      left: 0,
                    }}
                  />
                </span>
                <span aria-hidden className="text-right font-mono tabular-nums">
                  {formatNumber(p.r, locale, 2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExcludeButton({ excluded, locked, onClick }: { excluded: boolean; locked: boolean; onClick: () => void }) {
  const t = useT();
  const label = t(excluded ? "factor.sheet.include" : "factor.sheet.exclude");
  const tip = useTip<HTMLButtonElement>(locked ? { name: label, reason: t("factor.sheet.locked", { n: MIN_MEASURES }) } : null);
  const Icon = excluded ? Plus : Ban;
  return (
    <button
      ref={tip}
      type="button"
      onClick={() => !locked && onClick()}
      aria-disabled={locked || undefined}
      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-tile px-4 text-sm font-medium transition hover:bg-accent/[0.08] aria-disabled:opacity-50 aria-disabled:hover:bg-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
