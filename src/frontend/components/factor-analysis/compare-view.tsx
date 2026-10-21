"use client";

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Combine, Grid3x3, Info, LayoutGrid, Loader2, RotateCcw } from "lucide-react";
import {
  HttpError,
  compareAnalyses,
  exportComparison,
  fetchFactorCatalog,
  listDatasets,
  type BundledDataset,
  type CompareCell,
  type CompareColumn,
  type CompareExportFormat,
  type Comparison,
  type DatasetSummary,
  type FactorCatalog,
  type FactorKind,
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
  pairTint,
  parseColumnKey,
  parseCompareQuery,
  sameState,
  toggleColumn,
  type ColumnChoice,
  type CompareState,
} from "@/lib/compare";
import { countText, datasetName, downloadBlob, factorName, noticeText } from "@/lib/factor-analysis";
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

/** The collection whose datasets the page offers per kind: the miners of Important Factors, the logs of the PDC. */
const COLLECTIONS: Record<FactorKind, string> = { model: "comfy-paper", log: "comfy-log-paper" };
const LOOK_KEY = "app.compare-look";
/** Changes in quick succession (several tiles) are compared once. */
const COMPARE_DEBOUNCE_MS = 150;

type Look = "matrix" | "dimensions" | "pairs";
const LOOKS: readonly Look[] = ["matrix", "dimensions", "pairs"];

