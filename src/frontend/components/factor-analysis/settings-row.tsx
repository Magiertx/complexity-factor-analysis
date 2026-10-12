"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, BookOpen, Check, RotateCcw, X } from "lucide-react";
import type { FactorAnalysis, PublishedMatch } from "@/lib/api";
import { sameOptions, settingsSummary, type AnalysisOptions, type SettingChip } from "@/lib/factor-analysis";
import { formatNumber } from "@/lib/format";
import { paperTablesText } from "@/lib/paper-notes";
import { cn } from "@/lib/utils";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";

/** The control each chip of the row leads to; see the ids in the steps. */
const CONTROLS: Record<SettingChip["id"], string> = {
  measures: "fa-msa-table",
  msa: "fa-msa-threshold",
  alpha: "fa-bartlett-alpha",
  factors: "fa-factor-count",
  rotation: "fa-rotation",
  loading: "fa-loading-threshold",
  communality: "fa-communality-threshold",
  rule: "fa-assignment",
};

/** Scrolls to a control and focuses it, or the chosen or first input inside it. */
function focusControl(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  const target =
    el.matches("input, button, output, [tabindex]")
      ? el
      : el.querySelector<HTMLElement>("input:checked, input:not([disabled]), button");
  target?.focus({ preventScroll: true });
}

interface Props {
  options: AnalysisOptions;
  standard: AnalysisOptions;
  /** The settings of the paper the dataset comes from, if any. */
  published: AnalysisOptions | null;
  /** Where the paper reports them. */
  publishedSource?: string;
  /** The analysis on screen; its counts fill in the chips. */
  analysis: FactorAnalysis | null;
  /** Measures of the dataset after the cleaning. */
  measureCount: number;
  /** The comparison with the report, for the analysis on screen if it used the published settings. */
  match: PublishedMatch | null;
  onApply: (options: AnalysisOptions, which: "standard" | "published") => void;
  /** Further actions at the end of the row, e.g. the link to this analysis. */
  extra?: React.ReactNode;
}

/**
 * The settings of steps 3 to 5 in one line, with the chips that differ from the tool standard
 * tinted, the buttons to go back to the standard or to the paper's settings, and whether the
 * numbers equal the published report. Sticky on a wide screen; on a phone it scrolls sideways
 * inside itself.
 */
export function SettingsRow({
  options,
  standard,
  published,
  publishedSource,
  analysis,
  measureCount,
  match,
  onApply,
  extra,
}: Props) {
  const t = useT();
  const chips = settingsSummary(options, standard, analysis, measureCount, t);
  const isStandard = sameOptions(options, standard);
  const isPublished = !!published && sameOptions(options, published);
  const action =
    "h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap transition hover:bg-accent/[0.08] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <section
      aria-label={t("factor.settings.aria")}
      className="lg:sticky lg:top-3 z-20 rounded-lg bg-surface/95 backdrop-blur shadow-sm ring-1 ring-border/60"
    >
      <div className="flex items-center gap-2 px-2 py-1.5 overflow-x-auto no-scrollbar">
        <ul className="flex items-center text-xs whitespace-nowrap shrink-0">
          {chips.map((chip, i) => (
            <li key={chip.id} className="flex items-center">
              {i > 0 && (
                <span aria-hidden className="px-0.5 text-muted">
                  ·
                </span>
              )}
              <button
                type="button"
                onClick={() => focusControl(CONTROLS[chip.id])}
                title={chip.differs ? t("factor.settings.chip_changed_title") : t("factor.settings.chip_title")}
                className={cn(
                  "rounded px-1.5 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  chip.differs ? "bg-accent/[0.12] text-fg font-medium hover:bg-accent/[0.18]" : "text-muted hover:text-fg hover:bg-tile",
                )}
              >
                {chip.text}
                {chip.differs && <span className="sr-only"> ({t("factor.settings.changed")})</span>}
              </button>
            </li>
          ))}
        </ul>
        <span className="flex-1" />
        {match && <MatchChip match={match} publishedSource={publishedSource} />}
        <span className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            className={action}
            disabled={isStandard}
            onClick={() => onApply(standard, "standard")}
            title={t("factor.settings.reset_title")}
            aria-label={t("factor.settings.reset")}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            <span aria-hidden className="hidden sm:inline">
              {t("factor.settings.reset_short")}
            </span>
          </button>
          {published && (
            <button
              type="button"
              className={action}
              disabled={isPublished}
              onClick={() => onApply(published, "published")}
              title={publishedSource ? t("factor.settings.paper_title", { source: publishedSource }) : t("factor.settings.paper")}
              aria-label={t("factor.settings.paper")}
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              <span aria-hidden className="hidden sm:inline">
                {t("factor.settings.paper_short")}
              </span>
            </button>
          )}
          {extra}
        </span>
      </div>
    </section>
  );
}

