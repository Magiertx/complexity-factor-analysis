"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Grid3x3, Info, LayoutGrid } from "lucide-react";
import { ASSIGNMENT_RULES, type AssignmentRule, type FactorAnalysis } from "@/lib/api";
import {
  ORTHOGONAL,
  RULE_LIMITS,
  assignedCells,
  countText,
  crossLoadingsByMeasure,
  effectiveCommunality,
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
  type UnassignedMeasure,
} from "@/lib/factor-analysis";
import { FOLDING_LOADINGS, LONG_LIST, arrangeLoadings, matchesQuery, otherShown } from "@/lib/measure-list";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { Segmented } from "@/components/ui/segmented";
import { MeasureName, TableFrame } from "@/components/ui/table";
import { Term, useTipZone } from "@/components/ui/tip";
import { FoldButton, SectionRow, type Fold } from "./measure-fold";
import { MeasureSearch, NotableSwitch } from "./measure-search";
import { FieldLabel, HelpLabel, ThresholdField } from "./step-section";

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
}

/** What makes a loading bold: the rule's assignment, or the threshold reached or exceeded. */
type BoldBy = "assigned" | "exceeds" | "reaches";

/** The loadings as one table or as one card per factor; one or the other, never both. */
type LoadingsLook = "matrix" | "dimensions";
type MeasureOrder = "factor" | "original";

const LOOK_KEY = "app.factor-loadings-look";

