"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { Correlations, FactorAnalysis } from "@/lib/api";
import {
  HIGH_CORRELATION,
  SVG_LIMIT,
  cellAt,
  cellColor,
  cellRgba,
  cellSize,
  isHigh,
  layoutValue,
  mapLayout,
  parseToken,
  type MapLayout,
  type MapOrder,
} from "@/lib/correlation";
import { factorName, type FactorNames } from "@/lib/factor-analysis";
import { formatNumber } from "@/lib/format";
import type { MeasureInfo } from "@/lib/measure-list";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { Brief } from "@/components/ui/brief";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { MeasureName, TableFrame } from "@/components/ui/table";
import { useTip, useTipZone } from "@/components/ui/tip";
import { FigureMenu, type FigureDownload } from "./figure-menu";
import { FoldButton } from "./measure-fold";

/** What the map has of the correlations the server sends: they are loaded when it is opened. */
export interface CorrelationsState {
  data: Correlations | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const ORDER_KEY = "app.factor-correlation-order";

/** The order of the map chosen last, remembered in the browser; the figure and the ZIP follow it. */
export function useMapOrder(): [MapOrder, (order: MapOrder) => void] {
  const [order, setOrder] = useState<MapOrder>("factor");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ORDER_KEY);
      if (saved === "factor" || saved === "cluster") setOrder(saved);
    } catch {
      /* storage blocked */
    }
  }, []);
  const update = useCallback((next: MapOrder) => {
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      /* storage blocked */
    }
  }, []);
  return [order, update];
}

/** What the map needs from the page: the analysis, the measures excluded, their fate, the loaded correlations. */
export interface CorrelationMapProps {
  /** The measures the map shows: all of the dataset's but those excluded by hand. */
  measureCount: number;
  analysis: FactorAnalysis | null;
  excluded: readonly string[];
  /** What became of each measure, to mark those the MSA filter removed. */
  info: Map<string, MeasureInfo>;
  names: FactorNames;
  correlations: CorrelationsState;
  /** Asks for the correlations; called when the map is opened. */
  onOpen: () => void;
  order: MapOrder;
  onOrder: (order: MapOrder) => void;
  figure?: FigureDownload;
  measureName: (key: string) => string;
}

/**
 * The correlation map of the suitability step: a square of coloured cells, one for each pair of
 * measures, folded until it is asked for. The numbers come from the server when it opens. It reads
 * with the pointer and the arrow keys, a table under it holds every value in text.
 */
export function CorrelationMap(props: CorrelationMapProps) {
  const { measureCount, correlations, onOpen, order, onOrder, figure } = props;
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const opened = useRef<number | null>(null);
  const toggle = () => {
    if (!open) {
      opened.current = performance.now();
      onOpen();
    }
    setOpen(!open);
  };
  const limit = formatNumber(HIGH_CORRELATION, locale);
  return (
    <div id="fa-correlation-map" className="space-y-3 scroll-mt-24">
      <div className="text-sm font-semibold">
        <FoldButton
          label={`${t("factor.correlations.heading")} · ${formatNumber(measureCount, locale)}`}
          fold={{ open, onToggle: toggle }}
        />
      </div>
      {open && (
        <div className="space-y-3">
          <Brief text={t("factor.correlations.help", { limit })} topic={t("factor.correlations.heading")} />
          {correlations.error ? (
            <Notice
              tone="error"
              role="alert"
              action={
                <Button size="sm" variant="outline" onClick={correlations.retry}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  {t("common.try_again")}
                </Button>
              }
            >
              {t("factor.correlations.failed", { error: correlations.error })}
            </Notice>
          ) : !correlations.data ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("factor.correlations.loading")}
            </div>
          ) : (
            <MapBody {...props} data={correlations.data} openedAt={opened.current} onOrder={onOrder} order={order} figure={figure} />
          )}
        </div>
      )}
    </div>
  );
}

