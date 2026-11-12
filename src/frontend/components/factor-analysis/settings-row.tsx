"use client";

// The row of settings chips above the steps: the current settings at a glance, each leading to its control.

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { AlertTriangle, BookOpen, Check, RotateCcw } from "lucide-react";
import type { FactorAnalysis, PublishedDifference, PublishedMatch } from "@/lib/api";
import { sameOptions, settingsSummary, type AnalysisOptions, type SettingChip } from "@/lib/factor-analysis";
import { formatNumber } from "@/lib/format";
import { paperTablesText, settingsSourceText } from "@/lib/paper-notes";
import { cn } from "@/lib/utils";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/popover";
import { TableFrame } from "@/components/ui/table";
import { useTip } from "@/components/ui/tip";
import { useScrollFade } from "@/lib/use-scroll-fade";

/** The control each chip of the row leads to; see the ids in the steps. */
export const SETTING_CONTROLS: Record<SettingChip["id"], string> = {
  miner: "fa-miner",
  measures: "fa-msa-table",
  msa: "fa-msa-threshold",
  alpha: "fa-bartlett-alpha",
  factors: "fa-factor-count",
  rotation: "fa-rotation",
  loading: "fa-loading-threshold",
  communality: "fa-communality-threshold",
  rule: "fa-assignment",
};

/**
 * Scrolls to a control and focuses it, or the chosen or first input inside it. The selectors
 * are tried in turn: one list would give the first match in document order, which is the "?"
 * of the label above the inputs.
 */
export function focusControl(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  const target = el.matches("input, button, output, [tabindex]")
    ? el
    : (el.querySelector<HTMLElement>("input:checked") ??
      el.querySelector<HTMLElement>("input:not([disabled])") ??
      el.querySelector<HTMLElement>("button"));
  target?.focus({ preventScroll: true });
}

/** The top offset of the sticky row (lg:top-3) and some room below it, in pixels. */
const STICKY_TOP = 12;
const STICKY_GAP = 8;

/**
 * Keeps --settings-row-offset on the document at the height the row covers when it sticks,
 * which globals.css turns into the scroll padding of a wide screen: a control the keyboard
 * focuses then scrolls into view below the row, not under it (WCAG 2.4.11).
 */
