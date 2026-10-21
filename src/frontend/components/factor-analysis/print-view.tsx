"use client";

import { Children, Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, Printer } from "lucide-react";
import { parsePrintLink } from "@/lib/analysis-link";
import {
  analyzeDataset,
  exportFigure,
  fetchDataset,
  fetchFactorCatalog,
  interpretDataset,
  type FactorAnalysis,
  type FactorCatalog,
  type FactorDataset,
  type FactorInterpretation,
} from "@/lib/api";
import { APP_NAME } from "@/lib/app-config";
import {
  type AnalysisOptions,
  analysisNotices,
  assignedCells,
  countText,
  datasetName,
  defaultOptions,
  factorName,
  isSolutionNotice,
  type FactorNames,
  loadingCounts,
  loadingStyle,
  noticeText,
  orderMeasures,
  PRINT_HEATMAP_MAX_MEASURES,
  ruleStrict,
  settingsSummary,
  unassignedMeasures,
} from "@/lib/factor-analysis";
import { NO_VALUE, formatDateTime, formatNumber, formatPValue, formatPercent, formatStatistic } from "@/lib/format";
import { measurementRows, measurementTotals } from "@/lib/measurement";
import { codeIndexes, codesOf, measureLabels } from "@/lib/short-codes";
import { localizeCatalog, useLocale, useT, useTMaybe } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { MeasureName, MeasureScope } from "@/components/ui/table";

interface Loaded {
  catalog: FactorCatalog;
  dataset: FactorDataset;
  analysis: FactorAnalysis;
  figures: { scree: string | null; loadings: string | null };
  interpretation: FactorInterpretation | null;
}

/**
 * The whole analysis on one page to print or save as PDF: the dataset with its statistics, the
 * suitability, the factor count with the scree plot, the loadings heatmap with the dimensions,
 * and a stored interpretation. Light on screen and on paper whatever the theme, A4, without any
 * control. It runs the analysis of its address itself, without replacing the one of the tab it
 * was opened from.
 */
