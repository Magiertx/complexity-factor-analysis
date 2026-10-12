"use client";

import { Info, Minus, Plus, Sparkles } from "lucide-react";
import { ROTATIONS, type FactorAnalysis, type Rotation } from "@/lib/api";
import { ORTHOGONAL, analysisNotices, countText, isSolutionNotice, noticeText, type AnalysisOptions } from "@/lib/factor-analysis";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { Select } from "@/components/ui/select";
import { HelpLabel, NoticeList } from "./step-section";
import { ScreePlot } from "./scree-plot";

interface Props {
  analysis: FactorAnalysis;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
  /** The factor count the paper chose for the dataset, if it is a published one. */
  paperFactors: number | null;
}

type Criterion = "kaiser" | "parallel" | "paper";

export function FactorsView({ analysis, options, onOptions, paperFactors }: Props) {
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

  const counts = analysis.factor_count;
  const kaiser = counts?.kaiser ?? analysis.suggested_n_factors;
  const parallel = counts?.parallel_analysis ?? null;
  const criteria: { id: Criterion; k: number }[] = [
    { id: "kaiser", k: kaiser },
    ...(parallel !== null ? [{ id: "parallel" as const, k: parallel }] : []),
    ...(paperFactors !== null ? [{ id: "paper" as const, k: paperFactors }] : []),
  ];
  // Kaiser is the count the analysis follows on its own; an own count is shown as the criterion
  // that gives it, the paper's first when two give the same.
  const chosen: Criterion | null =
    options.n_factors === null
      ? "kaiser"
      : options.n_factors === paperFactors
        ? "paper"
        : options.n_factors === parallel
          ? "parallel"
          : null;
  const pick = (c: Criterion, k: number) => (c === "kaiser" ? onOptions({ n_factors: null }) : setCount(k));
  const disagree = new Set(criteria.map((c) => c.k)).size > 1;
  const helpParams = {
    percentile: counts?.percentile ?? 95,
    simulations: counts?.simulations ?? 100,
    // A string, so the seed is not grouped like a number ("20,261,012").
    seed: counts ? String(counts.seed) : "–",
  };

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
            random={counts?.eigenvalues_random}
            percentile={counts?.percentile}
            suggested={analysis.suggested_n_factors}
            largestSuggestion={Math.max(...criteria.map((c) => c.k))}
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
              {/* Its id is where the factor chip of the settings row leads. */}
              <output
                id="fa-factor-count"
                aria-live="polite"
                tabIndex={-1}
                className="h-9 min-w-[3.5rem] px-3 grid place-items-center rounded-md bg-tile font-mono text-lg font-semibold tabular-nums scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            {options.n_factors === null && (
              <div className="text-xs text-muted inline-flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-accent-ink" />
                {t("factor.factors.following_suggestion")}
              </div>
            )}
            {explained !== undefined && (
              <p className="text-xs">{countText(t, "factor.factors.explained", current, { pct: formatPercent(explained, locale) })}</p>
            )}
          </div>

          <div className="space-y-2">
            <HelpLabel label={t("factor.factors.criteria_label")} help={t("factor.help.criteria", helpParams)} />
            <div role="radiogroup" aria-label={t("factor.factors.criteria_label")} className="grid gap-1.5">
              {criteria.map((c) => {
                const on = chosen === c.id;
                const capped = c.k > max;
                return (
                  <label
                    key={c.id}
                    className={cn("flex items-center gap-2.5 rounded-md px-3 py-2", choiceTile(on))}
                    title={capped ? t("factor.factors.criterion_capped", { k: c.k, max }) : undefined}
                  >
                    <input
                      type="radio"
                      name="fa-criterion"
                      value={c.id}
                      className="sr-only"
                      checked={on}
                      onChange={() => pick(c.id, c.k)}
                      aria-describedby={`fa-criterion-${c.id}`}
                    />
                    <ChoiceMark type="radio" checked={on} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{t(`factor.factors.criterion.${c.id}`)}</span>
                      <span id={`fa-criterion-${c.id}`} className="block text-[11px] text-muted leading-snug">
                        {t(`factor.factors.criterion_detail.${c.id}`, helpParams)}
                      </span>
                    </span>
                    <span className="font-mono text-lg font-semibold tabular-nums" aria-hidden>
                      {c.k}
                    </span>
                    <span className="sr-only">{countText(t, "factor.factors.criterion_count", c.k)}</span>
                  </label>
                );
              })}
            </div>
            {disagree && (
              <p className="flex items-start gap-1.5 text-xs text-muted">
                <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
                <span>
                  {t(paperFactors !== null ? "factor.factors.criteria_differ_paper" : "factor.factors.criteria_differ")}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <HelpLabel label={t("factor.factors.rotation_label")} help={t("factor.help.rotation")} />
            <Select
              id="fa-rotation"
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