function useStickyOffset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () =>
      root.style.setProperty(
        "--settings-row-offset",
        `${Math.ceil(el.getBoundingClientRect().height) + STICKY_TOP + STICKY_GAP}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--settings-row-offset");
    };
  }, [ref]);
}

/** The props of `SettingsRow`. */
interface Props {
  options: AnalysisOptions;
  standard: AnalysisOptions;
  /** The settings of the paper the dataset comes from, if any. */
  published: AnalysisOptions | null;
  /** Where the paper reports them, as the catalog cites it. */
  publishedSource?: string;
  /** "report" if only the ComFy report analyses the dataset, with the paper's settings. */
  publishedScope?: string;
  /** The bundled dataset, for notes on how its paper prints the numbers. */
  bundledId?: string | null;
  /** The analysis on screen; its counts fill in the chips. */
  analysis: FactorAnalysis | null;
  /** Measures of the dataset after the cleaning. */
  measureCount: number;
  /** The comparison with the report, for the analysis on screen if it used the published settings. */
  match: PublishedMatch | null;
  onApply: (options: AnalysisOptions, which: "standard" | "published") => void;
  /** A chip was pressed: open the step of its control and focus the control. */
  onGoToSetting: (chip: SettingChip["id"]) => void;
}

/**
 * The settings of steps 3 to 5 in one line, with the chips that differ from the tool standard
 * tinted, the buttons to go back to the standard or to the paper's settings, and whether the
 * numbers equal the published report. Sticky on a wide screen, where the buttons move to a second
 * line when the first is full (German with the match chip is wider than 1400 px allow). On a
 * phone the chips scroll sideways, with a fade where more follow, and the buttons sit on a line
 * of their own below them, where no swipe is needed to find them.
 */
export function SettingsRow({
  options,
  standard,
  published,
  publishedSource,
  publishedScope,
  bundledId,
  analysis,
  measureCount,
  match,
  onApply,
  onGoToSetting,
}: Props) {
  const t = useT();
  const rowRef = useRef<HTMLElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  useStickyOffset(rowRef);
  useScrollFade(chipsRef);
  const chips = settingsSummary(options, standard, analysis, measureCount, t, published?.n_factors ?? null);
  const source = settingsSourceText(publishedSource, publishedScope, t);
  const isStandard = sameOptions(options, standard);
  const isPublished = !!published && sameOptions(options, published);
  // Inactive buttons stay focusable (aria-disabled, with the reason in their tooltip): the one
  // just pressed would else drop the focus to the page, a Tab before the "Undo" of the toast.

  return (
    <section
      ref={rowRef}
      aria-label={t("factor.settings.aria")}
      className="lg:sticky lg:top-3 z-20 rounded-lg bg-surface/95 backdrop-blur shadow-sm ring-1 ring-border/60"
    >
      {/* relative: screen-reader texts in the row stay inside it instead of widening the page. */}
      <div className="relative flex flex-col gap-1 px-2 py-1.5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-2 lg:gap-y-1">
        <div
          ref={chipsRef}
          className="scroll-fade relative min-w-0 overflow-x-auto no-scrollbar lg:overflow-x-visible lg:[mask-image:none] lg:[-webkit-mask-image:none]"
        >
          <ul className="flex flex-wrap items-center gap-y-0.5 text-xs">
            {chips.map((chip, i) => (
              <li key={chip.id} className="flex items-center">
                {i > 0 && (
                  <span aria-hidden className="px-0.5 text-muted">
                    ·
                  </span>
                )}
                <SettingChipButton chip={chip} onGo={() => onGoToSetting(chip.id)} />
              </li>
            ))}
          </ul>
        </div>
        <span className="flex items-center gap-2 shrink-0 lg:ml-auto">
          {match && <MatchChip match={match} settingsSource={source} bundledId={bundledId} />}
          <span className="flex items-center gap-1.5">
            <IconButton
              size="sm"
              icon={RotateCcw}
              name={t("factor.settings.reset")}
              more={t("factor.settings.reset_title")}
              reason={isStandard ? t("factor.settings.reset_none") : null}
              onClick={() => onApply(standard, "standard")}
            />
            {published && (
              <IconButton
                size="sm"
                icon={BookOpen}
                name={t("factor.settings.paper")}
                more={source ? t("factor.settings.paper_title", { source }) : undefined}
                reason={isPublished ? t("factor.settings.paper_none") : null}
                onClick={() => onApply(published, "published")}
              />
            )}
          </span>
        </span>
      </div>
    </section>
  );
}

/**
 * One setting of the row: a press goes to its control. Settings that differ from the tool standard
 * stand out on a neutral tile, the others are muted text.
 */
function SettingChipButton({ chip, onGo }: { chip: SettingChip; onGo: () => void }) {
  const t = useT();
  const tip = useTip<HTMLButtonElement>({
    more: chip.differs ? t("factor.settings.chip_changed_title") : t("factor.settings.chip_title"),
  });
  return (
    <button
      ref={tip}
      type="button"
      onClick={onGo}
      className={cn(
        "rounded px-1.5 py-1 whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        chip.differs
          ? "bg-tile text-fg font-medium hover:bg-accent/[0.08] hover:ring-1 hover:ring-inset hover:ring-accent/40"
          : "text-muted hover:text-fg hover:bg-tile hover:ring-1 hover:ring-inset hover:ring-border",
      )}
    >
      {chip.text}
      {chip.differs && <span className="sr-only"> ({t("factor.settings.changed")})</span>}
    </button>
  );
}

/**
 * Whether the numbers of the analysis equal the published report, as a chip; a click shows what
 * was compared, the differences and how the paper's own tables relate to the report.
 */
function MatchChip({
  match,
  settingsSource,
  bundledId,
}: {
  match: PublishedMatch;
  /** Where the settings come from, in the UI language. */
  settingsSource: string | null;
  bundledId?: string | null;
}) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();
  const ok = match.status === "match";
  const tables = paperTablesText(match.paper_tables, match.paper_tables_ref, match.paper_tables_note, t, {
    locale,
    datasetId: bundledId ?? undefined,
  });
  // A number, or where a set differs the measures (with their filter step) as a list.
  const value = (v: unknown): string => {
    if (typeof v === "number") return formatNumber(v, locale, 4);
    if (v === null || v === undefined) return "–";
    if (Array.isArray(v)) return v.map(value).join(", ");
    if (typeof v === "object") {
      return Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => `${k}: ${value(x)}`)
        .join(", ");
    }
    return String(v);
  };
  // The report in the UI language where the server names its parts, else the server's English.
  const source = match.report
    ? t("factor.match.report_at", {
        file: match.report.file,
        repository: match.report.repository.replace(/\/+$/, "").split("/").pop() ?? match.report.repository,
        commit: match.report.commit.slice(0, 7),
      })
    : match.source;
  // In the UI language where the server names the value, else the server's English.
  const what = (d: PublishedDifference) =>
    (d.code &&
      tMaybe(`factor.match.diff.${d.code}`, {
        measure: d.measure ?? "",
        factor: d.factor === undefined ? "" : d.factor + 1,
      })) ||
    d.what;
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(true) : setOpen(true))}
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
      <Popover
        open={open}
        onClose={close}
        anchor={triggerRef}
        title={t("factor.match.title")}
        titleId={titleId}
        id={panelId}
      >
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
          <TableFrame label={t("factor.match.differences")} boxed className="max-h-40">
            <table className="data-table">
              <caption className="sr-only">{t("factor.match.differences")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("factor.match.col_what")}</th>
                  <th scope="col" className="num">
                    {t("factor.match.col_expected")}
                  </th>
                  <th scope="col" className="num">
                    {t("factor.match.col_actual")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {match.differences.map((d, i) => (
                  <tr key={i}>
                    <th scope="row" className="break-words">
                      {what(d)}
                    </th>
                    <td className="num">{value(d.expected)}</td>
                    <td className="num">{value(d.actual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
        <p className="text-muted">{t("factor.match.numbers_only")}</p>
        {tables && <p>{tables}</p>}
        <dl className="space-y-0.5 text-xs text-muted">
          <div>
            <dt className="inline">{t("factor.match.source")}: </dt>
            <dd className="inline break-all font-mono">{source}</dd>
          </div>
          {settingsSource && (
            <div>
              <dt className="inline">{t("factor.match.settings_from")}: </dt>
              <dd className="inline">{settingsSource}</dd>
            </div>
          )}
        </dl>
      </Popover>
    </>
  );
}