/**
 * Whether the numbers of the analysis equal the published report, as a chip; a click shows what
 * was compared, the differences and how the paper's own tables relate to the report.
 */
function MatchChip({ match, publishedSource }: { match: PublishedMatch; publishedSource?: string }) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const ok = match.status === "match";
  const tables = paperTablesText(match.paper_tables, t);
  const value = (v: number | string | null) =>
    typeof v === "number" ? formatNumber(v, locale, 4) : v === null ? "–" : String(v);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(360, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), top: r.bottom + 6 });
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  const shown = open && pos !== null;
  useEffect(() => {
    if (!shown) return;
    panelRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [shown, place, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        className={cn(
          "h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          ok ? "bg-success/15 text-success-ink hover:bg-success/25" : "bg-warn/15 text-warn-ink hover:bg-warn/25",
        )}
      >
        {ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
        {t(ok ? "factor.match.chip_match" : "factor.match.chip_differs")}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            style={{ position: "fixed", left: pos.left, top: pos.top, width: Math.min(360, window.innerWidth - 16) }}
            className="z-50 rounded-lg bg-surface p-3.5 text-xs shadow-xl ring-1 ring-border/70 space-y-2.5 focus:outline-none"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 id={titleId} className="text-sm font-semibold">
                {t("factor.match.title")}
              </h3>
              <button
                type="button"
                onClick={() => close()}
                aria-label={t("common.close")}
                className="-mt-1 -mr-1 h-6 w-6 grid place-items-center rounded text-muted hover:text-fg hover:bg-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <p className={ok ? "text-success-ink" : "text-warn-ink"}>
              {ok
                ? t("factor.match.summary_match", { tolerance: formatNumber(match.tolerance, locale) })
                : t("factor.match.summary_differs", {
                    n: match.differences.length,
                    tolerance: formatNumber(match.tolerance, locale),
                  })}
            </p>
            <div>
              <div className="text-muted">{t("factor.match.compared")}</div>
              <ul className="mt-1 flex flex-wrap gap-1">
                {match.compared.map((c) => (
                  <li key={c} className="rounded bg-tile px-1.5 py-0.5">
                    {tMaybe(`factor.match.what.${c}`) ?? c}
                  </li>
                ))}
              </ul>
            </div>
            {match.differences.length > 0 && (
              <div className="max-h-40 overflow-auto rounded-md bg-tile/50">
                <table className="w-full">
                  <caption className="sr-only">{t("factor.match.differences")}</caption>
                  <thead className="text-muted">
                    <tr>
                      <th scope="col" className="px-2 py-1 text-left font-medium">
                        {t("factor.match.col_what")}
                      </th>
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        {t("factor.match.col_expected")}
                      </th>
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        {t("factor.match.col_actual")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {match.differences.map((d, i) => (
                      <tr key={i}>
                        <th scope="row" className="px-2 py-0.5 text-left font-normal break-all">
                          {d.what}
                        </th>
                        <td className="px-2 py-0.5 text-right font-mono tabular-nums">{value(d.expected)}</td>
                        <td className="px-2 py-0.5 text-right font-mono tabular-nums">{value(d.actual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-muted">{t("factor.match.numbers_only")}</p>
            {tables && <p>{tables}</p>}
            <dl className="space-y-0.5 text-[11px] text-muted">
              <div>
                <dt className="inline">{t("factor.match.source")}: </dt>
                <dd className="inline break-all font-mono">{match.source}</dd>
              </div>
              {publishedSource && (
                <div>
                  <dt className="inline">{t("factor.match.settings_from")}: </dt>
                  <dd className="inline">{publishedSource}</dd>
                </div>
              )}
            </dl>
          </div>,
          document.body,
        )}
    </>
  );
}
