"use client";

import { Download } from "lucide-react";
import type { Artifact } from "@/lib/api";
import { useT } from "@/lib/i18n";

type T = Extract<Artifact, { kind: "table" }>;

export function TableView({ artifact, runId }: { artifact: T; runId?: string | null }) {
  const t = useT();
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

  return (
    <div className="rounded-md border border-border overflow-hidden bg-surface">
      <div className="px-3 py-2 border-b border-border bg-bg/50 flex items-center justify-between gap-3">
        <span className="text-xs text-muted font-medium">{t("artifacts.table.table_data_label")}</span>
        <button
          onClick={downloadCSV}
          title={t("artifacts.table.download_csv_title")}
          className="h-7 px-2.5 rounded border border-border bg-tile hover:bg-surface text-fg transition flex items-center gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="text-xs">{t("artifacts.table.download_csv_button")}</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg">
            <tr>
              {artifact.columns.map((c) => (
                <th key={c} className="px-3 py-2 text-left text-xs font-medium text-muted uppercase tracking-wide border-b border-border">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-bg/50">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 font-mono text-xs">
                    {cell === null ? <span className="text-muted">—</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
