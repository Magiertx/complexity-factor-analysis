"use client";

import { useState } from "react";
import { FileCode2, FileSpreadsheet, Loader2 } from "lucide-react";
import type { FactorAnalysis } from "@/lib/api";
import {
  ORTHOGONAL,
  formatNumber,
  formatPercent,
  loadingStyle,
  orderMeasures,
  signColor,
  type AnalysisOptions,
} from "@/lib/factor-analysis";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { HelpLabel, NumberField } from "./step-section";

interface Props {
  analysis: FactorAnalysis;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
  measureName: (key: string) => string;
  onExport: (format: "csv" | "latex") => void;
  exporting: "csv" | "latex" | null;
}

export function LoadingsView({ analysis, options, onOptions, measureName, onExport, exporting }: Props) {
  const t = useT();
  const [order, setOrder] = useState<"factor" | "original">("factor");
  const k = analysis.n_factors;
  const factorIdx = Array.from({ length: k }, (_, i) => i);
  const rows = orderMeasures(analysis, order);
  const threshold = options.loading_threshold;
  const oblique = analysis.rotation !== "none" && !(ORTHOGONAL as string[]).includes(analysis.rotation);
  const cellPad = "px-2.5 sm:px-3 py-1.5";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-end gap-5 flex-wrap">
          <div className="space-y-1.5">
            <HelpLabel as="span" label={t("factor.loadings.threshold_label")} help={t("factor.help.threshold")} />
            <NumberField
              id="fa-loading-threshold"
              value={threshold}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onOptions({ loading_threshold: v })}
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-sm font-semibold">{t("factor.loadings.order_label")}</span>
            <Segmented
              size="sm"
              value={order}
              onChange={setOrder}
              options={[
                { value: "factor", label: t("factor.loadings.order_factor") },
                { value: "original", label: t("factor.loadings.order_original") },
              ]}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => onExport("csv")} disabled={exporting !== null}>
            {exporting === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            {t("factor.loadings.export_csv")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onExport("latex")} disabled={exporting !== null}>
            {exporting === "latex" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCode2 className="h-3.5 w-3.5" />}
            {t("factor.loadings.export_latex")}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-4 flex-wrap">
            <HelpLabel label={t("factor.loadings.table_heading")} help={t("factor.help.loading")} />
            <HelpLabel as="span" label={t("factor.loadings.col_communality")} help={t("factor.help.communality")} />
            <HelpLabel as="span" label={t("factor.loadings.variance_label")} help={t("factor.help.variance")} />
          </div>
          <Legend threshold={threshold} />
        </div>
        <div className="rounded-md border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              {t("factor.loadings.caption", { n: k, rotation: analysis.rotation })}
            </caption>
            <thead className="bg-bg">
              <tr className="text-muted">
                <th
                  scope="col"
                  className={cn(cellPad, "py-2 sticky left-0 z-10 bg-bg text-left font-medium uppercase tracking-wide border-b border-border")}
                >
                  {t("factor.loadings.col_measure")}
                </th>
                {factorIdx.map((i) => (
                  <th
                    key={i}
                    scope="col"
                    title={t("factor.loadings.factor_n", { i: i + 1 })}
                    className={cn(cellPad, "py-2 text-right font-medium border-b border-border whitespace-nowrap")}
                  >
                    F{i + 1}
                  </th>
                ))}
                <th
                  scope="col"
                  title={t("factor.loadings.col_communality")}
                  className={cn(cellPad, "py-2 text-right font-medium border-b border-l border-border whitespace-nowrap")}
                >
                  h²
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const values = analysis.loadings[m] ?? [];
                const h2 = analysis.communalities[m];
                return (
                  <tr key={m} className="border-b border-border last:border-0">
                    <th
                      scope="row"
                      className={cn(cellPad, "sticky left-0 z-10 bg-surface text-left font-medium max-w-[14rem] truncate")}
                      title={m}
                    >
                      {measureName(m)}
                    </th>
                    {factorIdx.map((i) => {
                      const v = values[i];
                      if (v === undefined) return <td key={i} className={cellPad} />;
                      const strong = Math.abs(v) >= threshold;
                      return (
                        <td
                          key={i}
                          style={loadingStyle(v)}
                          title={`${measureName(m)} · ${t("factor.loadings.factor_n", { i: i + 1 })}: ${formatNumber(v, 3)}`}
                          className={cn(
                            cellPad,
                            "text-right font-mono tabular-nums whitespace-nowrap",
                            strong ? "font-bold text-fg" : "text-fg/70",
                          )}
                        >
                          {formatNumber(v)}
                        </td>
                      );
                    })}
                    <td className={cn(cellPad, "border-l border-border")}>
                      {h2 !== undefined && (
                        <span className="flex items-center justify-end gap-2">
                          <span className="hidden sm:block h-1.5 w-12 rounded-full bg-tile overflow-hidden" aria-hidden>
                            <span
                              className="block h-full bg-muted/70 rounded-full"
                              style={{ width: `${Math.min(1, Math.max(0, h2)) * 100}%` }}
                            />
                          </span>
                          <span className="font-mono tabular-nums">{formatNumber(h2)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-bg/60 text-muted">
              <VarianceRow label={t("factor.loadings.ss_loadings")} values={analysis.variance.ss_loadings} format={(v) => formatNumber(v)} pad={cellPad} />
              <VarianceRow label={t("factor.loadings.proportion")} values={analysis.variance.proportion} format={(v) => formatPercent(v)} pad={cellPad} />
              <VarianceRow label={t("factor.loadings.cumulative")} values={analysis.variance.cumulative} format={(v) => formatPercent(v)} pad={cellPad} />
            </tfoot>
          </table>
        </div>
        <p className="text-[11px] text-muted max-w-prose">
          {t("factor.loadings.footer_note")}
          {oblique && ` ${t("factor.loadings.oblique_note")}`}
        </p>
      </div>

      <FactorGroups analysis={analysis} measureName={measureName} />
    </div>
  );
}

function VarianceRow({
  label,
  values,
  format,
  pad,
}: {
  label: string;
  values: number[];
  format: (v: number) => string;
  pad: string;
}) {
  return (
    <tr className="border-t border-border">
      <th scope="row" className={cn(pad, "sticky left-0 z-10 bg-bg text-left font-medium")}>
        {label}
      </th>
      {values.map((v, i) => (
        <td key={i} className={cn(pad, "text-right font-mono tabular-nums whitespace-nowrap")}>
          {format(v)}
        </td>
      ))}
      <td className={cn(pad, "border-l border-border")} />
    </tr>
  );
}

function Legend({ threshold }: { threshold: number }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted flex-wrap" aria-hidden>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={loadingStyle(-0.9)} />
        {t("factor.loadings.legend_negative")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={loadingStyle(0.9)} />
        {t("factor.loadings.legend_positive")}
      </span>
      <span>
        <b className="text-fg">0.00</b> {t("factor.loadings.legend_bold", { threshold: formatNumber(threshold) })}
      </span>
    </div>
  );
}

function FactorGroups({ analysis, measureName }: { analysis: FactorAnalysis; measureName: (key: string) => string }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <HelpLabel label={t("factor.loadings.groups_heading")} help={t("factor.help.groups")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {analysis.factors.map((f) => {
          const share = analysis.variance.proportion[f.index - 1];
          return (
            <div key={f.index} className="rounded-lg bg-tile p-3.5 space-y-2.5 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold">{t("factor.loadings.factor_n", { i: f.index })}</h4>
                {share !== undefined && (
                  <span className="text-[11px] text-muted">{t("factor.loadings.factor_variance", { pct: formatPercent(share) })}</span>
                )}
              </div>
              {f.measures.length === 0 ? (
                <p className="text-xs text-muted">{t("factor.loadings.factor_empty")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {f.measures.map((m) => (
                    <li key={m.measure} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate" title={m.measure}>
                          {measureName(m.measure)}
                        </span>
                        <span className="font-mono tabular-nums shrink-0">{formatNumber(m.loading)}</span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-bg/80 overflow-hidden" aria-hidden>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(1, Math.abs(m.loading)) * 100}%`,
                            backgroundColor: signColor(m.loading),
                            opacity: 0.75,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {analysis.unassigned.length > 0 && (
          <div className="rounded-lg border border-dashed border-border p-3.5 space-y-2 min-w-0">
            <div>
              <h4 className="text-sm font-semibold">{t("factor.loadings.unassigned_heading")}</h4>
              <p className="text-[11px] text-muted">{t("factor.loadings.unassigned_hint")}</p>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {analysis.unassigned.map((m) => (
                <li key={m} className="rounded bg-tile px-1.5 py-0.5 text-xs">
                  {measureName(m)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
