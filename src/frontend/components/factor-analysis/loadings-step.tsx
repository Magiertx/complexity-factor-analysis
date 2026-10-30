"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Columns3, Grid3x3, LayoutGrid, Pin, PinOff, Tags, X } from "lucide-react";
import { ASSIGNMENT_RULES, type AssignmentRule, type FactorAnalysis } from "@/lib/api";
import {
  ORTHOGONAL,
  RULE_LIMITS,
  assignedCells,
  countText,
  crossLoadingsByMeasure,
  effectiveCommunality,
  factorName,
  loadingCounts,
  loadingStyle,
  notableLoadingMeasures,
  orderMeasures,
  primaryFactor,
  ruleStrict,
  secondaryCells,
  signColor,
  signInk,
  unassignedMeasures,
  type AnalysisOptions,
  type FactorNames,
  type UnassignedMeasure,
} from "@/lib/factor-analysis";
import { FOLDING_LOADINGS, LONG_LIST, arrangeLoadings, matchesQuery, otherShown } from "@/lib/measure-list";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { ActionLink } from "@/components/ui/action-link";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/segmented";
import { MeasureListScope, MeasureName, TableFrame } from "@/components/ui/table";
import { useTip, useTipZone } from "@/components/ui/tip";
import { InfoTip } from "@/components/ui/info-tip";
import { FactorTitle } from "./factor-title";
import { FigureMenu, type FigureDownload } from "./figure-menu";
import { FoldButton, SectionRow, type Fold } from "./measure-fold";
import { MeasureSearch, NotableSwitch } from "./measure-search";
import { HelpLabel, ThresholdField } from "./step-section";
import {
  FactorCongruence,
  MeasureStability,
  RepresentativeBadge,
  ShortSetCard,
  StabilityBar,
  StabilityPairs,
  stabilityByMeasure,
  type StabilityView,
} from "./stability";

/** The names of the factors of the solution on screen, and how they change. */
export interface FactorNaming {
  names: FactorNames;
  /** Names factor `index` (from 0); an empty text takes the name away. */
  onName: (index: number, text: string) => void;
  /** The names an interpretation of this solution suggests; null without one. */
  suggested: FactorNames | null;
  onSuggested: () => void;
}

/** The solution on screen as a column of a comparison to come. */
export interface PinState {
  pinned: boolean;
  /** Solutions pinned, this one included. */
  count: number;
  /** Why it cannot be pinned now, e.g. while the analysis catches up with a change. */
  reason: string | null;
  /** The comparison of the pins; null with fewer than two. */
  href: string | null;
  onToggle: () => void;
  onClear: () => void;
}

/**
 * How the loadings of a long list of measures are narrowed and folded, in the matrix and in the
 * cards of the dimensions alike; kept by the tab while other steps are open.
 */
export interface LoadingsFilter {
  query: string;
  /** Only measures that load on several factors or on none. */
  onlyNotable: boolean;
  /** The measures below the notable ones are unfolded (a list of `FOLDING_LOADINGS` or more). */
  showOther: boolean;
}

export const DEFAULT_LOADINGS_FILTER: LoadingsFilter = { query: "", onlyNotable: false, showOther: false };

/** How a long list of loadings is narrowed and folded, worked out once for the matrix and the cards. */
interface LoadingsList {
  query: string;
  onlyNotable: boolean;
  /** The measures worth a look: cross-loaded, or without a factor. */
  notable: ReadonlySet<string>;
  /** The list starts with the notable measures and folds the others. */
  folds: boolean;
  /** The others are shown. */
  otherOpen: boolean;
  /** The button that folds and unfolds them; none while a search or the order shows them anyway. */
  fold: Fold | undefined;
}

interface Props {
  analysis: FactorAnalysis;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
  measureName: (key: string) => string;
  /** What a measure measures, for its tooltip. */
  measureDescription: (key: string) => string | undefined;
  /** Where the paper's dimension tables differ from the chosen rule, for a bundled dataset. */
  assignmentNote?: string | null;
  filter: LoadingsFilter;
  onFilter: (filter: LoadingsFilter) => void;
  /** The look and order of the loadings, which the print view and the figure follow as well. */
  look: LoadingsLookState;
  onLook: (patch: Partial<LoadingsLookState>) => void;
  /** Downloads the loadings heatmap for a paper. */
  figure?: FigureDownload;
  naming: FactorNaming;
  /** Pinning the solution for a comparison; absent where there is nothing to compare it with. */
  pin?: PinState | null;
  /** The stability of the solution over bootstrap samples, checked on request. */
  stability?: StabilityView;
}

/** What makes a loading bold: the rule's assignment, or the threshold reached or exceeded. */
type BoldBy = "assigned" | "exceeds" | "reaches";

/** The measure with the highest loading, by its display name: the provisional label of a factor nobody has named. */
function topName(rows: Iterable<{ measure: string; loading: number }>, name: (key: string) => string): string | null {
  let best: { measure: string; loading: number } | null = null;
  for (const r of rows) if (!best || Math.abs(r.loading) > Math.abs(best.loading)) best = r;
  return best ? name(best.measure) : null;
}

