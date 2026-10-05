"use client";

import { Download } from "lucide-react";
import { datasetDownloadUrl, type FactorDataset } from "@/lib/api";
import { formatNumber } from "@/lib/factor-analysis";
import { useT } from "@/lib/i18n";
import { HelpLabel, StatTile } from "./step-section";

const PREVIEW_ROWS = 8;

export function DatasetView({
  dataset,
  measureName,
}: {
  dataset: FactorDataset;
  measureName: (key: string) => string;
}) {
  const t = useT();
  const preview = dataset.values.slice(0, PREVIEW_ROWS);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label={t("factor.dataset.observations")} value={dataset.n_observations.toLocaleString()} />
        <StatTile label={t("factor.dataset.measures")} value={dataset.measures.length} />
        <StatTile label={t("factor.dataset.dropped_measures")} value={dataset.dropped.length} />
        <StatTile label={t("factor.dataset.dropped_rows")} value={dataset.dropped_rows} />
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
                title={d.detail}
              >
                <span className="font-medium">{measureName(d.measure)}</span>
                <span className="rounded bg-bg/70 px-1 text-[10px] text-muted">
                  {t(`factor.dataset.reason.${d.reason}`)}
                </span>
                {d.detail && <span className="text-[10px] text-muted">{d.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        {dataset.dropped_rows > 0 && (
          <p className="text-xs text-muted">{t("factor.dataset.dropped_rows_note", { n: dataset.dropped_rows })}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold">{t("factor.dataset.preview_heading")}</h3>
          <a
            href={datasetDownloadUrl(dataset.id)}
            download
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-border hover:bg-tile transition text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Download className="h-3.5 w-3.5" />
            {t("factor.dataset.download_csv")}
          </a>
        </div>
        <div className="rounded-md border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">{t("factor.dataset.preview_heading")}</caption>
            <thead className="bg-bg">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-bg px-3 py-2 text-left font-medium text-muted uppercase tracking-wide border-b border-border"
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
                      {v === null ? <span className="text-muted">—</span> : formatNumber(v, 3)}
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
            total: dataset.n_observations.toLocaleString(),
          })}
          {dataset.truncated && ` ${t("factor.dataset.truncated", { n: dataset.values.length.toLocaleString() })}`}
        </p>
      </div>
    </div>
  );
}