function MapBody({
  data,
  analysis,
  excluded,
  info,
  names,
  order,
  onOrder,
  figure,
  measureName,
  openedAt,
}: CorrelationMapProps & { data: Correlations; openedAt: number | null }) {
  const t = useT();
  const { locale } = useLocale();
  const hidden = useMemo(() => new Set(excluded), [excluded]);
  // By factor needs the analysis; until it is there the map is clustered.
  const byFactor = order === "factor" && !!analysis;
  const layout = useMemo(
    () => mapLayout(data, byFactor ? "factor" : "cluster", analysis, hidden),
    [data, byFactor, analysis, hidden],
  );
  const orderTip = useTip<HTMLDivElement>({ more: t("factor.correlations.order_more") });
  const n = layout.measures.length;
  const limit = formatNumber(HIGH_CORRELATION, locale);
  const high = useMemo(() => {
    let count = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (isHigh(layoutValue(data, layout, i, j), i, j)) count++;
    return count;
  }, [data, layout, n]);

  if (n < 2) return <p className="text-xs text-muted">{t("factor.correlations.few")}</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <div ref={orderTip} className="flex items-center gap-2">
          <span id="fa-map-order-label" className="text-xs font-medium text-muted">
            {t("factor.correlations.order_label")}
          </span>
          <Segmented<MapOrder>
            size="sm"
            aria-labelledby="fa-map-order-label"
            value={byFactor ? "factor" : "cluster"}
            onChange={onOrder}
            options={[
              {
                value: "factor",
                label: t("factor.correlations.order_factor"),
                disabled: !analysis,
                title: analysis ? undefined : t("factor.correlations.order_factor_reason"),
              },
              { value: "cluster", label: t("factor.correlations.order_cluster") },
            ]}
          />
        </div>
        {figure && <FigureMenu name={t("factor.figure.correlations")} figure={figure} />}
      </div>

      <MapPlot
        data={data}
        layout={layout}
        info={info}
        names={names}
        measureName={measureName}
        openedAt={openedAt}
        byFactor={byFactor}
      />

      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap text-[11px] text-muted">
        <span className="flex items-center gap-2">
          <span aria-hidden>−1</span>
          <span
            role="img"
            aria-label={t("factor.correlations.legend_aria")}
            className="h-2.5 w-28 rounded-sm ring-1 ring-inset ring-border"
            style={{
              background:
                "linear-gradient(90deg, rgb(var(--negative) / 0.9), rgb(var(--negative) / 0) 50%, rgb(var(--accent) / 0) 50%, rgb(var(--accent) / 0.9))",
            }}
          />
          <span aria-hidden>+1</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded-[2px] ring-[1.5px] ring-inset ring-fg" />
          {high === 0
            ? t("factor.correlations.legend_none", { limit })
            : t(high === 1 ? "factor.correlations.legend_high" : "factor.correlations.legend_high_plural", { n: high, limit })}
        </span>
      </div>
      <p className="text-[11px] text-muted max-w-prose">{t("factor.correlations.hint")}</p>

      <MapTable data={data} layout={layout} measureName={measureName} />
    </div>
  );
}

/** The two tokens of the theme and the ink of the outlines, as numbers for the canvas. */
function readTokens(el: Element) {
  const style = getComputedStyle(el);
  return {
    negative: parseToken(style.getPropertyValue("--negative")),
    positive: parseToken(style.getPropertyValue("--accent")),
    ink: parseToken(style.getPropertyValue("--fg")),
  };
}

/** Changes whenever the theme does, so a canvas, which cannot follow CSS variables, is drawn again. */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setTick((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => observer.disconnect();
  }, []);
  return tick;
}

interface Pointed {
  i: number;
  j: number;
}

/** The cells as SVG rectangles, for few measures; its own memoised component, so a moving pointer does not draw them again. */
const SvgCells = memo(function SvgCells({
  data,
  layout,
  cell,
}: {
  data: Correlations;
  layout: MapLayout;
  cell: number;
}) {
  const n = layout.measures.length;
  const gap = cell >= 10 ? 1 : 0;
  const rects: React.ReactNode[] = [];
  const outlines: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const r = layoutValue(data, layout, i, j);
      rects.push(
        <rect
          key={`${i}:${j}`}
          x={j * cell}
          y={i * cell}
          width={cell}
          height={cell}
          style={{ fill: cellColor(r), stroke: "rgb(var(--surface))", strokeWidth: gap }}
        />,
      );
      if (isHigh(r, i, j)) {
        outlines.push(
          <rect
            key={`o${i}:${j}`}
            x={j * cell + 1}
            y={i * cell + 1}
            width={cell - 2}
            height={cell - 2}
            fill="none"
            style={{ stroke: "rgb(var(--fg))" }}
            strokeWidth={1.5}
          />,
        );
      }
    }
  }
  return (
    <svg width={n * cell} height={n * cell} aria-hidden className="block">
      {rects}
      {outlines}
    </svg>
  );
});

