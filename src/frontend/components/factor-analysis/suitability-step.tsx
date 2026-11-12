"use client";

// The suitability step: the Bartlett and KMO tests, the correlation map and the list of measures with their MSA, to keep or exclude.

import { Fragment, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { FactorAnalysis, FactorDataset } from "@/lib/api";
import {
  MIN_MEASURES,
  analysisNotices,
  countText,
  isSolutionNotice,
  kmoGrade,
  mostlyFiltered,
  noticeText,
  type AnalysisOptions,
} from "@/lib/factor-analysis";
import {
  LONG_LIST,
  arrangeMeasures,
  isNotable,
  matchesQuery,
  measureInfo,
  otherShown,
  toggleExcluded,
  type MeasureGrouping,
  type MeasureInfo,
  type MeasureSort,
} from "@/lib/measure-list";
import { NO_VALUE, formatNumber, formatPValue, splitSentence } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { ChoiceMark } from "@/components/ui/choice";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MeasureListScope, MeasureName, TableFrame } from "@/components/ui/table";
import { useTip, useTipZone } from "@/components/ui/tip";
import { InfoLabel, InfoTip } from "@/components/ui/info-tip";
import { CorrelationMap, type CorrelationMapProps } from "./correlation-map";
import { SectionRow } from "./measure-fold";
import { MeasureSearch, NotableSwitch } from "./measure-search";
import { HelpLabel, NoticeList, PassBadge, ThresholdField } from "./step-section";

/** How the list of measures is shown; kept by the tab while other steps are open. */
export interface MeasureView {
  query: string;
  sort: MeasureSort;
  grouping: MeasureGrouping;
  onlyNotable: boolean;
  /** The unremarkable measures below the notable ones are unfolded. */
  showOther: boolean;
}

/** The list as it starts: in dataset order, ungrouped, nothing narrowed. */
export const DEFAULT_MEASURE_VIEW: MeasureView = {
  query: "",
  sort: "dataset",
  grouping: "none",
  onlyNotable: false,
  showOther: false,
};

/** The groups of the measures, e.g. the feature groups of feeed; absent for model measures. */
export interface MeasureGroups {
  order: { key: string; name: string }[];
  of: (measure: string) => string | null;
}

/** The props of `SuitabilityView`. */
interface Props {
  dataset: FactorDataset;
  analysis: FactorAnalysis | null;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
  measureName: (key: string) => string;
  /** What a measure measures, for its tooltip. */
  measureDescription: (key: string) => string | undefined;
  groups: MeasureGroups | null;
  view: MeasureView;
  onView: (view: MeasureView) => void;
  /** The correlation map above the list of the measures; absent while there is no dataset. */
  map?: CorrelationMapProps | null;
}

