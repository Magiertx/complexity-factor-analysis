"use client";

import { useEffect, useId, useState } from "react";
import { AlertCircle, AlertTriangle, Ban, Columns3, FileSearch } from "lucide-react";
import {
  fetchRecentLogs,
  type Descriptives,
  type FactorDataset,
  type FactorKind,
  type Measurement,
  type MinerSummary,
} from "@/lib/api";
import { PREVIEW_ROWS, OBSERVATIONS_PER_MEASURE, countText, rowsChoice, type RowsChoice } from "@/lib/factor-analysis";
import { NO_VALUE, formatNumber, formatStatistic } from "@/lib/format";
import { inspectHref, logOfRow } from "@/lib/log-link";
import { measurementRows, measurementTotals } from "@/lib/measurement";
import { cn } from "@/lib/utils";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { ActionLink } from "@/components/ui/action-link";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { IconButton, IconLink } from "@/components/ui/icon-button";
import { MeasureListScope, MeasureName, TableFrame } from "@/components/ui/table";
import { useTip, useTipZone } from "@/components/ui/tip";
import { InfoTip } from "@/components/ui/info-tip";
import { Brief } from "@/components/ui/brief";
import { FoldButton } from "./measure-fold";
import { HelpLabel, StatTile } from "./step-section";

/** The choice of the rows of one miner, for a model dataset discovered with several. */
export interface MinerChoiceProps {
  /** The miner analysed, or null for all rows together. */
  miner: string | null;
  /** The measures excluded by hand, which count for the measures left. */
  excluded: string[];
  onChange: (miner: string | null) => void;
  /** The comparison of the miners that can be analysed; null with a reason when there is none. */
  compareHref: string | null;
  compareReason: string | null;
}