/** The cells on a canvas, for many measures. Reports the time the drawing took. */
const CanvasCells = memo(function CanvasCells({
  data,
  layout,
  cell,
  theme,
  onDrawn,
}: {
  data: Correlations;
  layout: MapLayout;
  cell: number;
  theme: number;
  onDrawn: (ms: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = layout.measures.length;
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const started = performance.now();
    const ratio = window.devicePixelRatio || 1;
    const size = n * cell;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const { negative, positive, ink } = readTokens(canvas);
    const rows = layout.index.map((at) => data.r[at]);
    for (let i = 0; i < n; i++) {
      const row = rows[i];
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = cellRgba(row[layout.index[j]], negative, positive);
        ctx.fillRect(j * cell, i * cell, cell, cell);
      }
    }
    ctx.strokeStyle = `rgb(${ink[0]}, ${ink[1]}, ${ink[2]})`;
    ctx.lineWidth = cell >= 10 ? 1.5 : 1;
    const inset = ctx.lineWidth / 2;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (isHigh(rows[i][layout.index[j]], i, j)) {
          ctx.strokeRect(j * cell + inset, i * cell + inset, cell - ctx.lineWidth, cell - ctx.lineWidth);
        }
      }
    }
    onDrawn(performance.now() - started);
  }, [data, layout, n, cell, theme, onDrawn]);
  return <canvas ref={ref} aria-hidden className="block" style={{ width: n * cell, height: n * cell }} />;
});

/**
 * The map itself: the cells, the names of the measures at its sides (for up to `SVG_LIMIT` of them),
 * the dimensions at its right under the order by factor, and a crosshair with the pair and its r at
 * the pointer or at the cell the arrow keys stand on. Up to `SVG_LIMIT` measures every cell is an
 * SVG rectangle, above that the cells are drawn on a canvas.
 */
