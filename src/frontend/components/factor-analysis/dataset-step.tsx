"use client";

import { AlertCircle, FileSpreadsheet } from "lucide-react";
import { datasetDownloadUrl, type FactorDataset } from "@/lib/api";
import { PREVIEW_ROWS } from "@/lib/factor-analysis";
import { NO_VALUE, formatNumber } from "@/lib/format";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { HelpLabel, StatTile } from "./step-section";

export function DatasetView({
  dataset,
  measureName,
}: {
  dataset: FactorDataset;
  measureName: (key: string) => string;
}) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const preview = dataset.values.slice(0, PREVIEW_ROWS);
  // Older datasets carry only the English detail.
  const detailOf = (d: FactorDataset["dropped"][number]) =>
    (d.params && tMaybe(`factor.dataset.detail.${d.reason}`, d.params)) || d.detail;
  const failures = dataset.failures ?? [];

  return (
    <div className="space-y-5">
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
          <ul className="flex flex-wrap gap-1.5">
            {dataset.dropped.map((d) => (
              <li
                key={`${d.measure}:${d.reason}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-tile px-2 py-1 text-xs"
                title={detailOf(d)}
              >
                <span className="font-medium">{measureName(d.measure)}</span>
                <span className="rounded bg-bg/70 px-1 text-[10px] text-muted">
                  {t(`factor.dataset.reason.${d.reason}`)}
                </span>
                {detailOf(d) && <span className="text-[10px] text-muted">{detailOf(d)}</span>}
              </li>
            ))}
          </ul>
        )}
        {dataset.dropped_rows > 0 && (
          <p className="text-xs text-muted">{t("factor.dataset.dropped_rows_note", { n: dataset.dropped_rows })}</p>
        )}
      </div>

      {failures.length > 0 && (
        <details className="rounded-lg bg-warn/10 px-3.5 py-2.5 text-xs">
          <summary className="cursor-pointer flex items-start gap-2 font-medium">
            <AlertCircle className="h-4 w-4 text-warn-ink shrink-0" />
            {t("factor.dataset.failures_heading", { n: failures.length })}
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold">{t("factor.dataset.preview_heading")}</h3>
          {/* A link, so the browser downloads it directly; looks like the download buttons of step 5. */}
          <a
            href={datasetDownloadUrl(dataset.id)}
            download
            className="h-8 px-3 inline-flex items-center justify-center gap-2 rounded-md bg-tile hover:bg-accent/[0.08] text-fg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {t("factor.dataset.download_csv")}
          </a>
        </div>
        <div className="rounded-md bg-tile/40 overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">{t("factor.dataset.preview_heading")}</caption>
            <thead className="bg-bg">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-bg px-3 py-2 text-left font-medium text-muted border-b border-border"
                >
                  {t("factor.dataset.observation")}
                </th>
                {dataset.measures.map((m) => (
                  <th
                    key={m}
                    scope="col"
                    className="px-3 py-2 text-right font-medium text-muted border-b border-border whitespace-nowrap"
                    title={m}
                  >
                    {measureName(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-normal max-w-[16rem] truncate"
                    title={dataset.observations[i]}
                  >
                    {dataset.observations[i] ?? i + 1}
                  </th>
                  {row.map((v, j) => (
                    <td key={j} className="px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                      {v === null ? <span className="text-muted">{NO_VALUE}</span> : formatNumber(v, locale, Number.isInteger(v) ? 0 : 3)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