export function DatasetView({
  dataset,
  measureName,
  measureDescription,
  minerChoice,
}: {
  dataset: FactorDataset;
  measureName: (key: string) => string;
  /** What a measure measures, for its tooltip. */
  measureDescription: (key: string) => string | undefined;
  /** For a dataset with the rows of two miners or more. */
  minerChoice?: MinerChoiceProps | null;
}) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const cleaningZone = useTipZone<HTMLTableSectionElement>();
  const previewZone = useTipZone<HTMLTableElement>();
  const preview = dataset.values.slice(0, PREVIEW_ROWS);
  // Decimals per column, not per cell, so a column lines up at the decimal separator.
  const digits = dataset.measures.map((_, j) =>
    preview.every((row) => row[j] === null || Number.isInteger(row[j])) ? 0 : 3,
  );
  // Older datasets carry only the English detail.
  const detailOf = (d: FactorDataset["dropped"][number]) =>
    (d.params && tMaybe(`factor.dataset.detail.${d.reason}`, d.params)) || d.detail;
  const failures = dataset.failures ?? [];
  // The same error of many inputs is one line with the inputs it hit.
  const failureGroups: { error: string; inputs: string[] }[] = [];
  for (const f of failures) {
    const group = failureGroups.find((g) => g.error === f.error);
    if (group) group.inputs.push(f.input);
    else failureGroups.push({ error: f.error, inputs: [f.input] });
  }
  // A dataset computed from logs has a link at each row to the page of a single log.
  const logs = useRecentLogNames(dataset.source === "logs");
  const logLink = (label: string | undefined) =>
    label && logs ? (
      <LogLink label={label} kind={dataset.kind} miners={dataset.miners?.map((m) => m.name)} logs={logs} />
    ) : null;

  return (
    <div className="space-y-6">
      {minerChoice && dataset.miners && dataset.miners.length > 1 && (
        <MinerChoice dataset={dataset} miners={dataset.miners} {...minerChoice} />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label={t("factor.dataset.observations")} value={formatNumber(dataset.n_observations, locale)} />
        <StatTile label={t("factor.dataset.measures")} value={formatNumber(dataset.measures.length, locale)} />
        <StatTile label={t("factor.dataset.dropped_measures")} value={formatNumber(dataset.dropped.length, locale)} />
        <StatTile label={t("factor.dataset.dropped_rows")} value={formatNumber(dataset.dropped_rows, locale)} />
      </div>

      <div className="space-y-2">
        <HelpLabel label={t("factor.dataset.cleaning_heading")} help={t("factor.help.cleaning")} />
        {dataset.dropped.length === 0 ? (
          <p className="text-xs text-muted">{t("factor.dataset.dropped_none")}</p>
        ) : (
          <MeasureListScope measures={dataset.dropped.map((d) => d.measure)}>
            <TableFrame label={t("factor.dataset.cleaning_heading")}>
              <table className="data-table">
                <caption className="sr-only">{t("factor.dataset.cleaning_heading")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("factor.suitability.col_measure")}</th>
                    <th scope="col">{t("factor.dataset.col_reason")}</th>
                    <th scope="col">{t("factor.dataset.col_detail")}</th>
                  </tr>
                </thead>
                <tbody ref={cleaningZone}>
                  {dataset.dropped.map((d) => (
                    <tr key={`${d.measure}:${d.reason}`}>
                      <th scope="row" className="font-medium break-words">
                        <span data-tip-more={measureDescription(d.measure)}>
                          <MeasureName name={measureName(d.measure)} measure={d.measure} />
                        </span>
                      </th>
                      <td className="whitespace-nowrap">{t(`factor.dataset.reason.${d.reason}`)}</td>
                      <td className="text-muted break-words">{detailOf(d) ?? NO_VALUE}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </MeasureListScope>
        )}
        {dataset.dropped_rows > 0 && (
          <p className="text-xs text-muted">{countText(t, "factor.dataset.dropped_rows_note", dataset.dropped_rows)}</p>
        )}
      </div>

      {failures.length > 0 && (
        <details className="rounded-lg bg-warn/10 px-3.5 py-2.5 text-xs">
          <summary className="cursor-pointer flex items-start gap-2 font-medium">
            <AlertCircle className="h-4 w-4 text-warn-ink shrink-0" />
            {countText(t, "factor.dataset.failures_heading", failures.length)}
          </summary>
          <p className="text-muted mt-2">{t("factor.dataset.failures_hint")}</p>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {failureGroups.map((g) => (
              <li key={g.error} className="break-words">
                <span className="font-medium">
                  {g.inputs.slice(0, 3).join(", ")}
                  {g.inputs.length > 3 && ` ${t("factor.dataset.failures_more", { n: g.inputs.length - 3 })}`}
                </span>
                <span className="text-muted">: {g.error}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {dataset.descriptives && (
        <DescriptivesTable
          descriptives={dataset.descriptives}
          measureName={measureName}
          measureDescription={measureDescription}
        />
      )}

      {dataset.measurement && <MeasurementTable measurement={dataset.measurement} logLink={logLink} />}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("factor.dataset.preview_heading")}</h3>
        <TableFrame label={t("factor.dataset.preview_heading")}>
          <table ref={previewZone} className="data-table">
            <caption className="sr-only">{t("factor.dataset.preview_heading")}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky-col">
                  {t("factor.dataset.observation")}
                </th>
                {dataset.measures.map((m) => (
                  <th key={m} scope="col" className="num" data-tip-more={measureDescription(m)}>
                    {measureName(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => {
                const label = dataset.observations[i];
                return (
                  <tr key={i}>
                    {/* A long label is cut; its tooltip has all of it. */}
                    <th scope="row" className="sticky-col max-w-[16rem]">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate" data-tip={label && label.length > 36 ? label : undefined}>
                          {label ?? i + 1}
                        </span>
                        {logLink(label)}
                      </span>
                    </th>
                    {row.map((v, j) => (
                      <td key={j} className="num">
                        {v === null ? <span className="text-muted">{NO_VALUE}</span> : formatNumber(v, locale, digits[j])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
        <p className="text-[11px] text-muted">
          {t("factor.dataset.preview_note", {
            n: Math.min(PREVIEW_ROWS, dataset.n_observations),
            total: dataset.n_observations,
          })}
        </p>
      </div>
    </div>
  );
}

/**
 * All miners together or one of them, as tiles with the observations n and the measures p each
 * has: a miner with no more rows than measures cannot be analysed and is blocked, one with fewer
 * than five rows per measure is marked. The hint below says what the choice means.
 */
function MinerChoice({
  dataset,
  miners,
  miner,
  excluded,
  onChange,
  compareHref,
  compareReason,
}: MinerChoiceProps & { dataset: FactorDataset; miners: MinerSummary[] }) {
  const t = useT();
  const { locale } = useLocale();
  const chosen = miners.find((m) => m.name === miner) ?? null;
  const hint = chosen
    ? t("factor.miners.hint_one", { miner: chosen.name, n: formatNumber(chosen.n_observations, locale) })
    : t("factor.miners.hint_together", { miners: miners.length });
  return (
    <section id="fa-miner" aria-labelledby="fa-miner-label" className="space-y-2 scroll-mt-24">
      <div className="flex items-center justify-between gap-x-4 gap-y-1 flex-wrap">
        <span id="fa-miner-label">
          <HelpLabel
            as="span"
            label={t("factor.miners.label")}
            help={t("factor.miners.help", { per: OBSERVATIONS_PER_MEASURE })}
          />
        </span>
        <ActionLink href={compareHref} reason={compareReason} icon={Columns3} more={t("factor.miners.compare_more")}>
          {t("factor.miners.compare")}
        </ActionLink>
      </div>
      <div role="radiogroup" aria-labelledby="fa-miner-label" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MinerTile
          title={t("factor.miners.together")}
          choice={rowsChoice(dataset, null, excluded)}
          chosen={miner === null}
          onChoose={() => onChange(null)}
        />
        {miners.map((m) => (
          <MinerTile
            key={m.name}
            title={m.name}
            choice={rowsChoice(dataset, m, excluded)}
            chosen={m.name === miner}
            onChoose={() => onChange(m.name)}
          />
        ))}
      </div>
      <Brief text={hint} topic={t("factor.miners.label")} />
    </section>
  );
}

function MinerTile({
  title,
  choice,
  chosen,
  onChoose,
}: {
  title: string;
  choice: RowsChoice;
  chosen: boolean;
  onChoose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const params = {
    n: formatNumber(choice.n, locale),
    p: formatNumber(choice.p, locale),
    min: formatNumber(OBSERVATIONS_PER_MEASURE * choice.p, locale),
  };
  // A blocked tile stays focusable, so that its reason can be read; the chosen one can be left.
  const reason = choice.blocked && !chosen ? t("factor.miners.blocked_reason", params) : null;
  // A tooltip needs a name besides the reason; the title is the tile's own.
  const tip = useTip<HTMLLabelElement>(reason ? { name: title, reason } : null);
  const size = t("factor.miners.size", params);
  const state = choice.blocked ? t("factor.miners.blocked", params) : choice.few ? t("factor.miners.few", params) : null;
  const sizeId = useId();
  const stateId = useId();
  return (
    <label
      ref={tip}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-3 py-2.5 min-w-0",
        choiceTile(chosen),
        reason && "cursor-default opacity-60",
      )}
    >
      {/* Named by the title alone, so the numbers describe the choice rather than renaming it. */}
      <input
        type="radio"
        name="fa-miner"
        className="sr-only"
        checked={chosen}
        aria-label={title}
        aria-describedby={state ? `${sizeId} ${stateId}` : sizeId}
        aria-disabled={reason ? true : undefined}
        onChange={() => {
          if (!reason) onChoose();
        }}
      />
      <ChoiceMark type="radio" checked={chosen} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium break-words">{title}</span>
        <span id={sizeId} className="block text-[11px] text-muted tabular-nums">
          {size}
        </span>
        {state && (
          <span id={stateId} className="mt-0.5 flex items-start gap-1 text-[11px] text-warn-ink leading-snug">
            {choice.blocked ? (
              <Ban className="h-3 w-3 mt-px shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="h-3 w-3 mt-px shrink-0" aria-hidden />
            )}
            {state}
          </span>
        )}
      </span>
    </label>
  );
}

/** A value of the statistics, ungrouped (formatStatistic), or a dash where there is none. */
function statistic(value: number | null, locale: string): React.ReactNode {
  if (value === null) return <span className="text-muted">{NO_VALUE}</span>;
  return formatStatistic(value, locale);
}

/**
 * The statistics of every measure as ComFy's report prints them: mean, median, standard deviation
 * (n − 1), minimum and maximum, over the data before cleaning, so the measures cleaning dropped
 * are there too. Folded until asked for, like every table that is there for reference.
 */
function DescriptivesTable({
  descriptives,
  measureName,
  measureDescription,
}: {
  descriptives: Descriptives;
  measureName: (key: string) => string;
  measureDescription: (key: string) => string | undefined;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const zone = useTipZone<HTMLTableElement>();
  const rows = descriptives.measures;
  const heading = t("factor.dataset.descriptives_heading");
  const long = rows.length > 20;
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">
        <FoldButton label={`${heading} · ${formatNumber(rows.length, locale)}`} fold={{ open, onToggle: () => setOpen((v) => !v) }} />
      </div>
      {open && (
        <>
          <MeasureListScope measures={rows.map((row) => row.measure)}>
            <TableFrame label={heading} boxed={long} className={long ? "max-h-[28rem]" : undefined}>
              <table ref={zone} className="data-table">
                <caption className="sr-only">{heading}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="sticky-col">
                      {t("factor.suitability.col_measure")}
                    </th>
                    <th scope="col" className="num" data-tip-more={t("factor.dataset.col_n_more")}>
                      n
                    </th>
                    <th scope="col" className="num">
                      {t("factor.dataset.col_mean")}
                    </th>
                    <th scope="col" className="num">
                      {t("factor.dataset.col_median")}
                    </th>
                    <th scope="col" className="num" data-tip-more={t("factor.dataset.col_sd_more")}>
                      {t("factor.dataset.col_sd")}
                    </th>
                    <th scope="col" className="num">
                      {t("factor.dataset.col_min")}
                    </th>
                    <th scope="col" className="num">
                      {t("factor.dataset.col_max")}
                    </th>
                    <th scope="col">{t("factor.dataset.col_cleaning")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.measure} className={row.dropped ? "text-muted" : undefined}>
                      <th scope="row" className="sticky-col font-medium break-words min-w-[9rem] max-w-[16rem]">
                        <span data-tip-more={measureDescription(row.measure)}>
                          <MeasureName name={measureName(row.measure)} measure={row.measure} />
                        </span>
                      </th>
                      <td className="num">{formatNumber(row.n, locale)}</td>
                      <td className="num">{statistic(row.mean, locale)}</td>
                      <td className="num">{statistic(row.median, locale)}</td>
                      <td className="num">{statistic(row.std, locale)}</td>
                      <td className="num">{statistic(row.min, locale)}</td>
                      <td className="num">{statistic(row.max, locale)}</td>
                      <td className="whitespace-nowrap">
                        {row.dropped ? t(`factor.dataset.reason.${row.dropped}`) : ""}
                        {row.renamed_from && (
                          <span className="text-muted">
                            {row.dropped ? " · " : ""}
                            {t("factor.dataset.renamed", { from: row.renamed_from, to: row.measure })}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </MeasureListScope>
          <Brief
            className="text-[11px]"
            topic={t("factor.dataset.descriptives_heading")}
            text={
              descriptives.basis === "input"
                ? t("factor.dataset.descriptives_note", { n: descriptives.n_rows })
                : t("factor.dataset.descriptives_note_cleaned")
            }
          />
        </>
      )}
    </div>
  );
}

/** Seconds in a table: two decimals, three below a tenth, so a quick stage does not read as 0. */
function secondsText(value: number | undefined, locale: string): React.ReactNode {
  if (value === undefined || !Number.isFinite(value)) return <span className="text-muted">{NO_VALUE}</span>;
  return formatNumber(value, locale, value < 0.1 ? 3 : 2);
}

function countCell(value: number | undefined, locale: string): React.ReactNode {
  return value === undefined ? <span className="text-muted">{NO_VALUE}</span> : formatNumber(value, locale);
}

/**
 * The run times and input sizes of a dataset the tool computed, one row per observation: the size
 * of its log and net, and the seconds of reading, discovery and the measures. The numbers a paper
 * reports on the performance of the tool; the ZIP has them per measure as well.
 */
function MeasurementTable({
  measurement,
  logLink,
}: {
  measurement: Measurement;
  /** The link of a row to the page of its log, for a dataset computed from logs. */
  logLink?: (label: string | undefined) => React.ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const zone = useTipZone<HTMLTableElement>();
  const rows = measurementRows(measurement);
  const totals = measurementTotals(measurement);
  const logs = measurement.source === "logs";
  const discovery = measurement.kind === "model" && logs;
  const nets = measurement.kind === "model";
  const heading = t("factor.dataset.measurement_heading");
  const computeLabel = t(measurement.kind === "log" ? "factor.dataset.col_features_s" : "factor.dataset.col_measures_s");
  // The sums stand under the columns of the seconds; the columns before them share the label.
  const before = 1 + (logs ? 4 : 0) + (nets ? 1 : 0);
  const long = rows.length > 20;
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">
        <FoldButton
          label={`${heading} · ${t("factor.dataset.measurement_total", { s: formatNumber(totals.total_s, locale, 1) })}`}
          fold={{ open, onToggle: () => setOpen((v) => !v) }}
        />
      </div>
      {open && (
        <>
          <TableFrame label={heading} boxed={long} className={long ? "max-h-[28rem]" : undefined}>
            <table ref={zone} className="data-table">
              <caption className="sr-only">{heading}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky-col">
                    {t("factor.dataset.observation")}
                  </th>
                  {logs && (
                    <>
                      <th scope="col" className="num">
                        {t("factor.dataset.col_traces")}
                      </th>
                      <th scope="col" className="num">
                        {t("factor.dataset.col_events")}
                      </th>
                      <th scope="col" className="num">
                        {t("factor.dataset.col_variants")}
                      </th>
                      <th scope="col" className="num">
                        {t("factor.dataset.col_activities")}
                      </th>
                    </>
                  )}
                  {nets && (
                    <th scope="col" className="num" data-tip-more={t("factor.dataset.col_net_more")}>
                      {t("factor.dataset.col_net")}
                    </th>
                  )}
                  <th scope="col" className="num">
                    {t("factor.dataset.col_read_s")}
                  </th>
                  {discovery && (
                    <th scope="col" className="num" data-tip-more={t("factor.dataset.col_discovery_more")}>
                      {t("factor.dataset.col_discovery_s")}
                    </th>
                  )}
                  <th scope="col" className="num">
                    {computeLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.observation}>
                    <th scope="row" className="sticky-col max-w-[16rem] break-words font-normal">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="min-w-0 break-words"
                          data-tip={row.observation.length > 36 ? row.observation : undefined}
                        >
                          {row.observation}
                        </span>
                        {logLink?.(row.observation)}
                      </span>
                      {row.error && <span className="block text-[11px] text-warn-ink break-words">{row.error}</span>}
                    </th>
                    {logs && (
                      <>
                        <td className="num">{countCell(row.traces, locale)}</td>
                        <td className="num">{countCell(row.events, locale)}</td>
                        <td className="num">{countCell(row.variants, locale)}</td>
                        <td className="num">{countCell(row.activities, locale)}</td>
                      </>
                    )}
                    {nets && (
                      <td className="num whitespace-nowrap">
                        {row.net ? (
                          `${formatNumber(row.net.places, locale)} / ${formatNumber(row.net.transitions, locale)} / ${formatNumber(row.net.arcs, locale)}`
                        ) : (
                          <span className="text-muted">{NO_VALUE}</span>
                        )}
                      </td>
                    )}
                    <td className="num">{secondsText(row.read_s, locale)}</td>
                    {discovery && <td className="num">{secondsText(row.discovery_s, locale)}</td>}
                    <td className="num">{secondsText(row.compute_s, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="sticky-col font-medium" colSpan={before}>
                    {t("factor.dataset.measurement_sum")}
                  </th>
                  <td className="num">{secondsText(totals.read_s, locale)}</td>
                  {discovery && <td className="num">{secondsText(totals.discovery_s, locale)}</td>}
                  <td className="num">{secondsText(totals.compute_s, locale)}</td>
                </tr>
              </tfoot>
            </table>
          </TableFrame>
          <p className="flex items-center gap-1 text-[11px] text-muted">
            {t("factor.dataset.measurement_note")}
            <InfoTip size="xs" topic={t("factor.dataset.measurement_note")} text={t("factor.dataset.measurement_more")} />
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The names of the logs among the recent uploads of the session, which the page of a single log can
 * open; undefined while they are not known, and for a dataset not computed from logs, whose rows
 * have no link.
 */
function useRecentLogNames(wanted: boolean): ReadonlySet<string> | undefined {
  const [names, setNames] = useState<ReadonlySet<string> | undefined>(undefined);
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    fetchRecentLogs().then(
      (list) => alive && setNames(new Set(list.map((l) => l.id))),
      // Without the list the rows say that the log cannot be opened.
      () => alive && setNames(new Set()),
    );
    return () => {
      alive = false;
    };
  }, [wanted]);
  return wanted ? names : undefined;
}

/**
 * "View this log" at a row of a dataset computed from logs: the page of a single log with this log
 * chosen and, for a row of nets, the miner of the row. Only while the server still has the log among
 * the newest uploads of the session; else the icon stays, with the reason.
 */
function LogLink({
  label,
  kind,
  miners,
  logs,
}: {
  label: string;
  kind: FactorKind;
  miners: readonly string[] | undefined;
  logs: ReadonlySet<string>;
}) {
  const t = useT();
  const row = logOfRow(label, kind, miners);
  if (logs.has(row.log)) {
    return (
      <IconLink
        icon={FileSearch}
        name={t("factor.dataset.view_log")}
        more={t("factor.dataset.view_log_more")}
        href={inspectHref(row)}
        className="h-6 w-6 -my-1"
      />
    );
  }
  return (
    <IconButton
      icon={FileSearch}
      size="sm"
      name={t("factor.dataset.view_log")}
      more={t("factor.dataset.view_log_more")}
      reason={t("factor.dataset.view_log_gone")}
      className="h-6 w-6 -my-1"
    />
  );
}
