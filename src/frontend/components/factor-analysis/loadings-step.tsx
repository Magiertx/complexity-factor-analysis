"use client";

import { useState } from "react";
import { FileArchive, FileCode2, FileSpreadsheet, Loader2 } from "lucide-react";
import type { FactorAnalysis } from "@/lib/api";
import {
  ORTHOGONAL,
  loadingStyle,
  orderMeasures,
  signColor,
  type AnalysisOptions,
  type ExportFormat,
} from "@/lib/factor-analysis";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { FieldLabel, HelpLabel, ThresholdField } from "./step-section";

interface Props {
  analysis: FactorAnalysis;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
  measureName: (key: string) => string;
  onExport: (format: ExportFormat) => void;
  exporting: ExportFormat | null;
  /** The analysis on screen matches the settings, so the ZIP holds what is shown. */
  zipReady: boolean;
}

export function LoadingsView({ analysis, options, onOptions, measureName, onExport, exporting, zipReady }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const [order, setOrder] = useState<"factor" | "original">("factor");
  const [matrix, setMatrix] = useState<"pattern" | "structure">("pattern");
  const k = analysis.n_factors;
  const factorIdx = Array.from({ length: k }, (_, i) => i);
  const rows = orderMeasures(analysis, order);
  const threshold = options.loading_threshold;
  const oblique = analysis.rotation !== "none" && !(ORTHOGONAL as string[]).includes(analysis.rotation);
  const structure = oblique && matrix === "structure" ? analysis.structure_loadings : null;
  const shown = structure ?? analysis.loadings;
  const { proportion, cumulative } = analysis.variance;
  const cellPad = "px-2.5 sm:px-3 py-1.5";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
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
          />
          {oblique && analysis.structure_loadings && (
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
          <div className="space-y-1.5">
            <FieldLabel id="fa-order-label">{t("factor.loadings.order_label")}</FieldLabel>
            <Segmented
              size="sm"
              aria-labelledby="fa-order-label"
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport("zip")}
            disabled={exporting !== null || !zipReady}
            title={t("factor.loadings.export_zip_title")}
          >
            {exporting === "zip" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
            {t("factor.loadings.export_zip")}
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
        <div className="rounded-md bg-tile/40 overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              {t("factor.loadings.caption", { n: k, rotation: analysis.rotation })}
              {oblique && ` (${t(`factor.loadings.matrix_${structure ? "structure" : "pattern"}`)})`}
            </caption>
            <thead className="bg-bg">
              <tr className="text-muted">
                <th
                  scope="col"
                  className={cn(cellPad, "py-2 sticky left-0 z-10 bg-bg text-left font-medium border-b border-border")}
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
                const values = shown[m] ?? [];
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
                          title={`${measureName(m)} · ${t("factor.loadings.factor_n", { i: i + 1 })}: ${formatNumber(v, locale, 3)}`}
                          className={cn(
                            cellPad,
                            "text-right font-mono tabular-nums whitespace-nowrap",
                            strong ? "font-bold text-fg" : "text-fg/70",
                          )}
                        >
                          {formatNumber(v, locale, 2)}
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
                          <span className="font-mono tabular-nums">{formatNumber(h2, locale, 2)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* The sums of squares are those of the pattern matrix; the structure matrix has none. */}
            {!structure && (
              <tfoot className="bg-bg/60 text-muted">
                <VarianceRow label={t("factor.loadings.ss_loadings")} values={analysis.variance.ss_loadings} format={(v) => formatNumber(v, locale, 2)} pad={cellPad} />
                {proportion && (
                  <VarianceRow label={t("factor.loadings.proportion")} values={proportion} format={(v) => formatPercent(v, locale)} pad={cellPad} />
                )}
                {cumulative && (
                  <VarianceRow label={t("factor.loadings.cumulative")} values={cumulative} format={(v) => formatPercent(v, locale)} pad={cellPad} />
                )}
              </tfoot>
            )}
          </table>
        </div>
        <p className="text-[11px] text-muted max-w-prose">
          {t("factor.loadings.h2_note")}{" "}
          {!oblique
            ? t("factor.loadings.footer_rows")
            : structure
              ? t("factor.loadings.structure_note")
              : t("factor.loadings.footer_row_pattern")}
          {oblique && ` ${t("factor.loadings.oblique_note", { pct: formatPercent(analysis.variance.explained, locale) })}`}
        </p>
      </div>

      {analysis.factor_correlations && <FactorCorrelations values={analysis.factor_correlations} pad={cellPad} />}

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

function FactorCorrelations({ values, pad }: { values: number[][]; pad: string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="space-y-2">
      <HelpLabel label={t("factor.loadings.correlations_heading")} help={t("factor.help.factor_correlations")} />
      <div className="rounded-md bg-tile/40 overflow-x-auto w-fit max-w-full">
        <table className="text-xs">
          <caption className="sr-only">{t("factor.loadings.correlations_heading")}</caption>
          <thead className="bg-bg text-muted">
            <tr>
              <td className={cn(pad, "border-b border-border")} />
              {values.map((_, j) => (
                <th key={j} scope="col" className={cn(pad, "text-right font-medium border-b border-border")}>
                  F{j + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {values.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <th scope="row" className={cn(pad, "text-left font-medium text-muted")}>
                  F{i + 1}
                </th>
                {row.map((v, j) => (
                  <td
                    key={j}
                    style={i === j ? undefined : loadingStyle(v)}
                    className={cn(pad, "text-right font-mono tabular-nums", i === j && "text-muted")}
                  >
                    {formatNumber(v, locale, 2)}
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

function Legend({ threshold }: { threshold: number }) {
  const t = useT();
  const { locale } = useLocale();
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
        <b className="text-fg">{formatNumber(0, locale, 2)}</b>{" "}
        {t("factor.loadings.legend_bold", { threshold: formatNumber(threshold, locale, 2) })}
      </span>
    </div>
  );
}

function FactorGroups({ analysis, measureName }: { analysis: FactorAnalysis; measureName: (key: string) => string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="space-y-2">
      <HelpLabel label={t("factor.loadings.groups_heading")} help={t("factor.help.groups")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {analysis.factors.map((f) => {
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
                  {f.measures.map((m) => (
                    <li key={m.measure} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate" title={m.measure}>
                          {measureName(m.measure)}
                        </span>
                        <span className="font-mono tabular-nums shrink-0">{formatNumber(m.loading, locale, 2)}</span>
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