/** The look and order chosen last, remembered in the browser. */
function useLoadingsLook(): [{ look: LoadingsLook; order: MeasureOrder }, (patch: Partial<{ look: LoadingsLook; order: MeasureOrder }>) => void] {
  const [state, setState] = useState<{ look: LoadingsLook; order: MeasureOrder }>({ look: "matrix", order: "factor" });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null");
      if (saved && (saved.look === "matrix" || saved.look === "dimensions")) {
        setState({ look: saved.look, order: saved.order === "original" ? "original" : "factor" });
      }
    } catch {
      /* storage blocked or unreadable */
    }
  }, []);
  const update = (patch: Partial<{ look: LoadingsLook; order: MeasureOrder }>) =>
    setState((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(LOOK_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
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
}: Props) {
  const t = useT();
  const { locale } = useLocale();
  const [{ look, order }, setLook] = useLoadingsLook();
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
    <div className="space-y-6">
      <AssignmentChoice
        value={options.assignment_rule}
        onChange={(rule) => onOptions({ assignment_rule: rule })}
        note={assignmentNote ?? null}
      />

      <div className="flex items-start gap-x-6 gap-y-3 flex-wrap">
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

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-x-6 gap-y-3 flex-wrap">
          <div className="flex items-end gap-x-6 gap-y-3 flex-wrap">
            <div className="space-y-1.5">
              <FieldLabel id="fa-look-label">{t("factor.loadings.look_label")}</FieldLabel>
              <Segmented<LoadingsLook>
                size="sm"
                aria-labelledby="fa-look-label"
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
            </div>
            {look === "matrix" && oblique && analysis.structure_loadings && (
              <div className="space-y-1.5">
                <FieldLabel id="fa-matrix-label">{t("factor.loadings.matrix_label")}</FieldLabel>
                <Segmented
                  size="sm"
                  aria-labelledby="fa-matrix-label"
                  value={matrix}
                  onChange={setMatrix}
                  options={[
                    { value: "pattern", label: t("factor.loadings.matrix_pattern") },
                    { value: "structure", label: t("factor.loadings.matrix_structure") },
                  ]}
                />
              </div>
            )}
            {look === "matrix" && (
              <div className="space-y-1.5">
                <FieldLabel id="fa-order-label">{t("factor.loadings.order_label")}</FieldLabel>
                <Segmented<MeasureOrder>
                  size="sm"
                  aria-labelledby="fa-order-label"
                  value={order}
                  onChange={(v) => setLook({ order: v })}
                  options={[
                    { value: "factor", label: t("factor.loadings.order_factor") },
                    { value: "original", label: t("factor.loadings.order_original") },
                  ]}
                />
              </div>
            )}
          </div>
        </div>

        {long && (
          <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
            <MeasureSearch value={filter.query} onChange={(query) => onFilter({ ...filter, query })} />
            <NotableSwitch
              id="fa-loadings-notable"
              checked={filter.onlyNotable}
              onChange={(onlyNotable) => onFilter({ ...filter, onlyNotable })}
              label={
                <Term more={t("factor.loadings.only_notable_more")}>
                  {t("factor.loadings.only_notable", { n: notableCount })}
                </Term>
              }
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
          />
        ) : (
          <FactorGroups
            analysis={analysis}
            measureName={measureName}
            measureDescription={measureDescription}
            list={list}
          />
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
}: {
  analysis: FactorAnalysis;
  options: AnalysisOptions;
  order: MeasureOrder;
  structureShown: boolean;
  measureName: (key: string) => string;
  measureDescription: (key: string) => string | undefined;
  list: LoadingsList;
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
      <Legend threshold={threshold} boldBy={boldBy} crossed={secondary.size > 0} strict={strict} />
      <TableFrame label={t("factor.loadings.table_heading")}>
        <table ref={zone} className="data-table">
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
                <th key={i} scope="col" className={cn("num", cell)} data-tip={t("factor.loadings.factor_n", { i: i + 1 })}>
                  F{i + 1}
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
                          <MeasureName name={name} />
                        </span>
                      </th>
                      {factorIdx.map((i) => {
                        const v = values[i];
                        if (v === undefined) return <td key={i} className={cell} />;
                        const strong = isBold(m, i, v);
                        // Loadings that do not count are faded, so the ones that do stand out.
                        const counts = loadingCounts(v, threshold, strict) || strong;
                        const crossed = secondary.has(`${m}:${i}`);
                        const tip = `${name} · ${t("factor.loadings.factor_n", { i: i + 1 })}: ${formatNumber(v, locale, 3)}`;
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
      {shownCount === 0 && <p className="text-xs text-muted">{t("factor.measures.none_match")}</p>}
      {/* What the numbers mean, in the tooltips of these words. */}
      <p className="flex gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted">
        <Term more={t("factor.help.loading")}>{t("factor.loadings.table_heading")}</Term>
        <Term more={t("factor.help.communality")}>{t("factor.loadings.col_communality")}</Term>
        <Term more={t("factor.help.variance")}>{t("factor.loadings.variance_label")}</Term>
      </p>
      <p className="text-[11px] text-muted max-w-prose">
        {t("factor.loadings.h2_note")}{" "}
        {!oblique
          ? t("factor.loadings.footer_rows")
          : structure
            ? t("factor.loadings.structure_note")
            : t("factor.loadings.footer_row_pattern")}
        {oblique && ` ${t("factor.loadings.oblique_note", { pct: formatPercent(analysis.variance.explained, locale) })}`}
      </p>

      {analysis.factor_correlations && <FactorCorrelations values={analysis.factor_correlations} />}
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

function FactorCorrelations({ values }: { values: number[][] }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="space-y-2 pt-2">
      <HelpLabel label={t("factor.loadings.correlations_heading")} help={t("factor.help.factor_correlations")} />
      <TableFrame label={t("factor.loadings.correlations_heading")} className="w-fit max-w-full">
        <table className="data-table w-auto">
          <caption className="sr-only">{t("factor.loadings.correlations_heading")}</caption>
          <thead>
            <tr>
              <td />
              {values.map((_, j) => (
                <th key={j} scope="col" className="num">
                  F{j + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {values.map((row, i) => (
              <tr key={i}>
                <th scope="row" className="font-medium text-muted">
                  F{i + 1}
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
 * The rule that turns loadings into factor groups, as tiles. The thresholds next to it stay in
 * effect; the rules differ in what happens to a measure that loads on several factors and in
 * the least communality.
 */
function AssignmentChoice({
  value,
  onChange,
  note,
}: {
  value: AssignmentRule;
  onChange: (rule: AssignmentRule) => void;
  /** Where the paper's tables differ from the chosen rule; read with the tiles. */
  note: string | null;
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
    <div id="fa-assignment" className="space-y-2 scroll-mt-24">
      <HelpLabel as="span" label={label} help={t("factor.help.assignment", limits)} />
      <div
        role="radiogroup"
        aria-label={label}
        aria-describedby={note ? "fa-assignment-note" : undefined}
        className="grid gap-2 sm:grid-cols-3"
      >
        {ASSIGNMENT_RULES.map((rule) => {
          const chosen = rule === value;
          return (
            <label key={rule} className={cn("flex items-start gap-2.5 rounded-md px-3 py-2.5 min-w-0", choiceTile(chosen))}>
              <input
                type="radio"
                name="fa-assignment"
                value={rule}
                className="sr-only"
                checked={chosen}
                onChange={() => onChange(rule)}
                aria-label={t(`factor.loadings.rule.${rule}.title`)}
                aria-describedby={`fa-assignment-${rule}-source fa-assignment-${rule}`}
              />
              <ChoiceMark type="radio" checked={chosen} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(`factor.loadings.rule.${rule}.title`)}</span>
                <span id={`fa-assignment-${rule}-source`} className="block text-[11px] text-muted">
                  {t(`factor.loadings.rule.${rule}.source`)}
                </span>
                <span id={`fa-assignment-${rule}`} className="mt-1 block text-xs text-fg/80 leading-snug">
                  {t(`factor.loadings.rule.${rule}.text`, limits)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {note && (
        <p id="fa-assignment-note" className="flex items-start gap-1.5 text-xs text-muted max-w-prose">
          <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
          <span>{note}</span>
        </p>
      )}
    </div>
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
    <div className="flex items-center gap-x-4 gap-y-1 text-[11px] text-muted flex-wrap" aria-hidden>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={loadingStyle(-0.9)} />
        {t("factor.loadings.legend_negative")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-muted">{formatNumber(0.1, locale, 2)}</span>
        {t(strict ? "factor.loadings.legend_faded_strict" : "factor.loadings.legend_faded", { threshold: value })}
      </span>
      <span>
        <b className="font-mono text-fg">{formatNumber(0, locale, 2)}</b>{" "}
        {boldBy === "assigned"
          ? t("factor.loadings.legend_bold_assigned")
          : t(boldBy === "exceeds" ? "factor.loadings.legend_bold_strict" : "factor.loadings.legend_bold", {
              threshold: value,
            })}
      </span>
      {crossed && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm ring-2 ring-inset ring-fg/55" />
          {t("factor.loadings.legend_cross")}
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
}: {
  analysis: FactorAnalysis;
  measureName: (key: string) => string;
  measureDescription: (key: string) => string | undefined;
  list: LoadingsList;
}) {
  const t = useT();
  const { locale } = useLocale();
  const zone = useTipZone<HTMLDivElement>();
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
  return (
    <div className="space-y-2">
      <HelpLabel label={t("factor.loadings.groups_heading")} help={t("factor.help.groups")} />
      <div ref={zone} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ factor: f, byKey, sections, count }) => {
          // index counts from 0; shares only exist for orthogonal rotations.
          const share = analysis.variance.proportion?.[f.index];
          return (
            <div key={f.index} className="rounded-lg bg-tile p-3.5 space-y-2.5 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold">{t("factor.loadings.factor_n", { i: f.index + 1 })}</h4>
                {share !== undefined && (
                  <span className="text-[11px] text-muted">{t("factor.loadings.factor_variance", { pct: formatPercent(share, locale) })}</span>
                )}
              </div>
              {f.measures.length === 0 ? (
                <p className="text-xs text-muted">{t("factor.loadings.factor_empty")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {count > 0 &&
                    sections.map((section) => (
                      <Fragment key={section.id}>
                        {section.id === "other" && section.rows.length > 0 && (
                          <li className="text-[11px] font-medium text-muted pt-1">
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
                                <span className="min-w-0 break-words" data-tip-more={measureDescription(m.measure)}>
                                  <MeasureName name={measureName(m.measure)} />
                                </span>
                                <span className="font-mono tabular-nums shrink-0" style={m.loading < 0 ? { color: signInk(m.loading) } : undefined}>
                                  {formatNumber(m.loading, locale, 2)}
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
                                <span className="mt-1 block text-[11px] text-muted">
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
              <p className="text-[11px] text-muted">{t("factor.loadings.unassigned_hint")}</p>
            </div>
            <ul className="space-y-1">
              {unassignedShown.map((u) => (
                <li key={u.measure} className="flex items-baseline justify-between gap-x-2 flex-wrap text-xs">
                  <span className="min-w-0 break-words" data-tip-more={measureDescription(u.measure)}>
                    <MeasureName name={measureName(u.measure)} />
                  </span>
                  {u.reason && <span className="text-[11px] text-muted">{reasonText(u, analysis, t, locale)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {narrowed && visible.length === 0 && unassignedShown.length === 0 && (
        <p className="text-xs text-muted">{t("factor.measures.none_match")}</p>
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