export function PrintView() {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const params = useSearchParams();
  const link = useMemo(() => parsePrintLink(new URLSearchParams(params.toString()), defaultOptions), [params]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    const ctrl = new AbortController();
    const urls: string[] = [];
    const figure = async (name: "scree" | "loadings") => {
      try {
        // With the names of the factors, as the heatmap of the tab draws them.
        const options = { ...link.options, factor_names: link.names.length > 0 ? link.names : null };
        const { blob } = await exportFigure(link.datasetId, options, name, "svg", { shortCodes: link.view.codes, order: link.view.order, language: locale }, ctrl.signal);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return url;
      } catch {
        // Without the figure the page still has every number.
        return null;
      }
    };
    (async () => {
      try {
        const [catalog, dataset, analysis] = await Promise.all([
          fetchFactorCatalog(link.kind, ctrl.signal),
          fetchDataset(link.datasetId, ctrl.signal, 0),
          analyzeDataset(link.datasetId, link.options, ctrl.signal, { latestWins: false }),
        ]);
        const [scree, loadings, interpretation] = await Promise.all([
          figure("scree"),
          analysis.used_measures.length <= PRINT_HEATMAP_MAX_MEASURES ? figure("loadings") : Promise.resolve(null),
          interpretDataset(link.datasetId, { ...link.options, n_factors: analysis.n_factors }, locale, {
            cachedOnly: true,
            signal: ctrl.signal,
          }).catch(() => null),
        ]);
        if (!ctrl.signal.aborted) setLoaded({ catalog, dataset, analysis, figures: { scree, loadings }, interpretation });
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      ctrl.abort();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [link, locale]);

  useEffect(() => {
    if (!loaded) return;
    const name = datasetName(loaded.dataset, t, localizeCatalog(loaded.catalog, locale));
    document.title = `${t("print.title", { name })} · ${APP_NAME}`;
  }, [loaded, t, locale]);

  if (!link) {
    return <Notice tone="error">{t("print.invalid")}</Notice>;
  }
  if (error) {
    return <Notice tone="error">{t("print.failed", { error })}</Notice>;
  }
  if (!loaded) {
    return (
      <Notice tone="busy">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("print.loading")}
      </Notice>
    );
  }

  const { dataset, analysis, figures, interpretation } = loaded;
  const catalog = localizeCatalog(loaded.catalog, locale);
  const names = new Map(catalog.measures.map((m) => [m.key, m.name]));
  const descriptions = new Map(catalog.measures.map((m) => [m.key, m.description || undefined]));
  const labels = measureLabels(names, descriptions, codesOf(catalog.measures), link.view.codes);
  const name = (m: string) => labels.name(m);
  const standard = defaultOptions(link.kind);
  const chips = settingsSummary(link.options, standard, analysis, dataset.measures.length, t);
  const removed = new Map(analysis.msa_filter.removed.map((r) => [r.measure, r]));
  const excluded = new Set(link.options.excluded);
  const counts = analysis.factor_count;
  const notices = analysisNotices(analysis);
  const notes = notices.filter((n) => !isSolutionNotice(n)).map((n) => noticeText(n, tMaybe, name));
  const solutionNotes = notices.filter(isSolutionNotice).map((n) => noticeText(n, tMaybe, name));
  const indexes = codeIndexes(link.kind, codesOf(catalog.measures), link.view.codes);
  const codesUsed = link.view.codes ? dataset.measures.filter((m) => labels.name(m) !== (names.get(m) ?? m)) : [];

  return (
    <MeasureScope indexes={indexes} className="space-y-4">
      <div className="print:hidden flex items-center justify-between gap-3 flex-wrap max-w-[210mm] mx-auto">
        <p className="text-sm text-muted">{t("print.hint")}</p>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden />
          {t("print.print")}
        </Button>
      </div>

      <article className="light-sheet print-sheet mx-auto max-w-[210mm] bg-surface text-fg rounded-md shadow-sm ring-1 ring-border/60 px-4 py-5 sm:px-[14mm] sm:py-[12mm] print:max-w-none print:rounded-none print:shadow-none print:ring-0 print:p-0 text-[13px] leading-relaxed">
        <header className="space-y-1 border-b border-border pb-3">
          <p className="text-xs text-muted">
            {t(`factor.${link.kind}.title`)} · {formatDateTime(new Date(), locale)} · {APP_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">{t("print.title", { name: datasetName(dataset, t, catalog) })}</h1>
          <p className="text-xs text-muted">{chips.map((c) => c.text).join(" · ")}</p>
        </header>

        <Section title={t("factor.steps.dataset")}>
          <p>
            {t("print.dataset_size", {
              n: formatNumber(dataset.n_observations, locale),
              p: formatNumber(dataset.measures.length, locale),
            })}
            {dataset.dropped.length > 0 &&
              ` ${t("print.dropped", {
                list: dataset.dropped.map((d) => `${name(d.measure)} (${t(`factor.dataset.reason.${d.reason}`)})`).join(", "),
              })}`}
          </p>
          {dataset.descriptives && (
            <>
              <h3 className="mt-3 font-semibold text-sm">{t("factor.dataset.descriptives_heading")}</h3>
              <Wide>
              <table className="data-table print-table">
                <thead>
                  <tr>
                    <th scope="col">{t("factor.suitability.col_measure")}</th>
                    <th scope="col" className="num">n</th>
                    <th scope="col" className="num">{t("factor.dataset.col_mean")}</th>
                    <th scope="col" className="num">{t("factor.dataset.col_median")}</th>
                    <th scope="col" className="num">{t("factor.dataset.col_sd")}</th>
                    <th scope="col" className="num">{t("factor.dataset.col_min")}</th>
                    <th scope="col" className="num">{t("factor.dataset.col_max")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.descriptives.measures.map((row) => (
                    <tr key={row.measure} className={row.dropped ? "text-muted" : undefined}>
                      <th scope="row" className="font-medium"><MeasureName name={name(row.measure)} /></th>
                      <td className="num">{formatNumber(row.n, locale)}</td>
                      {[row.mean, row.median, row.std, row.min, row.max].map((v, i) => (
                        <td key={i} className="num">
                          {v === null ? NO_VALUE : formatStatistic(v, locale)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </Wide>
            </>
          )}
          {dataset.measurement && <MeasurementSummary dataset={dataset} />}
        </Section>

        <Section title={t("factor.steps.suitability")}>
          <p>
            {t("print.bartlett", {
              chi: formatNumber(analysis.bartlett.chi_square, locale, 2),
              df: analysis.bartlett.df,
              p: pText(formatPValue(analysis.bartlett.p_value, locale)),
              result: t(analysis.bartlett.passed ? "factor.suitability.passed" : "factor.suitability.failed"),
            })}{" "}
            {t("print.kmo", {
              value: formatNumber(analysis.kmo.overall, locale, 3),
              result: t(analysis.kmo.passed ? "factor.suitability.passed" : "factor.suitability.failed"),
            })}
          </p>
          {notes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <h3 className="mt-3 font-semibold text-sm">{t("factor.suitability.msa_heading")}</h3>
          <Wide>
              <table className="data-table print-table">
            <thead>
              <tr>
                <th scope="col">{t("factor.suitability.col_measure")}</th>
                <th scope="col" className="num">MSA</th>
                <th scope="col">{t("factor.suitability.col_status")}</th>
              </tr>
            </thead>
            <tbody>
              {dataset.measures.map((m) => {
                const r = removed.get(m);
                const msa = analysis.kmo.per_measure[m] ?? r?.msa;
                return (
                  <tr key={m} className={excluded.has(m) || r ? "text-muted" : undefined}>
                    <th scope="row" className="font-medium"><MeasureName name={name(m)} /></th>
                    <td className="num">{msa === undefined || excluded.has(m) ? NO_VALUE : formatNumber(msa, locale, 3)}</td>
                    <td>
                      {excluded.has(m)
                        ? t("factor.suitability.status_excluded")
                        : r
                          ? t("factor.suitability.status_removed", { step: r.step })
                          : t("factor.suitability.status_used")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
              </Wide>
        </Section>

        <Section title={t("factor.steps.factors")}>
          <p>
            {countText(t, "print.factors", analysis.n_factors, {
              rotation: t(`factor.factors.rotation.${analysis.rotation}`),
              pct: formatPercent(analysis.variance.explained, locale),
            })}{" "}
            {counts &&
              t("print.criteria", { kaiser: counts.kaiser, parallel: counts.parallel_analysis, percentile: counts.percentile, seed: String(counts.seed) })}
          </p>
          {solutionNotes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted">
              {solutionNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {figures.scree && (
            <img src={figures.scree} alt={t("factor.factors.scree_title")} className="print-figure mt-2 max-w-full h-auto" />
          )}
        </Section>

        <Section title={t("factor.steps.loadings")}>
          {figures.loadings ? (
            <img src={figures.loadings} alt={t("factor.figure.loadings")} className="print-figure max-w-full h-auto" />
          ) : (
            <LoadingsKey analysis={analysis} options={link.options} />
          )}
          {!figures.loadings && (
            <LoadingsTable analysis={analysis} options={link.options} order={link.view.order} name={name} names={link.names} />
          )}
          <h3 className="mt-3 font-semibold text-sm">{t("factor.loadings.groups_heading")}</h3>
          <p className="text-xs text-muted">{t(`factor.loadings.rule.${analysis.assignment_rule ?? "largest"}.title`)}</p>
          <Wide>
              <table className="data-table print-table">
            <tbody>
              {analysis.factors.map((f) => (
                <tr key={f.index}>
                  <th scope="row" className="font-medium whitespace-nowrap align-top">
                    {t("factor.loadings.factor_n", { i: f.index + 1 })}
                    {/* The name given to the factor; an interpretation's suggestions are in its own section. */}
                    {factorName(link.names, f.index) && (
                      <span className="block text-xs font-normal">{factorName(link.names, f.index)}</span>
                    )}
                  </th>
                  <td>
                    {f.measures.length === 0
                      ? t("factor.loadings.factor_empty")
                      : f.measures.map((m, i) => (
                          <Fragment key={m.measure}>
                            {i > 0 && ", "}
                            <MeasureName name={name(m.measure)} /> ({formatNumber(m.loading, locale, 2)})
                          </Fragment>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
              </Wide>
          {unassignedMeasures(analysis).length > 0 && (
            <p className="mt-2 text-xs">
              <span className="font-medium">{t("factor.loadings.unassigned_heading")}:</span>{" "}
              {unassignedMeasures(analysis).map((u, i) => (
                <Fragment key={u.measure}>
                  {i > 0 && ", "}
                  <MeasureName name={name(u.measure)} />
                </Fragment>
              ))}
            </p>
          )}
          {analysis.factor_correlations && (
            <>
              <h3 className="mt-3 font-semibold text-sm">{t("factor.loadings.correlations_heading")}</h3>
              <Wide>
              <table className="data-table print-table w-auto">
                <thead>
                  <tr>
                    <td />
                    {analysis.factor_correlations.map((_, j) => (
                      <th key={j} scope="col" className="num">F{j + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysis.factor_correlations.map((row, i) => (
                    <tr key={i}>
                      <th scope="row">
                        F{i + 1}
                        {factorName(link.names, i) && <span className="ml-1.5 font-normal">{factorName(link.names, i)}</span>}
                      </th>
                      {row.map((v, j) => (
                        <td key={j} className="num">{formatNumber(v, locale, 2)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </Wide>
            </>
          )}
        </Section>

        {interpretation && (
          <Section title={t("factor.steps.interpretation")}>
            <ul className="space-y-1.5">
              {interpretation.factors.map((f) => (
                <li key={f.index}>
                  <span className="font-medium">
                    {t("factor.loadings.factor_n", { i: f.index })}: {f.name}
                  </span>{" "}
                  <span className="text-muted">{f.summary}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted">{t("print.interpretation_note", { model: interpretation.model })}</p>
          </Section>
        )}

        {codesUsed.length > 0 && (
          <Section title={t("print.codes_heading")}>
            <p className="text-xs">
              {codesUsed.map((m, i) => (
                <Fragment key={m}>
                  {i > 0 && " · "}
                  <MeasureName name={labels.name(m)} />: {names.get(m) ?? m}
                </Fragment>
              ))}
            </p>
          </Section>
        )}

        <footer className="print-footer mt-6 border-t border-border pt-2 text-[11px] text-muted">
          {analysis.published_match
            ? t(analysis.published_match.status === "match" ? "print.match" : "print.differs", {
                source: analysis.published_match.source,
                n: analysis.published_match.differences.length,
              })
            : null}{" "}
          {t("print.footer", { app: APP_NAME })}
        </footer>
      </article>
    </MeasureScope>
  );
}

/** A p-value with its relation: "= 0.023", or "< 0.001" as formatPValue writes the smallest. */
function pText(value: string): string {
  return value.startsWith("<") ? value : `= ${value}`;
}

/** A section whose heading stays with its first block, so that a heading never ends a page. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [first, ...rest] = Children.toArray(children);
  return (
    <section className="mt-5 print-section">
      <div className="print-keep">
        <h2 className="text-base font-semibold tracking-tight mb-1.5">{title}</h2>
        {first}
      </div>
      {rest}
    </section>
  );
}

/** What the shades of the loadings table mean, as the legend of the loadings step says it. */
function LoadingsKey({ analysis, options }: { analysis: FactorAnalysis; options: AnalysisOptions }) {
  const t = useT();
  const { locale } = useLocale();
  const strict = ruleStrict(options.assignment_rule);
  const value = formatNumber(options.loading_threshold, locale, 2);
  return (
    <p className="flex items-center gap-x-4 gap-y-1 text-[11px] text-muted flex-wrap">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={loadingStyle(-0.9)} />
        {t("factor.loadings.legend_negative")}
      </span>
      <span>{t(strict ? "factor.loadings.legend_faded_strict" : "factor.loadings.legend_faded", { threshold: value })}</span>
      <span>
        {(analysis.assignment_rule ?? "largest") !== "largest"
          ? t("factor.loadings.legend_bold_assigned")
          : t(strict ? "factor.loadings.legend_bold_strict" : "factor.loadings.legend_bold", { threshold: value })}
      </span>
    </p>
  );
}

/**
 * The loadings as a table, for the datasets that have more measures than the heatmap holds on a
 * page: colour as in the loadings step (orange for a negative sign, a shade of the text colour for
 * a positive one, the loadings that do not count faded, the assigned ones bold), the header on
 * every page.
 */
function LoadingsTable({
  analysis,
  options,
  order,
  name,
  names,
}: {
  analysis: FactorAnalysis;
  options: AnalysisOptions;
  order: "factor" | "dataset";
  name: (key: string) => string;
  /** The names of the factors. */
  names: FactorNames;
}) {
  const t = useT();
  const { locale } = useLocale();
  const k = analysis.n_factors;
  const threshold = options.loading_threshold;
  const strict = ruleStrict(options.assignment_rule);
  // As in the loadings step: under "multi" and "hair" the cells the rule assigned are bold, under
  // "largest" every loading that counts.
  const assigned = (analysis.assignment_rule ?? "largest") !== "largest" ? assignedCells(analysis) : null;
  return (
    <>
      <Wide>
        <table className="data-table print-table">
          <caption className="sr-only">{t("factor.loadings.table_heading")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("factor.loadings.col_measure")}</th>
              {Array.from({ length: k }, (_, i) => (
                <th key={i} scope="col" className="num">
                  F{i + 1}
                  {factorName(names, i) && <span className="block text-[10px] font-normal">{factorName(names, i)}</span>}
                </th>
              ))}
              <th scope="col" className="num border-l border-border">h²</th>
            </tr>
          </thead>
          <tbody>
            {orderMeasures(analysis, order === "dataset" ? "original" : "factor").map((m) => (
              <tr key={m}>
                <th scope="row" className="font-medium"><MeasureName name={name(m)} /></th>
                {(analysis.loadings[m] ?? []).map((v, i) => {
                  const strong = assigned ? assigned.has(`${m}:${i}`) : loadingCounts(v, threshold, strict);
                  const counts = strong || loadingCounts(v, threshold, strict);
                  return (
                    <td
                      key={i}
                      style={counts ? loadingStyle(v) : undefined}
                      className={strong ? "num font-bold text-fg" : counts ? "num text-fg/80" : "num text-muted"}
                    >
                      {formatNumber(v, locale, 2)}
                    </td>
                  );
                })}
                <td className="num border-l border-border">{formatNumber(analysis.communalities[m] ?? Number.NaN, locale, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Wide>
    </>
  );
}

function MeasurementSummary({ dataset }: { dataset: FactorDataset }) {
  const t = useT();
  const { locale } = useLocale();
  const m = dataset.measurement!;
  const totals = measurementTotals(m);
  const rows = measurementRows(m);
  const s = (v: number | undefined) => (v === undefined ? NO_VALUE : formatNumber(v, locale, v < 0.1 ? 3 : 2));
  return (
    <>
      <h3 className="mt-3 font-semibold text-sm">{t("factor.dataset.measurement_heading")}</h3>
      <Wide>
              <table className="data-table print-table">
        <thead>
          <tr>
            <th scope="col">{t("factor.dataset.observation")}</th>
            <th scope="col" className="num">{t("factor.dataset.col_events")}</th>
            <th scope="col" className="num">{t("factor.dataset.col_read_s")}</th>
            <th scope="col" className="num">{t("factor.dataset.col_discovery_s")}</th>
            <th scope="col" className="num">{t(m.kind === "log" ? "factor.dataset.col_features_s" : "factor.dataset.col_measures_s")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.observation}>
              <th scope="row" className="font-normal">{r.observation}</th>
              <td className="num">{r.events === undefined ? NO_VALUE : formatNumber(r.events, locale)}</td>
              <td className="num">{s(r.read_s)}</td>
              <td className="num">{s(r.discovery_s)}</td>
              <td className="num">{s(r.compute_s)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>{t("factor.dataset.measurement_sum")}</th>
            <td className="num">{s(totals.read_s)}</td>
            <td className="num">{s(totals.discovery_s)}</td>
            <td className="num">{s(totals.compute_s)}</td>
          </tr>
        </tfoot>
      </table>
              </Wide>
    </>
  );
}

function Notice({ tone, children }: { tone: "error" | "busy"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="mx-auto max-w-[210mm] rounded-lg bg-tile px-3.5 py-3 flex items-center gap-2.5 text-sm"
    >
      {tone === "error" && <AlertCircle className="h-4 w-4 text-danger-ink shrink-0" aria-hidden />}
      {children}
    </div>
  );
}

/** A table that scrolls sideways in the sheet on a narrow screen; on paper it is the table alone. */
function Wide({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto print:overflow-visible">{children}</div>;
}