function useLook(): [Look, (look: Look) => void] {
  const [look, setLook] = useState<Look>("matrix");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOOK_KEY) as Look | null;
      if (saved && LOOKS.includes(saved)) setLook(saved);
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
  // Model measures, as the papers compare them, or log measures of the session's own data.
  const kind: FactorKind = search.get("kind") === "log" ? "log" : "model";

  const [rawCatalog, setRawCatalog] = useState<FactorCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setCatalogError(null);
    fetchFactorCatalog(kind, ac.signal)
      .then(setRawCatalog)
      .catch((e) => {
        if (!ac.signal.aborted) setCatalogError(errorText(e, tMaybe, t("compare.errors.catalog")));
      });
    return () => ac.abort();
    // Texts are read once per attempt; a language switch does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogAttempt, kind]);
  // The datasets of the session, which own columns are made of and named after.
  const [own, setOwn] = useState<DatasetSummary[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    listDatasets(kind, ac.signal).then(
      (list) => setOwn(list),
      () => {
        // Without the list own columns keep a plain title; the server still knows them.
        if (!ac.signal.aborted) setOwn([]);
      },
    );
    return () => ac.abort();
  }, [kind]);
  const catalog = useMemo(
    () => (rawCatalog && rawCatalog.kind === kind ? localizeCatalog(rawCatalog, locale) : null),
    [rawCatalog, kind, locale],
  );
  const datasets = useMemo(() => (catalog ? orderCollection(COLLECTIONS[kind], catalog.bundled) : []), [catalog, kind]);
  const byId = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets]);
  const order = useMemo(() => datasets.map((d) => d.id), [datasets]);
  const ownById = useMemo(() => new Map((own ?? []).map((d) => [d.id, d])), [own]);

  // The title of a column: its dataset, with the factor count if it has one of its own.
  const datasetTitle = useCallback((id: string) => byId.get(id)?.label ?? byId.get(id)?.name ?? id, [byId]);
  const columnTitle = useCallback(
    (id: string, k: number | null) => (k === null ? datasetTitle(id) : t("compare.column_k", { label: datasetTitle(id), k })),
    [datasetTitle, t],
  );
  // A column of the session's own data: its dataset, the miner, a factor count and rotation of its own.
  const ownTitle = useCallback(
    (column: ColumnChoice) => {
      const dataset = ownById.get(column.id);
      return [
        dataset && catalog ? datasetName(dataset, t, catalog) : t("compare.own_unknown"),
        column.miner ?? null,
        column.k !== null ? t("compare.own_k", { k: column.k }) : null,
        column.rotation ? t(`factor.settings.rotation.${column.rotation}`) : null,
      ]
        .filter(Boolean)
        .join(" · ");
    },
    [ownById, catalog, t],
  );
  // The request is made a moment after the address changes: it names its columns as the page does then.
  const titleRef = useRef({ columnTitle, ownTitle });
  useEffect(() => {
    titleRef.current = { columnTitle, ownTitle };
  }, [columnTitle, ownTitle]);

  // The address is the state: the columns and the rule. Own columns are checked against the
  // session's datasets once they are known.
  const known = useMemo(() => (catalog ? new Set(catalog.bundled.map((b) => b.id)) : null), [catalog]);
  const ownIds = useMemo(() => (own ? new Set(own.map((d) => d.id)) : null), [own]);
  const query = search.toString();
  const { state, invalid } = useMemo(
    () => parseCompareQuery(new URLSearchParams(query), known, ownIds),
    [query, known, ownIds],
  );
  const stateKey = compareQuery(state);
  const enough = state.columns.length >= MIN_COLUMNS;
  const setState = useCallback(
    (next: CompareState) => router.replace(`/compare?${compareQuery(next)}`, { scroll: false }),
    [router],
  );

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparedKey, setComparedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Columns of the session's own data wait for its list, which names them.
  const waiting = !catalog || (state.columns.some((key) => parseColumnKey(key)?.own) && !own);
  useEffect(() => {
    if (waiting || !enough) return;
    const ac = new AbortController();
    setError(null);
    const timer = setTimeout(() => {
      const asked = parseCompareQuery(new URLSearchParams(stateKey), null).state;
      const titles = titleRef.current;
      compareAnalyses(compareRequest(asked, (id, k) => titles.columnTitle(id, k), titles.ownTitle), ac.signal)
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
  }, [stateKey, waiting, enough, attempt]);
  // What is on screen is of another selection than the tiles show, whether the update is under
  // way or failed: it is dimmed, and what is downloaded would be the new selection, not this table.
  const outdated = comparedKey !== stateKey;
  const computing = !!catalog && enough && !error && outdated;

  // The columns of the table on screen, as they were asked.
  const shownColumns = useMemo(
    () =>
      (comparedKey ? parseCompareQuery(new URLSearchParams(comparedKey), null).state.columns : []).map((key) =>
        parseColumnKey(key),
      ),
    [comparedKey],
  );
  // Which of them had a factor count of their own, instead of the one of the paper.
  const ownCounts = useMemo(() => shownColumns.map((c) => (c && !c.own ? c.k : null)), [shownColumns]);
  const titles = useMemo(
    () =>
      (comparison?.columns ?? []).map((column, i) => {
        const asked = shownColumns[i];
        if (asked?.own) return ownTitle(asked);
        const k = ownCounts[i] ?? null;
        if (!column.bundled_id) return column.label;
        return k === null ? (byId.get(column.bundled_id)?.label ?? column.label) : columnTitle(column.bundled_id, k);
      }),
    [comparison, shownColumns, ownCounts, byId, columnTitle, ownTitle],
  );

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
  const everyLabel = useMemo(() => measureLabels(names, descriptions, codes, false), [names, descriptions, codes]);

  const [look, setLook] = useLook();
  const [exporting, setExporting] = useState<CompareExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const onExport = async (format: CompareExportFormat) => {
    setExporting(format);
    setExportError(null);
    try {
      const { blob, filename } = await exportComparison(compareRequest(state, columnTitle, ownTitle), format, codesShown);
      downloadBlob(blob, filename);
    } catch (e) {
      setExportError(errorText(e, tMaybe, t("compare.errors.export")));
    } finally {
      setExporting(null);
    }
  };

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
        back={kind === "log" ? { href: "/log", label: t("mode_bar.log_label") } : { href: "/", label: t("mode_bar.model_label") }}
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

      <ColumnChooser
        datasets={datasets}
        state={state}
        order={order}
        onState={setState}
        title={columnTitle}
        ownTitle={ownTitle}
        tableReset={kind === "model"}
      />

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
                {
                  value: "pairs",
                  label: (
                    <>
                      <Combine className="h-3.5 w-3.5" aria-hidden />
                      {t("compare.look.pairs")}
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
        {!enough && catalog && (
          <p className="flex items-start gap-1.5 text-sm text-muted max-w-prose">
            <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <span>{t("compare.empty", { min: MIN_COLUMNS })}</span>
          </p>
        )}
        {enough && !comparison && !error && !catalogError && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("compare.computing")}
          </p>
        )}

        {comparison && enough && (
          <div className={cn("space-y-3 transition-opacity motion-reduce:transition-none", outdated && "opacity-60")}>
            {look === "matrix" ? (
              <MembershipMatrix comparison={comparison} labels={labels} titles={titles} />
            ) : look === "dimensions" ? (
              <DimensionTable comparison={comparison} labels={labels} titles={titles} />
            ) : (
              <PairsMatrix comparison={comparison} labels={everyLabel} codes={codes} titles={titles} />
            )}
            <ColumnNotes comparison={comparison} titles={titles} ownCounts={ownCounts} measureName={labels.name} />
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

/**
 * The columns of the session's own data the link brought, which go once switched off; then the
 * bundled datasets as tiles to switch on and off, Tab. 17's first, and a way back to it.
 */
function ColumnChooser({
  datasets,
  state,
  order,
  onState,
  title,
  ownTitle,
  tableReset,
}: {
  datasets: BundledDataset[];
  state: CompareState;
  order: string[];
  onState: (state: CompareState) => void;
  title: (id: string, k: number | null) => string;
  ownTitle: (column: ColumnChoice) => string;
  /** Offer the way back to Tab. 17. */
  tableReset: boolean;
}) {
  const t = useT();
  const chosen = new Set(state.columns);
  // Why a tile cannot be switched: a comparison keeps its least and its most.
  const blocked = (on: boolean) =>
    on && state.columns.length <= MIN_COLUMNS
      ? t("compare.columns.min", { min: MIN_COLUMNS })
      : !on && state.columns.length >= MAX_COLUMNS
        ? t("compare.columns.max", { max: MAX_COLUMNS })
        : null;
  const own = state.columns.flatMap((key) => {
    const column = parseColumnKey(key);
    return column?.own ? [{ key, column }] : [];
  });
  return (
    <section className="space-y-2" aria-labelledby="cmp-columns-label">
      <div className="flex items-center justify-between gap-x-4 gap-y-1 flex-wrap">
        <span id="cmp-columns-label">
          <HelpLabel as="span" label={t("compare.columns.label")} help={t("compare.help.columns", { min: MIN_COLUMNS, max: MAX_COLUMNS })} />
        </span>
        {tableReset && !sameState(state, TABLE_17_STATE) && (
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
        {/* The analyses of the session's own data first: they are what such a comparison is about. */}
        {own.map(({ key, column }) => (
          <ColumnTile
            key={key}
            name={ownTitle(column)}
            note={t("compare.own_note")}
            on
            reason={blocked(true)}
            onToggle={() => onState({ ...state, columns: toggleColumn(state.columns, key, order) })}
          />
        ))}
        {datasets.flatMap((d) => {
          const on = chosen.has(d.id);
          const note = datasetNote(d.id, t) ?? d.published_source ?? null;
          // A column of this dataset with a factor count of its own (from a link), right after its tile.
          const variants = state.columns.flatMap((key) => {
            const column = parseColumnKey(key);
            return column && column.id === d.id && column.k !== null ? [{ key, k: column.k }] : [];
          });
          return [
            <ColumnTile
              key={d.id}
              name={title(d.id, null)}
              note={note}
              on={on}
              reason={blocked(on)}
              onToggle={() => onState({ ...state, columns: toggleColumn(state.columns, d.id, order) })}
            />,
            ...variants.map(({ key, k }) => (
              <ColumnTile
                key={key}
                name={title(d.id, k)}
                note={t("compare.column_k_note", { k })}
                on
                reason={blocked(true)}
                onToggle={() => onState({ ...state, columns: toggleColumn(state.columns, key, order) })}
              />
            )),
          ];
        })}
      </div>
    </section>
  );
}

/** A dataset to compare, as a tile to switch on and off; blocked with its `reason`. */
function ColumnTile({
  name,
  on,
  note,
  reason,
  onToggle,
}: {
  name: string;
  on: boolean;
  note: string | null;
  reason: string | null;
  onToggle: () => void;
}) {
  // A tooltip needs a name besides the reason; the name is the tile's own.
  const tip = useTip<HTMLLabelElement>(reason ? { name, reason } : null);
  const noteId = useId();
  return (
    <label ref={tip} className={cn("flex items-start gap-2.5 rounded-md px-3 py-2.5 min-w-0", choiceTile(on), reason && "cursor-default")}>
      <input
        type="checkbox"
        className="sr-only"
        checked={on}
        aria-label={name}
        aria-describedby={note ? noteId : undefined}
        aria-disabled={reason ? true : undefined}
        onChange={() => {
          if (!reason) onToggle();
        }}
      />
      <ChoiceMark checked={on} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{name}</span>
        {note && (
          <span id={noteId} className="block text-[11px] text-muted leading-snug">
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
  titles,
}: {
  comparison: Comparison;
  labels: Labels;
  titles: string[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const zone = useTipZone<HTMLTableElement>();
  const { columns } = comparison;
  const groups = groupRows(comparison.measures);
  const span = columns.length + 1;
  const rows = headerRows(t, locale);
  // The names of the factors, where an analysis of the session's own data has them.
  const named = columns.some((c) => c.factor_names?.some(Boolean));
  const crossLabel = t("factor.loadings.cross_cell");
  return (
    <div className="space-y-2">
      <MatrixLegend />
      <TableFrame label={t("compare.matrix_label")}>
        <table ref={zone} className="data-table">
          <caption className="sr-only">
            {t("compare.matrix_caption", {
              rule: t(`factor.loadings.rule.${comparison.assignment_rule}.title`),
              columns: titles.join(", "),
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
                    <span className="text-fg">{titles[i]}</span>
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
            {named && (
              <tr>
                <th scope="row" className="sticky-col font-medium align-top">
                  <Term more={t("compare.help.names")}>{t("compare.header.names")}</Term>
                </th>
                {columns.map((c, i) => (
                  <td key={i} className="!whitespace-normal align-top">
                    <FactorNameList names={c.factor_names} count={c.error ? 0 : (c.n_factors ?? 0)} />
                  </td>
                ))}
              </tr>
            )}
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
                        tip={`${titles[i]} · ${name}: ${cellTip(cell, t, locale, columns[i])}`}
                        crossLabel={crossLabel}
                        names={columns[i].factor_names}
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

/** The names of a column's factors in the order of the factors; a factor without one shows its number, faded. */
function FactorNameList({ names, count }: { names: (string | null)[] | null | undefined; count: number }) {
  if (!names || !names.some(Boolean)) return <span className="text-muted">–</span>;
  return (
    <ol className="space-y-0.5">
      {Array.from({ length: count }, (_, f) => {
        const name = factorName(names, f);
        return (
          <li key={f} className={cn("text-xs leading-snug", !name && "text-muted")}>
            <span className="font-mono tabular-nums text-muted">F{f + 1}</span> {name ?? "–"}
          </li>
        );
      })}
    </ol>
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
  names,
}: {
  cell: CompareCell;
  inRow: boolean;
  tip: string;
  crossLabel: string;
  /** The names its analysis gave the factors, where it did. */
  names?: (string | null)[] | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const crossed = (cell.status === "assigned" || cell.status === "unassigned") && cell.cross_loading;
  let content: React.ReactNode;
  if (cell.status === "assigned") {
    content = (
      <>
        <span className="font-medium text-fg">
          {cell.dimensions.map((d, j) => {
            const name = factorName(names, cell.factors[j]);
            return (
              <Fragment key={d}>
                {j > 0 && " · "}
                {dimensionLabel(d)}
                {name && (
                  <span className="ml-1 inline-block max-w-[7rem] truncate align-bottom text-xs font-normal text-muted">{name}</span>
                )}
              </Fragment>
            );
          })}
        </span>
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

/** "Factor 2", or "Factor 2 “Size”" where its analysis named it. */
function factorText(t: Translate, factor: number, names: (string | null)[] | null | undefined): string {
  const name = factorName(names, factor);
  return name ? t("compare.factor_named", { i: factor + 1, name }) : t("factor.loadings.factor_n", { i: factor + 1 });
}

/** What a cell says in words, for its tooltip. */
function cellTip(cell: CompareCell, t: Translate, locale: string, column: CompareColumn): string {
  const number = (v: number) => formatNumber(v, locale, 2);
  const factorOf = (f: number) => factorText(t, f, column.factor_names);
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
  titles,
}: {
  comparison: Comparison;
  labels: Labels;
  titles: string[];
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
                {titles[i]}
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
                        ? t("compare.tip.factor_of", { factor: factorText(t, entry.factor, column.factor_names), column: titles[i] })
                        : undefined;
                    const name = entry && entry.factor !== null ? factorName(column.factor_names, entry.factor) : null;
                    const more =
                      entry && entry.factor !== null ? matchText(column, entry.factor, i === reference, labels, t, locale) : undefined;
                    return (
                      <td key={dimension.index} data-tip={tip} data-tip-more={more} className="!whitespace-normal align-top">
                        {name && <span className="mb-0.5 block text-xs font-medium text-muted">{name}</span>}
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

/**
 * Pairs of measures: in how many of the datasets that analysed both two measures are in the same
 * dimension, as a square of short codes. The rows are those of the matrix, so the dimensions show
 * as blocks along the diagonal, and nothing in it depends on how the dimensions are numbered.
 * The tint is the share, the number in the cell says how many of how many; on the diagonal a
 * measure is paired with itself: in a dimension in how many of the datasets that analysed it.
 */
function PairsMatrix({
  comparison,
  labels,
  codes,
  titles,
}: {
  comparison: Comparison;
  /** The full names and what the measures measure, whatever the switch of the short codes says. */
  labels: Labels;
  codes: ReadonlyMap<string, string>;
  titles: string[];
}) {
  const t = useT();
  const zone = useTipZone<HTMLTableElement>();
  const pairs = comparison.co_assignment;
  const rows = comparison.measures;
  // The axes are short: the code of the papers, or the name of a measure without one.
  const axis = (measure: string) => codes.get(measure) ?? labels.name(measure);
  // The rows start a new block where the dimension of the row changes.
  const starts = rows.map((row, i) => i > 0 && row.dimension !== rows[i - 1].dimension);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted max-w-prose">{t("compare.pairs.legend")}</p>
      <TableFrame label={t("compare.pairs.label")}>
        <table ref={zone} className="data-table">
          <caption className="sr-only">
            {t("compare.pairs.caption", {
              rule: t(`factor.loadings.rule.${comparison.assignment_rule}.title`),
              columns: titles.join(", "),
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky-col">
                {t("factor.loadings.col_measure")}
              </th>
              {rows.map((row, j) => (
                <th
                  key={row.measure}
                  scope="col"
                  data-tip={labels.name(row.measure)}
                  data-tip-more={labels.description(row.measure)}
                  className={cn("text-center !px-2 min-w-[3rem]", starts[j] && "border-l border-border")}
                >
                  {axis(row.measure)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.measure}>
                <th
                  scope="row"
                  data-tip={labels.name(row.measure)}
                  data-tip-more={labels.description(row.measure)}
                  className={cn("sticky-col font-medium", starts[i] && "border-t border-border")}
                >
                  {axis(row.measure)}
                </th>
                {rows.map((other, j) => (
                  <PairCell
                    key={other.measure}
                    together={pairs.together[i][j]}
                    assigned={pairs.both_assigned[i][j]}
                    analysed={pairs.both_analysed[i][j]}
                    self={i === j}
                    a={labels.name(row.measure)}
                    b={labels.name(other.measure)}
                    className={cn(starts[i] && "border-t border-border", starts[j] && "border-l border-border")}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}

function PairCell({
  together,
  assigned,
  analysed,
  self,
  a,
  b,
  className,
}: {
  together: number;
  assigned: number;
  analysed: number;
  self: boolean;
  a: string;
  b: string;
  className?: string;
}) {
  const t = useT();
  const none = analysed === 0;
  const more = none
    ? t(self ? "compare.pairs.never_self" : "compare.pairs.never")
    : self
      ? countText(t, "compare.pairs.self", analysed, { assigned })
      : countText(t, "compare.pairs.pair", analysed, { together, assigned });
  const alpha = self ? 0 : pairTint(together, analysed);
  return (
    <td
      data-tip={self ? a : t("compare.pairs.names", { a, b })}
      data-tip-more={more}
      className={cn("text-center tabular-nums !px-2", self || none ? "text-muted" : "text-fg", className)}
      style={alpha > 0 ? { backgroundColor: `rgb(var(--fg) / ${alpha.toFixed(3)})` } : undefined}
    >
      {none ? (
        "–"
      ) : (
        <>
          <span aria-hidden>
            {together}/{analysed}
          </span>
          <span className="sr-only">{t("compare.pairs.fraction", { together, analysed })}</span>
        </>
      )}
    </td>
  );
}

/** What is worth knowing about the columns: notes on the bundled data, the rule (for the settings of the paper) and the analysis. */
function ColumnNotes({
  comparison,
  titles,
  ownCounts,
  measureName,
}: {
  comparison: Comparison;
  titles: string[];
  /** The factor count a column asked for instead of its paper's, or null. */
  ownCounts: (number | null)[];
  measureName: (key: string) => string;
}) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const notes: { key: string; warn: boolean; text: string }[] = [];
  comparison.columns.forEach((column, i) => {
    const label = titles[i];
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
      add(t("compare.same_as", { other: titles[column.same_as] }));
    } else if (column.bundled_id) {
      add(datasetNote(column.bundled_id, t));
    }
    // The notes on a rule are about the settings of the paper, which a factor count of its own leaves.
    if (column.bundled_id && (ownCounts[i] ?? null) === null) {
      add(ruleNote(column.bundled_id, comparison.assignment_rule, t, locale));
    }
    // Own data start from the settings saved with them; say so where they do not.
    if (column.dataset_id && column.settings === "standard") add(t("compare.own_standard"));
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
