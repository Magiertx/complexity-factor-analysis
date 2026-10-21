"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Grid3x3, Info, LayoutGrid, Loader2, RotateCcw } from "lucide-react";
import {
  HttpError,
  compareAnalyses,
  exportComparison,
  fetchFactorCatalog,
  type BundledDataset,
  type CompareCell,
  type CompareColumn,
  type CompareExportFormat,
  type Comparison,
  type FactorCatalog,
} from "@/lib/api";
import {
  MAX_COLUMNS,
  MIN_COLUMNS,
  TABLE_17_STATE,
  cellInRow,
  compareQuery,
  compareRequest,
  dimensionLabel,
  groupRows,
  parseCompareQuery,
  sameState,
  toggleColumn,
  type CompareState,
} from "@/lib/compare";
import { countText, downloadBlob, noticeText } from "@/lib/factor-analysis";
import { formatNumber, formatPercent } from "@/lib/format";
import { datasetNote, orderCollection, ruleNote } from "@/lib/paper-notes";
import { codesOf, hasCodes, loadShortCodes, measureLabels, saveShortCodes } from "@/lib/short-codes";
import { cn } from "@/lib/utils";
import { localizeCatalog, useLocale, useT, useTMaybe } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { Segmented } from "@/components/ui/segmented";
import { MeasureName, TableFrame } from "@/components/ui/table";
import { Term, useTip, useTipZone } from "@/components/ui/tip";
import { AssignmentChoice } from "./loadings-step";
import { FieldLabel, HelpLabel } from "./step-section";
import { CompareToolbar } from "./toolbar";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The collection whose datasets the page compares: the miners of Important Factors. */
const COLLECTION = "comfy-paper";
const LOOK_KEY = "app.compare-look";
/** Changes in quick succession (several tiles) are compared once. */
const COMPARE_DEBOUNCE_MS = 150;

type Look = "matrix" | "dimensions";

