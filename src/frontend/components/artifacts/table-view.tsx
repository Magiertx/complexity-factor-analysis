"use client";

import { Download } from "lucide-react";
import type { Artifact } from "@/lib/api";
import { localizedAlgoText, useLocale } from "@/lib/i18n";
import { formatNumber } from "@/lib/i18n/local-format";
import { cn } from "@/lib/utils";

type T = Extract<Artifact, { kind: "table" }>;

export function TableView({ artifact, runId }: { artifact: T; runId?: string | null }) {
  const { t, locale } = useLocale();
  // One CSV cell, quoted where needed.
  // Cells starting with =, +, -, @ get a leading apostrophe unless they are numbers.
  // Same rules as `csv_cell` in AlgoService/zip_export.py.
  const csvCell = (cell: unknown) => {
    if (cell === null || cell === undefined) return "";
    let str = String(cell);
    if (/^[=+\-@\t\r]/.test(str) && !Number.isFinite(Number(str))) {
      str = "'" + str;
    }
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const downloadCSV = () => {
    const headers = artifact.columns.map(csvCell).join(",");
    const rows = artifact.rows.map(row => row.map(csvCell).join(",")).join("\n");
    const csvContent = headers + "\n" + rows;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const prefix = runId ? `run_${runId.slice(0, 8)}_` : "";
    const safeLabel = (artifact.label || "table_data").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    link.setAttribute("href", url);
    link.setAttribute("download", `${prefix}${safeLabel}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // As in the tables of the factor analysis: numbers right-aligned in the UI language, three
  // decimals unless whole; the first column stays in view while the table scrolls sideways.
  const numeric = artifact.columns.map(
    (_, j) =>
      artifact.rows.some((row) => typeof row[j] === "number") &&
      artifact.rows.every((row) => row[j] === null || typeof row[j] === "number"),
  );
  const cellText = (cell: string | number | boolean) =>
    typeof cell === "number" ? formatNumber(cell, locale, Number.isInteger(cell) ? 0 : 3) : String(cell);

  return (
    <div className="rounded-md bg-tile/40 overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-3">
        <span className="text-xs text-muted font-medium">{t("artifacts.table.table_data_label")}</span>
        <button
          type="button"
          onClick={downloadCSV}
          title={t("artifacts.table.download_csv_title")}
          className="h-7 px-2.5 rounded bg-tile hover:bg-accent/[0.08] text-fg transition flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="text-xs">{t("artifacts.table.download_csv_button")}</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-bg">
            <tr>
              {artifact.columns.map((c, j) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    "px-3 py-2 font-medium text-muted border-b border-border whitespace-nowrap",
                    numeric[j] ? "text-right" : "text-left",
                    j === 0 && "sticky left-0 z-10 bg-bg",
                  )}
                >
                  {localizedAlgoText(c, t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                {row.map((cell, j) => {
                  const content = cell === null ? <span className="text-muted">—</span> : cellText(cell);
                  return j === 0 ? (
                    <th
                      key={j}
                      scope="row"
                      className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-medium whitespace-nowrap"
                    >
                      {content}
                    </th>
                  ) : (
                    <td
                      key={j}
                      className={cn(
                        "px-3 py-1.5 whitespace-nowrap",
                        numeric[j] ? "text-right font-mono tabular-nums" : "text-left",
                      )}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