/** The suitability step. */
export function SuitabilityView(props: Props) {
  const { analysis, options, onOptions } = props;
  const t = useT();
  const tMaybe = useTMaybe();
  // Notes on the factor solution are shown in step 4.
  const notes = analysis
    ? analysisNotices(analysis)
        .filter((n) => !isSolutionNotice(n))
        .map((n) => noticeText(n, tMaybe))
    : [];
  const removed = analysis?.msa_filter.removed.length ?? 0;
  return (
    <div className="space-y-6">
      <NoticeList heading={t("factor.suitability.warnings_heading")} notes={notes} />

      <div className="grid gap-3 md:grid-cols-2">
        <BartlettCard analysis={analysis} alpha={options.bartlett_alpha} />
        <KmoCard analysis={analysis} threshold={options.msa_threshold} />
      </div>

      <div className="rounded-lg bg-tile/60 px-3.5 py-3 space-y-3">
        <div className="flex items-start gap-3">
          <Switch
            id="fa-auto-msa"
            checked={options.auto_msa_filter}
            onCheckedChange={(v) => onOptions({ auto_msa_filter: v })}
            aria-labelledby="fa-auto-msa-label"
            aria-describedby="fa-auto-msa-hint"
          />
          <div className="min-w-0">
            <span className="flex items-center gap-1">
              <label id="fa-auto-msa-label" htmlFor="fa-auto-msa" className="text-sm font-medium cursor-pointer">
                {t("factor.suitability.auto_filter_label")}
              </label>
              <InfoTip topic={t("factor.suitability.auto_filter_label")} text={t("factor.help.msa_filter")} />
            </span>
            <p id="fa-auto-msa-hint" className="sr-only">
              {t("factor.help.msa_filter")}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-x-6 gap-y-3 flex-wrap pl-12">
          <ThresholdField
            id="fa-msa-threshold"
            label={t("factor.suitability.msa_threshold")}
            help={t("factor.help.msa_threshold")}
            value={options.msa_threshold}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onOptions({ msa_threshold: v })}
          />
          <ThresholdField
            id="fa-bartlett-alpha"
            label={t("factor.suitability.bartlett_alpha")}
            help={t("factor.help.bartlett_alpha")}
            value={options.bartlett_alpha}
            min={0.0001}
            max={0.5}
            step={0.01}
            onChange={(v) => onOptions({ bartlett_alpha: v })}
          />
        </div>
        {/* The list below marks each removed measure with its round; here only how many. */}
        {analysis && options.auto_msa_filter && (
          <p className="pl-12 text-xs text-muted">
            {removed === 0
              ? t("factor.suitability.removed_none")
              : countText(t, "factor.suitability.removed_summary", removed)}
          </p>
        )}
        {/* More than half gone: what is left may say little, so it is said in amber. */}
        {analysis && options.auto_msa_filter && mostlyFiltered(analysis.used_measures.length, removed) && (
          <p className="pl-12 text-xs text-warn-ink flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("factor.suitability.thin_result", {
              left: analysis.used_measures.length,
              total: analysis.used_measures.length + removed,
            })}
          </p>
        )}
      </div>

      {props.map && <CorrelationMap {...props.map} />}

      <MeasureList {...props} />
    </div>
  );
}

/** The result of Bartlett's test of sphericity, against `alpha`. */
function BartlettCard({ analysis, alpha }: { analysis: FactorAnalysis | null; alpha: number }) {
  const t = useT();
  const { locale } = useLocale();
  const b = analysis?.bartlett;
  const explain = t("factor.suitability.bartlett_explain", { alpha: b?.alpha ?? alpha });
  return (
    <div className="rounded-lg bg-tile p-4 space-y-3">
      {/* One short line; what passes, the test itself and that it sees the measures before the MSA
          filter (as in ComFy, so its df can stand for more measures than KMO uses) are behind the (i). */}
      <InfoLabel
        label={t("factor.suitability.bartlett_title")}
        help={explain}
        extra={b && <PassBadge passed={b.passed} />}
      >
        <p>{explain}</p>
        <p>{t("factor.help.bartlett")}</p>
        {analysis && analysis.msa_filter.removed.length > 0 && (
          <p>
            {t("factor.suitability.bartlett_before_filter", {
              n: analysis.used_measures.length + analysis.msa_filter.removed.length,
              left: analysis.used_measures.length,
            })}
          </p>
        )}
      </InfoLabel>
      <p className="text-xs text-muted">{splitSentence(explain)[0]}</p>
      {/* The chi-square is the widest value: it gets the widest column, and wraps rather than being cut. */}
      <dl className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
        <Value
          label={b?.regularised ? `χ² (${t("factor.suitability.regularised")})` : "χ²"}
          value={b ? formatNumber(b.chi_square, locale, 1) : NO_VALUE}
          more={b?.regularised ? t("factor.suitability.regularised_title") : undefined}
        />
        <Value label={t("factor.suitability.df")} value={b ? formatNumber(b.df, locale) : NO_VALUE} />
        <Value label="p" value={b ? formatPValue(b.p_value, locale) : NO_VALUE} />
      </dl>
    </div>
  );
}