function useLook(): [Look, (look: Look) => void] {
  const [look, setLook] = useState<Look>("matrix");
  useEffect(() => {
    try {
      if (localStorage.getItem(LOOK_KEY) === "dimensions") setLook("dimensions");
    } catch {
      /* storage blocked */
    }
  }, []);
  const update = (next: Look) => {
    setLook(next);
    try {
      localStorage.setItem(LOOK_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for the page */
    }
  };
  return [look, update];
}

/** The text of an error the server names, in the language of the UI. */
function errorText(e: unknown, tMaybe: (key: string, params?: Record<string, string | number>) => string | undefined, fallback: string) {
  if (e instanceof HttpError) {
    return (
      (e.code && (tMaybe(`compare.errors.${e.code}`, e.params) ?? tMaybe(`errors.${e.code}`, e.params))) ||
      e.message ||
      fallback
    );
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The factor structures of several bundled datasets side by side ("Compare miners"), like Tab. 17
 * of Important Factors: which measures form which dimension for which miner. The columns, the
 * rule and nothing else are in the address, so a link opens the same comparison.
 */
export function CompareView() {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const router = useRouter();
  const search = useSearchParams();

  const [rawCatalog, setRawCatalog] = useState<FactorCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setCatalogError(null);
    fetchFactorCatalog("model", ac.signal)
      .then(setRawCatalog)
      .catch((e) => {
        if (!ac.signal.aborted) setCatalogError(errorText(e, tMaybe, t("compare.errors.catalog")));
      });
    return () => ac.abort();
    // Texts are read once per attempt; a language switch does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogAttempt]);
  const catalog = useMemo(() => rawCatalog && localizeCatalog(rawCatalog, locale), [rawCatalog, locale]);
  const datasets = useMemo(() => (catalog ? orderCollection(COLLECTION, catalog.bundled) : []), [catalog]);
  const byId = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets]);
  const order = useMemo(() => datasets.map((d) => d.id), [datasets]);

  // The address is the state: the columns and the rule.
  const known = useMemo(() => (catalog ? new Set(catalog.bundled.map((b) => b.id)) : null), [catalog]);
  const query = search.toString();
  const { state, invalid } = useMemo(() => parseCompareQuery(new URLSearchParams(query), known), [query, known]);
  const stateKey = compareQuery(state);
  const setState = useCallback(
    (next: CompareState) => router.replace(`/compare?${compareQuery(next)}`, { scroll: false }),
    [router],
  );

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparedKey, setComparedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!catalog) return;
    const ac = new AbortController();
    setError(null);
    const timer = setTimeout(() => {
      const asked = parseCompareQuery(new URLSearchParams(stateKey), null).state;
      compareAnalyses(compareRequest(asked), ac.signal)
        .then((result) => {
          setComparison(result);
          setComparedKey(stateKey);
        })
        .catch((e) => {
          if (!ac.signal.aborted) setError(errorText(e, tMaybe, t("compare.errors.failed")));
        });
    }, COMPARE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, catalog, attempt]);
  // What is on screen is of another selection than the tiles show, whether the update is under
  // way or failed: it is dimmed, and what is downloaded would be the new selection, not this table.
  const outdated = comparedKey !== stateKey;
  const computing = !!catalog && !error && outdated;

  // Names of the measures, or the short codes of the papers; the full name stays in the tooltip.
  const names = useMemo(() => new Map((catalog?.measures ?? []).map((m) => [m.key, m.name])), [catalog]);
  const descriptions = useMemo(
    () => new Map((catalog?.measures ?? []).map((m) => [m.key, m.description || undefined])),
    [catalog],
  );
  const codes = useMemo(() => codesOf(catalog?.measures ?? []), [catalog]);
  const [codesOn, setCodesOn] = useState(false);
  useEffect(() => setCodesOn(loadShortCodes()), []);
  const codesAvailable = !!comparison && hasCodes(codes, comparison.measures.map((m) => m.measure));
  const codesShown = codesOn && codesAvailable;
  const labels = useMemo(() => measureLabels(names, descriptions, codes, codesShown), [names, descriptions, codes, codesShown]);

  const [look, setLook] = useLook();
  const [exporting, setExporting] = useState<CompareExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const onExport = async (format: CompareExportFormat) => {
    setExporting(format);
    setExportError(null);
    try {
      const { blob, filename } = await exportComparison(compareRequest(state), format, codesShown);
      downloadBlob(blob, filename);
    } catch (e) {
      setExportError(errorText(e, tMaybe, t("compare.errors.export")));
    } finally {
      setExporting(null);
    }
  };

  const columnLabel = useCallback(
    (column: CompareColumn) => byId.get(column.bundled_id)?.label ?? column.label,
    [byId],
  );

  const exportReason = !comparison
    ? t("compare.wait")
    : computing
      ? t("compare.wait_update")
      : outdated
        ? t("compare.stale")
        : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("compare.title")}
        subtitle={t("compare.subtitle")}
        back={{ href: "/", label: t("mode_bar.model_label") }}
        actions={
          <CompareToolbar
            linkQuery={stateKey}
            exportReason={exportReason}
            exporting={exporting}
            onExport={onExport}
            shortCodes={{
              on: codesShown,
              reason: codesAvailable ? null : t("factor.toolbar.codes_none"),
              onToggle: () => {
                const next = !codesOn;
                setCodesOn(next);
                saveShortCodes(next);
              },
            }}
          />
        }
      />

      {catalogError && (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger-ink">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{catalogError}</span>
          <button type="button" className="underline" onClick={() => setCatalogAttempt((n) => n + 1)}>
            {t("common.try_again")}
          </button>
        </p>
      )}
      {invalid && catalog && (
        <p className="flex items-start gap-1.5 text-xs text-muted max-w-prose">
          <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
          <span>{t("compare.link_invalid", { min: MIN_COLUMNS, max: MAX_COLUMNS })}</span>
        </p>
      )}

      <ColumnChooser datasets={datasets} state={state} order={order} onState={setState} />

      <AssignmentChoice id="cmp-rule" value={state.rule} onChange={(rule) => setState({ ...state, rule })} note={null} />

      <section aria-labelledby="cmp-result" aria-busy={computing} className="space-y-3">
        <div className="flex items-end justify-between gap-x-6 gap-y-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 id="cmp-result" className="text-sm font-semibold">
              <Term more={t("compare.help.result")}>{t("compare.result")}</Term>
            </h2>
            {computing && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t("compare.computing")}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            <FieldLabel id="cmp-look-label">{t("factor.loadings.look_label")}</FieldLabel>
            <Segmented<Look>
              size="sm"
              aria-labelledby="cmp-look-label"
              value={look}
              onChange={setLook}
              options={[
                {
                  value: "matrix",
                  label: (
                    <>
                      <Grid3x3 className="h-3.5 w-3.5" aria-hidden />
                      {t("compare.look.matrix")}
                    </>
                  ),
                },
                {
                  value: "dimensions",
                  label: (
                    <>
                      <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                      {t("compare.look.dimensions")}
                    </>
                  ),
                },
              ]}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="flex items-center gap-2 text-sm text-danger-ink">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
            <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
              {t("common.try_again")}
            </button>
          </p>
        )}
        {exportError && (
          <p role="alert" className="text-sm text-danger-ink">
            {exportError}
          </p>
        )}
        {!comparison && !error && !catalogError && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("compare.computing")}
          </p>
        )}

        {comparison && (
          <div className={cn("space-y-3 transition-opacity motion-reduce:transition-none", outdated && "opacity-60")}>
            {look === "matrix" ? (
              <MembershipMatrix comparison={comparison} labels={labels} columnLabel={columnLabel} />
            ) : (
              <DimensionTable comparison={comparison} labels={labels} columnLabel={columnLabel} />
            )}
            <ColumnNotes comparison={comparison} columnLabel={columnLabel} measureName={labels.name} />
            <p className="text-[11px] text-muted max-w-prose">{t("compare.alignment_note")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

interface Labels {
  name: (key: string) => string;
  description: (key: string) => string | undefined;
}

/** The bundled datasets as tiles to switch on and off, Tab. 17's first, and a way back to it. */
function ColumnChooser({
  datasets,
  state,
  order,
  onState,
}: {
  datasets: BundledDataset[];
  state: CompareState;
  order: string[];
  onState: (state: CompareState) => void;
}) {
  const t = useT();
  const chosen = new Set(state.columns);
  return (
    <section className="space-y-2" aria-labelledby="cmp-columns-label">
      <div className="flex items-center justify-between gap-x-4 gap-y-1 flex-wrap">
        <span id="cmp-columns-label">
          <HelpLabel as="span" label={t("compare.columns.label")} help={t("compare.help.columns", { min: MIN_COLUMNS, max: MAX_COLUMNS })} />
        </span>
        {!sameState(state, TABLE_17_STATE) && (
          <button
            type="button"
            onClick={() => onState(TABLE_17_STATE)}
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t("compare.columns.reset")}
          </button>
        )}
      </div>
      <div role="group" aria-labelledby="cmp-columns-label" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {datasets.map((d) => {
          const on = chosen.has(d.id);
          const reason =
            on && state.columns.length <= MIN_COLUMNS
              ? t("compare.columns.min", { min: MIN_COLUMNS })
              : !on && state.columns.length >= MAX_COLUMNS
                ? t("compare.columns.max", { max: MAX_COLUMNS })
                : null;
          const note = datasetNote(d.id, t) ?? d.published_source ?? null;
          return (
            <ColumnTile
              key={d.id}
              dataset={d}
              on={on}
              note={note}
              reason={reason}
              onToggle={() => onState({ ...state, columns: toggleColumn(state.columns, d.id, order) })}
            />
          );
        })}
      </div>
    </section>
  );
}

/** A dataset to compare, as a tile to switch on and off; blocked with its `reason`. */
function ColumnTile({
  dataset,
  on,
  note,
  reason,
  onToggle,
}: {
  dataset: BundledDataset;
  on: boolean;
  note: string | null;
  reason: string | null;
  onToggle: () => void;
}) {
  const tip = useTip<HTMLLabelElement>(reason ? { reason } : null);
  const id = `cmp-col-${dataset.id}`;
  return (
    <label ref={tip} className={cn("flex items-start gap-2.5 rounded-md px-3 py-2.5 min-w-0", choiceTile(on), reason && "cursor-default")}>
      <input
        type="checkbox"
        className="sr-only"
        checked={on}
        aria-label={dataset.label ?? dataset.name}
        aria-disabled={reason ? true : undefined}
        aria-describedby={note ? id : undefined}
        onChange={() => {
          if (!reason) onToggle();
        }}
      />
      <ChoiceMark checked={on} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{dataset.label ?? dataset.name}</span>
        {note && (
          <span id={id} className="block text-[11px] text-muted leading-snug">
            {note}
          </span>
        )}
      </span>
    </label>
  );
}

/** A number of a column's header, or a dash for a column that failed. */
function statOf(column: CompareColumn, value: (c: CompareColumn) => string | null): string {
  return column.error ? "–" : (value(column) ?? "–");
}

/** The rows of the header of every column: what was analysed and how. */
function headerRows(t: Translate, locale: string) {
  return [
    {
      id: "n",
      label: t("compare.header.n"),
      help: t("compare.help.n"),
      value: (c: CompareColumn) => (c.n_observations === undefined ? null : formatNumber(c.n_observations, locale)),
    },
    {
      id: "measures",
      label: t("compare.header.measures"),
      help: t("compare.help.measures"),
      value: (c: CompareColumn) =>
        c.used_measures ? t("compare.header.measures_value", { used: c.used_measures.length, total: c.n_measures }) : null,
    },
    {
      id: "kmo",
      label: "KMO",
      help: t("compare.help.kmo"),
      value: (c: CompareColumn) => (c.kmo === undefined ? null : formatNumber(c.kmo, locale, 2)),
    },
    {
      id: "k",
      label: t("compare.header.factors"),
      help: t("compare.help.factors"),
      value: (c: CompareColumn) => (c.n_factors === undefined ? null : String(c.n_factors)),
    },
    {
      id: "rotation",
      label: t("compare.header.rotation"),
      help: t("factor.help.rotation"),
      value: (c: CompareColumn) => (c.rotation ? t(`factor.factors.rotation.${c.rotation}`) : null),
    },
    {
      id: "variance",
      label: t("compare.header.variance"),
      help: t("compare.help.variance"),
      value: (c: CompareColumn) =>
        c.cumulative_variance !== undefined && c.cumulative_variance !== null
          ? formatPercent(c.cumulative_variance, locale, 0)
          : c.explained_variance !== undefined
            ? formatPercent(c.explained_variance, locale, 0)
            : null,
    },
  ];
}

/**
 * Measures by columns: the dimension each column puts a measure in, the rows grouped by the
 * dimension most columns agree on. A cell in its row's dimension is tinted, a cross-loading is
 * ringed as in the loadings, a measure the MSA filter removed has a dashed outline, and one the
 * rule leaves out says why, faded. The one rule is in the tiles above and in the caption, not in
 * every column.
 */
function MembershipMatrix({
  comparison,
  labels,
  columnLabel,
}: {
  comparison: Comparison;
  labels: Labels;
  columnLabel: (column: CompareColumn) => string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const zone = useTipZone<HTMLTableElement>();
  const { columns } = comparison;
  const groups = groupRows(comparison.measures);
  const span = columns.length + 1;
  const rows = headerRows(t, locale);
  const crossLabel = t("factor.loadings.cross_cell");
  return (
    <div className="space-y-2">
      <MatrixLegend />
      <TableFrame label={t("compare.matrix_label")}>
        <table ref={zone} className="data-table">
          <caption className="sr-only">
            {t("compare.matrix_caption", {
              rule: t(`factor.loadings.rule.${comparison.assignment_rule}.title`),
              columns: columns.map(columnLabel).join(", "),
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky-col">
                {t("factor.loadings.col_measure")}
              </th>
              {columns.map((c, i) => (
                <th key={`${c.bundled_id}-${i}`} scope="col" className="min-w-[6.5rem] !whitespace-normal align-bottom !h-auto py-2">
                  <span className="flex items-start gap-1">
                    <span className="text-fg">{columnLabel(c)}</span>
                    {/* A column that could not be analysed; what only deserves a note is in the notes below. */}
                    {c.error && (
                      <AlertTriangle role="img" className="h-3.5 w-3.5 mt-px shrink-0 text-warn-ink" aria-label={t("compare.tip.failed")} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="table-group">
              <th scope="rowgroup" colSpan={span} className="sticky-col">
                {t("compare.header.group")}
              </th>
            </tr>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="sticky-col font-medium">
                  <Term more={row.help}>{row.label}</Term>
                </th>
                {columns.map((c, i) => (
                  <td key={i} className={cn("tabular-nums", row.id === "rotation" && "text-muted")}>
                    {statOf(c, row.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {groups.map((group) => (
            <tbody key={group.dimension ?? "none"}>
              <tr className="table-group">
                <th scope="rowgroup" colSpan={span} className="sticky-col">
                  {group.dimension === null
                    ? countText(t, "compare.group_none", group.rows.length)
                    : countText(t, "compare.group_dimension", group.rows.length, { d: group.dimension + 1 })}
                </th>
              </tr>
              {group.rows.map((row) => {
                const name = labels.name(row.measure);
                return (
                  <tr key={row.measure}>
                    <th scope="row" className="sticky-col font-medium break-words min-w-[7rem] max-w-[14rem]">
                      <span data-tip-more={labels.description(row.measure)}>
                        <MeasureName name={name} />
                      </span>
                    </th>
                    {row.cells.map((cell, i) => (
                      <MatrixCell
                        key={i}
                        cell={cell}
                        inRow={cellInRow(cell, row.dimension)}
                        tip={`${columnLabel(columns[i])} · ${name}: ${cellTip(cell, t, locale, columns[i])}`}
                        crossLabel={crossLabel}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </TableFrame>
    </div>
  );
}

function MatrixLegend() {
  const t = useT();
  return (
    <div className="flex items-center gap-x-4 gap-y-1 text-[11px] text-muted flex-wrap" aria-hidden>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-fg/[0.08]" />
        {t("compare.legend.in_row")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm ring-2 ring-inset ring-fg/55" />
        {t("compare.legend.cross")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm border border-dashed border-muted" />
        {t("compare.legend.msa")}
      </span>
      <span>{t("compare.legend.faded")}</span>
    </div>
  );
}

/** The dimensions of a cell, "D1" or "D1 · D3". */
function dimensionsText(dimensions: number[]): string {
  return dimensions.map(dimensionLabel).join(" · ");
}

function MatrixCell({
  cell,
  inRow,
  tip,
  crossLabel,
}: {
  cell: CompareCell;
  inRow: boolean;
  tip: string;
  crossLabel: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const crossed = (cell.status === "assigned" || cell.status === "unassigned") && cell.cross_loading;
  let content: React.ReactNode;
  if (cell.status === "assigned") {
    content = (
      <>
        <span className="font-medium text-fg">{dimensionsText(cell.dimensions)}</span>
        {cell.loadings.length === 1 && (
          <span className="ml-1.5 font-mono text-[11px] text-muted tabular-nums">{formatNumber(cell.loadings[0], locale, 2)}</span>
        )}
      </>
    );
  } else if (cell.status === "unassigned") {
    content =
      cell.reason === "low_communality" ? (
        <span>
          h² <span className="font-mono tabular-nums">{formatNumber(cell.communality, locale, 2)}</span>
        </span>
      ) : cell.reason === "low_loading" ? (
        <span>
          |λ| <span className="font-mono tabular-nums">{formatNumber(Math.abs(cell.loading), locale, 2)}</span>
        </span>
      ) : (
        <span>{dimensionsText(cell.cross_dimensions ?? [cell.dimension])}</span>
      );
  } else if (cell.status === "msa_removed") {
    content = (
      <span className="rounded px-1 border border-dashed border-muted">
        MSA <span className="font-mono tabular-nums">{formatNumber(cell.msa, locale, 2)}</span>
      </span>
    );
  } else if (cell.status === "dropped") {
    content = <span>{t(cell.reason === "constant" ? "compare.cell.constant" : "compare.cell.dropped")}</span>;
  } else if (cell.status === "excluded") {
    content = <span>{t("compare.cell.excluded")}</span>;
  } else if (cell.status === "absent") {
    content = <span className="sr-only">{t("compare.cell.absent")}</span>;
  } else {
    content = <span>–</span>;
  }
  return (
    <td
      data-tip={tip}
      className={cn(
        "whitespace-nowrap",
        cell.status === "assigned" ? "text-fg" : "text-muted",
        inRow && "bg-fg/[0.08]",
        crossed && "ring-2 ring-inset ring-fg/55",
      )}
    >
      {content}
      {crossed && <span className="sr-only"> ({crossLabel})</span>}
    </td>
  );
}

/** What a cell says in words, for its tooltip. */
function cellTip(cell: CompareCell, t: Translate, locale: string, column: CompareColumn): string {
  const number = (v: number) => formatNumber(v, locale, 2);
  const factorOf = (f: number) => t("factor.loadings.factor_n", { i: f + 1 });
  switch (cell.status) {
    case "assigned": {
      const parts = cell.dimensions.map((d, j) =>
        t("compare.tip.assigned", { d: dimensionLabel(d), factor: factorOf(cell.factors[j]), loading: number(cell.loadings[j]) }),
      );
      return `${parts.join("; ")}; h² ${number(cell.communality)}`;
    }
    case "unassigned": {
      const why =
        cell.reason === "low_communality"
          ? t("factor.loadings.reason.low_communality", { value: number(cell.communality) })
          : cell.reason === "low_loading"
            ? t("factor.loadings.reason.low_loading", { value: number(Math.abs(cell.loading)) })
            : t("compare.tip.cross", {
                dims: (cell.cross_dimensions ?? []).map(dimensionLabel).join(", "),
                loadings: (cell.cross_loadings ?? []).map(number).join(", "),
              });
      return t("compare.tip.unassigned", { why });
    }
    case "msa_removed":
      return t("compare.tip.msa", { msa: number(cell.msa), step: cell.step });
    case "dropped":
      return t(cell.reason === "constant" ? "compare.tip.constant" : "compare.tip.dropped");
    case "excluded":
      return t("compare.cell.excluded");
    case "absent":
      return t("compare.cell.absent");
    default:
      return column.error ? t("compare.tip.failed") : "–";
  }
}

/**
 * How a factor came by its dimension, for the tooltip of its cell: the first dataset keeps its
 * numbers; every other one was matched by the measures it shares with the datasets before it, so
 * a match that rests on one measure, or none, shows.
 */
function matchText(
  column: CompareColumn,
  factor: number,
  first: boolean,
  labels: Labels,
  t: Translate,
  locale: string,
): string | undefined {
  if (first) return t("compare.tip.kept");
  const shared = column.matched_by?.[factor];
  const likeness = column.congruence?.[factor];
  if (!shared) return undefined;
  if (likeness === null || likeness === undefined) return t("compare.tip.matched_new");
  const congruence = formatNumber(likeness, locale, 2);
  if (shared.length === 0) return t("compare.tip.matched_none", { congruence });
  return countText(t, "compare.tip.matched", shared.length, { measures: shared.map(labels.name).join(", "), congruence });
}

/** The dimensions per column, laid out like Tab. 17: one row per analysis, one column per dimension. */
function DimensionTable({
  comparison,
  labels,
  columnLabel,
}: {
  comparison: Comparison;
  labels: Labels;
  columnLabel: (column: CompareColumn) => string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const zone = useTipZone<HTMLTableElement>();
  const n = comparison.alignment.dimensions;
  // The first column that was analysed keeps the numbers of its factors.
  const reference = comparison.columns.findIndex((c) => !c.error);
  const list = (measures: string[]) =>
    measures.map((m, j) => (
      <Fragment key={m}>
        {j > 0 && ", "}
        <span data-tip-more={labels.description(m)}>
          <MeasureName name={labels.name(m)} />
        </span>
      </Fragment>
    ));
  return (
    <TableFrame label={t("compare.dimensions_label")}>
      <table ref={zone} className="data-table">
        <caption className="sr-only">
          {t("compare.dimensions_caption", { rule: t(`factor.loadings.rule.${comparison.assignment_rule}.title`) })}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky-col">
              {t("compare.dimensions_analysis")}
            </th>
            {Array.from({ length: n }, (_, d) => (
              <th key={d} scope="col" className="min-w-[7rem]">
                {t("compare.dimension_n", { d: d + 1 })}
              </th>
            ))}
            <th scope="col" className="min-w-[7rem] border-l border-border">
              {t("compare.dimensions_none")}
            </th>
          </tr>
        </thead>
        <tbody>
          {comparison.columns.map((column, i) => (
            <tr key={`${column.bundled_id}-${i}`}>
              <th scope="row" className="sticky-col font-medium min-w-[8rem] align-top">
                {columnLabel(column)}
              </th>
              {column.error ? (
                <td colSpan={n + 1} className="text-muted">
                  {t("compare.tip.failed")}
                </td>
              ) : (
                <>
                  {comparison.dimensions.map((dimension) => {
                    const entry = dimension.columns[i];
                    const members = entry?.measures.map((m) => m.measure) ?? [];
                    const tip =
                      entry && entry.factor !== null
                        ? t("compare.tip.factor_of", { factor: t("factor.loadings.factor_n", { i: entry.factor + 1 }), column: columnLabel(column) })
                        : undefined;
                    const more =
                      entry && entry.factor !== null ? matchText(column, entry.factor, i === reference, labels, t, locale) : undefined;
                    return (
                      <td key={dimension.index} data-tip={tip} data-tip-more={more} className="!whitespace-normal align-top">
                        {members.length > 0 ? list(members) : <span className="text-muted">–</span>}
                      </td>
                    );
                  })}
                  <td className="!whitespace-normal align-top text-muted border-l border-border">
                    {(comparison.unassigned[i] ?? []).length > 0 ? (
                      (comparison.unassigned[i] ?? []).map((u, j) => (
                        <Fragment key={u.measure}>
                          {j > 0 && ", "}
                          <span data-tip-more={t(`compare.reason.${u.reason}`)}>
                            <MeasureName name={labels.name(u.measure)} />
                          </span>
                        </Fragment>
                      ))
                    ) : (
                      "–"
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** What is worth knowing about the columns: notes on the bundled data, the rule and the analysis. */
function ColumnNotes({
  comparison,
  columnLabel,
  measureName,
}: {
  comparison: Comparison;
  columnLabel: (column: CompareColumn) => string;
  measureName: (key: string) => string;
}) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const notes: { key: string; warn: boolean; text: string }[] = [];
  comparison.columns.forEach((column, i) => {
    const label = columnLabel(column);
    const add = (text: string | null | undefined, warn = false) => {
      if (text) notes.push({ key: `${i}-${notes.length}`, warn, text: `${label}: ${text}` });
    };
    if (column.error) {
      add(
        (column.error.code && tMaybe(`factor.errors.${column.error.code}`, column.error.params)) || column.error.message,
        true,
      );
      return;
    }
    if (column.same_as !== null && column.same_as !== undefined) {
      // Says what the note on the dataset would, for these columns.
      add(t("compare.same_as", { other: columnLabel(comparison.columns[column.same_as]) }));
    } else {
      add(datasetNote(column.bundled_id, t));
    }
    add(ruleNote(column.bundled_id, comparison.assignment_rule, t, locale));
    for (const w of column.warnings ?? []) add(noticeText(w, tMaybe, measureName), true);
  });
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold">{t("compare.column_notes")}</h3>
      <ul className="space-y-1">
        {notes.map((note) => (
          <li key={note.key} className="flex items-start gap-1.5 text-xs text-muted max-w-prose">
            {note.warn ? (
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0 text-warn-ink" aria-hidden />
            ) : (
              <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
            )}
            <span>{note.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
