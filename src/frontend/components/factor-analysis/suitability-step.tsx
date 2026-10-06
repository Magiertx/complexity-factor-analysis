"use client";

import { AlertTriangle } from "lucide-react";
import type { FactorAnalysis, FactorDataset } from "@/lib/api";
import { MIN_MEASURES, kmoGrade, noticeParams, type AnalysisOptions } from "@/lib/factor-analysis";
import { NO_VALUE, formatNumber, formatPValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { ChoiceMark } from "@/components/ui/choice";
import { Switch } from "@/components/ui/switch";
import { HelpLabel, NumberField, PassBadge } from "./step-section";

interface Props {
  dataset: FactorDataset;
  analysis: FactorAnalysis | null;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
  measureName: (key: string) => string;
}

export function SuitabilityView({ dataset, analysis, options, onOptions, measureName }: Props) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  // Translated by code where the UI knows it; the English message otherwise.
  const warnings = analysis
    ? (analysis.warning_details ?? analysis.warnings.map((message) => ({ code: "", message, params: {} }))).map(
        (w) => (w.code && tMaybe(`factor.warnings.${w.code}`, noticeParams(w.params))) || w.message,
      )
    : [];
  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <div className="rounded-lg bg-warn/10 px-3.5 py-3 flex items-start gap-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-warn-ink shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{t("factor.suitability.warnings_heading")}</div>
            <ul className="mt-1 text-xs text-muted space-y-0.5 list-disc pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

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
            <label id="fa-auto-msa-label" htmlFor="fa-auto-msa" className="text-sm font-medium cursor-pointer">
              {t("factor.suitability.auto_filter_label")}
            </label>
            <p id="fa-auto-msa-hint" className="text-xs text-muted mt-0.5 max-w-prose">
              {t("factor.help.msa_filter")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap pl-12">
          <label className="flex items-center gap-2 text-xs text-muted">
            <span>{t("factor.suitability.msa_threshold")}</span>
            <NumberField
              id="fa-msa-threshold"
              value={options.msa_threshold}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onOptions({ msa_threshold: v })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <span>{t("factor.suitability.bartlett_alpha")}</span>
            <NumberField
              id="fa-bartlett-alpha"
              value={options.bartlett_alpha}
              min={0.0001}
              max={0.5}
              step={0.01}
              onChange={(v) => onOptions({ bartlett_alpha: v })}
            />
          </label>
        </div>
        {analysis && options.auto_msa_filter && (
          <div className="pl-12 text-xs">
            {analysis.msa_filter.removed.length === 0 ? (
              <span className="text-muted">{t("factor.suitability.removed_none")}</span>
            ) : (
              <div className="space-y-1.5">
                <div className="text-muted">
                  {t("factor.suitability.removed_heading", { n: analysis.msa_filter.removed.length })}
                </div>
                <ol className="flex flex-wrap gap-1.5">
                  {analysis.msa_filter.removed.map((r) => (
                    <li key={r.measure} className="rounded-md bg-bg/70 px-2 py-1">
                      <span className="text-muted font-mono mr-1">{r.step}.</span>
                      <span className="font-medium">{measureName(r.measure)}</span>{" "}
                      <span className="font-mono text-muted">{formatNumber(r.msa, locale, 2)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>

      <MsaTable
        dataset={dataset}
        analysis={analysis}
        options={options}
        onOptions={onOptions}
        measureName={measureName}
      />
    </div>
  );
}

function BartlettCard({ analysis, alpha }: { analysis: FactorAnalysis | null; alpha: number }) {
  const t = useT();
  const { locale } = useLocale();
  const b = analysis?.bartlett;
  return (
    <div className="rounded-lg bg-tile p-4 space-y-3">
      <HelpLabel
        label={t("factor.suitability.bartlett_title")}
        help={t("factor.help.bartlett")}
        extra={b && <PassBadge passed={b.passed} />}
      />
      <p className="text-xs text-muted">{t("factor.suitability.bartlett_explain", { alpha: b?.alpha ?? alpha })}</p>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <Value
          label={b?.regularised ? `χ² (${t("factor.suitability.regularised")})` : "χ²"}
          value={b ? formatNumber(b.chi_square, locale, 1) : NO_VALUE}
          title={b?.regularised ? t("factor.suitability.regularised_title") : undefined}
        />
        <Value label={t("factor.suitability.df")} value={b ? formatNumber(b.df, locale) : NO_VALUE} />
        <Value label="p" value={b ? formatPValue(b.p_value, locale) : NO_VALUE} />
      </dl>
    </div>
  );
}

function KmoCard({ analysis, threshold }: { analysis: FactorAnalysis | null; threshold: number }) {
  const t = useT();
  const { locale } = useLocale();
  const k = analysis?.kmo;
  const limit = k?.threshold ?? threshold;
  return (
    <div className="rounded-lg bg-tile p-4 space-y-3">
      <HelpLabel
        label={t("factor.suitability.kmo_title")}
        help={t("factor.help.kmo")}
        extra={k && <PassBadge passed={k.passed} />}
      />
      <p className="text-xs text-muted">{t("factor.suitability.kmo_explain", { threshold: limit })}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono tabular-nums">{k ? formatNumber(k.overall, locale, 2) : NO_VALUE}</span>
        {k && <span className="text-xs text-muted">{t(`factor.suitability.grade.${kmoGrade(k.overall)}`)}</span>}
      </div>
      <Scale value={k?.overall ?? null} threshold={limit} />
    </div>
  );
}

/** 0..1 bar with the threshold as a tick. */
function Scale({ value, threshold, compact }: { value: number | null; threshold: number; compact?: boolean }) {
  const pass = value !== null && value >= threshold;
  return (
    <div className={cn("relative rounded-full bg-bg/80", compact ? "h-1.5 w-20" : "h-2 w-full")} aria-hidden>
      {value !== null && (
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", pass ? "bg-success" : "bg-danger")}
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

function Value({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-md bg-bg/60 px-2.5 py-1.5 min-w-0" title={title}>
      <dt className="text-[10px] text-muted">{label}</dt>
      <dd className="font-mono tabular-nums text-sm truncate">{value}</dd>
    </div>
  );
}

function MsaTable({ dataset, analysis, options, onOptions, measureName }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const excluded = new Set(options.excluded);
  const removed = new Map((analysis?.msa_filter.removed ?? []).map((r) => [r.measure, r]));
  const included = dataset.measures.length - excluded.size;
  const threshold = analysis?.kmo.threshold ?? options.msa_threshold;

  const toggle = (m: string) => {
    const next = excluded.has(m) ? options.excluded.filter((x) => x !== m) : [...options.excluded, m];
    onOptions({ excluded: next });
  };
  // Tick the few measures to keep, then invert, instead of ticking all the others.
  const canInvert = options.excluded.length >= MIN_MEASURES;
  const invert = () => onOptions({ excluded: dataset.measures.filter((m) => !excluded.has(m)) });

  return (
    <div className="space-y-2">
      <HelpLabel label={t("factor.suitability.msa_heading")} help={t("factor.help.msa")} />
      <div className="rounded-md bg-tile/40 overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">{t("factor.suitability.msa_heading")}</caption>
          <thead className="bg-bg">
            <tr className="text-muted">
              <th scope="col" className="px-3 py-2 text-left font-medium border-b border-border">
                {t("factor.suitability.col_measure")}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium border-b border-border">
                MSA
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium border-b border-border">
                {t("factor.suitability.col_status")}
              </th>
              <th scope="col" className="px-3 py-2 text-center font-medium border-b border-border">
                {t("factor.suitability.col_exclude")}
              </th>
            </tr>
          </thead>
          <tbody>
            {dataset.measures.map((m, i) => {
              const isExcluded = excluded.has(m);
              const filtered = removed.get(m);
              const msa = analysis?.kmo.per_measure[m] ?? filtered?.msa ?? null;
              const locked = !isExcluded && included <= MIN_MEASURES;
              const id = `fa-exclude-${i}`;
              return (
                <tr key={m} className={cn("border-b border-border last:border-0", isExcluded && "text-muted")}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <label htmlFor={id} className="cursor-pointer">
                      {measureName(m)}
                    </label>
                  </th>
                  <td className="px-3 py-2">
                    {msa === null || isExcluded ? (
                      <span className="text-muted">{NO_VALUE}</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-mono tabular-nums w-10">{formatNumber(msa, locale, 2)}</span>
                        <Scale value={msa} threshold={threshold} compact />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {isExcluded ? (
                      t("factor.suitability.status_excluded")
                    ) : filtered ? (
                      <span className="text-warn-ink">{t("factor.suitability.status_removed", { step: filtered.step })}</span>
                    ) : analysis ? (
                      <span className="text-success-ink">{t("factor.suitability.status_used")}</span>
                    ) : (
                      <span className="text-muted">{NO_VALUE}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <label
                      title={locked ? t("factor.suitability.min_measures", { n: MIN_MEASURES }) : undefined}
                      className={cn(
                        // relative: the sr-only input stays inside the scrolling table instead of
                        // widening the page on a phone.
                        "relative inline-grid place-items-center h-6 w-6 rounded has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60",
                        locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-accent/[0.08]",
                      )}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        aria-label={t("factor.suitability.exclude_aria", { measure: measureName(m) })}
                        checked={isExcluded}
                        disabled={locked}
                        onChange={() => toggle(m)}
                        className="sr-only"
                      />
                      <ChoiceMark checked={isExcluded} />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {options.excluded.length > 0 && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted flex-wrap">
          <span>{t("factor.suitability.excluded_count", { n: options.excluded.length })}</span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={invert}
              disabled={!canInvert}
              title={canInvert ? t("factor.suitability.invert_title") : t("factor.suitability.min_measures", { n: MIN_MEASURES })}
              className="hover:text-fg transition disabled:opacity-40 disabled:pointer-events-none"
            >
              {t("factor.suitability.invert")}
            </button>
            <button type="button" onClick={() => onOptions({ excluded: [] })} className="hover:text-fg transition">
              {t("factor.suitability.include_all")}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
