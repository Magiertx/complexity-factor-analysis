"use client";

import { AlertCircle } from "lucide-react";
import type { FactorDataset } from "@/lib/api";
import { PREVIEW_ROWS, countText } from "@/lib/factor-analysis";
import { NO_VALUE, formatNumber } from "@/lib/format";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { MeasureName, TableFrame } from "@/components/ui/table";
import { useTipZone } from "@/components/ui/tip";
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
                  <th scope="col" className="w-full">
                    {t("factor.dataset.col_detail")}
                  </th>
                </tr>
              </thead>
              <tbody ref={cleaningZone}>
                {dataset.dropped.map((d) => (
                  <tr key={`${d.measure}:${d.reason}`}>
                    <th scope="row" className="font-medium break-words min-w-[10rem]">
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
