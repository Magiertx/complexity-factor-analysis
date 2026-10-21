"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Descriptives, FactorDataset, Measurement } from "@/lib/api";
import { PREVIEW_ROWS, countText } from "@/lib/factor-analysis";
import { NO_VALUE, formatNumber, formatStatistic } from "@/lib/format";
import { measurementRows, measurementTotals } from "@/lib/measurement";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { MeasureName, TableFrame } from "@/components/ui/table";
import { Term, useTipZone } from "@/components/ui/tip";
import { FoldButton } from "./measure-fold";
import { HelpLabel, StatTile } from "./step-section";

export function DatasetView({
  dataset,
  measureName,
  measureDescription,
}: {
  dataset: FactorDataset;
  measureName: (key: string) => string;
  /** What a measure measures, for its tooltip. */
  measureDescription: (key: string) => string | undefined;
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

  return (
    <div className="space-y-6">
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
                        <MeasureName name={measureName(d.measure)} />
                      </span>
                    </th>
                    <td className="whitespace-nowrap">{t(`factor.dataset.reason.${d.reason}`)}</td>
                    <td className="text-muted break-words">{detailOf(d) ?? NO_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
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
            {failures.map((f, i) => (
              <li key={i} className="break-words">
                <span className="font-medium">{f.input}</span>
                <span className="text-muted">: {f.error}</span>
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

      {dataset.measurement && <MeasurementTable measurement={dataset.measurement} />}

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
                    <th
                      scope="row"
                      className="sticky-col max-w-[16rem] truncate"
                      data-tip={label && label.length > 36 ? label : undefined}
                    >
                      {label ?? i + 1}
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
                        <MeasureName name={measureName(row.measure)} />
                      </span>
                    </th>
                    <td className="num">{formatNumber(row.n, locale)}</td>
                    <td className="num">{statistic(row.mean, locale)}</td>
                    <td className="num">{statistic(row.median, locale)}</td>
                    <td className="num">{statistic(row.std, locale)}</td>
                    <td className="num">{statistic(row.min, locale)}</td>
                    <td className="num">{statistic(row.max, locale)}</td>
                    <td className="whitespace-nowrap">{row.dropped ? t(`factor.dataset.reason.${row.dropped}`) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          <p className="text-[11px] text-muted max-w-prose">
            {descriptives.basis === "input"
              ? t("factor.dataset.descriptives_note", { n: descriptives.n_rows })
              : t("factor.dataset.descriptives_note_cleaned")}
          </p>
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
function MeasurementTable({ measurement }: { measurement: Measurement }) {
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
                    <th
                      scope="row"
                      className="sticky-col max-w-[16rem] break-words font-normal"
                      data-tip={row.observation.length > 36 ? row.observation : undefined}
                    >
                      {row.observation}
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
          <p className="text-[11px] text-muted max-w-prose">
            <Term more={t("factor.dataset.measurement_more")}>{t("factor.dataset.measurement_note")}</Term>
          </p>
        </>
      )}
    </div>
  );
}