function MapPlot({
  data,
  layout,
  info,
  names,
  measureName,
  openedAt,
  byFactor,
}: {
  data: Correlations;
  layout: MapLayout;
  info: Map<string, MeasureInfo>;
  names: FactorNames;
  measureName: (key: string) => string;
  openedAt: number | null;
  byFactor: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const n = layout.measures.length;
  const svg = n <= SVG_LIMIT;
  const frame = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const zone = useTipZone<HTMLDivElement>();
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const labels = layout.measures.map(measureName);
  const longest = labels.reduce((m, s) => Math.max(m, s.length), 0);
  const leftW = svg ? Math.max(56, Math.min(220, Math.round(longest * 6.3 + 12))) : 4;
  const topH = svg ? Math.max(56, Math.min(170, Math.round(longest * 6.3 + 12))) : 4;
  const rightW = layout.blocks ? 116 : 4;
  const cell = cellSize(n, width - leftW - rightW);
  const side = n * cell;
  const total = { w: leftW + side + rightW, h: topH + side };

  const [point, setPoint] = useState<(Pointed & { keys: boolean }) | null>(null);
  const [announce, setAnnounce] = useState("");
  const theme = useThemeTick();
  const [drawn, setDrawn] = useState<{ ms: number; since: number | null } | null>(null);
  const onDrawn = useCallback(
    (ms: number) => {
      // From the click that opened the map to the canvas drawn, with the request in between.
      requestAnimationFrame(() => setDrawn({ ms, since: openedAt === null ? null : performance.now() - openedAt }));
    },
    [openedAt],
  );

  const text = (p: Pointed) =>
    t("factor.correlations.pair", {
      a: labels[p.i],
      b: labels[p.j],
      r: formatNumber(layoutValue(data, layout, p.i, p.j), locale, 2),
    });

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box) return;
    const at = cellAt(e.clientX - box.left - leftW, e.clientY - box.top - topH, cell, n);
    setPoint((old) => (at ? (old && old.i === at.i && old.j === at.j && !old.keys ? old : { ...at, keys: false }) : null));
  };
  const key = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (e.key === "Escape") {
      if (point) {
        e.preventDefault();
        e.stopPropagation();
        setPoint(null);
      }
      return;
    }
    const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
    const from = point ?? { i: 0, j: Math.min(1, n - 1) };
    let next: Pointed | null = null;
    // The first arrow lands on the first pair of different measures; the next ones move from there.
    if (e.key in step) next = point ? { i: clamp(from.i + step[e.key][0]), j: clamp(from.j + step[e.key][1]) } : from;
    else if (e.key === "Home") next = { i: from.i, j: 0 };
    else if (e.key === "End") next = { i: from.i, j: n - 1 };
    else if (e.key === "PageUp") next = { i: clamp(from.i - 10), j: from.j };
    else if (e.key === "PageDown") next = { i: clamp(from.i + 10), j: from.j };
    else if (!point && (e.key === "Enter" || e.key === " ")) next = from;
    if (!next) return;
    e.preventDefault();
    setPoint({ ...next, keys: true });
    setAnnounce(text(next));
  };

  // The tooltip hangs at the lower right of the cell, or at its left near the right edge.
  const tipWidth = 240;
  const tip = point && {
    left: Math.max(0, Math.min(total.w - tipWidth, leftW + (point.j + 1) * cell + 6)),
    top: topH + (point.i + 1) * cell + 6,
  };

  return (
    <div
      ref={frame}
      className="overflow-x-auto"
      data-render-ms={drawn ? drawn.ms.toFixed(1) : undefined}
      data-open-ms={drawn?.since != null ? drawn.since.toFixed(1) : undefined}
      data-measures={n}
      data-cells={svg ? "svg" : "canvas"}
    >
      <div
        ref={(el) => {
          plot.current = el;
          zone(el);
        }}
        role="group"
        tabIndex={0}
        aria-label={t("factor.correlations.region", { n })}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setPoint((p) => (p && !p.keys ? null : p))}
        onKeyDown={key}
        onBlur={() => setPoint(null)}
        className="relative rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent touch-pan-y select-none"
        style={{ width: total.w, height: total.h }}
      >
        {svg && (
          <>
            <div aria-hidden>
              {layout.measures.map((m, i) => (
                <div
                  key={`l${m}`}
                  data-tip-more={info.get(m)?.status === "removed" ? t("factor.correlations.removed") : undefined}
                  className={cn(
                    "absolute right-auto truncate text-right text-[11px] pr-1.5",
                    info.get(m)?.status === "removed" ? "text-muted" : "text-fg",
                    point?.i === i && "font-semibold",
                  )}
                  style={{ left: 0, width: leftW - 2, top: topH + i * cell, height: cell, lineHeight: `${cell}px` }}
                >
                  <MeasureName name={labels[i]} />
                </div>
              ))}
              {layout.measures.map((m, j) => (
                <div
                  key={`t${m}`}
                  data-tip-more={info.get(m)?.status === "removed" ? t("factor.correlations.removed") : undefined}
                  className={cn(
                    "absolute flex items-end justify-center overflow-hidden text-[11px] pb-1",
                    info.get(m)?.status === "removed" ? "text-muted" : "text-fg",
                    point?.j === j && "font-semibold",
                  )}
                  style={{ left: leftW + j * cell, width: cell, top: 0, height: topH - 1 }}
                >
                  <span className="whitespace-nowrap [writing-mode:vertical-rl] rotate-180 max-h-full overflow-hidden text-ellipsis">
                    <MeasureName name={labels[j]} />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div data-matrix data-cell={cell} className="absolute" style={{ left: leftW, top: topH, width: side, height: side }}>
          {svg ? (
            <SvgCells data={data} layout={layout} cell={cell} />
          ) : (
            <CanvasCells data={data} layout={layout} cell={cell} theme={theme} onDrawn={onDrawn} />
          )}
          {/* The dimensions: a line between them, over the cells. */}
          {layout.blocks?.slice(1).map((b) => (
            <span key={`h${b.from}`}>
              <span aria-hidden className="absolute left-0 right-0 h-px bg-fg/60" style={{ top: b.from * cell }} />
              <span aria-hidden className="absolute top-0 bottom-0 w-px bg-fg/60" style={{ left: b.from * cell }} />
            </span>
          ))}
          {/* The crosshair: the row and the column of the pair, and the pair itself. */}
          {point && (
            <>
              <span aria-hidden className="pointer-events-none absolute left-0 right-0 bg-fg/[0.07]" style={{ top: point.i * cell, height: cell }} />
              <span aria-hidden className="pointer-events-none absolute top-0 bottom-0 bg-fg/[0.07]" style={{ left: point.j * cell, width: cell }} />
              <span
                aria-hidden
                className="pointer-events-none absolute ring-2 ring-fg"
                style={{ left: point.j * cell, top: point.i * cell, width: cell, height: cell }}
              />
            </>
          )}
        </div>

        {layout.blocks && (
          <div aria-hidden>
            {layout.blocks.map((b) => {
              const label =
                b.factor === null ? t("factor.correlations.block_none") : (factorName(names, b.factor) ?? `F${b.factor + 1}`);
              return (
                <div
                  key={`b${b.from}`}
                  className="absolute flex items-center border-l border-border pl-2 text-[11px] leading-tight"
                  style={{ left: leftW + side + 4, width: rightW - 6, top: topH + b.from * cell, height: (b.to - b.from) * cell }}
                >
                  <span className={cn("line-clamp-2 break-words", b.factor === null && "text-muted")}>{label}</span>
                </div>
              );
            })}
          </div>
        )}

        {point && tip && (
          <div
            aria-hidden
            data-pair-tip
            className="pointer-events-none absolute z-10 rounded-md bg-surface px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-border/80"
            style={{ left: tip.left, top: tip.top, width: tipWidth }}
          >
            {text(point)}
          </div>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {announce}
        </div>
        {byFactor && <span className="sr-only">{t("factor.correlations.order_factor")}</span>}
      </div>
    </div>
  );
}

/**
 * Every correlation in text, for those who cannot read the colours and for a screen reader: the
 * measures are the rows and columns, their names open the fact sheet. Folded; the table of a
 * map of over a hundred measures has some fifteen thousand cells and is made only when it is asked for.
 */
function MapTable({
  data,
  layout,
  measureName,
}: {
  data: Correlations;
  layout: MapLayout;
  measureName: (key: string) => string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const zone = useTipZone<HTMLTableElement>();
  const n = layout.measures.length;
  const heading = t("factor.correlations.table_heading");
  const caption = t("factor.correlations.table_caption", { n });
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">
        <FoldButton label={heading} fold={{ open, onToggle: () => setOpen((v) => !v) }} />
      </div>
      {open && (
        <TableFrame label={heading} boxed className="max-h-[28rem]">
          <table ref={zone} className="data-table data-table--tight">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <td className="sticky-col" />
                {layout.measures.map((m) => (
                  <th key={m} scope="col" className="num align-bottom">
                    <span className="inline-block max-h-40 overflow-hidden [writing-mode:vertical-rl] rotate-180 text-ellipsis whitespace-nowrap">
                      <MeasureName name={measureName(m)} measure={m} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {layout.measures.map((m, i) => (
                <tr key={m}>
                  <th scope="row" className="sticky-col font-medium break-words min-w-[9rem] max-w-[16rem]">
                    <MeasureName name={measureName(m)} measure={m} />
                  </th>
                  {layout.measures.map((other, j) => {
                    const r = layoutValue(data, layout, i, j);
                    return (
                      <td
                        key={other}
                        className={cn("num", i === j && "text-muted", isHigh(r, i, j) && "font-semibold")}
                        style={i === j ? undefined : { backgroundColor: cellColor(r, 0.5) }}
                      >
                        {formatNumber(r, locale, 2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
