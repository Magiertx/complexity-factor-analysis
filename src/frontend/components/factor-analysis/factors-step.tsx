"use client";

import { Minus, Plus, Sparkles } from "lucide-react";
import { ROTATIONS, type FactorAnalysis, type Rotation } from "@/lib/api";
import { ORTHOGONAL, analysisNotices, countText, isSolutionNotice, noticeText, type AnalysisOptions } from "@/lib/factor-analysis";
import { formatPercent } from "@/lib/format";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { Select } from "@/components/ui/select";
import { HelpLabel, NoticeList } from "./step-section";
import { ScreePlot } from "./scree-plot";

interface Props {
  analysis: FactorAnalysis;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
}

export function FactorsView({ analysis, options, onOptions }: Props) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const notes = analysisNotices(analysis)
    .filter(isSolutionNotice)
    .map((n) => noticeText(n, tMaybe));
  const max = Math.max(1, analysis.used_measures.length - 1);
  // The pending choice wins over the last result, so quick clicks add up before re-analysis.
  const current = Math.min(options.n_factors ?? analysis.n_factors, max);
  const setCount = (n: number) => onOptions({ n_factors: Math.max(1, Math.min(max, n)) });
  const explained = current === analysis.n_factors ? analysis.variance.explained : undefined;
  const rotationKind =
    options.rotation === "none" ? "none" : ORTHOGONAL.includes(options.rotation) ? "orthogonal" : "oblique";

  const stepButton =
    "h-9 w-9 grid place-items-center rounded-md bg-tile hover:bg-accent/[0.08] transition disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div className="space-y-6">
      <NoticeList heading={t("factor.factors.notes_heading")} notes={notes} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-2 min-w-0">
          <HelpLabel label={t("factor.factors.scree_title")} help={t("factor.help.scree")} />
          <ScreePlot
            eigenvalues={analysis.eigenvalues}
            suggested={analysis.suggested_n_factors}
            selected={current}
            maxSelectable={max}
            onSelect={setCount}
          />
          <p className="text-xs text-muted">{t("factor.factors.scree_hint")}</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <HelpLabel label={t("factor.factors.count_label")} help={t("factor.help.eigenvalue")} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={stepButton}
                onClick={() => setCount(current - 1)}
                disabled={current <= 1}
                aria-label={t("factor.factors.decrease")}
              >
                <Minus className="h-4 w-4" />
              </button>
              <output
                aria-live="polite"
                className="h-9 min-w-[3.5rem] px-3 grid place-items-center rounded-md bg-tile font-mono text-lg font-semibold tabular-nums"
              >
                {current}
              </output>
              <button
                type="button"
                className={stepButton}
                onClick={() => setCount(current + 1)}
                disabled={current >= max}
                aria-label={t("factor.factors.increase")}
              >
                <Plus className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted">{t("factor.factors.range", { max })}</span>
            </div>
            <div className="text-xs text-muted">
              {options.n_factors === null ? (
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-accent-ink" />
                  {t("factor.factors.following_suggestion")}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onOptions({ n_factors: null })}
                  className="text-accent-ink hover:underline"
                >
                  {t("factor.factors.use_suggestion", { n: analysis.suggested_n_factors })}
                </button>
              )}
            </div>
            {explained !== undefined && (
              <p className="text-xs">{countText(t, "factor.factors.explained", current, { pct: formatPercent(explained, locale) })}</p>
            )}
          </div>

          <div className="space-y-2">
            <HelpLabel label={t("factor.factors.rotation_label")} help={t("factor.help.rotation")} />
            <Select
              aria-label={t("factor.factors.rotation_label")}
              value={options.rotation}
              onValueChange={(v) => onOptions({ rotation: v as Rotation })}
              options={ROTATIONS.map((r) => ({ value: r, label: t(`factor.factors.rotation.${r}`) }))}
            />
            <p className="text-xs text-muted">{t(`factor.factors.rotation_hint.${rotationKind}`)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