/** The loadings as one table or as one card per factor; one or the other, never both. */
type LoadingsLook = "matrix" | "dimensions";
/** The address names the matrix (?view=matrix); the dimensions, the default, need no parameter. */
const VIEW_PARAM = "view";
type MeasureOrder = "factor" | "original";

/** How the loadings are shown: as a matrix or as cards, and in which order. */
export interface LoadingsLookState {
  look: LoadingsLook;
  order: MeasureOrder;
}

const LOOK_KEY = "app.factor-loadings-look";

/** The look and order chosen last, remembered in the browser. */
export function useLoadingsLook(): [LoadingsLookState, (patch: Partial<LoadingsLookState>) => void] {
  const [state, setState] = useState<LoadingsLookState>({ look: "dimensions", order: "factor" });
  useEffect(() => {
    let order: MeasureOrder = "factor";
    try {
      order = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null")?.order === "original" ? "original" : "factor";
    } catch {
      /* storage blocked or unreadable */
    }
    const look = new URLSearchParams(window.location.search).get(VIEW_PARAM) === "matrix" ? "matrix" : "dimensions";
    setState({ look, order });
  }, []);
  const update = (patch: Partial<LoadingsLookState>) => {
    // The view goes into the address, so a shared link opens it; the default needs no parameter.
    if (patch.look) {
      const url = new URL(window.location.href);
      if (patch.look === "matrix") url.searchParams.set(VIEW_PARAM, "matrix");
      else url.searchParams.delete(VIEW_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setState((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(LOOK_KEY, JSON.stringify({ order: next.order }));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  };
  return [state, update];
}

export function LoadingsView({
  analysis,
  options,
  onOptions,
  measureName,
  measureDescription,
  assignmentNote,
  filter,
  onFilter,
  look: { look, order },
  onLook: setLook,
  figure,
  naming,
  pin,
  stability,
}: Props) {
  const t = useT();
  const { locale } = useLocale();
  const [matrix, setMatrix] = useState<"pattern" | "structure">("pattern");
  const oblique = analysis.rotation !== "none" && !(ORTHOGONAL as string[]).includes(analysis.rotation);
  const threshold = options.loading_threshold;

  // A long list can be searched and narrowed to the measures worth a look, and from
  // FOLDING_LOADINGS measures on it starts with those and folds the rest, like the list of the
  // MSA. Only what the table or the cards show changes, never the analysis.
  const long = analysis.used_measures.length >= LONG_LIST;
  const notable = useMemo(() => notableLoadingMeasures(analysis), [analysis]);
  const notableCount = analysis.used_measures.filter((m) => notable.has(m)).length;
  const applied = long ? filter : DEFAULT_LOADINGS_FILTER;
  const folds = analysis.used_measures.length >= FOLDING_LOADINGS;
  const shown = otherShown({
    folds,
    query: applied.query,
    // Another order than the default is a question about the whole list, as a sort is.
    reordered: look === "matrix" && order === "original",
    showOther: applied.showOther,
  });
  const list: LoadingsList = {
    query: applied.query,
    onlyNotable: applied.onlyNotable,
    notable,
    folds,
    otherOpen: shown.open,
    fold: shown.byView ? undefined : { open: shown.open, onToggle: () => onFilter({ ...filter, showOther: !filter.showOther }) },
  };

  return (
    <div className="space-y-5">
      {/* The settings of this step in one compact row above the result: the rule with its source,
          the explanation of each rule in its tooltip, and the two thresholds. */}
      <div className="space-y-2">
        <div className="flex items-end gap-x-6 gap-y-3 flex-wrap">
          <RuleChoice value={options.assignment_rule} onChange={(rule) => onOptions({ assignment_rule: rule })} note={assignmentNote} />
          <ThresholdField
            id="fa-loading-threshold"
            label={t("factor.loadings.threshold_label")}
            help={t("factor.help.threshold")}
            value={threshold}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onOptions({ loading_threshold: v })}
          />
          <ThresholdField
            id="fa-communality-threshold"
            label={t("factor.loadings.communality_threshold_label")}
            help={t("factor.help.communality_threshold")}
            value={options.communality_threshold}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onOptions({ communality_threshold: v })}
            note={
              effectiveCommunality(options) > options.communality_threshold
                ? t("factor.loadings.communality_raised", {
                    value: formatNumber(effectiveCommunality(options), locale, 1),
                  })
                : null
            }
          />
        </div>
      </div>

      <div className="space-y-3">
        {/* How the result is shown; the words of the options say what they are. */}
        <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
          <div className="flex items-center gap-x-2 gap-y-2 flex-wrap">
            <Segmented<LoadingsLook>
              size="sm"
              aria-label={t("factor.loadings.look_label")}
              value={look}
              onChange={(v) => setLook({ look: v })}
              options={[
                {
                  value: "matrix",
                  label: (
                    <>
                      <Grid3x3 className="h-3.5 w-3.5" aria-hidden />
                      {t("factor.loadings.look_matrix")}
                    </>
                  ),
                },
                {
                  value: "dimensions",
                  label: (
                    <>
                      <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                      {t("factor.loadings.look_dimensions")}
                    </>
                  ),
                },
              ]}
            />
            {look === "matrix" && oblique && analysis.structure_loadings && (
              <Segmented
                size="sm"
                aria-label={t("factor.loadings.matrix_label")}
                value={matrix}
                onChange={setMatrix}
                options={[
                  { value: "pattern", label: t("factor.loadings.matrix_pattern") },
                  { value: "structure", label: t("factor.loadings.matrix_structure") },
                ]}
              />
            )}
            {look === "matrix" && (
              <Segmented<MeasureOrder>
                size="sm"
                aria-label={t("factor.loadings.order_label")}
                value={order}
                onChange={(v) => setLook({ order: v })}
                options={[
                  { value: "factor", label: t("factor.loadings.order_factor") },
                  { value: "original", label: t("factor.loadings.order_original") },
                ]}
              />
            )}
          </div>
          {pin && <PinTools pin={pin} />}
        </div>

        {long && (
          <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
            <MeasureSearch value={filter.query} onChange={(query) => onFilter({ ...filter, query })} />
            <NotableSwitch
              id="fa-loadings-notable"
              checked={filter.onlyNotable}
              onChange={(onlyNotable) => onFilter({ ...filter, onlyNotable })}
              label={t("factor.loadings.only_notable", { n: notableCount })}
              help={t("factor.loadings.only_notable_more")}
            />
          </div>
        )}

        {look === "matrix" ? (
          <LoadingsMatrix
            analysis={analysis}
            options={options}
            order={order}
            structureShown={oblique && matrix === "structure"}
            measureName={measureName}
            measureDescription={measureDescription}
            list={list}
            figure={figure}
            naming={naming}
          />
        ) : (
          <FactorGroups
            analysis={analysis}
            measureName={measureName}
            measureDescription={measureDescription}
            list={list}
            figure={figure}
            naming={naming}
            stability={stability}
          />
        )}
        {/* Of an oblique rotation, in either view: the table belongs to the result, not to the matrix. */}
        {oblique && analysis.factor_correlations && (
          <FactorCorrelations values={analysis.factor_correlations} names={naming.names} />
        )}
      </div>
    </div>
  );
}

function LoadingsMatrix({
  analysis,
  options,
  order,
  structureShown,
  measureName,
  measureDescription,
  list,
  figure,
  naming,
}: {
  analysis: FactorAnalysis;
  options: AnalysisOptions;
  order: MeasureOrder;
  structureShown: boolean;
  measureName: (key: string) => string;
  measureDescription: (key: string) => string | undefined;
  list: LoadingsList;
  figure?: FigureDownload;
  naming: FactorNaming;
}) {
  const t = useT();
  const { locale } = useLocale();
  const zone = useTipZone<HTMLTableElement>();
  const k = analysis.n_factors;
  const factorIdx = Array.from({ length: k }, (_, i) => i);
  const ordered = orderMeasures(analysis, order);
  const sections = arrangeLoadings({
    measures: ordered,
    name: measureName,
    query: list.query,
    onlyNotable: list.onlyNotable,
    notable: list.notable,
    folds: list.folds,
  });
  const shownCount = sections.reduce((n, s) => n + s.rows.length, 0);
  // The measures on screen in their order, which the fact sheet of one of them pages through.
  const onScreen = sections.flatMap((section) => (section.id !== "other" || list.otherOpen ? section.rows : []));
  const headed = sections.length > 1;
  const sectionLabel = (id: string, n: number) =>
    `${t(id === "notable" ? "factor.measures.section_notable" : "factor.measures.section_other")} · ${formatNumber(n, locale)}`;
  const threshold = options.loading_threshold;
  const oblique = analysis.rotation !== "none" && !(ORTHOGONAL as string[]).includes(analysis.rotation);
  const structure = structureShown ? analysis.structure_loadings : null;
  const shown = structure ?? analysis.loadings;
  const { proportion, cumulative } = analysis.variance;
  // Fifteen factors still fit a wide screen with tighter cells.
  const dense = k > 8;
  const cell = dense ? "px-2" : undefined;
  // The rule works on the pattern loadings, so only they get the ring of a cross-loading.
  const secondary = structure ? new Set<string>() : secondaryCells(analysis);
  const crossLabel = t("factor.loadings.cross_cell");
  // Under "multi" and "hair" the cells the rule assigned are bold, as the paper's dimension
  // tables mark them and the LaTeX export does; under "largest" every loading that counts, as in
  // ComFy's report. The structure matrix, which no rule reads, keeps the threshold.
  const assigned = !structure && (analysis.assignment_rule ?? "largest") !== "largest" ? assignedCells(analysis) : null;
  const strict = ruleStrict(options.assignment_rule);
  const boldBy: BoldBy = assigned ? "assigned" : strict ? "exceeds" : "reaches";
  const isBold = (measure: string, factor: number, value: number) =>
    assigned ? assigned.has(`${measure}:${factor}`) : loadingCounts(value, threshold, strict);

  return (
    <div className="space-y-2">
      {/* The download of the heatmap sits at the title of the matrix, on every width. */}
      <HelpLabel
        label={t("factor.loadings.table_heading")}
        help={t("factor.help.loading")}
        extra={
          <>
            {figure && <FigureMenu name={t("factor.figure.loadings")} figure={figure} />}
            <SuggestedNames naming={naming} />
          </>
        }
      />
      <Legend threshold={threshold} boldBy={boldBy} crossed={secondary.size > 0} strict={strict} />
      <MeasureListScope measures={onScreen}>
        <TableFrame label={t("factor.loadings.table_heading")} className="w-fit max-w-full">
          <table ref={zone} className="data-table w-auto">
            <caption className="sr-only">
              {countText(t, "factor.loadings.caption", k, { rotation: t(`factor.factors.rotation.${analysis.rotation}`) })}
              {oblique && ` (${t(`factor.loadings.matrix_${structure ? "structure" : "pattern"}`)})`}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky-col">
                  {t("factor.loadings.col_measure")}
                </th>
                {factorIdx.map((i) => (
                  <th key={i} scope="col" className={cn("num align-bottom", cell)}>
                    <FactorTitle
                      index={i}
                      name={factorName(naming.names, i)}
                      onName={(text) => naming.onName(i, text)}
                      look="column"
                    />
                  </th>
                ))}
                <th scope="col" className="num border-l border-border" data-tip={t("factor.loadings.col_communality")}>
                  h²
                </th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <Fragment key={section.id}>
                  {headed && section.rows.length > 0 && (
                    <SectionRow
                      colSpan={k + 2}
                      label={sectionLabel(section.id, section.rows.length)}
                      fold={section.id === "other" ? list.fold : undefined}
                    />
                  )}
                  {(section.id !== "other" || list.otherOpen ? section.rows : []).map((m) => {
                    const values = shown[m] ?? [];
                    const h2 = analysis.communalities[m];
                    const name = measureName(m);
                    return (
                      <tr key={m}>
                        <th scope="row" className="sticky-col font-medium break-words min-w-[9rem] max-w-[16rem]">
                          <span data-tip-more={measureDescription(m)}>
                            <MeasureName name={name} measure={m} />
                          </span>
                        </th>
                        {factorIdx.map((i) => {
                          const v = values[i];
                          if (v === undefined) return <td key={i} className={cell} />;
                          const strong = isBold(m, i, v);
                          // Loadings that do not count are faded, so the ones that do stand out.
                          const counts = loadingCounts(v, threshold, strict) || strong;
                          const crossed = secondary.has(`${m}:${i}`);
                          const factor = factorName(naming.names, i) ?? t("factor.loadings.factor_n", { i: i + 1 });
                          const tip = `${name} · ${factor}: ${formatNumber(v, locale, 3)}`;
                          return (
                            <td
                              key={i}
                              style={counts ? loadingStyle(v) : undefined}
                              data-tip={crossed ? `${tip} · ${crossLabel}` : tip}
                              className={cn(
                                "num",
                                cell,
                                strong ? "font-bold text-fg" : counts ? "text-fg/80" : "text-muted",
                                crossed && "ring-2 ring-inset ring-fg/55",
                              )}
                            >
                              {formatNumber(v, locale, 2)}
                              {crossed && <span className="sr-only"> ({crossLabel})</span>}
                            </td>
                          );
                        })}
                        <td className="num border-l border-border">
                          {h2 !== undefined && (
                            <span className="flex items-center justify-end gap-2">
                              <span className="hidden sm:block h-1.5 w-10 rounded-full bg-tile overflow-hidden" aria-hidden>
                                <span
                                  className="block h-full bg-muted/60 rounded-full"
                                  style={{ width: `${Math.min(1, Math.max(0, h2)) * 100}%` }}
                                />
                              </span>
                              {formatNumber(h2, locale, 2)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
            {/* The sums of squares are those of the pattern matrix; the structure matrix has none. */}
            {!structure && (
              <tfoot>
                <VarianceRow label={t("factor.loadings.ss_loadings")} values={analysis.variance.ss_loadings} format={(v) => formatNumber(v, locale, 2)} cell={cell} />
                {proportion && (
                  <VarianceRow label={t("factor.loadings.proportion")} values={proportion} format={(v) => formatPercent(v, locale)} cell={cell} />
                )}
                {cumulative && (
                  <VarianceRow label={t("factor.loadings.cumulative")} values={cumulative} format={(v) => formatPercent(v, locale)} cell={cell} />
                )}
              </tfoot>
            )}
          </table>
        </TableFrame>
        </MeasureListScope>
        {shownCount === 0 && <p className="text-xs text-muted">{t("factor.measures.none_match")}</p>}
        {/* What the numbers mean, behind one (i). */}
        <p className="flex items-center gap-1 text-xs text-muted">
          {t("factor.loadings.numbers_label")}
          <InfoTip size="xs" topic={t("factor.loadings.numbers_label")} text={t("factor.help.loading")} width={380}>
            <p>
              <span className="font-semibold">{t("factor.loadings.table_heading")}: </span>
              {t("factor.help.loading")}
            </p>
            <p>
              <span className="font-semibold">{t("factor.loadings.col_communality")}: </span>
              {t("factor.help.communality")} {t("factor.loadings.h2_note")}
            </p>
            <p>
              <span className="font-semibold">{t("factor.loadings.variance_label")}: </span>
              {t("factor.help.variance")}{" "}
              {!oblique
                ? t("factor.loadings.footer_rows")
                : structure
                  ? t("factor.loadings.structure_note")
                  : t("factor.loadings.footer_row_pattern")}
              {oblique && ` ${t("factor.loadings.oblique_note", { pct: formatPercent(analysis.variance.explained, locale) })}`}
            </p>
          </InfoTip>
        </p>

      </div>
    );
  }

  function VarianceRow({
    label,
    values,
    format,
    cell,
  }: {
    label: string;
    values: number[];
    format: (v: number) => string;
    cell?: string;
  }) {
    return (
      <tr>
        <th scope="row" className="sticky-col font-medium">
          {label}
        </th>
        {values.map((v, i) => (
          <td key={i} className={cn("num", cell)}>
            {format(v)}
          </td>
        ))}
        <td className="border-l border-border" />
      </tr>
    );
  }

  function FactorCorrelations({ values, names }: { values: number[][]; names: FactorNames }) {
    const t = useT();
    const { locale } = useLocale();
    const zone = useTipZone<HTMLTableElement>();
    // The columns keep the short numbers, the rows say the names; a column's name is in its tooltip.
    return (
      <div className="space-y-2 pt-2">
        <HelpLabel label={t("factor.loadings.correlations_heading")} help={t("factor.help.factor_correlations")} />
        <TableFrame label={t("factor.loadings.correlations_heading")} className="w-fit max-w-full">
          <table ref={zone} className="data-table w-auto">
            <caption className="sr-only">{t("factor.loadings.correlations_heading")}</caption>
            <thead>
              <tr>
                <td />
                {values.map((_, j) => (
                  <th key={j} scope="col" className="num" data-tip={factorName(names, j) ?? undefined}>
                    F{j + 1}
                    {factorName(names, j) && <span className="sr-only"> {factorName(names, j)}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {values.map((row, i) => (
                <tr key={i}>
                  <th scope="row" className="font-medium text-muted max-w-[14rem]">
                    F{i + 1}
                    {factorName(names, i) && <span className="ml-1.5 font-medium text-fg">{factorName(names, i)}</span>}
                  </th>
                  {row.map((v, j) => (
                    <td key={j} style={i === j ? undefined : loadingStyle(v)} className={cn("num", i === j && "text-muted")}>
                      {formatNumber(v, locale, 2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </div>
    );
  }

  /**
   * The rule that turns loadings into factor groups, compact: one option per rule with the source it
   * follows, and what it does in its tooltip. A row above the result of the loadings step, a column
   * in the comparison. Radios, so the rule chip of the settings row lands on the chosen one.
   */
  export function RuleChoice({
    value,
    onChange,
    note,
    id = "fa-assignment",
    vertical,
  }: {
    value: AssignmentRule;
    onChange: (rule: AssignmentRule) => void;
    /** A note on the paper's tables, behind an (i) next to the heading. */
    note?: string | null;
    /** The id of the block, and the name of its radios. */
    id?: string;
    /** One option under the other, for a narrow column. */
    vertical?: boolean;
  }) {
    const t = useT();
    const { locale } = useLocale();
    const limits = {
      gap: formatNumber(RULE_LIMITS.gap, locale, 2),
      h2_multi: formatNumber(RULE_LIMITS.multi_communality, locale, 1),
      h2_hair: formatNumber(RULE_LIMITS.hair_communality, locale, 1),
    };
    const label = t("factor.loadings.assignment_label");
    return (
      // Its id is where the rule chip of the settings row leads.
      <div id={id} className="space-y-1.5 min-w-0 max-w-full scroll-mt-24">
        <HelpLabel
          as="span"
          label={label}
          help={t("factor.help.assignment", limits)}
          extra={note ? <InfoTip size="xs" topic={t("factor.loadings.rule_note_short")} text={note} /> : undefined}
        />
        {note && (
          <span id={`${id}-note`} className="sr-only">
            {note}
          </span>
        )}
        <div
          role="radiogroup"
          aria-label={label}
          aria-describedby={note ? `${id}-note` : undefined}
                    className={cn("flex gap-2 max-w-full", vertical ? "flex-col" : "flex-wrap w-fit")}
        >
          {ASSIGNMENT_RULES.map((rule) => (
            <RuleOption
              key={rule}
              name={id}
              rule={rule}
              chosen={rule === value}
              text={t(`factor.loadings.rule.${rule}.text`, limits)}
              onChange={() => onChange(rule)}
            />
          ))}
        </div>
      </div>
    );
  }

  function RuleOption({
    name,
    rule,
    chosen,
    text,
    onChange,
  }: {
    name: string;
    rule: AssignmentRule;
    chosen: boolean;
    text: string;
    onChange: () => void;
  }) {
    const t = useT();
    const title = t(`factor.loadings.rule.${rule}.title`);
    // Where the rule comes from (a table of the paper, the report) is for whoever asks: the tip.
    const source = t("factor.loadings.rule_source", { source: t(`factor.loadings.rule.${rule}.source`) });
    const tip = useTip<HTMLLabelElement>({ name: title, more: `${text} ${source}` });
    return (
      <label
        ref={tip}
        // The one look of a chosen tile (docs/UI.md).
        className={cn("flex items-start gap-2 rounded-md px-2.5 py-1.5 min-w-0", choiceTile(chosen))}
      >
        <input
          type="radio"
          name={name}
          value={rule}
          className="sr-only"
          checked={chosen}
          onChange={onChange}
          aria-label={title}
          aria-describedby={`${name}-${rule}`}
        />
        <ChoiceMark type="radio" checked={chosen} className="mt-px" />
        <span className="min-w-0 leading-tight">
          <span className={cn("block text-[13px]", chosen ? "font-semibold" : "font-medium")}>{title}</span>
          <span id={`${name}-${rule}`} className="sr-only">
            {text} {source}
          </span>
        </span>
      </label>
    );
  }

  function Legend({
    threshold,
    boldBy,
    crossed,
    strict,
  }: {
    threshold: number;
    boldBy: BoldBy;
    crossed: boolean;
    strict: boolean;
  }) {
    const t = useT();
    const { locale } = useLocale();
    const value = formatNumber(threshold, locale, 2);
    return (
      <div className="flex items-start gap-x-4 gap-y-1 text-xs leading-snug text-muted flex-wrap" aria-hidden>
        {/* One chip per item: a line break falls between items, not inside one. */}
        <span className="flex items-start gap-1.5">
          <span className="mt-px h-3 w-3 shrink-0 rounded-sm" style={loadingStyle(-0.9)} />
          <span>{t("factor.loadings.legend_negative")}</span>
        </span>
        <span className="flex items-start gap-1.5">
          <span className="font-mono text-muted">{formatNumber(0.1, locale, 2)}</span>
          <span>
            {t(strict ? "factor.loadings.legend_faded_strict" : "factor.loadings.legend_faded", { threshold: value })}
          </span>
        </span>
        <span className="flex items-start gap-1.5">
          <b className="font-mono text-fg">{formatNumber(0, locale, 2)}</b>
          <span>
            {boldBy === "assigned"
              ? t("factor.loadings.legend_bold_assigned")
              : t(boldBy === "exceeds" ? "factor.loadings.legend_bold_strict" : "factor.loadings.legend_bold", {
                  threshold: value,
                })}
          </span>
        </span>
        {crossed && (
          <span className="flex items-start gap-1.5">
            <span className="mt-px h-3 w-3 shrink-0 rounded-sm ring-2 ring-inset ring-fg/55" />
            <span>{t("factor.loadings.legend_cross")}</span>
          </span>
        )}
      </div>
    );
  }

  function FactorGroups({
    analysis,
    measureName,
    measureDescription,
    list,
    figure,
    naming,
    stability,
  }: {
    analysis: FactorAnalysis;
    measureName: (key: string) => string;
    measureDescription: (key: string) => string | undefined;
    list: LoadingsList;
    figure?: FigureDownload;
    naming: FactorNaming;
    stability?: StabilityView;
  }) {
    const t = useT();
    const { locale } = useLocale();
    const zone = useTipZone<HTMLDivElement>();
    const [pairsOpen, setPairsOpen] = useState(false);
    const stable = stability?.result ?? null;
    const byStability = stabilityByMeasure(stable);
    const representatives = new Map((analysis.short_set ?? []).map((r) => [r.index, r]));
    // As the cards name a dimension: its own name, else "Factor 1 · Size".
    const dimensionName = (i: number) => {
      const f = analysis.factors.find((g) => g.index === i);
      const top = f ? topName(f.measures, measureName) : null;
      return factorName(naming.names, i) ?? [t("factor.loadings.factor_n", { i: i + 1 }), top].filter(Boolean).join(" · ");
    };
    const cross = crossLoadingsByMeasure(analysis);
    const unassigned = unassignedMeasures(analysis);
    // A search or the notable filter leaves some measures out; a card without any is left out too.
    const narrowed = list.query.trim() !== "" || list.onlyNotable;
    const matches = (m: string) => (!narrowed || matchesQuery(list.query, measureName(m), m)) && (!list.onlyNotable || list.notable.has(m));
    const unassignedShown = unassigned.filter((u) => matches(u.measure));
    const cards = analysis.factors.map((f) => {
      // The notable members first, then the others behind the fold, as in the matrix.
      const byKey = new Map(f.measures.map((m) => [m.measure, m]));
      const sections = arrangeLoadings({
        measures: f.measures.map((m) => m.measure),
        name: measureName,
        query: list.query,
        onlyNotable: list.onlyNotable,
        notable: list.notable,
        folds: list.folds,
      });
      return { factor: f, byKey, sections, count: sections.reduce((n, s) => n + s.rows.length, 0) };
    });
    const visible = cards.filter((c) => !narrowed || c.count > 0);
    // The measures on screen: card after card, then the unassigned ones; the fact sheet pages through them.
    const onScreen = [
      ...visible.flatMap((c) =>
        c.sections.flatMap((section) => (section.id !== "other" || list.otherOpen ? section.rows : [])),
      ),
      ...unassignedShown.map((u) => u.measure),
    ];
    return (
      <div className="space-y-2">
        <HelpLabel
          label={t("factor.loadings.groups_heading")}
          help={t("factor.help.groups")}
          extra={
            <>
              {figure && <FigureMenu name={t("factor.figure.loadings")} figure={figure} />}
              <SuggestedNames naming={naming} />
            </>
          }
        />
        {stability && <StabilityBar view={stability} />}
        <MeasureListScope measures={onScreen}>
        <div ref={zone} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map(({ factor: f, byKey, sections, count }) => {
            // index counts from 0; shares only exist for orthogonal rotations.
            const share = analysis.variance.proportion?.[f.index];
            return (
              <div key={f.index} className="rounded-lg bg-tile p-3.5 space-y-2.5 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-sm font-semibold min-w-0 flex-1">
                    <FactorTitle
                      index={f.index}
                      name={factorName(naming.names, f.index)}
                      onName={(text) => naming.onName(f.index, text)}
                      look="card"
                      hint={topName(byKey.values(), measureName)}
                    />
                  </h4>
                  <span className="flex items-baseline gap-2 shrink-0">
                    <FactorCongruence factor={stable?.factors[f.index]} />
                    {share !== undefined && (
                      <span className="text-xs text-muted shrink-0">
                        {t("factor.loadings.factor_variance", { pct: formatPercent(share, locale) })}
                      </span>
                    )}
                  </span>
                </div>
                {f.measures.length === 0 ? (
                  <p className="text-xs text-muted">{t("factor.loadings.factor_empty")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {count > 0 &&
                      sections.map((section) => (
                        <Fragment key={section.id}>
                          {section.id === "other" && section.rows.length > 0 && (
                            <li className="text-xs font-medium text-muted pt-1">
                              {list.fold ? (
                                <FoldButton label={otherLabel(t, locale, section.rows.length)} fold={list.fold} />
                              ) : (
                                otherLabel(t, locale, section.rows.length)
                              )}
                            </li>
                          )}
                          {(section.id !== "other" || list.otherOpen ? section.rows : []).map((key) => {
                            const m = byKey.get(key)!;
                            // The other factors of a cross-loaded measure, e.g. "also F1 −0.46".
                            const c = cross.get(m.measure);
                            const others = c
                              ? c.factors.map((i, j) => ({ i, loading: c.loadings[j] })).filter((o) => o.i !== f.index)
                              : [];
                            return (
                              <li key={m.measure} className="text-xs">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="min-w-0 break-words">
                                    <span data-tip-more={measureDescription(m.measure)}>
                                      <MeasureName name={measureName(m.measure)} measure={m.measure} />
                                    </span>
                                    {representatives.get(f.index)?.measure === m.measure && (
                                      <>
                                        {" "}
                                        <RepresentativeBadge entry={representatives.get(f.index)!} />
                                      </>
                                    )}
                                  </span>
                                  <span className="flex items-baseline gap-2 shrink-0">
                                    <MeasureStability entry={byStability.get(m.measure)} />
                                    <span className="font-mono tabular-nums" style={m.loading < 0 ? { color: signInk(m.loading) } : undefined}>
                                      {formatNumber(m.loading, locale, 2)}
                                    </span>
                                  </span>
                                </div>
                                <div className="mt-1 h-1 rounded-full bg-bg/80 overflow-hidden" aria-hidden>
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${Math.min(1, Math.abs(m.loading)) * 100}%`,
                                      backgroundColor: signColor(m.loading),
                                      opacity: 0.7,
                                    }}
                                  />
                                </div>
                                {others.length > 0 && (
                                  <span className="mt-1 block text-xs text-muted">
                                    {others.map((o, j) => (
                                      <span
                                        key={o.i}
                                        data-tip-more={t("factor.loadings.also_title", {
                                          i: o.i + 1,
                                          value: formatNumber(o.loading, locale, 2),
                                        })}
                                      >
                                        {j > 0 && " · "}
                                        {t("factor.loadings.also", { i: o.i + 1 })}{" "}
                                        <span className="font-mono tabular-nums" style={{ color: signInk(o.loading) }}>
                                          {formatNumber(o.loading, locale, 2)}
                                        </span>
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </Fragment>
                      ))}
                  </ul>
                )}
              </div>
            );
          })}
          {unassignedShown.length > 0 && (
            <div className="rounded-lg bg-tile/50 p-3.5 space-y-2 min-w-0">
              <div>
                <h4 className="text-sm font-semibold">{t("factor.loadings.unassigned_heading")}</h4>
                <p className="text-xs text-muted">{t("factor.loadings.unassigned_hint")}</p>
              </div>
              <ul className="space-y-1">
                {unassignedShown.map((u) => (
                  <li key={u.measure} className="flex items-baseline justify-between gap-x-2 flex-wrap text-xs">
                    <span className="min-w-0 break-words" data-tip-more={measureDescription(u.measure)}>
                      <MeasureName name={measureName(u.measure)} measure={u.measure} />
                    </span>
                    <span className="flex items-baseline gap-2">
                      {u.reason && <span className="text-xs text-muted">{reasonText(u, analysis, t, locale)}</span>}
                      <MeasureStability entry={byStability.get(u.measure)} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        </MeasureListScope>
        {narrowed && visible.length === 0 && unassignedShown.length === 0 && (
          <p className="text-xs text-muted">{t("factor.measures.none_match")}</p>
        )}
        <ShortSetCard analysis={analysis} measureName={measureName} dimensionName={dimensionName} stability={stable} />
        {stable && stable.valid > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              className="min-h-6 text-xs text-muted hover:text-fg hover:underline underline-offset-2"
              aria-expanded={pairsOpen}
              onClick={() => setPairsOpen((open) => !open)}
            >
              {t(pairsOpen ? "factor.stability.pairs_hide" : "factor.stability.pairs_show")}
            </button>
            {pairsOpen && (
              <StabilityPairs
                result={stable}
                order={[
                  ...new Set([...analysis.factors.flatMap((f) => f.measures.map((m) => m.measure)), ...unassigned.map((u) => u.measure)]),
                ]}
                measureName={measureName}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  /**
   * Takes over the names an interpretation of this solution suggests, on a click only and only
   * where there is one; the names stay editable like any others.
   */
  function SuggestedNames({ naming }: { naming: FactorNaming }) {
    const t = useT();
    const tip = useTip<HTMLButtonElement>({ more: t("factor.names.suggested_more") });
    if (!naming.suggested || naming.suggested.length === 0) return null;
    return (
      <button
        ref={tip}
        type="button"
        onClick={naming.onSuggested}
        className="inline-flex items-center gap-1 rounded px-1 text-xs font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Tags className="h-3.5 w-3.5" aria-hidden />
        {t("factor.names.suggested")}
      </button>
    );
  }

  /**
   * Pins the solution on screen as a column of a comparison, opens the comparison of the pins and
   * clears them: the same dataset with 4 and with 6 factors, say, side by side.
   */
  function PinTools({ pin }: { pin: PinState }) {
    const t = useT();
    return (
      <div role="group" aria-label={t("factor.pin.aria")} className="flex items-center gap-1.5">
        <IconButton
          icon={pin.pinned ? PinOff : Pin}
          tone="tile"
          name={t(pin.pinned ? "factor.pin.unpin" : "factor.pin.pin")}
          more={t("factor.pin.more")}
          reason={pin.reason}
          aria-pressed={pin.pinned}
          onClick={pin.onToggle}
        />
        {pin.count > 0 && (
          <>
            <ActionLink
              href={pin.href}
              icon={Columns3}
              reason={pin.href ? null : t("factor.pin.need_two")}
              more={t("factor.pin.compare_more")}
            >
              {t("factor.pin.compare", { n: pin.count })}
            </ActionLink>
            <IconButton size="sm" icon={X} name={t("factor.pin.clear")} onClick={pin.onClear} />
          </>
        )}
      </div>
    );
  }

  /** The title of the measures a card folds below its notable ones, with their number. */
  function otherLabel(t: (key: string) => string, locale: string, n: number): string {
    return `${t("factor.measures.section_other")} · ${formatNumber(n, locale)}`;
  }

  /** Why a measure joined no factor, with the number that decided it. */
  function reasonText(
    u: UnassignedMeasure,
    analysis: FactorAnalysis,
    t: (key: string, params?: Record<string, string | number>) => string,
    locale: string,
  ): string {
    const row = analysis.loadings[u.measure] ?? [];
    if (u.reason === "low_loading") {
      const largest = row.length > 0 ? Math.abs(row[primaryFactor(row)]) : Number.NaN;
      return t("factor.loadings.reason.low_loading", { value: formatNumber(largest, locale, 2) });
    }
    if (u.reason === "low_communality") {
      return t("factor.loadings.reason.low_communality", {
        value: formatNumber(analysis.communalities[u.measure] ?? Number.NaN, locale, 2),
      });
    }
    // The server lists the factors by loading, largest first; read as a list they go in order.
    const factors = [...((analysis.cross_loadings ?? []).find((c) => c.measure === u.measure)?.factors ?? [])].sort(
      (a, b) => a - b,
    );
    // Without the cross-loading listed, the reason is said without its factors.
    return factors.length > 0
      ? t("factor.loadings.reason.cross_loading", { factors: factors.map((i) => `F${i + 1}`).join(", ") })
      : t("factor.loadings.reason.cross_loading_plain");
  }