/** The overall KMO value against its `threshold`. */
function KmoCard({ analysis, threshold }: { analysis: FactorAnalysis | null; threshold: number }) {
  const t = useT();
  const { locale } = useLocale();
  const k = analysis?.kmo;
  const limit = k?.threshold ?? threshold;
  const explain = t("factor.suitability.kmo_explain", { threshold: limit });
  return (
    <div className="rounded-lg bg-tile p-4 space-y-3">
      <InfoLabel label={t("factor.suitability.kmo_title")} help={explain} extra={k && <PassBadge passed={k.passed} />}>
        <p>{explain}</p>
        <p>{t("factor.help.kmo")}</p>
      </InfoLabel>
      <p className="text-xs text-muted">{splitSentence(explain)[0]}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono tabular-nums">{k ? formatNumber(k.overall, locale, 2) : NO_VALUE}</span>
        {k && <span className="text-xs text-muted">{t(`factor.suitability.grade.${kmoGrade(k.overall)}`)}</span>}
      </div>
      <Scale value={k?.overall ?? null} threshold={limit} />
    </div>
  );
}

/** 0..1 bar with the threshold as a tick; a value below it is a warning, not an error. */
function Scale({ value, threshold }: { value: number | null; threshold: number }) {
  const pass = value !== null && value >= threshold;
  return (
    <div className="relative rounded-full bg-bg/80 h-2 w-full" aria-hidden>
      {value !== null && (
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", pass ? "bg-success" : "bg-warn")}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      )}
      <div
        className="absolute -inset-y-0.5 w-0.5 bg-fg/60 rounded"
        style={{ left: `calc(${Math.min(1, threshold) * 100}% - 1px)` }}
      />
    </div>
  );
}

/** A labelled figure of a card, with an optional (i). */
function Value({ label, value, more }: { label: string; value: string; more?: string }) {
  return (
    <div className="rounded-md bg-bg/60 px-2.5 py-1.5 min-w-0">
      <dt className="flex items-center gap-0.5 text-xs text-muted">
        {label}
        {more && <InfoTip size="xs" topic={label} text={more} />}
      </dt>
      <dd className="font-mono tabular-nums text-sm [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

/**
 * The measures with their MSA and what became of them, those worth a look first. A long list
 * (the log tab has over a hundred) can be searched (also with "/"), sorted, grouped by feature
 * group and narrowed to the notable ones; none of that changes the analysis.
 */
function MeasureList({ dataset, analysis, options, onOptions, measureName, measureDescription, groups, view, onView }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const zone = useTipZone<HTMLTableSectionElement>();
  const excluded = new Set(options.excluded);
  const included = dataset.measures.length - excluded.size;
  const threshold = analysis?.kmo.threshold ?? options.msa_threshold;
  const info = measureInfo(dataset.measures, analysis, options);
  const long = dataset.measures.length >= LONG_LIST;
  const viewOf = long ? view : DEFAULT_MEASURE_VIEW;

  // The notable measures stay in their place while the list is in use: one that stops being
  // notable (excluded, say) does not move away from under the pointer. The list is arranged anew
  // when it is sorted, grouped, searched or narrowed differently.
  const current = dataset.measures.filter((m) => isNotable(info.get(m)));
  const key = JSON.stringify([dataset.id, viewOf.sort, viewOf.grouping, viewOf.query, viewOf.onlyNotable]);
  const [pinned, setPinned] = useState(() => ({ key, set: new Set(current) }));
  let notable = pinned.set;
  if (pinned.key !== key) {
    notable = new Set(current);
    setPinned({ key, set: notable });
  } else if (current.some((m) => !pinned.set.has(m))) {
    notable = new Set([...pinned.set, ...current]);
    setPinned({ key, set: notable });
  }

  const groupName = new Map((groups?.order ?? []).map((g) => [g.key, g.name]));
  const sections = arrangeMeasures({
    measures: dataset.measures,
    info,
    name: measureName,
    group: (m) => groups?.of(m) ?? null,
    groupOrder: (groups?.order ?? []).map((g) => g.key),
    sort: viewOf.sort,
    grouping: groups ? viewOf.grouping : "none",
    query: viewOf.query,
    onlyNotable: viewOf.onlyNotable,
    notable,
  });
  const shownCount = sections.reduce((n, s) => n + s.rows.length, 0);
  const headed = sections.length > 1 || sections[0]?.id.startsWith("group:");
  // In a long list the unremarkable measures stay folded below the notable ones, so it is not a
  // long scroll. They unfold on request, and by themselves while the list is searched or sorted,
  // where the whole list is what is asked for. A short list is shown in full.
  const { open: otherOpen, byView: otherByView } = otherShown({
    folds: long,
    query: viewOf.query,
    reordered: viewOf.sort !== "dataset",
    showOther: viewOf.showOther,
  });

  // The measures on screen, in their order, which the fact sheet of one of them pages through.
  const visible = sections.flatMap((section) => (section.id !== "other" || otherOpen ? section.rows : []));

  // Tick the few measures to keep, then invert, instead of ticking all the others.
  const canInvert = options.excluded.length >= MIN_MEASURES;
  const invert = () => onOptions({ excluded: dataset.measures.filter((m) => !excluded.has(m)) });
  // Many at once: all of them, or those the search finds, so keeping three of a hundred is a few
  // clicks. The analysis says it while fewer than three are left.
  const query = viewOf.query.trim();
  const found = query ? dataset.measures.filter((m) => matchesQuery(query, measureName(m), m)) : [];
  const exclude = (list: readonly string[]) => onOptions({ excluded: dataset.measures.filter((m) => excluded.has(m) || list.includes(m)) });
  const keepOnly = (list: readonly string[]) => onOptions({ excluded: dataset.measures.filter((m) => !list.includes(m)) });
  const bulk = "rounded hover:text-fg transition aria-disabled:opacity-40 aria-disabled:hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const sectionLabel = (id: string, group: string | null | undefined, n: number) => {
    const name =
      id === "notable"
        ? t("factor.measures.section_notable")
        : id === "other"
          ? t("factor.measures.section_other")
          : group
            ? (groupName.get(group) ?? group)
            : t("factor.measures.section_no_group");
    return `${name} · ${formatNumber(n, locale)}`;
  };

  return (
    // Its id is where the measures chip of the settings row leads.
    <div id="fa-msa-table" className="space-y-3">
      <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <HelpLabel label={t("factor.suitability.msa_heading")} help={t("factor.help.msa")} />
        <span role="group" aria-label={t("factor.suitability.bulk_aria")} className="flex items-center gap-3 text-xs text-muted flex-wrap">
          {options.excluded.length > 0 && <span>{t("factor.suitability.excluded_count", { n: options.excluded.length })}</span>}
          {/* With a search, for what it finds; else for all of them. */}
          {query ? (
            <>
              <button type="button" className={bulk} aria-disabled={found.length === 0 || undefined} onClick={() => found.length > 0 && exclude(found)}>
                {t("factor.suitability.exclude_found", { n: found.length })}
              </button>
              <button type="button" className={bulk} aria-disabled={found.length === 0 || undefined} onClick={() => found.length > 0 && keepOnly(found)}>
                {t("factor.suitability.keep_found", { n: found.length })}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={bulk}
              aria-disabled={options.excluded.length === dataset.measures.length || undefined}
              onClick={() => exclude(dataset.measures)}
            >
              {t("factor.suitability.exclude_all")}
            </button>
          )}
          {options.excluded.length > 0 && (
            <>
              <InvertButton canInvert={canInvert} onInvert={invert} />
              <button type="button" onClick={() => onOptions({ excluded: [] })} className={bulk}>
                {t("factor.suitability.include_all")}
              </button>
            </>
          )}
        </span>
      </div>

      {long && (
        <div className="flex items-center gap-2 flex-wrap">
          <MeasureSearch value={view.query} onChange={(query) => onView({ ...view, query })} />
          <Select
            aria-label={t("factor.measures.sort_aria")}
            className="h-8 w-auto min-w-[9.5rem]"
            value={view.sort}
            onValueChange={(v) => onView({ ...view, sort: v as MeasureSort })}
            options={(["dataset", "name", "msa"] as const).map((s) => ({ value: s, label: t(`factor.measures.sort.${s}`) }))}
          />
          {groups && (
            <Select
              aria-label={t("factor.measures.group_aria")}
              className="h-8 w-auto min-w-[9.5rem]"
              value={view.grouping}
              onValueChange={(v) => onView({ ...view, grouping: v as MeasureGrouping })}
              options={(["none", "group"] as const).map((g) => ({ value: g, label: t(`factor.measures.grouping.${g}`) }))}
            />
          )}
          <NotableSwitch
            id="fa-only-notable"
            checked={view.onlyNotable}
            onChange={(v) => onView({ ...view, onlyNotable: v })}
            label={t("factor.measures.only_notable", { n: current.length })}
          />
        </div>
      )}

      <MeasureListScope measures={visible}>
        <TableFrame label={t("factor.suitability.msa_heading")}>
          <table className="data-table data-table--tight">
            <caption className="sr-only">{t("factor.suitability.msa_heading")}</caption>
            <thead>
              <tr>
                {/* First, so a phone reaches it without scrolling the table sideways; w-px keeps it narrow. */}
                <th scope="col" className="w-px text-center">
                  {t("factor.suitability.col_exclude")}
                </th>
                <th scope="col">{t("factor.suitability.col_measure")}</th>
                <th scope="col" className="num">
                  MSA
                </th>
                <th scope="col">{t("factor.suitability.col_status")}</th>
              </tr>
            </thead>
            <tbody ref={zone}>
              {sections.map((section) => (
                <Fragment key={section.id}>
                  {headed && section.rows.length > 0 && (
                    <SectionRow
                      colSpan={4}
                      label={sectionLabel(section.id, section.group, section.rows.length)}
                      fold={
                        section.id === "other" && !otherByView
                          ? { open: otherOpen, onToggle: () => onView({ ...view, showOther: !view.showOther }) }
                          : undefined
                      }
                    />
                  )}
                  {(section.id !== "other" || otherOpen ? section.rows : []).map((m) => (
                    <MeasureRow
                      key={m}
                      measure={m}
                      index={dataset.measures.indexOf(m)}
                      name={measureName(m)}
                      description={measureDescription(m)}
                      info={info.get(m)}
                      threshold={threshold}
                      excluded={excluded.has(m)}
                      locked={!excluded.has(m) && included <= MIN_MEASURES}
                      onToggle={() => onOptions({ excluded: toggleExcluded(options.excluded, m) })}
                      measureName={measureName}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableFrame>
        </MeasureListScope>
        {shownCount === 0 && <p className="text-xs text-muted">{t("factor.measures.none_match")}</p>}
      </div>
    );
  }

  function InvertButton({ canInvert, onInvert }: { canInvert: boolean; onInvert: () => void }) {
    const t = useT();
    const tip = useTip<HTMLButtonElement>({
      more: t("factor.suitability.invert_title"),
      reason: canInvert ? undefined : t("factor.suitability.min_measures", { n: MIN_MEASURES }),
    });
    return (
      <button
        ref={tip}
        type="button"
        onClick={() => canInvert && onInvert()}
        aria-disabled={!canInvert || undefined}
        className="rounded hover:text-fg transition aria-disabled:opacity-40 aria-disabled:hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {t("factor.suitability.invert")}
      </button>
    );
  }

  function MeasureRow({
    measure,
    index,
    name,
    description,
    info,
    threshold,
    excluded,
    locked,
    onToggle,
    measureName,
  }: {
    measure: string;
    index: number;
    name: string;
    description: string | undefined;
    info: MeasureInfo | undefined;
    threshold: number;
    excluded: boolean;
    locked: boolean;
    onToggle: () => void;
    measureName: (key: string) => string;
  }) {
    const t = useT();
    const { locale } = useLocale();
    const id = `fa-exclude-${index}`;
    const msa = info?.msa ?? null;
    const status = info?.status ?? "pending";
    const dependentWith =
      status === "dependent"
        ? t("factor.measures.dependent_with", { measures: (info?.partners ?? []).map(measureName).join(", ") })
        : "";
    // What the tooltips of the row say, also for the keyboard on the checkbox and for a screen reader.
    const tip = useTip<HTMLInputElement>({
      more: [description, locked ? t("factor.suitability.min_measures", { n: MIN_MEASURES }) : undefined]
        .filter(Boolean)
        .join(" "),
    });
    return (
      <tr className={cn(excluded && "text-muted")}>
        <td className="w-px text-center">
          <label
            data-tip-more={locked ? t("factor.suitability.min_measures", { n: MIN_MEASURES }) : undefined}
            className={cn(
              // relative: the sr-only input stays inside the scrolling table instead of widening the page.
              "relative inline-grid place-items-center h-5 w-5 rounded align-middle has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60",
              locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-accent/[0.08]",
            )}
          >
            <input
              ref={tip}
              id={id}
              type="checkbox"
              aria-label={t("factor.suitability.exclude_aria", { measure: name })}
              checked={excluded}
              disabled={locked}
              onChange={onToggle}
              className="sr-only"
            />
            <ChoiceMark checked={excluded} />
          </label>
        </td>
        <th scope="row" className="font-medium break-words">
          {/* The name opens the fact sheet; the box before it excludes the measure. */}
          <span data-tip-more={description}>
            <MeasureName name={name} measure={measure} />
          </span>
        </th>
        <td className={cn("num", status === "below" || status === "removed" ? "text-warn-ink" : undefined)}>
          {msa === null || excluded ? <span className="text-muted">{NO_VALUE}</span> : formatNumber(msa, locale, 2)}
        </td>
        {/* On a phone the status is a word or two, so a row mostly stays one line; the partners of a
            dependent measure are in the tooltip and, for a screen reader, in the row. */}
        <td>
          {status === "excluded" ? (
            t("factor.suitability.status_excluded")
          ) : status === "removed" ? (
            <span className="text-warn-ink">
              <span className="sm:hidden">{t("factor.suitability.status_removed_short", { step: info?.round ?? 1 })}</span>
              <span className="max-sm:hidden">{t("factor.suitability.status_removed", { step: info?.round ?? 1 })}</span>
            </span>
          ) : status === "dependent" ? (
            <span className="text-warn-ink" data-tip-more={dependentWith}>
              <span className="sm:hidden">{t("factor.measures.status_dependent_short")}</span>
              <span className="max-sm:hidden">{t("factor.measures.status_dependent")}</span>
              <span className="sr-only"> ({dependentWith})</span>
            </span>
          ) : status === "below" ? (
            <span className="text-warn-ink">
              {t("factor.measures.status_below", { threshold: formatNumber(threshold, locale) })}
            </span>
          ) : status === "miner" ? (
            // Not analysed for this miner: a fact of its rows, not a warning.
            <span className="text-muted" data-tip-more={t("factor.measures.status_miner_more")}>
              {t(info?.reason === "duplicate" ? "factor.measures.status_miner_duplicate" : "factor.measures.status_miner")}
            </span>
          ) : status === "used" ? (
            <span className="text-muted">{t("factor.suitability.status_used")}</span>
          ) : (
            <span className="text-muted">{NO_VALUE}</span>
          )}
        </td>
      </tr>
    );
  }
